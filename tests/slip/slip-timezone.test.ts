import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  canonicalInstantToBangkokDateTimeLocal,
  bangkokDateTimeLocalToCanonicalInstant,
  formatTime,
  formatDateTimeThai,
  formatDateTimeLocal,
} from "@/lib/finance/formatters";
import { parseThaiSlipDate } from "@/lib/slip/ocr/thai-slip-normalizer";
import { DataStore } from "@/lib/server/data-store";
import { confirmSlipAction, editAndConfirmSlipAction } from "@/app/actions/slip-review";
import { createTransactionAction, updateTransactionAction } from "@/app/actions/transactions";
import { Account } from "@/types/finance";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

let currentMockUser: { id: string; email: string } | null = {
  id: "tz-roundtrip-user",
  email: "tz-test@finn.local",
};

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: vi.fn(async () => currentMockUser),
  requireUser: vi.fn(async () => currentMockUser),
}));

describe("Thai Slip Bangkok Timezone Round-Trip", () => {
  const testUserId = "tz-roundtrip-user";
  let kbankAccount: Account;
  let scbAccount: Account;

  beforeEach(async () => {
    DataStore.reset();
    currentMockUser = { id: testUserId, email: "tz-test@finn.local" };

    // Create test accounts
    kbankAccount = await DataStore.createAccount(testUserId, {
      name: "KBANK Main",
      type: "bank",
      currency: "THB",
      opening_balance: 10000,
      institution: "KBANK",
      masked_number: "1234",
    });
    scbAccount = await DataStore.createAccount(testUserId, {
      name: "SCB Savings",
      type: "bank",
      currency: "THB",
      opening_balance: 5000,
      institution: "SCB",
      masked_number: "5678",
    });
  });

  describe("1. Canonical Timezone Helpers Unit Tests", () => {
    it("converts canonical UTC instant to Bangkok datetime-local string (Asia/Bangkok = UTC+7)", () => {
      // 13:08 UTC = 20:08 Bangkok
      const canonicalUtc = "2026-09-15T13:08:00.000Z";
      const dtLocal = canonicalInstantToBangkokDateTimeLocal(canonicalUtc);
      expect(dtLocal).toBe("2026-09-15T20:08");

      // formatDateTimeLocal backwards-compatibility wrapper behaves identically
      expect(formatDateTimeLocal(canonicalUtc)).toBe("2026-09-15T20:08");
    });

    it("converts Bangkok datetime-local string without timezone to canonical UTC instant", () => {
      // 20:08 Bangkok = 13:08 UTC
      const dtLocal = "2026-09-15T20:08";
      const canonicalUtc = bangkokDateTimeLocalToCanonicalInstant(dtLocal);
      expect(canonicalUtc).toBe("2026-09-15T13:08:00.000Z");
    });

    it("preserves canonical UTC instant without reinterpreting UTC components as local time", () => {
      const canonicalUtc = "2026-09-15T13:08:00.000Z";
      const result = bangkokDateTimeLocalToCanonicalInstant(canonicalUtc);
      expect(result).toBe("2026-09-15T13:08:00.000Z");
    });

    it("does not drift across multiple round-trips (idempotent round-trip)", () => {
      const originalCanonical = "2026-09-15T13:08:00.000Z";
      let currentCanonical = originalCanonical;

      // Simulate 10 open-and-save cycles
      for (let i = 0; i < 10; i++) {
        const dtLocal = canonicalInstantToBangkokDateTimeLocal(currentCanonical);
        expect(dtLocal).toBe("2026-09-15T20:08");
        const nextCanonical = bangkokDateTimeLocalToCanonicalInstant(dtLocal);
        expect(nextCanonical).toBe(originalCanonical);
        currentCanonical = nextCanonical!;
      }
    });

    it("handles midnight boundaries correctly without shifting calendar day", () => {
      // 2026-09-16 00:05 in Bangkok is 2026-09-15 17:05:00.000Z
      const midnightLocal = "2026-09-16T00:05";
      const canonical = bangkokDateTimeLocalToCanonicalInstant(midnightLocal);
      expect(canonical).toBe("2026-09-15T17:05:00.000Z");

      const backToLocal = canonicalInstantToBangkokDateTimeLocal(canonical!);
      expect(backToLocal).toBe("2026-09-16T00:05");

      // 2026-09-15 23:55 in Bangkok is 2026-09-15 16:55:00.000Z
      const lateLocal = "2026-09-15T23:55";
      const canonicalLate = bangkokDateTimeLocalToCanonicalInstant(lateLocal);
      expect(canonicalLate).toBe("2026-09-15T16:55:00.000Z");

      const backToLate = canonicalInstantToBangkokDateTimeLocal(canonicalLate!);
      expect(backToLate).toBe("2026-09-15T23:55");
    });

    it("normalizes Buddhist Era year (BE 2569 -> CE 2026)", () => {
      const beLocal = "2569-09-15T20:08";
      const canonical = bangkokDateTimeLocalToCanonicalInstant(beLocal);
      expect(canonical).toBe("2026-09-15T13:08:00.000Z");
    });
  });

  describe("2. Observed Production Case: 15 Sep 2026 20:08 Asia/Bangkok", () => {
    it("completes full round-trip: Slip OCR -> Review UI -> Edit & Confirm -> Transactions UI = 20:08", async () => {
      // 1. Slip OCR extraction: Thai bank slip with visible time 15 Sep 2026 20:08
      const rawSlipTime = "15 Sep 2026 20:08";
      const extractedIso = parseThaiSlipDate(rawSlipTime);
      expect(extractedIso).toBe("2026-09-15T13:08:00.000Z");

      // 2. Review Inbox card display
      const reviewInboxDisplay = formatTime(extractedIso!);
      expect(reviewInboxDisplay).toBe("20:08");
      expect(formatDateTimeThai(extractedIso!)).toContain("20:08");

      // 3. User opens Edit Modal: form initialized with Bangkok datetime-local
      const editFormValue = canonicalInstantToBangkokDateTimeLocal(extractedIso!);
      expect(editFormValue).toBe("2026-09-15T20:08");

      // 4. Ingest slip into DataStore
      const slip = await DataStore.createSlip(testUserId, {
        storage_path: "test/slip-prod-case.jpg",
        file_hash_sha256: "hash-prod-case-12345",
        mime_type: "image/jpeg",
        file_size: 1024,
        source: "ios_shortcut",
        status: "needs_review",
        overall_confidence: 0.95,
        extracted_json: {
          fieldConfidence: {},
          amount: 500.0,
          currency: "THB",
          transactionDate: extractedIso,
          sender: { bank: "KBANK", name: "คุณสมชาย", accountMasked: "1234" },
          receiver: { bank: "SCB", name: "ร้านค้าอาหาร" },
        },
      });

      // 5. User submits Edit Modal WITHOUT changing date (or with custom note)
      const canonicalTxDate = bangkokDateTimeLocalToCanonicalInstant(editFormValue);
      expect(canonicalTxDate).toBe("2026-09-15T13:08:00.000Z");

      const editResult = await editAndConfirmSlipAction(slip.id, {
        type: "expense",
        amount: 500.0,
        currency: "THB",
        transaction_date: canonicalTxDate!,
        description: "ชำระค่าอาหาร",
        note: "ทดสอบยืนยัน",
        from_account_id: kbankAccount.id,
        to_account_id: null,
        category_id: null,
        merchant_id: null,
        person_id: null,
        source: "slip",
        tax_deductible: false,
      });

      expect(editResult.error).toBeUndefined();
      expect(editResult.success).toBe(true);
      expect(editResult.transactionId).toBeDefined();

      // 6. Verify Transaction in DataStore
      const tx = await DataStore.getTransactionById(testUserId, editResult.transactionId!);
      expect(tx).not.toBeNull();
      // Canonical instant in DB must be exactly 13:08:00.000Z
      expect(tx?.transaction_date).toBe("2026-09-15T13:08:00.000Z");

      // 7. Transactions UI display: formatTime must show 20:08 (NOT 13:08!)
      const txDisplayTime = formatTime(tx!.transaction_date);
      expect(txDisplayTime).toBe("20:08");
      expect(txDisplayTime).not.toBe("13:08");
      expect(formatDateTimeThai(tx!.transaction_date)).toContain("20:08");

      // 8. Invariant: opening edit and saving without date change does NOT record spurious correction
      const corrections = await DataStore.getSlipCorrections(testUserId, slip.id);
      const dateCorrection = corrections.find((c) => c.field_name === "transaction_date");
      expect(dateCorrection).toBeUndefined();
    });

    it("produces identical canonical instant between Direct Confirm and Edit & Confirm", async () => {
      const rawSlipTime = "15 Sep 2026 20:08";
      const extractedIso = parseThaiSlipDate(rawSlipTime)!;

      // Slip A: will be Direct Confirmed
      const slipA = await DataStore.createSlip(testUserId, {
        storage_path: "test/slip-direct.jpg",
        file_hash_sha256: "hash-direct-12345",
        mime_type: "image/jpeg",
        file_size: 1024,
        source: "ios_shortcut",
        status: "needs_review",
        overall_confidence: 0.95,
        extracted_json: {
          fieldConfidence: {},
          amount: 250.0,
          currency: "THB",
          transactionDate: extractedIso,
          sender: { bank: "KBANK", name: "สมชาย", accountMasked: "1234" },
          receiver: { bank: "SCB", name: "ร้านกาแฟ" },
        },
      });

      // Slip B: will be Edit & Confirmed
      const slipB = await DataStore.createSlip(testUserId, {
        storage_path: "test/slip-edit.jpg",
        file_hash_sha256: "hash-edit-12345",
        mime_type: "image/jpeg",
        file_size: 1024,
        source: "ios_shortcut",
        status: "needs_review",
        overall_confidence: 0.95,
        extracted_json: {
          fieldConfidence: {},
          amount: 250.0,
          currency: "THB",
          transactionDate: extractedIso,
          sender: { bank: "KBANK", name: "สมชาย", accountMasked: "1234" },
          receiver: { bank: "SCB", name: "ร้านกาแฟ" },
        },
      });

      // Execute Direct Confirm on Slip A
      const resA = await confirmSlipAction(slipA.id);
      expect(resA.error).toBeUndefined();
      expect(resA.success).toBe(true);
      const txA = await DataStore.getTransactionById(testUserId, resA.transactionId!);

      // Execute Edit & Confirm on Slip B (opened in edit form at 20:08 Bangkok)
      const editValB = canonicalInstantToBangkokDateTimeLocal(extractedIso);
      const canonicalB = bangkokDateTimeLocalToCanonicalInstant(editValB);
      const resB = await editAndConfirmSlipAction(slipB.id, {
        type: "expense",
        amount: 250.0,
        currency: "THB",
        transaction_date: canonicalB!,
        description: "ชำระเงิน",
        note: null,
        from_account_id: kbankAccount.id,
        to_account_id: null,
        category_id: null,
        merchant_id: null,
        person_id: null,
        source: "slip",
        tax_deductible: false,
      });
      expect(resB.error).toBeUndefined();
      expect(resB.success).toBe(true);
      const txB = await DataStore.getTransactionById(testUserId, resB.transactionId!);

      // Strict Equality Invariant:
      expect(txA?.transaction_date).toBe("2026-09-15T13:08:00.000Z");
      expect(txB?.transaction_date).toBe("2026-09-15T13:08:00.000Z");
      expect(txA?.transaction_date).toBe(txB?.transaction_date);

      // Both format to 20:08 in UI
      expect(formatTime(txA!.transaction_date)).toBe("20:08");
      expect(formatTime(txB!.transaction_date)).toBe("20:08");
    });
  });

  describe("3. Manual Transaction Form Actions Timezone Tests", () => {
    it("creates transaction with Bangkok datetime-local and stores as canonical UTC", async () => {
      const formData = new FormData();
      formData.append("type", "expense");
      formData.append("amount", "120");
      formData.append("currency", "THB");
      formData.append("transaction_date", "2026-09-15T20:08");
      formData.append("from_account_id", kbankAccount.id);
      formData.append("description", "Manual entry test");

      const res = await createTransactionAction(null, formData);
      expect(res.success).toBe(true);

      const txs = await DataStore.getTransactions(testUserId);
      const created = txs.find((t) => t.description === "Manual entry test");
      expect(created).toBeDefined();
      expect(created?.transaction_date).toBe("2026-09-15T13:08:00.000Z");
      expect(formatTime(created!.transaction_date)).toBe("20:08");
    });

    it("updates transaction date without drift", async () => {
      const tx = await DataStore.createTransaction(testUserId, {
        type: "expense",
        amount: 100,
        currency: "THB",
        transaction_date: "2026-09-15T13:08:00.000Z",
        from_account_id: kbankAccount.id,
        description: "To update",
        source: "manual",
      });

      const formData = new FormData();
      formData.append("type", "expense");
      formData.append("amount", "100");
      formData.append("currency", "THB");
      // User updates time to 21:15
      formData.append("transaction_date", "2026-09-15T21:15");
      formData.append("from_account_id", kbankAccount.id);
      formData.append("description", "Updated description");

      const res = await updateTransactionAction(tx.id, null, formData);
      expect(res.success).toBe(true);

      const updated = await DataStore.getTransactionById(testUserId, tx.id);
      expect(updated?.transaction_date).toBe("2026-09-15T14:15:00.000Z");
      expect(formatTime(updated!.transaction_date)).toBe("21:15");
    });
  });
});
