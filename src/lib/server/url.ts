/**
 * Canonical URL resolution and redirect sanitization utilities for Finn Auth.
 */

/**
 * Resolves the canonical site URL for authentication callbacks and email redirects.
 *
 * Security Invariants:
 * 1. Uses NEXT_PUBLIC_SITE_URL if configured.
 * 2. Defaults to production site (https://finn-finance-three.vercel.app) in production.
 * 3. Defaults to http://localhost:3000 in development/test.
 * 4. NEVER trusts or extracts from the HTTP Host or X-Forwarded-Host header.
 */
export function getCanonicalSiteUrl(): string {
  let siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!siteUrl) {
    siteUrl =
      process.env.NODE_ENV === "production"
        ? "https://finn-finance-three.vercel.app"
        : "http://localhost:3000";
  }

  // Strip trailing slashes for consistent URL formation
  return siteUrl.replace(/\/+$/, "");
}

/**
 * Sanitizes redirect target paths to strictly prevent Open Redirect vulnerabilities.
 *
 * Requirements:
 * - Only internal, relative paths starting with a single '/' are permitted.
 * - Rejects protocol-relative URLs (e.g. //evil.com)
 * - Rejects absolute URLs (e.g. https://evil.com, http://evil.com)
 * - Rejects pseudo-protocols (e.g. javascript:..., data:...)
 * - Rejects backslash bypasses (e.g. /\\evil.com, \\evil.com)
 */
export function sanitizeRedirectPath(
  nextPath: string | null | undefined,
  defaultPath = "/reset-password"
): string {
  if (!nextPath || typeof nextPath !== "string") {
    return defaultPath;
  }

  const trimmed = nextPath.trim();

  // Must begin with a single '/' and NOT '//' or '/\'
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\")
  ) {
    return defaultPath;
  }

  // Must not contain colon (blocks schemes like javascript:, https:, etc.)
  if (trimmed.includes(":")) {
    return defaultPath;
  }

  // Must not contain backslashes
  if (trimmed.includes("\\")) {
    return defaultPath;
  }

  return trimmed;
}
