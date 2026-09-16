import { describe, it, expect } from "vitest";
import {
  classifyIngestionMatch,
  computeSha256,
  generateCandidateFingerprint,
} from "@/lib/ingestion/deduplication";
import { Transaction } from "@/types/finance";
import { IngestionItem, SourceDocument } from "@/types/multi-source";

describe("Decision 2: Deduplication — Separate Strong Match from Suggestion", () => {
  const userId = "user-alice-1111-1111-1111-111111111111";
  const connection1 = "conn-gmail-111";
  const connection2 = "conn-statement-222";

  const sampleAccountMap = new Map([
    [
      "acc-kbank",
      { institution: "KBANK", masked_number: "xxx-x-x1234-x" },
    ],
    [
      "acc-scb",
      { institution: "SCB", masked_number: "xxx-x-x9876-x" },
    ],
  ]);

  // ==========================================================================
  // Strong Identifiers: A. Provider External ID (Scoped)
  // ==========================================================================
  describe("Strong Identifier A: Provider external ID (Scoped by user + connection + external_id)", () => {
    it("classifies as strong_match when external ID matches within the same provider connection", () => {
      const existingLinkedItem: IngestionItem = {
        id: "item-prev-1",
        user_id: userId,
        source_document_id: "doc-1",
        connection_id: connection1,
        item_type: "email_notification",
        status: "linked",
        provider_external_id: "GMAIL-MSG-9999",
        matched_transaction_id: "tx-canonical-100",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const newItem: IngestionItem = {
        id: "item-new-2",
        user_id: userId,
        source_document_id: "doc-2",
        connection_id: connection1, // Same connection!
        item_type: "email_notification",
        status: "pending",
        provider_external_id: "GMAIL-MSG-9999", // Same external ID
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item: newItem,
        existingIngestionItems: [existingLinkedItem],
      });

      expect(result.matchClass).toBe("strong_match");
      expect(result.confidence).toBe(1.0);
      expect(result.matchedTransactionId).toBe("tx-canonical-100");
      expect(result.reasons[0]).toContain("Scoped provider external ID");
    });

    it("does NOT strong match when the same external ID is from a DIFFERENT connection", () => {
      const existingLinkedItem: IngestionItem = {
        id: "item-prev-1",
        user_id: userId,
        source_document_id: "doc-1",
        connection_id: connection1, // connection 1
        item_type: "email_notification",
        status: "linked",
        provider_external_id: "COMMON-ID-1234",
        matched_transaction_id: "tx-canonical-100",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const newItem: IngestionItem = {
        id: "item-new-2",
        user_id: userId,
        source_document_id: "doc-2",
        connection_id: connection2, // connection 2 (different connection!)
        item_type: "statement_row",
        status: "pending",
        provider_external_id: "COMMON-ID-1234",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item: newItem,
        existingIngestionItems: [existingLinkedItem],
      });

      // Different connection must NOT match as strong match
      expect(result.matchClass).not.toBe("strong_match");
      expect(result.matchedTransactionId).toBeFalsy();
    });
  });

  // ==========================================================================
  // Strong Identifiers: B. Exact Original File SHA-256
  // ==========================================================================
  describe("Strong Identifier B: Exact original file SHA-256", () => {
    const fileContent = "Date,Amount,Desc\n2026-09-10,500,Groceries";
    const fileHash = computeSha256(fileContent);

    it("classifies as exact_duplicate when identical source document SHA-256 exists for user", () => {
      const existingDoc: SourceDocument = {
        id: "doc-existing-1",
        user_id: userId,
        document_type: "csv_statement",
        file_hash: fileHash,
        status: "processed",
        provider_metadata: {},
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const newDoc: SourceDocument = {
        id: "doc-new-2",
        user_id: userId,
        document_type: "csv_statement",
        file_hash: fileHash,
        status: "received",
        provider_metadata: {},
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const item: IngestionItem = {
        id: "item-1",
        user_id: userId,
        source_document_id: newDoc.id,
        item_type: "statement_row",
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item,
        sourceDocument: newDoc,
        existingSourceDocuments: [existingDoc],
      });

      expect(result.matchClass).toBe("exact_duplicate");
      expect(result.confidence).toBe(1.0);
      expect(result.reasons[0]).toContain("Identical source document file hash");
    });

    it("does NOT match file hash across different users", () => {
      const otherUserDoc: SourceDocument = {
        id: "doc-bob",
        user_id: "user-bob-9999",
        document_type: "csv_statement",
        file_hash: fileHash,
        status: "processed",
        provider_metadata: {},
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const newDoc: SourceDocument = {
        id: "doc-alice",
        user_id: userId,
        document_type: "csv_statement",
        file_hash: fileHash,
        status: "received",
        provider_metadata: {},
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const item: IngestionItem = {
        id: "item-1",
        user_id: userId,
        source_document_id: newDoc.id,
        item_type: "statement_row",
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item,
        sourceDocument: newDoc,
        existingSourceDocuments: [otherUserDoc],
      });

      expect(result.matchClass).not.toBe("exact_duplicate");
    });
  });

  // ==========================================================================
  // Strong Identifiers: C. Scoped Transaction Reference Number
  // Scope: institution / account / direction / reference
  // NEVER assumed globally unique across all banks!
  // ==========================================================================
  describe("Strong Identifier C: Scoped transaction reference number", () => {
    const existingTx: Transaction = {
      id: "tx-kbank-ref",
      user_id: userId,
      type: "expense",
      amount: 1500.0,
      currency: "THB",
      transaction_date: "2026-09-10T14:30:00.000Z",
      from_account_id: "acc-kbank",
      reference_number: "2026091012345678",
      source: "slip",
      tax_deductible: false,
      confidence: 1.0,
      review_status: "confirmed",
      created_at: "2026-09-10T14:30:00.000Z",
      updated_at: "2026-09-10T14:30:00.000Z",
    };

    it("classifies as strong_match ONLY when reference number has verified scope (institution + direction)", () => {
      const item: IngestionItem = {
        id: "item-stmt",
        user_id: userId,
        source_document_id: "doc-1",
        item_type: "statement_row",
        status: "pending",
        reference_number: "2026091012345678",
        parsed_data: {
          amount: 150000,
          bank_code: "KBANK", // Matches acc-kbank institution!
          direction: "outgoing", // Matches expense!
          reference_number: "2026091012345678",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item,
        existingTransactions: [existingTx],
        accountMap: sampleAccountMap,
      });

      expect(result.matchClass).toBe("strong_match");
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
      expect(result.matchedTransactionId).toBe(existingTx.id);
      expect(result.reasons[0]).toContain("Scoped reference");
    });

    it("does NOT strong match when reference number matches but institution is DIFFERENT (not globally unique)", () => {
      const itemDifferentBank: IngestionItem = {
        id: "item-stmt-scb",
        user_id: userId,
        source_document_id: "doc-1",
        item_type: "statement_row",
        status: "pending",
        reference_number: "2026091012345678", // Same reference number!
        parsed_data: {
          amount: 150000,
          bank_code: "BBL", // DIFFERENT bank!
          direction: "outgoing",
          reference_number: "2026091012345678",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item: itemDifferentBank,
        existingTransactions: [existingTx],
        accountMap: sampleAccountMap,
      });

      // MUST NOT be strong match because institution does not match!
      expect(result.matchClass).not.toBe("strong_match");
    });

    it("does NOT strong match when reference number matches but direction is OPPOSITE", () => {
      const itemOppositeDirection: IngestionItem = {
        id: "item-incoming",
        user_id: userId,
        source_document_id: "doc-1",
        item_type: "statement_row",
        status: "pending",
        reference_number: "2026091012345678",
        parsed_data: {
          amount: 150000,
          bank_code: "KBANK",
          direction: "incoming", // Opposite of expense!
          reference_number: "2026091012345678",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item: itemOppositeDirection,
        existingTransactions: [existingTx],
        accountMap: sampleAccountMap,
      });

      expect(result.matchClass).not.toBe("strong_match");
    });
  });

  // ==========================================================================
  // Weak Signals MUST NOT auto-merge alone (Must produce possible_match)
  // ==========================================================================
  describe("Weak Signals: MUST NOT auto-merge by themselves", () => {
    const existingTx: Transaction = {
      id: "tx-coffee-target",
      user_id: userId,
      type: "expense",
      amount: 120.0,
      currency: "THB",
      transaction_date: "2026-09-10T08:30:00.000Z",
      from_account_id: "acc-kbank",
      description: "Starbucks Coffee",
      source: "slip",
      tax_deductible: false,
      confidence: 1.0,
      review_status: "confirmed",
      created_at: "2026-09-10T08:30:00.000Z",
      updated_at: "2026-09-10T08:30:00.000Z",
    };

    it("produces possible_match (NEVER strong_match or auto-link) for account + amount + timestamp", () => {
      const item: IngestionItem = {
        id: "item-email-weak",
        user_id: userId,
        source_document_id: "doc-email",
        item_type: "email_notification",
        status: "pending",
        parsed_data: {
          amount: 12000, // exact 120.00 THB
          occurred_at: "2026-09-10T08:31:00.000Z", // 1 minute difference
          account_number: "1234",
          description: "Payment Starbucks",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item,
        existingTransactions: [existingTx],
        accountMap: sampleAccountMap,
      });

      // MUST be possible_match, NEVER strong_match!
      expect(result.matchClass).toBe("possible_match");
      // Auto-linking must be disabled: matchedTransactionId is NULL!
      expect(result.matchedTransactionId).toBeNull();
      // Confidence capped for safety
      expect(result.confidence).toBeLessThanOrEqual(0.85);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates![0].transaction_id).toBe(existingTx.id);
      expect(result.reasons[0]).toContain("Financial safety rule: requires user confirmation in Inbox");
    });

    it("produces possible_match even for IDENTICAL amount + EXACT SAME SECOND", () => {
      // Even identical amount + exact second may theoretically be two legitimate separate transactions
      const itemExactSecond: IngestionItem = {
        id: "item-exact-second",
        user_id: userId,
        source_document_id: "doc-stmt",
        item_type: "statement_row",
        status: "pending",
        parsed_data: {
          amount: 12000,
          occurred_at: "2026-09-10T08:30:00.000Z", // Exactly same second!
          account_number: "1234",
          description: "Starbucks Coffee",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item: itemExactSecond,
        existingTransactions: [existingTx],
        accountMap: sampleAccountMap,
      });

      // Financial safety mandate: MUST NOT auto-merge! Must be possible_match!
      expect(result.matchClass).toBe("possible_match");
      expect(result.matchedTransactionId).toBeNull();
      expect(result.confidence).toBeLessThanOrEqual(0.85);
    });

    it("fingerprint without strong source evidence produces possible_match, NEVER auto-link", () => {
      const parsedData = {
        amount: 12000,
        amount_decimal: 120.0,
        occurred_at: "2026-09-10T08:30:00.000Z",
        account_number: "1234",
        direction: "outgoing" as const,
      };

      const fp = generateCandidateFingerprint(parsedData);
      expect(fp).toBeTruthy();

      const itemWithFingerprint: IngestionItem = {
        id: "item-fp",
        user_id: userId,
        source_document_id: "doc-stmt",
        item_type: "statement_row",
        status: "pending",
        fingerprint: fp,
        parsed_data: parsedData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item: itemWithFingerprint,
        existingTransactions: [existingTx],
        accountMap: sampleAccountMap,
      });

      // Fingerprint match alone is a weak signal: possible_match only!
      expect(result.matchClass).toBe("possible_match");
      expect(result.matchedTransactionId).toBeNull();
    });

    it("returns no_match when no transactions match financial criteria", () => {
      const itemUnrelated: IngestionItem = {
        id: "item-unrelated",
        user_id: userId,
        source_document_id: "doc-stmt",
        item_type: "statement_row",
        status: "pending",
        parsed_data: {
          amount: 999900, // 9,999.00 THB (no match)
          occurred_at: "2026-09-20T10:00:00.000Z",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = classifyIngestionMatch({
        item: itemUnrelated,
        existingTransactions: [existingTx],
        accountMap: sampleAccountMap,
      });

      expect(result.matchClass).toBe("no_match");
      expect(result.confidence).toBe(0);
      expect(result.matchedTransactionId).toBeFalsy();
    });
  });
});
