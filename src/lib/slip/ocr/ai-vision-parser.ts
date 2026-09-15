import { SlipExtraction, FieldConfidence } from "@/types/slip";
import { SlipVisionInput, VisionSlipParser } from "./types";
import {
  parseThaiSlipAmount,
  parseThaiSlipDate,
  normalizeMaskedAccount,
  cleanPartyName,
} from "./thai-slip-normalizer";
import { normalizeBankName } from "../bank-normalization";
import { parseSlipQrPayload } from "../qr/parser";
import { isMateriallyUnusable } from "../quality-gate";

const THAI_SLIP_SYSTEM_PROMPT = `You are an expert AI vision system specialized in extracting structured data from Thai bank transfer slips (สลิปโอนเงินธนาคาร).
Supported banks include: KBank (K PLUS, MAKE by KBank), SCB (SCB EASY), Krungthai (Krungthai NEXT, Paotang), Bangkok Bank (Bualuang mBanking), TTB (TTB Touch), Krungsri (KMA), GSB (MyMo), BAAC, CIMB, UOB, PromptPay, etc.

Analyze the provided bank slip image carefully and extract:
1. "amount": The principal transfer amount transferred in THB as a numeric value (e.g. 18.00). CRITICAL:
   - Extract the transferred principal amount ("จำนวนเงิน", "โอนเงิน", "จำนวนเงินที่โอน", "Amount").
   - Do NOT extract the transfer fee ("ค่าธรรมเนียม" e.g. 0.00).
   - Do NOT extract remaining balance ("ยอดเงินคงเหลือ") or account number digits.
   - If not clearly readable, return null.
2. "currency": Always "THB".
3. "rawDate": The exact date/time string visible on the slip (e.g. "15 ก.ย. 2569 09:25", "15 Sep 2026 09:25:00", "15/09/2569 09:25"). CRITICAL:
   - Must exactly preserve the visible slip date/time text without modification or omission.
4. "transactionDate": Normalized ISO 8601 string if identifiable. CRITICAL TIMEZONE RULES:
   - Thai bank slips display local time in Asia/Bangkok (UTC+7).
   - If transactionDate is returned, it MUST include the "+07:00" timezone offset for Thai local slip times (e.g. "2026-09-15T09:25:00+07:00").
   - NEVER append "Z" to a visible Thai local slip time unless the source explicitly represents UTC.
   - Note: Thai slips frequently use Buddhist Era years (พ.ศ. 2567 = 2024, 2568 = 2025, 2569 = 2026).
5. "sender":
   - "name": Full name of sender if visible (e.g. "นาย สมชาย ใจดี"), or null.
   - "bank": Bank name of sender (e.g. "KBANK", "SCB", "กสิกรไทย", "MAKE"), or null.
   - "accountMasked": Masked account number of sender (e.g. "xxx-x-xx123-4" or "x-1234"), or null.
6. "receiver":
   - "name": Full name or merchant/recipient name (e.g. "ร้าน ป้าพร", "สมหญิง ใจดี"), or null.
   - "bank": Bank name or "PromptPay" of receiver, or null.
   - "accountMasked": Masked account or PromptPay number (e.g. "xxx-xxx-5678"), or null.
7. "reference": Transaction reference number or ID (e.g. "2026091512345678", "REF12345"), or null.
8. "channel": Banking app or channel (e.g. "K PLUS", "MAKE by KBank", "SCB EASY", "PromptPay", "Mobile Banking"), or null.
9. "fieldConfidence": Object containing confidence score between 0.0 and 1.0 for each field:
   - "amount": confidence score (1.0 if clear, 0.0 if missing/unclear)
   - "transactionDate": confidence score
   - "senderName": confidence score
   - "senderBank": confidence score
   - "senderAccount": confidence score
   - "receiverName": confidence score
   - "receiverBank": confidence score
   - "receiverAccount": confidence score
   - "reference": confidence score

STRICT SAFETY RULES:
- NEVER guess or invent any data that is not visible on the slip.
- If a field is not visible, obscured, or unreadable, set its value to null and confidence to 0.
- Return ONLY a JSON object matching this schema.`;

