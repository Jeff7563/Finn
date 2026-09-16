import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateAccountBalanceAt,
} from "@/lib/finance/balances";
import {
  createReconciliationSnapshot,
  thbToSatang,
  satangToTHB,
} from "@/lib/finance/reconciliation";
import { Account, Transaction } from "@/types/finance";
import { MemoryDataStore } from "@/lib/server/memory-data-store";

describe("Decision 4: Reconciliation Runs Are Audit Snapshots", () => {
  const userId = "user-alice-1111-1111-1111-111111111111";

  const baselineAccount: Account = {
    id: "acc-rec-kbank",
    user_id: userId,
    name: "KBANK Current",
    type: "bank",
    opening_balance: 10000.0, // 10,000 THB baseline
    currency: "THB",
    active: true,
    balance_as_of: "2026-09-01T00:00:00.000Z", // Baseline instant
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };

  const defaultTxProps = {
    tax_deductible: false,
    confidence: 1.0,
    review_status: "confirmed" as const,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };

  const sampleTransactions: Transaction[] = [
    // TX0: exactly at baseline (MUST NOT affect balance)
    {
      ...defaultTxProps,
      id: "tx-at-baseline",
      user_id: userId,
      type: "income",
      amount: 5000.0,
      currency: "THB",
      transaction_date: "2026-09-01T00:00:00.000Z",
      to_account_id: baselineAccount.id,
      source: "manual",
    },
    // TX1: 2026-09-05 income +2,500.50
    {
      ...defaultTxProps,
      id: "tx-1",
      user_id: userId,
      type: "income",
      amount: 2500.5,
      currency: "THB",
      transaction_date: "2026-09-05T10:00:00.000Z",
      to_account_id: baselineAccount.id,
      source: "manual",
    },
    // TX2: 2026-09-10 expense -1,000.00
    {
      ...defaultTxProps,
      id: "tx-2",
      user_id: userId,
      type: "expense",
      amount: 1000.0,
      currency: "THB",
      transaction_date: "2026-09-10T15:30:00.000Z",
      from_account_id: baselineAccount.id,
      source: "slip",
    },
    // TX3: 2026-09-15 expense -500.25
    {
      ...defaultTxProps,
      id: "tx-3",
      user_id: userId,
      type: "expense",
      amount: 500.25,
      currency: "THB",
      transaction_date: "2026-09-15T18:00:00.000Z",
      from_account_id: baselineAccount.id,
      source: "manual",
    },
    // TX4: 2026-09-20 income +10,000.00 (in future relative to target)
    {
      ...defaultTxProps,
      id: "tx-4",
      user_id: userId,
      type: "income",
      amount: 10000.0,
      currency: "THB",
      transaction_date: "2026-09-20T12:00:00.000Z",
      to_account_id: baselineAccount.id,
      source: "manual",
    },
  ];

  beforeEach(() => {
    MemoryDataStore.reset();
  });

  // ==========================================================================
  // calculateAccountBalanceAt Semantics
  // ==========================================================================
  describe("calculateAccountBalanceAt Semantics", () => {
    it("target == balance_as_of -> exactly opening_balance", () => {
      // At the exact baseline instant, no post-baseline transactions have occurred yet
      const res = calculateAccountBalanceAt(
        baselineAccount,
        sampleTransactions,
        "2026-09-01T00:00:00.000Z"
      );

      expect(res.status).toBe("success");
      expect(res.balance).toBe(10000.0); // Exactly opening_balance
      expect(res.transaction_count).toBe(0);
    });

    it("target > balance_as_of -> opening_balance + transactions in (balance_as_of, target]", () => {
      // Target: 2026-09-12T00:00:00.000Z
      // Eligible transactions: TX1 (+2,500.50) and TX2 (-1,000.00)
      // TX0 is excluded (at baseline)
      // TX3 is excluded (after target on Sept 15)
      // TX4 is excluded (after target on Sept 20)
      // Expected balance = 10,000 + 2,500.50 - 1,000.00 = 11,500.50
      const res = calculateAccountBalanceAt(
        baselineAccount,
        sampleTransactions,
        "2026-09-12T00:00:00.000Z"
      );

      expect(res.status).toBe("success");
      expect(res.balance).toBe(11500.5);
      expect(res.transaction_count).toBe(2);
    });

    it("target includes boundary transaction: (balance_as_of, target] inclusive upper bound", () => {
      // Target: exactly at TX3 timestamp (2026-09-15T18:00:00.000Z)
      // Upper bound is inclusive, so TX3 (-500.25) is included
      // Expected = 11,500.50 - 500.25 = 11,000.25
      const res = calculateAccountBalanceAt(
        baselineAccount,
        sampleTransactions,
        "2026-09-15T18:00:00.000Z"
      );

      expect(res.status).toBe("success");
      expect(res.balance).toBe(11000.25);
      expect(res.transaction_count).toBe(3);
    });

    it("target < balance_as_of -> cannot_calculate_safely (No fake reconstruction)", () => {
      // Prior to baseline instant: Finn refuses to fake-extrapolate backwards
      const res = calculateAccountBalanceAt(
        baselineAccount,
        sampleTransactions,
        "2026-08-15T00:00:00.000Z" // Before balance_as_of!
      );

      expect(res.status).toBe("cannot_calculate_safely");
      expect(res.balance).toBeNull();
      expect(res.reason).toContain("earlier than authoritative baseline");
    });

    it("legacy account without balance_as_of -> preserves legacy calculation (opening_balance + sum up to target)", () => {
      const legacyAccount: Account = {
        ...baselineAccount,
        opening_balance: 10000.0,
        balance_as_of: null, // Legacy account without baseline
      };

      // On or before 2026-09-10T00:00:00.000Z:
      // opening (10000) + tx-at-baseline (5000) + tx-1 (2500.50) = 17,500.50 THB
      const res = calculateAccountBalanceAt(
        legacyAccount,
        sampleTransactions,
        "2026-09-10T00:00:00.000Z"
      );

      expect(res.status).toBe("success");
      expect(res.balance).toBe(17500.5);
      expect(res.transaction_count).toBe(2);
    });

    it("fails closed with cannot_calculate_safely when any transaction linked to account has invalid date", () => {
      const corruptTxs: Transaction[] = [
        ...sampleTransactions,
        {
          id: "tx-corrupt-date",
          user_id: userId,
          type: "expense",
          amount: 100,
          currency: "THB",
          transaction_date: "invalid-garbage-date",
          from_account_id: baselineAccount.id,
          to_account_id: null,
          category_id: null,
          source: "manual",
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const res = calculateAccountBalanceAt(
        baselineAccount,
        corruptTxs,
        "2026-09-12T00:00:00.000Z"
      );

      expect(res.status).toBe("cannot_calculate_safely");
      expect(res.balance).toBeNull();
      expect(res.reason).toContain("unparseable transaction_date");
    });
  });

  // ==========================================================================
  // createReconciliationSnapshot & Statuses
  // ==========================================================================
  describe("createReconciliationSnapshot & Status Determination", () => {
    it("creates 'balanced' snapshot when calculated_balance == authoritative_balance", () => {
      // Target Sept 12: calculated balance is 11,500.50 THB = 1,150,050 Satang
      const targetInstant = "2026-09-12T00:00:00.000Z";
      const authoritativeSatang = 1150050; // Bank statement says 11,500.50 THB

      const snapshot = createReconciliationSnapshot({
        userId,
        account: baselineAccount,
        transactions: sampleTransactions,
        targetInstant,
        authoritativeBalanceSatang: authoritativeSatang,
        sourceDocumentId: "stmt-doc-123",
      });

      expect(snapshot.status).toBe("balanced");
      expect(snapshot.authoritative_balance).toBe(authoritativeSatang);
      expect(snapshot.calculated_balance).toBe(authoritativeSatang);
      expect(snapshot.difference).toBe(0);
      expect(snapshot.calculation_version).toBe(1);
      expect(snapshot.source_document_id).toBe("stmt-doc-123");
    });

    it("creates 'difference_found' snapshot when calculated_balance != authoritative_balance", () => {
      // Statement reports 12,000.00 THB but Finn calculates 11,500.50 THB
      const targetInstant = "2026-09-12T00:00:00.000Z";
      const authoritativeSatang = 1200000; // 12,000.00 THB

      const snapshot = createReconciliationSnapshot({
        userId,
        account: baselineAccount,
        transactions: sampleTransactions,
        targetInstant,
        authoritativeBalanceSatang: authoritativeSatang,
      });

      expect(snapshot.status).toBe("difference_found");
      expect(snapshot.authoritative_balance).toBe(1200000);
      expect(snapshot.calculated_balance).toBe(1150050);
      expect(snapshot.difference).toBe(1200000 - 1150050); // 49,950 Satang discrepancy
    });

    it("creates 'cannot_calculate_safely' snapshot when target < balance_as_of", () => {
      const snapshot = createReconciliationSnapshot({
        userId,
        account: baselineAccount,
        transactions: sampleTransactions,
        targetInstant: "2026-08-01T00:00:00.000Z", // Prior to baseline
        authoritativeBalanceSatang: 500000,
      });

      expect(snapshot.status).toBe("cannot_calculate_safely");
      expect(snapshot.authoritative_balance).toBe(500000);
      expect(snapshot.calculated_balance).toBeNull();
      expect(snapshot.difference).toBeNull();
      expect(snapshot.note).toContain("Calculation reason");
    });
  });

  // ==========================================================================
  // Audit Snapshot Immutability
  // ==========================================================================
  describe("Audit Snapshot Immutability (Preserves what Finn knew at that moment)", () => {
    it("never recomputes or overwrites old reconciliation runs when transactions later change", async () => {
      // 0. Create account in DataStore
      const acc = await MemoryDataStore.createAccount(userId, {
        name: baselineAccount.name,
        type: baselineAccount.type,
        opening_balance: baselineAccount.opening_balance,
        currency: baselineAccount.currency,
        active: baselineAccount.active,
        balance_as_of: baselineAccount.balance_as_of,
      });

      // 1. Initial reconciliation run recorded in DataStore
      const initialRun = await MemoryDataStore.createReconciliationRun(userId, {
        account_id: acc.id,
        target_instant: "2026-09-12T00:00:00.000Z",
        authoritative_balance: 1150050,
        calculated_balance: 1150050,
        difference: 0,
        status: "balanced",
        calculation_version: 1,
        note: "September mid-month reconciliation",
      });

      // Verify stored snapshot
      const storedRuns = await MemoryDataStore.getReconciliationRuns(userId, acc.id);
      expect(storedRuns).toHaveLength(1);
      expect(storedRuns[0].status).toBe("balanced");
      expect(storedRuns[0].calculated_balance).toBe(1150050);

      // 2. A transaction is subsequently inserted in the historical period!
      await MemoryDataStore.createTransaction(userId, {
        type: "expense",
        amount: 200.0,
        currency: "THB",
        transaction_date: "2026-09-08T10:00:00.000Z", // Backdated inside the window!
        from_account_id: acc.id,
        source: "manual",
      });

      // 3. The historical reconciliation run MUST REMAIN UNTOUCHED (audit snapshot)
      const auditCheck = await MemoryDataStore.getReconciliationRuns(userId, acc.id);
      expect(auditCheck).toHaveLength(1);
      expect(auditCheck[0].id).toBe(initialRun.id);
      expect(auditCheck[0].status).toBe("balanced"); // Still 'balanced' as of what Finn knew then!
      expect(auditCheck[0].calculated_balance).toBe(1150050); // Snapshot is frozen!

      // 4. A new reconciliation creates a NEW run, never overwriting the old run
      const newRun = await MemoryDataStore.createReconciliationRun(userId, {
        account_id: acc.id,
        target_instant: "2026-09-12T00:00:00.000Z",
        authoritative_balance: 1150050,
        calculated_balance: 1130050, // Reflects the backdated 200 THB expense
        difference: 20000,
        status: "difference_found",
        calculation_version: 1,
        note: "Re-run after backdated transaction discovered",
      });

      // Verify 2 distinct runs exist in audit history
      const finalRuns = await MemoryDataStore.getReconciliationRuns(userId, acc.id);
      expect(finalRuns).toHaveLength(2);

      // Old run #1 remains preserved
      const run1 = finalRuns.find((r) => r.id === initialRun.id);
      expect(run1?.status).toBe("balanced");
      expect(run1?.calculated_balance).toBe(1150050);

      // New run #2 captures the discrepancy
      const run2 = finalRuns.find((r) => r.id === newRun.id);
      expect(run2?.status).toBe("difference_found");
      expect(run2?.difference).toBe(20000);
    });
  });

  describe("Satang <-> THB Conversion Helpers", () => {
    it("converts between Satang and THB accurately without floating point drift", () => {
      expect(thbToSatang(150.75)).toBe(15075);
      expect(thbToSatang(0.1)).toBe(10);
      expect(thbToSatang(1000000.0)).toBe(100000000);

      expect(satangToTHB(15075)).toBe(150.75);
      expect(satangToTHB(10)).toBe(0.1);
      expect(satangToTHB(100000000)).toBe(1000000.0);
    });
  });
});
