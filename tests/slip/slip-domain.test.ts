import { describe, it, expect } from "vitest";
import {
  generateIngestToken,
  hashToken,
  verifyTokenHash,
  isTokenUsable,
} from "@/lib/slip/token";
import {
  validateSlipFile,
  computeFileSha256,
  generateSlipStoragePath,
} from "@/lib/slip/validation";
import { normalizeBankName } from "@/lib/slip/bank-normalization";
import { matchOwnedAccount } from "@/lib/slip/account-match";
import { classifyDirection } from "@/lib/slip/direction";
import { suggestCategory } from "@/lib/slip/category-suggest";
import { detectDuplicate } from "@/lib/slip/duplicate";
import { evaluateConfidence } from "@/lib/slip/confidence";
import { parseSlipQrPayload } from "@/lib/slip/qr/parser";
import { Account, Category, Merchant, TransactionWithRelations } from "@/types/finance";
import { createSyntheticSlipJpeg, createSyntheticSlipPng } from "./fixtures";

describe("Phase 2 — Slip Domain Engine", () => {
  // 1. Ingest Tokens
  describe("Ingest Tokens", () => {
    it("generates random high-entropy token prefixed with finn_ingest_", () => {
      const { rawToken, tokenHash, tokenPrefix } = generateIngestToken();
      expect(rawToken.startsWith("finn_ingest_")).toBe(true);
      expect(rawToken.length).toBe(12 + 64); // "finn_ingest_" (12) + 64 hex chars
      expect(tokenHash.length).toBe(64); // SHA-256
      expect(tokenPrefix.startsWith("finn_ingest_")).toBe(true);
    });

    it("hashes token deterministically using SHA-256", () => {
      const token = "finn_ingest_testtoken1234567890abcdef1234567890abcdef";
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("verifies valid token hash using constant-time check", () => {
      const { rawToken, tokenHash } = generateIngestToken();
      expect(verifyTokenHash(rawToken, tokenHash)).toBe(true);
      expect(verifyTokenHash("finn_ingest_wrongtoken", tokenHash)).toBe(false);
      expect(verifyTokenHash("invalid_prefix_token", tokenHash)).toBe(false);
    });

    it("correctly identifies revoked or expired tokens as unusable", () => {
      expect(isTokenUsable({})).toBe(true);
      expect(isTokenUsable({ revoked_at: new Date().toISOString() })).toBe(false);
      expect(
        isTokenUsable({
          expires_at: new Date(Date.now() - 60000).toISOString(),
        })
      ).toBe(false);
      expect(
        isTokenUsable({
          expires_at: new Date(Date.now() + 60000).toISOString(),
        })
      ).toBe(true);
    });
  });

  // 2. File Validation & Storage
  describe("File Validation & Security", () => {
    it("validates genuine JPEG buffer with magic bytes", () => {
      const jpegBuf = createSyntheticSlipJpeg({ amount: 100 });
      const result = validateSlipFile(jpegBuf);
      expect(result.valid).toBe(true);
      expect(result.mime).toBe("image/jpeg");
      expect(result.extension).toBe("jpg");
    });

    it("validates genuine PNG buffer with magic bytes", () => {
      const pngBuf = createSyntheticSlipPng("Test slip data");
      const result = validateSlipFile(pngBuf);
      expect(result.valid).toBe(true);
      expect(result.mime).toBe("image/png");
      expect(result.extension).toBe("png");
    });

    it("rejects malicious file with spoofed extension and invalid magic bytes", () => {
      const fakeImage = Buffer.from("<html><script>alert(1)</script></html>", "utf-8");
      const result = validateSlipFile(fakeImage);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_MAGIC_BYTES");
    });

    it("rejects file exceeding 10 MB size limit", () => {
      // 10 MB + 1 byte
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1);
      largeBuffer[0] = 0xff;
      largeBuffer[1] = 0xd8;
      largeBuffer[2] = 0xff;
      const result = validateSlipFile(largeBuffer);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("FILE_TOO_LARGE");
    });

    it("generates privacy-safe non-identifying storage path", () => {
      const userId = "user-uuid-1234";
      const path = generateSlipStoragePath(userId, "jpg", new Date("2026-09-14T00:00:00Z"));
      expect(path.startsWith("user-uuid-1234/2026/09/")).toBe(true);
      expect(path.endsWith(".jpg")).toBe(true);
      // Ensure no account numbers or sensitive data in filename
      expect(path).not.toContain("amount");
      expect(path).not.toContain("scb");
    });
  });

  // 3. Bank Normalization
  describe("Bank Normalization", () => {
    it("normalizes Thai and English bank names accurately", () => {
      expect(normalizeBankName("ไทยพาณิชย์")).toBe("SCB");
      expect(normalizeBankName("Siam Commercial Bank")).toBe("SCB");
      expect(normalizeBankName("scbeasy")).toBe("SCB");

      expect(normalizeBankName("กสิกรไทย")).toBe("KBANK");
      expect(normalizeBankName("Kasikornbank")).toBe("KBANK");
      expect(normalizeBankName("K+")).toBe("KBANK");

      expect(normalizeBankName("กรุงเทพ")).toBe("BBL");
      expect(normalizeBankName("Bangkok Bank")).toBe("BBL");

      expect(normalizeBankName("กรุงไทย")).toBe("KTB");
      expect(normalizeBankName("Krungthai Bank")).toBe("KTB");

      expect(normalizeBankName("ทหารไทยธนชาต")).toBe("TTB");
      expect(normalizeBankName("ttb")).toBe("TTB");

      expect(normalizeBankName("พร้อมเพย์")).toBe("PROMPTPAY");
      expect(normalizeBankName("PromptPay")).toBe("PROMPTPAY");
    });
  });

  // 4. Account Matching & Multi-Account Safeguard
  describe("Account Matching", () => {
    const mockAccounts: Account[] = [
      {
        id: "acc-scb-main",
        user_id: "user-1",
        name: "SCB ออมทรัพย์",
        institution: "SCB",
        type: "bank",
        masked_number: "xxx-x-xx123-4",
        opening_balance: 1000,
        currency: "THB",
        active: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "acc-scb-savings",
        user_id: "user-1",
        name: "SCB ฝากประจำ",
        institution: "SCB",
        type: "bank",
        masked_number: "xxx-x-xx987-6",
        opening_balance: 50000,
        currency: "THB",
        active: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "acc-kbank",
        user_id: "user-1",
        name: "KBank ธุรกิจ",
        institution: "KBANK",
        type: "bank",
        masked_number: "xxx-x-xx555-5",
        opening_balance: 2000,
        currency: "THB",
        active: true,
        created_at: "",
        updated_at: "",
      },
    ];

    it("matches single bank account by bank and masked digits", () => {
      const match = matchOwnedAccount(
        { bank: "ไทยพาณิชย์", accountMasked: "x-1234" },
        mockAccounts
      );
      expect(match.accountId).toBe("acc-scb-main");
      expect(match.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("matches single bank account if bank has only one registered account", () => {
      const match = matchOwnedAccount(
        { bank: "กสิกรไทย", accountMasked: "" },
        mockAccounts
      );
      expect(match.accountId).toBe("acc-kbank");
      // Hardened safety: bank-only confidence is kept below auto-confirm threshold (< 0.85)
      expect(match.confidence).toBeLessThan(0.85);
      expect(match.confidence).toBeGreaterThanOrEqual(0.60);
      expect(match.matchMethod).toBe("bank_only");
    });

    it("STRICT SAFETY: Never matches solely by bank when user has multiple accounts at that bank", () => {
      // User has 2 SCB accounts, but slip has no digits or ambiguous digits
      const match = matchOwnedAccount(
        { bank: "ไทยพาณิชย์", accountMasked: "" },
        mockAccounts
      );
      // Must NOT guess an account! Must return null!
      expect(match.accountId).toBeNull();
      expect(match.confidence).toBeLessThan(0.5);
      expect(match.reason).toContain("Ambiguous");
    });
  });

  // 5. Direction & Suggested Transaction Type
  describe("Direction Classification", () => {
    it("classifies outgoing when sender is owned and receiver is external", () => {
      const result = classifyDirection("acc-scb-main", null);
      expect(result.direction).toBe("outgoing");
      expect(result.suggestedType).toBe("expense");
      expect(result.requiresReview).toBe(false);
    });

    it("classifies internal transfer when both accounts are owned", () => {
      const result = classifyDirection("acc-scb-main", "acc-kbank");
      expect(result.direction).toBe("internal_transfer");
      expect(result.suggestedType).toBe("transfer");
      expect(result.requiresReview).toBe(false);
    });

    it("STRICT SAFETY: Incoming external funds always requires review", () => {
      const result = classifyDirection(null, "acc-scb-main");
      expect(result.direction).toBe("incoming");
      expect(result.suggestedType).toBe("income");
      // MUST REQUIRE REVIEW: Never auto-confirm generic incoming money as income
      expect(result.requiresReview).toBe(true);
    });

    it("classifies unknown when neither party matches an owned account", () => {
      const result = classifyDirection(null, null);
      expect(result.direction).toBe("unknown");
      expect(result.requiresReview).toBe(true);
    });
  });

  // 6. Duplicate Detection
  describe("Duplicate Detection", () => {
    const mockSlips = [
      {
        id: "slip-1",
        user_id: "user-1",
        storage_path: "user-1/2026/09/file1.jpg",
        file_hash_sha256: "hash123456",
        mime_type: "image/jpeg",
        file_size: 1024,
        source: "web_upload" as const,
        parser_version: "v1",
        status: "created" as const,
        extracted_json: {
          reference: "REF-SCB-9988",
          amount: 250,
          fieldConfidence: {},
        },
        created_at: new Date().toISOString(),
      },
    ];

    const mockTransactions: TransactionWithRelations[] = [
      {
        id: "tx-1",
        user_id: "user-1",
        type: "expense",
        amount: 500,
        currency: "THB",
        transaction_date: "2026-09-14T10:00:00.000Z",
        from_account_id: "acc-scb-main",
        source: "slip",
        reference_number: "REF-BBL-1122",
        confidence: 1.0,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    it("detects exact file hash duplicate", () => {
      const result = detectDuplicate({
        userId: "user-1",
        fileHash: "hash123456",
        existingSlips: mockSlips,
        existingTransactions: mockTransactions,
      });
      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateType).toBe("exact_file");
      expect(result.matchedSlipId).toBe("slip-1");
    });

    it("detects strong reference number duplicate", () => {
      const result = detectDuplicate({
        userId: "user-1",
        fileHash: "different-hash",
        referenceNumber: "REF-SCB-9988",
        existingSlips: mockSlips,
        existingTransactions: mockTransactions,
      });
      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateType).toBe("reference_match");
    });

    it("detects conservative fuzzy duplicate and marks for review", () => {
      const result = detectDuplicate({
        userId: "user-1",
        fileHash: "different-hash",
        referenceNumber: "NEW-REF",
        amount: 500,
        // Transaction time within 2 minutes of tx-1
        transactionDate: "2026-09-14T10:02:00.000Z",
        accountId: "acc-scb-main",
        existingSlips: mockSlips,
        existingTransactions: mockTransactions,
      });
      // Conservative fuzzy match flags for review rather than silent rejection
      expect(result.duplicateType).toBe("fuzzy_match");
      expect(result.requiresReview).toBe(true);
    });
  });

  // 7. Confidence Engine Gating
  describe("Confidence Engine & Auto-Create Gating", () => {
    it("allows auto-create for strong outgoing expense", () => {
      const decision = evaluateConfidence({
        amount: 150,
        transactionDate: new Date().toISOString(),
        direction: "outgoing",
        directionRequiresReview: false,
        senderAccountId: "acc-1",
        senderAccountConfidence: 0.99,
        fieldConfidence: {
          amount: 0.99,
          transactionDate: 0.99,
          reference: 0.98,
        },
      });
      expect(decision.canAutoCreate).toBe(true);
      expect(decision.status).toBe("created");
      expect(decision.overallConfidence).toBeGreaterThanOrEqual(0.9);
    });

    it("allows auto-create for strong internal transfer", () => {
      const decision = evaluateConfidence({
        amount: 1000,
        transactionDate: new Date().toISOString(),
        direction: "internal_transfer",
        directionRequiresReview: false,
        senderAccountId: "acc-1",
        senderAccountConfidence: 0.98,
        receiverAccountId: "acc-2",
        receiverAccountConfidence: 0.98,
        fieldConfidence: {
          amount: 0.99,
          transactionDate: 0.99,
        },
      });
      expect(decision.canAutoCreate).toBe(true);
      expect(decision.status).toBe("created");
    });

    it("STRICT SAFETY: Rejects auto-create for incoming external money", () => {
      const decision = evaluateConfidence({
        amount: 5000,
        transactionDate: new Date().toISOString(),
        direction: "incoming",
        directionRequiresReview: true,
        receiverAccountId: "acc-1",
        receiverAccountConfidence: 0.99,
        fieldConfidence: {
          amount: 0.99,
          transactionDate: 0.99,
        },
      });
      expect(decision.canAutoCreate).toBe(false);
      expect(decision.status).toBe("needs_review");
      expect(decision.reasons.some((r) => r.includes("Incoming"))).toBe(true);
    });

    it("routes to review when amount confidence is below threshold", () => {
      const decision = evaluateConfidence({
        amount: 150,
        transactionDate: new Date().toISOString(),
        direction: "outgoing",
        directionRequiresReview: false,
        senderAccountId: "acc-1",
        senderAccountConfidence: 0.99,
        fieldConfidence: {
          amount: 0.85, // Below 0.98
          transactionDate: 0.99,
        },
      });
      expect(decision.canAutoCreate).toBe(false);
      expect(decision.status).toBe("needs_review");
    });
  });

  // 8. QR Parser
  describe("QR Code Parser", () => {
    it("parses test JSON QR payload", () => {
      const jsonPayload = JSON.stringify({
        amount: 189,
        currency: "THB",
        reference: "QR-12345",
      });
      const parsed = parseSlipQrPayload(jsonPayload);
      expect(parsed).not.toBeNull();
      expect(parsed?.amount).toBe(189);
      expect(parsed?.reference).toBe("QR-12345");
    });
  });
});