interface RawVisionExtraction {
  amount?: number | string | null;
  currency?: string | null;
  rawDate?: string | null;
  transactionDate?: string | null;
  sender?: {
    name?: string | null;
    bank?: string | null;
    accountMasked?: string | null;
  } | null;
  receiver?: {
    name?: string | null;
    bank?: string | null;
    accountMasked?: string | null;
  } | null;
  reference?: string | null;
  channel?: string | null;
  fieldConfidence?: Partial<FieldConfidence> | null;
}

export interface VisionProviderDiagnostics {
  provider: string;
  primaryModel?: string;
  fallbackModel?: string;
  model?: string;
  httpStatus?: number | null;
  attemptCount?: number;
  fallbackModelUsed?: boolean;
  timeout?: boolean;
  totalDurationMs?: number;
  errorCode?: string;
  safeErrorMessage?: string;
}

export class VisionError extends Error {
  code: string;
  httpStatus?: number | null;
  diagnostics?: VisionProviderDiagnostics;

  constructor(
    message: string,
    code: string,
    httpStatus?: number | null,
    diagnostics?: VisionProviderDiagnostics
  ) {
    super(message);
    this.name = "VisionError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.diagnostics = diagnostics;
  }
}

/**
 * Sanitizes error messages by redacting any API keys or tokens.
 */
export function sanitizeVisionErrorMessage(
  msg: string,
  keysToRedact: Array<string | undefined | null> = []
): string {
  let safe = msg;
  for (const key of keysToRedact) {
    if (key && key.length > 3) {
      safe = safe.replaceAll(key, "[REDACTED]");
    }
  }
  // Strip ?key=... or &key=... from URLs
  safe = safe.replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]");
  // Strip Bearer tokens
  safe = safe.replace(/(Bearer\s+)[a-zA-Z0-9_\-\.]+/gi, "$1[REDACTED]");
  // Redact any Google API key pattern (AIzaSy...)
  safe = safe.replace(/AIzaSy[a-zA-Z0-9_\-]{33}/g, "[REDACTED]");
  return safe;
}

/**
 * Checks if an HTTP status is considered a transient failure that should be retried.
 */
