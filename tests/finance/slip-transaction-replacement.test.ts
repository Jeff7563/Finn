import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { DataStore } from "@/lib/server/data-store";
import {
  calculateAccountBalance,
  isFinanciallyActiveTransaction,
} from "@/lib/finance/balances";
import {
  replaceVoidedSlipTransactionAction,
  getTransactionReplacementEventsAction,
  restoreTransactionAction,
} from "@/app/actions/transactions";
import { Account, Category } from "@/types/finance";
import { Slip } from "@/types/slip";

let mockUser: { id: string; email: string; display_name?: string } | null = null;

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

describe("Part B: Voided Slip Reuse & Atomic Replacement Suite (Scenarios 14-29)", () => {
  const USER_ID = "user-replacement-test-1";

  let account1: Account;
  let categoryExpense: Category;

  beforeEach(async () => {
    DataStore.reset();
    mockUser = { id: USER_ID, email: "operator@example.com" };

    // Setup base account
    account1 = await DataStore.createAccount(USER_ID, {
      name: "Main Savings",
      type: "bank",
      currency: "THB",
      opening_balance: 10000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
      active: true,
    });

    categoryExpense = await DataStore.createCategory(USER_ID, {
      name: "Food & Drinks",
      type: "expense",
      color: "#ef4444",
      icon: "coffee",
    });
  });

  const setupVoidedSlipScenario = async (options: {
    amount?: number;
    voided?: boolean;
    hasSlip?: boolean;
  } = {}) => {
    const isVoided = options.voided !== undefined ? options.voided : true;
    const hasSlip = options.hasSlip !== undefined ? options.hasSlip : true;
    const amount = options.amount ?? 500;

    let slip: Slip | null = null;
    const slipId = crypto.randomUUID();
    const fileHash = crypto.createHash("sha256").update(`SLIP_RAW_BYTES_${slipId}`).digest("hex");

    // 1. Create transaction
    const tx = await DataStore.createTransaction(USER_ID, {
      type: "expense",
      amount,
      currency: "THB",
      transaction_date: "2026-09-10T12:00:00.000Z",
      from_account_id: account1.id,
      category_id: categoryExpense.id,
      description: "Initial Incorrect Transaction",
      source: hasSlip ? "slip" : "manual",
      source_slip_id: hasSlip ? slipId : null,
      confidence: 1.0,
      review_status: "confirmed",
    });

    // 2. If hasSlip, create slip record & evidence link
    if (hasSlip) {
      slip = await DataStore.createSlip(USER_ID, {
        id: slipId,
        user_id: USER_ID,
        file_hash_sha256: fileHash,
        storage_path: `${USER_ID}/slips/${slipId}.jpg`,
        stored_file_size: 1024,
        status: "created",
        linked_transaction_id: tx.id,
        extracted_json: {
          amount,
          currency: "THB",
          transactionDate: "2026-09-10T12:00:00.000Z",
          fieldConfidence: {},
        },
      });

      await DataStore.createTransactionEvidence(USER_ID, {
        user_id: USER_ID,
        transaction_id: tx.id,
        slip_id: slipId,
        evidence_type: "slip",
      });
    }

    // 3. Void if requested
    if (isVoided) {
      await DataStore.voidTransaction(USER_ID, tx.id, "Recorded with wrong amount and date");
    }

    const currentTx = (await DataStore.getTransactionById(USER_ID, tx.id))!;
    return { tx: currentTx, slip, fileHash };
  };

  // Scenario 14: Replace transaction on a VOIDED transaction with slip evidence succeeds and returns new active transaction
  it("Scenario 14: Replace transaction on a VOIDED transaction with slip evidence succeeds and returns new active transaction", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();
    expect(oldTx.voided_at).toBeDefined();

    const result = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450, // Corrected amount
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      category_id: categoryExpense.id,
      description: "Corrected Transaction",
      reason: "Operator correction: fixed amount from 500 to 450",
    });

    expect(result.success).toBe(true);
    expect(result.transaction).toBeDefined();
    expect(result.transaction.amount).toBe(450);
    expect(result.transaction.voided_at).toBeNull();
    expect(result.transaction.source_slip_id).toBe(slip!.id);
  });

  // Scenario 15: Replace transaction on an ACTIVE (non-voided) transaction FAILS CLOSED
  it("Scenario 15: Replace transaction on an ACTIVE (non-voided) transaction FAILS CLOSED", async () => {
    const { tx: activeTx, slip } = await setupVoidedSlipScenario({ voided: false });
    expect(activeTx.voided_at).toBeNull();

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: activeTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 450,
        currency: "THB",
        transaction_date: "2026-09-10T14:30:00.000Z",
        from_account_id: account1.id,
        reason: "Attempt replacement on active",
      })
    ).rejects.toThrow("สามารถสร้างรายการทดแทนได้เฉพาะรายการที่ถูกยกเลิก (Voided) แล้วเท่านั้น");
  });

  // Scenario 16: Replace transaction on a voided transaction WITHOUT slip evidence fails closed
  it("Scenario 16: Replace transaction on a voided transaction WITHOUT slip evidence fails closed", async () => {
    const { tx: voidedManualTx } = await setupVoidedSlipScenario({ hasSlip: false });
    const unrelatedSlip = await DataStore.createSlip(USER_ID, {
      file_hash_sha256: "unrelated-hash-12345",
      storage_path: `${USER_ID}/slips/unrelated.jpg`,
      status: "needs_review",
    });

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: voidedManualTx.id,
        slip_id: unrelatedSlip.id,
        type: "expense",
        amount: 450,
        currency: "THB",
        transaction_date: "2026-09-10T14:30:00.000Z",
        from_account_id: account1.id,
        reason: "Attempt replacement without slip evidence",
      })
    ).rejects.toThrow("สามารถสร้างรายการทดแทนได้เฉพาะรายการที่มีหลักฐานสลิปเท่านั้น");
  });

  // Scenario 17: Replace transaction when slip is ALREADY linked to another active transaction fails closed
  it("Scenario 17: Replace transaction when slip is ALREADY linked to another active transaction fails closed", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    // Link slip to an active transaction
    const otherActiveTx = await DataStore.createTransaction(USER_ID, {
      type: "expense",
      amount: 100,
      currency: "THB",
      transaction_date: "2026-09-10T12:00:00.000Z",
      from_account_id: account1.id,
      source: "slip",
      source_slip_id: slip!.id,
    });
    await DataStore.updateSlip(USER_ID, slip!.id, {
      linked_transaction_id: otherActiveTx.id,
    });

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: oldTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 450,
        currency: "THB",
        transaction_date: "2026-09-10T14:30:00.000Z",
        from_account_id: account1.id,
        reason: "Attempt replacement with already active slip",
      })
    ).rejects.toThrow(/สลิปนี้เชื่อมโยงกับรายการอื่นอยู่แล้ว|สลิปนี้ถูกเชื่อมโยงกับรายการที่กำลังใช้งานอยู่แล้ว/);
  });

  // Scenario 18: Replace transaction: old transaction REMAINS voided (its voided_at, void_reason are preserved)
  it("Scenario 18: Replace transaction: old transaction REMAINS voided with preserved audit fields", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();
    const originalVoidedAt = oldTx.voided_at;
    const originalVoidReason = oldTx.void_reason;

    await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Operator correction",
    });

    const refreshedOldTx = (await DataStore.getTransactionById(USER_ID, oldTx.id))!;
    expect(refreshedOldTx.voided_at).toBe(originalVoidedAt);
    expect(refreshedOldTx.void_reason).toBe(originalVoidReason);
  });

  // Scenario 19: Replace transaction: new transaction is ACTIVE (voided_at IS NULL), type/amount/date/accounts are correctly set
  it("Scenario 19: Replace transaction: new transaction is ACTIVE and correctly configured", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    const res = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450.75,
      currency: "THB",
      transaction_date: "2026-09-10T15:00:00.000Z",
      from_account_id: account1.id,
      category_id: categoryExpense.id,
      description: "Corrected coffee & lunch",
      note: "Receipt attached",
      reason: "Correcting wrong date & amount",
    });

    const newTx = (await DataStore.getTransactionById(USER_ID, res.transaction.id))!;
    expect(newTx.voided_at).toBeNull();
    expect(newTx.amount).toBe(450.75);
    expect(newTx.currency).toBe("THB");
    expect(newTx.transaction_date).toBe("2026-09-10T15:00:00.000Z");
    expect(newTx.from_account_id).toBe(account1.id);
    expect(newTx.category_id).toBe(categoryExpense.id);
    expect(newTx.description).toBe("Corrected coffee & lunch");
    expect(newTx.note).toBe("Receipt attached");
    expect(newTx.source).toBe("slip");
    expect(newTx.source_slip_id).toBe(slip!.id);
  });

  // Scenario 20: Replace transaction: slip linked_transaction_id is updated to new transaction ID
  it("Scenario 20: Replace transaction: slip linked_transaction_id is updated to new transaction ID", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();
    expect(slip!.linked_transaction_id).toBe(oldTx.id);

    const res = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Fix amount",
    });

    const refreshedSlip = (await DataStore.getSlipById(USER_ID, slip!.id))!;
    expect(refreshedSlip.linked_transaction_id).toBe(res.transaction.id);
  });

  // Scenario 21: Replace transaction: slip status is set to created
  it("Scenario 21: Replace transaction: slip status is set to created", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Fix amount",
    });

    const refreshedSlip = (await DataStore.getSlipById(USER_ID, slip!.id))!;
    expect(refreshedSlip.status).toBe("created");
  });

  // Scenario 22: Replace transaction: transaction_evidence canonical record moves from old transaction to new transaction
  it("Scenario 22: Replace transaction: transaction_evidence canonical record moves to new transaction", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    const res = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Move evidence",
    });

    const oldTxEvidence = await DataStore.getTransactionEvidence(USER_ID, oldTx.id);
    const oldSlipEv = oldTxEvidence.find((e) => e.slip_id === slip!.id);
    expect(oldSlipEv).toBeUndefined();

    const newTxEvidence = await DataStore.getTransactionEvidence(USER_ID, res.transaction.id);
    const newSlipEv = newTxEvidence.find((e) => e.slip_id === slip!.id);
    expect(newSlipEv).toBeDefined();
    expect(newSlipEv?.transaction_id).toBe(res.transaction.id);
  });

  // Scenario 23: Replace transaction: exactly one transaction_replacement_events row is created with correct fields
  it("Scenario 23: Replace transaction: exactly one transaction_replacement_events row is created", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    const res = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Audited operator correction",
    });

    const events = await DataStore.getTransactionReplacementEvents(USER_ID, oldTx.id);
    expect(events.replacedBy).toBeDefined();
    expect(events.replacedBy?.id).toBe(res.event.id);
    expect(events.replacedBy?.old_transaction_id).toBe(oldTx.id);
    expect(events.replacedBy?.new_transaction_id).toBe(res.transaction.id);
    expect(events.replacedBy?.slip_id).toBe(slip!.id);
    expect(events.replacedBy?.user_id).toBe(USER_ID);
    expect(events.replacedBy?.reason).toBe("Audited operator correction");
  });

  // Scenario 24: Replace transaction: attempting a SECOND replacement on the same old transaction FAILS CLOSED
  it("Scenario 24: Replace transaction: attempting a SECOND replacement on the same old transaction FAILS CLOSED", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    // First replacement succeeds
    await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "First replacement",
    });

    // Second replacement attempt fails closed
    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: oldTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 400,
        currency: "THB",
        transaction_date: "2026-09-10T15:00:00.000Z",
        from_account_id: account1.id,
        reason: "Second replacement attempt",
      })
    ).rejects.toThrow(/สลิปนี้เชื่อมโยงกับรายการอื่นอยู่แล้ว|มีรายการทดแทนอยู่แล้ว|สลิปนี้ถูกเชื่อมโยงกับรายการที่กำลังใช้งานอยู่แล้ว/);
  });

  // Scenario 25: Re-uploading the same slip file after voiding: exact-file duplicate protection STILL triggers
  it("Scenario 25: Re-uploading the same slip file after voiding: exact-file duplicate protection STILL triggers", async () => {
    const { fileHash } = await setupVoidedSlipScenario();

    // Query for existing slip by hash
    const duplicateSlip = await DataStore.getSlipByFileHash(USER_ID, fileHash);
    expect(duplicateSlip).toBeDefined();
    expect(duplicateSlip?.file_hash_sha256).toBe(fileHash);
    // Duplicate detection remains active!
  });

  // Scenario 26: Re-uploading the same slip file after replacement: exact-file duplicate protection STILL triggers
  it("Scenario 26: Re-uploading the same slip file after replacement: exact-file duplicate protection STILL triggers", async () => {
    const { tx: oldTx, slip, fileHash } = await setupVoidedSlipScenario();

    await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Perform replacement",
    });

    // Query for existing slip by hash
    const duplicateSlip = await DataStore.getSlipByFileHash(USER_ID, fileHash);
    expect(duplicateSlip).toBeDefined();
    expect(duplicateSlip?.file_hash_sha256).toBe(fileHash);
    // Duplicate detection remains solid!
  });

  // Scenario 27: Balance calculation: old voided transaction has 0 effect on balance; new replacement transaction correctly affects balance
  it("Scenario 27: Balance calculation: voided has 0 effect, replacement affects balance", async () => {
    // Initial balance: 10,000
    let balResult = calculateAccountBalance(account1, []);
    expect(balResult.current_balance).toBe(10000);

    const { tx: oldTx, slip } = await setupVoidedSlipScenario({ amount: 500, voided: true });

    // Since oldTx is voided, balance is still 10,000
    expect(isFinanciallyActiveTransaction(oldTx)).toBe(false);
    balResult = calculateAccountBalance(account1, [oldTx]);
    expect(balResult.current_balance).toBe(10000);

    // Perform replacement: expense of 450
    const res = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Correct amount",
    });

    const newTx = (await DataStore.getTransactionById(USER_ID, res.transaction.id))!;
    expect(isFinanciallyActiveTransaction(newTx)).toBe(true);

    // Combined list: [oldTx (voided), newTx (active)]
    balResult = calculateAccountBalance(account1, [oldTx, newTx]);
    expect(balResult.current_balance).toBe(9550); // 10000 - 450
  });

  // Scenario 28: Balance calculation: baseline balance interaction is preserved correctly with replacement transaction
  it("Scenario 28: Balance calculation: baseline balance interaction is preserved correctly", async () => {
    // Baseline set at 2026-09-15T00:00:00Z with balance 8000
    const accountWithBaseline: Account = {
      ...account1,
      opening_balance: 8000,
      balance_as_of: "2026-09-15T00:00:00.000Z",
    };

    const { tx: oldTx, slip } = await setupVoidedSlipScenario({ amount: 500, voided: true });

    // Replacement before baseline: 2026-09-10 -> excluded from baseline delta
    const resPast = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Past replacement",
    });

    const pastTx = (await DataStore.getTransactionById(USER_ID, resPast.transaction.id))!;
    const balPast = calculateAccountBalance(accountWithBaseline, [oldTx, pastTx]);
    expect(balPast.current_balance).toBe(8000); // Prior to baseline => no delta applied

    // Create another voided slip tx after baseline: 2026-09-20
    const { tx: oldTx2, slip: slip2 } = await setupVoidedSlipScenario({ amount: 300, voided: true });
    const resFuture = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx2.id,
      slip_id: slip2!.id,
      type: "expense",
      amount: 350,
      currency: "THB",
      transaction_date: "2026-09-20T10:00:00.000Z",
      from_account_id: account1.id,
      reason: "Post-baseline replacement",
    });

    const futureTx = (await DataStore.getTransactionById(USER_ID, resFuture.transaction.id))!;
    const balPost = calculateAccountBalance(accountWithBaseline, [oldTx, pastTx, oldTx2, futureTx]);
    expect(balPost.current_balance).toBe(7650); // 8000 - 350
  });

  // Scenario 29: Restoring the old voided transaction when an active replacement exists FAILS CLOSED
  it("Scenario 29: Restoring the old voided transaction when an active replacement exists FAILS CLOSED", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      reason: "Perform replacement",
    });

    // Direct DataStore call
    await expect(
      DataStore.restoreTransaction(USER_ID, oldTx.id)
    ).rejects.toThrow("ไม่สามารถคืนรายการนี้ได้ เนื่องจากมีรายการทดแทนที่กำลังใช้งานอยู่ กรุณายกเลิกรายการทดแทนก่อน");

    // Server action restoreTransactionAction
    const actionRes = await restoreTransactionAction(oldTx.id);
    expect(actionRes.success).toBe(false);
    expect(actionRes.error).toContain("ไม่สามารถคืนรายการนี้ได้ เนื่องจากมีรายการทดแทนที่กำลังใช้งานอยู่");
  });

  // Extra coverage: Server action replaceVoidedSlipTransactionAction
  it("Server action: replaceVoidedSlipTransactionAction works end-to-end", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    const actionRes = await replaceVoidedSlipTransactionAction({
      old_transaction_id: oldTx.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 450,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: account1.id,
      category_id: categoryExpense.id,
      reason: "End-to-end server action test",
    });

    expect(actionRes.success).toBe(true);
    expect(actionRes.newTransactionId).toBeDefined();

    // Query events via action
    const eventsRes = await getTransactionReplacementEventsAction(oldTx.id);
    expect(eventsRes.success).toBe(true);
    expect(eventsRes.replacedBy).toBeDefined();
    expect(eventsRes.replacedBy?.new_transaction_id).toBe(actionRes.newTransactionId);
  });

  // Additional Canonical Link Safety & Edge Case Regression Tests

  it("Legacy slip without transaction_evidence can be replaced and creates evidence with evidence_type='slip'", async () => {
    const slipId = crypto.randomUUID();
    const fileHash = crypto.createHash("sha256").update(`LEGACY_SLIP_${slipId}`).digest("hex");
    const oldTx = await DataStore.createTransaction(USER_ID, {
      type: "expense",
      amount: 600,
      transaction_date: "2026-09-10T12:00:00.000Z",
      from_account_id: account1.id,
      source: "slip",
      source_slip_id: slipId,
    });
    const slip = await DataStore.createSlip(USER_ID, {
      id: slipId,
      user_id: USER_ID,
      file_hash_sha256: fileHash,
      storage_path: `${USER_ID}/slips/${slipId}.jpg`,
      stored_file_size: 1024,
      status: "created",
      linked_transaction_id: null,
    });
    // Note: No transaction_evidence row exists
    await DataStore.voidTransaction(USER_ID, oldTx.id, "Voiding legacy tx");

    const result = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: oldTx.id,
      slip_id: slip.id,
      type: "expense",
      amount: 650,
      currency: "THB",
      transaction_date: "2026-09-10T14:00:00.000Z",
      from_account_id: account1.id,
      reason: "Correcting legacy slip tx",
    });

    expect(result.success).toBe(true);
    expect(result.transaction?.id).toBeDefined();

    // Verify transaction_evidence was created with evidence_type='slip'
    const evidences = await DataStore.getTransactionEvidence(USER_ID, result.transaction.id);
    expect(evidences.length).toBe(1);
    expect(evidences[0].slip_id).toBe(slip.id);
    expect(evidences[0].evidence_type).toBe("slip");

    // Verify slip is now linked to newTx
    const updatedSlip = await DataStore.getSlipById(USER_ID, slip.id);
    expect(updatedSlip?.linked_transaction_id).toBe(result.transaction.id);
  });

  it("Slip canonically linked to another ACTIVE transaction is rejected (One Canonical Slip -> One Active Transaction)", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();
    // Create another active transaction linked to this slip
    const activeTx = await DataStore.createTransaction(USER_ID, {
      type: "expense",
      amount: 700,
      transaction_date: "2026-09-11T10:00:00.000Z",
      from_account_id: account1.id,
      source: "slip",
      source_slip_id: slip!.id,
    });
    await DataStore.updateSlip(USER_ID, slip!.id, { linked_transaction_id: activeTx.id });

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: oldTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 550,
        transaction_date: "2026-09-10T12:00:00.000Z",
        from_account_id: account1.id,
        reason: "Try to steal slip from active tx",
      })
    ).rejects.toThrow("สลิปนี้เชื่อมโยงกับรายการอื่นอยู่แล้ว");
  });

  it("Slip canonically linked to another VOIDED transaction is rejected unless that tx is old_transaction_id", async () => {
    const { tx: voidTx1, slip } = await setupVoidedSlipScenario();

    const voidTx2 = await DataStore.createTransaction(USER_ID, {
      type: "expense",
      amount: 300,
      transaction_date: "2026-09-12T10:00:00.000Z",
      from_account_id: account1.id,
    });
    await DataStore.voidTransaction(USER_ID, voidTx2.id, "Voided tx2");

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: voidTx2.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 350,
        transaction_date: "2026-09-12T10:00:00.000Z",
        from_account_id: account1.id,
        reason: "Mismatching voided transaction link",
      })
    ).rejects.toThrow("สลิปนี้เชื่อมโยงกับรายการอื่นอยู่แล้ว");
  });

  it("Evidence row linked to another transaction is rejected", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    const otherTx = await DataStore.createTransaction(USER_ID, {
      type: "expense",
      amount: 400,
      transaction_date: "2026-09-12T10:00:00.000Z",
      from_account_id: account1.id,
    });

    // Break the link on slips.linked_transaction_id to isolate evidence test
    await DataStore.updateSlip(USER_ID, slip!.id, { linked_transaction_id: null });
    // Point the evidence row to otherTx
    const evidenceList = await DataStore.getTransactionEvidence(USER_ID, oldTx.id);
    if (evidenceList.length > 0) {
      (evidenceList[0] as any).transaction_id = otherTx.id;
    }

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: oldTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 450,
        transaction_date: "2026-09-10T12:00:00.000Z",
        from_account_id: account1.id,
        reason: "Conflicting evidence row test",
      })
    ).rejects.toThrow("สลิปนี้มีหลักฐานเชื่อมโยงกับรายการอื่นอยู่แล้ว");
  });

  it("Historical old source_slip_id alone cannot override conflicting canonical link", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();
    expect(oldTx.source_slip_id).toBe(slip!.id);

    const tx2 = await DataStore.createTransaction(USER_ID, {
      type: "expense",
      amount: 900,
      transaction_date: "2026-09-13T10:00:00.000Z",
      from_account_id: account1.id,
    });
    await DataStore.updateSlip(USER_ID, slip!.id, { linked_transaction_id: tx2.id });

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: oldTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 500,
        transaction_date: "2026-09-10T12:00:00.000Z",
        from_account_id: account1.id,
        reason: "Attempt override canonical with source_slip_id",
      })
    ).rejects.toThrow("สลิปนี้เชื่อมโยงกับรายการอื่นอยู่แล้ว");
  });

  it("Replacement chain works: tx1 (void) -> replaced by tx2, tx2 (void) -> replaced by tx3", async () => {
    const { tx: tx1, slip } = await setupVoidedSlipScenario({ amount: 500 });

    // tx1 -> tx2
    const res1 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: tx1.id,
      slip_id: slip!.id,
      type: "expense",
      amount: 550,
      currency: "THB",
      transaction_date: "2026-09-10T13:00:00.000Z",
      from_account_id: account1.id,
      reason: "First replacement tx1 -> tx2",
    });
    expect(res1.success).toBe(true);
    const tx2Id = res1.transaction.id;

    // Void tx2
    await DataStore.voidTransaction(USER_ID, tx2Id, "tx2 was also slightly wrong");

    // tx2 -> tx3
    const res2 = await DataStore.replaceVoidedSlipTransaction(USER_ID, {
      old_transaction_id: tx2Id,
      slip_id: slip!.id,
      type: "expense",
      amount: 580,
      currency: "THB",
      transaction_date: "2026-09-10T14:00:00.000Z",
      from_account_id: account1.id,
      reason: "Second replacement tx2 -> tx3",
    });
    expect(res2.success).toBe(true);
    const tx3Id = res2.transaction.id;

    // Verify slip is now linked to tx3
    const finalSlip = await DataStore.getSlipById(USER_ID, slip!.id);
    expect(finalSlip?.linked_transaction_id).toBe(tx3Id);

    // Verify replacement events
    const event1 = await DataStore.getTransactionReplacementEvents(USER_ID, tx1.id);
    expect(event1.replacedBy?.new_transaction_id).toBe(tx2Id);

    const event2 = await DataStore.getTransactionReplacementEvents(USER_ID, tx2Id);
    expect(event2.replacedBy?.new_transaction_id).toBe(tx3Id);

    // Both tx1 and tx2 cannot be restored because active replacement tx3 exists
    await expect(DataStore.restoreTransaction(USER_ID, tx1.id)).rejects.toThrow("ไม่สามารถคืนรายการนี้ได้");
    await expect(DataStore.restoreTransaction(USER_ID, tx2Id)).rejects.toThrow("ไม่สามารถคืนรายการนี้ได้");
  });

  it("Failed replacement leaves zero partial state (atomicity)", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario({ amount: 500 });
    const initialTxs = await DataStore.getTransactions(USER_ID);
    const initialEvents = await DataStore.getTransactionReplacementEvents(USER_ID, oldTx.id);

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: oldTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 600,
        transaction_date: "2026-09-10T12:00:00.000Z",
        from_account_id: "non-existent-or-foreign-account",
        reason: "Atomic test with bad account",
      })
    ).rejects.toThrow();

    const postTxs = await DataStore.getTransactions(USER_ID);
    expect(postTxs.length).toBe(initialTxs.length);

    const postEvents = await DataStore.getTransactionReplacementEvents(USER_ID, oldTx.id);
    expect(postEvents.replacedBy).toBe(null);
    expect(postEvents.replacedBy).toEqual(initialEvents.replacedBy);

    const currentSlip = await DataStore.getSlipById(USER_ID, slip!.id);
    expect(currentSlip?.linked_transaction_id).toBe(oldTx.id);
  });

  it("Rejects replacement with empty or whitespace-only reason or exceeding 500 characters", async () => {
    const { tx: oldTx, slip } = await setupVoidedSlipScenario();

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: oldTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 450,
        transaction_date: "2026-09-10T12:00:00.000Z",
        from_account_id: account1.id,
        reason: "   ",
      })
    ).rejects.toThrow("Replacement reason is required");

    await expect(
      DataStore.replaceVoidedSlipTransaction(USER_ID, {
        old_transaction_id: oldTx.id,
        slip_id: slip!.id,
        type: "expense",
        amount: 450,
        transaction_date: "2026-09-10T12:00:00.000Z",
        from_account_id: account1.id,
        reason: "a".repeat(501),
      })
    ).rejects.toThrow("Replacement reason cannot exceed 500 characters");
  });
});
