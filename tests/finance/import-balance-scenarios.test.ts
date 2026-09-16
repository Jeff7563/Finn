import { describe, it, expect, beforeEach } from "vitest";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import { calculateAccountBalanceAt } from "@/lib/finance/balances";
import { createReconciliationSnapshot } from "@/lib/finance/reconciliation";
import { parseBankStatementCsv } from "@/lib/ingestion/csv-parser";
import { classifyIngestionMatch } from "@/lib/ingestion/deduplication";
import { Account, Transaction } from "@/types/finance";

describe("Financial & Import Balance Scenarios", () => {
  const userId = "user-alice-1111-1111-1111-111111111111";

  beforeEach(() => {
    MemoryDataStore.reset();
  });

  describe("Scenario: Historical import before baseline does not change current balance, but remains in reporting", () => {
    it("preserves authoritative baseline: imports prior to balance_as_of do NOT alter calculated balance", async () => {
      // 1. Account established on 2026-09-01 with 10,000 THB baseline
      const acc = await MemoryDataStore.createAccount(userId, {
        name: "KBANK Savings",
        type: "bank",
        opening_balance: 10000.0,
        currency: "THB",
        active: true,
        balance_as_of: "2026-09-01T00:00:00.000Z",
      });

      // 2. Import a historical statement from August 2026 (prior to baseline)
      const historicalTx1 = await MemoryDataStore.createTransaction(userId, {
        type: "expense",
        amount: 3000.0,
        currency: "THB",
        transaction_date: "2026-08-15T10:00:00.000Z",
        from_account_id: acc.id,
        description: "August Rent",
        source: "import",
      });

      const historicalTx2 = await MemoryDataStore.createTransaction(userId, {
        type: "income",
        amount: 8000.0,
        currency: "THB",
        transaction_date: "2026-08-25T14:00:00.000Z",
        to_account_id: acc.id,
        description: "August Salary",
        source: "import",
      });

      // 3. Current balance as of 2026-09-05 must be strictly evaluated using (balance_as_of, target]
      const allTransactions = await MemoryDataStore.getTransactions(userId);
      const balanceResult = calculateAccountBalanceAt(
        acc,
        allTransactions,
        "2026-09-05T00:00:00.000Z"
      );

      expect(balanceResult.status).toBe("success");
      // Opening balance 10,000 THB remains unaltered because historical transactions were before 2026-09-01!
      expect(balanceResult.balance).toBe(10000.0);
      expect(balanceResult.transaction_count).toBe(0);

      // 4. Yet both historical transactions remain accessible for reporting and audit logs
      const reportTxs = allTransactions.filter(
        (t) =>
          t.transaction_date >= "2026-08-01T00:00:00.000Z" &&
          t.transaction_date <= "2026-08-31T23:59:59.999Z"
      );
      expect(reportTxs).toHaveLength(2);
      expect(reportTxs.map((t) => t.id)).toEqual(
        expect.arrayContaining([historicalTx1.id, historicalTx2.id])
      );
    });
  });

  describe("Scenario: Post-baseline import changes balance exactly once", () => {
    it("reflects post-baseline imported transaction in current balance calculation", async () => {
      const acc = await MemoryDataStore.createAccount(userId, {
        name: "SCB Main",
        type: "bank",
        opening_balance: 5000.0,
        currency: "THB",
        active: true,
        balance_as_of: "2026-09-01T00:00:00.000Z",
      });

      // Post-baseline transaction: Sept 10 expense -1,500.00 THB
      await MemoryDataStore.createTransaction(userId, {
        type: "expense",
        amount: 1500.0,
        currency: "THB",
        transaction_date: "2026-09-10T12:00:00.000Z",
        from_account_id: acc.id,
        description: "Office Supplies",
        source: "import",
      });

      const allTxs = await MemoryDataStore.getTransactions(userId);
      const balanceResult = calculateAccountBalanceAt(
        acc,
        allTxs,
        "2026-09-15T00:00:00.000Z"
      );

      expect(balanceResult.status).toBe("success");
      // 5,000 - 1,500 = 3,500 THB
      expect(balanceResult.balance).toBe(3500.0);
      expect(balanceResult.transaction_count).toBe(1);
    });
  });

  describe("Scenario: Transfer stays transfer", () => {
    it("decrements from_account_id and increments to_account_id simultaneously without category requirement", async () => {
      const sourceAcc = await MemoryDataStore.createAccount(userId, {
        name: "KBANK Source",
        type: "bank",
        opening_balance: 10000.0,
        currency: "THB",
        active: true,
        balance_as_of: "2026-09-01T00:00:00.000Z",
      });

      const targetAcc = await MemoryDataStore.createAccount(userId, {
        name: "BBL Target",
        type: "bank",
        opening_balance: 2000.0,
        currency: "THB",
        active: true,
        balance_as_of: "2026-09-01T00:00:00.000Z",
      });

      // Execute transfer of 4,000 THB on Sept 5
      const transferTx = await MemoryDataStore.createTransaction(userId, {
        type: "transfer",
        amount: 4000.0,
        currency: "THB",
        transaction_date: "2026-09-05T10:00:00.000Z",
        from_account_id: sourceAcc.id,
        to_account_id: targetAcc.id,
        category_id: null, // Transfers do NOT require an income/expense category
        description: "Fund transfer to BBL",
        source: "import",
      });

      expect(transferTx.type).toBe("transfer");
      expect(transferTx.from_account_id).toBe(sourceAcc.id);
      expect(transferTx.to_account_id).toBe(targetAcc.id);

      const allTxs = await MemoryDataStore.getTransactions(userId);

      // Check source balance: 10,000 - 4,000 = 6,000
      const sourceBal = calculateAccountBalanceAt(sourceAcc, allTxs, "2026-09-10T00:00:00.000Z");
      expect(sourceBal.balance).toBe(6000.0);

      // Check target balance: 2,000 + 4,000 = 6,000
      const targetBal = calculateAccountBalanceAt(targetAcc, allTxs, "2026-09-10T00:00:00.000Z");
      expect(targetBal.balance).toBe(6000.0);
    });
  });

  describe("Scenario: Reconciliation exact / positive / negative difference", () => {
    it("handles balanced, positive difference (statement > calculated), and negative difference (statement < calculated)", async () => {
      const acc = await MemoryDataStore.createAccount(userId, {
        name: "KBANK Audit",
        type: "bank",
        opening_balance: 5000.0, // 500,000 Satang
        currency: "THB",
        active: true,
        balance_as_of: "2026-09-01T00:00:00.000Z",
      });

      // Case 1: Exact / Balanced (Statement = 5,000.00 THB)
      const snapExact = createReconciliationSnapshot({
        userId,
        account: acc,
        transactions: [],
        targetInstant: "2026-09-01T00:00:00.000Z",
        authoritativeBalanceSatang: 500000,
      });
      expect(snapExact.status).toBe("balanced");
      expect(snapExact.difference).toBe(0);

      // Case 2: Positive Difference (Statement = 6,000.00 THB, Calculated = 5,000.00 THB)
      // Statement has more money than Finn recorded (+1,000 THB = +100,000 Satang unrecorded deposit)
      const snapPositive = createReconciliationSnapshot({
        userId,
        account: acc,
        transactions: [],
        targetInstant: "2026-09-01T00:00:00.000Z",
        authoritativeBalanceSatang: 600000,
      });
      expect(snapPositive.status).toBe("difference_found");
      expect(snapPositive.difference).toBe(100000); // 600,000 - 500,000 = +100,000

      // Case 3: Negative Difference (Statement = 4,500.00 THB, Calculated = 5,000.00 THB)
      // Statement has less money than Finn recorded (-500 THB = -50,000 Satang unrecorded withdrawal)
      const snapNegative = createReconciliationSnapshot({
        userId,
        account: acc,
        transactions: [],
        targetInstant: "2026-09-01T00:00:00.000Z",
        authoritativeBalanceSatang: 450000,
      });
      expect(snapNegative.status).toBe("difference_found");
      expect(snapNegative.difference).toBe(-50000); // 450,000 - 500,000 = -50,000
    });
  });

  describe("Scenario: No fake adjustment transactions automatically generated", () => {
    it("creates reconciliation audit run without modifying ledger or creating synthetic adjustment transactions", async () => {
      const acc = await MemoryDataStore.createAccount(userId, {
        name: "KBANK No-Fake-Adj",
        type: "bank",
        opening_balance: 10000.0,
        currency: "THB",
        active: true,
        balance_as_of: "2026-09-01T00:00:00.000Z",
      });

      const txCountBefore = (await MemoryDataStore.getTransactions(userId)).length;

      // Create reconciliation run with discrepancy
      const snapshot = createReconciliationSnapshot({
        userId,
        account: acc,
        transactions: [],
        targetInstant: "2026-09-05T00:00:00.000Z",
        authoritativeBalanceSatang: 1200000, // 2,000 THB discrepancy
      });

      await MemoryDataStore.createReconciliationRun(userId, {
        account_id: acc.id,
        target_instant: snapshot.target_instant,
        authoritative_balance: snapshot.authoritative_balance,
        calculated_balance: snapshot.calculated_balance,
        difference: snapshot.difference,
        status: snapshot.status,
        calculation_version: snapshot.calculation_version,
      });

      // Strict check: transaction table MUST NOT have any new synthetic transaction!
      const txCountAfter = (await MemoryDataStore.getTransactions(userId)).length;
      expect(txCountAfter).toBe(txCountBefore);
    });
  });

  describe("Scenario: Duplicate CSV import idempotent", () => {
    it("detects exact duplicate CSV statements via file hash and prevents double-processing", async () => {
      const csvContent = [
        "Date,Time,Description,Withdrawal,Deposit,Balance",
        "10/09/2026,14:30:00,Transfer Out,500.00,,9500.00",
        "11/09/2026,09:15:00,Salary Deposit,,20000.00,29500.00",
      ].join("\n");

      // 1. First import
      const parsed1 = parseBankStatementCsv(csvContent, { userId });
      expect(parsed1.items).toHaveLength(2);

      const doc1 = await MemoryDataStore.createSourceDocument(userId, {
        document_type: "csv_statement",
        file_hash: parsed1.fileHash,
        status: "processed",
      });

      const items1 = await MemoryDataStore.createIngestionItems(
        userId,
        parsed1.items.map((r) => ({
          ...r,
          source_document_id: doc1.id,
        }))
      );
      expect(items1).toHaveLength(2);

      // 2. Second attempt to import identical CSV
      const parsed2 = parseBankStatementCsv(csvContent, { userId });
      const allDocs = await MemoryDataStore.getSourceDocuments(userId);

      const dedupCheck = classifyIngestionMatch({
        item: {
          id: "temp-item",
          user_id: userId,
          source_document_id: "temp-doc",
          item_type: "statement_row",
          status: "pending",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        sourceDocument: {
          id: "temp-doc",
          user_id: userId,
          document_type: "csv_statement",
          file_hash: parsed2.fileHash,
          status: "received",
          provider_metadata: {},
          received_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        existingSourceDocuments: allDocs,
      });

      // Must be classified as exact_duplicate!
      expect(dedupCheck.matchClass).toBe("exact_duplicate");
      expect(dedupCheck.confidence).toBe(1.0);
      expect(dedupCheck.reasons[0]).toContain("Identical source document file hash");
    });
  });
});
