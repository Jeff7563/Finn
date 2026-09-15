import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  confirmSlipAction,
  editAndConfirmSlipAction,
} from "@/app/actions/slip-review";
import { DataStore, MemoryDataStore } from "@/lib/server/data-store";
import { calculateMonthSummary } from "@/lib/finance/summaries";
import { calculateAccountBalance } from "@/lib/finance/balances";
import { subscribeToFinancialChanges } from "@/lib/slip/realtime/slips-realtime";
import { Account, Category, Merchant } from "@/types/finance";
import { SlipExtraction } from "@/types/slip";
import fs from "fs";
import path from "path";

function makeExtraction(data: Partial<SlipExtraction>): SlipExtraction {
  return {
    fieldConfidence: {},
    ...data,
  };
}

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock auth
let currentMockUser: { id: string; email: string } | null = {
  id: "user-confirm-test",
  email: "test@example.com",
};

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: vi.fn(async () => currentMockUser),
}));

describe("FINN — Confirm Reviewed Slip Into Real Transaction (Production Safety & Atomicity)", () => {
  const userId = "user-confirm-test";
  const otherUserId = "user-other-456";

  let checkingAccount: Account;
  let savingsAccount: Account;
  let defaultCategory: Category;
  let testMerchant: Merchant;

  beforeEach(async () => {
    vi.clearAllMocks();
    DataStore.reset();
    currentMockUser = { id: userId, email: "test@example.com" };

    // Set up test accounts
    checkingAccount = await DataStore.createAccount(userId, {
      name: "KBANK Checking",
      type: "bank",
      institution: "KBANK",
      masked_number: "1234",
      opening_balance: 10000,
      currency: "THB",
    });

    savingsAccount = await DataStore.createAccount(userId, {
      name: "SCB Savings",
      type: "bank",
      institution: "SCB",
      masked_number: "5678",
      opening_balance: 5000,
      currency: "THB",
    });

    defaultCategory = await DataStore.createCategory(userId, {
      name: "อาหารและเครื่องดื่ม",
      type: "expense",
    });

    testMerchant = await DataStore.createMerchant(userId, {
      display_name: "ร้านก๋วยเตี๋ยวเรือ",
      category_hint: defaultCategory.id,
      aliases: ["ก๋วยเตี๋ยวเรือ", "Noodle Shop"],
    });
  });

  // 1. Successful confirmation: slip.status = 'created' and transaction.review_status = 'confirmed'
  it("1. Successful confirmation sets slip.status = 'created' and transaction.review_status = 'confirmed'", async () => {
    const slip = await DataStore.createSlip(userId, {
      status: "needs_review",
      storage_path: `${userId}/slips/expense_slip_01.jpg`,
      overall_confidence: 0.85,
      extracted_json: makeExtraction({
        amount: 85.5,
        currency: "THB",
        transactionDate: "2026-09-15T12:30:00.000Z",
        sender: {
          name: "Jeffy Test",
          bank: "KBANK",
          accountMasked: "1234",
        },
        receiver: {
          name: "ร้านก๋วยเตี๋ยวเรือ",
          bank: "SCB",
          accountMasked: "9999",
        },
        reference: "KBNK20260915123045",
      }),
    });

    const result = await confirmSlipAction(slip.id);
    expect(result.success).toBe(true);
    expect(result.transactionId).toBeDefined();

    // Verify transaction exists in data store with review_status = 'confirmed'
    const tx = await DataStore.getTransactionById(userId, result.transactionId!);
    expect(tx).not.toBeNull();
    expect(tx?.amount).toBe(85.5);
    expect(tx?.type).toBe("expense");
    expect(tx?.from_account_id).toBe(checkingAccount.id);
    expect(tx?.to_account_id).toBeNull();
    expect(tx?.source).toBe("slip");
    expect(tx?.source_slip_id).toBe(slip.id);
    expect(tx?.reference_number).toBe("KBNK20260915123045");
    expect(tx?.review_status).toBe("confirmed");

    // CRITICAL: Slip status is canonical 'created', NOT non-existent 'confirmed'
    const updatedSlip = await DataStore.getSlipById(userId, slip.id);
    expect(updatedSlip?.status).toBe("created");
    expect(updatedSlip?.linked_transaction_id).toBe(result.transactionId);
    expect(updatedSlip?.processed_at).toBeDefined();
  });

  // 2. Transaction insert succeeds but slip update fails: entire operation rolls back
  it("2. Transaction insert succeeds but slip update fails: entire operation rolls back and zero transaction remains", async () => {
    const slip = await DataStore.createSlip(userId, {
      status: "needs_review",
      storage_path: `${userId}/slips/rollback_test.jpg`,
      extracted_json: makeExtraction({
        amount: 250,
        currency: "THB",
        sender: { bank: "KBANK", accountMasked: "1234" },
      }),
    });

    // Mock MemoryDataStore.updateSlip to throw an error simulating database/constraint failure during slip update
    const originalUpdateSlip = MemoryDataStore.updateSlip.bind(MemoryDataStore);
    vi.spyOn(MemoryDataStore, "updateSlip").mockImplementationOnce(async () => {
      throw new Error("Simulated network/DB crash while updating slip");
    });

    // Attempt confirmation
    const result = await confirmSlipAction(slip.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Simulated network/DB crash");

    // Verify rollback: NO transaction remains in the database with this source_slip_id
    const txs = await DataStore.getTransactions(userId);
    const orphanTx = txs.find((t) => t.source_slip_id === slip.id);
    expect(orphanTx).toBeUndefined();

    // Verify slip remains in 'needs_review' and has no linked transaction
    const slipAfter = await DataStore.getSlipById(userId, slip.id);
    expect(slipAfter?.status).toBe("needs_review");
    expect(slipAfter?.linked_transaction_id).toBeNull();

    // Restore spy
    vi.spyOn(MemoryDataStore, "updateSlip").mockImplementation(originalUpdateSlip);
  });

  // 3. Two concurrent confirmation requests result in exactly ONE transaction
  it("3. Two concurrent confirmation requests create exactly ONE transaction (concurrency/idempotency)", async () => {
    const slip = await DataStore.createSlip(userId, {
      status: "needs_review",
      storage_path: `${userId}/slips/concurrency_test.jpg`,
      overall_confidence: 0.88,
      extracted_json: makeExtraction({
        amount: 350,
        currency: "THB",
        transactionDate: "2026-09-15T16:00:00.000Z",
        sender: {
          name: "Jeffy",
          bank: "KBANK",
          accountMasked: "1234",
        },
        receiver: {
          name: "Supermarket",
          bank: "BBL",
          accountMasked: "0000",
        },
      }),
    });

    // Simulate 2 concurrent confirmation requests
    const [res1, res2] = await Promise.all([
      confirmSlipAction(slip.id),
      confirmSlipAction(slip.id),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res1.transactionId).toBe(res2.transactionId);

    // Verify exactly one transaction was created in the database
    const txs = await DataStore.getTransactions(userId);
    const matchingTxs = txs.filter((t) => t.source_slip_id === slip.id);
    expect(matchingTxs.length).toBe(1);
  });

  // 4. Repeated confirmation returns existing transaction
  it("4. Repeated confirmation calls return the already-created transaction", async () => {
    const slip = await DataStore.createSlip(userId, {
      status: "needs_review",
      storage_path: `${userId}/slips/already_confirmed.jpg`,
      overall_confidence: 0.88,
      extracted_json: makeExtraction({
        amount: 120,
        currency: "THB",
        transactionDate: "2026-09-15T17:00:00.000Z",
        sender: {
          name: "Jeffy",
          bank: "KBANK",
          accountMasked: "1234",
        },
        receiver: {
          name: "Coffee Shop",
          bank: "SCB",
          accountMasked: "1111",
        },
      }),
    });

    const firstRes = await confirmSlipAction(slip.id);
    expect(firstRes.success).toBe(true);

    // Call again
    const secondRes = await confirmSlipAction(slip.id);
    expect(secondRes.success).toBe(true);
    expect(secondRes.transactionId).toBe(firstRes.transactionId);
  });

  // 5. DB status CHECK is compatible with production migration
  it("5. DB status CHECK in migration is strictly compatible with production schema (no 'confirmed' status in slips)", () => {
    const migrationPath = path.join(
      process.cwd(),
      "supabase/migrations/20260915000001_confirm_slips_realtime.sql"
    );
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");

    // Verify that the migration does NOT alter slips.status check constraint
    expect(migrationSql).not.toContain("slips_status_check");
    expect(migrationSql).not.toContain("status IN");
    // Verify that RPC confirm_slip_transaction sets status to 'created'
    expect(migrationSql).toContain("status = 'created'");
    // Verify foreign key integrity constraint exists
    expect(migrationSql).toContain("fk_transactions_source_slip");
    // Verify unique index exists
    expect(migrationSql).toContain("idx_transactions_source_slip_id_unique");
  });

  // 6. Existing auto-created slip pipeline using status=created still works
  it("6. Existing auto-created slip pipeline using status='created' functions correctly", async () => {
    // Existing ingestion pipeline creates transaction directly for high-confidence slips
    const tx = await DataStore.createTransaction(userId, {
      type: "expense",
      amount: 400,
      transaction_date: new Date().toISOString(),
      from_account_id: checkingAccount.id,
      source: "slip",
      review_status: "confirmed",
    });

    const slip = await DataStore.createSlip(userId, {
      status: "created",
      linked_transaction_id: tx.id,
      storage_path: `${userId}/slips/auto_created.jpg`,
      extracted_json: makeExtraction({
        amount: 400,
        sender: { bank: "KBANK", accountMasked: "1234" },
      }),
    });

    // Auto-created slip does not appear in pending review inbox
    const pending = await DataStore.getPendingReviewSlips(userId);
    expect(pending.some((s) => s.id === slip.id)).toBe(false);

    // Calling confirm on an already created slip safely returns the linked transaction
    const res = await confirmSlipAction(slip.id);
    expect(res.success).toBe(true);
    expect(res.transactionId).toBe(tx.id);
  });

  // 7. Review Inbox no longer returns created slips
  it("7. Review Inbox query getPendingReviewSlips filters out created slips", async () => {
    const slip = await DataStore.createSlip(userId, {
      status: "needs_review",
      storage_path: `${userId}/slips/inbox_disappearance.jpg`,
      extracted_json: makeExtraction({
        amount: 50,
        sender: { bank: "KBANK", accountMasked: "1234" },
      }),
    });

    // Initially in inbox
    let inbox = await DataStore.getPendingReviewSlips(userId);
    expect(inbox.some((s) => s.id === slip.id)).toBe(true);

    // Confirm it
    const res = await confirmSlipAction(slip.id);
    expect(res.success).toBe(true);

    // Removed from inbox
    inbox = await DataStore.getPendingReviewSlips(userId);
    expect(inbox.some((s) => s.id === slip.id)).toBe(false);

    // Verify slip record is preserved in database with status 'created'
    const persisted = await DataStore.getSlipById(userId, slip.id);
    expect(persisted?.status).toBe("created");
    expect(persisted?.deleted_at).toBeNull();
  });

  // 8. Internal transfer between two owned accounts updates balances but NEVER affects income/expense totals
  it("8. Internal transfer between two owned accounts updates balances but NEVER affects income/expense totals", async () => {
    const slip = await DataStore.createSlip(userId, {
      status: "needs_review",
      storage_path: `${userId}/slips/transfer_slip_01.jpg`,
      overall_confidence: 0.95,
      extracted_json: makeExtraction({
        amount: 2000,
        currency: "THB",
        transactionDate: "2026-09-15T15:00:00.000Z",
        sender: {
          name: "Jeffy Test",
          bank: "KBANK",
          accountMasked: "1234",
        },
        receiver: {
          name: "Jeffy Test",
          bank: "SCB",
          accountMasked: "5678",
        },
        reference: "TRF202609151500",
      }),
    });

    const result = await confirmSlipAction(slip.id);
    expect(result.success).toBe(true);

    const tx = await DataStore.getTransactionById(userId, result.transactionId!);
    expect(tx?.type).toBe("transfer");
    expect(tx?.from_account_id).toBe(checkingAccount.id);
    expect(tx?.to_account_id).toBe(savingsAccount.id);

    // Verify balances
    const allTxs = (await DataStore.getTransactions(userId)).map((t) => ({
      ...t,
      from_account_id: t.from_account_id || null,
      to_account_id: t.to_account_id || null,
    }));
    const checkingBal = calculateAccountBalance(checkingAccount, allTxs);
    const savingsBal = calculateAccountBalance(savingsAccount, allTxs);

    // Checking: 10000 - 2000 = 8000
    expect(checkingBal.current_balance).toBe(8000);
    // Savings: 5000 + 2000 = 7000
    expect(savingsBal.current_balance).toBe(7000);

    // CRITICAL FINANCIAL INVARIANT: Month summary income & expense are 0
    const summary = calculateMonthSummary(allTxs, new Date("2026-09-15"));
    expect(summary.income_total).toBe(0);
    expect(summary.expense_total).toBe(0);
    expect(summary.net_cash_flow).toBe(0);
  });

  // 9. Missing account prevents confirmation
  it("9. Missing or unresolvable account prevents direct confirmation and prompts user", async () => {
    const slip = await DataStore.createSlip(userId, {
      status: "needs_review",
      storage_path: `${userId}/slips/unresolved_account.jpg`,
      extracted_json: makeExtraction({
        amount: 500,
        currency: "THB",
        transactionDate: "2026-09-15T18:00:00.000Z",
        sender: {
          name: "Someone Unknown",
          bank: "TTB",
          accountMasked: "9999",
        },
        receiver: {
          name: "Another Unknown",
          bank: "KTB",
          accountMasked: "8888",
        },
      }),
    });

    const result = await confirmSlipAction(slip.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("เลือกบัญชี");

    // Slip remains in needs_review status
    const slipAfter = await DataStore.getSlipById(userId, slip.id);
    expect(slipAfter?.status).toBe("needs_review");
    expect(slipAfter?.linked_transaction_id).toBeNull();
  });

  // 10. User can correct values before confirmation, recording slip_corrections
  it("10. User can correct values before confirmation, recording slip_corrections and setting review_status='corrected'", async () => {
    const slip = await DataStore.createSlip(userId, {
      status: "needs_review",
      storage_path: `${userId}/slips/mistyped_ocr.jpg`,
      extracted_json: makeExtraction({
        amount: 18.0,
        currency: "THB",
        transactionDate: "2026-09-15T09:25:00.000Z",
        reference: "OLDREF123",
      }),
    });

    const result = await editAndConfirmSlipAction(slip.id, {
      type: "expense",
      amount: 180.0,
      currency: "THB",
      transaction_date: "2026-09-15T10:00:00.000Z",
      from_account_id: checkingAccount.id,
      category_id: defaultCategory.id,
      reference_number: "CORRECTEDREF456",
      source: "slip",
      tax_deductible: false,
    });

    expect(result.success).toBe(true);

    const tx = await DataStore.getTransactionById(userId, result.transactionId!);
    expect(tx?.amount).toBe(180.0);
    expect(tx?.review_status).toBe("corrected");
    expect(tx?.reference_number).toBe("CORRECTEDREF456");

    // Verify slip was updated to 'created'
    const updatedSlip = await DataStore.getSlipById(userId, slip.id);
    expect(updatedSlip?.status).toBe("created");

    // Verify slip corrections were recorded
    const corrections = await DataStore.getSlipCorrections(userId, slip.id);
    expect(corrections.length).toBeGreaterThanOrEqual(1);
    const amountCorrection = corrections.find((c) => c.field_name === "amount");
    expect(amountCorrection).toBeDefined();
    expect(amountCorrection?.extracted_value).toBe(18.0);
    expect(amountCorrection?.corrected_value).toBe(180.0);
  });

  // 11. Cross-user confirmation is forbidden
  it("11. Cross-user confirmation is strictly forbidden", async () => {
    const slip = await DataStore.createSlip(otherUserId, {
      status: "needs_review",
      storage_path: `${otherUserId}/slips/secret.jpg`,
      extracted_json: makeExtraction({
        amount: 999,
        sender: { bank: "KBANK", accountMasked: "1234" },
      }),
    });

    const result = await confirmSlipAction(slip.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("ไม่พบข้อมูลสลิปหรือคุณไม่มีสิทธิ์เข้าถึง");
  });

  // 12. Multi-table realtime sync listens to slips, transactions, and accounts
  it("12. Multi-table realtime sync listens to slips, transactions, and accounts", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockChannels: any[] = [];
    const mockSupabase = {
      channel: vi.fn((name: string) => {
        const ch = {
          name,
          on: vi.fn().mockReturnThis(),
          subscribe: vi.fn().mockReturnThis(),
          unsubscribe: vi.fn().mockResolvedValue("ok"),
        };
        mockChannels.push(ch);
        return ch;
      }),
      removeChannel: vi.fn().mockResolvedValue("ok"),
    };

    const onRefresh = vi.fn();
    const cleanup = subscribeToFinancialChanges({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockSupabase as any,
      userId,
      onRefresh,
    });

    expect(mockSupabase.channel).toHaveBeenCalledWith(`financial-realtime-${userId}`);
    expect(mockChannels.length).toBe(1);

    // Verify all 3 tables were registered
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onCalls = mockChannels[0].on.mock.calls;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registeredTables = onCalls.map((c: any[]) => c[1]?.table);
    expect(registeredTables).toContain("slips");
    expect(registeredTables).toContain("transactions");
    expect(registeredTables).toContain("accounts");

    cleanup();
  });
});
