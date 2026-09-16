"use server";

import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { TransactionEvidence, SourceDocument, IngestionItem } from "@/types/multi-source";
import { Transaction, TransactionType } from "@/types/finance";
import { revalidatePath } from "next/cache";
import { computeSha256, classifyIngestionMatch } from "@/lib/ingestion/deduplication";
import { parseBankStatementCsv } from "@/lib/ingestion/csv-parser";

export interface ImportStatementCsvResult {
  success: boolean;
  status: "success" | "duplicate" | "validation_error" | "import_failure";
  message?: string;
  error?: string;
  sourceDocumentId?: string;
  batchId?: string;
  existingDocumentId?: string;
  originalFilename?: string;
  totalItems?: number;
  successCount?: number;
  errorCount?: number;
  duplicateCount?: number;
}

export interface LinkItemResult {
  success: boolean;
  evidence?: TransactionEvidence;
  error?: string;
}

export interface CreateFromItemResult {
  success: boolean;
  transaction?: Transaction;
  evidence?: TransactionEvidence;
  error?: string;
}

/**
 * Links an ingestion item to an existing transaction as evidence.
 */
export async function linkIngestionItemAction(
  itemId: string,
  transactionId: string
): Promise<LinkItemResult> {
  const user = await requireUser();

  try {
    const result = await DataStore.linkIngestionItemToTransaction(user.id, itemId, transactionId);

    revalidatePath("/inbox");
    revalidatePath("/transactions");
    return { success: true, evidence: result.evidence };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to link item";
    return { success: false, error: message };
  }
}

/**
 * Creates a new transaction from an ingestion item and records the evidence bridge.
 */
