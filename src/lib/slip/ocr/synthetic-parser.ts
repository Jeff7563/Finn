import { SlipExtraction } from "@/types/slip";
import { SlipVisionInput, VisionSlipParser } from "./types";
import { parseSlipQrPayload } from "../qr/parser";

/**
 * Synthetic Slip Parser for unit, security, and Playwright tests.
 * Extracts structured financial slip data from synthetic test images
 * containing embedded JSON metadata markers or QR payloads.
 */
export class SyntheticSlipParser implements VisionSlipParser {
  async parse(input: SlipVisionInput): Promise<SlipExtraction> {
    // 1. Check if QR payload already contains structured data
    if (input.qrPayload) {
      const qrParsed = parseSlipQrPayload(input.qrPayload);
      if (qrParsed && qrParsed.amount) {
        return {
          amount: qrParsed.amount,
          currency: "THB",
          transactionDate: qrParsed.transactionDate || new Date().toISOString(),
          sender: qrParsed.sender,
          receiver: qrParsed.receiver,
          reference: qrParsed.reference,
          channel: qrParsed.channel || "QR PromptPay",
          qrPayload: input.qrPayload,
          fieldConfidence: qrParsed.fieldConfidence || {
            amount: 0.99,
            transactionDate: 0.98,
            reference: 0.98,
          },
        };
      }
    }

    // 2. Check for embedded synthetic JSON marker in buffer
    const content = input.imageBuffer.toString("utf-8");
    const markerMatch = content.match(/(?:FINN_SLIP_DATA|FINN_SYNTHETIC_SLIP):(\{[\s\S]+?\})(?:\x00|\r|\n|$)/);

    if (markerMatch && markerMatch[1]) {
      try {
        const parsed = JSON.parse(markerMatch[1]);
        return {
          amount: Number(parsed.amount),
          currency: "THB",
          transactionDate: parsed.transactionDate || new Date().toISOString(),
          sender: parsed.sender,
          receiver: parsed.receiver,
          reference: parsed.reference,
          channel: parsed.channel || "Mobile Banking",
          fieldConfidence: {
            amount: parsed.amountConfidence ?? 0.99,
            transactionDate: parsed.dateConfidence ?? 0.98,
            senderAccount: parsed.senderAccountConfidence ?? 0.98,
            receiverAccount: parsed.receiverAccountConfidence ?? 0.98,
            senderBank: 0.99,
            receiverBank: 0.99,
            reference: parsed.referenceConfidence ?? 0.99,
          },
        };
      } catch {
        // Invalid JSON in marker
      }
    }

    throw new Error("Unable to extract structured slip data from synthetic image");
  }
}
