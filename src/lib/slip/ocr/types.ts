import { SlipExtraction } from "@/types/slip";

export interface OcrResult {
  text: string;
  confidence: number;
}

export interface SlipVisionInput {
  imageBuffer: Buffer;
  mimeType: string;
  qrPayload?: string | null;
}

export interface VisionSlipParser {
  parse(input: SlipVisionInput): Promise<SlipExtraction>;
}

export interface OcrProvider {
  extractText(image: Buffer): Promise<OcrResult>;
}
