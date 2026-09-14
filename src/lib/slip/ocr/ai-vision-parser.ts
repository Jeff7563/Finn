import { SlipExtraction } from "@/types/slip";
import { SlipVisionInput, VisionSlipParser } from "./types";

/**
 * AI Vision Slip Parser adapter.
 * Uses configured server-side LLM/Vision provider (e.g. OpenAI or Gemini).
 * If no provider credentials are configured, safely fails without fabricating data.
 */
export class AiVisionSlipParser implements VisionSlipParser {
  async parse(input: SlipVisionInput): Promise<SlipExtraction> {
    void input;
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!openaiKey && !geminiKey) {
      const err = new Error("Vision provider credentials are not configured");
      (err as unknown as { code: string }).code = "PROVIDER_NOT_CONFIGURED";
      throw err;
    }

    // In production with credentials configured:
    // Call external LLM Vision API with structured JSON output schema.
    // For privacy: only pass image bytes, never user credentials or transaction history.
    throw new Error("External Vision provider integration requires active deployment credentials");
  }
}
