import { AuthenticatedUser } from "./auth";

export const DEMO_USER_ID = "demo-user-fintech";
export const DEMO_USER_EMAIL = "demo@finn.local";
export const DEMO_USER_DISPLAY_NAME = "Fintech User";

export const DEMO_USER: AuthenticatedUser = {
  id: DEMO_USER_ID,
  email: DEMO_USER_EMAIL,
  display_name: DEMO_USER_DISPLAY_NAME,
};

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "finn-internal-crypto-salt-key-hardening-2026";

/**
 * Checks if demo mode is permitted in the current runtime environment.
 * Default: enabled in development / test, disabled in production unless explicit ENABLE_DEMO_MODE="true".
 */
export function isDemoModeAllowed(): boolean {
  if (process.env.ENABLE_DEMO_MODE === "true") return true;
  if (process.env.ENABLE_DEMO_MODE === "false") return false;
  if (process.env.PLAYWRIGHT_TEST === "1" || process.env.VITEST === "true") return true;
  return process.env.NODE_ENV !== "production";
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

/**
 * Signs user session payload with standard Web Crypto HMAC SHA-256.
 * Supported across both Node.js and Edge Runtime without external dependencies.
 */
export async function signSessionPayload(user: AuthenticatedUser): Promise<string> {
  const enc = new TextEncoder();
  const dataStr = JSON.stringify(user);
  const dataBytes = enc.encode(dataStr);
  const dataB64 = base64UrlEncode(dataBytes);

  const key = await getHmacKey(SESSION_SECRET, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(dataB64));
  const sigB64 = base64UrlEncode(new Uint8Array(signature));

  return `${dataB64}.${sigB64}`;
}

/**
 * Verifies and parses an HMAC-signed session cookie using timing-safe Web Crypto.
 * Rejects forged, tampered, or malformed cookies.
 */
export async function verifySessionToken(
  token: string
): Promise<AuthenticatedUser | null> {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) {
    // Check if it was legacy raw JSON; if so, only allow if strictly matching demo user in allowed env
    try {
      const raw = JSON.parse(token);
      if (
        isDemoModeAllowed() &&
        raw?.id === DEMO_USER_ID &&
        raw?.email === DEMO_USER_EMAIL
      ) {
        return DEMO_USER;
      }
    } catch {
      // not json
    }
    return null;
  }

  const [dataB64, sigB64] = parts;

  try {
    const enc = new TextEncoder();
    const key = await getHmacKey(SESSION_SECRET, ["verify"]);
    const sigBytes = base64UrlDecode(sigB64);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as BufferSource,
      enc.encode(dataB64)
    );

    if (!isValid) {
      return null;
    }

    const dataBytes = base64UrlDecode(dataB64);
    const jsonStr = new TextDecoder().decode(dataBytes);
    const user = JSON.parse(jsonStr) as AuthenticatedUser;

    if (!user || typeof user.id !== "string" || typeof user.email !== "string") {
      return null;
    }

    // If session is demo user, verify demo mode is allowed
    if (user.id === DEMO_USER_ID && !isDemoModeAllowed()) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}
