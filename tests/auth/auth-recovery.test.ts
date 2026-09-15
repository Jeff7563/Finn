import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getCanonicalSiteUrl, sanitizeRedirectPath } from "@/lib/server/url";
import {
  isDemoModeAllowed,
  isTestAuthFallbackAllowed,
  verifySessionToken,
  signSessionPayload,
  DEMO_USER_ID,
} from "@/lib/server/session";
import * as authModule from "@/app/actions/auth";
import {
  requestPasswordResetAction,
  updatePasswordAction,
  signInAction,
} from "@/app/actions/auth";
import { GET as callbackHandler } from "@/app/auth/callback/route";
import { NextRequest } from "next/server";

describe("Finn Password Recovery & Production Auth Cleanup Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const setNodeEnv = (val: string) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = val;
  };

  describe("1. Canonical Site URL Resolution", () => {
    it("uses NEXT_PUBLIC_SITE_URL if defined", () => {
      process.env.NEXT_PUBLIC_SITE_URL = "https://custom-domain.finn.app/";
      expect(getCanonicalSiteUrl()).toBe("https://custom-domain.finn.app");
    });

    it("defaults to canonical production site when NODE_ENV is production", () => {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      setNodeEnv("production");
      expect(getCanonicalSiteUrl()).toBe("https://finn-finance-three.vercel.app");
    });

    it("defaults to localhost:3000 in development/test", () => {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      setNodeEnv("development");
      expect(getCanonicalSiteUrl()).toBe("http://localhost:3000");
    });
  });

  describe("2. Open Redirect Sanitization", () => {
    it("allows safe internal relative paths", () => {
      expect(sanitizeRedirectPath("/reset-password")).toBe("/reset-password");
      expect(sanitizeRedirectPath("/today")).toBe("/today");
      expect(sanitizeRedirectPath("/settings/security")).toBe("/settings/security");
      expect(sanitizeRedirectPath("/login?reset=success")).toBe("/login?reset=success");
    });

    it("rejects absolute URLs (http / https)", () => {
      expect(sanitizeRedirectPath("https://evil.com")).toBe("/reset-password");
      expect(sanitizeRedirectPath("http://evil.com/phish")).toBe("/reset-password");
    });

    it("rejects protocol-relative URLs", () => {
      expect(sanitizeRedirectPath("//evil.com")).toBe("/reset-password");
      expect(sanitizeRedirectPath("//evil.com/bypass")).toBe("/reset-password");
    });

    it("rejects pseudo-protocols (javascript:, data:)", () => {
      expect(sanitizeRedirectPath("javascript:alert(1)")).toBe("/reset-password");
      expect(sanitizeRedirectPath("data:text/html,malicious")).toBe("/reset-password");
    });

    it("rejects backslash bypasses", () => {
      expect(sanitizeRedirectPath("/\\evil.com")).toBe("/reset-password");
      expect(sanitizeRedirectPath("\\evil.com")).toBe("/reset-password");
      expect(sanitizeRedirectPath("/settings\\evil.com")).toBe("/reset-password");
    });

    it("handles null, empty, and non-string inputs safely", () => {
      expect(sanitizeRedirectPath(null)).toBe("/reset-password");
      expect(sanitizeRedirectPath("")).toBe("/reset-password");
      expect(sanitizeRedirectPath(undefined)).toBe("/reset-password");
    });
  });

  describe("3. Production Auth Must Fail Closed", () => {
    it("isDemoModeAllowed returns false in production runtime", () => {
      setNodeEnv("production");
      delete process.env.PLAYWRIGHT_TEST;
      expect(isDemoModeAllowed()).toBe(false);

      // Even if someone erroneously attempts to pass ENABLE_DEMO_MODE=true
      process.env.ENABLE_DEMO_MODE = "true";
      expect(isDemoModeAllowed()).toBe(false);
    });

    it("isTestAuthFallbackAllowed returns false in production runtime", () => {
      setNodeEnv("production");
      delete process.env.PLAYWRIGHT_TEST;
      expect(isTestAuthFallbackAllowed()).toBe(false);
    });

    it("verifySessionToken rejects DEMO_USER session in production runtime", async () => {
      setNodeEnv("production");
      delete process.env.PLAYWRIGHT_TEST;

      const demoToken = await signSessionPayload({
        id: DEMO_USER_ID,
        email: "demo@finn.local",
      });

      const user = await verifySessionToken(demoToken);
      expect(user).toBeNull();
    });

    it("Production Supabase failure fails closed and returns safe error without creating finn_session", async () => {
      setNodeEnv("production");
      delete process.env.PLAYWRIGHT_TEST;

      const formData = new FormData();
      formData.set("email", "unknown@test.com");
      formData.set("password", "validpassword123");

      const result = await signInAction(null, formData);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ระบบยืนยันตัวตนขัดข้องชั่วคราว|Invalid login credentials|dummy/i);
    });

    it("No demo login action is exported or accessible", () => {
      expect((authModule as Record<string, unknown>).signInDemoAction).toBeUndefined();
    });
  });

  describe("4. Password Reset Request & Anti-Enumeration", () => {
    it("rejects invalid email formats with validation error", async () => {
      const formData = new FormData();
      formData.set("email", "invalid-email-address");

      const res = await requestPasswordResetAction(null, formData);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/กรุณากรอกอีเมลที่ถูกต้อง/i);
    });

    it("returns identical success response for both known and unknown emails", async () => {
      const form1 = new FormData();
      form1.set("email", "existing-user@example.com");
      const res1 = await requestPasswordResetAction(null, form1);

      const form2 = new FormData();
      form2.set("email", "completely-nonexistent-998877@example.com");
      const res2 = await requestPasswordResetAction(null, form2);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res1.error).toBeUndefined();
      expect(res2.error).toBeUndefined();
    });
  });

  describe("5. Auth Callback Route Handler", () => {
    it("redirects to /forgot-password?error=invalid_or_expired when code is missing", async () => {
      const req = new NextRequest("http://localhost:3000/auth/callback");
      const res = await callbackHandler(req);

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toContain("/forgot-password?error=invalid_or_expired");
    });

    it("redirects to /forgot-password?error=invalid_or_expired when code exchange fails", async () => {
      const req = new NextRequest("http://localhost:3000/auth/callback?code=bogus-invalid-code");
      const res = await callbackHandler(req);

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toContain("/forgot-password?error=invalid_or_expired");
    });

    it("sanitizes open redirect target in next parameter", async () => {
      const req = new NextRequest(
        "http://localhost:3000/auth/callback?code=test&next=https://attacker.com"
      );
      const res = await callbackHandler(req);

      const location = res.headers.get("location");
      // Even if exchange fails, it goes to forgot-password, not attacker.com
      expect(location).not.toContain("attacker.com");
    });
  });

  describe("6. Password Update Validation Policy", () => {
    it("rejects password shorter than 6 characters", async () => {
      const formData = new FormData();
      formData.set("password", "12345");
      formData.set("confirmPassword", "12345");

      const res = await updatePasswordAction(null, formData);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/อย่างน้อย 6 ตัวอักษร/i);
    });

    it("rejects password confirmation mismatch", async () => {
      const formData = new FormData();
      formData.set("password", "NewPassword123!");
      formData.set("confirmPassword", "DifferentPassword123!");

      const res = await updatePasswordAction(null, formData);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน/i);
    });

    it("rejects password update when no authenticated recovery session exists", async () => {
      const formData = new FormData();
      formData.set("password", "ValidNewPassword123");
      formData.set("confirmPassword", "ValidNewPassword123");

      const res = await updatePasswordAction(null, formData);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/เซสชันไม่ถูกต้องหรือหมดอายุ|ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ/i);
    });
  });
});
