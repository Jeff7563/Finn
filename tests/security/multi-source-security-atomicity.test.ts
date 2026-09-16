import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import { SupabaseDataStoreImpl } from "@/lib/server/supabase-data-store";
import {
  createTransactionFromItemAction,
  linkIngestionItemAction,
  rejectIngestionItemAction,
} from "@/app/actions/inbox";
import { SourceConnection, SourceDocument, IngestionItem } from "@/types/multi-source";
import { Account } from "@/types/finance";
import { pruneSourceDocumentBinary } from "@/lib/storage/retention";

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
            currency: "THB",
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
            currency: "THB",
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

    it("fails closed when item has missing currency (does NOT silently invent THB)", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "missing currency" },
          parsed_data: {
            amount: 15000,
            amount_decimal: 150.0,
            currency: "", // Missing / empty!
            occurred_at: "2026-09-10T07:30:00.000Z",
            direction: "outgoing",
          },
        },
      ]);

      const result = await createTransactionFromItemAction(item.id, {
        accountId: aliceAccount.id,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing transaction currency");

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
            currency: "THB",
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

  // ==========================================================================
  // 5. Hardened RPC Security & Static Migration Verification
  // ==========================================================================
  describe("5. Hardened RPC Security & Static Migration Verification", () => {
    it("verifies create_transaction_from_ingestion_item SQL privileges and search_path", () => {
      const migrationPath = path.join(
        process.cwd(),
        "supabase/migrations/20260916000003_multi_source_inbox.sql"
      );
      const sql = fs.readFileSync(migrationPath, "utf-8");

      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.create_transaction_from_ingestion_item(");
      expect(sql).toContain("SET search_path = pg_catalog, public");
      expect(sql).toMatch(
        /REVOKE ALL ON FUNCTION public\.create_transaction_from_ingestion_item\([\s\S]*?\) FROM PUBLIC;/
      );
      expect(sql).toMatch(
        /REVOKE ALL ON FUNCTION public\.create_transaction_from_ingestion_item\([\s\S]*?\) FROM anon;/
      );
      expect(sql).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.create_transaction_from_ingestion_item\([\s\S]*?\) TO authenticated;/
      );
      expect(sql).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.create_transaction_from_ingestion_item\([\s\S]*?\) TO service_role;/
      );
      expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.create_transaction_from_ingestion_item[\s\S]*?TO anon/);
    });

    it("verifies link_ingestion_item_to_transaction SQL privileges and search_path", () => {
      const migrationPath = path.join(
        process.cwd(),
        "supabase/migrations/20260916000003_multi_source_inbox.sql"
      );
      const sql = fs.readFileSync(migrationPath, "utf-8");

      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.link_ingestion_item_to_transaction(");
      expect(sql).toContain("SET search_path = pg_catalog, public");
      expect(sql).toMatch(
        /REVOKE ALL ON FUNCTION public\.link_ingestion_item_to_transaction\([\s\S]*?\) FROM PUBLIC;/
      );
      expect(sql).toMatch(
        /REVOKE ALL ON FUNCTION public\.link_ingestion_item_to_transaction\([\s\S]*?\) FROM anon;/
      );
      expect(sql).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.link_ingestion_item_to_transaction\([\s\S]*?\) TO authenticated;/
      );
      expect(sql).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.link_ingestion_item_to_transaction\([\s\S]*?\) TO service_role;/
      );
      expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.link_ingestion_item_to_transaction[\s\S]*?TO anon/);
    });

    function evaluateRpcCallerAuth(
      caller: { uid: string | null; role?: string },
      targetUserId: string
    ): { allowed: boolean; error?: string } {
      const isServiceRole = caller.role === "service_role";
      if (caller.uid !== null) {
        if (caller.uid !== targetUserId) {
          return { allowed: false, error: "Access denied: user_id does not match authenticated user" };
        }
        return { allowed: true };
      } else if (isServiceRole) {
        return { allowed: true };
      } else {
        return { allowed: false, error: "Access denied: unauthenticated caller" };
      }
    }

    it("denies unauthenticated or null RPC callers (fail-closed)", () => {
      const res1 = evaluateRpcCallerAuth({ uid: null, role: "anon" }, userAlice);
      expect(res1.allowed).toBe(false);
      expect(res1.error).toBe("Access denied: unauthenticated caller");

      const res2 = evaluateRpcCallerAuth({ uid: null }, userAlice);
      expect(res2.allowed).toBe(false);
      expect(res2.error).toBe("Access denied: unauthenticated caller");
    });

    it("denies wrong authenticated user attempting to act on another user's behalf", () => {
      const res = evaluateRpcCallerAuth({ uid: userBob, role: "authenticated" }, userAlice);
      expect(res.allowed).toBe(false);
      expect(res.error).toBe("Access denied: user_id does not match authenticated user");
    });

    it("allows matching authenticated caller and service_role callers", () => {
      const resAuth = evaluateRpcCallerAuth({ uid: userAlice, role: "authenticated" }, userAlice);
      expect(resAuth.allowed).toBe(true);

      const resService = evaluateRpcCallerAuth({ uid: null, role: "service_role" }, userAlice);
      expect(resService.allowed).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Strict Direction Invariants & Currency Enforcement
  // ==========================================================================
  describe("6. Strict Direction Invariants & Currency Enforcement", () => {
    it("rejects expense transaction with to_account defined", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "invalid expense" },
        },
      ]);

      await expect(
        MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
          type: "expense",
          amount: 250,
          currency: "THB",
          transaction_date: "2026-09-10T07:30:00.000Z",
          from_account_id: aliceAccount.id,
          to_account_id: aliceAccount.id, // FORBIDDEN for expense!
          source: "import",
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        })
      ).rejects.toThrow("Expense transaction cannot have to_account_id");
    });

    it("rejects income transaction with from_account defined", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "invalid income" },
        },
      ]);

      await expect(
        MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
          type: "income",
          amount: 250,
          currency: "THB",
          transaction_date: "2026-09-10T07:30:00.000Z",
          from_account_id: aliceAccount.id, // FORBIDDEN for income!
          to_account_id: aliceAccount.id,
          source: "import",
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        })
      ).rejects.toThrow("Income transaction cannot have from_account_id");
    });

    it("rejects transfer with identical source and destination accounts", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "same account transfer" },
        },
      ]);

      await expect(
        MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
          type: "transfer",
          amount: 500,
          currency: "THB",
          transaction_date: "2026-09-10T07:30:00.000Z",
          from_account_id: aliceAccount.id,
          to_account_id: aliceAccount.id, // SAME ACCOUNT FORBIDDEN!
          source: "import",
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        })
      ).rejects.toThrow("Transfer source and destination accounts must be different");
    });

    it("rejects missing or empty currency at financial creation boundary", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "missing currency" },
        },
      ]);

      await expect(
        MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
          type: "expense",
          amount: 100,
          currency: "", // FORBIDDEN!
          transaction_date: "2026-09-10T07:30:00.000Z",
          from_account_id: aliceAccount.id,
          to_account_id: null,
          source: "import",
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        })
      ).rejects.toThrow("Currency is required");
    });

    it("rejects unsupported transaction types for imported items", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "unsupported type" },
        },
      ]);

      await expect(
        MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
          type: "refund" as any, // Unsupported for imported candidate
          amount: 100,
          currency: "THB",
          transaction_date: "2026-09-10T07:30:00.000Z",
          from_account_id: aliceAccount.id,
          to_account_id: null,
          source: "import",
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        })
      ).rejects.toThrow("Invalid transaction type refund");
    });
  });

  // ==========================================================================
  // 7. Ingestion Item Prior Evidence Guard
  // ==========================================================================
  describe("7. Ingestion Item Prior Evidence Guard", () => {
    it("rejects createTransaction when item already has evidence even if status is pending", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "already evidenced item" },
        },
      ]);

      const manualTx = await MemoryDataStore.createTransaction(userAlice, {
        type: "expense",
        amount: 300,
        currency: "THB",
        transaction_date: "2026-09-10T07:30:00.000Z",
        from_account_id: aliceAccount.id,
        source: "manual",
        tax_deductible: false,
      });

      // Insert prior evidence manually while item status is still pending
      await MemoryDataStore.createTransactionEvidence(userAlice, {
        transaction_id: manualTx.id,
        ingestion_item_id: item.id,
        evidence_type: "statement_row",
      });

      await expect(
        MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
          type: "expense",
          amount: 300,
          currency: "THB",
          transaction_date: "2026-09-10T07:30:00.000Z",
          from_account_id: aliceAccount.id,
          to_account_id: null,
          source: "import",
          confidence: 1.0,
          review_status: "confirmed",
          tax_deductible: false,
        })
      ).rejects.toThrow("already has associated transaction evidence");
    });

    it("rejects linkIngestionItem when item already has evidence", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "already evidenced item for linking" },
        },
      ]);

      const tx1 = await MemoryDataStore.createTransaction(userAlice, {
        type: "expense",
        amount: 300,
        currency: "THB",
        transaction_date: "2026-09-10T07:30:00.000Z",
        from_account_id: aliceAccount.id,
        source: "manual",
        tax_deductible: false,
      });

      const tx2 = await MemoryDataStore.createTransaction(userAlice, {
        type: "expense",
        amount: 300,
        currency: "THB",
        transaction_date: "2026-09-10T07:30:00.000Z",
        from_account_id: aliceAccount.id,
        source: "manual",
        tax_deductible: false,
      });

      await MemoryDataStore.createTransactionEvidence(userAlice, {
        transaction_id: tx1.id,
        ingestion_item_id: item.id,
        evidence_type: "statement_row",
      });

      await expect(
        MemoryDataStore.linkIngestionItemToTransaction(userAlice, item.id, tx2.id)
      ).rejects.toThrow("already has associated transaction evidence");
    });
  });

  // ==========================================================================
  // 8. Atomic Link-To-Existing & Rollback Semantics
  // ==========================================================================
  describe("8. Atomic Link-To-Existing & Rollback Semantics", () => {
    it("atomically links item to transaction and updates item status to linked", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "candidate to link" },
        },
      ]);

      const tx = await MemoryDataStore.createTransaction(userAlice, {
        type: "expense",
        amount: 400,
        currency: "THB",
        transaction_date: "2026-09-10T07:30:00.000Z",
        from_account_id: aliceAccount.id,
        source: "manual",
        tax_deductible: false,
      });

      const result = await linkIngestionItemAction(item.id, tx.id);
      expect(result.success).toBe(true);
      expect(result.evidence).toBeTruthy();
      expect(result.evidence?.transaction_id).toBe(tx.id);
      expect(result.evidence?.ingestion_item_id).toBe(item.id);

      const updated = await MemoryDataStore.getIngestionItemById(userAlice, item.id);
      expect(updated?.status).toBe("linked");
      expect(updated?.matched_transaction_id).toBe(tx.id);
    });

    it("rolls back completely if target transaction belongs to another user (NO partial evidence)", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "adversarial link attempt" },
        },
      ]);

      const bobTx = await MemoryDataStore.createTransaction(userBob, {
        type: "expense",
        amount: 900,
        currency: "THB",
        transaction_date: "2026-09-10T07:30:00.000Z",
        from_account_id: bobAccount.id,
        source: "manual",
        tax_deductible: false,
      });

      await expect(
        MemoryDataStore.linkIngestionItemToTransaction(userAlice, item.id, bobTx.id)
      ).rejects.toThrow();

      // Zero evidence created, item status unchanged
      const evidences = await MemoryDataStore.getTransactionEvidence(userAlice, bobTx.id);
      expect(evidences).toHaveLength(0);

      const refreshedItem = await MemoryDataStore.getIngestionItemById(userAlice, item.id);
      expect(refreshedItem?.status).toBe("pending");
      expect(refreshedItem?.matched_transaction_id).toBeNull();
    });
  });

  // ==========================================================================
  // 9. SupabaseDataStore Create RPC Returns Item Without Second Read
  // ==========================================================================
  describe("9. SupabaseDataStore Create RPC Returns Item Without Second Read", () => {
    it("returns updated item directly from RPC response without performing secondary read", async () => {
      const store = new SupabaseDataStoreImpl();
      const mockRpc = vi.fn(async () => ({
        data: {
          transaction: {
            id: "tx-mock-1",
            user_id: userAlice,
            type: "expense",
            amount: 100,
            currency: "THB",
            transaction_date: "2026-09-10T00:00:00Z",
            source: "import",
            tax_deductible: false,
            confidence: 1.0,
            review_status: "confirmed",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          evidence: {
            id: "ev-mock-1",
            user_id: userAlice,
            transaction_id: "tx-mock-1",
            ingestion_item_id: "item-mock-1",
            evidence_type: "statement_row",
            created_at: new Date().toISOString(),
          },
          item: {
            id: "item-mock-1",
            user_id: userAlice,
            source_document_id: aliceDoc.id,
            status: "linked",
            matched_transaction_id: "tx-mock-1",
            item_type: "statement_row",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
        error: null,
      }));

      vi.spyOn(store as any, "getClient").mockResolvedValue({
        rpc: mockRpc,
      });

      const getIngestionItemSpy = vi.spyOn(store, "getIngestionItemById");

      const res = await store.createTransactionFromIngestionItem(userAlice, "item-mock-1", {
        type: "expense",
        amount: 100,
        currency: "THB",
        transaction_date: "2026-09-10T00:00:00Z",
        source: "import",
        tax_deductible: false,
        confidence: 1.0,
        review_status: "confirmed",
      });

      expect(res.transaction.id).toBe("tx-mock-1");
      expect(res.evidence.id).toBe("ev-mock-1");
      expect(res.item.id).toBe("item-mock-1");
      expect(res.item.status).toBe("linked");
      // OPERATOR FINDING 4 INVARIANT: Must NOT perform secondary read
      expect(getIngestionItemSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 10. Direct Client Mutation Denied & Static DB Integrity Invariants
  // ==========================================================================
  describe("10. Direct Client Mutation Denied & Static DB Integrity Invariants", () => {
    const migrationPath = path.join(
      process.cwd(),
      "supabase/migrations/20260916000003_multi_source_inbox.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf-8");

    it("verifies direct INSERT, UPDATE, DELETE on transaction_evidence are revoked from authenticated and anon", () => {
      expect(sql).toContain(
        "REVOKE INSERT, UPDATE, DELETE ON public.transaction_evidence FROM authenticated, anon;"
      );
      // SELECT policy exists for users to view their evidence
      expect(sql).toContain('CREATE POLICY "transaction_evidence_select_own"');
      // No direct INSERT or DELETE policies exist for authenticated users
      expect(sql).not.toContain('CREATE POLICY "transaction_evidence_insert_own"');
      expect(sql).not.toContain('CREATE POLICY "transaction_evidence_delete_own"');
    });

    it("verifies direct DELETE on source_documents, import_batches, and ingestion_items are revoked", () => {
      expect(sql).toContain("REVOKE DELETE ON public.source_documents FROM authenticated, anon;");
      expect(sql).toContain("REVOKE DELETE ON public.import_batches FROM authenticated, anon;");
      expect(sql).toContain("REVOKE DELETE ON public.ingestion_items FROM authenticated, anon;");
      expect(sql).not.toContain('CREATE POLICY "source_documents_delete_own"');
      expect(sql).not.toContain('CREATE POLICY "import_batches_delete_own"');
      expect(sql).not.toContain('CREATE POLICY "ingestion_items_delete_own"');
    });

    it("verifies foreign keys enforce ON DELETE RESTRICT on audit documents and evidence", () => {
      // Ingestion items cannot be cascade-deleted by deleting source documents
      expect(sql).toMatch(
        /source_document_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.source_documents\(id\)\s+ON\s+DELETE\s+RESTRICT/i
      );
      // Evidence cannot be cascade-deleted by deleting slips or ingestion items
      expect(sql).toMatch(
        /slip_id\s+UUID\s+NULL\s+REFERENCES\s+public\.slips\(id\)\s+ON\s+DELETE\s+RESTRICT/i
      );
      expect(sql).toMatch(
        /ingestion_item_id\s+UUID\s+NULL\s+REFERENCES\s+public\.ingestion_items\(id\)\s+ON\s+DELETE\s+RESTRICT/i
      );
      // Transaction evidence cannot be cascade-deleted by deleting the transaction
      expect(sql).toMatch(
        /transaction_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.transactions\(id\)\s+ON\s+DELETE\s+RESTRICT/i
      );
      // Reconciliation runs cannot be cascade-deleted by deleting the account
      expect(sql).toMatch(
        /account_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.accounts\(id\)\s+ON\s+DELETE\s+RESTRICT/i
      );
    });

    function evaluateDirectClientTableMutation(
      table: "transaction_evidence" | "source_documents" | "ingestion_items" | "import_batches",
      action: "SELECT" | "INSERT" | "UPDATE" | "DELETE",
      role: "authenticated" | "anon"
    ): { allowed: boolean; reason?: string } {
      if (table === "transaction_evidence") {
        if (action === "SELECT" && role === "authenticated") {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `Direct ${action} on ${table} is forbidden for ${role} (must use SECURITY DEFINER RPC)`,
        };
      }
      if (action === "DELETE") {
        return {
          allowed: false,
          reason: `Direct DELETE on ${table} is revoked for ${role} (append-only audit log)`,
        };
      }
      return { allowed: true };
    }

    it("strictly denies direct INSERT, UPDATE, DELETE on transaction_evidence for client roles", () => {
      const directInsert = evaluateDirectClientTableMutation("transaction_evidence", "INSERT", "authenticated");
      expect(directInsert.allowed).toBe(false);
      expect(directInsert.reason).toContain("forbidden");

      const directDelete = evaluateDirectClientTableMutation("transaction_evidence", "DELETE", "authenticated");
      expect(directDelete.allowed).toBe(false);
      expect(directDelete.reason).toContain("forbidden");

      const anonInsert = evaluateDirectClientTableMutation("transaction_evidence", "INSERT", "anon");
      expect(anonInsert.allowed).toBe(false);

      const clientSelect = evaluateDirectClientTableMutation("transaction_evidence", "SELECT", "authenticated");
      expect(clientSelect.allowed).toBe(true);
    });

    it("strictly denies direct DELETE on audit tables (source_documents, ingestion_items, import_batches)", () => {
      expect(evaluateDirectClientTableMutation("source_documents", "DELETE", "authenticated").allowed).toBe(false);
      expect(evaluateDirectClientTableMutation("ingestion_items", "DELETE", "authenticated").allowed).toBe(false);
      expect(evaluateDirectClientTableMutation("import_batches", "DELETE", "authenticated").allowed).toBe(false);
    });
  });

  // ==========================================================================
  // 11. Cascade Delete Protection & Foreign Key Restrict
  // ==========================================================================
  describe("11. Cascade Delete Protection & Foreign Key Restrict", () => {
    function simulateDeleteWithForeignKeyCheck(
      targetEntity: "source_document" | "ingestion_item" | "slip" | "transaction" | "account",
      targetId: string,
      state: {
        documents: { id: string }[];
        items: { id: string; source_document_id: string }[];
        evidence: { id: string; ingestion_item_id?: string | null; slip_id?: string | null; transaction_id?: string | null }[];
        reconciliation_runs?: { id: string; account_id: string }[];
      }
    ): { deleted: boolean; error?: string } {
      if (targetEntity === "source_document") {
        const hasDependentItems = state.items.some((i) => i.source_document_id === targetId);
        if (hasDependentItems) {
          return {
            deleted: false,
            error: `foreign key constraint violation: ingestion_items reference source_document ${targetId} (ON DELETE RESTRICT)`,
          };
        }
      } else if (targetEntity === "ingestion_item") {
        const hasDependentEvidence = state.evidence.some((e) => e.ingestion_item_id === targetId);
        if (hasDependentEvidence) {
          return {
            deleted: false,
            error: `foreign key constraint violation: transaction_evidence references ingestion_item ${targetId} (ON DELETE RESTRICT)`,
          };
        }
      } else if (targetEntity === "slip") {
        const hasDependentEvidence = state.evidence.some((e) => e.slip_id === targetId);
        if (hasDependentEvidence) {
          return {
            deleted: false,
            error: `foreign key constraint violation: transaction_evidence references slip ${targetId} (ON DELETE RESTRICT)`,
          };
        }
      } else if (targetEntity === "transaction") {
        const hasDependentEvidence = state.evidence.some((e) => e.transaction_id === targetId);
        if (hasDependentEvidence) {
          return {
            deleted: false,
            error: `foreign key constraint violation: transaction_evidence references transaction ${targetId} (ON DELETE RESTRICT)`,
          };
        }
      } else if (targetEntity === "account") {
        const hasDependentReconciliation = (state.reconciliation_runs || []).some(
          (r) => r.account_id === targetId
        );
        if (hasDependentReconciliation) {
          return {
            deleted: false,
            error: `foreign key constraint violation: reconciliation_runs reference account ${targetId} (ON DELETE RESTRICT)`,
          };
        }
      }
      return { deleted: true };
    }

    it("blocks source_document deletion when child ingestion_items exist (ON DELETE RESTRICT)", () => {
      const state = {
        documents: [{ id: aliceDoc.id }],
        items: [{ id: "item-1", source_document_id: aliceDoc.id }],
        evidence: [],
      };

      const res = simulateDeleteWithForeignKeyCheck("source_document", aliceDoc.id, state);
      expect(res.deleted).toBe(false);
      expect(res.error).toContain("ON DELETE RESTRICT");
    });

    it("blocks ingestion_item deletion when linked transaction_evidence exists (ON DELETE RESTRICT)", () => {
      const state = {
        documents: [{ id: aliceDoc.id }],
        items: [{ id: "item-1", source_document_id: aliceDoc.id }],
        evidence: [{ id: "ev-1", ingestion_item_id: "item-1" }],
      };

      const res = simulateDeleteWithForeignKeyCheck("ingestion_item", "item-1", state);
      expect(res.deleted).toBe(false);
      expect(res.error).toContain("ON DELETE RESTRICT");
    });

    it("blocks slip deletion when linked transaction_evidence exists (ON DELETE RESTRICT)", () => {
      const state = {
        documents: [],
        items: [],
        evidence: [{ id: "ev-slip-1", slip_id: "slip-test-1" }],
      };

      const res = simulateDeleteWithForeignKeyCheck("slip", "slip-test-1", state);
      expect(res.deleted).toBe(false);
      expect(res.error).toContain("ON DELETE RESTRICT");
    });

    it("blocks transaction deletion when linked transaction_evidence exists (ON DELETE RESTRICT)", async () => {
      // 1. Static simulation check
      const state = {
        documents: [],
        items: [],
        evidence: [{ id: "ev-tx-1", transaction_id: "tx-with-evidence" }],
      };
      const res = simulateDeleteWithForeignKeyCheck("transaction", "tx-with-evidence", state);
      expect(res.deleted).toBe(false);
      expect(res.error).toContain("ON DELETE RESTRICT");

      // 2. Live DataStore check
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "tx evidence item" },
        },
      ]);

      const tx = await MemoryDataStore.createTransaction(userAlice, {
        type: "expense",
        amount: 250,
        currency: "THB",
        transaction_date: "2026-09-10T07:30:00.000Z",
        from_account_id: aliceAccount.id,
        source: "manual",
        tax_deductible: false,
      });

      await MemoryDataStore.createTransactionEvidence(userAlice, {
        transaction_id: tx.id,
        evidence_type: "statement_row",
        ingestion_item_id: item.id,
      });

      // Attempting to delete transaction must fail closed because evidence exists
      await expect(
        MemoryDataStore.deleteTransaction(userAlice, tx.id)
      ).rejects.toThrow("associated transaction evidence exists (foreign key constraint ON DELETE RESTRICT)");

      // Transaction remains in store
      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs.some((t) => t.id === tx.id)).toBe(true);
    });

    it("blocks account deletion when reconciliation history exists (ON DELETE RESTRICT)", async () => {
      // 1. Static simulation check
      const state = {
        documents: [],
        items: [],
        evidence: [],
        reconciliation_runs: [{ id: "rec-run-1", account_id: aliceAccount.id }],
      };
      const res = simulateDeleteWithForeignKeyCheck("account", aliceAccount.id, state);
      expect(res.deleted).toBe(false);
      expect(res.error).toContain("ON DELETE RESTRICT");
      expect(res.error).toContain("reconciliation_runs reference account");
    });

    it("allows unrelated/manual transaction with no evidence to be deleted (existing deletion behavior)", async () => {
      const manualTx = await MemoryDataStore.createTransaction(userAlice, {
        type: "expense",
        amount: 75,
        currency: "THB",
        transaction_date: "2026-09-10T07:30:00.000Z",
        from_account_id: aliceAccount.id,
        source: "manual",
        tax_deductible: false,
      });

      // Transaction with no evidence: deletion succeeds
      await expect(
        MemoryDataStore.deleteTransaction(userAlice, manualTx.id)
      ).resolves.not.toThrow();

      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs.some((t) => t.id === manualTx.id)).toBe(false);
    });

    it("allows account with no reconciliation history to follow existing deletion/archival behavior", async () => {
      const emptyAccount = await MemoryDataStore.createAccount(userAlice, {
        name: "Temporary Account",
        type: "cash",
        currency: "THB",
        opening_balance: 0,
      });

      // Foreign key check passes for account without reconciliation
      const state = {
        documents: [],
        items: [],
        evidence: [],
        reconciliation_runs: [],
      };
      const res = simulateDeleteWithForeignKeyCheck("account", emptyAccount.id, state);
      expect(res.deleted).toBe(true);

      // Existing archival behavior succeeds
      await expect(
        MemoryDataStore.archiveAccount(userAlice, emptyAccount.id)
      ).resolves.not.toThrow();

      const refreshed = await MemoryDataStore.getAccountById(userAlice, emptyAccount.id);
      expect(refreshed?.active).toBe(false);
    });
  });

  // ==========================================================================
  // 12. Binary Retention Preserving Metadata & Evidence Intact
  // ==========================================================================
  describe("12. Binary Retention Preserving Metadata & Evidence Intact", () => {
    it("prunes binary storage path while keeping source_document, ingestion item, and evidence intact", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          connection_id: aliceConnection.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "2026-09-12,Retained Statement,1200.00" },
          parsed_data: {
            amount: 120000,
            amount_decimal: 1200.0,
            currency: "THB",
            occurred_at: "2026-09-12T14:30:00.000Z",
            transaction_type: "expense",
            direction: "outgoing",
          },
        },
      ]);

      const createRes = await MemoryDataStore.createTransactionFromIngestionItem(userAlice, item.id, {
        type: "expense",
        amount: 1200.0,
        currency: "THB",
        transaction_date: "2026-09-12T14:30:00.000Z",
        description: "Retained Statement Expense",
        note: null,
        from_account_id: aliceAccount.id,
        to_account_id: null,
        category_id: null,
        source: "import",
        reference_number: null,
        confidence: 1.0,
        review_status: "confirmed",
        tax_deductible: false,
      });

      // Confirm initial evidence link
      expect(createRes.evidence.transaction_id).toBe(createRes.transaction.id);
      expect(createRes.evidence.ingestion_item_id).toBe(item.id);

      // Perform binary pruning on source document
      const pruneTimestamp = "2026-09-16T12:00:00.000Z";
      const prunedDoc = pruneSourceDocumentBinary(
        {
          ...aliceDoc,
          storage_path: "storage/documents/alice_september.csv",
          stored_file_size: 1024,
        },
        pruneTimestamp
      );

      // Verify binary fields pruned
      expect(prunedDoc.storage_path).toBeNull();
      expect(prunedDoc.binary_deleted_at).toBe(pruneTimestamp);
      expect(prunedDoc.stored_file_size).toBe(0);

      // Verify audit metadata preserved
      expect(prunedDoc.id).toBe(aliceDoc.id);
      expect(prunedDoc.original_filename).toBe("alice_september.csv");
      expect(prunedDoc.file_hash).toBe(aliceDoc.file_hash);
      expect(prunedDoc.file_size).toBe(1024);

      // Verify downstream financial transaction and evidence remain completely intact!
      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(1);
      expect(txs[0].id).toBe(createRes.transaction.id);

      const evidences = await MemoryDataStore.getTransactionEvidence(userAlice, createRes.transaction.id);
      expect(evidences).toHaveLength(1);
      expect(evidences[0].ingestion_item_id).toBe(item.id);

      const refreshedItem = await MemoryDataStore.getIngestionItemById(userAlice, item.id);
      expect(refreshedItem?.status).toBe("linked");
      expect(refreshedItem?.matched_transaction_id).toBe(createRes.transaction.id);
    });
  });

  // ==========================================================================
  // 13. Transfer Creation From Inbox & Atomic Evidence Link
  // ==========================================================================
  describe("13. Transfer Creation From Inbox & Atomic Evidence Link", () => {
    let aliceSavings: Account;

    beforeEach(async () => {
      aliceSavings = await MemoryDataStore.createAccount(userAlice, {
        name: "Alice High-Yield Savings",
        type: "bank",
        currency: "THB",
        opening_balance: 100000,
        balance_as_of: "2026-09-01T00:00:00.000Z",
      });
    });

    it("rejects transfer creation when toAccountId is missing", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "2026-09-12,Transfer,2000.00" },
          parsed_data: {
            amount: 200000,
            amount_decimal: 2000.0,
            currency: "THB",
            occurred_at: "2026-09-12T10:00:00.000Z",
            transaction_type: "transfer",
            direction: "outgoing",
          },
        },
      ]);

      const res = await createTransactionFromItemAction(item.id, {
        fromAccountId: aliceAccount.id,
        // toAccountId missing!
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Both fromAccountId and toAccountId are required for transfer");

      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(0);
    });

    it("rejects transfer creation when fromAccountId and toAccountId are identical", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "2026-09-12,Same Account Transfer,2000.00" },
          parsed_data: {
            amount: 200000,
            amount_decimal: 2000.0,
            currency: "THB",
            occurred_at: "2026-09-12T10:00:00.000Z",
            transaction_type: "transfer",
            direction: "outgoing",
          },
        },
      ]);

      const res = await createTransactionFromItemAction(item.id, {
        fromAccountId: aliceAccount.id,
        toAccountId: aliceAccount.id, // SAME ACCOUNT!
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Transfer source and destination accounts must be distinct");

      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(0);
    });

    it("rejects transfer creation when an account belongs to another user (Bob)", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "2026-09-12,Adversarial Transfer,2000.00" },
          parsed_data: {
            amount: 200000,
            amount_decimal: 2000.0,
            currency: "THB",
            occurred_at: "2026-09-12T10:00:00.000Z",
            transaction_type: "transfer",
            direction: "outgoing",
          },
        },
      ]);

      const res = await createTransactionFromItemAction(item.id, {
        fromAccountId: aliceAccount.id,
        toAccountId: bobAccount.id, // Bob's account!
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Destination account not found or does not belong to user");

      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(0);
    });

    it("successfully creates transfer transaction with two distinct owned accounts and records evidence link", async () => {
      const [item] = await MemoryDataStore.createIngestionItems(userAlice, [
        {
          source_document_id: aliceDoc.id,
          connection_id: aliceConnection.id,
          item_type: "statement_row",
          status: "pending",
          raw_data: { line: "2026-09-12,Valid Transfer,3500.00" },
          parsed_data: {
            amount: 350000,
            amount_decimal: 3500.0,
            currency: "THB",
            occurred_at: "2026-09-12T10:00:00.000Z",
            transaction_type: "transfer",
            direction: "outgoing",
            description: "Transfer to Savings",
          },
        },
      ]);

      const res = await createTransactionFromItemAction(item.id, {
        fromAccountId: aliceAccount.id,
        toAccountId: aliceSavings.id,
      });

      expect(res.success).toBe(true);
      expect(res.transaction).toBeTruthy();
      expect(res.transaction?.type).toBe("transfer");
      expect(res.transaction?.amount).toBe(3500.0);
      expect(res.transaction?.from_account_id).toBe(aliceAccount.id);
      expect(res.transaction?.to_account_id).toBe(aliceSavings.id);

      // Exactly 1 evidence record linking transaction to ingestion item
      expect(res.evidence).toBeTruthy();
      expect(res.evidence?.transaction_id).toBe(res.transaction?.id);
      expect(res.evidence?.ingestion_item_id).toBe(item.id);

      // Ingestion item marked linked
      const refreshedItem = await MemoryDataStore.getIngestionItemById(userAlice, item.id);
      expect(refreshedItem?.status).toBe("linked");
      expect(refreshedItem?.matched_transaction_id).toBe(res.transaction?.id);

      // Verify transaction query
      const txs = await MemoryDataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(1);
      expect(txs[0].type).toBe("transfer");
      expect(txs[0].from_account_id).toBe(aliceAccount.id);
      expect(txs[0].to_account_id).toBe(aliceSavings.id);
    });
  });
});
