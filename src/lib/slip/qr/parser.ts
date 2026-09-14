import { SlipExtraction } from "@/types/slip";

/**
 * Parses a decoded QR string from a Thai banking slip.
 * Supports EMVCo PromptPay slip verify tags and JSON-formatted payloads.
 */
export function parseSlipQrPayload(rawPayload: string): Partial<SlipExtraction> | null {
  if (!rawPayload || typeof rawPayload !== "string") return null;

  const trimmed = rawPayload.trim();

  // Check if payload is embedded JSON (common in test fixtures / synthetic slips)
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        amount: typeof parsed.amount === "number" ? parsed.amount : undefined,
        currency: "THB",
        transactionDate: parsed.transactionDate || parsed.date,
        sender: parsed.sender,
        receiver: parsed.receiver,
        reference: parsed.reference || parsed.ref,
        channel: parsed.channel || "QR PromptPay",
        qrPayload: trimmed,
        fieldConfidence: {
          amount: 0.99,
          transactionDate: 0.99,
          reference: 0.99,
        },
      };
    } catch {
      // Not JSON, continue to EMVCo parser
    }
  }

  // Parse EMVCo / PromptPay slip QR (TLV structure)
  // Tags of interest in Thai QR:
  // Tag 00: Payload Format Indicator ("01")
  // Tag 54: Transaction Amount
  // Tag 53: Transaction Currency ("764" = THB)
  // Tag 01: Transfer Ref / Bank code
  const result: Partial<SlipExtraction> = {
    currency: "THB",
    qrPayload: trimmed,
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
      } else if (tag === "00" && value === "000201") {
        result.channel = "PromptPay QR";
      } else if (tag === "01" && value.length >= 8) {
        // May contain transfer reference
        result.reference = value;
        result.fieldConfidence = { ...result.fieldConfidence, reference: 0.95 };
      }
    }
  } catch {
    // If TLV parsing fails, return whatever was found
  }

  return (result.amount || result.reference) ? result : null;
}
