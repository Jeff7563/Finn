import { SlipExtraction } from "@/types/slip";

/**
 * Parses a decoded QR string from a Thai banking slip.
 *
 * Distinguishes between:
 * 1. Embedded JSON test payloads (used in fixtures/testing)
 * 2. Bank Slip Verification URLs (e.g., https://promptpay.scb/verify or bank deep-links)
 * 3. BOT / ITMX PromptPay SlipVerify Mini-QRs (contain bank code & ref, NO Tag 54 amount)
 * 4. True EMVCo merchant payment QRs (start with 000201, may have Tag 54 amount)
 *
 * CRITICAL SAFETY:
 * Slip verification QRs do NOT encode transfer amount.
 * Amount is ONLY extracted if tag 54 is explicitly present in a verified EMVCo payload
 * or structured test JSON. Never fabricate or guess amount from verification QRs.
 */
export function parseSlipQrPayload(rawPayload: string): Partial<SlipExtraction> | null {
  if (!rawPayload || typeof rawPayload !== "string") return null;

  const trimmed = rawPayload.trim();
  if (!trimmed) return null;

  // 1. Embedded JSON (fixtures / test slips)
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        amount: typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : undefined,
        currency: "THB",
        transactionDate: parsed.transactionDate || parsed.date,
        sender: parsed.sender,
        receiver: parsed.receiver,
        reference: parsed.reference || parsed.ref,
        channel: parsed.channel || "QR PromptPay",
        qrPayload: trimmed,
        fieldConfidence: {
          amount: typeof parsed.amount === "number" ? 0.99 : 0.0,
          transactionDate: parsed.transactionDate ? 0.99 : 0.0,
          reference: parsed.reference ? 0.99 : 0.0,
        },
      };
    } catch {
      // Not JSON, continue to other formats
    }
  }

  // 2. Bank Slip Verification URLs (e.g. https://... or http://...)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      // Try to extract transaction reference from common query params
      const refParam =
        url.searchParams.get("ref") ||
        url.searchParams.get("transRef") ||
        url.searchParams.get("txn") ||
        url.searchParams.get("id") ||
        url.searchParams.get("reference") ||
        url.searchParams.get("slipId");

      // Or from the last pathname segment if it looks like a transaction ID
      let pathRef: string | undefined;
      const segments = url.pathname.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && lastSegment.length >= 8 && /^[a-zA-Z0-9_-]+$/.test(lastSegment)) {
        pathRef = lastSegment;
      }

      const reference = refParam || pathRef;

      return {
        currency: "THB",
        qrPayload: trimmed,
        channel: "QR Slip Verification URL",
        reference: reference || undefined,
        // Transfer verification URLs DO NOT encode transfer amount
        amount: undefined,
        fieldConfidence: {
          reference: reference ? 0.95 : 0.0,
        },
      };
    } catch {
      // Invalid URL format
    }
  }

  // 3. Bank of Thailand / ITMX PromptPay SlipVerify Mini-QR
  // Structure: Tag 00 length XX contains Subtag 00 (000001 = SlipVerify AID), Subtag 01 (Bank code), Subtag 02 (Txn ref)
  // e.g., 0046000600000101030140225... or 00410006... or 0055...
  const isSlipVerifyMiniQr =
    trimmed.startsWith("00") &&
    trimmed.length > 20 &&
    !trimmed.startsWith("000201") &&
    trimmed.includes("000001");

  if (isSlipVerifyMiniQr) {
    let sendingBank: string | undefined;
    let reference: string | undefined;

    try {
      // Subtag parsing within the SlipVerify container
      const subtagPayload = trimmed.slice(4); // strip outer tag 00 and length
      let idx = 0;
      while (idx + 4 <= subtagPayload.length) {
        const subtag = subtagPayload.slice(idx, idx + 2);
        const len = parseInt(subtagPayload.slice(idx + 2, idx + 4), 10);
        if (isNaN(len) || idx + 4 + len > subtagPayload.length) break;

        const val = subtagPayload.slice(idx + 4, idx + 4 + len);
        idx += 4 + len;

        if (subtag === "01") {
          // Sending bank 3-digit code (e.g. "014" = SCB, "004" = KBANK)
          sendingBank = val;
        } else if (subtag === "02") {
          // Transaction reference
          reference = val;
        }
      }
    } catch {
      // Ignore parsing errors
    }

    return {
      currency: "THB",
      qrPayload: trimmed,
      channel: "PromptPay Mini-QR",
      reference: reference || undefined,
      sender: sendingBank ? { bank: sendingBank } : undefined,
      // Mini-QRs NEVER encode amount directly
      amount: undefined,
      fieldConfidence: {
        reference: reference ? 0.98 : 0.0,
        senderBank: sendingBank ? 0.95 : 0.0,
      },
    };
  }

  // 4. EMVCo Merchant / Presentation QR (TLV structure)
  // Must start with "000201" (Tag 00 = Payload Format Indicator "01")
  if (trimmed.startsWith("000201")) {
    const result: Partial<SlipExtraction> = {
      currency: "THB",
      qrPayload: trimmed,
      channel: "PromptPay QR",
      fieldConfidence: {},
    };

    try {
      let index = 0;
      while (index + 4 <= trimmed.length) {
        const tag = trimmed.slice(index, index + 2);
        const len = parseInt(trimmed.slice(index + 2, index + 4), 10);
        if (isNaN(len) || index + 4 + len > trimmed.length) break;

        const value = trimmed.slice(index + 4, index + 4 + len);
        index += 4 + len;

        if (tag === "54") {
          const amt = parseFloat(value);
          if (!isNaN(amt) && amt > 0) {
            result.amount = amt;
            result.fieldConfidence = { ...result.fieldConfidence, amount: 0.99 };
          }
        } else if (tag === "01" && value.length >= 8) {
          result.reference = value;
          result.fieldConfidence = { ...result.fieldConfidence, reference: 0.95 };
        } else if (tag === "62") {
          // Tag 62: Additional Data Field (TLV container)
          try {
            let subIdx = 0;
            while (subIdx + 4 <= value.length) {
              const subtag = value.slice(subIdx, subIdx + 2);
              const subLen = parseInt(value.slice(subIdx + 2, subIdx + 4), 10);
              if (isNaN(subLen) || subIdx + 4 + subLen > value.length) break;
              const subVal = value.slice(subIdx + 4, subIdx + 4 + subLen);
              subIdx += 4 + subLen;
              if (subtag === "05" || subtag === "01") {
                result.reference = subVal;
                result.fieldConfidence = { ...result.fieldConfidence, reference: 0.95 };
                break;
              }
            }
          } catch {
            // ignore subtag errors
          }
          if (!result.reference && value.length >= 6) {
            result.reference = value;
          }
        }
      }
    } catch {
      // If TLV parsing fails, return whatever was found
    }

    return (result.amount || result.reference) ? result : null;
  }

  // 5. Generic string payload (fallback)
  if (trimmed.length >= 8 && trimmed.length <= 64 && !trimmed.includes(" ")) {
    return {
      currency: "THB",
      qrPayload: trimmed,
      reference: trimmed,
      channel: "QR Code",
      amount: undefined,
      fieldConfidence: {
        reference: 0.8,
      },
    };
  }

  return null;
}
