import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import { DataStore } from "@/lib/server/data-store";
import { importStatementCsvAction } from "@/app/actions/inbox";
import { computeSha256 } from "@/lib/ingestion/deduplication";
import { calculateAccountBalance } from "@/lib/finance/balances";
import { Account, Transaction } from "@/types/finance";

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
});
