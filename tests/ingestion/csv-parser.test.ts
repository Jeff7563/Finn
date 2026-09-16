import { describe, it, expect } from "vitest";
import {
  parseBankStatementCsv,
  parseMoneyToSatang,
  splitCsvRow,
} from "@/lib/ingestion/csv-parser";

describe("Bank Statement CSV Parser", () => {
  const userId = "user-alice-1111-1111-1111-111111111111";

  describe("Utility: parseMoneyToSatang & splitCsvRow", () => {
    it("parses diverse number formats into satang integers", () => {
      expect(parseMoneyToSatang("1,500.50")).toBe(150050);
      expect(parseMoneyToSatang("0.25")).toBe(25);
      expect(parseMoneyToSatang("-100.00")).toBe(-10000);
      expect(parseMoneyToSatang("(500.00)")).toBe(-50000);
      expect(parseMoneyToSatang("")).toBeNull();
      expect(parseMoneyToSatang(null)).toBeNull();
    });

    it("splits CSV rows respecting quoted commas", () => {
      const row = '2026-09-10,"Starbucks, Central World",150.00,"Ref ""123"""';
      const parts = splitCsvRow(row);
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("2026-09-10");
      expect(parts[1]).toBe("Starbucks, Central World");
      expect(parts[2]).toBe("150.00");
      expect(parts[3]).toBe('Ref "123"');
    });
  });

  describe("parseBankStatementCsv", () => {
    it("parses Thai bank format with withdrawal and deposit columns", () => {
      const csv = `Date,Time,Description,Withdrawal,Deposit,Reference
2026-09-10,08:30:00,Transfer to SCB,1500.00,,KBANK-REF-001
2026-09-10,12:00:00,Salary Deposit,,50000.00,SALARY-SEP-26
2026-09-11,18:45:00,Supermarket,320.75,,POS-7788`;

      const result = parseBankStatementCsv(csv, {
        userId,
        filename: "kbank_statement_sep26.csv",
        bankHint: "KBANK",
      });

      expect(result.fileHash).toHaveLength(64); // Valid SHA-256
      expect(result.sourceDocument.document_type).toBe("csv_statement");
      expect(result.sourceDocument.original_filename).toBe("kbank_statement_sep26.csv");

      expect(result.items).toHaveLength(3);

      // Row 1: Withdrawal 1,500.00 THB = 150,000 Satang
      const item1 = result.items[0];
      expect(item1.item_type).toBe("statement_row");
      expect(item1.status).toBe("pending");
      expect(item1.parsed_data?.amount).toBe(150000);
      expect(item1.parsed_data?.amount_decimal).toBe(1500.0);
      expect(item1.parsed_data?.direction).toBe("outgoing");
      expect(item1.parsed_data?.transaction_type).toBe("expense");
      expect(item1.parsed_data?.reference_number).toBe("KBANK-REF-001");
      expect(item1.parsed_data?.bank_code).toBe("KBANK");
      expect(item1.fingerprint).toBeTruthy();

      // Row 2: Deposit 50,000.00 THB = 5,000,000 Satang
      const item2 = result.items[1];
      expect(item2.parsed_data?.amount).toBe(5000000);
      expect(item2.parsed_data?.direction).toBe("incoming");
      expect(item2.parsed_data?.transaction_type).toBe("income");
      expect(item2.parsed_data?.description).toBe("Salary Deposit");

      // Row 3: Withdrawal 320.75 THB = 32,075 Satang
      const item3 = result.items[2];
      expect(item3.parsed_data?.amount).toBe(32075);
      expect(item3.parsed_data?.direction).toBe("outgoing");
    });

    it("parses single Amount column format with positive/negative values", () => {
      const csv = `Date,Description,Amount,Reference
2026-09-10,Online Payment,-450.00,PAY-01
2026-09-11,PromptPay In,1000.00,PP-02`;

      const result = parseBankStatementCsv(csv, {
        userId,
        filename: "generic.csv",
      });

      expect(result.items).toHaveLength(2);

      expect(result.items[0].parsed_data?.amount).toBe(45000);
      expect(result.items[0].parsed_data?.direction).toBe("outgoing");
      expect(result.items[0].parsed_data?.transaction_type).toBe("expense");

      expect(result.items[1].parsed_data?.amount).toBe(100000);
      expect(result.items[1].parsed_data?.direction).toBe("incoming");
      expect(result.items[1].parsed_data?.transaction_type).toBe("income");
    });

    it("Scenario 17: Bangkok timestamp conversion (handles Thai Buddhist year 2569 -> 2026 and DD/MM/YYYY)", () => {
      const csv = `Date,Time,Description,Amount
15/09/2569,14:30:00,PromptPay Transfer,500.00`;

      const result = parseBankStatementCsv(csv, { userId });
      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      // 14:30:00 in Asia/Bangkok (+07:00) MUST canonicalize to 07:30:00.000Z in UTC
      expect(item.parsed_data?.occurred_at).toBe("2026-09-15T07:30:00.000Z");
    });

    it("handles Gregorian DD/MM/YYYY, YYYY-MM-DD, date-only, and midnight boundaries in Asia/Bangkok", () => {
      const csv = `Date,Time,Description,Amount
15/09/2026,14:30:00,Gregorian DD/MM/YYYY,500.00
2026-09-15,14:30:00,Gregorian YYYY-MM-DD,600.00
15/09/2026,,Date Only Bangkok Noon,700.00
16/09/2026,00:15:00,Midnight Cross-Day Boundary,800.00`;

      const result = parseBankStatementCsv(csv, { userId });
      expect(result.items).toHaveLength(4);

      // 1. Gregorian DD/MM/YYYY 14:30:00 Bangkok -> 07:30:00.000Z UTC
      expect(result.items[0].parsed_data?.occurred_at).toBe("2026-09-15T07:30:00.000Z");

      // 2. Gregorian YYYY-MM-DD 14:30:00 Bangkok -> 07:30:00.000Z UTC
      expect(result.items[1].parsed_data?.occurred_at).toBe("2026-09-15T07:30:00.000Z");

      // 3. Date only defaults to 12:00:00 Bangkok wall clock -> 05:00:00.000Z UTC
      expect(result.items[2].parsed_data?.occurred_at).toBe("2026-09-15T05:00:00.000Z");

      // 4. Midnight boundary: 16/09/2026 00:15:00 Bangkok -> 2026-09-15T17:15:00.000Z UTC (previous day UTC)
      expect(result.items[3].parsed_data?.occurred_at).toBe("2026-09-15T17:15:00.000Z");
    });

    it("Scenario 18: CSV debit (withdrawal column maps to outgoing expense in satang)", () => {
      const csv = `Date,Description,Withdrawal
2026-09-10,Grocery Store,1250.75`;

      const result = parseBankStatementCsv(csv, { userId });
      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.parsed_data?.amount).toBe(125075);
      expect(item.parsed_data?.amount_decimal).toBe(1250.75);
      expect(item.parsed_data?.direction).toBe("outgoing");
      expect(item.parsed_data?.transaction_type).toBe("expense");
    });

    it("Scenario 19: CSV credit (deposit column maps to incoming income in satang)", () => {
      const csv = `Date,Description,Deposit
2026-09-10,Direct Deposit,35000.00`;

      const result = parseBankStatementCsv(csv, { userId });
      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.parsed_data?.amount).toBe(3500000);
      expect(item.parsed_data?.amount_decimal).toBe(35000.0);
      expect(item.parsed_data?.direction).toBe("incoming");
      expect(item.parsed_data?.transaction_type).toBe("income");
    });

    it("Scenario 20: CSV malformed row -> review (preserves malformed/zero-amount rows with status pending, match_class no_match, and parse_error)", () => {
      const csv = `Date,Description,Amount
2026-09-10,Malformed or Zero Row,0.00
2026-09-10,Missing amount,
invalid-date-format,Valid Amount,250.00
2026-09-11,Valid Transaction,150.00`;

      const result = parseBankStatementCsv(csv, { userId });
      // Malformed rows must NOT disappear!
      expect(result.items).toHaveLength(4);

      // Row 1: Zero amount
      expect(result.items[0].status).toBe("pending");
      expect(result.items[0].match_class).toBe("no_match");
      expect(result.items[0].parsed_data?.parse_error).toContain("Missing or invalid non-zero transaction amount");
      expect(result.items[0].raw_data).toBeDefined();

      // Row 2: Missing amount
      expect(result.items[1].status).toBe("pending");
      expect(result.items[1].match_class).toBe("no_match");
      expect(result.items[1].parsed_data?.parse_error).toContain("Missing or invalid non-zero transaction amount");

      // Row 3: Invalid date
      expect(result.items[2].status).toBe("pending");
      expect(result.items[2].match_class).toBe("no_match");
      expect(result.items[2].parsed_data?.parse_error).toContain("Unparseable Bangkok date/time format");

      // Row 4: Valid
      expect(result.items[3].status).toBe("pending");
      expect(result.items[3].match_class).toBeNull();
      expect(result.items[3].parsed_data?.amount).toBe(15000);
      expect(result.items[3].parsed_data?.parse_error).toBeUndefined();
    });

    it("handles empty or single-row CSV gracefully", () => {
      const csv = "Date,Description,Amount";
      const result = parseBankStatementCsv(csv, { userId });
      expect(result.items).toHaveLength(0);
      expect(result.fileHash).toHaveLength(64);
    });
  });
});
