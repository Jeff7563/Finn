import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import {
  createTransactionFromItemAction,
  rejectIngestionItemAction,
} from "@/app/actions/inbox";
import { SourceConnection, SourceDocument, IngestionItem } from "@/types/multi-source";
import { Account } from "@/types/finance";

// Mock requireUser to return test user
const userAlice = "user-alice-1111-1111-1111-111111111111";
const userBob = "user-bob-2222-2222-2222-222222222222";

vi.mock("@/lib/server/auth", () => ({
  requireUser: vi.fn(async () => ({ id: userAlice, email: "alice@example.com" })),
  getCurrentUser: vi.fn(async () => ({ id: userAlice, email: "alice@example.com" })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Phase 3 Multi-Source Atomicity & Cross-User Security Suite", () => {
  let aliceAccount: Account;
  let bobAccount: Account;
  let aliceConnection: SourceConnection;
  let bobConnection: SourceConnection;
  let aliceDoc: SourceDocument;
  let bobDoc: SourceDocument;

  beforeEach(async () => {
    MemoryDataStore.reset();

    // Setup Alice's account & connection
    aliceAccount = await MemoryDataStore.createAccount(userAlice, {
      name: "Alice Main Account",
      type: "bank",
      currency: "THB",
      opening_balance: 10000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });

    aliceConnection = await MemoryDataStore.createSourceConnection(userAlice, {
      provider: "bank_statement",
      label: "Alice KBANK",
      status: "active",
      config: {},
    });

    aliceDoc = await MemoryDataStore.createSourceDocument(userAlice, {
      connection_id: aliceConnection.id,
      document_type: "csv_statement",
      original_filename: "alice_september.csv",
      file_hash: "a".repeat(64),
      file_size: 1024,
    });

    // Setup Bob's account & connection (adversary or separate user)
    bobAccount = await MemoryDataStore.createAccount(userBob, {
      name: "Bob Savings",
      type: "bank",
      currency: "THB",
      opening_balance: 50000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });

    bobConnection = await MemoryDataStore.createSourceConnection(userBob, {
      provider: "gmail",
      label: "Bob Gmail",
      status: "active",
      config: {},
    });

    bobDoc = await MemoryDataStore.createSourceDocument(userBob, {
      connection_id: bobConnection.id,
      document_type: "email",
      original_filename: "bob_statement.eml",
      file_hash: "b".repeat(64),
      file_size: 2048,
    });
  });

  // ==========================================================================
  // 1. Rollback Atomicity Tests
  // ==========================================================================
  describe("1. Rollback Atomicity: createTransactionFromIngestionItem", () => {
    it("atomically creates transaction, evidence, and links item when data is valid", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          connection_id: aliceConnection.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "2026-09-10,Valid Row,500.00", row: 2 },
          parsed_data: {
            amount: 50000,
            amount_decimal: 500.0,
            currency: "THB",
            occurred_at: "2026-09-10T07:30:00.000Z",
            transaction_type: "expense",
            direction: "outgoing",
          },
        },
      ]);

      const result = await MemoryDataStore.createTransactionFromIngestionItem(
        userAlice,
        item.id,
        {
          type: "expense",
          amount: 500.0,
          currency: "THB",
          transaction_date: "2026-09-10T07:30:00.000Z",
          description: "Valid Row Expense",
          note: null,
          from_account_id: aliceAccount.id,
          to_account_id: null,
          category_id: null,
          source: "import",
          reference_number: null,
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        }
      );

      expect(result.transaction.id).toBeTruthy();
      expect(result.transaction.amount).toBe(500.0);
      expect(result.evidence.transaction_id).toBe(result.transaction.id);
      expect(result.evidence.ingestion_item_id).toBe(item.id);
      expect(result.item.status).toBe("linked");
      expect(result.item.matched_transaction_id).toBe(result.transaction.id);

      // Verify records in store
      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(1);
      const evs = await MemoryDataStore.getTransactionEvidence(userAlice, result.transaction.id);
      expect(evs).toHaveLength(1);
    });

    it("rolls back completely if amount is zero or negative (NO partial records)", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "zero amount" },
          parsed_data: { amount: 0 },
        },
      ]);

      await expect(
        MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
          type: "expense",
          amount: 0, // Invalid!
          currency: "THB",
          transaction_date: "2026-09-10T07:30:00.000Z",
          description: "Zero Expense",
          note: null,
          from_account_id: aliceAccount.id,
          to_account_id: null,
          category_id: null,
          source: "import",
          reference_number: null,
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        })
      ).rejects.toThrow("Invalid transaction amount");

      // Verify strict zero partial records:
      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(0);

      const refreshedItem = await MemoryDataStore.getIngestionItemById(userAlice, item.id);
      expect(refreshedItem?.status).toBe("pending");
      expect(refreshedItem?.matched_transaction_id).toBeNull();
    });

    it("rolls back completely if account does not exist or belongs to another user", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "adversarial row" },
          parsed_data: { amount: 15000 },
        },
      ]);

      // Try creating transaction linking to Bob's account
      await expect(
        MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
          type: "expense",
          amount: 150.0,
          currency: "THB",
          transaction_date: "2026-09-10T07:30:00.000Z",
          description: "Cross User Account Attempt",
          note: null,
          from_account_id: bobAccount.id, // Bob's account!
          to_account_id: null,
          category_id: null,
          source: "import",
          reference_number: null,
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        })
      ).rejects.toThrow();

      // Zero transactions created, item unchanged
      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(0);
      const refreshedItem = await MemoryDataStore.getIngestionItemById(userAlice, item.id);
      expect(refreshedItem?.status).toBe("pending");
    });
  });

  // ==========================================================================
  // 2. Cross-User Foreign Key Ownership Enforcement
  // ==========================================================================
  describe("2. Cross-User FK Ownership Enforcement", () => {
    it("rejects source_document creation with connection_id belonging to another user", async () => {
      await expect(
        MemoryDataStore.createSourceDocument(userAlice, {
          connection_id: bobConnection.id, // Bob's connection!
          document_type: "csv_statement",
          original_filename: "cross_user.csv",
        })
      ).rejects.toThrow("Cross-user integrity violation");
    });

    it("rejects import_batch creation with connection_id belonging to another user", async () => {
      await expect(
        MemoryDataStore.createImportBatch(userAlice, {
          connection_id: bobConnection.id, // Bob's connection!
          batch_type: "csv_statement",
        })
      ).rejects.toThrow("Cross-user integrity violation");
    });

    it("rejects import_batch creation with source_document_id belonging to another user", async () => {
      await expect(
        MemoryDataStore.createImportBatch(userAlice, {
          source_document_id: bobDoc.id, // Bob's document!
          batch_type: "csv_statement",
        })
      ).rejects.toThrow("Cross-user integrity violation");
    });

    it("rejects ingestion_items creation with source_document_id belonging to another user", async () => {
      await expect(
        MemoryDataStore.createIngestionItems(userAlice, [
          {
            source_document_id: bobDoc.id, // Bob's document!
            item_type: "statement_row",
          },
        ])
      ).rejects.toThrow("Cross-user integrity violation");
    });

    it("rejects reconciliation_run creation with account_id belonging to another user", async () => {
      await expect(
        MemoryDataStore.createReconciliationRun(userAlice, {
          account_id: bobAccount.id, // Bob's account!
          target_instant: "2026-09-15T00:00:00.000Z",
          authoritative_balance: 5000000,
        })
      ).rejects.toThrow("Cross-user integrity violation");
    });

    it("rejects reconciliation_run creation with source_document_id belonging to another user", async () => {
      await expect(
        MemoryDataStore.createReconciliationRun(userAlice, {
          account_id: aliceAccount.id,
          source_document_id: bobDoc.id, // Bob's document!
          target_instant: "2026-09-15T00:00:00.000Z",
          authoritative_balance: 5000000,
        })
      ).rejects.toThrow("Cross-user integrity violation");
    });
  });

  // ==========================================================================
  // 3. Fail-Closed on Incomplete Financial Data in createTransactionFromItemAction
  // ==========================================================================
  describe("3. Fail-Closed on Incomplete Financial Data in createTransactionFromItemAction", () => {
    it("fails closed when item has zero amount (does NOT fabricate amount=0 transaction)", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "zero" },
          parsed_data: {
            amount: 0,
            amount_decimal: 0,
            occurred_at: "2026-09-10T07:30:00.000Z",
            direction: "outgoing",
          },
        },
      ]);

      const result = await createTransactionFromItemAction(item.id, {
        accountId: aliceAccount.id,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing or invalid amount");

      // Verify no transaction exists
      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(0);
    });

    it("fails closed when item has missing date/time (does NOT fabricate now() timestamp)", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "missing date" },
          parsed_data: {
            amount: 15000,
            amount_decimal: 150.0,
            occurred_at: null, // Missing!
            direction: "outgoing",
          },
        },
      ]);

      const result = await createTransactionFromItemAction(item.id, {
        accountId: aliceAccount.id,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing transaction date");

      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(0);
    });

    it("fails closed when direction/type is missing (cannot determine income vs expense)", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "no direction" },
          parsed_data: {
            amount: 25000,
            amount_decimal: 250.0,
            occurred_at: "2026-09-10T07:30:00.000Z",
            direction: null, // Missing!
            transaction_type: null,
          },
        },
      ]);

      const result = await createTransactionFromItemAction(item.id, {
        accountId: aliceAccount.id,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing transaction direction or type");
    });
  });

  // ==========================================================================
  // 4. Preserve Rejected Item Raw Data
  // ==========================================================================
  describe("4. Preserve Rejected Item Raw Data", () => {
    it("preserves original raw_data when item is rejected and stores rejection reason in parsed_data", async () => {
      const originalRawData = {
        line: "2026-09-10,Dubious Transfer,999.00,REF-999",
        rowNumber: 5,
        originalColumns: ["2026-09-10", "Dubious Transfer", "999.00", "REF-999"],
      };

      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: originalRawData,
          parsed_data: {
            amount: 99900,
            amount_decimal: 999.0,
            description: "Dubious Transfer",
            reference_number: "REF-999",
          },
        },
      ]);

      const rejectResult = await rejectIngestionItemAction(
        item.id,
        "Duplicate statement from earlier bank statement batch"
      );

      expect(rejectResult.success).toBe(true);

      const refreshed = await MemoryDataStore.getIngestionItemById(userAlice, item.id);
      expect(refreshed?.status).toBe("error");

      // CRITICAL OPERATOR REQUIREMENT: raw_data MUST NOT BE OVERWRITTEN!
      expect(refreshed?.raw_data).toEqual(originalRawData);

      // Rejection reason stored in parsed_data
      expect(refreshed?.parsed_data?.rejection_reason).toBe(
        "Duplicate statement from earlier bank statement batch"
      );
      // Original parsed fields preserved
      expect(refreshed?.parsed_data?.amount).toBe(99900);
      expect(refreshed?.parsed_data?.description).toBe("Dubious Transfer");
    });
  });
});
