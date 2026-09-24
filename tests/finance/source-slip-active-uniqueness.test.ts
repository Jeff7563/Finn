import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { DataStore } from "@/lib/server/data-store";
import {
  calculateAccountBalance,
  isFinanciallyActiveTransaction,
} from "@/lib/finance/balances";
import { calculateMonthSummary } from "@/lib/finance/summaries";
import {
  replaceVoidedSlipTransactionAction,
  restoreTransactionAction,
} from "@/app/actions/transactions";
import { confirmSlipAction } from "@/app/actions/slip-review";
import { Account, Category } from "@/types/finance";
import { Slip } from "@/types/slip";

let mockUser: { id: string; email: string } | null = null;

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: vi.fn(async () => mockUser),
  requireUser: vi.fn(async () => {
    if (!mockUser) throw new Error("Unauthorized");
    return mockUser;
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("FINN — Production Hotfix: Active-Only source_slip_id Uniqueness Suite", () => {
  const USER_ID = "user-hotfix-slip-test";

  let accountA: Account;
  let accountB: Account;
  let categoryExpense: Category;
  let categoryIncome: Category;

  beforeEach(async () => {
    DataStore.reset();
    mockUser = { id: USER_ID, email: "operator@example.com" };

    accountA = await DataStore.createAccount(USER_ID, {
      name: "KBANK Main",
      type: "bank",
      currency: "THB",
      institution: "KBANK",
      masked_number: "1234",
      opening_balance: 10000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
      active: true,
    });

    accountB = await DataStore.createAccount(USER_ID, {
      name: "SCB Secondary",
      type: "bank",
      currency: "THB",
      institution: "SCB",
      masked_number: "5678",
      opening_balance: 5000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
      active: true,
    });

    categoryExpense = await DataStore.createCategory(USER_ID, {
      name: "Food & Beverage",
      type: "expense",
      color: "#ef4444",
      icon: "coffee",
    });

    categoryIncome = await DataStore.createCategory(USER_ID, {
      name: "Salary",
      type: "income",
      color: "#10b981",
      icon: "briefcase",
    });
  });

  const createInitialSlipWithTransaction = async (amount = 500) => {
    const slipId = crypto.randomUUID();
    const fileHash = crypto.createHash("sha256").update(`RAW_BYTES_${slipId}`).digest("hex");

    const tx = await DataStore.createTransaction(USER_ID, {
      type: "expense",
      amount,
      currency: "THB",
      transaction_date: "2026-09-20T10:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "Initial Slip Transaction",
      source: "slip",
      source_slip_id: slipId,
      confidence: 1.0,
      review_status: "confirmed",
    });

    const slip = await DataStore.createSlip(USER_ID, {
      id: slipId,
      user_id: USER_ID,
      file_hash_sha256: fileHash,
      storage_path: `${USER_ID}/slips/${slipId}.jpg`,
      stored_file_size: 2048,
      status: "created",
      linked_transaction_id: tx.id,
      extracted_json: {
        amount,
        currency: "THB",
        transactionDate: "2026-09-20T10:00:00.000Z",
        fieldConfidence: {},
        sender: {
          name: "Jeffy Test",
          bank: "KBANK",
          accountMasked: "1234",
        },
        receiver: {
          name: "Shop SCB",
          bank: "SCB",
          accountMasked: "9999",
        },
      },
    });

    await DataStore.createTransactionEvidence(USER_ID, {
      user_id: USER_ID,
      transaction_id: tx.id,
      slip_id: slipId,
      evidence_type: "slip",
    });

    return { slip, tx, fileHash };
  };

  // 1. old voided tx + replacement active same source_slip_id allowed
  it("1. old voided tx + replacement active same source_slip_id allowed", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(600);

    // Void tx1
    await DataStore.voidTransaction(USER_ID, tx1.id, "Incorrect amount entered");
    const voidedTx1 = (await DataStore.getTransactionById(USER_ID, tx1.id))!;
    expect(voidedTx1.voided_at).toBeTruthy();
    expect(voidedTx1.source_slip_id).toBe(slip.id);

    // Perform replacement with corrected amount
    const replaceRes = await replaceVoidedSlipTransactionAction({
      old_transaction_id: tx1.id,
      slip_id: slip.id,
      type: "expense",
      amount: 550,
      currency: "THB",
      transaction_date: "2026-09-20T10:30:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "Corrected Expense",
      reason: "Corrected amount from 600 to 550",
    });

    expect(replaceRes.success).toBe(true);
    expect(replaceRes.newTransactionId).toBeDefined();

    const tx2 = (await DataStore.getTransactionById(USER_ID, replaceRes.newTransactionId!))!;
    expect(tx2.voided_at).toBeNull();
    expect(tx2.source_slip_id).toBe(slip.id);
    expect(tx2.amount).toBe(550);

    // Both tx1 and tx2 exist with the same source_slip_id: tx1 is voided, tx2 is active
    expect(voidedTx1.source_slip_id).toBe(tx2.source_slip_id);
    expect(voidedTx1.voided_at).not.toBeNull();
    expect(tx2.voided_at).toBeNull();
  });

  // 2. two active same source_slip_id rejected
  it("2. two active same source_slip_id rejected", async () => {
    const { slip } = await createInitialSlipWithTransaction(400);

    // Attempt to insert/create a second ACTIVE transaction with the same source_slip_id
    await expect(
      DataStore.createTransaction(USER_ID, {
        type: "expense",
        amount: 300,
        currency: "THB",
        transaction_date: "2026-09-20T11:00:00.000Z",
        from_account_id: accountA.id,
        category_id: categoryExpense.id,
        description: "Conflicting Active Transaction",
        source: "slip",
        source_slip_id: slip.id,
      })
    ).rejects.toThrow(/idx_transactions_source_slip_id_unique/i);
  });

  // 3. multiple voided historical tx same source_slip_id allowed
  it("3. multiple voided historical tx same source_slip_id allowed", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(100);

    // Void tx1 -> replace with tx2
    await DataStore.voidTransaction(USER_ID, tx1.id, "Void tx1");
    const res1 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: tx1.id,
      slip_id: slip.id,
      type: "expense",
      amount: 120,
      currency: "THB",
      transaction_date: "2026-09-20T12:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "Replacement tx2",
      reason: "First correction",
    });

    const tx2Id = res1.transaction.id;

    // Void tx2 -> replace with tx3
    await DataStore.voidTransaction(USER_ID, tx2Id, "Void tx2");
    const res2 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: tx2Id,
      slip_id: slip.id,
      type: "expense",
      amount: 130,
      currency: "THB",
      transaction_date: "2026-09-20T12:30:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "Replacement tx3",
      reason: "Second correction",
    });

    const tx3Id = res2.transaction.id;

    const allTxs = await DataStore.getTransactionsIncludingVoided(USER_ID);
    const slipTxs = allTxs.filter((t) => t.source_slip_id === slip.id);

    // All three transactions retain the same source_slip_id
    expect(slipTxs.length).toBe(3);
    const tx1Reloaded = slipTxs.find((t) => t.id === tx1.id)!;
    const tx2Reloaded = slipTxs.find((t) => t.id === tx2Id)!;
    const tx3Reloaded = slipTxs.find((t) => t.id === tx3Id)!;

    expect(tx1Reloaded.voided_at).not.toBeNull();
    expect(tx2Reloaded.voided_at).not.toBeNull();
    expect(tx3Reloaded.voided_at).toBeNull();
  });

  // 4. replacement chain tx1 -> tx2 -> tx3 works
  it("4. replacement chain tx1 -> tx2 -> tx3 works", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(200);

    // Step 1: void tx1
    await DataStore.voidTransaction(USER_ID, tx1.id, "First void");
    // Step 2: replace tx1 -> tx2
    const res1 = await replaceVoidedSlipTransactionAction({
      old_transaction_id: tx1.id,
      slip_id: slip.id,
      type: "expense",
      amount: 250,
      currency: "THB",
      transaction_date: "2026-09-21T09:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "tx2",
      reason: "Correction 1",
    });
    expect(res1.success).toBe(true);
    const tx2Id = res1.newTransactionId!;

    // Step 3: void tx2
    await DataStore.voidTransaction(USER_ID, tx2Id, "Second void");
    // Step 4: replace tx2 -> tx3
    const res2 = await replaceVoidedSlipTransactionAction({
      old_transaction_id: tx2Id,
      slip_id: slip.id,
      type: "expense",
      amount: 280,
      currency: "THB",
      transaction_date: "2026-09-21T10:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "tx3",
      reason: "Correction 2",
    });
    expect(res2.success).toBe(true);
    const tx3Id = res2.newTransactionId!;

    const evTx1 = await DataStore.getTransactionReplacementEvents(USER_ID, tx1.id);
    expect(evTx1.replacedBy?.new_transaction_id).toBe(tx2Id);

    const evTx2 = await DataStore.getTransactionReplacementEvents(USER_ID, tx2Id);
    expect(evTx2.replaces?.old_transaction_id).toBe(tx1.id);
    expect(evTx2.replacedBy?.new_transaction_id).toBe(tx3Id);

    const evTx3 = await DataStore.getTransactionReplacementEvents(USER_ID, tx3Id);
    expect(evTx3.replaces?.old_transaction_id).toBe(tx2Id);
    expect(evTx3.replacedBy).toBeNull();
  });

  // 5. only latest replacement financially active
  it("5. only latest replacement financially active", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(100);

    // Void tx1 -> replace tx2 (200) -> void tx2 -> replace tx3 (300)
    await DataStore.voidTransaction(USER_ID, tx1.id, "Void tx1");
    const r1 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: tx1.id,
      slip_id: slip.id,
      type: "expense",
      amount: 200,
      currency: "THB",
      transaction_date: "2026-09-20T12:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "tx2",
      reason: "First fix",
    });
    const tx2Id = r1.transaction.id;

    await DataStore.voidTransaction(USER_ID, tx2Id, "Void tx2");
    const r2 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: tx2Id,
      slip_id: slip.id,
      type: "expense",
      amount: 300,
      currency: "THB",
      transaction_date: "2026-09-20T13:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "tx3",
      reason: "Second fix",
    });
    const tx3Id = r2.transaction.id;

    const tx1Obj = (await DataStore.getTransactionById(USER_ID, tx1.id))!;
    const tx2Obj = (await DataStore.getTransactionById(USER_ID, tx2Id))!;
    const tx3Obj = (await DataStore.getTransactionById(USER_ID, tx3Id))!;

    expect(isFinanciallyActiveTransaction(tx1Obj)).toBe(false);
    expect(isFinanciallyActiveTransaction(tx2Obj)).toBe(false);
    expect(isFinanciallyActiveTransaction(tx3Obj)).toBe(true);

    const activeTxs = await DataStore.getTransactions(USER_ID);
    const balanceA = calculateAccountBalance(accountA, activeTxs);
    // Opening balance 10000 - tx3(300) = 9700. Neither tx1(100) nor tx2(200) are deducted.
    expect(balanceA.current_balance).toBe(9700);

    const allTxs = await DataStore.getTransactionsIncludingVoided(USER_ID);
    const activeCount = allTxs.filter(isFinanciallyActiveTransaction).length;
    expect(activeCount).toBe(1);

    const summary = calculateMonthSummary(allTxs, new Date("2026-09-20T12:00:00.000Z"));
    expect(summary.expense_total).toBe(300);
    expect(summary.income_total).toBe(0);
    expect(summary.net_cash_flow).toBe(-300);
  });

  // 6. restore old tx blocked while active replacement exists
  it("6. restore old tx blocked while active replacement exists", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(500);

    await DataStore.voidTransaction(USER_ID, tx1.id, "Void before replace");
    await replaceVoidedSlipTransactionAction({
      old_transaction_id: tx1.id,
      slip_id: slip.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-20T14:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "Active replacement",
      reason: "Correction",
    });

    // Attempt to restore tx1 while tx2 is active
    const restoreRes = await restoreTransactionAction(tx1.id);
    expect(restoreRes.success).toBe(false);
    expect(restoreRes.error).toMatch(/มีรายการทดแทน/);

    // Verify tx1 remains voided
    const tx1Reloaded = (await DataStore.getTransactionById(USER_ID, tx1.id))!;
    expect(tx1Reloaded.voided_at).not.toBeNull();
  });

  // 7. transfer replacement does not affect income/expense totals
  it("7. transfer replacement does not affect income/expense totals", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(500);

    await DataStore.voidTransaction(USER_ID, tx1.id, "Void erroneous expense");

    // Replace with transfer between account A and account B
    const replaceRes = await replaceVoidedSlipTransactionAction({
      old_transaction_id: tx1.id,
      slip_id: slip.id,
      type: "transfer",
      amount: 1500,
      currency: "THB",
      transaction_date: "2026-09-20T15:00:00.000Z",
      from_account_id: accountA.id,
      to_account_id: accountB.id,
      description: "Transfer between own accounts",
      reason: "Corrected from expense to transfer",
    });
    expect(replaceRes.success).toBe(true);

    const txs = await DataStore.getTransactions(USER_ID);
    const summary = calculateMonthSummary(txs, new Date("2026-09-20T15:00:00.000Z"));
    expect(summary.income_total).toBe(0);
    expect(summary.expense_total).toBe(0);

    const balA = calculateAccountBalance(accountA, txs);
    const balB = calculateAccountBalance(accountB, txs);
    expect(balA.current_balance).toBe(8500); // 10000 - 1500
    expect(balB.current_balance).toBe(6500); // 5000 + 1500
  });

  // 8. slip linked_transaction_id points latest active replacement
  it("8. slip linked_transaction_id points latest active replacement", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(100);

    await DataStore.voidTransaction(USER_ID, tx1.id, "Void 1");
    const r1 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: tx1.id,
      slip_id: slip.id,
      type: "expense",
      amount: 150,
      currency: "THB",
      transaction_date: "2026-09-20T16:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "tx2",
      reason: "First fix",
    });

    let reloadedSlip = (await DataStore.getSlipById(USER_ID, slip.id))!;
    expect(reloadedSlip.linked_transaction_id).toBe(r1.transaction.id);

    await DataStore.voidTransaction(USER_ID, r1.transaction.id, "Void 2");
    const r2 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: r1.transaction.id,
      slip_id: slip.id,
      type: "expense",
      amount: 180,
      currency: "THB",
      transaction_date: "2026-09-20T17:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "tx3",
      reason: "Second fix",
    });

    reloadedSlip = (await DataStore.getSlipById(USER_ID, slip.id))!;
    expect(reloadedSlip.linked_transaction_id).toBe(r2.transaction.id);
  });

  // 9. transaction_evidence points latest active replacement
  it("9. transaction_evidence points latest active replacement", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(100);

    await DataStore.voidTransaction(USER_ID, tx1.id, "Void 1");
    const r1 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: tx1.id,
      slip_id: slip.id,
      type: "expense",
      amount: 220,
      currency: "THB",
      transaction_date: "2026-09-20T18:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "tx2",
      reason: "First fix",
    });

    let evList = await DataStore.getTransactionEvidence(USER_ID, r1.transaction.id);
    expect(evList.some((e) => e.slip_id === slip.id)).toBe(true);

    await DataStore.voidTransaction(USER_ID, r1.transaction.id, "Void 2");
    const r2 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: r1.transaction.id,
      slip_id: slip.id,
      type: "expense",
      amount: 250,
      currency: "THB",
      transaction_date: "2026-09-20T19:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
      description: "tx3",
      reason: "Second fix",
    });

    // Evidence moved from r1 to r2
    const evOld = await DataStore.getTransactionEvidence(USER_ID, r1.transaction.id);
    expect(evOld.some((e) => e.slip_id === slip.id)).toBe(false);

    const evNew = await DataStore.getTransactionEvidence(USER_ID, r2.transaction.id);
    expect(evNew.some((e) => e.slip_id === slip.id)).toBe(true);
  });

  // 10. duplicate upload SHA-256 protection unchanged
  it("10. duplicate upload SHA-256 protection unchanged", async () => {
    const { slip, fileHash } = await createInitialSlipWithTransaction(350);

    // Verify existing slip is found by SHA-256 hash
    const foundSlip = await DataStore.getSlipByFileHash(USER_ID, fileHash);
    expect(foundSlip).toBeDefined();
    expect(foundSlip?.id).toBe(slip.id);

    // Even if the transaction is replaced or voided, the SHA-256 hash detection remains intact
    const anotherUser = "user-another-999";
    const foreignFound = await DataStore.getSlipByFileHash(anotherUser, fileHash);
    expect(foreignFound).toBeNull(); // isolated by user_id
  });

  // 11. confirm slip idempotency never relinks to historical voided transaction
  it("11. confirm slip idempotency never relinks to historical voided transaction", async () => {
    const { slip, tx: tx1 } = await createInitialSlipWithTransaction(400);

    // Void tx1
    await DataStore.voidTransaction(USER_ID, tx1.id, "Void initial tx");

    // Simulate scenario where slip.linked_transaction_id is unlinked / reset to needs_review
    await DataStore.updateSlip(USER_ID, slip.id, {
      linked_transaction_id: null,
      status: "needs_review",
    });

    // Confirm slip via DataStore.confirmSlipTransaction (the atomic RPC)
    const confirmRes = await DataStore.confirmSlipTransaction(USER_ID, {
      slipId: slip.id,
      type: "expense",
      amount: 400,
      currency: "THB",
      transaction_date: "2026-09-20T10:00:00.000Z",
      from_account_id: accountA.id,
      category_id: categoryExpense.id,
    });

    // Must NOT have returned the voided tx1 ID
    expect(confirmRes.alreadyConfirmed).toBe(false);
    expect(confirmRes.transaction.id).not.toBe(tx1.id);

    // Newly confirmed transaction is active
    const confirmedTx = (await DataStore.getTransactionById(USER_ID, confirmRes.transaction.id))!;
    expect(confirmedTx.voided_at).toBeNull();
    expect(confirmedTx.source_slip_id).toBe(slip.id);

    // Slip is linked to the new active transaction, NOT the voided one
    const updatedSlip = (await DataStore.getSlipById(USER_ID, slip.id))!;
    expect(updatedSlip.linked_transaction_id).toBe(confirmedTx.id);
    expect(updatedSlip.linked_transaction_id).not.toBe(tx1.id);
  });

  // 12. migration contract verifies partial predicate includes: source_slip_id IS NOT NULL AND voided_at IS NULL
  it("12. migration contract verifies partial predicate includes: source_slip_id IS NOT NULL AND voided_at IS NULL", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "supabase/migrations/20260924000001_source_slip_active_uniqueness.sql"
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrationContent = fs.readFileSync(migrationPath, "utf-8");

    // Unique index definition with partial active-only predicate
    expect(migrationContent).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+idx_transactions_source_slip_id_unique\s+ON\s+public\.transactions\s*\(\s*source_slip_id\s*\)\s+WHERE\s+source_slip_id\s+IS\s+NOT\s+NULL\s+AND\s+voided_at\s+IS\s+NULL;/i
    );

    // Idempotency query fallback uses voided_at IS NULL
    expect(migrationContent).toMatch(
      /WHERE\s+source_slip_id\s*=\s*p_slip_id\s+AND\s+user_id\s*=\s*p_user_id\s+AND\s+voided_at\s+IS\s+NULL/i
    );
  });
});
