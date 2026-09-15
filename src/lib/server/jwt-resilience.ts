/**
 * Production Resilience Layer for Supabase Auth JWT Clock-Skew.
 *
 * Handles transient clock-skew timing errors immediately after login/password recovery
 * such as "JWT issued at future" without weakening verification or bypassing RLS.
 */

/**
 * Detects transient JWT clock-skew timing errors from Supabase GoTrue / PostgREST.
 *
 * Specific target errors:
 * - "JWT issued at future"
 * - "jwt is not yet valid"
 * - "token is not valid yet"
 *
 * Strict Security Invariant:
 * Returns false for all unrelated database, network, syntax, or permission errors.
 */
export function isTransientJwtSkewError(err: unknown): boolean {
  if (!err) return false;

  let message = "";
  if (typeof err === "string") {
    message = err;
  } else if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    message = [obj.message, obj.details, obj.hint, obj.error_description]
      .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
      .join(" ");
  }

  const lower = message.toLowerCase();
  return (
    lower.includes("jwt issued at future") ||
    lower.includes("jwt is not yet valid") ||
    lower.includes("token is not valid yet") ||
    lower.includes("issued in the future")
  );
}

export interface JwtSkewRetryOptions {
  /** Maximum number of retries (Default: 2) */
  maxRetries?: number;
  /** Bounded delays in milliseconds for each retry attempt (Default: [300, 700]) */
  delaysMs?: number[];
  /** Optional telemetry or test hook invoked before each retry */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export const DEFAULT_JWT_SKEW_DELAYS_MS = [300, 700];

/**
 * Executes an async operation with bounded retries strictly for transient JWT clock-skew errors.
 *
 * Invariants:
 * 1. Retries a MAXIMUM of 2 times (default delays: attempt 1 -> 300ms, attempt 2 -> 700ms).
 * 2. Unrelated database errors are NEVER retried.
 * 3. Does NOT weaken JWT verification or bypass RLS.
 * 4. Does NOT create local/demo sessions.
 * 5. If still failing after bounded retries, fails normally.
 */
export async function withJwtSkewRetry<T>(
  operation: () => PromiseLike<T>,
  options?: JwtSkewRetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2;
  const delays = options?.delaysMs ?? DEFAULT_JWT_SKEW_DELAYS_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      lastError = err;

      // Only retry if it is specifically a transient JWT clock-skew error
      if (attempt < maxRetries && isTransientJwtSkewError(err)) {
        const delayMs = delays[attempt] ?? 700;
        if (options?.onRetry) {
          options.onRetry(attempt + 1, delayMs, err);
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // Unrelated error or reached max retries: throw immediately
      throw err;
    }
  }

  throw lastError;
}

/**
 * Executes a Supabase / PostgREST query returning `{ data, error }` with bounded JWT skew retries.
 */
export async function executeQueryWithSkewRetry<T extends { error: unknown }>(
  queryFn: () => PromiseLike<T>,
  options?: JwtSkewRetryOptions
): Promise<T> {
  return withJwtSkewRetry(async () => {
    const res = await queryFn();
    if (res.error && isTransientJwtSkewError(res.error)) {
      throw res.error;
    }
    return res;
  }, options);
}
