import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import { DataStore } from "@/lib/server/data-store";
import { importStatementCsvAction } from "@/app/actions/inbox";
import { calculateAccountBalance } from "@/lib/finance/balances";
import { Account } from "@/types/finance";

const testUserId = "user-csv-zero-row-1111-111111111111";

vi.mock("@/lib/server/auth", () => ({
  requireUser: vi.fn(async () => ({ id: testUserId, email: "user@example.com" })),
  getCurrentUser: vi.fn(async () => ({ id: testUserId, email: "user@example.com" })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

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

describe("FINN — CSV Zero-Row Import Fix & Fail-Closed Suite", () => {
  let testAccount: Account;

  beforeEach(async () => {
    MemoryDataStore.reset();

    testAccount = await DataStore.createAccount(testUserId, {
      name: "KBANK Test Account",
      type: "bank",
      institution: "KBANK",
      masked_number: "x-1234",
      currency: "THB",
      opening_balance: 5000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });
  });

  // 1. Valid CSV (header + 2 rows) imports successfully with totalItems = 2
  it("1. valid CSV (header + 2 rows) imports successfully with totalItems = 2", async () => {
    const csvContent = `Date,Time,Description,Withdrawal,Deposit,Reference
2026-09-10,09:00:00,Office Supplies,450.00,,REF-001
2026-09-11,14:30:00,Consulting Fee,,15000.00,REF-002`;

    const file = createSyntheticFile(csvContent, "valid_statement.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    const result = await importStatementCsvAction(formData);

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.totalItems).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);

    const doc = await DataStore.getSourceDocumentById(testUserId, result.sourceDocumentId!);
    expect(doc?.status).toBe("processed");

    const batch = await DataStore.getImportBatchById(testUserId, result.batchId!);
    expect(batch?.status).toBe("completed");
    expect(batch?.total_items).toBe(2);
  });

  // 2. Malformed CSV where each line is a single quoted cell fails closed
  it("2. malformed CSV where each line is a single quoted cell fails closed", async () => {
    // Malformed where entire line is enclosed in quotes so splitCsvRow yields 1 item per line
    const malformedCsv = `"Date,Time,Description,Withdrawal,Deposit,Reference"
"2026-09-10,09:00:00,Office Supplies,450.00,,REF-001"
"2026-09-11,14:30:00,Consulting Fee,,15000.00,REF-002"`;

    const file = createSyntheticFile(malformedCsv, "malformed_single_cell.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    const result = await importStatementCsvAction(formData);

    expect(result.success).toBe(false);
    expect(result.status).toBe("import_failure");
    expect(result.totalItems).toBe(0);
    expect(result.error).toContain("ไม่พบรายการธุรกรรมในไฟล์ CSV");

    const doc = await DataStore.getSourceDocumentById(testUserId, result.sourceDocumentId!);
    expect(doc?.status).toBe("failed");
    expect((doc?.provider_metadata as Record<string, unknown>)?.failureCode).toBe("MALFORMED_CSV_STRUCTURE");

    const batch = await DataStore.getImportBatchById(testUserId, result.batchId!);
    expect(batch?.status).toBe("failed");
    expect((batch?.metadata as Record<string, unknown>)?.failureCode).toBe("MALFORMED_CSV_STRUCTURE");
  });

  // 3. Header-only CSV with no data rows fails closed
  it("3. header-only CSV with no data rows fails closed", async () => {
    const headerOnlyCsv = `Date,Time,Description,Withdrawal,Deposit,Reference\n`;

    const file = createSyntheticFile(headerOnlyCsv, "header_only.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    const result = await importStatementCsvAction(formData);

    expect(result.success).toBe(false);
    expect(result.status).toBe("import_failure");
    expect(result.totalItems).toBe(0);
    expect(result.error).toContain("ไม่พบรายการธุรกรรมในไฟล์ CSV");

    const doc = await DataStore.getSourceDocumentById(testUserId, result.sourceDocumentId!);
    expect(doc?.status).toBe("failed");
    expect((doc?.provider_metadata as Record<string, unknown>)?.failureCode).toBe("HEADER_ONLY");

    const batch = await DataStore.getImportBatchById(testUserId, result.batchId!);
    expect(batch?.status).toBe("failed");
    expect((batch?.metadata as Record<string, unknown>)?.failureCode).toBe("HEADER_ONLY");
  });

  // 4. Blank CSV fails closed
  it("4. blank CSV fails closed", async () => {
    // 0-byte file
    const emptyFile = createSyntheticFile("", "empty.csv");
    const formData1 = new FormData();
    formData1.append("file", emptyFile);
    formData1.append("accountId", testAccount.id);

    const result1 = await importStatementCsvAction(formData1);
    expect(result1.success).toBe(false);
    expect(result1.status).toBe("validation_error");

    // All whitespace / blank lines
    const blankLinesFile = createSyntheticFile("   \n\r\n   \n", "blank_lines.csv");
    const formData2 = new FormData();
    formData2.append("file", blankLinesFile);
    formData2.append("accountId", testAccount.id);

    const result2 = await importStatementCsvAction(formData2);
    expect(result2.success).toBe(false);
    expect(result2.status).toBe("validation_error");
    expect(result2.error).toContain("ไฟล์ CSV ว่างเปล่า");
  });

  // 5. Malformed financial row with valid header & rows still parses rows into review items
  it("5. malformed financial row with valid header & rows parses into review items instead of zero-row failure", async () => {
    // 1 valid row + 1 row with unparseable corrupt date
    const partialMalformedCsv = `Date,Time,Description,Withdrawal,Deposit,Reference
2026-09-10,09:00:00,Office Supplies,450.00,,REF-001
not-a-real-date,bad-time,Corrupted Transaction,invalid_amount,,REF-002`;

    const file = createSyntheticFile(partialMalformedCsv, "partial_corrupted.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    const result = await importStatementCsvAction(formData);

    // Because rows WERE parsed, it reports success with errorCount = 1 (review items)
    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.totalItems).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(1);

    const items = await DataStore.getIngestionItems(testUserId);
    expect(items.length).toBe(2);
    const errItem = items.find((it) => it.parsed_data?.parse_error);
    expect(errItem).toBeDefined();
  });

  // 6. Zero-row failure creates 0 transactions in public.transactions
  it("6. zero-row failure creates 0 transactions in public.transactions", async () => {
    const malformedCsv = `"Date,Time,Description,Withdrawal,Deposit"
"single quoted cell"`;

    const file = createSyntheticFile(malformedCsv, "malformed.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(false);

    const transactions = await DataStore.getTransactions(testUserId);
    expect(transactions.length).toBe(0);
  });

  // 7. Zero-row failure creates 0 ingestion items
  it("7. zero-row failure creates 0 ingestion items", async () => {
    const headerOnlyCsv = `Date,Time,Description,Withdrawal,Deposit\n`;

    const file = createSyntheticFile(headerOnlyCsv, "header_only.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(false);

    const items = await DataStore.getIngestionItems(testUserId);
    expect(items.length).toBe(0);
  });

  // 8. Zero-row failure leaves account balance untouched
  it("8. zero-row failure leaves account balance untouched", async () => {
    const initialTxs = await DataStore.getTransactions(testUserId);
    const balanceBefore = calculateAccountBalance(testAccount, initialTxs);
    expect(balanceBefore.current_balance).toBe(5000);

    const malformedCsv = `"Date,Time,Description,Withdrawal,Deposit"
"quoted line"`;

    const file = createSyntheticFile(malformedCsv, "malformed.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    await importStatementCsvAction(formData);

    const txsAfter = await DataStore.getTransactions(testUserId);
    const balanceAfter = calculateAccountBalance(testAccount, txsAfter);
    expect(balanceAfter.current_balance).toBe(5000);
    expect(balanceAfter.current_balance).toBe(balanceBefore.current_balance);
  });

  // 9. Failed source_document has status = "failed" with failure metadata
  it("9. failed source_document has status = 'failed' with failure metadata", async () => {
    const malformedCsv = `"Date,Time,Description,Withdrawal,Deposit"
"bad line 1"
"bad line 2"`;

    const file = createSyntheticFile(malformedCsv, "doc_failure_test.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(false);

    const doc = await DataStore.getSourceDocumentById(testUserId, result.sourceDocumentId!);
    expect(doc).toBeDefined();
    expect(doc?.status).toBe("failed");
    const meta = doc?.provider_metadata as Record<string, unknown>;
    expect(meta.failureCode).toBe("MALFORMED_CSV_STRUCTURE");
    expect(meta.failedAt).toBeDefined();
    expect(meta.parsedRowCount).toBe(0);
  });

  // 10. Failed import_batch has status = "failed" with failure metadata
  it("10. failed import_batch has status = 'failed' with failure metadata", async () => {
    const malformedCsv = `Date,Time,Description,Withdrawal,Deposit\n`;

    const file = createSyntheticFile(malformedCsv, "batch_failure_test.csv");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountId", testAccount.id);

    const result = await importStatementCsvAction(formData);
    expect(result.success).toBe(false);

    const batch = await DataStore.getImportBatchById(testUserId, result.batchId!);
    expect(batch).toBeDefined();
    expect(batch?.status).toBe("failed");
    expect(batch?.completed_at).toBeDefined();
    expect(batch?.total_items).toBe(0);
    expect(batch?.error_count).toBe(1);
    const meta = batch?.metadata as Record<string, unknown>;
    expect(meta.failureCode).toBe("HEADER_ONLY");
    expect(meta.parsedRowCount).toBe(0);
  });

  // 11. Re-uploading the exact same malformed file does NOT report duplicate success; retries safely and fails closed again
  it("11. re-uploading the exact same malformed file retries safely and fails closed again without fake duplicate success", async () => {
    const malformedCsv = `"Date,Time,Description,Withdrawal,Deposit"
"single quoted cell"`;

    const file1 = createSyntheticFile(malformedCsv, "retry_test.csv");
    const formData1 = new FormData();
    formData1.append("file", file1);
    formData1.append("accountId", testAccount.id);

    // First attempt fails closed
    const res1 = await importStatementCsvAction(formData1);
    expect(res1.success).toBe(false);
    expect(res1.status).toBe("import_failure");

    // Second attempt with exact same malformed file
    const file2 = createSyntheticFile(malformedCsv, "retry_test.csv");
    const formData2 = new FormData();
    formData2.append("file", file2);
    formData2.append("accountId", testAccount.id);

    const res2 = await importStatementCsvAction(formData2);
    // MUST NOT report duplicate or success
    expect(res2.success).toBe(false);
    expect(res2.status).toBe("import_failure");
    expect(res2.status).not.toBe("duplicate");
    expect(res2.totalItems).toBe(0);

    // Source document remains failed
    const doc = await DataStore.getSourceDocumentById(testUserId, res2.sourceDocumentId!);
    expect(doc?.status).toBe("failed");
  });

  // 12. Uploading a corrected statement with different bytes succeeds normally
  it("12. uploading a corrected statement with different bytes succeeds normally", async () => {
    // First upload malformed file
    const malformedCsv = `"Date,Time,Description,Withdrawal,Deposit"
"single quoted cell"`;
    const badFile = createSyntheticFile(malformedCsv, "bad.csv");
    const badFormData = new FormData();
    badFormData.append("file", badFile);
    badFormData.append("accountId", testAccount.id);

    const badRes = await importStatementCsvAction(badFormData);
    expect(badRes.success).toBe(false);

    // Now user uploads corrected file (proper comma delimiters, valid rows)
    const correctedCsv = `Date,Time,Description,Withdrawal,Deposit,Reference
2026-09-12,10:00:00,Corrected Row 1,1200.00,,REF-CORR-1
2026-09-12,11:00:00,Corrected Row 2,,3500.00,REF-CORR-2`;

    const goodFile = createSyntheticFile(correctedCsv, "corrected.csv");
    const goodFormData = new FormData();
    goodFormData.append("file", goodFile);
    goodFormData.append("accountId", testAccount.id);

    const goodRes = await importStatementCsvAction(goodFormData);
    expect(goodRes.success).toBe(true);
    expect(goodRes.status).toBe("success");
    expect(goodRes.totalItems).toBe(2);
    expect(goodRes.successCount).toBe(2);

    const items = await DataStore.getIngestionItems(testUserId, {
      sourceDocumentId: goodRes.sourceDocumentId,
    });
    expect(items.length).toBe(2);
  });
});
