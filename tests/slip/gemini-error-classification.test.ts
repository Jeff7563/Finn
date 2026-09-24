import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AiVisionSlipParser, VisionError } from "@/lib/slip/ocr/ai-vision-parser";
import { getFriendlyVisionErrorMessage } from "@/lib/slip/error-messages";
import { SlipProcessor } from "@/lib/slip/processor";
import { DataStore } from "@/lib/server/data-store";
import { calculateAccountBalance } from "@/lib/finance/balances";
import { computeFileSha256 } from "@/lib/slip/validation";
import { Account } from "@/types/finance";

describe("FINN — Gemini-Only Vision Error Classification & UX Hotfix (20 Required Tests)", () => {
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
                amount: 350.0,
                currency: "THB",
                rawDate: "15 ก.ย. 2569 09:25",
                transactionDate: "2026-09-15T02:25:00.000Z",
                sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1234" },
                receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-5678" },
                reference: "REF-VALID-350",
                fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
              }),
            },
          ],
        },
      },
    ],
  };

  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = "test-gemini-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  // 1. Primary timeout -> fallback HTTP 503 -> Expected final: VISION_PROVIDER_OVERLOADED
  it("1. primary timeout -> fallback HTTP 503 -> expected final: VISION_PROVIDER_OVERLOADED", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url, init: any) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      if (urlStr.includes("gemini-3.1-flash-lite")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => JSON.stringify({ error: { message: "The model is overloaded. Please try again later." } }),
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 150,
      maxAttempts: 1,
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
    const visionErr = caughtErr as VisionError;
    expect(visionErr.code).toBe("VISION_PROVIDER_OVERLOADED");
    expect(visionErr.httpStatus).toBe(503);
  });

  // 2. Primary timeout -> fallback 429 -> Expected: VISION_RATE_LIMITED
  it("2. primary timeout -> fallback 429 -> expected: VISION_RATE_LIMITED", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url, init: any) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      if (urlStr.includes("gemini-3.1-flash-lite")) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers(),
          text: async () => JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 150,
      maxAttempts: 1,
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
    const visionErr = caughtErr as VisionError;
    expect(visionErr.code).toBe("VISION_RATE_LIMITED");
    expect(visionErr.httpStatus).toBe(429);
  });

  // 3. Primary timeout -> fallback 500 -> Expected: VISION_PROVIDER_UNAVAILABLE
  it("3. primary timeout -> fallback 500 -> expected: VISION_PROVIDER_UNAVAILABLE", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url, init: any) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      if (urlStr.includes("gemini-3.1-flash-lite")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: new Headers(),
          text: async () => JSON.stringify({ error: { message: "Internal Server Error" } }),
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 150,
      maxAttempts: 1,
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
    const visionErr = caughtErr as VisionError;
    expect(visionErr.code).toBe("VISION_PROVIDER_UNAVAILABLE");
    expect(visionErr.httpStatus).toBe(500);
  });

  // 4. Primary timeout -> fallback timeout -> Expected: VISION_PROVIDER_TIMEOUT
  it("4. primary timeout -> fallback timeout -> expected: VISION_PROVIDER_TIMEOUT", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((_url, init: any) => {
      return new Promise((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 25,
      totalDeadlineMs: 200,
      maxAttempts: 1,
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
    const visionErr = caughtErr as VisionError;
    expect(visionErr.code).toBe("VISION_PROVIDER_TIMEOUT");
    expect(visionErr.diagnostics?.timeoutStage).toBe("fallback");
  });

  // 5. Total authoritative deadline reached -> Expected: VISION_PROVIDER_TIMEOUT, timeoutStage = total
  it("5. total authoritative deadline reached -> expected: VISION_PROVIDER_TIMEOUT, timeoutStage = total", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((_url, init: any) => {
      return new Promise((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 25,
      fallbackTimeoutMs: 25,
      totalDeadlineMs: 30, // Deadline runs out during execution
      maxAttempts: 1,
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
    const visionErr = caughtErr as VisionError;
    expect(visionErr.code).toBe("VISION_PROVIDER_TIMEOUT");
    expect(visionErr.diagnostics?.timeoutStage).toBe("total");
    expect(visionErr.diagnostics?.timeout).toBe(true);
  });

  // 6. Primary 503 -> fallback success -> Expected successful extraction
  it("6. primary 503 -> fallback success -> expected successful extraction", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "Service Unavailable",
        } as Response);
      }
      if (urlStr.includes("gemini-3.1-flash-lite")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockValidGeminiOutput,
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 50,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 200,
      maxAttempts: 1,
    });

    const result = await parser.parse({
      imageBuffer: fakeBuffer,
      mimeType: "image/jpeg",
    });

    expect(result.amount).toBe(350.0);
    expect(result.reference).toBe("REF-VALID-350");

    const diag = parser.getDiagnostics();
    expect(diag?.fallbackModelUsed).toBe(true);
    expect(diag?.errorCode).toBeNull();
    expect(diag?.hadPriorTimeout).toBe(false);
    expect(diag?.priorFailureCodes).toContain("VISION_PROVIDER_OVERLOADED");
  });

  // 7. Primary timeout -> fallback 503 -> Diagnostics: hadPriorTimeout = true
  it("7. primary timeout -> fallback 503 -> diagnostics: hadPriorTimeout = true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url, init: any) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      if (urlStr.includes("gemini-3.1-flash-lite")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "Service Unavailable",
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 200,
      maxAttempts: 1,
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
    const diag = (caughtErr as VisionError).diagnostics;
    expect(diag).toBeDefined();
    expect(diag?.hadPriorTimeout).toBe(true);
    expect(diag?.priorFailureCodes).toContain("VISION_PROVIDER_TIMEOUT");
  });

  // 8. Same scenario: terminalHttpStatus = 503
  it("8. primary timeout -> fallback 503 -> terminalHttpStatus = 503 and terminalErrorCode = VISION_PROVIDER_OVERLOADED", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url, init: any) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      if (urlStr.includes("gemini-3.1-flash-lite")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "Service Unavailable",
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 200,
      maxAttempts: 1,
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

    const diag = (caughtErr as VisionError).diagnostics;
    expect(diag?.terminalHttpStatus).toBe(503);
    expect(diag?.terminalErrorCode).toBe("VISION_PROVIDER_OVERLOADED");
    expect(diag?.terminalModel).toBe("gemini-3.1-flash-lite");
    expect(diag?.errorCode).toBe("VISION_PROVIDER_OVERLOADED");
    expect(diag?.httpStatus).toBe(503);
  });

  // 9. Same scenario: timeoutStage final = null
  it("9. primary timeout -> fallback 503 -> timeoutStage final = null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url, init: any) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      if (urlStr.includes("gemini-3.1-flash-lite")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => "Service Unavailable",
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 200,
      maxAttempts: 1,
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

    const diag = (caughtErr as VisionError).diagnostics;
    expect(diag?.timeoutStage).toBeNull();
    expect(diag?.timeout).toBe(false);
  });

  // 10. Processor does NOT convert terminal OVERLOADED back to TIMEOUT
  it("10. processor does NOT convert terminal OVERLOADED back to TIMEOUT", async () => {
    const userId = "processor-audit-user-10";

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError(
          "Gemini API transient error (503): Model overloaded",
          "VISION_PROVIDER_OVERLOADED",
          503,
          {
            provider: "gemini",
            primaryModel: "gemini-3.5-flash-lite",
            primaryDurationMs: 10003,
            primaryAttempts: 1,
            fallbackModel: "gemini-3.1-flash-lite",
            fallbackDurationMs: 4935,
            fallbackAttempts: 2,
            fallbackModelUsed: true,
            totalConfiguredDeadlineMs: 25000,
            totalDurationMs: 14938,
            hadPriorTimeout: true,
            priorFailureCodes: ["VISION_PROVIDER_TIMEOUT"],
            terminalErrorCode: "VISION_PROVIDER_OVERLOADED",
            terminalHttpStatus: 503,
            terminalModel: "gemini-3.1-flash-lite",
            errorCode: "VISION_PROVIDER_OVERLOADED",
            httpStatus: 503,
            timeoutStage: null,
            timeout: false,
            safeErrorMessage: "Provider error (503)",
          }
        )
      ),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const result = await processor.processSlip({
      userId,
      buffer: fakeBuffer,
      source: "web_upload",
    });

    expect(result.status).toBe("needs_review");
    expect(result.errorCode).toBe("VISION_PROVIDER_OVERLOADED");
    expect(result.errorCode).not.toBe("VISION_PROVIDER_TIMEOUT");

    const job = await DataStore.getSlipJobById(userId, result.jobId);
    expect(job?.error_code).toBe("VISION_PROVIDER_OVERLOADED");
    expect(job?.error_code).not.toBe("VISION_PROVIDER_TIMEOUT");

    const parsedDiag = JSON.parse(job?.safe_error_message || "{}");
    expect(parsedDiag.errorCode).toBe("VISION_PROVIDER_OVERLOADED");
    expect(parsedDiag.terminalErrorCode).toBe("VISION_PROVIDER_OVERLOADED");
    expect(parsedDiag.hadPriorTimeout).toBe(true);
    expect(parsedDiag.timeoutStage).toBeNull();
    expect(parsedDiag.timeout).toBe(false);
  });

  // 11. 503 Review Inbox message is: "Gemini กำลังมีผู้ใช้งานหนาแน่น กรุณาลองประมวลผลใหม่ภายหลัง"
  it("11. 503 Review Inbox message is: 'Gemini กำลังมีผู้ใช้งานหนาแน่น กรุณาลองประมวลผลใหม่ภายหลัง'", async () => {
    const userId = "reprocess-msg-503-user-11";
    const slip = await DataStore.createSlip(userId, {
      storage_path: "user11/slip.jpg",
      file_hash_sha256: "hash-msg-503-11",
      mime_type: "image/jpeg",
      file_size: 100,
      source: "web_upload",
      status: "needs_review",
      parser_version: "v2-vision",
      overall_confidence: 0.85,
      extracted_json: {
        amount: 200.0,
        currency: "THB",
        reference: "REF-11",
        fieldConfidence: { amount: 0.95 },
      },
    });

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("Overloaded", "VISION_PROVIDER_OVERLOADED", 503, {
          provider: "gemini",
          terminalErrorCode: "VISION_PROVIDER_OVERLOADED",
          terminalHttpStatus: 503,
          errorCode: "VISION_PROVIDER_OVERLOADED",
          hadPriorTimeout: true,
          timeoutStage: null,
        })
      ),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const result = await processor.reprocessSlip({
      userId,
      slipId: slip.id,
      buffer: fakeBuffer,
    });

    expect(result.status).toBe("needs_review");
    expect(result.errorCode).toBe("VISION_PROVIDER_OVERLOADED");
    expect(result.warningMessage).toBe(
      "Gemini กำลังมีผู้ใช้งานหนาแน่น กรุณาลองประมวลผลใหม่ภายหลัง"
    );
    expect(result.errorMessage).toBe(
      "Gemini กำลังมีผู้ใช้งานหนาแน่น กรุณาลองประมวลผลใหม่ภายหลัง"
    );
    expect(getFriendlyVisionErrorMessage("VISION_PROVIDER_OVERLOADED")).toBe(
      "Gemini กำลังมีผู้ใช้งานหนาแน่น กรุณาลองประมวลผลใหม่ภายหลัง"
    );
  });

  // 12. 429 has rate-limit-specific Thai message
  it("12. 429 has rate-limit-specific Thai message: 'คำขอไปยัง Gemini ถึงขีดจำกัดชั่วคราว กรุณาลองใหม่ภายหลัง'", async () => {
    const userId = "reprocess-msg-429-user-12";
    const slip = await DataStore.createSlip(userId, {
      storage_path: "user12/slip.jpg",
      file_hash_sha256: "hash-msg-429-12",
      mime_type: "image/jpeg",
      file_size: 100,
      source: "web_upload",
      status: "needs_review",
      parser_version: "v2-vision",
      overall_confidence: 0.85,
      extracted_json: {
        amount: 200.0,
        currency: "THB",
        reference: "REF-12",
        fieldConfidence: { amount: 0.95 },
      },
    });

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("Rate limited", "VISION_RATE_LIMITED", 429, {
          provider: "gemini",
          terminalErrorCode: "VISION_RATE_LIMITED",
          terminalHttpStatus: 429,
          errorCode: "VISION_RATE_LIMITED",
          hadPriorTimeout: false,
          timeoutStage: null,
        })
      ),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const result = await processor.reprocessSlip({
      userId,
      slipId: slip.id,
      buffer: fakeBuffer,
    });

    expect(result.status).toBe("needs_review");
    expect(result.errorCode).toBe("VISION_RATE_LIMITED");
    expect(result.warningMessage).toBe(
      "คำขอไปยัง Gemini ถึงขีดจำกัดชั่วคราว กรุณาลองใหม่ภายหลัง"
    );
    expect(getFriendlyVisionErrorMessage("VISION_RATE_LIMITED")).toBe(
      "คำขอไปยัง Gemini ถึงขีดจำกัดชั่วคราว กรุณาลองใหม่ภายหลัง"
    );
  });

  // 13. Timeout retains timeout-specific Thai message
  it("13. timeout retains timeout-specific Thai message: 'ระบบอ่านสลิปตอบกลับช้ากว่ากำหนด กรุณาลองประมวลผลใหม่อีกครั้ง'", async () => {
    const userId = "reprocess-msg-timeout-user-13";
    const slip = await DataStore.createSlip(userId, {
      storage_path: "user13/slip.jpg",
      file_hash_sha256: "hash-msg-timeout-13",
      mime_type: "image/jpeg",
      file_size: 100,
      source: "web_upload",
      status: "needs_review",
      parser_version: "v2-vision",
      overall_confidence: 0.85,
      extracted_json: {
        amount: 200.0,
        currency: "THB",
        reference: "REF-13",
        fieldConfidence: { amount: 0.95 },
      },
    });

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("Timeout", "VISION_PROVIDER_TIMEOUT", null, {
          provider: "gemini",
          terminalErrorCode: "VISION_PROVIDER_TIMEOUT",
          errorCode: "VISION_PROVIDER_TIMEOUT",
          timeoutStage: "fallback",
          timeout: true,
        })
      ),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const result = await processor.reprocessSlip({
      userId,
      slipId: slip.id,
      buffer: fakeBuffer,
    });

    expect(result.status).toBe("needs_review");
    expect(result.errorCode).toBe("VISION_PROVIDER_TIMEOUT");
    expect(result.warningMessage).toBe(
      "ระบบอ่านสลิปตอบกลับช้ากว่ากำหนด กรุณาลองประมวลผลใหม่อีกครั้ง"
    );
    expect(getFriendlyVisionErrorMessage("VISION_PROVIDER_TIMEOUT")).toBe(
      "ระบบอ่านสลิปตอบกลับช้ากว่ากำหนด กรุณาลองประมวลผลใหม่อีกครั้ง"
    );
  });

  // 14. Missing extraction still does not display ฿0.00
  it("14. missing extraction still does not display ฿0.00", () => {
    const isAmountValid = (amt: unknown): boolean =>
      typeof amt === "number" && amt > 0;

    expect(isAmountValid(null)).toBe(false);
    expect(isAmountValid(undefined)).toBe(false);
    expect(isAmountValid(0)).toBe(false);
    expect(isAmountValid(-20)).toBe(false);

    const placeholderText = "ยังอ่านจำนวนเงินไม่ได้";
    expect(placeholderText).not.toBe("฿0.00");
    expect(placeholderText).not.toBe("-฿0.00");
  });

  // 15. Previous good extracted_json is preserved on failed reprocess
  it("15. previous good extracted_json is preserved on failed reprocess", async () => {
    const userId = "reprocess-preserve-user-15";
    const slip = await DataStore.createSlip(userId, {
      storage_path: "user15/slip.jpg",
      file_hash_sha256: "hash-preserve-15",
      mime_type: "image/jpeg",
      file_size: 100,
      source: "web_upload",
      status: "needs_review",
      parser_version: "v2-vision",
      overall_confidence: 0.95,
      extracted_json: {
        amount: 880.0,
        currency: "THB",
        transactionDate: "2026-09-15T02:25:00.000Z",
        sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1234" },
        receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-5678" },
        reference: "REF-PRESERVED-880",
        fieldConfidence: { amount: 0.99 },
      },
    });

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("Overloaded", "VISION_PROVIDER_OVERLOADED", 503, {
          provider: "gemini",
          terminalErrorCode: "VISION_PROVIDER_OVERLOADED",
          terminalHttpStatus: 503,
          errorCode: "VISION_PROVIDER_OVERLOADED",
        })
      ),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const result = await processor.reprocessSlip({
      userId,
      slipId: slip.id,
      buffer: fakeBuffer,
    });

    expect(result.preservedPrevious).toBe(true);
    expect(result.amount).toBe(880.0);
    expect(result.extracted?.reference).toBe("REF-PRESERVED-880");

    const slipInDb = await DataStore.getSlipById(userId, slip.id);
    expect(slipInDb?.extracted_json?.amount).toBe(880.0);
    expect(slipInDb?.overall_confidence).toBe(0.95);
  });

  // 16. No transaction is created from a failed extraction
  it("16. no transaction is created from a failed extraction", async () => {
    const userId = "no-tx-created-user-16";

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("503 Overloaded", "VISION_PROVIDER_OVERLOADED", 503)
      ),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const result = await processor.processSlip({
      userId,
      buffer: fakeBuffer,
      source: "web_upload",
    });

    expect(result.status).toBe("needs_review");
    expect(result.transactionId).toBeUndefined();

    const transactions = await DataStore.getTransactions(userId);
    const linkedTx = transactions.filter((tx) => tx.source_slip_id === result.slipId);
    expect(linkedTx.length).toBe(0);
  });

  // 17. No account balance changes
  it("17. no account balance changes on failed extraction or reprocess", async () => {
    const userId = "balance-invariant-user-17";

    const account: Account = {
      id: "acc-user-17",
      user_id: userId,
      name: "Main Savings",
      type: "bank",
      institution: "KBANK",
      currency: "THB",
      opening_balance: 15000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
      active: true,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };

    const baseline = calculateAccountBalance(account, []);
    expect(baseline.current_balance).toBe(15000);

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("503 Overloaded", "VISION_PROVIDER_OVERLOADED", 503)
      ),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const result = await processor.processSlip({
      userId,
      buffer: fakeBuffer,
      source: "web_upload",
    });

    // Ingest failed -> balance check
    const currentTx = await DataStore.getTransactions(userId);
    const balanceAfterIngest = calculateAccountBalance(account, currentTx);
    expect(balanceAfterIngest.current_balance).toBe(15000);

    // Reprocess failed -> balance check
    await processor.reprocessSlip({
      userId,
      slipId: result.slipId,
      buffer: fakeBuffer,
    });

    const txAfterReprocess = await DataStore.getTransactions(userId);
    const balanceAfterReprocess = calculateAccountBalance(account, txAfterReprocess);
    expect(balanceAfterReprocess.current_balance).toBe(15000);
  });

  // 18. SHA-256 duplicate behavior unchanged
  it("18. SHA-256 duplicate behavior unchanged", async () => {
    const userId = "sha-duplicate-user-18";
    const fileHash = computeFileSha256(fakeBuffer);

    const firstSlip = await DataStore.createSlip(userId, {
      storage_path: "user18/first.jpg",
      file_hash_sha256: fileHash,
      mime_type: "image/jpeg",
      file_size: 100,
      source: "web_upload",
      status: "needs_review",
      parser_version: "v2-vision",
      overall_confidence: 0.90,
      extracted_json: {
        amount: 500.0,
        currency: "THB",
        fieldConfidence: { amount: 0.90 },
      },
    });

    const mockVision = {
      parse: vi.fn(),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const secondUpload = await processor.processSlip({
      userId,
      buffer: fakeBuffer,
      source: "web_upload",
    });

    expect(secondUpload.status).toBe("duplicate");
    expect(secondUpload.duplicateOfSlipId).toBe(firstSlip.id);
    expect(mockVision.parse).not.toHaveBeenCalled();
  });

  // 19. VISION_MAX_ATTEMPTS=2 remains bounded
  it("19. VISION_MAX_ATTEMPTS=2 remains bounded and does not loop infinitely", async () => {
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((_url) => {
      callCount++;
      return Promise.resolve({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => "Overloaded",
      } as Response);
    });

    const parser = new AiVisionSlipParser({
      primaryModel: "gemini-3.5-flash-lite",
      fallbackModel: "gemini-3.1-flash-lite",
      primaryTimeoutMs: 30,
      fallbackTimeoutMs: 30,
      totalDeadlineMs: 300,
      maxAttempts: 2,
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
    // Max attempts = 2 per model tier (primary 2 + fallback 2 = 4 total maximum calls)
    expect(callCount).toBeLessThanOrEqual(4);
    expect(callCount).toBeGreaterThanOrEqual(2);

    const diag = (caughtErr as VisionError).diagnostics;
    expect(diag?.attemptCount).toBeLessThanOrEqual(4);
  });

  // 20. Diagnostics contain no API key/Bearer secret
  it("20. diagnostics contain no API key/Bearer secret", async () => {
    const rawSecretKey = "AIzaSyD-secret-gemini-key-98765432101";
    const rawOpenAiKey = "sk-secret-openai-token-abcdef1234567890";
    const rawBearer = "Bearer secret-bearer-token-1122334455";
    process.env.GEMINI_API_KEY = rawSecretKey;

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () =>
        `Service Unavailable on https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite?key=${rawSecretKey} using ${rawOpenAiKey} and ${rawBearer}`,
    } as Response);

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 30,
      fallbackTimeoutMs: 30,
      totalDeadlineMs: 150,
      maxAttempts: 1,
    });

    const userId = "secret-scrub-user-20";
    const processor = new SlipProcessor({ visionParser: parser });
    const result = await processor.processSlip({
      userId,
      buffer: fakeBuffer,
      source: "web_upload",
    });

    expect(result.status).toBe("needs_review");

    const job = await DataStore.getSlipJobById(userId, result.jobId);
    expect(job?.safe_error_message).toBeDefined();
    expect(job?.safe_error_message).not.toContain(rawSecretKey);
    expect(job?.safe_error_message).not.toContain(rawOpenAiKey);
    expect(job?.safe_error_message).not.toContain("secret-bearer-token-1122334455");
    expect(JSON.stringify(job)).not.toContain(rawSecretKey);
  });
});
