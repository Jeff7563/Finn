/**
 * Production and Development Performance Instrumentation Utility.
 *
 * Provides safe timing instrumentation for major server reads:
 * - auth resolution
 * - accounts
 * - transactions
 * - categories
 * - people
 * - merchants
 * - slips / review
 *
 * Strict Privacy Invariant:
 * NEVER logs financial amounts, balances, account numbers, tokens, or personal identifiers.
 * Only logs operation names, durations (ms), and non-sensitive counts (e.g. number of rows).
 */

export interface PerfMetrics {
  name: string;
  durationMs: number;
  itemCount?: number;
  timestamp: number;
}

const IS_DEV = process.env.NODE_ENV === "development";
const IS_DEBUG_PERF = process.env.DEBUG_PERF === "1" || process.env.NEXT_PUBLIC_DEBUG_PERF === "1";
const SLOW_QUERY_THRESHOLD_MS = 500;

export async function measurePerf<T>(
  name: string,
  operation: () => Promise<T>,
  extractCount?: (result: T) => number | undefined
): Promise<T> {
  const start = performance.now();
  try {
    const result = await operation();
    const duration = performance.now() - start;
    const count = extractCount ? extractCount(result) : undefined;

    // Log in development, debug mode, or if exceeding slow query threshold
    if (IS_DEV || IS_DEBUG_PERF || duration > SLOW_QUERY_THRESHOLD_MS) {
      const countSuffix = count !== undefined ? ` [${count} items]` : "";
      const slowPrefix = duration > SLOW_QUERY_THRESHOLD_MS ? "⚠️ [SLOW] " : "";
      console.info(
        `${slowPrefix}[PERF] ${name}${countSuffix} completed in ${duration.toFixed(1)}ms`
      );
    }

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    if (IS_DEV || IS_DEBUG_PERF) {
      console.warn(`[PERF ERROR] ${name} failed after ${duration.toFixed(1)}ms`);
    }
    throw error;
  }
}
