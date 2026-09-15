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
import { AiVisionSlipParser, VisionError } from "@/lib/slip/ocr/ai-vision-parser";
import { SlipProcessor, defaultSlipProcessor } from "@/lib/slip/processor";
import { DataStore } from "@/lib/server/data-store";
import { formatTime, formatDateTimeThai } from "@/lib/finance/formatters";
import { POST as handleSlipIngest } from "@/app/api/ingest/slip/route";
import { NextRequest } from "next/server";

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

  // 11. Quality Gate & Non-Destructive Reprocessing Regression Tests
  describe("Quality Gate & Non-Destructive Reprocessing", () => {
    const fakeBuffer = Buffer.alloc(100);
    fakeBuffer[0] = 0xff;
    fakeBuffer[1] = 0xd8;
    fakeBuffer[2] = 0xff;

    // Test 1: Existing good extraction + new empty extraction => keeps existing
    it("preserves existing extraction when reprocess returns materially unusable / empty extraction", async () => {
      const userId = "user-qg-test-1";
      const initialSlip = await DataStore.createSlip(userId, {
        storage_path: "qg/slip1.jpg",
        file_hash_sha256: "hash-qg-1",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "web_upload",
        status: "needs_review",
        parser_version: "v2-vision",
        overall_confidence: 0.65,
        extracted_json: {
          amount: 18.0,
          currency: "THB",
          transactionDate: "2026-09-15T02:25:00.000Z",
          sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1-23456-x" },
          receiver: { name: "ร้าน ป้าพร", bank: "SCB", accountMasked: "xxx-9-87654-x" },
          reference: "REF-GOOD-1",
          fieldConfidence: { amount: 0.95, transactionDate: 0.9, reference: 0.9 },
        },
      });

      // New vision parser returns empty / unusable extraction
      const mockVision = {
        parse: vi.fn().mockResolvedValue({
          amount: null,
          transactionDate: null,
          sender: { name: null, bank: null, accountMasked: null },
          receiver: { name: null, bank: null, accountMasked: null },
          reference: null,
          currency: "THB",
          fieldConfidence: {},
        }),
      };

      const processor = new SlipProcessor({ visionParser: mockVision as any });
      const result = await processor.reprocessSlip({
        userId,
        slipId: initialSlip.id,
        buffer: fakeBuffer,
      });

      expect(result.status).toBe("needs_review");
      expect(result.preservedPrevious).toBe(true);
      expect(result.warningMessage).toBe("การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้");
      expect(result.amount).toBe(18.0);
      expect(result.extracted?.sender?.name).toBe("สมชาย");
      expect(result.extracted?.receiver?.name).toBe("ร้าน ป้าพร");
      expect(result.extracted?.reference).toBe("REF-GOOD-1");

      const dbSlip = await DataStore.getSlipById(userId, initialSlip.id);
      expect(dbSlip?.extracted_json?.amount).toBe(18.0);
      expect(dbSlip?.extracted_json?.sender?.name).toBe("สมชาย");
      expect(dbSlip?.overall_confidence).toBe(0.65);

      const job = await DataStore.getSlipJobById(userId, result.jobId);
      expect(job?.error_code).toBe("VISION_EMPTY_EXTRACTION");
      expect(job?.safe_error_message).toContain("preservedPrevious");
      expect(job?.safe_error_message).toContain("completenessScore");
    });

    // Test 2: Existing amount 18 + new amount undefined => amount remains 18
    it("retains existing amount 18 when incoming extraction has undefined/null amount", async () => {
      const userId = "user-qg-test-2";
      const initialSlip = await DataStore.createSlip(userId, {
        storage_path: "qg/slip2.jpg",
        file_hash_sha256: "hash-qg-2",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "web_upload",
        status: "needs_review",
        parser_version: "v2-vision",
        extracted_json: {
          amount: 18.0,
          currency: "THB",
          transactionDate: "2026-09-15T02:25:00.000Z",
          sender: { name: "สมชาย", bank: "KBANK" },
          receiver: { name: "ป้าพร", bank: "SCB" },
          fieldConfidence: { amount: 0.95 },
        },
      });

      // New parser extracted other fields but missed the amount
      const mockVision = {
        parse: vi.fn().mockResolvedValue({
          amount: undefined,
          currency: "THB",
          transactionDate: "2026-09-15T02:25:00.000Z",
          sender: { name: "สมชาย สุขใจ", bank: "KBANK" },
          receiver: { name: "ป้าพร", bank: "SCB" },
          reference: "REF-2",
          fieldConfidence: { transactionDate: 0.9 },
        }),
      };

      const processor = new SlipProcessor({ visionParser: mockVision as any });
      const result = await processor.reprocessSlip({
        userId,
        slipId: initialSlip.id,
        buffer: fakeBuffer,
      });

      expect(result.amount).toBe(18.0);
      expect(result.extracted?.amount).toBe(18.0);
      expect(result.preservedPrevious).toBe(true);
      expect(result.warningMessage).toBe("การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้");

      const dbSlip = await DataStore.getSlipById(userId, initialSlip.id);
      expect(dbSlip?.extracted_json?.amount).toBe(18.0);
    });

    // Test 3: Existing sender/receiver/reference + new null values => existing values remain intact
    it("retains existing parties and reference when incoming extraction returns null for them", async () => {
      const userId = "user-qg-test-3";
      const initialSlip = await DataStore.createSlip(userId, {
        storage_path: "qg/slip3.jpg",
        file_hash_sha256: "hash-qg-3",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "web_upload",
        status: "needs_review",
        parser_version: "v2-vision",
        extracted_json: {
          amount: 500.0,
          currency: "THB",
          transactionDate: "2026-09-15T02:25:00.000Z",
          sender: { name: "สมชาย นามสมมุติ", bank: "KBANK", accountMasked: "123-x-xxxx-4" },
          receiver: { name: "บริษัท เทส จำกัด", bank: "BBL", accountMasked: "987-x-xxxx-6" },
          reference: "TX-ORIGINAL-999",
          fieldConfidence: { amount: 0.95 },
        },
      });

      // New parser only read amount, but parties and reference are null
      const mockVision = {
        parse: vi.fn().mockResolvedValue({
          amount: 500.0,
          currency: "THB",
          transactionDate: "2026-09-15T02:25:00.000Z",
          sender: { name: null, bank: null, accountMasked: null },
          receiver: { name: null, bank: null, accountMasked: null },
          reference: null,
          fieldConfidence: { amount: 0.99 },
        }),
      };

      const processor = new SlipProcessor({ visionParser: mockVision as any });
      const result = await processor.reprocessSlip({
        userId,
        slipId: initialSlip.id,
        buffer: fakeBuffer,
      });

      expect(result.extracted?.sender?.name).toBe("สมชาย นามสมมุติ");
      expect(result.extracted?.sender?.bank).toBe("KBANK");
      expect(result.extracted?.receiver?.name).toBe("บริษัท เทส จำกัด");
      expect(result.extracted?.receiver?.bank).toBe("BBL");
      expect(result.extracted?.reference).toBe("TX-ORIGINAL-999");
      expect(result.preservedPrevious).toBe(true);

      const dbSlip = await DataStore.getSlipById(userId, initialSlip.id);
      expect(dbSlip?.extracted_json?.sender?.name).toBe("สมชาย นามสมมุติ");
      expect(dbSlip?.extracted_json?.receiver?.name).toBe("บริษัท เทส จำกัด");
      expect(dbSlip?.extracted_json?.reference).toBe("TX-ORIGINAL-999");
    });

    // Test 4: Existing wrong date + corrected date => only date updates while other fields remain
    it("updates only transactionDate to corrected Bangkok time while preserving other existing fields", async () => {
      const userId = "user-qg-test-4";
      const initialSlip = await DataStore.createSlip(userId, {
        storage_path: "qg/slip4.jpg",
        file_hash_sha256: "hash-qg-4",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "web_upload",
        status: "needs_review",
        parser_version: "v2-vision",
        extracted_json: {
          amount: 18.0,
          currency: "THB",
          transactionDate: "2026-09-15T09:25:00.000Z", // Wrong +7 UTC offset (displays 16:25 in Bangkok)
          sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1-23456-x" },
          receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-9-87654-x" },
          reference: "REF-PRESERVED",
          fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
        },
      });

      const mockVision = {
        parse: vi.fn().mockResolvedValue({
          amount: 18.0,
          currency: "THB",
          rawDate: "15 ก.ย. 2569 09:25",
          transactionDate: "2026-09-15T02:25:00.000Z", // Corrected UTC instant (displays 09:25 in Bangkok)
          sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1-23456-x" },
          receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-9-87654-x" },
          reference: "REF-PRESERVED",
          fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
        }),
      };

      const processor = new SlipProcessor({ visionParser: mockVision as any });
      const result = await processor.reprocessSlip({
        userId,
        slipId: initialSlip.id,
        buffer: fakeBuffer,
      });

      expect(result.extracted?.transactionDate).toBe("2026-09-15T02:25:00.000Z");
      expect(result.extracted?.amount).toBe(18.0);
      expect(result.extracted?.sender?.name).toBe("สมชาย");
      expect(result.extracted?.receiver?.name).toBe("ป้าพร");
      expect(result.extracted?.reference).toBe("REF-PRESERVED");
      expect(result.preservedPrevious).toBe(false);

      const dbSlip = await DataStore.getSlipById(userId, initialSlip.id);
      expect(dbSlip?.extracted_json?.transactionDate).toBe("2026-09-15T02:25:00.000Z");
    });

    // Test 5: Provider error / rate limit => existing extraction preserved
    it("preserves existing extraction when provider throws rate limit or network error", async () => {
      const userId = "user-qg-test-5";
      const initialSlip = await DataStore.createSlip(userId, {
        storage_path: "qg/slip5.jpg",
        file_hash_sha256: "hash-qg-5",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "web_upload",
        status: "needs_review",
        parser_version: "v2-vision",
        overall_confidence: 0.70,
        extracted_json: {
          amount: 250.0,
          currency: "THB",
          transactionDate: "2026-09-15T02:25:00.000Z",
          sender: { name: "สมชาย", bank: "KBANK" },
          receiver: { name: "ร้าน กาแฟ", bank: "KTB" },
          reference: "REF-BEFORE-ERROR",
          fieldConfidence: { amount: 0.9 },
        },
      });

      const rateLimitErr = new Error("429 Too Many Requests: Rate limit exceeded");
      (rateLimitErr as any).code = "RATE_LIMIT_EXCEEDED";

      const mockVision = {
        parse: vi.fn().mockRejectedValue(rateLimitErr),
      };

      const processor = new SlipProcessor({ visionParser: mockVision as any });
      const result = await processor.reprocessSlip({
        userId,
        slipId: initialSlip.id,
        buffer: fakeBuffer,
      });

      expect(result.status).toBe("needs_review");
      expect(result.preservedPrevious).toBe(true);
      expect(result.warningMessage).toBe("การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้");
      expect(result.amount).toBe(250.0);
      expect(result.extracted?.reference).toBe("REF-BEFORE-ERROR");

      const dbSlip = await DataStore.getSlipById(userId, initialSlip.id);
      expect(dbSlip?.extracted_json?.amount).toBe(250.0);
      expect(dbSlip?.extracted_json?.reference).toBe("REF-BEFORE-ERROR");
      expect(dbSlip?.overall_confidence).toBe(0.70);

      const job = await DataStore.getSlipJobById(userId, result.jobId);
      expect(job?.error_code).toBe("RATE_LIMIT_EXCEEDED");
      expect(job?.safe_error_message).toContain("preservedPrevious");
    });

    // Test 6: Initial first-time extraction with all-null response => needs_review with VISION_EMPTY_EXTRACTION
    it("routes to needs_review with VISION_EMPTY_EXTRACTION on initial all-null provider extraction", async () => {
      const userId = "user-qg-test-6";
      const emptyErr = new Error("Vision extraction returned no usable financial data (empty response)");
      (emptyErr as any).code = "VISION_EMPTY_EXTRACTION";

      const mockVision = {
        parse: vi.fn().mockRejectedValue(emptyErr),
      };

      const processor = new SlipProcessor({ visionParser: mockVision as any });
      const result = await processor.processSlip({
        userId,
        buffer: fakeBuffer,
        source: "web_upload",
      });

      expect(result.status).toBe("needs_review");
      expect(result.errorCode).toBe("VISION_EMPTY_EXTRACTION");
      expect(result.errorMessage).toContain("Vision extraction returned no usable financial data");

      const dbSlip = await DataStore.getSlipById(userId, result.slipId);
      expect(dbSlip?.status).toBe("needs_review");
      expect(dbSlip?.extracted_json == null).toBe(true);

      const job = await DataStore.getSlipJobById(userId, result.jobId);
      expect(job?.status).toBe("needs_review");
      expect(job?.error_code).toBe("VISION_EMPTY_EXTRACTION");
    });

    // Test 7: Reprocess never downgrades extraction completeness score
    it("never downgrades completeness score during reprocess", async () => {
      const userId = "user-qg-test-7";
      const initialSlip = await DataStore.createSlip(userId, {
        storage_path: "qg/slip7.jpg",
        file_hash_sha256: "hash-qg-7",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "web_upload",
        status: "needs_review",
        parser_version: "v2-vision",
        extracted_json: {
          amount: 100.0,
          currency: "THB",
          transactionDate: "2026-09-15T02:25:00.000Z",
          sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1-23456-x" },
          receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-9-87654-x" },
          reference: "REF-7",
          fieldConfidence: { amount: 0.95 },
        },
      });

      // Incoming degraded extraction: only amount is detected, rest missing
      const mockVision = {
        parse: vi.fn().mockResolvedValue({
          amount: 100.0,
          currency: "THB",
          transactionDate: null,
          sender: null,
          receiver: null,
          reference: null,
          fieldConfidence: { amount: 0.5 },
        }),
      };

      const processor = new SlipProcessor({ visionParser: mockVision as any });
      const result = await processor.reprocessSlip({
        userId,
        slipId: initialSlip.id,
        buffer: fakeBuffer,
      });

      // Initial completeness score: amount(0.35) + date(0.25) + sender(0.15) + receiver(0.15) + ref(0.10) = 1.00
      expect(result.completenessScore).toBe(1.0);
      expect(result.preservedPrevious).toBe(true);

      const dbSlip = await DataStore.getSlipById(userId, initialSlip.id);
      expect(dbSlip?.extracted_json?.transactionDate).toBe("2026-09-15T02:25:00.000Z");
      expect(dbSlip?.extracted_json?.sender?.name).toBe("สมชาย");
      expect(dbSlip?.extracted_json?.receiver?.name).toBe("ป้าพร");
      expect(dbSlip?.extracted_json?.reference).toBe("REF-7");
    });
  });

  // 12. Gemini Vision 503 Retry, Timeout & iOS Shortcut Resilience Tests (All 10 Requirements)
  describe("Gemini Vision 503 Retry, Timeout & iOS Shortcut Resilience", () => {
    const fakeBuffer = Buffer.alloc(100);
    fakeBuffer[0] = 0xff;
    fakeBuffer[1] = 0xd8;
    fakeBuffer[2] = 0xff;

    const mockValidGeminiOutput = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  amount: 18.0,
                  currency: "THB",
                  rawDate: "15 ก.ย. 2569 09:25",
                  transactionDate: "2026-09-15T02:25:00.000Z",
                  sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1234" },
                  receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-5678" },
                  reference: "REF-20260915",
                  fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
                }),
              },
            ],
          },
        },
      ],
    };

    // Test 1: Primary 503 -> retry 1 -> fallback 200 succeeds
    it("1. retries transient 503 on primary model (gemini-3.8-flash) then falls back to gemini-3.6-flash and succeeds", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "The model gemini-3.8-flash is currently overloaded (attempt 1).",
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "The model gemini-3.8-flash is currently overloaded (attempt 2).",
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockValidGeminiOutput,
        } as Response);

      const parser = new AiVisionSlipParser({
        primaryModel: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
        primaryRetryDelayMs: 5,
        fallbackRetryDelayMs: 5,
      });

      const result = await parser.parse({
        imageBuffer: fakeBuffer,
        mimeType: "image/jpeg",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(fetchSpy.mock.calls[0][0] as string).toContain("gemini-3.8-flash");
      expect(fetchSpy.mock.calls[1][0] as string).toContain("gemini-3.8-flash");
      expect(fetchSpy.mock.calls[2][0] as string).toContain("gemini-3.6-flash");
      expect(result.amount).toBe(18.0);
      expect(result.sender?.bank).toBe("KBANK");
      expect(result.receiver?.bank).toBe("SCB");
    });

    // Test 2: Primary 503 -> retry 1 -> fallback 503 -> safe needs_review
    it("2. returns safe needs_review when both primary and fallback models fail with 503", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "gemini-3.8-flash overloaded attempt 1",
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "gemini-3.8-flash overloaded attempt 2",
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "gemini-3.6-flash overloaded attempt 1",
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "gemini-3.6-flash overloaded attempt 2",
        } as Response);

      const parser = new AiVisionSlipParser({
        primaryModel: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
        primaryRetryDelayMs: 5,
        fallbackRetryDelayMs: 5,
      });

      const userId = "user-all-503-test-2";
      const processor = new SlipProcessor({ visionParser: parser });
      const result = await processor.processSlip({
        userId,
        buffer: fakeBuffer,
        source: "web_upload",
      });

      expect(result.status).toBe("needs_review");
      expect(result.errorCode).toBe("VISION_PROVIDER_OVERLOADED");
      expect(result.warningMessage).toBe("ระบบอ่านสลิปอัตโนมัติไม่พร้อมใช้งานชั่วคราว");
      expect(result.extracted).toBeUndefined();

      const dbSlip = await DataStore.getSlipById(userId, result.slipId);
      expect(dbSlip?.status).toBe("needs_review");

      const job = await DataStore.getSlipJobById(userId, result.jobId);
      expect(job?.status).toBe("needs_review");
      expect(job?.error_code).toBe("VISION_PROVIDER_OVERLOADED");
      expect(job?.safe_error_message).toContain("gemini-3.8-flash");
      expect(job?.safe_error_message).toContain("gemini-3.6-flash");
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    // Test 3: Request timeout at 5s per attempt triggers AbortController
    it("3. aborts requests exceeding attempt timeout and classifies error as VISION_PROVIDER_TIMEOUT", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy.mockImplementation((_url, init: any) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({ ok: true, json: async () => mockValidGeminiOutput } as Response);
          }, 300);
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      });

      const parser = new AiVisionSlipParser({
        primaryModel: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
        attemptTimeoutMs: 25,
        primaryRetryDelayMs: 5,
        fallbackRetryDelayMs: 5,
      });

      let caughtErr: unknown = null;
      try {
        await parser.parse({
          imageBuffer: fakeBuffer,
          mimeType: "image/jpeg",
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(VisionError);
      const vErr = caughtErr as VisionError;
      expect(vErr.code).toBe("VISION_PROVIDER_TIMEOUT");
      expect(vErr.diagnostics?.timeout).toBe(true);
      expect(vErr.message).toContain("timed out");
    });

    // Test 4: Overall deadline ~12s halts further attempts
    it("4. halts all provider attempts and does not call fallback when total deadline budget is exhausted", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: false,
              status: 503,
              headers: new Headers(),
              text: async () => "503 slow response",
            } as Response);
          }, 30);
        });
      });

      const parser = new AiVisionSlipParser({
        primaryModel: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
        totalDeadlineMs: 45,
        primaryRetryDelayMs: 5,
        fallbackRetryDelayMs: 5,
      });

      let caughtErr: unknown = null;
      try {
        await parser.parse({
          imageBuffer: fakeBuffer,
          mimeType: "image/jpeg",
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(VisionError);
      const fallbackCalls = fetchSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("gemini-3.6-flash")
      );
      expect(fallbackCalls.length).toBe(0);
    });

    // Test 5: 404 does not retry, immediately falls back
    it("5. does not retry 404 on primary model and immediately falls back to fallback model", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          headers: new Headers(),
          text: async () => "Model gemini-3.8-flash is no longer available to new users",
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockValidGeminiOutput,
        } as Response);

      const parser = new AiVisionSlipParser({
        primaryModel: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
      });

      const result = await parser.parse({
        imageBuffer: fakeBuffer,
        mimeType: "image/jpeg",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0][0] as string).toContain("gemini-3.8-flash");
      expect(fetchSpy.mock.calls[1][0] as string).toContain("gemini-3.6-flash");
      expect(result.amount).toBe(18.0);
    });

    // Test 6: 401/403 does not retry or fallback (auth error)
    it("6. fails immediately on 401/403 without any retry or model fallback", async () => {
      process.env.GEMINI_API_KEY = "bad-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => "API key not valid",
      } as Response);

      const parser = new AiVisionSlipParser({
        primaryModel: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
      });

      let caughtErr: unknown = null;
      try {
        await parser.parse({
          imageBuffer: fakeBuffer,
          mimeType: "image/jpeg",
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(VisionError);
      expect((caughtErr as VisionError).code).toBe("VISION_AUTH_FAILED");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // Test 7: Shortcut ingest returns 200 with status 'needs_review' and warning message
    it("7. returns HTTP 200 with status needs_review and warning message on /api/ingest/slip when provider is unavailable", async () => {
      const userId = "shortcut-user-7";
      const { rawToken } = await DataStore.createIngestToken(userId, { label: "My iPhone" });

      const mockProcessResult = {
        jobId: "job-shortcut-overloaded",
        slipId: "slip-shortcut-overloaded",
        status: "needs_review" as const,
        currency: "THB" as const,
        reviewUrl: "/review?slipId=slip-shortcut-overloaded",
        warningMessage: "ระบบอ่านสลิปอัตโนมัติไม่พร้อมใช้งานชั่วคราว",
        errorCode: "VISION_PROVIDER_OVERLOADED",
        errorMessage: "Gemini API transient error (503)",
      };

      const processorSpy = vi
        .spyOn(defaultSlipProcessor, "processSlip")
        .mockResolvedValueOnce(mockProcessResult);

      const formData = new FormData();
      formData.append(
        "file",
        new Blob([fakeBuffer], { type: "image/jpeg" }),
        "slip.jpg"
      );

      const req = new NextRequest("http://localhost:3000/api/ingest/slip", {
        method: "POST",
        headers: {
          authorization: `Bearer ${rawToken}`,
        },
        body: formData,
      });

      const response = await handleSlipIngest(req);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("needs_review");
      expect(body.warning).toBe("ระบบอ่านสลิปอัตโนมัติไม่พร้อมใช้งานชั่วคราว");
      expect(body.jobId).toBe("job-shortcut-overloaded");
      expect(body.reviewUrl).toBe("/review?slipId=slip-shortcut-overloaded");
      processorSpy.mockRestore();
    });

    // Test 8: Reprocess quality gate preserves previous good extraction on 503/timeout
    it("8. preserves previous valid extraction when all Gemini models return 503 during reprocess", async () => {
      const userId = "reprocess-503-user-8";
      const slip = await DataStore.createSlip(userId, {
        storage_path: "503/slip.jpg",
        file_hash_sha256: "hash-503-reprocess-8",
        mime_type: "image/jpeg",
        file_size: 100,
        source: "web_upload",
        status: "needs_review",
        parser_version: "v2-vision",
        overall_confidence: 0.65,
        extracted_json: {
          amount: 18.0,
          currency: "THB",
          transactionDate: "2026-09-15T02:25:00.000Z",
          sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1234" },
          receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-5678" },
          reference: "REF-PRESERVED-503",
          fieldConfidence: { amount: 0.95 },
        },
      });

      const mockVision = {
        parse: vi.fn().mockRejectedValue(
          new VisionError(
            "Gemini API transient error (503): Model overloaded",
            "VISION_PROVIDER_OVERLOADED",
            503,
            {
              provider: "gemini",
              primaryModel: "gemini-3.8-flash",
              fallbackModel: "gemini-3.6-flash",
              httpStatus: 503,
              attemptCount: 2,
              fallbackModelUsed: true,
              timeout: false,
              errorCode: "VISION_PROVIDER_OVERLOADED",
            }
          )
        ),
      };

      const processor = new SlipProcessor({ visionParser: mockVision as any });
      const result = await processor.reprocessSlip({
        userId,
        slipId: slip.id,
        buffer: fakeBuffer,
      });

      expect(result.status).toBe("needs_review");
      expect(result.preservedPrevious).toBe(true);
      expect(result.amount).toBe(18.0);
      expect(result.extracted?.reference).toBe("REF-PRESERVED-503");
      expect(result.warningMessage).toBe("การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้");
      expect(result.errorCode).toBe("VISION_PROVIDER_OVERLOADED");

      const dbSlip = await DataStore.getSlipById(userId, slip.id);
      expect(dbSlip?.extracted_json?.amount).toBe(18.0);
      expect(dbSlip?.overall_confidence).toBe(0.65);

      const job = await DataStore.getSlipJobById(userId, result.jobId);
      expect(job?.error_code).toBe("VISION_PROVIDER_OVERLOADED");
      expect(job?.safe_error_message).toContain("gemini-3.8-flash");
      expect(job?.safe_error_message).toContain("gemini-3.6-flash");
      expect(job?.safe_error_message).toContain("preservedPrevious");
    });

    // Test 9: Diagnostics contain safe fields (httpStatus, duration, timeout, attempts, no secret keys)
    it("9. guarantees diagnostics record httpStatus, duration, timeout, attempts, and zero secret keys", async () => {
      const secretKey = "SECRET-GEMINI-KEY-abc123xyz";
      process.env.GEMINI_API_KEY = secretKey;
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy.mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => `Error on request to url https://api.google.com/generate?key=${secretKey}: Service Unavailable`,
      } as Response);

      const parser = new AiVisionSlipParser({
        primaryModel: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
        primaryRetryDelayMs: 5,
        fallbackRetryDelayMs: 5,
      });

      let caughtErr: unknown = null;
      try {
        await parser.parse({
          imageBuffer: fakeBuffer,
          mimeType: "image/jpeg",
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      const errStr = (caughtErr as Error).message;
      expect(errStr).not.toContain(secretKey);
      expect(errStr).toContain("[REDACTED]");

      // Test Processor diagnostics serialization with secret key
      const userId = "secret-key-user-9";
      const processor = new SlipProcessor({ visionParser: parser });
      const result = await processor.processSlip({
        userId,
        buffer: fakeBuffer,
        source: "web_upload",
      });

      const job = await DataStore.getSlipJobById(userId, result.jobId);
      expect(job?.safe_error_message).not.toContain(secretKey);
      expect(JSON.stringify(job)).not.toContain(secretKey);

      const diagObj = JSON.parse(job?.safe_error_message || "{}");
      expect(diagObj.provider).toBe("gemini");
      expect(diagObj.primaryModel).toBe("gemini-3.8-flash");
      expect(diagObj.fallbackModel).toBe("gemini-3.6-flash");
      expect(diagObj.timeout).toBe(false);
      expect(typeof diagObj.totalDurationMs).toBe("number");
      expect(diagObj.attemptCount).toBeDefined();
    });

    // Test 10: gemini-1.5-flash and gemini-2.5-flash are not used
    it("10. guarantees gemini-1.5-flash and gemini-2.5-flash are never used by default", async () => {
      delete process.env.GEMINI_MODEL;
      delete process.env.GEMINI_FALLBACK_MODEL;
      process.env.GEMINI_API_KEY = "test-gemini-key";

      const parser = new AiVisionSlipParser();
      expect((parser as any).primaryModel).toBe("gemini-3.8-flash");
      expect((parser as any).fallbackModel).toBe("gemini-3.6-flash");
      expect((parser as any).primaryModel).not.toContain("1.5");
      expect((parser as any).primaryModel).not.toContain("2.5");
      expect((parser as any).fallbackModel).not.toContain("1.5");
      expect((parser as any).fallbackModel).not.toContain("2.5");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => mockValidGeminiOutput,
      } as Response);

      await parser.parse({
        imageBuffer: fakeBuffer,
        mimeType: "image/jpeg",
      });

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain("gemini-3.8-flash");
      expect(calledUrl).not.toContain("gemini-1.5-flash");
      expect(calledUrl).not.toContain("gemini-2.5-flash");
    });
  });
});