export function isTransientVisionStatus(status: number): boolean {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * Classifies HTTP status code into typed error codes.
 */
export function classifyVisionErrorCode(
  status: number | null | undefined,
  errorText?: string
): string {
  if (errorText && errorText.toLowerCase().includes("timed out")) {
    return "VISION_PROVIDER_TIMEOUT";
  }
  if (status === 503 || (errorText && errorText.toLowerCase().includes("overloaded"))) {
    return "VISION_PROVIDER_OVERLOADED";
  }
  if (status === 429) {
    return "VISION_RATE_LIMITED";
  }
  if (status === 401 || status === 403) {
    return "VISION_AUTH_FAILED";
  }
  if (status === 500 || status === 502 || status === 504) {
    return "VISION_PROVIDER_UNAVAILABLE";
  }
  return "VISION_PROVIDER_UNAVAILABLE";
}

export interface AiVisionParserOptions {
  primaryModel?: string;
  fallbackModel?: string;
  geminiModel?: string;
  geminiFallbackModel?: string;
  maxAttempts?: number;
  baseDelays?: number[];
  primaryRetryDelayMs?: number;
  fallbackRetryDelayMs?: number;
  attemptTimeoutMs?: number;
  totalDeadlineMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export class AiVisionSlipParser implements VisionSlipParser {
  private primaryModel: string;
  private fallbackModel: string;
  private maxAttempts: number;
  private primaryRetryDelayMs: number;
  private fallbackRetryDelayMs: number;
  private attemptTimeoutMs: number;
  private totalDeadlineMs: number;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(options?: AiVisionParserOptions) {
    this.primaryModel =
      options?.primaryModel ||
      options?.geminiModel ||
      process.env.GEMINI_MODEL ||
      "gemini-3.8-flash";
    this.fallbackModel =
      options?.fallbackModel ||
      options?.geminiFallbackModel ||
      process.env.GEMINI_FALLBACK_MODEL ||
      "gemini-3.6-flash";
    this.maxAttempts = options?.maxAttempts ?? 2;
    const isTest =
      process.env.VITEST === "true" ||
      process.env.NODE_ENV === "test" ||
      process.env.PLAYWRIGHT_TEST === "1";
    this.primaryRetryDelayMs =
      options?.primaryRetryDelayMs ?? (isTest ? 5 : 350);
    this.fallbackRetryDelayMs =
      options?.fallbackRetryDelayMs ?? (isTest ? 5 : 500);
    this.attemptTimeoutMs = options?.attemptTimeoutMs ?? 5000;
    this.totalDeadlineMs = options?.totalDeadlineMs ?? 12000;
    this.sleepFn =
      options?.sleepFn ||
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async parse(input: SlipVisionInput): Promise<SlipExtraction> {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!geminiKey && !openaiKey) {
      const err = new VisionError(
        "Vision provider credentials are not configured",
        "PROVIDER_NOT_CONFIGURED"
      );
      throw err;
    }

    let rawOutput: RawVisionExtraction | null = null;
    let providerUsed = "";

    // 1. Try Google Gemini Vision (Preferred)
    if (geminiKey) {
      try {
        rawOutput = await this.callGeminiVision(input, geminiKey);
        providerUsed = "gemini";
      } catch (geminiErr: unknown) {
        // If authentication error (401/403): do NOT fallback to OpenAI, throw immediately
        if ((geminiErr as VisionError).code === "VISION_AUTH_FAILED") {
          throw geminiErr;
        }

        // If OpenAI key is available, attempt fallback
        if (openaiKey) {
          try {
            rawOutput = await this.callOpenAiVision(input, openaiKey);
            providerUsed = "openai";
          } catch {
            // Rethrow Gemini error with attached diagnostics
            throw geminiErr;
          }
        } else {
          throw geminiErr;
        }
      }
    } else if (openaiKey) {
      // 2. OpenAI Vision (Fallback if no Gemini key)
      rawOutput = await this.callOpenAiVision(input, openaiKey);
      providerUsed = "openai";
    }

    if (!rawOutput) {
      throw new VisionError(
        "No data returned from vision provider",
        "VISION_EMPTY_EXTRACTION"
      );
    }

    // 3. Post-process & Normalize Output with strict Thai banking logic
    const extraction = this.postProcessExtraction(rawOutput, input, providerUsed);

    // 4. Extraction Quality Gate: ensure response contains usable data
    if (isMateriallyUnusable(extraction)) {
      const err = new VisionError(
        "Vision extraction returned no usable financial data (empty response)",
        "VISION_EMPTY_EXTRACTION"
      );
      throw err;
    }

    return extraction;
  }

  /**
   * Calls Google Gemini Vision API with model fallback and transient error retry logic
   */
  private async callGeminiVision(
    input: SlipVisionInput,
    apiKey: string
  ): Promise<RawVisionExtraction> {
    const startTime = Date.now();
    let lastError: VisionError | null = null;
    let totalAttemptsCount = 0;

    // 1. Try Primary Model (gemini-3.8-flash) with retry for transient errors
    try {
      const result = await this.callGeminiModel({
        model: this.primaryModel,
        input,
        apiKey,
        isFallback: false,
        retryDelayMs: this.primaryRetryDelayMs,
        startTime,
      });
      totalAttemptsCount += result.attempts;
      return result.data;
    } catch (err: unknown) {
      if (err instanceof VisionError) {
        lastError = err;
        totalAttemptsCount += err.diagnostics?.attemptCount ?? 1;
        // Never fallback to another model for authentication/permission errors (401/403)
        if (err.code === "VISION_AUTH_FAILED") {
          throw err;
        }
        // Never fallback on client error 400
        if (err.httpStatus === 400) {
          throw err;
        }
      } else {
        const safeMsg = sanitizeVisionErrorMessage(
          err instanceof Error ? err.message : "Gemini error",
          [apiKey]
        );
        lastError = new VisionError(safeMsg, "VISION_PROVIDER_UNAVAILABLE");
      }
    }

    // Check if total deadline exceeded before trying fallback model
    const elapsedBeforeFallback = Date.now() - startTime;
    if (
      elapsedBeforeFallback >= this.totalDeadlineMs ||
      this.totalDeadlineMs - elapsedBeforeFallback < 500
    ) {
      const diag: VisionProviderDiagnostics = {
        provider: "gemini",
        primaryModel: this.primaryModel,
        fallbackModel: this.fallbackModel,
        model: this.primaryModel,
        httpStatus: lastError?.httpStatus ?? null,
        attemptCount: totalAttemptsCount,
        fallbackModelUsed: false,
        timeout: lastError?.code === "VISION_PROVIDER_TIMEOUT",
        totalDurationMs: elapsedBeforeFallback,
        errorCode: "VISION_PROVIDER_UNAVAILABLE",
        safeErrorMessage: "Overall vision deadline reached before fallback could be attempted",
      };
      throw new VisionError(
        "Vision request deadline exceeded",
        "VISION_PROVIDER_UNAVAILABLE",
        lastError?.httpStatus ?? null,
        diag
      );
    }

    // 2. Try Fallback Model (gemini-3.6-flash) if primary model was unavailable
    if (this.fallbackModel && this.fallbackModel !== this.primaryModel) {
      try {
        const result = await this.callGeminiModel({
          model: this.fallbackModel,
          input,
          apiKey,
          isFallback: true,
          retryDelayMs: this.fallbackRetryDelayMs,
          startTime,
        });
        return result.data;
      } catch (err: unknown) {
        if (err instanceof VisionError) {
          lastError = err;
          if (err.code === "VISION_AUTH_FAILED") {
            throw err;
          }
        } else {
          const safeMsg = sanitizeVisionErrorMessage(
            err instanceof Error ? err.message : "Gemini fallback error",
            [apiKey]
          );
          lastError = new VisionError(safeMsg, "VISION_PROVIDER_UNAVAILABLE");
        }
      }
    }

    // Both primary and fallback Gemini attempts failed
    const finalElapsed = Date.now() - startTime;
    if (lastError?.diagnostics) {
      lastError.diagnostics.totalDurationMs = finalElapsed;
    }
    throw (
      lastError ||
      new VisionError("All Gemini models failed", "VISION_PROVIDER_UNAVAILABLE")
    );
  }

  /**
   * Calls a specific Gemini model with up to maxAttempts retry attempts on transient errors.
   */
  private async callGeminiModel(params: {
    model: string;
    input: SlipVisionInput;
    apiKey: string;
    isFallback: boolean;
    retryDelayMs: number;
    startTime: number;
  }): Promise<{ data: RawVisionExtraction; attempts: number }> {
    const { model, input, apiKey, isFallback, retryDelayMs, startTime } = params;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const base64Data = input.imageBuffer.toString("base64");
    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: THAI_SLIP_SYSTEM_PROMPT },
            {
              inline_data: {
                mime_type: input.mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.1,
      },
    };

    let lastStatus: number | null = null;
    let lastErrorText = "";
    let isTimeout = false;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const elapsedBefore = Date.now() - startTime;
      const remainingTotal = this.totalDeadlineMs - elapsedBefore;
      if (remainingTotal <= 100) {
        const diag: VisionProviderDiagnostics = {
          provider: "gemini",
          primaryModel: this.primaryModel,
          fallbackModel: this.fallbackModel,
          model,
          httpStatus: lastStatus,
          attemptCount: attempt,
          fallbackModelUsed: isFallback,
          timeout: isTimeout,
          totalDurationMs: elapsedBefore,
          errorCode: "VISION_PROVIDER_UNAVAILABLE",
          safeErrorMessage: "Overall vision deadline reached",
        };
        throw new VisionError(
          `Gemini request deadline exceeded on model ${model}`,
          "VISION_PROVIDER_UNAVAILABLE",
          lastStatus,
          diag
        );
      }

      const timeoutMs = Math.min(this.attemptTimeoutMs, remainingTotal);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (fetchErr: unknown) {
        clearTimeout(timeoutId);
        const isAbort =
          controller.signal.aborted ||
          (fetchErr instanceof Error && fetchErr.name === "AbortError");

        if (isAbort) {
          isTimeout = true;
          lastErrorText = `Request timed out after ${timeoutMs}ms`;
        } else {
          const rawMsg =
            fetchErr instanceof Error ? fetchErr.message : "Network fetch failed";
          lastErrorText = sanitizeVisionErrorMessage(rawMsg, [apiKey]);
        }

        const elapsedNow = Date.now() - startTime;

        if (
          attempt < this.maxAttempts &&
          this.totalDeadlineMs - elapsedNow > retryDelayMs + 200
        ) {
          const jitter = Math.floor(Math.random() * (retryDelayMs * 0.2));
          await this.sleepFn(retryDelayMs + jitter);
          continue;
        }

        const errCode = isTimeout
          ? "VISION_PROVIDER_TIMEOUT"
          : "VISION_PROVIDER_UNAVAILABLE";
        const diag: VisionProviderDiagnostics = {
          provider: "gemini",
          primaryModel: this.primaryModel,
          fallbackModel: this.fallbackModel,
          model,
          httpStatus: null,
          attemptCount: attempt,
          fallbackModelUsed: isFallback,
          timeout: isTimeout,
          totalDurationMs: elapsedNow,
          errorCode: errCode,
          safeErrorMessage: lastErrorText,
        };
        throw new VisionError(
          isTimeout
            ? `Gemini request timed out on model ${model} after ${timeoutMs}ms`
            : `Gemini network error on model ${model}: ${lastErrorText}`,
          errCode,
          null,
          diag
        );
      } finally {
        clearTimeout(timeoutId);
      }

      const elapsedNow = Date.now() - startTime;

      if (res.ok) {
        const data = await res.json();
        return {
          data: this.extractGeminiJson(data),
          attempts: attempt,
        };
      }

      // Handle non-OK HTTP status
      lastStatus = res.status;
      const rawText = await res.text().catch(() => "");
      lastErrorText = sanitizeVisionErrorMessage(rawText.slice(0, 200), [apiKey]);

      // 1. Auth errors (401, 403): FAIL IMMEDIATELY (no retry, no model fallback)
      if (res.status === 401 || res.status === 403) {
        const diag: VisionProviderDiagnostics = {
          provider: "gemini",
          primaryModel: this.primaryModel,
          fallbackModel: this.fallbackModel,
          model,
          httpStatus: res.status,
          attemptCount: attempt,
          fallbackModelUsed: isFallback,
          timeout: false,
          totalDurationMs: elapsedNow,
          errorCode: "VISION_AUTH_FAILED",
          safeErrorMessage: `Authentication failed (${res.status})`,
        };
        throw new VisionError(
          `Gemini authentication failed (${res.status}): ${lastErrorText}`,
          "VISION_AUTH_FAILED",
          res.status,
          diag
        );
      }

      // 2. Model not found (404): permanent for this model, do not waste retries
      if (res.status === 404) {
        const diag: VisionProviderDiagnostics = {
          provider: "gemini",
          primaryModel: this.primaryModel,
          fallbackModel: this.fallbackModel,
          model,
          httpStatus: 404,
          attemptCount: attempt,
          fallbackModelUsed: isFallback,
          timeout: false,
          totalDurationMs: elapsedNow,
          errorCode: "VISION_PROVIDER_UNAVAILABLE",
          safeErrorMessage: `Model ${model} not found (404)`,
        };
        throw new VisionError(
          `Gemini model ${model} not found (404): ${lastErrorText}`,
          "VISION_PROVIDER_UNAVAILABLE",
          404,
          diag
        );
      }

      // 3. Transient errors (429, 500, 502, 503, 504)
      if (isTransientVisionStatus(res.status)) {
        if (
          attempt < this.maxAttempts &&
          this.totalDeadlineMs - elapsedNow > retryDelayMs + 200
        ) {
          let delay = retryDelayMs;
          const jitter = Math.floor(Math.random() * (retryDelayMs * 0.2));
          delay += jitter;

          const retryAfterHeader = res.headers?.get
            ? res.headers.get("retry-after")
            : null;
          if (retryAfterHeader) {
            const parsedSeconds = parseFloat(retryAfterHeader);
            if (!isNaN(parsedSeconds) && parsedSeconds >= 0) {
              delay = Math.min(Math.max(delay, parsedSeconds * 1000), 3000);
            }
          }

          await this.sleepFn(delay);
          continue;
        }

        const errorCode = classifyVisionErrorCode(res.status, lastErrorText);
        const diag: VisionProviderDiagnostics = {
          provider: "gemini",
          primaryModel: this.primaryModel,
          fallbackModel: this.fallbackModel,
          model,
          httpStatus: res.status,
          attemptCount: attempt,
          fallbackModelUsed: isFallback,
          timeout: false,
          totalDurationMs: elapsedNow,
          errorCode,
          safeErrorMessage: `Provider error (${res.status})`,
        };
        throw new VisionError(
          `Gemini API transient error (${res.status}) on model ${model}: ${lastErrorText}`,
          errorCode,
          res.status,
          diag
        );
      }

      // 4. Permanent client errors (400, etc.)
      const diag: VisionProviderDiagnostics = {
        provider: "gemini",
        primaryModel: this.primaryModel,
        fallbackModel: this.fallbackModel,
        model,
        httpStatus: res.status,
        attemptCount: attempt,
        fallbackModelUsed: isFallback,
        timeout: false,
        totalDurationMs: elapsedNow,
        errorCode: "VISION_PROVIDER_UNAVAILABLE",
        safeErrorMessage: `Client error (${res.status})`,
      };
      throw new VisionError(
        `Gemini API client error (${res.status}) on model ${model}: ${lastErrorText}`,
        "VISION_PROVIDER_UNAVAILABLE",
        res.status,
        diag
      );
    }

    throw new VisionError(
      `Gemini attempts exhausted on model ${model}`,
      "VISION_PROVIDER_UNAVAILABLE"
    );
  }

  private extractGeminiJson(data: unknown): RawVisionExtraction {
    const record = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const candidate = record?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new VisionError("Empty candidate response from Gemini API", "VISION_EMPTY_EXTRACTION");
    }
    try {
      return JSON.parse(text);
    } catch {
      // Clean possible markdown code fences
      const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      return JSON.parse(cleaned);
    }
  }

  /**
   * Calls OpenAI Vision API via REST
   */
  private async callOpenAiVision(
    input: SlipVisionInput,
    apiKey: string
  ): Promise<RawVisionExtraction> {
    const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
    const url = "https://api.openai.com/v1/chat/completions";

    const base64Data = input.imageBuffer.toString("base64");
    const payload = {
      model,
      messages: [
        { role: "system", content: THAI_SLIP_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all transfer details from this Thai bank slip image." },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const safeErrText = sanitizeVisionErrorMessage(errText.slice(0, 200), [apiKey]);
      const errorCode = classifyVisionErrorCode(res.status, safeErrText);
      const diag: VisionProviderDiagnostics = {
        provider: "openai",
        model,
        httpStatus: res.status,
        errorCode,
      };
      throw new VisionError(
        `OpenAI API error (${res.status}): ${safeErrText}`,
        errorCode,
        res.status,
        diag
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new VisionError("Empty response from OpenAI Vision", "VISION_EMPTY_EXTRACTION");
    }

    return JSON.parse(content);
  }

  /**
   * Normalizes raw AI output into a strictly validated SlipExtraction
   */
  private postProcessExtraction(
    raw: RawVisionExtraction,
    input: SlipVisionInput,
    provider: string
  ): SlipExtraction {
    void provider;

    // 1. Amount Normalization
    const cleanAmount = parseThaiSlipAmount(raw.amount);

    // 2. Date Normalization: Prefer raw visible date/time over AI-normalized transactionDate.
    // Thai bank slip clock times are authoritative in Asia/Bangkok local time.
    const cleanDate =
      parseThaiSlipDate(raw.rawDate) ||
      parseThaiSlipDate(raw.transactionDate) ||
      undefined;

    // 3. Bank & Account Normalization
    const rawSenderBank = raw.sender?.bank || null;
    const normalizedSenderBank = normalizeBankName(rawSenderBank) || rawSenderBank;
    const senderAccount = normalizeMaskedAccount(raw.sender?.accountMasked);
    const senderName = cleanPartyName(raw.sender?.name);

    const rawReceiverBank = raw.receiver?.bank || null;
    const normalizedReceiverBank = normalizeBankName(rawReceiverBank) || rawReceiverBank;
    const receiverAccount = normalizeMaskedAccount(raw.receiver?.accountMasked);
    const receiverName = cleanPartyName(raw.receiver?.name);

    // 4. Reference Normalization & QR Corroboration
    let reference = (raw.reference && typeof raw.reference === "string") ? raw.reference.trim() : undefined;
    const qrData = input.qrPayload ? parseSlipQrPayload(input.qrPayload) : null;

    if (!reference && qrData?.reference) {
      reference = qrData.reference;
    }

    // 5. Confidence Calculation
    const rawConf = raw.fieldConfidence || {};

    const fieldConfidence: FieldConfidence = {
      amount: cleanAmount !== undefined ? Math.min(1.0, Math.max(0.0, rawConf.amount ?? 0.95)) : 0.0,
      transactionDate: cleanDate ? Math.min(1.0, Math.max(0.0, rawConf.transactionDate ?? 0.95)) : 0.0,
      senderName: senderName ? Math.min(1.0, Math.max(0.0, rawConf.senderName ?? 0.9)) : 0.0,
      senderBank: normalizedSenderBank ? Math.min(1.0, Math.max(0.0, rawConf.senderBank ?? 0.95)) : 0.0,
      senderAccount: senderAccount ? Math.min(1.0, Math.max(0.0, rawConf.senderAccount ?? 0.9)) : 0.0,
      receiverName: receiverName ? Math.min(1.0, Math.max(0.0, rawConf.receiverName ?? 0.9)) : 0.0,
      receiverBank: normalizedReceiverBank ? Math.min(1.0, Math.max(0.0, rawConf.receiverBank ?? 0.95)) : 0.0,
      receiverAccount: receiverAccount ? Math.min(1.0, Math.max(0.0, rawConf.receiverAccount ?? 0.9)) : 0.0,
      reference: reference ? Math.min(1.0, Math.max(0.0, rawConf.reference ?? (qrData?.reference ? 0.98 : 0.9))) : 0.0,
    };

    // If QR payload corroborates reference or amount, boost confidence
    if (qrData?.reference && reference && qrData.reference === reference) {
      fieldConfidence.reference = 0.99;
    }

    return {
      amount: cleanAmount,
      currency: "THB",
      transactionDate: cleanDate,
      sender: {
        name: senderName,
        bank: normalizedSenderBank,
        accountMasked: senderAccount,
      },
      receiver: {
        name: receiverName,
        bank: normalizedReceiverBank,
        accountMasked: receiverAccount,
      },
      reference,
      channel: raw.channel || qrData?.channel || "Mobile Banking",
      qrPayload: input.qrPayload || undefined,
      fieldConfidence,
    };
  }
}
