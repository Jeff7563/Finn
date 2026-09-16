import { describe, it, expect } from "vitest";
import {
  sourceConnectionSchema,
  sourceDocumentSchema,
  ingestionItemSchema,
  transactionEvidenceSchema,
  reconciliationRunSchema,
} from "@/lib/validation/multi-source-schemas";

describe("Multi-Source Zod Validation Schemas", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";
  const validUuid2 = "22222222-2222-4222-8222-222222222222";
  const validUuid3 = "33333333-3333-4333-8333-333333333333";

  describe("sourceConnectionSchema", () => {
    it("accepts valid browser-visible metadata with no credentials", () => {
      const valid = {
        user_id: validUuid,
        provider: "gmail",
        label: "Primary Gmail",
        status: "active",
        provider_account_id: "user@example.com",
        config: { pollIntervalMinutes: 15 },
      };

      const result = sourceConnectionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects invalid provider or invalid user UUID", () => {
      const invalid = {
        user_id: "not-a-uuid",
        provider: "unsupported_provider",
      };

      const result = sourceConnectionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("sourceDocumentSchema", () => {
    it("accepts valid source document with 64-char hex SHA-256", () => {
      const valid = {
        user_id: validUuid,
        document_type: "csv_statement",
        file_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        status: "received",
      };

      const result = sourceDocumentSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects invalid file hash format", () => {
      const invalid = {
        user_id: validUuid,
        document_type: "csv_statement",
        file_hash: "not-sha256-hash",
      };

      const result = sourceDocumentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("transactionEvidenceSchema (Decision 1)", () => {
    it("accepts evidence with slip_id and NO ingestion_item_id", () => {
      const valid = {
        user_id: validUuid,
        transaction_id: validUuid2,
        slip_id: validUuid3,
        evidence_type: "slip",
      };

      const result = transactionEvidenceSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("accepts evidence with ingestion_item_id and NO slip_id", () => {
      const valid = {
        user_id: validUuid,
        transaction_id: validUuid2,
        ingestion_item_id: validUuid3,
        evidence_type: "statement_row",
      };

      const result = transactionEvidenceSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects evidence when BOTH slip_id and ingestion_item_id are provided", () => {
      const invalid = {
        user_id: validUuid,
        transaction_id: validUuid2,
        slip_id: validUuid3,
        ingestion_item_id: validUuid3,
        evidence_type: "slip",
      };

      const result = transactionEvidenceSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("Exactly one of slip_id or ingestion_item_id must be provided");
      }
    });

    it("rejects evidence when NEITHER slip_id nor ingestion_item_id is provided", () => {
      const invalid = {
        user_id: validUuid,
        transaction_id: validUuid2,
        slip_id: null,
        ingestion_item_id: null,
        evidence_type: "slip",
      };

      const result = transactionEvidenceSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("reconciliationRunSchema (Decision 4)", () => {
    it("accepts valid reconciliation run with integer satang balance and valid status", () => {
      const valid = {
        user_id: validUuid,
        account_id: validUuid2,
        target_instant: "2026-09-15T00:00:00.000Z",
        authoritative_balance: 1000000,
        calculated_balance: 1000000,
        difference: 0,
        status: "balanced",
        calculation_version: 1,
      };

      const result = reconciliationRunSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("accepts cannot_calculate_safely with null calculated_balance and difference", () => {
      const valid = {
        user_id: validUuid,
        account_id: validUuid2,
        target_instant: "2026-08-01T00:00:00.000Z",
        authoritative_balance: 500000,
        calculated_balance: null,
        difference: null,
        status: "cannot_calculate_safely",
        calculation_version: 1,
      };

      const result = reconciliationRunSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects invalid reconciliation status", () => {
      const invalid = {
        user_id: validUuid,
        account_id: validUuid2,
        target_instant: "2026-09-15T00:00:00.000Z",
        authoritative_balance: 1000000,
        status: "invalid_status",
      };

      const result = reconciliationRunSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