export async function createTransactionFromItemAction(
  itemId: string,
  overrides: {
    accountId?: string;
    fromAccountId?: string;
    toAccountId?: string;
    categoryId?: string | null;
    description?: string | null;
    note?: string | null;
  }
): Promise<CreateFromItemResult> {
  const user = await requireUser();

  try {
    const item = await DataStore.getIngestionItemById(user.id, itemId);
    if (!item) {
      return { success: false, error: "Ingestion item not found" };
    }

    if (item.status === "linked") {
      return { success: false, error: "Ingestion item is already linked to a transaction" };
    }

    const parsed = item.parsed_data;
    if (!parsed) {
      return { success: false, error: "Ingestion item has no parsed financial data" };
    }

    // 1. Validate amount strictly: must be > 0 (FAIL CLOSED)
    const amountSatang = parsed.amount;
    const amountThb =
      parsed.amount_decimal !== undefined && parsed.amount_decimal !== null
        ? parsed.amount_decimal
        : amountSatang !== undefined && amountSatang !== null
        ? amountSatang / 100
        : null;

    if (amountThb === null || isNaN(amountThb) || amountThb <= 0) {
      return {
        success: false,
        error: "Missing or invalid amount: transaction amount must be greater than zero",
      };
    }

    // 2. Validate occurred_at strictly: must be present and valid timestamp (FAIL CLOSED)
    if (!parsed.occurred_at) {
      return {
        success: false,
        error: "Missing transaction date: cannot create transaction without a valid date/time",
      };
    }
    const dateTimestamp = new Date(parsed.occurred_at).getTime();
    if (isNaN(dateTimestamp)) {
      return {
        success: false,
        error: `Invalid transaction date timestamp: "${parsed.occurred_at}"`,
      };
    }

    // 3. Validate currency strictly: cannot silently invent THB (FAIL CLOSED)
    if (!parsed.currency || !parsed.currency.trim()) {
      return {
        success: false,
        error: "Missing transaction currency: cannot create transaction without explicit currency",
      };
    }

    // 4. Validate direction / type strictly (FAIL CLOSED)
    const txType: TransactionType | undefined =
      (parsed.transaction_type as TransactionType) ||
      (parsed.direction === "incoming" ? "income" : parsed.direction === "outgoing" ? "expense" : undefined);

    if (!txType) {
      return {
        success: false,
        error: "Missing transaction direction or type (cannot determine income, expense, or transfer)",
      };
    }

    // 5. Direction-specific account validation (FAIL CLOSED)
    let fromAccountId: string | null = null;
    let toAccountId: string | null = null;

    if (txType === "transfer") {
      const fromId = overrides.fromAccountId || (overrides.accountId && overrides.toAccountId && overrides.accountId !== overrides.toAccountId ? overrides.accountId : overrides.fromAccountId);
      const toId = overrides.toAccountId;

      if (!fromId || !toId) {
        return {
          success: false,
          error: "Both fromAccountId and toAccountId are required for transfer transaction",
        };
      }

      if (fromId === toId) {
        return {
          success: false,
          error: "Transfer source and destination accounts must be distinct",
        };
      }

      const [fromAccount, toAccount] = await Promise.all([
        DataStore.getAccountById(user.id, fromId),
        DataStore.getAccountById(user.id, toId),
      ]);

      if (!fromAccount) {
        return {
          success: false,
          error: "Source account not found or does not belong to user",
        };
      }
      if (!toAccount) {
        return {
          success: false,
          error: "Destination account not found or does not belong to user",
        };
      }

      fromAccountId = fromId;
      toAccountId = toId;
    } else if (txType === "expense") {
      const fromId = overrides.fromAccountId || overrides.accountId;
      if (!fromId) {
        return {
          success: false,
          error: "Source account (fromAccountId or accountId) is required for expense transaction",
        };
      }

      const account = await DataStore.getAccountById(user.id, fromId);
      if (!account) {
        return {
          success: false,
          error: "Selected source account not found or does not belong to user",
        };
      }

      fromAccountId = fromId;
      toAccountId = null;
    } else if (txType === "income") {
      const toId = overrides.toAccountId || overrides.accountId;
      if (!toId) {
        return {
          success: false,
          error: "Destination account (toAccountId or accountId) is required for income transaction",
        };
      }

      const account = await DataStore.getAccountById(user.id, toId);
      if (!account) {
        return {
          success: false,
          error: "Selected destination account not found or does not belong to user",
        };
      }

      fromAccountId = null;
      toAccountId = toId;
    } else {
      return {
        success: false,
        error: `Unsupported transaction type: ${txType}`,
      };
    }

    const txData = {
      type: txType,
      amount: amountThb,
      currency: parsed.currency.trim(),
      transaction_date: parsed.occurred_at,
      description: overrides.description || parsed.description || parsed.merchant_name || "Imported transaction",
      note: overrides.note || parsed.note || null,
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      category_id: overrides.categoryId || null,
      source: "import" as const,
      reference_number: parsed.reference_number || null,
      confidence: 1.0,
      review_status: "confirmed" as const,
      tax_deductible: false,
    };

    // ATOMIC operation: creates transaction, creates evidence, updates item to linked
    const result = await DataStore.createTransactionFromIngestionItem(user.id, item.id, txData);

    revalidatePath("/inbox");
    revalidatePath("/transactions");
    return { success: true, transaction: result.transaction, evidence: result.evidence };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create transaction from item";
    return { success: false, error: message };
  }
}

/**
 * Dismisses an ingestion item without linking.
 */
export async function dismissIngestionItemAction(itemId: string): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  try {
    await DataStore.updateIngestionItem(user.id, itemId, {
      status: "dismissed",
    });
    revalidatePath("/inbox");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to dismiss item";
    return { success: false, error: message };
  }
}

/**
 * Rejects an ingestion item with an error reason, preserving raw data.
 */
export async function rejectIngestionItemAction(
  itemId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  try {
    const item = await DataStore.getIngestionItemById(user.id, itemId);
    if (!item) {
      return { success: false, error: "Ingestion item not found" };
    }

    const rejectionReason = reason || "User rejected item";
    const existingParsed = item.parsed_data || {
      amount: null,
    };

    // Preserve raw_data completely! Store rejection reason in parsed_data.rejection_reason
    await DataStore.updateIngestionItem(user.id, itemId, {
      status: "error",
      parsed_data: {
        ...existingParsed,
        rejection_reason: rejectionReason,
      },
    });

    revalidatePath("/inbox");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reject item";
    return { success: false, error: message };
  }
}

/**
 * Derives bankHint for the CSV parser based on institution name.
 */
