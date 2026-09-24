/**
 * Vision Provider Adaptive Timeout Configuration
 *
 * Configurable via server-only environment variables:
 * - VISION_PRIMARY_TIMEOUT_MS: Timeout for primary vision model attempt (3000-20000ms, default 10000ms)
 * - VISION_FALLBACK_TIMEOUT_MS: Timeout for fallback vision model attempt (3000-20000ms, default 10000ms)
 * - VISION_TOTAL_DEADLINE_MS: Hard total deadline for the entire vision request (10000-45000ms, default 25000ms)
 * - VISION_MAX_ATTEMPTS: Max attempts per model tier before fallback/failure (1-2, default 1)
 *
 * IMPORTANT:
 * - Server-only: Never expose these as NEXT_PUBLIC_ variables.
 * - Validated & bounded: Invalid or absurd inputs automatically fall back safely to defaults.
 */

export interface VisionTimeoutConfig {
  primaryTimeoutMs: number;
  fallbackTimeoutMs: number;
  totalDeadlineMs: number;
  maxAttempts: number;
}

export const VISION_TIMEOUT_DEFAULTS: VisionTimeoutConfig = {
  primaryTimeoutMs: 10000,
  fallbackTimeoutMs: 10000,
  totalDeadlineMs: 25000,
  maxAttempts: 1,
};

export const VISION_TIMEOUT_BOUNDS = {
  primaryMinMs: 3000,
  primaryMaxMs: 20000,
  fallbackMinMs: 3000,
  fallbackMaxMs: 20000,
  totalMinMs: 10000,
  totalMaxMs: 45000,
  minAttempts: 1,
  maxAttempts: 2,
} as const;

/**
 * Parses an integer from environment variables or inputs and bounds it.
 * Falls back to default on NaN, non-finite, out-of-bounds, negative, or absurd values.
 */
export function parseBoundedInt(
  val: string | number | undefined | null,
  min: number,
  max: number,
  fallback: number
): number {
  if (val === undefined || val === null) {
    return fallback;
  }
  const str = typeof val === "string" ? val.trim() : String(val).trim();
  if (str === "") {
    return fallback;
  }
  const parsed = Number(str);
  if (!Number.isFinite(parsed) || isNaN(parsed)) {
    return fallback;
  }
  const intVal = Math.floor(parsed);
  if (intVal <= 0) {
    return fallback;
  }
  if (intVal < min) {
    return min;
  }
  if (intVal > max) {
    return max;
  }
  return intVal;
}

/**
 * Returns validated, bounded server-only vision timeout settings.
 */
export function getVisionTimeoutConfig(): VisionTimeoutConfig {
  const primary = parseBoundedInt(
    process.env.VISION_PRIMARY_TIMEOUT_MS,
    VISION_TIMEOUT_BOUNDS.primaryMinMs,
    VISION_TIMEOUT_BOUNDS.primaryMaxMs,
    VISION_TIMEOUT_DEFAULTS.primaryTimeoutMs
  );

  const fallback = parseBoundedInt(
    process.env.VISION_FALLBACK_TIMEOUT_MS,
    VISION_TIMEOUT_BOUNDS.fallbackMinMs,
    VISION_TIMEOUT_BOUNDS.fallbackMaxMs,
    VISION_TIMEOUT_DEFAULTS.fallbackTimeoutMs
  );

  const rawTotal = parseBoundedInt(
    process.env.VISION_TOTAL_DEADLINE_MS,
    VISION_TIMEOUT_BOUNDS.totalMinMs,
    VISION_TIMEOUT_BOUNDS.totalMaxMs,
    VISION_TIMEOUT_DEFAULTS.totalDeadlineMs
  );

  const maxAttempts = parseBoundedInt(
    process.env.VISION_MAX_ATTEMPTS,
    VISION_TIMEOUT_BOUNDS.minAttempts,
    VISION_TIMEOUT_BOUNDS.maxAttempts,
    VISION_TIMEOUT_DEFAULTS.maxAttempts
  );

  // Authoritative total must never be less than individual attempt timeout
  const total = Math.max(rawTotal, primary);

  return {
    primaryTimeoutMs: primary,
    fallbackTimeoutMs: fallback,
    totalDeadlineMs: total,
    maxAttempts,
  };
}
