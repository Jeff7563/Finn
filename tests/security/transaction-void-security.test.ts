import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import {
  deleteTransactionAction,
  voidTransactionAction,
  restoreTransactionAction,
  getTransactionVoidEventsAction,
} from "@/app/actions/transactions";
import { Account, Transaction } from "@/types/finance";

const userAlice = "user-alice-1111-1111-1111-111111111111";
const userBob = "user-bob-2222-2222-2222-222222222222";

let currentMockUser = { id: userAlice, email: "alice@example.com" };

vi.mock("@/lib/server/auth", () => ({
  requireUser: vi.fn(async () => currentMockUser),
  getAuthenticatedUser: vi.fn(async () => currentMockUser),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("FINN — Transaction Void & Undo Security & Audit Suite (Section 14)", () => {
  let aliceAccount: Account;
  let bobAccount: Account;
  let aliceTx: Transaction;
  let bobTx: Transaction;

  beforeEach(async () => {
    MemoryDataStore.reset();
    currentMockUser = { id: userAlice, email: "alice@example.com" };

    aliceAccount = await MemoryDataStore.createAccount(userAlice, {
      name: "Alice Account",
      type: "bank",
      currency: "THB",
      opening_balance: 10000,
    });

    bobAccount = await MemoryDataStore.createAccount(userBob, {
      name: "Bob Account",
      type: "bank",
      currency: "THB",
      opening_balance: 20000,
    });

    aliceTx = await MemoryDataStore.createTransaction(userAlice, {
      type: "expense",
      amount: 1500,
      from_account_id: aliceAccount.id,
      currency: "THB",
      transaction_date: "2026-09-10T10:00:00.000Z",
      description: "Alice expense",
    });

    bobTx = await MemoryDataStore.createTransaction(userBob, {
      type: "expense",
      amount: 3000,
      from_account_id: bobAccount.id,
      currency: "THB",
      transaction_date: "2026-09-11T12:00:00.000Z",
      description: "Bob expense",
    });
  });

  // =========================================================================
  // 1. Cross-User Authorization in DataStore
  // =========================================================================
  it("DataStore prevents User Alice from voiding User Bob's transaction", async () => {
    await expect(
      MemoryDataStore.voidTransaction(userAlice, bobTx.id, "Alice attempts to void Bob's tx")
    ).rejects.toThrow(/not found or does not belong to user/i);

    // Verify Bob's transaction was unaffected
    const bobTxAfter = await MemoryDataStore.getTransactionById(userBob, bobTx.id);
    expect(bobTxAfter?.voided_at).toBeNull();
  });

  it("DataStore prevents User Alice from restoring User Bob's transaction", async () => {
    // Bob voids his own tx
    await MemoryDataStore.voidTransaction(userBob, bobTx.id, "Bob voids his own tx");

    // Alice tries to restore Bob's tx
    await expect(
      MemoryDataStore.restoreTransaction(userAlice, bobTx.id, "Alice attempts to restore")
    ).rejects.toThrow(/not found or does not belong to user/i);

    // Verify Bob's transaction is still voided
    const bobTxAfter = await MemoryDataStore.getTransactionById(userBob, bobTx.id);
    expect(bobTxAfter?.voided_at).not.toBeNull();
  });

  it("DataStore prevents User Alice from reading User Bob's void events", async () => {
    await MemoryDataStore.voidTransaction(userBob, bobTx.id, "Bob private void reason");

    const aliceEvents = await MemoryDataStore.getTransactionVoidEvents(userAlice, bobTx.id);
    expect(aliceEvents.length).toBe(0);

    const bobEvents = await MemoryDataStore.getTransactionVoidEvents(userBob, bobTx.id);
    expect(bobEvents.length).toBe(1);
    expect(bobEvents[0].reason).toBe("Bob private void reason");
  });

  // =========================================================================
  // 2. Server Action Level Security & Cross-User Protection
  // =========================================================================
  it("voidTransactionAction rejects cross-user attempts", async () => {
    // Current authenticated user is Alice
    currentMockUser = { id: userAlice, email: "alice@example.com" };

    const result = await voidTransactionAction(bobTx.id, "Alice malicious void");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    // Verify Bob's tx is untouched
    const bobTxCurrent = await MemoryDataStore.getTransactionById(userBob, bobTx.id);
    expect(bobTxCurrent?.voided_at).toBeNull();
  });

  it("restoreTransactionAction rejects cross-user attempts", async () => {
    // Bob legitimately voids his transaction first
    await MemoryDataStore.voidTransaction(userBob, bobTx.id, "Bob legítimate void");

    // Alice attempts to restore Bob's transaction via server action
    currentMockUser = { id: userAlice, email: "alice@example.com" };
    const result = await restoreTransactionAction(bobTx.id, "Alice unauthorized restore");
    expect(result.success).toBe(false);

    // Verify Bob's tx remains voided
    const bobTxCurrent = await MemoryDataStore.getTransactionById(userBob, bobTx.id);
    expect(bobTxCurrent?.voided_at).not.toBeNull();
  });

  it("getTransactionVoidEventsAction returns only authenticated user's events", async () => {
    await MemoryDataStore.voidTransaction(userBob, bobTx.id, "Bob secret");

    // Alice queries
    currentMockUser = { id: userAlice, email: "alice@example.com" };
    const res = await getTransactionVoidEventsAction(bobTx.id);
    expect(res.success).toBe(true);
    expect(res.events).toEqual([]);
  });

  it("Server actions validate reason length and empty values", async () => {
    currentMockUser = { id: userAlice, email: "alice@example.com" };

    // Empty reason
    const emptyRes = await voidTransactionAction(aliceTx.id, "   ");
    expect(emptyRes.success).toBe(false);
    expect(emptyRes.error).toMatch(/เหตุผล/i);

    // Excessive reason > 500 chars
    const longReason = "a".repeat(501);
    const longRes = await voidTransactionAction(aliceTx.id, longReason);
    expect(longRes.success).toBe(false);
    expect(longRes.error).toMatch(/500/i);
  });

  // =========================================================================
  // 3. Foreign Key ON DELETE RESTRICT & Audit History Protection
  // =========================================================================
  it("deleteTransaction is prevented when transaction_void_events exists (ON DELETE RESTRICT)", async () => {
    // Alice voids her transaction, creating an audit log in transaction_void_events
    await MemoryDataStore.voidTransaction(userAlice, aliceTx.id, "Audited void");

    // Attempting to hard-delete the transaction must fail due to ON DELETE RESTRICT
    await expect(MemoryDataStore.deleteTransaction(userAlice, aliceTx.id)).rejects.toThrow(
      /associated void audit history exists.*ON DELETE RESTRICT/i
    );

    // Transaction and audit events remain intact
    const tx = await MemoryDataStore.getTransactionById(userAlice, aliceTx.id);
    expect(tx).not.toBeNull();
    const events = await MemoryDataStore.getTransactionVoidEvents(userAlice, aliceTx.id);
    expect(events.length).toBe(1);
  });

  // =========================================================================
  // 4. Direct Void-State Mutation Prevention (Requirement 1)
  // =========================================================================
  it("rejects direct UPDATE of voided_at, voided_by, or void_reason via updateTransaction", async () => {
    // Attempting to directly set voided_at must be rejected
    await expect(
      MemoryDataStore.updateTransaction(userAlice, aliceTx.id, {
        voided_at: new Date().toISOString(),
      } as any)
    ).rejects.toThrow(/Direct modification of transaction void state.*is prohibited/i);

    // Attempting to directly set voided_by must be rejected
    await expect(
      MemoryDataStore.updateTransaction(userAlice, aliceTx.id, {
        voided_by: userAlice,
      } as any)
    ).rejects.toThrow(/Direct modification of transaction void state.*is prohibited/i);

    // Attempting to directly set void_reason must be rejected
    await expect(
      MemoryDataStore.updateTransaction(userAlice, aliceTx.id, {
        void_reason: "Forged void reason",
      } as any)
    ).rejects.toThrow(/Direct modification of transaction void state.*is prohibited/i);

    // Verify transaction remains completely untouched
    const txAfter = await MemoryDataStore.getTransactionById(userAlice, aliceTx.id);
    expect(txAfter?.voided_at).toBeNull();
    expect(txAfter?.voided_by).toBeNull();
    expect(txAfter?.void_reason).toBeNull();
  });

  it("rejects direct INSERT of void state via createTransaction", async () => {
    await expect(
      MemoryDataStore.createTransaction(userAlice, {
        type: "expense",
        amount: 500,
        from_account_id: aliceAccount.id,
        transaction_date: "2026-09-12T10:00:00.000Z",
        voided_at: new Date().toISOString(),
      } as any)
    ).rejects.toThrow(/Direct insertion of transaction void state.*is prohibited/i);
  });

  it("allows ordinary transaction edits (description, amount, date) on active and voided transactions", async () => {
    // 1. Edit active transaction ordinary fields
    const updatedActive = await MemoryDataStore.updateTransaction(userAlice, aliceTx.id, {
      description: "Updated active description",
      amount: 1999,
    });
    expect(updatedActive.description).toBe("Updated active description");
    expect(updatedActive.amount).toBe(1999);
    expect(updatedActive.voided_at).toBeNull();

    // 2. Void via trusted RPC path
    await MemoryDataStore.voidTransaction(userAlice, aliceTx.id, "Legitimate void reason");

    // 3. Edit ordinary fields on voided transaction
    const updatedVoided = await MemoryDataStore.updateTransaction(userAlice, aliceTx.id, {
      note: "Added note while voided",
    });
    expect(updatedVoided.note).toBe("Added note while voided");
    expect(updatedVoided.voided_at).not.toBeNull();
    expect(updatedVoided.void_reason).toBe("Legitimate void reason");
  });

  it("restores voided transaction cleanly and atomically via trusted RPC", async () => {
    await MemoryDataStore.voidTransaction(userAlice, aliceTx.id, "Need to void");
    const voidedTx = await MemoryDataStore.getTransactionById(userAlice, aliceTx.id);
    expect(voidedTx?.voided_at).not.toBeNull();

    // Restore via trusted RPC
    const restoreResult = await MemoryDataStore.restoreTransaction(userAlice, aliceTx.id, "Restoring mistake");
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.already_active).toBe(false);

    const restoredTx = await MemoryDataStore.getTransactionById(userAlice, aliceTx.id);
    expect(restoredTx?.voided_at).toBeNull();
    expect(restoredTx?.voided_by).toBeNull();
    expect(restoredTx?.void_reason).toBeNull();

    // Audit events record both void and restore
    const events = await MemoryDataStore.getTransactionVoidEvents(userAlice, aliceTx.id);
    expect(events.length).toBe(2);
    expect(events[0].action).toBe("void");
    expect(events[1].action).toBe("restore");
  });

  // =========================================================================
  // 5. Hard Delete After Void History & Server Action Defense (Requirement 2)
  // =========================================================================
  it("Test 1: fresh manual tx -> Delete available and succeeds via server action", async () => {
    const freshManual = await MemoryDataStore.createTransaction(userAlice, {
      type: "expense",
      amount: 450,
      from_account_id: aliceAccount.id,
      currency: "THB",
      transaction_date: "2026-09-12T11:00:00.000Z",
      source: "manual",
    });

    // Fresh manual tx: no evidence, no void history -> deleteTransactionAction succeeds
    const deleteRes = await deleteTransactionAction(freshManual.id);
    expect(deleteRes.success).toBe(true);

    const txAfter = await MemoryDataStore.getTransactionById(userAlice, freshManual.id);
    expect(txAfter).toBeNull();
  });

  it("Test 2: voided manual tx -> Delete rejected clearly by server action", async () => {
    // Void the transaction
    await MemoryDataStore.voidTransaction(userAlice, aliceTx.id, "Voiding manual tx");

    // Server-side delete attempt must be rejected with clear Thai error
    const deleteRes = await deleteTransactionAction(aliceTx.id);
    expect(deleteRes.success).toBe(false);
    expect(deleteRes.error).toBe(
      "รายการนี้มีหลักฐานหรือประวัติการยกเลิก จึงไม่สามารถลบถาวรได้ กรุณาใช้ยกเลิกรายการ (Void) แทน"
    );

    // Transaction remains intact
    const tx = await MemoryDataStore.getTransactionById(userAlice, aliceTx.id);
    expect(tx).not.toBeNull();
    expect(tx?.voided_at).not.toBeNull();
  });

  it("Test 3: restored manual tx with audit history -> Delete remains blocked", async () => {
    // 1. Void
    await MemoryDataStore.voidTransaction(userAlice, aliceTx.id, "First void");
    // 2. Restore (transaction is now active again with void history)
    await MemoryDataStore.restoreTransaction(userAlice, aliceTx.id, "Restored back to active");

    const activeTx = await MemoryDataStore.getTransactionById(userAlice, aliceTx.id);
    expect(activeTx?.voided_at).toBeNull(); // active

    // 3. Attempting hard delete on restored transaction MUST be rejected
    const deleteRes = await deleteTransactionAction(aliceTx.id);
    expect(deleteRes.success).toBe(false);
    expect(deleteRes.error).toBe(
      "รายการนี้มีหลักฐานหรือประวัติการยกเลิก จึงไม่สามารถลบถาวรได้ กรุณาใช้ยกเลิกรายการ (Void) แทน"
    );

    // Transaction remains active and intact
    const txStillExists = await MemoryDataStore.getTransactionById(userAlice, aliceTx.id);
    expect(txStillExists).not.toBeNull();
  });

  it("Test 4: server hard-delete attempt with void history -> rejected clearly with Thai error", async () => {
    await MemoryDataStore.voidTransaction(userAlice, aliceTx.id, "Testing rejection message");

    const deleteRes = await deleteTransactionAction(aliceTx.id);
    expect(deleteRes.success).toBe(false);
    expect(deleteRes.error).toContain("รายการนี้มีหลักฐานหรือประวัติการยกเลิก จึงไม่สามารถลบถาวรได้");
    expect(deleteRes.error).toContain("กรุณาใช้ยกเลิกรายการ (Void) แทน");
  });

  it("Test 5: audit events remain intact throughout rejected hard-delete attempts", async () => {
    await MemoryDataStore.voidTransaction(userAlice, aliceTx.id, "Initial void");
    await MemoryDataStore.restoreTransaction(userAlice, aliceTx.id, "Restore step");

    const eventsBefore = await MemoryDataStore.getTransactionVoidEvents(userAlice, aliceTx.id);
    expect(eventsBefore.length).toBe(2);

    // Attempt delete
    const deleteRes = await deleteTransactionAction(aliceTx.id);
    expect(deleteRes.success).toBe(false);

    // Verify audit events are completely untouched
    const eventsAfter = await MemoryDataStore.getTransactionVoidEvents(userAlice, aliceTx.id);
    expect(eventsAfter.length).toBe(2);
    expect(eventsAfter[0].action).toBe("void");
    expect(eventsAfter[1].action).toBe("restore");
  });

  it("Test 6: evidence-backed delete remains blocked", async () => {
    // Create transaction linked to a slip
    const slipTx = await MemoryDataStore.createTransaction(userAlice, {
      type: "expense",
      amount: 1200,
      from_account_id: aliceAccount.id,
      currency: "THB",
      transaction_date: "2026-09-13T10:00:00.000Z",
      source: "slip",
      source_slip_id: "slip-uuid-1111",
    });

    const deleteRes = await deleteTransactionAction(slipTx.id);
    expect(deleteRes.success).toBe(false);
    expect(deleteRes.error).toBe(
      "รายการนี้มีหลักฐานหรือประวัติการยกเลิก จึงไม่สามารถลบถาวรได้ กรุณาใช้ยกเลิกรายการ (Void) แทน"
    );

    // Transaction remains intact
    const txAfter = await MemoryDataStore.getTransactionById(userAlice, slipTx.id);
    expect(txAfter).not.toBeNull();
  });

  // =========================================================================
  // 6. Migration SQL Structural Security & Operator Verification Queries
  // =========================================================================
  it("verifies migration SQL adheres strictly to all security, audit, and operator verification requirements", () => {
    const migrationPath = path.join(
      process.cwd(),
      "supabase/migrations/20260916000004_transaction_void.sql"
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, "utf-8");

    // 1. Transaction columns added
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+voided_at\s+TIMESTAMPTZ\s+NULL/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+voided_by\s+UUID\s+NULL\s+REFERENCES\s+auth\.users\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+void_reason\s+TEXT\s+NULL/i);

    // 2. Table created with ON DELETE RESTRICT
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.transaction_void_events/i);
    expect(sql).toMatch(/REFERENCES\s+public\.transactions\(id\)\s+ON\s+DELETE\s+RESTRICT/i);

    // 3. RLS enabled
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.transaction_void_events\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);

    // 4. Direct mutations strictly revoked
    expect(sql).toMatch(/REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+public\.transaction_void_events\s+FROM\s+authenticated,\s*anon/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+public\.transaction_void_events\s+TO\s+authenticated/i);

    // 5. Atomic RPCs defined with SECURITY DEFINER and search_path
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.void_transaction/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.restore_transaction/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*(pg_catalog,\s*)?public/i);

    // 6. Permissions on RPCs strictly restricted (no anon, no public)
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.void_transaction\(UUID,\s*UUID,\s*TEXT\)\s+FROM\s+PUBLIC/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.void_transaction\(UUID,\s*UUID,\s*TEXT\)\s+FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.void_transaction\(UUID,\s*UUID,\s*TEXT\)\s+TO\s+authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.void_transaction\(UUID,\s*UUID,\s*TEXT\)\s+TO\s+service_role/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.restore_transaction\(UUID,\s*UUID,\s*TEXT\)\s+FROM\s+PUBLIC/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.restore_transaction\(UUID,\s*UUID,\s*TEXT\)\s+FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.restore_transaction\(UUID,\s*UUID,\s*TEXT\)\s+TO\s+authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.restore_transaction\(UUID,\s*UUID,\s*TEXT\)\s+TO\s+service_role/i);

    // 7. Pessimistic row locking FOR UPDATE
    expect(sql).toMatch(/FOR\s+UPDATE/i);

    // 8. Cross-user ownership trigger
    expect(sql).toMatch(/validate_transaction_void_event_ownership/i);
    expect(sql).toMatch(/BEFORE\s+INSERT(\s+OR\s+UPDATE)?\s+ON\s+public\.transaction_void_events/i);

    // 9. Void-state mutation guard trigger on transactions (Requirement 1)
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.guard_transaction_void_state_mutation/i);
    expect(sql).toMatch(/trg_guard_transaction_void_state_mutation/i);
    expect(sql).toMatch(/BEFORE\s+(INSERT\s+OR\s+)?UPDATE\s+ON\s+public\.transactions/i);
    expect(sql).toMatch(/Direct modification of transaction void state.*is prohibited/i);

    // 10. Trusted local context established in void_transaction and restore_transaction RPCs
    expect(sql).toMatch(/set_config\('app\.allow_void_mutation',\s*'true',\s*true\)/i);
    expect(sql).toMatch(/set_config\('app\.allow_void_mutation',\s*'false',\s*true\)/i);

    // 11. Operator Verification SQL Queries (Requirement 3)
    expect(sql).toMatch(/Operator Verification SQL Queries/i);
    expect(sql).toMatch(/trg_guard_transaction_void_state_mutation exists on public\.transactions/i);
    expect(sql).toMatch(/void_transaction and restore_transaction RPCs exist with SECURITY DEFINER/i);
    expect(sql).toMatch(/Row Level Security enabled on public\.transaction_void_events/i);
    expect(sql).toMatch(/Direct INSERT,\s*UPDATE,\s*DELETE revoked/i);
    expect(sql).toMatch(/transaction_void_events\.transaction_id.*enforces ON DELETE RESTRICT/i);
    expect(sql).toMatch(/CASE\s+WHEN\s+passed\s+THEN\s+'PASS'\s+ELSE\s+'FAIL'\s+END/i);
  });
});