function deriveBankHint(
  institution?: string | null
): "KBANK" | "SCB" | "BBL" | "BAY" | "KKP" | "GENERIC" {
  if (!institution) return "GENERIC";
  const norm = institution.toUpperCase();
  if (norm.includes("KBANK") || norm.includes("KASIKORN") || norm.includes("กสิกร")) return "KBANK";
  if (norm.includes("SCB") || norm.includes("SIAM COMMERCIAL") || norm.includes("ไทยพาณิชย์")) return "SCB";
  if (norm.includes("BBL") || norm.includes("BANGKOK BANK") || norm.includes("กรุงเทพ")) return "BBL";
  if (norm.includes("BAY") || norm.includes("KRUNGSRI") || norm.includes("กรุงศรี")) return "BAY";
  if (norm.includes("KKP") || norm.includes("KIATNAKIN") || norm.includes("เกียรตินาคิน")) return "KKP";
  return "GENERIC";
}

/**
 * Server Action: Imports a bank statement CSV file into the inbox.
 *
 * Flow:
 * 1. Validate file metadata (existence, .csv extension, <=5MB, non-empty, active account).
 * 2. Original-byte SHA-256 computed BEFORE text decoding / normalization.
 * 3. Safe decoding (UTF-8, UTF-8 BOM, Windows-874 fallback).
 * 4. Full-file idempotency (dedup on user + document_type + file_hash).
 * 5. Metadata-only source_document & import_batch created.
 * 6. Parser extracts rows with Bangkok timezone handling & inherited account context.
 * 7. Classification with deduplication engine (NO auto-linking / NO auto-tx creation).
 * 8. Bulk creation of ingestion_items.
 * 9. Revalidate & complete batch.
 */
