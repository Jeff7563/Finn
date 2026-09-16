import { computeSha256, generateCandidateFingerprint } from "./deduplication";
import {
  IngestionItem,
  IngestionParsedData,
  SourceDocument,
} from "@/types/multi-source";
import { bangkokDateTimeLocalToCanonicalInstant } from "@/lib/finance/formatters";

export interface ParsedStatementResult {
  fileHash: string;
  sourceDocument: Partial<SourceDocument>;
  items: Array<Omit<IngestionItem, "id" | "created_at" | "updated_at">>;
}

export interface ParseCsvOptions {
  userId: string;
  sourceDocumentId?: string;
  connectionId?: string | null;
  filename?: string;
  bankHint?: "KBANK" | "SCB" | "BBL" | "BAY" | "KKP" | "GENERIC";
}

/**
 * Parses numeric strings like "1,250.00", "-50.00", "(100.00)" into satang integers.
 */
export function parseMoneyToSatang(val: string | number | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  if (!str) return null;

  // Handle accounting parentheses (e.g. "(50.00)" -> -50.00)
  const isNegativeParen = str.startsWith("(") && str.endsWith(")");
  const clean = str.replace(/[(),]/g, "").trim();
  const num = parseFloat(clean);
  if (isNaN(num)) return null;

  const finalNum = isNegativeParen ? -Math.abs(num) : num;
  return Math.round(finalNum * 100);
}

/**
 * Splits CSV lines safely, taking quoted commas into account.
 */
