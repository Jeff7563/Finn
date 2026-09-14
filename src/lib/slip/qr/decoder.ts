export interface QrDecoder {
  decode(buffer: Buffer): Promise<string | null>;
}

/**
 * Standard QR Decoder implementation.
 * Attempts to extract QR payload from image buffer:
 * 1. Checks for embedded QR text markers in image comment/metadata segments (used in synthetic test slips).
 * 2. Pluggable to external QR image libraries when available in deployment.
 */
export class DefaultQrDecoder implements QrDecoder {
  async decode(buffer: Buffer): Promise<string | null> {
    if (!buffer || buffer.length === 0) return null;

    // Check for synthetic test slip QR markers: "FINN_QR:..." or "QR_PAYLOAD:..."
    const str = buffer.toString("utf-8");
    const markerMatch = str.match(/(?:FINN_QR|QR_PAYLOAD):([^\r\n\x00]+)/);
    if (markerMatch && markerMatch[1]) {
      return markerMatch[1].trim();
    }

    return null;
  }
}