export async function importStatementCsvAction(
  formData: FormData
): Promise<ImportStatementCsvResult> {
  const user = await requireUser();

  try {
    const rawFile = formData.get("file") || formData.get("csvFile");
    const statementAccountId = (
      formData.get("accountId") || formData.get("statementAccountId")
    ) as string | null;

    // 1. File existence validation
    if (!rawFile || !(rawFile instanceof File)) {
      return {
        success: false,
        status: "validation_error",
        error: "กรุณาเลือกไฟล์ Statement CSV (CSV file is required)",
      };
    }

    const filename = rawFile.name || "statement.csv";

    // 2. Extension validation
    if (!filename.toLowerCase().endsWith(".csv")) {
      return {
        success: false,
        status: "validation_error",
        error: "รองรับเฉพาะไฟล์นามสกุล .csv เท่านั้น (Only .csv files supported)",
      };
    }

    // 3. File size limit: 5 MB
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (rawFile.size > MAX_FILE_SIZE) {
      return {
        success: false,
        status: "validation_error",
        error: "ขนาดไฟล์เกินกำหนด (สูงสุดไม่เกิน 5 MB)",
      };
    }

    // 4. Reject empty file
    if (rawFile.size === 0) {
      return {
        success: false,
        status: "validation_error",
        error: "ไฟล์ว่างเปล่า (Empty file rejected)",
      };
    }

    // 5. Statement account ID validation
    if (!statementAccountId || !statementAccountId.trim()) {
      return {
        success: false,
        status: "validation_error",
        error: "กรุณาเลือกบัญชี Finn ที่สเตตเมนต์นี้สังกัด (Statement account is required)",
      };
    }

    // 6. Account ownership validation
    const account = await DataStore.getAccountById(user.id, statementAccountId.trim());
    if (!account) {
      return {
        success: false,
        status: "validation_error",
        error: "ไม่พบบัญชีที่เลือก หรือบัญชีไม่ได้เป็นของคุณ (Account not found)",
      };
    }

    // 7. Active account validation
    if (account.active === false) {
      return {
        success: false,
        status: "validation_error",
        error: "บัญชีที่เลือกถูกปิดใช้งานหรือไม่พร้อมใช้งาน (Selected account is inactive)",
      };
    }

    // 8. Read ORIGINAL bytes
    const arrayBuffer = await rawFile.arrayBuffer();
    const originalBytes = Buffer.from(arrayBuffer);

    if (originalBytes.length === 0) {
      return {
        success: false,
        status: "validation_error",
        error: "ไฟล์ว่างเปล่า (Empty file rejected)",
      };
    }

    if (originalBytes.length > MAX_FILE_SIZE) {
      return {
        success: false,
        status: "validation_error",
        error: "ขนาดไฟล์เกินกำหนด (สูงสุดไม่เกิน 5 MB)",
      };
    }

    // 9. ORIGINAL-BYTE HASHING: SHA-256 computed on raw original bytes BEFORE any decoding
    const fileHash = computeSha256(originalBytes);

    // 10. TEXT DECODING: UTF-8, UTF-8 BOM, and Thai Windows-874 fallback
    let decodedText: string;
    let encodingUsed: string;

    let bytesToDecode = originalBytes;
    let isUtf8Bom = false;
    if (
      originalBytes.length >= 3 &&
      originalBytes[0] === 0xef &&
      originalBytes[1] === 0xbb &&
      originalBytes[2] === 0xbf
    ) {
      isUtf8Bom = true;
      bytesToDecode = originalBytes.subarray(3);
    }

    try {
      const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
      decodedText = utf8Decoder.decode(bytesToDecode);
      encodingUsed = isUtf8Bom ? "utf-8-bom" : "utf-8";
    } catch {
      // Fallback to Windows-874 / Thai legacy CSV
      try {
        const thaiDecoder = new TextDecoder("windows-874", { fatal: true });
        decodedText = thaiDecoder.decode(originalBytes);
        encodingUsed = "windows-874";
      } catch {
        return {
          success: false,
          status: "import_failure",
          error:
            "ไม่สามารถอ่านไฟล์ CSV ได้: รูปแบบการเข้ารหัสตัวอักษรไม่ถูกต้องหรือไม่รองรับ (Unable to decode CSV safely)",
        };
      }
    }

    // Strip leading BOM character if still present in string
    if (decodedText.charCodeAt(0) === 0xfeff) {
      decodedText = decodedText.slice(1);
    }

    // 11. Row count validation (maximum 10,000 non-empty rows)
    const nonBlankLines = decodedText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (nonBlankLines.length === 0) {
      return {
        success: false,
        status: "validation_error",
        error: "ไฟล์ CSV ว่างเปล่า ไม่มีข้อมูลรายการ (Empty CSV rejected)",
      };
    }

    if (nonBlankLines.length > 10000) {
      return {
        success: false,
        status: "validation_error",
        error: "ไฟล์มีจำนวนรายการเกินกำหนด (สูงสุดไม่เกิน 10,000 แถว)",
      };
    }

    // 12. FULL-FILE IDEMPOTENCY: Check existing source_documents for same hash
    const existingDoc = await DataStore.getSourceDocumentByHash(user.id, fileHash);
    if (existingDoc && existingDoc.document_type === "csv_statement") {
      if (existingDoc.status !== "failed") {
        return {
          success: false,
          status: "duplicate",
          existingDocumentId: existingDoc.id,
          originalFilename: existingDoc.original_filename || filename,
          message: `ไฟล์นี้เคยถูกนำเข้าแล้ว (${existingDoc.original_filename || filename})`,
          error: `ไฟล์นี้เคยถูกนำเข้าแล้ว (${existingDoc.original_filename || filename})`,
        };
      }
      // If previous document with the same hash was failed, allow a safe retry below!
    }

    const bankHint = deriveBankHint(account.institution);

    // 13. SOURCE DOCUMENT CREATION (Metadata only; binary not stored in bucket yet)
    let sourceDoc: SourceDocument;
    if (existingDoc && existingDoc.status === "failed") {
      sourceDoc = await DataStore.updateSourceDocument(user.id, existingDoc.id, {
        status: "processing",
        original_filename: filename,
        file_size: originalBytes.length,
        stored_file_size: 0,
        storage_path: null,
        provider_metadata: {
          importMethod: "web_csv",
          statementAccountId: account.id,
          statementAccountName: account.name,
          institution: account.institution || null,
          binaryStorage: "metadata_only",
          encoding: encodingUsed,
        },
      });
    } else {
      sourceDoc = await DataStore.createSourceDocument(user.id, {
        document_type: "csv_statement",
        original_filename: filename,
        file_hash: fileHash,
        file_size: originalBytes.length,
        stored_file_size: 0,
        storage_path: null,
        status: "processing",
        provider_metadata: {
          importMethod: "web_csv",
          statementAccountId: account.id,
          statementAccountName: account.name,
          institution: account.institution || null,
          binaryStorage: "metadata_only",
          encoding: encodingUsed,
        },
      });
    }

    // 14. IMPORT BATCH CREATION
    const batch = await DataStore.createImportBatch(user.id, {
      source_document_id: sourceDoc.id,
      batch_type: "csv_statement",
      status: "processing",
      metadata: {
        statementAccountId: account.id,
        statementAccountName: account.name,
        institution: account.institution || null,
        filename,
      },
    });

    // 15. PARSING
    const parseResult = parseBankStatementCsv(decodedText, {
      userId: user.id,
      sourceDocumentId: sourceDoc.id,
      filename,
      bankHint,
      fileHash,
      fileSize: originalBytes.length,
      defaultInstitution: account.institution || null,
      defaultMaskedNumber: account.masked_number || null,
    });

    // 16. LOAD CONTEXT FOR DEDUPLICATION CLASSIFICATION
    const [existingDocs, existingItems, existingTxs, allAccounts] = await Promise.all([
      DataStore.getSourceDocuments(user.id),
      DataStore.getIngestionItems(user.id),
      DataStore.getTransactions(user.id),
      DataStore.getAccounts(user.id),
    ]);

    const accountMap = new Map(
      allAccounts.map((a) => [a.id, { institution: a.institution, masked_number: a.masked_number }])
    );

    // 17. CLASSIFY EACH ROW
    let successCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;

    const classifiedItems: Array<Partial<IngestionItem>> = [];

    for (const item of parseResult.items) {
      const hasParseError = Boolean(item.parsed_data?.parse_error);
      if (hasParseError) {
        errorCount++;
      } else {
        successCount++;
      }

      const match = classifyIngestionMatch({
        item: item as IngestionItem,
        sourceDocument: sourceDoc,
        existingSourceDocuments: existingDocs.filter((d) => d.id !== sourceDoc.id),
        existingIngestionItems: existingItems,
        existingTransactions: existingTxs,
        accountMap,
      });

      if (match.matchClass === "exact_duplicate") {
        duplicateCount++;
      }

      // FINANCIAL SAFETY RULE:
      // DO NOT auto-create transactions.
      // DO NOT auto-link transaction evidence during import.
      // Even strong_match is surfaced in Inbox for explicit user action.
      // matchedTransactionId is retained as a candidate for 1-click Link, but evidence is NOT created.
      classifiedItems.push({
        ...item,
        source_document_id: sourceDoc.id,
        batch_id: batch.id,
        connection_id: null,
        item_type: "statement_row",
        status: "pending",
        match_class: match.matchClass,
        matched_transaction_id:
          match.matchClass === "strong_match" ? match.matchedTransactionId || null : null,
        confidence_score: match.confidence,
      });
    }

    // 18. BULK ITEM CREATION
    try {
      if (classifiedItems.length > 0) {
        await DataStore.createIngestionItems(user.id, classifiedItems);
      }
    } catch (err: unknown) {
      // Failure rollback: mark batch and source document failed
      await DataStore.updateImportBatch(user.id, batch.id, {
        status: "failed",
        total_items: parseResult.items.length,
        error_count: parseResult.items.length,
        completed_at: new Date().toISOString(),
      });
      await DataStore.updateSourceDocument(user.id, sourceDoc.id, {
        status: "failed",
      });
      return {
        success: false,
        status: "import_failure",
        error:
          err instanceof Error
            ? err.message
            : "เกิดข้อผิดพลาดในการบันทึกรายการนำเข้า (Failed to create ingestion items)",
      };
    }

    // 19. COMPLETE BATCH & SOURCE DOCUMENT
    await DataStore.updateImportBatch(user.id, batch.id, {
      status: "completed",
      total_items: parseResult.items.length,
      success_count: successCount,
      error_count: errorCount,
      duplicate_count: duplicateCount,
      completed_at: new Date().toISOString(),
    });

    await DataStore.updateSourceDocument(user.id, sourceDoc.id, {
      status: "processed",
    });

    revalidatePath("/inbox");

    return {
      success: true,
      status: "success",
      sourceDocumentId: sourceDoc.id,
      batchId: batch.id,
      totalItems: parseResult.items.length,
      successCount,
      errorCount,
      duplicateCount,
      message: `นำเข้า Statement สำเร็จทั้งหมด ${parseResult.items.length} รายการ (สมบูรณ์ ${successCount} รายการ, รอตรวจสอบ ${errorCount} รายการ)`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "การนำเข้าไฟล์ล้มเหลว (Import failed)";
    return {
      success: false,
      status: "import_failure",
      error: message,
    };
  }
}
