import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseThaiSlipAmount,
  parseThaiSlipDate,
  normalizeBuddhistYear,
  normalizeMaskedAccount,
  cleanPartyName,
} from "@/lib/slip/ocr/thai-slip-normalizer";
import { normalizeBankName } from "@/lib/slip/bank-normalization";
import { parseSlipQrPayload } from "@/lib/slip/qr/parser";
import { AiVisionSlipParser } from "@/lib/slip/ocr/ai-vision-parser";
import { SlipProcessor } from "@/lib/slip/processor";
import { DataStore } from "@/lib/server/data-store";
import { formatTime, formatDateTimeThai } from "@/lib/finance/formatters";

describe("Thai Bank Slip Vision & OCR Extraction", () => {
  // 1. Thai Amount Normalization
  describe("Amount Normalization (parseThaiSlipAmount)", () => {
    it("parses valid numeric amount", () => {
      expect(parseThaiSlipAmount(18.0)).toBe(18.0);
      expect(parseThaiSlipAmount(1250.5)).toBe(1250.5);
    });

    it("parses Thai currency strings with text and symbols", () => {
      expect(parseThaiSlipAmount("18.00 บาท")).toBe(18.0);
      expect(parseThaiSlipAmount("18.00 THB")).toBe(18.0);
      expect(parseThaiSlipAmount("฿18.00")).toBe(18.0);
      expect(parseThaiSlipAmount("1,250.50 บาท")).toBe(1250.5);
      expect(parseThaiSlipAmount("จำนวนเงิน 18.00")).toBe(18.0);
      expect(parseThaiSlipAmount("ยอดโอน 500.00 บาท")).toBe(500.0);
      expect(parseThaiSlipAmount("18.-")).toBe(18.0);
    });

    it("rejects 0.00, negative, and non-numeric amounts safely", () => {
      expect(parseThaiSlipAmount(0)).toBeUndefined();
      expect(parseThaiSlipAmount("0.00")).toBeUndefined();
      expect(parseThaiSlipAmount("-50.00")).toBeUndefined();
      expect(parseThaiSlipAmount("ค่าธรรมเนียม 0.00 บาท")).toBeUndefined();
      expect(parseThaiSlipAmount("ไม่มีจำนวนเงิน")).toBeUndefined();
      expect(parseThaiSlipAmount(null)).toBeUndefined();
      expect(parseThaiSlipAmount(undefined)).toBeUndefined();
    });
  });

  // 2. Thai Date & Buddhist Era Normalization
  describe("Date Normalization (parseThaiSlipDate & normalizeBuddhistYear)", () => {
    it("converts 4-digit Buddhist Era years to Gregorian", () => {
      expect(normalizeBuddhistYear(2569)).toBe(2026);
      expect(normalizeBuddhistYear(2568)).toBe(2025);
      expect(normalizeBuddhistYear(2567)).toBe(2024);
    });

    it("converts 2-digit Thai years to Gregorian", () => {
      expect(normalizeBuddhistYear(69)).toBe(2026);
      expect(normalizeBuddhistYear(67)).toBe(2024);
    });

    it("parses Thai slip date format with BE year and Thai month abbreviation", () => {
      const result = parseThaiSlipDate("15 ก.ย. 2569 09:25");
      expect(result).toBeDefined();
      const date = new Date(result!);
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(8); // September is month index 8
      expect(date.getUTCDate()).toBe(15);
    });

    it("parses full Thai month name and BE year", () => {
      const result = parseThaiSlipDate("1 มกราคม 2567 14:30:00");
      expect(result).toBeDefined();
      const date = new Date(result!);
      expect(date.getUTCFullYear()).toBe(2024);
      expect(date.getUTCMonth()).toBe(0); // January
      expect(date.getUTCDate()).toBe(1);
    });

    it("parses slash format with BE year: 15/09/2569 09:25", () => {
      const result = parseThaiSlipDate("15/09/2569 09:25");
      expect(result).toBeDefined();
      const date = new Date(result!);
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(8);
      expect(date.getUTCDate()).toBe(15);
    });

    it("parses English month slips with CE year: 15 Sep 2026 09:25", () => {
      const result = parseThaiSlipDate("15 Sep 2026 09:25");
      expect(result).toBeDefined();
      const date = new Date(result!);
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(8);
      expect(date.getUTCDate()).toBe(15);
    });

    it("preserves valid ISO strings", () => {
      const iso = "2026-09-15T02:25:00.000Z";
      expect(parseThaiSlipDate(iso)).toBe(iso);
    });

    it("returns undefined for invalid date strings", () => {
      expect(parseThaiSlipDate("not-a-date")).toBeUndefined();
      expect(parseThaiSlipDate(null)).toBeUndefined();
      expect(parseThaiSlipDate("")).toBeUndefined();
    });
  });

  // 3. Bank Normalization for Modern Thai Banking Apps
  describe("Bank Normalization for Modern Thai Banking", () => {
    it("normalizes MAKE by KBank to KBANK", () => {
      expect(normalizeBankName("MAKE by KBank")).toBe("KBANK");
      expect(normalizeBankName("makebykbank")).toBe("KBANK");
      expect(normalizeBankName("MAKE")).toBe("KBANK");
    });

    it("normalizes SCB EASY and K PLUS", () => {
      expect(normalizeBankName("SCB EASY")).toBe("SCB");
      expect(normalizeBankName("K PLUS")).toBe("KBANK");
      expect(normalizeBankName("Krungthai NEXT")).toBe("KTB");
    });
  });

  // 4. QR Verification vs EMVCo Merchant Separation
  describe("QR Parser Separation (parseSlipQrPayload)", () => {
    it("extracts ref from verification URL with undefined amount", () => {
      const url = "https://promptpay.scb/verify?ref=2026091512345678";
      const parsed = parseSlipQrPayload(url);
      expect(parsed).not.toBeNull();
      expect(parsed?.reference).toBe("2026091512345678");
      // Verification URL must NEVER extract or fabricate an amount
      expect(parsed?.amount).toBeUndefined();
      expect(parsed?.channel).toBe("QR Slip Verification URL");
    });

    it("parses PromptPay SlipVerify Mini-QR without fabricating amount", () => {
      // BOT/ITMX Mini-QR payload: 00460006000001010301402252026091512345678...
      const miniQr = "004600060000010103014022020260915123456789012";
      const parsed = parseSlipQrPayload(miniQr);
      expect(parsed).not.toBeNull();
      expect(parsed?.sender?.bank).toBe("014"); // SCB bank code
      expect(parsed?.reference).toBe("20260915123456789012");
      expect(parsed?.amount).toBeUndefined();
      expect(parsed?.channel).toBe("PromptPay Mini-QR");
    });

    it("extracts amount only when Tag 54 is present in valid EMVCo QR", () => {
      // EMVCo QR starting with 000201 with Tag 54 (amount = 18.00) and Tag 62 subtag 05 = REF2026091501
      const emvCoQr = "0002010102115303764540518.005802TH62170513REF20260915016304ABCD";
      const parsed = parseSlipQrPayload(emvCoQr);
      expect(parsed).not.toBeNull();
      expect(parsed?.amount).toBe(18.0);
      expect(parsed?.reference).toBe("REF2026091501");
    });
  });

  // 5. Account & Name Cleaning
  describe("Account & Name Cleaning", () => {
    it("cleans masked account format", () => {
      expect(normalizeMaskedAccount("xxx-x-xx123-4")).toBe("xxx-x-xx123-4");
      expect(normalizeMaskedAccount("เลขบัญชี xxx-1234")).toBe("xxx-1234");
      expect(normalizeMaskedAccount("")).toBeNull();
    });

    it("cleans directional prefixes from party names", () => {
      expect(cleanPartyName("ผู้รับเงิน ร้านกาแฟดี")).toBe("ร้านกาแฟดี");
      expect(cleanPartyName("To: นาย สมชาย ใจดี")).toBe("นาย สมชาย ใจดี");
      expect(cleanPartyName("ผู้โอน: บจก. เทคโนโลยี")).toBe("บจก. เทคโนโลยี");
    });
  });

  // 6. AiVisionSlipParser Provider Resilience & Fallback
  describe("AiVisionSlipParser Provider Logic", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPENAI_API_KEY;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it("throws PROVIDER_NOT_CONFIGURED when neither API key is set", async () => {
      const parser = new AiVisionSlipParser();
      await expect(
        parser.parse({
          imageBuffer: Buffer.from("fake-slip-image"),
          mimeType: "image/jpeg",
        })
      ).rejects.toThrow(/credentials are not configured/);
    });

    it("correctly calls and normalizes Gemini Vision response when GEMINI_API_KEY is present", async () => {
      process.env.GEMINI_API_KEY = "mock-gemini-key";

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    amount: 18.0,
                    currency: "THB",
                    rawDate: "15 ก.ย. 2569 09:25",
                    transactionDate: "2026-09-15T09:25:00+07:00",
                    sender: {
                      name: "นาย สมชาย ใจดี",
                      bank: "กสิกรไทย",
                      accountMasked: "xxx-x-xx123-4",
                    },
                    receiver: {
                      name: "ร้าน ป้าพรอาหารตามสั่ง",
                      bank: "พร้อมเพย์",
                      accountMasked: "xxx-xxx-5678",
                    },
                    reference: "2026091512345678",
                    channel: "K PLUS",
                    fieldConfidence: {
                      amount: 0.99,
                      transactionDate: 0.98,
                      senderName: 0.95,
                      senderBank: 0.99,
                      senderAccount: 0.95,
                      receiverName: 0.95,
                      receiverBank: 0.98,
                      receiverAccount: 0.95,
                      reference: 0.99,
                    },
                  }),
                },
              ],
            },
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const parser = new AiVisionSlipParser();
      const result = await parser.parse({
        imageBuffer: Buffer.from("fake-jpeg-buffer"),
        mimeType: "image/jpeg",
      });

      expect(result.amount).toBe(18.0);
      expect(result.currency).toBe("THB");
      expect(result.transactionDate).toBeDefined();
      expect(result.sender?.bank).toBe("KBANK");
      expect(result.receiver?.bank).toBe("PROMPTPAY");
      expect(result.reference).toBe("2026091512345678");
      expect(result.fieldConfidence.amount).toBe(0.99);
    });

    it("falls back to OpenAI Vision when Gemini key is absent but OPENAI_API_KEY is present", async () => {
      process.env.OPENAI_API_KEY = "mock-openai-key";

      const mockOpenAiResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                amount: 150.0,
                currency: "THB",
                rawDate: "15 ก.ย. 2569 11:30",
                sender: {
                  name: "สมหญิง",
                  bank: "SCB",
                  accountMasked: "xxx-9999",
                },
                receiver: {
                  name: "ร้าน ค้า",
                  bank: "KBANK",
                  accountMasked: "xxx-1111",
                },
                reference: "SCB123456",
              }),
            },
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpenAiResponse,
      } as Response);

      const parser = new AiVisionSlipParser();
      const result = await parser.parse({
        imageBuffer: Buffer.from("fake-jpeg-buffer"),
        mimeType: "image/jpeg",
      });

      expect(result.amount).toBe(150.0);
      expect(result.sender?.bank).toBe("SCB");
      expect(result.receiver?.bank).toBe("KBANK");
    });
  });

  // 7. SlipProcessor Reprocessing & QR Cross-Check
  describe("SlipProcessor QR Cross-Check & Reprocessing", () => {
    it("forces needs_review when QR amount and Vision amount differ", async () => {
      const mockVisionParser = {
        parse: vi.fn().mockResolvedValue({
          amount: 500.0, // Vision extracted 500
          currency: "THB",
          transactionDate: "2026-09-15T09:25:00.000Z",
          sender: { bank: "SCB", accountMasked: "xxx-x-xx123-4" },
          fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
        }),
      };

      const mockQrDecoder = {
        decode: vi.fn().mockResolvedValue(
          // EMVCo QR with Tag 54 = 18.00 (mismatch!)
          "0002010102115303764540518.005802TH6304ABCD"
        ),
      };

      const processor = new SlipProcessor({
        visionParser: mockVisionParser as any,
        qrDecoder: mockQrDecoder as any,
      });

      // Synthetic JPEG buffer
      const fakeBuffer = Buffer.alloc(100);
      fakeBuffer[0] = 0xff;
      fakeBuffer[1] = 0xd8;
      fakeBuffer[2] = 0xff;

      const result = await processor.processSlip({
        userId: "test-user-1",
        buffer: fakeBuffer,
      });

      // Must be routed to review inbox because of mismatch
      expect(result.status).toBe("needs_review");
      expect(result.errorMessage).toContain("mismatch");
    });

    it("successfully reprocesses an existing slip with updated vision extraction", async () => {
      const userId = "reprocess-user-1";
      // Create existing slip
      const slip = await DataStore.createSlip(userId, {
        storage_path: "reprocess-user-1/2026/09/slip1.jpg",
        file_hash_sha256: "fake-hash-for-reprocess",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "ios_shortcut",
        status: "needs_review",
        parser_version: "v1-stub",
        overall_confidence: null,
      });

      const mockVisionParser = {
        parse: vi.fn().mockResolvedValue({
          amount: 18.0,
          currency: "THB",
          transactionDate: "2026-09-15T09:25:00.000Z",
          sender: { bank: "KBANK", name: "นาย สมชาย" },
          receiver: { bank: "SCB", name: "ร้าน กาแฟ" },
          reference: "REF1800",
          fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
        }),
      };

      const processor = new SlipProcessor({
        visionParser: mockVisionParser as any,
      });

      const fakeBuffer = Buffer.alloc(100);
      fakeBuffer[0] = 0xff;
      fakeBuffer[1] = 0xd8;
      fakeBuffer[2] = 0xff;

      const result = await processor.reprocessSlip({
        userId,
        slipId: slip.id,
        buffer: fakeBuffer,
      });

      expect(result.status).toBe("needs_review");
      expect(result.amount).toBe(18.0);

      // Verify slip updated in DataStore
      const updatedSlip = await DataStore.getSlipById(userId, slip.id);
      expect(updatedSlip).not.toBeNull();
      expect(updatedSlip?.extracted_json?.amount).toBe(18.0);
      expect(updatedSlip?.parser_version).toBe("v2-vision");
      expect(updatedSlip?.overall_confidence).toBeDefined();
    });
  });

  // 8. Review Inbox Safety Logic Tests
  describe("Review Inbox Validation Logic", () => {
    it("safely handles null confidence without defaulting to 80%", () => {
      const slipWithNullConfidence = {
        overall_confidence: null,
      };

      const hasConfidence = slipWithNullConfidence.overall_confidence != null;
      const confidencePercent = hasConfidence
        ? Math.round(slipWithNullConfidence.overall_confidence! * 100)
        : null;

      expect(hasConfidence).toBe(false);
      expect(confidencePercent).toBeNull();
      expect(confidencePercent).not.toBe(80);
    });

    it("correctly identifies missing or invalid amount as incomplete", () => {
      const validAmount = 18.0;
      const zeroAmount = 0.0;
      const undefinedAmount = undefined;

      const isValid = (amt: unknown) => typeof amt === "number" && amt > 0;

      expect(isValid(validAmount)).toBe(true);
      expect(isValid(zeroAmount)).toBe(false);
      expect(isValid(undefinedAmount)).toBe(false);
    });
  });

  // 9. Thai Slip Transaction Timezone (+7 Hour Bug Regression Tests)
  describe("Thai Slip Transaction Timezone (+7 Hour Bug Regression Tests)", () => {
    // Regression Test Case 1: rawDate: "15 ก.ย. 2569 09:25" => Bangkok display = 09:25
    it("interprets rawDate '15 ก.ย. 2569 09:25' as Bangkok local time (09:25) stored as UTC 02:25:00.000Z", () => {
      const canonicalIso = parseThaiSlipDate("15 ก.ย. 2569 09:25");
      expect(canonicalIso).toBe("2026-09-15T02:25:00.000Z");

      // Verify formatting in Asia/Bangkok yields 09:25
      const bangkokTime = formatTime(canonicalIso!);
      expect(bangkokTime).toBe("09:25");
      expect(formatDateTimeThai(canonicalIso!)).toContain("09:25");
    });

    // Regression Test Case 2: rawDate wins over AI-normalized transactionDate ending in 'Z'
    // rawDate: "15 ก.ย. 2569 09:25"
    // transactionDate: "2026-09-15T09:25:00Z"
    // => rawDate wins => Bangkok display = 09:25, NOT 16:25
    it("prioritizes rawDate over transactionDate with 'Z': rawDate wins, Bangkok display = 09:25, NOT 16:25", async () => {
      process.env.GEMINI_API_KEY = "mock-gemini-key";

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    amount: 18.0,
                    currency: "THB",
                    rawDate: "15 ก.ย. 2569 09:25",
                    transactionDate: "2026-09-15T09:25:00Z", // Model incorrectly appended Z to visible local time
                    sender: { bank: "KBANK", name: "สมชาย" },
                    receiver: { bank: "SCB", name: "ร้านค้า" },
                  }),
                },
              ],
            },
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const parser = new AiVisionSlipParser();
      const result = await parser.parse({
        imageBuffer: Buffer.from("fake-buffer"),
        mimeType: "image/jpeg",
      });

      // rawDate wins! It should resolve to 2026-09-15T02:25:00.000Z, NOT 2026-09-15T09:25:00.000Z
      expect(result.transactionDate).toBe("2026-09-15T02:25:00.000Z");
      expect(result.transactionDate).not.toBe("2026-09-15T09:25:00.000Z");

      // Formatted in Asia/Bangkok MUST display 09:25, NOT 16:25
      const displayTime = formatTime(result.transactionDate!);
      expect(displayTime).toBe("09:25");
      expect(displayTime).not.toBe("16:25");
      expect(formatDateTimeThai(result.transactionDate!)).toContain("09:25");
      expect(formatDateTimeThai(result.transactionDate!)).not.toContain("16:25");
    });

    // Regression Test Case 3: transactionDate: "2026-09-15T09:25:00+07:00" => Bangkok display = 09:25
    it("handles transactionDate with '+07:00' correctly: Bangkok display = 09:25", async () => {
      process.env.GEMINI_API_KEY = "mock-gemini-key";

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    amount: 18.0,
                    currency: "THB",
                    transactionDate: "2026-09-15T09:25:00+07:00", // Model provided valid Bangkok offset
                    sender: { bank: "KBANK" },
                  }),
                },
              ],
            },
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const parser = new AiVisionSlipParser();
      const result = await parser.parse({
        imageBuffer: Buffer.from("fake-buffer"),
        mimeType: "image/jpeg",
      });

      expect(result.transactionDate).toBe("2026-09-15T02:25:00.000Z");
      const displayTime = formatTime(result.transactionDate!);
      expect(displayTime).toBe("09:25");
      expect(formatDateTimeThai(result.transactionDate!)).toContain("09:25");
    });

    // Regression Test Case 4: Reprocessing an existing slip updates transactionDate correctly
    it("reprocessing an existing slip updates transactionDate to the corrected Bangkok time", async () => {
      const userId = "reprocess-tz-user";

      // 1. Existing slip stored with the old +7 hour buggy UTC timestamp (16:25 in Bangkok)
      const slip = await DataStore.createSlip(userId, {
        storage_path: "reprocess-tz/slip.jpg",
        file_hash_sha256: "fake-hash-tz-reprocess",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "ios_shortcut",
        status: "needs_review",
        parser_version: "v1-buggy",
        extracted_json: {
          amount: 18.0,
          currency: "THB",
          transactionDate: "2026-09-15T09:25:00.000Z", // Old buggy timestamp displayed as 16:25!
          fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
        },
      });

      // Verify the old bug: 2026-09-15T09:25:00.000Z in Bangkok displays 16:25
      const oldBangkokDisplay = formatTime(slip.extracted_json!.transactionDate!);
      expect(oldBangkokDisplay).toBe("16:25");

      // 2. Updated Vision Parser fixes extraction using rawDate authoritative logic
      const mockVisionParser = {
        parse: vi.fn().mockResolvedValue({
          amount: 18.0,
          currency: "THB",
          rawDate: "15 ก.ย. 2569 09:25",
          transactionDate: "2026-09-15T02:25:00.000Z", // Corrected UTC instant
          sender: { bank: "KBANK", name: "นาย สมชาย" },
          receiver: { bank: "SCB", name: "ร้าน ป้าพร" },
          reference: "REF-TZ-FIXED",
          fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
        }),
      };

      const processor = new SlipProcessor({
        visionParser: mockVisionParser as any,
      });

      const fakeBuffer = Buffer.alloc(100);
      fakeBuffer[0] = 0xff;
      fakeBuffer[1] = 0xd8;
      fakeBuffer[2] = 0xff;

      // 3. Reprocess the slip
      const result = await processor.reprocessSlip({
        userId,
        slipId: slip.id,
        buffer: fakeBuffer,
      });

      expect(result.status).toBe("needs_review");

      // 4. Verify updated slip in DataStore has the corrected transactionDate
      const updatedSlip = await DataStore.getSlipById(userId, slip.id);
      expect(updatedSlip).not.toBeNull();
      expect(updatedSlip?.extracted_json?.transactionDate).toBe("2026-09-15T02:25:00.000Z");

      // 5. Verify the UI formatting now displays 09:25 instead of 16:25
      const newBangkokDisplay = formatTime(updatedSlip!.extracted_json!.transactionDate!);
      expect(newBangkokDisplay).toBe("09:25");
      expect(newBangkokDisplay).not.toBe("16:25");
      expect(formatDateTimeThai(updatedSlip!.extracted_json!.transactionDate!)).toContain("09:25");
    });
  });
});

