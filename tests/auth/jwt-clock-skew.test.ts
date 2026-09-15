import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isTransientJwtSkewError,
  withJwtSkewRetry,
  executeQueryWithSkewRetry,
  DEFAULT_JWT_SKEW_DELAYS_MS,
} from "@/lib/server/jwt-resilience";
import {
  isTestAuthFallbackAllowed,
  isDemoModeAllowed,
  verifySessionToken,
  signSessionPayload,
  DEMO_USER_ID,
} from "@/lib/server/session";
import { getAuthenticatedUser } from "@/lib/server/auth";

describe("Finn Auth JWT Clock-Skew Resilience Suite", () => {
  const originalEnv = { ...process.env };

  const setNodeEnv = (val: string) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = val;
  };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("1. Error Detection (isTransientJwtSkewError)", () => {
    it("detects exact and case-insensitive 'JWT issued at future' error string and objects", () => {
      expect(isTransientJwtSkewError("JWT issued at future")).toBe(true);
      expect(isTransientJwtSkewError(new Error("JWT issued at future"))).toBe(true);
      expect(isTransientJwtSkewError("jwt issued at future")).toBe(true);
      expect(isTransientJwtSkewError({ message: "JWT issued at future" })).toBe(true);
      expect(isTransientJwtSkewError({ details: "error: jwt issued at future" })).toBe(true);
      expect(isTransientJwtSkewError({ error_description: "JWT issued at future" })).toBe(true);
    });

    it("detects other JWT timing skew variants", () => {
      expect(isTransientJwtSkewError("jwt is not yet valid")).toBe(true);
      expect(isTransientJwtSkewError(new Error("token is not valid yet"))).toBe(true);
      expect(isTransientJwtSkewError({ hint: "claim iat is issued in the future" })).toBe(true);
    });

    it("returns FALSE for unrelated Supabase / PostgREST errors", () => {
      expect(isTransientJwtSkewError(new Error("relation 'accounts' does not exist"))).toBe(false);
      expect(isTransientJwtSkewError(new Error("foreign key violation: invalid person_id"))).toBe(false);
      expect(isTransientJwtSkewError(new Error("PGRST116: The result contains 0 rows"))).toBe(false);
      expect(isTransientJwtSkewError({ message: "permission denied for table accounts", code: "42501" })).toBe(false);
      expect(isTransientJwtSkewError("fetch failed: connection refused")).toBe(false);
      expect(isTransientJwtSkewError(null)).toBe(false);
      expect(isTransientJwtSkewError(undefined)).toBe(false);
    });
  });

  describe("2. Retry Logic & Success on Retry", () => {
    it("retries on 'JWT issued at future' and succeeds on second attempt", async () => {
      let attempts = 0;
      const retryEvents: { attempt: number; delayMs: number }[] = [];

      const mockOperation = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("JWT issued at future");
        }
        return { data: "success_account_payload" };
      });

      const result = await withJwtSkewRetry(mockOperation, {
        delaysMs: [10, 20], // Short delays for fast test execution
        onRetry: (attempt, delayMs) => {
          retryEvents.push({ attempt, delayMs });
        },
      });

      expect(attempts).toBe(2);
      expect(result).toEqual({ data: "success_account_payload" });
      expect(retryEvents).toEqual([{ attempt: 1, delayMs: 10 }]);
    });

    it("works with executeQueryWithSkewRetry for Supabase query objects", async () => {
      let attempts = 0;
      const mockQuery = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          return { data: null, error: { message: "JWT issued at future" } };
        }
        return { data: [{ id: "acc-1", name: "Main Account" }], error: null };
      });

      const res = await executeQueryWithSkewRetry(mockQuery, {
        delaysMs: [5, 10],
      });

      expect(attempts).toBe(2);
      expect(res.error).toBeNull();
      expect(res.data).toHaveLength(1);
      expect(res.data?.[0].id).toBe("acc-1");
    });
  });

  describe("3. Unrelated Errors are NOT Retried", () => {
    it("throws immediately without retry on unrelated database error", async () => {
      let attempts = 0;
      const onRetry = vi.fn();

      const mockOperation = vi.fn(async () => {
        attempts++;
        throw new Error("relation 'accounts' does not exist");
      });

      await expect(
        withJwtSkewRetry(mockOperation, {
          delaysMs: [10, 20],
          onRetry,
        })
      ).rejects.toThrow("relation 'accounts' does not exist");

      expect(attempts).toBe(1);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it("does not retry unrelated query errors in executeQueryWithSkewRetry", async () => {
      let attempts = 0;
      const mockQuery = vi.fn(async () => {
        attempts++;
        return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      });

      const res = await executeQueryWithSkewRetry(mockQuery, {
        delaysMs: [5, 10],
      });

      expect(attempts).toBe(1);
      expect(res.error).toEqual({ message: "duplicate key value violates unique constraint" });
    });
  });

  describe("4. Strictly Bounded Retries", () => {
    it("defaults to exactly 2 retries with [300, 700] ms bounded delays", () => {
      expect(DEFAULT_JWT_SKEW_DELAYS_MS).toEqual([300, 700]);
    });

    it("fails normally after exceeding maximum 2 retries (total 3 attempts)", async () => {
      let attempts = 0;
      const retryEvents: { attempt: number; delayMs: number }[] = [];

      const mockOperation = vi.fn(async () => {
        attempts++;
        throw new Error("JWT issued at future");
      });

      await expect(
        withJwtSkewRetry(mockOperation, {
          delaysMs: [5, 10],
          onRetry: (attempt, delayMs) => {
            retryEvents.push({ attempt, delayMs });
          },
        })
      ).rejects.toThrow("JWT issued at future");

      // Total attempts: Initial + Attempt 1 + Attempt 2 = 3
      expect(attempts).toBe(3);
      expect(retryEvents).toEqual([
        { attempt: 1, delayMs: 5 },
        { attempt: 2, delayMs: 10 },
      ]);
    });
  });

  describe("5. Production Auth Never Falls Back to Demo/Memory", () => {
    it("isTestAuthFallbackAllowed and isDemoModeAllowed return false in production runtime", () => {
      setNodeEnv("production");
      delete process.env.PLAYWRIGHT_TEST;

      expect(isTestAuthFallbackAllowed()).toBe(false);
      expect(isDemoModeAllowed()).toBe(false);
    });

    it("production verifySessionToken rejects demo session even if token is signed", async () => {
      setNodeEnv("production");
      delete process.env.PLAYWRIGHT_TEST;

      const demoToken = await signSessionPayload({
        id: DEMO_USER_ID,
        email: "demo@finn.local",
      });

      const verified = await verifySessionToken(demoToken);
      expect(verified).toBeNull();
    });

    it("getAuthenticatedUser returns null rather than creating a fallback session when auth fails in production", async () => {
      setNodeEnv("production");
      delete process.env.PLAYWRIGHT_TEST;

      const user = await getAuthenticatedUser();
      expect(user).toBeNull();
    });
  });
});
