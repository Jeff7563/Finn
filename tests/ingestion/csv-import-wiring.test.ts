import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import { DataStore } from "@/lib/server/data-store";
import { importStatementCsvAction, createTransactionFromItemAction } from "@/app/actions/inbox";
import { computeSha256 } from "@/lib/ingestion/deduplication";
import { calculateAccountBalance, calculateTotalActiveBalance } from "@/lib/finance/balances";
import { Account, Transaction } from "@/types/finance";
import * as csvParser from "@/lib/ingestion/csv-parser";
import { formatBangkokDateTime, formatBangkokDate } from "@/lib/finance/formatters";

const userAlice = "user-alice-1111-1111-1111-111111111111";
const userBob = "user-bob-2222-2222-2222-222222222222";

let currentTestUser = userAlice;

vi.mock("@/lib/server/auth", () => ({
  requireUser: vi.fn(async () => ({ id: currentTestUser, email: `${currentTestUser}@example.com` })),
  getCurrentUser: vi.fn(async () => ({ id: currentTestUser, email: `${currentTestUser}@example.com` })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * Helper to construct a synthetic File object for test FormData.
 */
function createSyntheticFile(
  content: string | Buffer,
  filename: string = "statement.csv",
  mimeType: string = "text/csv"
): File {
  const part: BlobPart =
    typeof content === "string"
      ? content
      : (new Uint8Array(content) as unknown as BlobPart);
  return new File([part], filename, { type: mimeType });
}

describe("FINN — Phase 3 CSV Import Wiring (20 Required Verification Scenarios)", () => {
  let aliceAccount: Account;
  let aliceSavingsAccount: Account;
  let bobAccount: Account;

  beforeEach(async () => {
    currentTestUser = userAlice;
    MemoryDataStore.reset();

    // Create verified active test accounts
    aliceAccount = await DataStore.createAccount(userAlice, {
      name: "Alice KBANK Main",
      type: "bank",
      institution: "KBANK",
      masked_number: "x-1234",
      currency: "THB",
      opening_balance: 5000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });

    aliceSavingsAccount = await DataStore.createAccount(userAlice, {
      name: "Alice SCB Savings",
      type: "bank",
      institution: "SCB",
      masked_number: "x-5678",
      currency: "THB",
      opening_balance: 10000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });

    bobAccount = await DataStore.createAccount(userBob, {
      name: "Bob SCB Secret",
      type: "bank",
      institution: "SCB",
      masked_number: "x-9999",
      currency: "THB",
      opening_balance: 20000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });
  });

  // 1. Valid UTF-8 CSV import
  it("1. valid UTF-8 CSV import creates source_document, batch, and ingestion items", async () => {
    const csvContent = `Date,Time,Description,Withdrawal,Deposit,Reference
2026-09-10,09:00:00,Office Supplies,450.00,,REF-001
2026-09-11,14:30:00,Consulting Fee,,15000.00,REF-002`;

    const file = createSyntheticFile(csvContent, "kbank_september.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.totalItems).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);

    // Verify items in store
    const items = await DataStore.getIngestionItems(userAlice);
    expect(items).toHaveLength(2);
    expect(items[0].source_document_id).toBe(result.sourceDocumentId);
    expect(items[0].batch_id).toBe(result.batchId);
    expect(items[0].item_type).toBe("statement_row");
    expect(items[0].status).toBe("pending");
  });

  // 2. UTF-8 BOM CSV import
  it("2. UTF-8 BOM CSV import decodes safely and strips BOM character", async () => {
    const csvText = `Date,Description,Amount\n2026-09-10,Coffee Shop,-120.00\n2026-09-11,Refund,120.00`;
    const bomPrefix = Buffer.from([0xef, 0xbb, 0xbf]);
    const bomContent = Buffer.concat([bomPrefix, Buffer.from(csvText, "utf8")]);

    const file = createSyntheticFile(bomContent, "bom_statement.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.totalItems).toBe(2);

    const items = await DataStore.getIngestionItems(userAlice);
    expect(items).toHaveLength(2);
    // Ensure the BOM was stripped and description / first column parsed without corruption
    expect(items[0].parsed_data?.description).toBe("Coffee Shop");
  });

  // 3. Original byte SHA-256 remains stable
  it("3. original byte SHA-256 remains stable and matches raw uploaded bytes exactly", async () => {
    const rawBuffer = Buffer.from(`Date,Description,Amount\n2026-09-12,Test Hash,500.00`, "utf8");
    const expectedHash = computeSha256(rawBuffer);

    const file = createSyntheticFile(rawBuffer, "raw_hash.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);

    expect(result.success).toBe(true);
    const doc = await DataStore.getSourceDocumentById(userAlice, result.sourceDocumentId!);
    expect(doc?.file_hash).toBe(expectedHash);
  });

  // 4. Duplicate same file upload is idempotent
  it("4. duplicate same file upload is idempotent (returns duplicate status, creates no new doc/batch)", async () => {
    const csv = `Date,Description,Amount\n2026-09-10,Unique Payment,300.00`;
    const file1 = createSyntheticFile(csv, "my_statement.csv");
    const formData1 = new FormData();
    formData1.append("file", file1);
    formData1.append("accountId", aliceAccount.id);

    const res1 = await importStatementCsvAction(formData1);
    expect(res1.status).toBe("success");

    // Second upload of identical file
    const file2 = createSyntheticFile(csv, "my_statement.csv");
    const formData2 = new FormData();
    formData2.append("file", file2);
    formData2.append("accountId", aliceAccount.id);

    const res2 = await importStatementCsvAction(formData2);
    expect(res2.success).toBe(false);
    expect(res2.status).toBe("duplicate");
    expect(res2.existingDocumentId).toBe(res1.sourceDocumentId);

    // Verify no second document or batch was created
    const docs = await DataStore.getSourceDocuments(userAlice);
    expect(docs).toHaveLength(1);
    const batches = await DataStore.getImportBatches(userAlice);
    expect(batches).toHaveLength(1);
  });

  // 5. Failed previous same-hash import can retry safely
  it("5. failed previous same-hash import can retry safely", async () => {
    const csv = `Date,Description,Amount\n2026-09-10,Retry Row,750.00`;
    const fileBytes = Buffer.from(csv, "utf8");
    const fileHash = computeSha256(fileBytes);

    // Seed a previous failed document with the same hash
    const failedDoc = await DataStore.createSourceDocument(userAlice, {
      document_type: "csv_statement",
      original_filename: "retry.csv",
      file_hash: fileHash,
      status: "failed",
    });

    const file = createSyntheticFile(csv, "retry.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(true);
    expect(result.status).toBe("success");

    // Check that failed doc was updated to processed
    const updatedDoc = await DataStore.getSourceDocumentById(userAlice, failedDoc.id);
    expect(updatedDoc?.status).toBe("processed");
  });

  // 6. Wrong/foreign account ID rejected
  it("6. wrong/foreign account ID rejected (cross-user isolation enforced)", async () => {
    const csv = `Date,Description,Amount\n2026-09-10,Cross Account,100.00`;
    const file = createSyntheticFile(csv);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", bobAccount.id); // Bob's account passed by Alice!

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(false);
    expect(result.status).toBe("validation_error");
    expect(result.error).toContain("ไม่พบบัญชีที่เลือก หรือบัญชีไม่ได้เป็นของคุณ");

    // No documents created
    const docs = await DataStore.getSourceDocuments(userAlice);
    expect(docs).toHaveLength(0);
  });

  // 7. Inactive account rejected
  it("7. inactive account rejected", async () => {
    const inactiveAccount = await DataStore.createAccount(userAlice, {
      name: "Old Archived Account",
      type: "bank",
      currency: "THB",
      opening_balance: 0,
    });
    // Set active = false
    await DataStore.archiveAccount(userAlice, inactiveAccount.id);

    const csv = `Date,Description,Amount\n2026-09-10,Inactive Account Row,200.00`;
    const file = createSyntheticFile(csv);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", inactiveAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(false);
    expect(result.status).toBe("validation_error");
    expect(result.error).toContain("ปิดใช้งาน");
  });

  // 8. >5 MB file rejected
  it("8. >5 MB file rejected safely", async () => {
    // Create an object claiming size > 5 MB
    const largeBytes = Buffer.alloc(5 * 1024 * 1024 + 10);
    const file = createSyntheticFile(largeBytes, "large.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(false);
    expect(result.status).toBe("validation_error");
    expect(result.error).toContain("5 MB");
  });

  // 9. >10,000 rows rejected
  it("9. >10,000 rows rejected safely", async () => {
    const rows = ["Date,Description,Amount"];
    for (let i = 0; i < 10005; i++) {
      rows.push(`2026-09-10,Row ${i},10.00`);
    }
    const hugeCsv = rows.join("\n");
    const file = createSyntheticFile(hugeCsv, "overflow.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(false);
    expect(result.status).toBe("validation_error");
    expect(result.error).toContain("10,000 แถว");
  });

  // 10. Malformed financial row appears in Inbox
  it("10. malformed financial row appears in Inbox with pending status and parse_error", async () => {
    const csv = `Date,Description,Amount
2026-09-10,Normal Item,500.00
invalid-date,Missing Valid Date,100.00
2026-09-11,Zero Amount Row,0.00`;

    const file = createSyntheticFile(csv, "mixed_quality.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(true);
    expect(result.totalItems).toBe(3);
    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(2);

    const items = await DataStore.getIngestionItems(userAlice);
    expect(items).toHaveLength(3);

    // Row 2: invalid date
    const malformedDate = items.find((i) => i.parsed_data?.description === "Missing Valid Date");
    expect(malformedDate).toBeDefined();
    expect(malformedDate?.status).toBe("pending");
    expect(malformedDate?.parsed_data?.parse_error).toContain("Unparseable Bangkok date/time format");

    // Row 3: zero amount
    const malformedAmt = items.find((i) => i.parsed_data?.description === "Zero Amount Row");
    expect(malformedAmt).toBeDefined();
    expect(malformedAmt?.status).toBe("pending");
    expect(malformedAmt?.parsed_data?.parse_error).toContain("Missing or invalid non-zero transaction amount");
  });

  // 11. Bangkok timestamp preserved
  it("11. Bangkok timestamp preserved (canonical UTC instant derived from local Bangkok wall clock)", async () => {
    const csv = `Date,Time,Description,Amount
15/09/2569,14:30:00,Thai Buddhist Year Wall Clock,500.00
2026-09-15,14:30:00,Gregorian Wall Clock,600.00`;

    const file = createSyntheticFile(csv, "bangkok_time.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(true);

    const items = await DataStore.getIngestionItems(userAlice);
    expect(items).toHaveLength(2);
    // 14:30:00 Bangkok (+07:00) converts to 07:30:00.000Z in UTC
    expect(items[0].parsed_data?.occurred_at).toBe("2026-09-15T07:30:00.000Z");
    expect(items[1].parsed_data?.occurred_at).toBe("2026-09-15T07:30:00.000Z");
  });

  // 12. Historical pre-baseline row import does not change current balance
  it("12. historical pre-baseline row import does not change current balance", async () => {
    // Baseline: opening_balance = 5000 as of 2026-09-01T00:00:00.000Z
    const initialTxs = await DataStore.getTransactions(userAlice);
    const balanceBefore = calculateAccountBalance(aliceAccount, initialTxs).current_balance;
    expect(balanceBefore).toBe(5000);

    // CSV containing transactions from August 2026 (pre-baseline)
    const csv = `Date,Description,Withdrawal,Deposit
2026-08-15,Old August Expense,2000.00,
2026-08-20,Old August Income,,10000.00`;

    const file = createSyntheticFile(csv, "august_statement.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    await importStatementCsvAction(formData);

    // Crucial check: current balance MUST remain unchanged
    const txsAfter = await DataStore.getTransactions(userAlice);
    const balanceAfter = calculateAccountBalance(aliceAccount, txsAfter).current_balance;
    expect(balanceAfter).toBe(5000);
  });

  // 13. Upload creates zero Transactions
  it("13. upload creates zero Transactions (rows enter Inbox only)", async () => {
    const csv = `Date,Description,Amount\n2026-09-10,Store Purchase,-350.00\n2026-09-11,Salary,50000.00`;
    const file = createSyntheticFile(csv);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    await importStatementCsvAction(formData);

    const transactions = await DataStore.getTransactions(userAlice);
    expect(transactions).toHaveLength(0);
  });

  // 14. possible_match does not auto-link
  it("14. possible_match does not auto-link (matchedTransactionId remains null)", async () => {
    // Seed a transaction in DB with weak overlap (same amount, unverified bank)
    const existingTx = await DataStore.createTransaction(userAlice, {
      type: "expense",
      amount: 1500,
      currency: "THB",
      transaction_date: "2026-09-10T07:00:00.000Z",
      description: "Restaurant Dining",
      from_account_id: aliceAccount.id,
      source: "manual",
      confidence: 1,
      review_status: "confirmed",
    });

    // CSV with same amount and similar date, but no reference number or external ID
    const csv = `Date,Time,Description,Withdrawal
2026-09-10,14:00:00,Cafe Restaurant,1500.00`;

    const file = createSyntheticFile(csv);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    await importStatementCsvAction(formData);

    const items = await DataStore.getIngestionItems(userAlice);
    expect(items).toHaveLength(1);
    expect(items[0].match_class).toBe("possible_match");
    // DELIBERATELY NULL: weak signals require manual confirmation
    expect(items[0].matched_transaction_id).toBeNull();

    // No evidence bridge was created
    const evidence = await DataStore.getTransactionEvidence(userAlice, existingTx.id);
    expect(evidence).toHaveLength(0);
  });

  // 15. strong_match does not auto-link during CSV import
  it("15. strong_match does not auto-link during CSV import (retains candidate for user review)", async () => {
    // Existing transaction with explicit reference number and verified KBANK account
    const existingTx = await DataStore.createTransaction(userAlice, {
      type: "expense",
      amount: 2500,
      currency: "THB",
      transaction_date: "2026-09-10T07:00:00.000Z",
      description: "Flight Ticket",
      reference_number: "KBANK-FLIGHT-999",
      from_account_id: aliceAccount.id,
      source: "manual",
      confidence: 1,
      review_status: "confirmed",
    });

    const csv = `Date,Time,Description,Withdrawal,Reference
2026-09-10,14:00:00,Airline Ticket,2500.00,KBANK-FLIGHT-999`;

    const file = createSyntheticFile(csv);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    await importStatementCsvAction(formData);

    const items = await DataStore.getIngestionItems(userAlice);
    expect(items).toHaveLength(1);
    expect(items[0].match_class).toBe("strong_match");
    // Suggested candidate transaction ID is recorded for UI 1-click link
    expect(items[0].matched_transaction_id).toBe(existingTx.id);
    // But status remains PENDING and evidence bridge is NOT created yet!
    expect(items[0].status).toBe("pending");

    const evidence = await DataStore.getTransactionEvidence(userAlice, existingTx.id);
    expect(evidence).toHaveLength(0);
  });

  // 16. source_document created correctly
  it("16. source_document created with correct metadata and metadata_only storage policy", async () => {
    const csv = `Date,Description,Amount\n2026-09-10,Policy Check,100.00`;
    const file = createSyntheticFile(csv, "bank_statement_2026.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    const doc = await DataStore.getSourceDocumentById(userAlice, result.sourceDocumentId!);

    expect(doc).toBeDefined();
    expect(doc?.document_type).toBe("csv_statement");
    expect(doc?.original_filename).toBe("bank_statement_2026.csv");
    expect(doc?.file_size).toBeGreaterThan(0);
    expect(doc?.stored_file_size).toBe(0); // Binary not in bucket
    expect(doc?.storage_path).toBeNull();
    expect(doc?.status).toBe("processed");
    expect(doc?.provider_metadata?.binaryStorage).toBe("metadata_only");
    expect(doc?.provider_metadata?.statementAccountId).toBe(aliceAccount.id);
  });

  // 17. import_batch counts correct
  it("17. import_batch lifecycle and counts correct", async () => {
    const csv = `Date,Description,Amount
2026-09-10,Valid Row 1,100.00
2026-09-11,Valid Row 2,200.00
bad-date,Malformed Row,300.00`;

    const file = createSyntheticFile(csv);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    const batch = await DataStore.getImportBatchById(userAlice, result.batchId!);

    expect(batch).toBeDefined();
    expect(batch?.batch_type).toBe("csv_statement");
    expect(batch?.status).toBe("completed");
    expect(batch?.total_items).toBe(3);
    expect(batch?.success_count).toBe(2);
    expect(batch?.error_count).toBe(1);
    expect(batch?.duplicate_count).toBe(0);
    expect(batch?.completed_at).toBeTruthy();
  });

  // 18. ingestion items receive source_document_id and batch_id
  it("18. ingestion items receive source_document_id and batch_id", async () => {
    const csv = `Date,Description,Amount\n2026-09-10,Item 1,50.00\n2026-09-11,Item 2,75.00`;
    const file = createSyntheticFile(csv);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    const items = await DataStore.getIngestionItems(userAlice);

    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.source_document_id).toBe(result.sourceDocumentId);
      expect(it.batch_id).toBe(result.batchId);
      expect(it.item_type).toBe("statement_row");
    }
  });

  // 19. Empty CSV rejected safely
  it("19. empty CSV rejected safely (0 bytes or no rows)", async () => {
    // 0-byte file
    const emptyFile = createSyntheticFile(Buffer.alloc(0), "empty.csv");
    const formData = new FormData();
    formData.append("file", emptyFile);
    formData.append("accountId", aliceAccount.id);

    const result1 = await importStatementCsvAction(formData);
    expect(result1.success).toBe(false);
    expect(result1.status).toBe("validation_error");

    // CSV with only header and blank spaces
    const headerOnlyFile = createSyntheticFile("   \n\n  \n", "blank.csv");
    const formData2 = new FormData();
    formData2.append("file", headerOnlyFile);
    formData2.append("accountId", aliceAccount.id);

    const result2 = await importStatementCsvAction(formData2);
    expect(result2.success).toBe(false);
    expect(result2.status).toBe("validation_error");
  });

  // 20. Duplicate file creates no duplicate rows
  it("20. duplicate file creates no duplicate rows in database", async () => {
    const csv = `Date,Description,Amount\n2026-09-10,Idempotent Check,999.00`;
    const file = createSyntheticFile(csv, "idempotent.csv");

    const formData1 = new FormData();
    formData1.append("file", file);
    formData1.append("accountId", aliceAccount.id);
    const res1 = await importStatementCsvAction(formData1);
    expect(res1.status).toBe("success");

    const itemsAfterFirst = await DataStore.getIngestionItems(userAlice);
    expect(itemsAfterFirst).toHaveLength(1);

    // Second upload
    const formData2 = new FormData();
    formData2.append("file", file);
    formData2.append("accountId", aliceAccount.id);
    const res2 = await importStatementCsvAction(formData2);
    expect(res2.status).toBe("duplicate");

    // Total ingestion items remains 1
    const itemsAfterSecond = await DataStore.getIngestionItems(userAlice);
    expect(itemsAfterSecond).toHaveLength(1);
  });

  // Bonus test: Thai legacy Windows-874 / TIS-620 fallback decoding
  it("bonus: Thai legacy Windows-874 encoding decodes and imports correctly", async () => {
    // Encode Thai text in windows-874 using Buffer/TextDecoder
    // In windows-874: ก is 0xA1, า is 0xD2, ร is 0xC3
    const thaiDecoder = new TextDecoder("windows-874");
    // Create a byte buffer that is invalid UTF-8 but valid windows-874
    // 0xA1 is not valid UTF-8 start byte by itself
    const thaiBytes = Buffer.from([
      0x44, 0x61, 0x74, 0x65, 0x2c, 0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x69, 0x6f, 0x6e, 0x2c, 0x41, 0x6d, 0x6f, 0x75, 0x6e, 0x74, 0x0a, // Date,Description,Amount\n
      0x32, 0x30, 0x32, 0x36, 0x2d, 0x30, 0x39, 0x2d, 0x31, 0x30, 0x2c, // 2026-09-10,
      0xa1, 0xd2, 0xc3, 0x2c, // "การ",
      0x35, 0x30, 0x30, 0x2e, 0x30, 0x30 // 500.00
    ]);

    const file = createSyntheticFile(thaiBytes, "legacy_thai.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", aliceAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(true);
    expect(result.status).toBe("success");

    const items = await DataStore.getIngestionItems(userAlice);
    expect(items).toHaveLength(1);
    expect(items[0].parsed_data?.description).toBe("การ");
  });

  // =========================================================================
  // OPERATOR AUDIT FIXES: 6 CRITICAL SECTIONS
  // =========================================================================

  describe("Section 1: Failure-Injection, Fail-Closed State & Resumable Recovery", () => {
    it("1.1 parse failure marks both source_document and import_batch as failed with completed_at set, retry succeeds", async () => {
      const csv = `Date,Description,Amount\n2026-09-10,Failure Injection 1,500.00`;
      const file = createSyntheticFile(csv, "parse_fail.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      const spy = vi.spyOn(csvParser, "parseBankStatementCsv").mockImplementationOnce(() => {
        throw new Error("Catastrophic simulated parse error");
      });

      const res = await importStatementCsvAction(formData);
      spy.mockRestore();

      expect(res.success).toBe(false);
      expect(res.status).toBe("import_failure");
      expect(res.error).toContain("Catastrophic simulated parse error");

      // Verify persistent fail-closed state
      const docs = await DataStore.getSourceDocuments(userAlice);
      expect(docs).toHaveLength(1);
      expect(docs[0].status).toBe("failed");
      expect(docs[0].provider_metadata?.error).toContain("Catastrophic simulated parse error");

      const batches = await DataStore.getImportBatches(userAlice);
      expect(batches).toHaveLength(1);
      expect(batches[0].status).toBe("failed");
      expect(batches[0].completed_at).toBeTruthy();
      expect(batches[0].metadata?.error).toContain("Catastrophic simulated parse error");

      // Now retry: should detect previous failure and succeed cleanly without duplicates
      const retryRes = await importStatementCsvAction(formData);
      expect(retryRes.success).toBe(true);
      expect(retryRes.status).toBe("success");
      expect(retryRes.totalItems).toBe(1);

      const updatedDocs = await DataStore.getSourceDocuments(userAlice);
      expect(updatedDocs).toHaveLength(1);
      expect(updatedDocs[0].status).toBe("processed");

      const items = await DataStore.getIngestionItems(userAlice);
      expect(items).toHaveLength(1);
      expect(items[0].parsed_data?.description).toBe("Failure Injection 1");
    });

    it("1.2 bulk insert failure marks failed and subsequent retry succeeds without duplicate rows", async () => {
      const csv = `Date,Description,Amount\n2026-09-10,Bulk Fail 1,100.00\n2026-09-11,Bulk Fail 2,200.00`;
      const file = createSyntheticFile(csv, "bulk_fail.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      const spy = vi.spyOn(DataStore, "createIngestionItems").mockRejectedValueOnce(
        new Error("Simulated bulk insert DB error")
      );

      const res = await importStatementCsvAction(formData);
      spy.mockRestore();

      expect(res.success).toBe(false);
      expect(res.status).toBe("import_failure");

      // Both marked failed
      const docs = await DataStore.getSourceDocuments(userAlice);
      expect(docs[0].status).toBe("failed");
      const batches = await DataStore.getImportBatches(userAlice);
      expect(batches[0].status).toBe("failed");
      expect(batches[0].completed_at).toBeTruthy();

      // Retry
      const retryRes = await importStatementCsvAction(formData);
      expect(retryRes.success).toBe(true);
      expect(retryRes.totalItems).toBe(2);

      // Ingestion items have exact expected row count (2 rows, no duplicates)
      const items = await DataStore.getIngestionItems(userAlice);
      expect(items).toHaveLength(2);
    });

    it("1.3 batch completion failure marks state failed and retry recovers cleanly", async () => {
      const csv = `Date,Description,Amount\n2026-09-10,Batch Complete Fail,350.00`;
      const file = createSyntheticFile(csv, "batch_complete_fail.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      let callCount = 0;
      const originalUpdateImportBatch = DataStore.updateImportBatch.bind(DataStore);
      vi.spyOn(DataStore, "updateImportBatch").mockImplementation(async (userId, id, data) => {
        callCount++;
        // First call is completion update
        if (callCount === 1) {
          throw new Error("Simulated batch completion failure");
        }
        // Second call is fail-closed cleanup in catch
        return originalUpdateImportBatch(userId, id, data);
      });

      const res = await importStatementCsvAction(formData);
      vi.restoreAllMocks();

      expect(res.success).toBe(false);
      expect(res.status).toBe("import_failure");

      const docs = await DataStore.getSourceDocuments(userAlice);
      expect(docs[0].status).toBe("failed");
      const batches = await DataStore.getImportBatches(userAlice);
      expect(batches[0].status).toBe("failed");

      // Retry recovers cleanly
      const retryRes = await importStatementCsvAction(formData);
      expect(retryRes.success).toBe(true);
      expect(retryRes.status).toBe("success");

      const items = await DataStore.getIngestionItems(userAlice);
      expect(items).toHaveLength(1);
    });

    it("1.4 doc processed update failure marks state failed and retry recovers cleanly", async () => {
      const csv = `Date,Description,Amount\n2026-09-10,Doc Update Fail,450.00`;
      const file = createSyntheticFile(csv, "doc_update_fail.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      let docCallCount = 0;
      const originalUpdateDoc = DataStore.updateSourceDocument.bind(DataStore);
      vi.spyOn(DataStore, "updateSourceDocument").mockImplementation(async (userId, id, data) => {
        docCallCount++;
        if (docCallCount === 1) {
          throw new Error("Simulated doc processed update error");
        }
        return originalUpdateDoc(userId, id, data);
      });

      const res = await importStatementCsvAction(formData);
      vi.restoreAllMocks();

      expect(res.success).toBe(false);
      expect(res.status).toBe("import_failure");

      const docs = await DataStore.getSourceDocuments(userAlice);
      expect(docs[0].status).toBe("failed");

      // Retry recovers cleanly
      const retryRes = await importStatementCsvAction(formData);
      expect(retryRes.success).toBe(true);
      expect(retryRes.status).toBe("success");

      const items = await DataStore.getIngestionItems(userAlice);
      expect(items).toHaveLength(1);
    });
  });

  describe("Section 2: Concurrency & Idempotency Hardening", () => {
    it("simultaneous imports with same file result in exactly 1 doc, 1 item set, and duplicate/processing response for runner-up", async () => {
      const csv = `Date,Description,Amount\n2026-09-10,Concurrent Row 1,120.00\n2026-09-11,Concurrent Row 2,240.00`;
      const file1 = createSyntheticFile(csv, "concurrent.csv");
      const file2 = createSyntheticFile(csv, "concurrent.csv");

      const formData1 = new FormData();
      formData1.append("file", file1);
      formData1.append("accountId", aliceAccount.id);

      const formData2 = new FormData();
      formData2.append("file", file2);
      formData2.append("accountId", aliceAccount.id);

      // Launch both simultaneously
      const [res1, res2] = await Promise.all([
        importStatementCsvAction(formData1),
        importStatementCsvAction(formData2),
      ]);

      const successResults = [res1, res2].filter((r) => r.success && r.status === "success");
      const duplicateResults = [res1, res2].filter((r) => !r.success && r.status === "duplicate");

      expect(successResults).toHaveLength(1);
      expect(duplicateResults).toHaveLength(1);

      // Verify database invariant: exactly 1 source_document and exactly 2 ingestion_items
      const docs = await DataStore.getSourceDocuments(userAlice);
      expect(docs).toHaveLength(1);

      const items = await DataStore.getIngestionItems(userAlice);
      expect(items).toHaveLength(2);
    });
  });

  describe("Section 3: Statement Account Binding & Mismatch Validation", () => {
    it("binds statementAccountId to item raw_data and document metadata, and defaults accounts on create", async () => {
      const csv = `Date,Description,Withdrawal,Deposit
2026-09-10,Expense Item,150.00,
2026-09-11,Income Item,,800.00`;
      const file = createSyntheticFile(csv, "binding.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      const importRes = await importStatementCsvAction(formData);
      expect(importRes.success).toBe(true);

      const items = await DataStore.getIngestionItems(userAlice);
      expect(items).toHaveLength(2);

      const expenseItem = items.find((i) => i.parsed_data?.direction === "outgoing")!;
      const incomeItem = items.find((i) => i.parsed_data?.direction === "incoming")!;

      expect(expenseItem.raw_data).toMatchObject({ statementAccountId: aliceAccount.id });
      expect(incomeItem.raw_data).toMatchObject({ statementAccountId: aliceAccount.id });

      // Expense create with no account specified defaults fromAccountId to statementAccount
      const expRes = await createTransactionFromItemAction(expenseItem.id, {});
      expect(expRes.success).toBe(true);
      expect(expRes.transaction?.from_account_id).toBe(aliceAccount.id);
      expect(expRes.transaction?.to_account_id).toBeNull();
      expect(expRes.transaction?.type).toBe("expense");

      // Income create with no account specified defaults toAccountId to statementAccount
      const incRes = await createTransactionFromItemAction(incomeItem.id, {});
      expect(incRes.success).toBe(true);
      expect(incRes.transaction?.to_account_id).toBe(aliceAccount.id);
      expect(incRes.transaction?.from_account_id).toBeNull();
      expect(incRes.transaction?.type).toBe("income");
    });

    it("mismatch without confirmAccountMismatch fails closed; succeeds with confirmAccountMismatch=true", async () => {
      const csv = `Date,Description,Withdrawal\n2026-09-10,Office Supplies,300.00`;
      const file = createSyntheticFile(csv, "mismatch.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      await importStatementCsvAction(formData);
      const items = await DataStore.getIngestionItems(userAlice);
      const item = items[0];

      // Attempt to assign to aliceSavingsAccount without confirmAccountMismatch
      const failRes = await createTransactionFromItemAction(item.id, {
        fromAccountId: aliceSavingsAccount.id,
        confirmAccountMismatch: false,
      });

      expect(failRes.success).toBe(false);
      expect(failRes.error).toContain("Account mismatch");

      // Now with confirmAccountMismatch: true
      const successRes = await createTransactionFromItemAction(item.id, {
        fromAccountId: aliceSavingsAccount.id,
        confirmAccountMismatch: true,
      });

      expect(successRes.success).toBe(true);
      expect(successRes.transaction?.from_account_id).toBe(aliceSavingsAccount.id);
      expect(successRes.evidence).toBeDefined();
    });
  });

  describe("Section 4: Transfer Override Pre-Create", () => {
    it("converts withdrawal to transfer with zero net impact on total active balance and untouched parsed data", async () => {
      const csv = `Date,Description,Withdrawal\n2026-09-10,ATM Transfer Out,1000.00`;
      const file = createSyntheticFile(csv, "transfer_withdrawal.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      await importStatementCsvAction(formData);
      const items = await DataStore.getIngestionItems(userAlice);
      const item = items[0];

      // Balance before: aliceAccount=5000, aliceSavingsAccount=10000. Total = 15000.
      const initialAccounts = await DataStore.getAccounts(userAlice);
      const initialTxs = await DataStore.getTransactions(userAlice);
      const totalBefore = calculateTotalActiveBalance(initialAccounts, initialTxs);
      expect(totalBefore).toBe(15000);

      // Convert withdrawal to transfer into aliceSavingsAccount
      // Outgoing statement row defaults fromAccountId = aliceAccount. User specifies toAccountId.
      const txRes = await createTransactionFromItemAction(item.id, {
        type: "transfer",
        toAccountId: aliceSavingsAccount.id,
      });

      expect(txRes.success).toBe(true);
      expect(txRes.transaction?.type).toBe("transfer");
      expect(txRes.transaction?.from_account_id).toBe(aliceAccount.id);
      expect(txRes.transaction?.to_account_id).toBe(aliceSavingsAccount.id);
      expect(txRes.transaction?.amount).toBe(1000);

      // Verify original parsed data on the ingestion item is UNTOUCHED
      const itemAfter = await DataStore.getIngestionItemById(userAlice, item.id);
      expect(itemAfter?.parsed_data?.direction).toBe("outgoing");
      expect(itemAfter?.parsed_data?.amount).toBe(100000); // satang
      expect(itemAfter?.status).toBe("linked");

      // Verify ledger balance: aliceAccount reduced by 1000, aliceSavingsAccount increased by 1000, total remains 15000
      const txsAfter = await DataStore.getTransactions(userAlice);
      const balAlice = calculateAccountBalance(aliceAccount, txsAfter).current_balance;
      const balSavings = calculateAccountBalance(aliceSavingsAccount, txsAfter).current_balance;
      const totalAfter = calculateTotalActiveBalance(initialAccounts, txsAfter);

      expect(balAlice).toBe(4000);
      expect(balSavings).toBe(11000);
      expect(totalAfter).toBe(15000); // Net 0 impact on total balance
    });

    it("converts deposit to transfer with statementAccount as destination", async () => {
      const csv = `Date,Description,Deposit\n2026-09-10,Transfer In,2000.00`;
      const file = createSyntheticFile(csv, "transfer_deposit.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      await importStatementCsvAction(formData);
      const items = await DataStore.getIngestionItems(userAlice);
      const item = items[0];

      // Convert deposit to transfer from aliceSavingsAccount
      // Incoming statement row defaults toAccountId = aliceAccount. User specifies fromAccountId.
      const txRes = await createTransactionFromItemAction(item.id, {
        type: "transfer",
        fromAccountId: aliceSavingsAccount.id,
      });

      expect(txRes.success).toBe(true);
      expect(txRes.transaction?.type).toBe("transfer");
      expect(txRes.transaction?.from_account_id).toBe(aliceSavingsAccount.id);
      expect(txRes.transaction?.to_account_id).toBe(aliceAccount.id);
      expect(txRes.transaction?.amount).toBe(2000);
    });

    it("fails closed if transfer source and destination accounts are identical", async () => {
      const csv = `Date,Description,Withdrawal\n2026-09-10,Self Loop,500.00`;
      const file = createSyntheticFile(csv, "self_transfer.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      await importStatementCsvAction(formData);
      const items = await DataStore.getIngestionItems(userAlice);
      const item = items[0];

      const res = await createTransactionFromItemAction(item.id, {
        type: "transfer",
        fromAccountId: aliceAccount.id,
        toAccountId: aliceAccount.id,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("distinct");
    });

    it("fails closed if either transfer account is inactive", async () => {
      // Archive aliceSavingsAccount
      await DataStore.archiveAccount(userAlice, aliceSavingsAccount.id);

      const csv = `Date,Description,Withdrawal\n2026-09-10,Inactive Transfer,500.00`;
      const file = createSyntheticFile(csv, "inactive_transfer.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      await importStatementCsvAction(formData);
      const items = await DataStore.getIngestionItems(userAlice);
      const item = items[0];

      const res = await createTransactionFromItemAction(item.id, {
        type: "transfer",
        toAccountId: aliceSavingsAccount.id,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("inactive");
    });
  });

  describe("Section 5: Exact Duplicate Blocks Transaction Creation", () => {
    it("fails closed and prevents creating transaction for item with match_class exact_duplicate", async () => {
      const csv = `Date,Description,Amount\n2026-09-10,Duplicate Item,1000.00`;
      const file = createSyntheticFile(csv, "duplicate_block.csv");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", aliceAccount.id);

      await importStatementCsvAction(formData);
      const items = await DataStore.getIngestionItems(userAlice);
      const item = items[0];

      // Mark item as exact_duplicate
      await DataStore.updateIngestionItem(userAlice, item.id, {
        match_class: "exact_duplicate",
      });

      const res = await createTransactionFromItemAction(item.id, {});
      expect(res.success).toBe(false);
      expect(res.error).toContain("exact duplicate");

      // Verify no transaction was created
      const txs = await DataStore.getTransactions(userAlice);
      expect(txs).toHaveLength(0);
    });
  });

  describe("Section 6: Bangkok Display Time (UTC+7 Formatting)", () => {
    it("formats ISO timestamps strictly to Asia/Bangkok wall clock regardless of environment timezone", () => {
      // 07:30 UTC = 14:30 Bangkok (UTC+7)
      const utcIso = "2026-09-15T07:30:00.000Z";

      const dateTimeStr = formatBangkokDateTime(utcIso);
      // Bangkok is UTC+7 -> 14:30
      expect(dateTimeStr).toContain("14:30");
      expect(dateTimeStr).toContain("15");

      const dateStr = formatBangkokDate(utcIso);
      expect(dateStr).toContain("15");

      // Requirement explicit check: 2026-09-16T00:30:00Z displays as 07:30 Bangkok time, not 00:30 UTC
      const promptExample = "2026-09-16T00:30:00Z";
      const promptFormatted = formatBangkokDateTime(promptExample);
      expect(promptFormatted).toContain("07:30");
      expect(promptFormatted).not.toContain("00:30");

      // Midnight UTC (00:00 UTC) = 07:00 Bangkok same day
      const midnightUtc = "2026-09-15T00:00:00.000Z";
      expect(formatBangkokDateTime(midnightUtc)).toContain("07:00");

      // Late night UTC (19:00 UTC) = 02:00 next day (16th) in Bangkok!
      const lateUtc = "2026-09-15T19:00:00.000Z";
      expect(formatBangkokDateTime(lateUtc)).toContain("02:00");
      expect(formatBangkokDate(lateUtc)).toContain("16");
    });
  });
});