export function splitCsvRow(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Parses Bank Statement CSV content into normalized IngestionItems.
 */
export function parseBankStatementCsv(
  csvContent: string,
  options: ParseCsvOptions
): ParsedStatementResult {
  const { userId, sourceDocumentId = "temp-doc-id", connectionId = null, filename = "statement.csv", bankHint = "GENERIC" } = options;

  const fileHash = computeSha256(csvContent);
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      fileHash,
      sourceDocument: {
        user_id: userId,
        connection_id: connectionId,
        document_type: "csv_statement",
        original_filename: filename,
        file_hash: fileHash,
        file_size: Buffer.byteLength(csvContent, "utf8"),
        status: "processed",
        provider_metadata: { bankHint, rowCount: 0 },
      },
      items: [],
    };
  }

  // Parse header
  const headers = splitCsvRow(lines[0]).map((h) => h.toLowerCase().replace(/[\s_-]/g, ""));

  const colIndex = {
    date: headers.findIndex((h) => h.includes("date") || h.includes("วันที่")),
    time: headers.findIndex((h) => h.includes("time") || h.includes("เวลา")),
    description: headers.findIndex((h) => h.includes("desc") || h.includes("detail") || h.includes("รายการ")),
    withdrawal: headers.findIndex((h) => h.includes("withdraw") || h.includes("debit") || h.includes("ถอน")),
    deposit: headers.findIndex((h) => h.includes("deposit") || h.includes("credit") || h.includes("ฝาก")),
    amount: headers.findIndex((h) => h.includes("amount") || h.includes("จำนวนเงิน")),
    reference: headers.findIndex((h) => h.includes("ref") || h.includes("อ้างอิง") || h.includes("channel")),
    channel: headers.findIndex((h) => h.includes("channel") || h.includes("ช่องทาง")),
    account: headers.findIndex((h) => h.includes("account") || h.includes("บัญชี")),
  };

  const items: Array<Omit<IngestionItem, "id" | "created_at" | "updated_at">> = [];

  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvRow(lines[i]);
    if (row.length <= 1) continue;

    const rawDateStr = colIndex.date !== -1 ? row[colIndex.date] : "";
    const rawTimeStr = colIndex.time !== -1 ? row[colIndex.time] : "";
    const description = colIndex.description !== -1 ? row[colIndex.description] : "";
    const ref = colIndex.reference !== -1 ? row[colIndex.reference] : null;
    const accountStr = colIndex.account !== -1 ? row[colIndex.account] : null;

    let withdrawalSatang: number | null = null;
    let depositSatang: number | null = null;

    if (colIndex.withdrawal !== -1) {
      withdrawalSatang = parseMoneyToSatang(row[colIndex.withdrawal]);
    }
    if (colIndex.deposit !== -1) {
      depositSatang = parseMoneyToSatang(row[colIndex.deposit]);
    }

    let finalSatang: number | null = null;
    let direction: "incoming" | "outgoing" = "outgoing";
    let txType: "income" | "expense" = "expense";

    if (withdrawalSatang && withdrawalSatang > 0) {
      finalSatang = withdrawalSatang;
      direction = "outgoing";
      txType = "expense";
    } else if (depositSatang && depositSatang > 0) {
      finalSatang = depositSatang;
      direction = "incoming";
      txType = "income";
    } else if (colIndex.amount !== -1) {
      const amt = parseMoneyToSatang(row[colIndex.amount]);
      if (amt !== null) {
        if (amt < 0) {
          finalSatang = Math.abs(amt);
          direction = "outgoing";
          txType = "expense";
        } else {
          finalSatang = amt;
          direction = "incoming";
          txType = "income";
        }
      }
    }

    // Compose Bangkok wall-clock timestamp
    let rawCombined = rawDateStr.trim();
    if (rawTimeStr.trim()) {
      rawCombined = `${rawCombined} ${rawTimeStr.trim()}`;
    }
    const occurredAtIso = rawCombined
      ? bangkokDateTimeLocalToCanonicalInstant(rawCombined)
      : null;

    const hasValidAmount = finalSatang !== null && finalSatang > 0;
    const hasValidDate = occurredAtIso !== null;

    // Malformed rows must NOT disappear: queue for manual Inbox review
    if (!hasValidAmount || !hasValidDate) {
      const parseErrors: string[] = [];
      if (!hasValidAmount) {
        parseErrors.push("Missing or invalid non-zero transaction amount");
      }
      if (!hasValidDate) {
        parseErrors.push(
          rawCombined
            ? `Unparseable Bangkok date/time format: "${rawCombined}"`
            : "Missing transaction date"
        );
      }
      const parseError = parseErrors.join("; ");

      const parsedData: IngestionParsedData = {
        amount: finalSatang ?? 0,
        amount_decimal: finalSatang !== null ? Number((finalSatang / 100).toFixed(2)) : 0,
        currency: "THB",
        description: description || null,
        occurred_at: occurredAtIso,
        account_number: accountStr,
        bank_code: bankHint !== "GENERIC" ? bankHint : null,
        transaction_type: txType,
        direction,
        reference_number: ref || null,
        parse_error: parseError,
        raw_metadata: { rowNumber: i + 1, rawRow: row },
      };

      const rawSeed = `${finalSatang || 0}|${rawCombined || "no_date"}|${accountStr || "no_acc"}|${direction}|row-${i + 1}`;
      const fingerprint = computeSha256(rawSeed).slice(0, 32);

      items.push({
        user_id: userId,
        source_document_id: sourceDocumentId,
        connection_id: connectionId,
        item_type: "statement_row",
        status: "pending",
        raw_data: { line: lines[i], rowNumber: i + 1, rawRow: row },
        parsed_data: parsedData,
        fingerprint,
        provider_external_id: null,
        reference_number: ref || null,
        match_class: "no_match",
        matched_transaction_id: null,
        confidence_score: 0,
      });
      continue;
    }

    const validSatang = finalSatang as number;
    const parsedData: IngestionParsedData = {
      amount: validSatang,
      amount_decimal: Number((validSatang / 100).toFixed(2)),
      currency: "THB",
      description: description || null,
      occurred_at: occurredAtIso,
      account_number: accountStr,
      bank_code: bankHint !== "GENERIC" ? bankHint : null,
      transaction_type: txType,
      direction,
      reference_number: ref || null,
      raw_metadata: { rowNumber: i + 1, rawRow: row },
    };

    const fingerprint = generateCandidateFingerprint(parsedData);

    items.push({
      user_id: userId,
      source_document_id: sourceDocumentId,
      connection_id: connectionId,
      item_type: "statement_row",
      status: "pending",
      raw_data: { line: lines[i], rowNumber: i + 1, rawRow: row },
      parsed_data: parsedData,
      fingerprint,
      provider_external_id: null,
      reference_number: ref || null,
      match_class: null,
      matched_transaction_id: null,
      confidence_score: null,
    });
  }

  return {
    fileHash,
    sourceDocument: {
      user_id: userId,
      connection_id: connectionId,
      document_type: "csv_statement",
      original_filename: filename,
      file_hash: fileHash,
      file_size: Buffer.byteLength(csvContent, "utf8"),
      status: "processed",
      provider_metadata: { bankHint, rowCount: items.length },
    },
    items,
  };
}
