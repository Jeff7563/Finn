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

export class AiVisionSlipParser implements VisionSlipParser {
  async parse(input: SlipVisionInput): Promise<SlipExtraction> {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!geminiKey && !openaiKey) {
      const err = new Error("Vision provider credentials are not configured");
      (err as unknown as { code: string }).code = "PROVIDER_NOT_CONFIGURED";
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
        // If OpenAI key is available, attempt fallback
        if (openaiKey) {
          try {
            rawOutput = await this.callOpenAiVision(input, openaiKey);
            providerUsed = "openai";
          } catch (openaiErr: unknown) {
            throw new Error(
              `Vision extraction failed on both Gemini (${geminiErr instanceof Error ? geminiErr.message : "error"}) and OpenAI (${openaiErr instanceof Error ? openaiErr.message : "error"})`
            );
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
      throw new Error("No data returned from vision provider");
    }

    // 3. Post-process & Normalize Output with strict Thai banking logic
    return this.postProcessExtraction(rawOutput, input, providerUsed);
  }

  /**
   * Calls Google Gemini Vision API via REST
   */
  private async callGeminiVision(
    input: SlipVisionInput,
    apiKey: string
  ): Promise<RawVisionExtraction> {
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
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

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // If 2.0-flash not found or quota, try 1.5-flash
      if (res.status === 404 && model !== "gemini-1.5-flash") {
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const fallbackRes = await fetch(fallbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          return this.extractGeminiJson(fallbackData);
        }
      }
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return this.extractGeminiJson(data);
  }

  private extractGeminiJson(data: unknown): RawVisionExtraction {
    const record = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const candidate = record?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Empty candidate response from Gemini API");
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
      throw new Error(`OpenAI API error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI Vision");
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
