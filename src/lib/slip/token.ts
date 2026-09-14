import crypto from "crypto";

export const INGEST_TOKEN_PREFIX = "finn_ingest_";
export const INGEST_TOKEN_SCOPE = "slip:ingest";

/**
 * Generates a high-entropy scoped ingest token.
 * Format: `finn_ingest_<64 hex chars>`
 * Returns the raw token (to show once to the user), its SHA-256 hash, and a display prefix.
 */
export function generateIngestToken(): {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const randomBytes = crypto.randomBytes(32).toString("hex");
  const rawToken = `${INGEST_TOKEN_PREFIX}${randomBytes}`;
  const tokenHash = hashToken(rawToken);
  // Display prefix shows first 16 characters, e.g. "finn_ingest_a1b2..."
  const tokenPrefix = `${rawToken.slice(0, 16)}...`;

  return {
    rawToken,
    tokenHash,
    tokenPrefix,
  };
}

/**
 * Computes deterministic SHA-256 hash of a raw ingest token.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Verifies raw token against stored SHA-256 hash using constant-time comparison.
 */
export function verifyTokenHash(rawToken: string, storedHash: string): boolean {
  if (!rawToken || !storedHash) return false;
  if (!rawToken.startsWith(INGEST_TOKEN_PREFIX)) return false;

  const computedHash = hashToken(rawToken);
  try {
    const computedBuf = Buffer.from(computedHash, "hex");
    const storedBuf = Buffer.from(storedHash, "hex");
    if (computedBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, storedBuf);
  } catch {
    return false;
  }
}

/**
 * Checks if a token is valid (not revoked, not expired).
 */
export function isTokenUsable(token: {
  revoked_at?: string | null;
  expires_at?: string | null;
}): boolean {
  if (token.revoked_at) return false;
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    return false;
  }
  return true;
}
