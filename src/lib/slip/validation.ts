import crypto from "crypto";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export type DetectedMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export interface FileValidationResult {
  valid: boolean;
  mime?: DetectedMime;
  extension?: string;
  error?: string;
  errorCode?: "EMPTY_FILE" | "FILE_TOO_LARGE" | "INVALID_MAGIC_BYTES" | "UNSUPPORTED_TYPE";
}

/**
 * Validates file buffer based on actual magic bytes, not client-declared headers.
 */
export function validateSlipFile(buffer: Buffer): FileValidationResult {
  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      error: "File is empty",
      errorCode: "EMPTY_FILE",
    };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: "File size exceeds 10 MB limit",
      errorCode: "FILE_TOO_LARGE",
    };
  }

  // Check Magic Bytes
  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { valid: true, mime: "image/jpeg", extension: "jpg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, mime: "image/png", extension: "png" };
  }

  // WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return { valid: true, mime: "image/webp", extension: "webp" };
  }

  // PDF: 25 50 44 46 (%PDF)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return { valid: true, mime: "application/pdf", extension: "pdf" };
  }

  return {
    valid: false,
    error: "File format is not a supported image (JPEG, PNG, WebP) or PDF",
    errorCode: "INVALID_MAGIC_BYTES",
  };
}

/**
 * Computes deterministic SHA-256 hash of file content.
 */
export function computeFileSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Generates an owner-scoped, non-identifying storage path:
 * `{user_id}/{yyyy}/{mm}/{uuid}.{ext}`
 * Never includes user email, phone, account number, or amount in path.
 */
export function generateSlipStoragePath(
  userId: string,
  extension: string,
  date: Date = new Date()
): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const cleanExt = extension.replace(/^\./, "").toLowerCase();
  return `${userId}/${yyyy}/${mm}/${uuid}.${cleanExt}`;
}
