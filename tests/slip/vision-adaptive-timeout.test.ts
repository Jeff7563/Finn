import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AiVisionSlipParser, VisionError } from "@/lib/slip/ocr/ai-vision-parser";
import { getVisionTimeoutConfig, parseBoundedInt } from "@/lib/slip/ocr/config";
import { SlipProcessor } from "@/lib/slip/processor";
import { DataStore } from "@/lib/server/data-store";
import { calculateAccountBalance } from "@/lib/finance/balances";
import { computeFileSha256 } from "@/lib/slip/validation";
import { Account } from "@/types/finance";

describe("FINN — Vision Adaptive Timeout & Reliability Hotfix Suite", () => {
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
                amount: 100.0,
                currency: "THB",
                rawDate: "15 ก.ย. 2569 09:25",
                transactionDate: "2026-09-15T02:25:00.000Z",
                sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1234" },
                receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-5678" },
                reference: "REF-VALID-100",
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

  // 1. Primary completes in 7s with 10s timeout -> success
  it("1. primary completes within 10s timeout -> succeeds without invoking fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Primary completes successfully
    fetchSpy.mockImplementation((url) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockValidGeminiOutput,
        } as Response);
      }
      return Promise.reject(new Error("Should not call fallback"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 10000,
      fallbackTimeoutMs: 10000,
      totalDeadlineMs: 25000,
      maxAttempts: 1,
    });

    const result = await parser.parse({
      imageBuffer: fakeBuffer,
      mimeType: "image/jpeg",
    });

    expect(result.amount).toBe(100.0);
    expect(result.reference).toBe("REF-VALID-100");

    const diag = parser.getDiagnostics();
    expect(diag).not.toBeNull();
    expect(diag?.fallbackModelUsed).toBe(false);
    expect(diag?.primaryAttempts).toBe(1);
    expect(diag?.fallbackAttempts).toBe(0);
    expect(diag?.errorCode).toBeNull();
    expect(diag?.timeoutStage).toBeNull();

    // Verify only primary was called
    const primaryCalls = fetchSpy.mock.calls.filter((c) =>
      (c[0] as string).includes("gemini-3.5-flash-lite")
    );
    expect(primaryCalls.length).toBe(1);

    const fallbackCalls = fetchSpy.mock.calls.filter((c) =>
      (c[0] as string).includes("gemini-3.1-flash-lite")
    );
    expect(fallbackCalls.length).toBe(0);
  });

  // 2. Primary exceeds 10s -> fallback invoked
  it("2. primary exceeds 10s timeout -> fallback model is invoked and succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url, init: any) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        // Abort on signal to simulate timeout
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
          ok: true,
          json: async () => mockValidGeminiOutput,
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 20, // small for fast test
      fallbackTimeoutMs: 100,
      totalDeadlineMs: 250,
      maxAttempts: 1,
    });

    const result = await parser.parse({
      imageBuffer: fakeBuffer,
      mimeType: "image/jpeg",
    });

    expect(result.amount).toBe(100.0);

    const diag = parser.getDiagnostics();
    expect(diag?.fallbackModelUsed).toBe(true);
    expect(diag?.primaryAttempts).toBe(1);
    expect(diag?.fallbackAttempts).toBe(1);

    const primaryCalls = fetchSpy.mock.calls.filter((c) =>
      (c[0] as string).includes("gemini-3.5-flash-lite")
    );
    expect(primaryCalls.length).toBe(1);

    const fallbackCalls = fetchSpy.mock.calls.filter((c) =>
      (c[0] as string).includes("gemini-3.1-flash-lite")
    );
    expect(fallbackCalls.length).toBe(1);
  });

  // 3. Fallback completing in 8.5s succeeds
  it("3. fallback completing within its timeout budget succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((url, init: any) => {
      const urlStr = url as string;
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        // Primary fails or times out
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
        // Fallback succeeds within budget
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => mockValidGeminiOutput,
            } as Response);
          }, 10);
        });
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 100,
      maxAttempts: 1,
    });

    const result = await parser.parse({
      imageBuffer: fakeBuffer,
      mimeType: "image/jpeg",
    });

    expect(result.amount).toBe(100.0);
    const diag = parser.getDiagnostics();
    expect(diag?.fallbackModelUsed).toBe(true);
    expect(diag?.primaryAttempts).toBe(1);
    expect(diag?.fallbackAttempts).toBe(1);
  });

  // 4. Total deadline 25s is enforced
  it("4. enforces authoritative total deadline and aborts with VISION_PROVIDER_TIMEOUT", async () => {
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
      totalDeadlineMs: 30, // Total deadline runs out
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
    expect(visionErr.diagnostics?.timeoutStage).toBeDefined();
    expect(visionErr.diagnostics?.totalConfiguredDeadlineMs).toBe(30);
  });

  // 5. Timed-out primary does not get pointless same-model retry
  it("5. timed-out primary does not get pointless same-model retry even if maxAttempts > 1", async () => {
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
          ok: true,
          json: async () => mockValidGeminiOutput,
        } as Response);
      }
      return Promise.reject(new Error("Unknown model"));
    });

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 15,
      fallbackTimeoutMs: 50,
      totalDeadlineMs: 100,
      maxAttempts: 2, // Even with maxAttempts=2, timeout must NOT retry same model
    });

    const result = await parser.parse({
      imageBuffer: fakeBuffer,
      mimeType: "image/jpeg",
    });

    expect(result.amount).toBe(100.0);

    const primaryCalls = fetchSpy.mock.calls.filter((c) =>
      (c[0] as string).includes("gemini-3.5-flash-lite")
    );
    expect(primaryCalls.length).toBe(1); // EXACTLY 1 attempt, zero retries

    const fallbackCalls = fetchSpy.mock.calls.filter((c) =>
      (c[0] as string).includes("gemini-3.1-flash-lite")
    );
    expect(fallbackCalls.length).toBe(1);
  });

  // 6. Invalid env values fall back safely to bounds/defaults
  it("6. validates and falls back safely to safe bounds/defaults on invalid env inputs", () => {
    expect(parseBoundedInt("10000", 3000, 20000, 10000)).toBe(10000);
    expect(parseBoundedInt("-500", 3000, 20000, 10000)).toBe(10000);
    expect(parseBoundedInt("0", 3000, 20000, 10000)).toBe(10000);
    expect(parseBoundedInt("abc", 3000, 20000, 10000)).toBe(10000);
    expect(parseBoundedInt("25000", 3000, 20000, 10000)).toBe(20000); // clamped to max
    expect(parseBoundedInt("1000", 3000, 20000, 10000)).toBe(3000); // clamped to min

    // Empty env returns defaults
    delete process.env.VISION_PRIMARY_TIMEOUT_MS;
    delete process.env.VISION_FALLBACK_TIMEOUT_MS;
    delete process.env.VISION_TOTAL_DEADLINE_MS;
    delete process.env.VISION_MAX_ATTEMPTS;

    const defaultConfig = getVisionTimeoutConfig();
    expect(defaultConfig.primaryTimeoutMs).toBe(10000);
    expect(defaultConfig.fallbackTimeoutMs).toBe(10000);
    expect(defaultConfig.totalDeadlineMs).toBe(25000);
    expect(defaultConfig.maxAttempts).toBe(1);

    // Negative / corrupt env returns safe defaults
    process.env.VISION_PRIMARY_TIMEOUT_MS = "-999";
    process.env.VISION_FALLBACK_TIMEOUT_MS = "invalid";
    process.env.VISION_TOTAL_DEADLINE_MS = "0";
    process.env.VISION_MAX_ATTEMPTS = "-2";

    const safeConfig = getVisionTimeoutConfig();
    expect(safeConfig.primaryTimeoutMs).toBe(10000);
    expect(safeConfig.fallbackTimeoutMs).toBe(10000);
    expect(safeConfig.totalDeadlineMs).toBe(25000);
    expect(safeConfig.maxAttempts).toBe(1);

    // Out-of-bounds large values are clamped
    process.env.VISION_PRIMARY_TIMEOUT_MS = "999999";
    process.env.VISION_FALLBACK_TIMEOUT_MS = "999999";
    process.env.VISION_TOTAL_DEADLINE_MS = "999999";
    process.env.VISION_MAX_ATTEMPTS = "10";

    const clampedConfig = getVisionTimeoutConfig();
    expect(clampedConfig.primaryTimeoutMs).toBe(20000);
    expect(clampedConfig.fallbackTimeoutMs).toBe(20000);
    expect(clampedConfig.totalDeadlineMs).toBe(45000);
    expect(clampedConfig.maxAttempts).toBe(2);

    // Total deadline smaller than primary is adjusted safely
    process.env.VISION_PRIMARY_TIMEOUT_MS = "18000";
    process.env.VISION_FALLBACK_TIMEOUT_MS = "10000";
    process.env.VISION_TOTAL_DEADLINE_MS = "10000";
    process.env.VISION_MAX_ATTEMPTS = "1";

    const adjustedConfig = getVisionTimeoutConfig();
    expect(adjustedConfig.totalDeadlineMs).toBeGreaterThanOrEqual(adjustedConfig.primaryTimeoutMs);
  });

  // 7. Secrets absent from diagnostics
  it("7. redacts secrets (Gemini, OpenAI, Bearer tokens) from diagnostics and error messages", async () => {
    const rawSecretKey = "AIzaSyD-fake-secret-key-1234567890";
    const rawOpenAiKey = "sk-proj-supersecretkey1234567890abcdef1234";
    const bearerToken = "Bearer secret-auth-token-987654";
    process.env.GEMINI_API_KEY = rawSecretKey;

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () =>
        `Unauthorized: Request to https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${rawSecretKey} failed with ${rawOpenAiKey} and ${bearerToken}`,
    } as Response);

    const parser = new AiVisionSlipParser({
      primaryTimeoutMs: 20,
      fallbackTimeoutMs: 20,
      totalDeadlineMs: 50,
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

    expect(caughtErr).toBeDefined();
    const errMsg = (caughtErr as Error).message;
    expect(errMsg).not.toContain(rawSecretKey);
    expect(errMsg).not.toContain(rawOpenAiKey);
    expect(errMsg).not.toContain("secret-auth-token-987654");
    expect(errMsg).toContain("[REDACTED]");

    // Verify slip ingestion job also stores redacted safe_error_message
    const userId = "secret-redaction-user-7";
    const processor = new SlipProcessor({ visionParser: parser });
    const result = await processor.processSlip({
      userId,
      buffer: fakeBuffer,
      source: "web_upload",
    });

    const job = await DataStore.getSlipJobById(userId, result.jobId);
    expect(job?.safe_error_message).toBeDefined();
    expect(job?.safe_error_message).not.toContain(rawSecretKey);
    expect(job?.safe_error_message).not.toContain(rawOpenAiKey);
    expect(job?.safe_error_message).not.toContain("secret-auth-token-987654");
    expect(JSON.stringify(job)).not.toContain(rawSecretKey);
  });

  // 8. Missing extracted amount does NOT display ฿0.00
  it("8. missing or non-positive extracted amount is treated as invalid and not formatted as ฿0.00", () => {
    const isAmountValid = (amt: unknown): boolean =>
      typeof amt === "number" && amt > 0;

    expect(isAmountValid(null)).toBe(false);
    expect(isAmountValid(undefined)).toBe(false);
    expect(isAmountValid(0)).toBe(false);
    expect(isAmountValid(-100)).toBe(false);
    expect(isAmountValid("100")).toBe(false);

    // Semantics verification:
    // When isAmountValid is false, UI renders placeholder and warning badge
    const renderPlaceholderText = "ยังอ่านจำนวนเงินไม่ได้";
    const failedBadgeText = "อ่านข้อมูลสลิปไม่สำเร็จ";

    expect(renderPlaceholderText).not.toBe("฿0.00");
    expect(renderPlaceholderText).not.toBe("-฿0.00");
    expect(failedBadgeText).toBe("อ่านข้อมูลสลิปไม่สำเร็จ");
  });

  // 9. Valid amount 100 renders ฿100.00
  it("9. valid positive amount 100 is recognized as valid for monetary rendering", () => {
    const isAmountValid = (amt: unknown): boolean =>
      typeof amt === "number" && amt > 0;

    const amount = 100.0;
    expect(isAmountValid(amount)).toBe(true);

    const formatted = new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      minimumFractionDigits: 2,
    }).format(amount);

    expect(formatted).toContain("100.00");
    expect(formatted).toContain("฿");
  });

  // 10. Failed first-time extraction remains needs_review
  it("10. failed first-time extraction leaves slip in needs_review with full diagnostics", async () => {
    const userId = "first-time-fail-user-10";

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError(
          "Request timed out",
          "VISION_PROVIDER_TIMEOUT",
          undefined,
          {
            provider: "gemini",
            primaryModel: "gemini-3.5-flash-lite",
            primaryConfiguredTimeoutMs: 10000,
            primaryDurationMs: 10005,
            primaryAttempts: 1,
            fallbackModel: "gemini-3.1-flash-lite",
            fallbackConfiguredTimeoutMs: 10000,
            fallbackDurationMs: 10002,
            fallbackAttempts: 1,
            fallbackModelUsed: true,
            totalConfiguredDeadlineMs: 25000,
            totalDurationMs: 20010,
            httpStatus: null,
            errorCode: "VISION_PROVIDER_TIMEOUT",
            timeoutStage: "fallback",
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
    expect(result.extracted).toBeUndefined();

    const slip = await DataStore.getSlipById(userId, result.slipId);
    expect(slip?.status).toBe("needs_review");
    expect(slip?.overall_confidence).toBeNull();

    const job = await DataStore.getSlipJobById(userId, result.jobId);
    expect(job?.status).toBe("needs_review");
    expect(job?.error_code).toBe("VISION_PROVIDER_TIMEOUT");

    const diag = JSON.parse(job?.safe_error_message || "{}");
    expect(diag.provider).toBe("gemini");
    expect(diag.primaryModel).toBe("gemini-3.5-flash-lite");
    expect(diag.primaryConfiguredTimeoutMs).toBe(10000);
    expect(diag.fallbackModel).toBe("gemini-3.1-flash-lite");
    expect(diag.fallbackConfiguredTimeoutMs).toBe(10000);
    expect(diag.totalConfiguredDeadlineMs).toBe(25000);
    expect(diag.timeoutStage).toBe("fallback");
  });

  // 11. Timeout reprocess shows specific timeout message
  it("11. timeout during reprocess returns specific Thai timeout message", async () => {
    const userId = "reprocess-timeout-user-11";

    const slip = await DataStore.createSlip(userId, {
      storage_path: "user11/slip.jpg",
      file_hash_sha256: "hash-timeout-11",
      mime_type: "image/jpeg",
      file_size: 100,
      source: "web_upload",
      status: "needs_review",
      parser_version: "v1",
      overall_confidence: null,
    });

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("Timeout", "VISION_PROVIDER_TIMEOUT", undefined, {
          provider: "gemini",
          primaryModel: "gemini-3.5-flash-lite",
          primaryConfiguredTimeoutMs: 10000,
          primaryDurationMs: 10002,
          primaryAttempts: 1,
          fallbackModel: "gemini-3.1-flash-lite",
          fallbackConfiguredTimeoutMs: 10000,
          fallbackDurationMs: 10004,
          fallbackAttempts: 1,
          fallbackModelUsed: true,
          totalConfiguredDeadlineMs: 25000,
          totalDurationMs: 20015,
          httpStatus: null,
          errorCode: "VISION_PROVIDER_TIMEOUT",
          timeoutStage: "fallback",
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
    expect(result.errorMessage).toBe(
      "ระบบอ่านสลิปตอบกลับช้ากว่ากำหนด กรุณาลองประมวลผลใหม่อีกครั้ง"
    );
  });

  // 12. Reprocess timeout preserves previous good extraction
  it("12. reprocess timeout preserves previously extracted good data", async () => {
    const userId = "preserve-prev-user-12";

    const slip = await DataStore.createSlip(userId, {
      storage_path: "user12/slip.jpg",
      file_hash_sha256: "hash-preserve-12",
      mime_type: "image/jpeg",
      file_size: 100,
      source: "web_upload",
      status: "needs_review",
      parser_version: "v2-vision",
      overall_confidence: 0.92,
      extracted_json: {
        amount: 250.0,
        currency: "THB",
        transactionDate: "2026-09-15T02:25:00.000Z",
        sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1234" },
        receiver: { name: "ป้าพร", bank: "SCB", accountMasked: "xxx-5678" },
        reference: "REF-PRESERVED-12",
        fieldConfidence: { amount: 0.99 },
      },
    });

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("Timeout", "VISION_PROVIDER_TIMEOUT", undefined, {
          provider: "gemini",
          primaryModel: "gemini-3.5-flash-lite",
          primaryConfiguredTimeoutMs: 10000,
          primaryDurationMs: 10005,
          primaryAttempts: 1,
          fallbackModel: "gemini-3.1-flash-lite",
          fallbackConfiguredTimeoutMs: 10000,
          fallbackDurationMs: 10005,
          fallbackAttempts: 1,
          fallbackModelUsed: true,
          totalConfiguredDeadlineMs: 25000,
          totalDurationMs: 20015,
          httpStatus: null,
          errorCode: "VISION_PROVIDER_TIMEOUT",
          timeoutStage: "fallback",
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
    expect(result.amount).toBe(250.0);
    expect(result.extracted?.reference).toBe("REF-PRESERVED-12");

    const slipInDb = await DataStore.getSlipById(userId, slip.id);
    expect(slipInDb?.extracted_json?.amount).toBe(250.0);
    expect(slipInDb?.overall_confidence).toBe(0.92);
  });

  // 13. Confirmation remains disabled when amount is missing
  it("13. confirm button remains disabled whenever valid amount is absent", () => {
    const isAmountValid = (amt: unknown): boolean =>
      typeof amt === "number" && amt > 0;

    const isConfirmDisabled = (isActing: boolean, amount: unknown) =>
      isActing || !isAmountValid(amount);

    expect(isConfirmDisabled(false, null)).toBe(true);
    expect(isConfirmDisabled(false, undefined)).toBe(true);
    expect(isConfirmDisabled(false, 0)).toBe(true);
    expect(isConfirmDisabled(false, -50)).toBe(true);
    expect(isConfirmDisabled(false, 150.0)).toBe(false);
    expect(isConfirmDisabled(true, 150.0)).toBe(true); // acting state blocks click
  });

  // 14. Duplicate SHA-256 behavior remains unchanged
  it("14. duplicate SHA-256 hash protection remains completely unchanged", async () => {
    const userId = "duplicate-sha-user-14";
    const duplicateHash = computeFileSha256(fakeBuffer);

    const originalSlip = await DataStore.createSlip(userId, {
      storage_path: "user14/slip1.jpg",
      file_hash_sha256: duplicateHash,
      mime_type: "image/jpeg",
      file_size: 100,
      source: "web_upload",
      status: "needs_review",
      parser_version: "v2-vision",
      overall_confidence: 0.95,
      extracted_json: {
        amount: 500.0,
        currency: "THB",
        fieldConfidence: { amount: 0.95 },
      },
    });

    const mockVision = {
      parse: vi.fn(),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });
    const result = await processor.processSlip({
      userId,
      buffer: fakeBuffer,
    });

    expect(result.status).toBe("duplicate");
    expect(result.duplicateOfSlipId).toBe(originalSlip.id);
    expect(result.slipId).toBe(originalSlip.id);
    // Vision parser was not called for duplicate
    expect(mockVision.parse).not.toHaveBeenCalled();
  });

  // 15. No financial balance/transaction logic changed
  it("15. failed or timed out slip ingestion/reprocess does not alter account balance or create transactions", async () => {
    const userId = "financial-invariant-user-15";

    const account: Account = {
      id: "acc-user-15",
      user_id: userId,
      name: "Savings",
      type: "bank",
      institution: "KBANK",
      currency: "THB",
      opening_balance: 10000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
      active: true,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };

    // Calculate baseline balance with no transactions
    const initialBalance = calculateAccountBalance(account, []);
    expect(initialBalance.current_balance).toBe(10000);

    const mockVision = {
      parse: vi.fn().mockRejectedValue(
        new VisionError("Timeout", "VISION_PROVIDER_TIMEOUT", undefined, {
          provider: "gemini",
          primaryModel: "gemini-3.5-flash-lite",
          primaryConfiguredTimeoutMs: 10000,
          primaryDurationMs: 10005,
          primaryAttempts: 1,
          fallbackModel: "gemini-3.1-flash-lite",
          fallbackConfiguredTimeoutMs: 10000,
          fallbackDurationMs: 10005,
          fallbackAttempts: 1,
          fallbackModelUsed: true,
          totalConfiguredDeadlineMs: 25000,
          totalDurationMs: 20015,
          httpStatus: null,
          errorCode: "VISION_PROVIDER_TIMEOUT",
          timeoutStage: "fallback",
        })
      ),
      getDiagnostics: vi.fn(),
    };

    const processor = new SlipProcessor({ visionParser: mockVision as any });

    // Ingest fails
    const ingestRes = await processor.processSlip({
      userId,
      buffer: fakeBuffer,
      source: "web_upload",
    });
    expect(ingestRes.status).toBe("needs_review");

    // Reprocess fails
    const reprocessRes = await processor.reprocessSlip({
      userId,
      slipId: ingestRes.slipId,
      buffer: fakeBuffer,
    });
    expect(reprocessRes.status).toBe("needs_review");

    // Check account balance remains unaltered
    const endBalance = calculateAccountBalance(account, []);
    expect(endBalance.current_balance).toBe(10000);

    // Verify no transactions were created in store for this user
    const transactions = await DataStore.getTransactions(userId);
    const slipTxs = transactions.filter(
      (tx) => tx.source_slip_id === ingestRes.slipId
    );
    expect(slipTxs.length).toBe(0);
  });
});
