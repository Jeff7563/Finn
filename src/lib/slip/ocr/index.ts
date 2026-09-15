import { VisionSlipParser, SlipVisionInput } from "./types";
import { SyntheticSlipParser } from "./synthetic-parser";
import { AiVisionSlipParser, AiVisionParserOptions } from "./ai-vision-parser";
import { SlipExtraction } from "@/types/slip";

export class CompositeSlipParser implements VisionSlipParser {
  private syntheticParser = new SyntheticSlipParser();
  private aiParser: AiVisionSlipParser;

  constructor(options?: AiVisionParserOptions) {
    this.aiParser = new AiVisionSlipParser(options);
  }

  async parse(input: SlipVisionInput): Promise<SlipExtraction> {
    // 1. Check if synthetic test markers or QR JSON exist
    try {
      return await this.syntheticParser.parse(input);
    } catch {
      // 2. Fall back to AI Vision parser (or fail safely if unconfigured)
      return await this.aiParser.parse(input);
    }
  }
}

export * from "./types";
export * from "./synthetic-parser";
export * from "./ai-vision-parser";
