"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { authSchema } from "@/lib/validation/schemas";
import {
  signSessionPayload,
  isTestAuthFallbackAllowed,
  DEMO_USER,
  DEMO_USER_EMAIL,
} from "@/lib/server/session";
import { getCanonicalSiteUrl } from "@/lib/server/url";

export interface ActionResult {
  success: boolean;
  error?: string;
}

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("กรุณากรอกอีเมลที่ถูกต้อง").max(255),
});

const passwordUpdateSchema = z
  .object({
    password: z
      .string()
      .min(6, "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร")
      .max(128, "รหัสผ่านยาวเกินขีดจำกัด"),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่านใหม่"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน",
    path: ["confirmPassword"],
  });

/**
 * Production-ready sign in action.
 * CRITICAL SECURITY INVARIANT:
 * In production, Supabase failure MUST FAIL CLOSED.
 * NEVER creates a finn_session or dev-user fallback in production.
 */
export async function signInAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  const parsed = authSchema.safeParse({ email, password });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "ข้อมูลไม่ถูกต้อง",
    };
  }

  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    cookieStore = null;
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      if (isTestAuthFallbackAllowed()) {
        // Gated strictly behind automated test runners (Playwright / Vitest with placeholder keys)
        const isDemo = parsed.data.email === DEMO_USER_EMAIL;
        const userPayload = isDemo
          ? DEMO_USER
          : {
              id: "dev-user-12345",
              email: parsed.data.email,
              display_name: parsed.data.email.split("@")[0],
            };

        cookieStore?.set(
          "finn_session",
          await signSessionPayload(userPayload),
          {
            path: "/",
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
          }
        );
      } else {
        // PRODUCTION: FAIL CLOSED. Do NOT set finn_session cookie.
        const isNetworkOrConfig =
          error.message.includes("fetch failed") ||
          error.message.includes("Invalid API key") ||
          error.message.includes("dummy");

        return {
          success: false,
          error: isNetworkOrConfig
            ? "ระบบยืนยันตัวตนขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลัง"
            : error.message,
        };
      }
    }
  } catch {
    if (isTestAuthFallbackAllowed()) {
      const isDemo = parsed.data.email === DEMO_USER_EMAIL;
      const userPayload = isDemo
        ? DEMO_USER
        : {
            id: "dev-user-12345",
            email: parsed.data.email,
            display_name: parsed.data.email.split("@")[0],
          };

      cookieStore?.set(
        "finn_session",
        await signSessionPayload(userPayload),
        {
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
        }
      );
    } else {
      // PRODUCTION: FAIL CLOSED.
      return {
        success: false,
        error: "ระบบยืนยันตัวตนขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลัง",
      };
    }
  }

  redirect("/today");
}

/**
 * Production-ready sign up action.
 * CRITICAL SECURITY INVARIANT:
 * In production, Supabase failure MUST FAIL CLOSED.
 * NEVER creates a finn_session fallback in production.
 */
export async function signUpAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  const parsed = authSchema.safeParse({ email, password });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "ข้อมูลไม่ถูกต้อง",
    };
  }

  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    cookieStore = null;
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      if (isTestAuthFallbackAllowed()) {
        cookieStore?.set(
          "finn_session",
          await signSessionPayload({
            id: `user-${crypto.randomUUID()}`,
            email: parsed.data.email,
            display_name: parsed.data.email.split("@")[0],
          }),
          {
            path: "/",
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
          }
        );
      } else {
        const isNetworkOrConfig =
          error.message.includes("fetch failed") ||
          error.message.includes("Invalid API key") ||
          error.message.includes("dummy");

        return {
          success: false,
          error: isNetworkOrConfig
            ? "ระบบยืนยันตัวตนขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลัง"
            : error.message,
        };
      }
    }
  } catch {
    if (isTestAuthFallbackAllowed()) {
      cookieStore?.set(
        "finn_session",
        await signSessionPayload({
          id: `user-${crypto.randomUUID()}`,
          email: parsed.data.email,
          display_name: parsed.data.email.split("@")[0],
        }),
        {
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
        }
      );
    } else {
      return {
        success: false,
        error: "ระบบยืนยันตัวตนขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลัง",
      };
    }
  }

  redirect("/today");
}

export async function signOutAction(): Promise<void> {
  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    cookieStore = null;
  }
  cookieStore?.delete("finn_session");

  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // ignore
  }

  redirect("/login");
}

/**
 * Requests a password reset recovery link sent to user email.
 * SECURITY INVARIANTS:
 * 1. Anti-Enumeration: Returns success for both known and unknown emails.
 * 2. Uses canonical site URL (NEXT_PUBLIC_SITE_URL or production domain).
 * 3. Never accepts Host header override.
 */
export async function requestPasswordResetAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  const email = (formData.get("email") as string)?.trim();

  const parsed = passwordResetRequestSchema.safeParse({ email });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "กรุณากรอกอีเมลที่ถูกต้อง",
    };
  }

  try {
    const supabase = await createClient();
    const siteUrl = getCanonicalSiteUrl();
    const redirectTo = `${siteUrl}/auth/callback?next=/reset-password`;

    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo,
    });
  } catch {
    // Fail safe to prevent account enumeration
  }

  // Always return success with generic response to prevent account enumeration
  return {
    success: true,
  };
}

/**
 * Updates user password during recovery session.
 * SECURITY INVARIANTS:
 * 1. Requires active recovery/authenticated session.
 * 2. Minimum length enforced & passwords must match.
 * 3. Signs out recovery session upon completion to prevent dangling sessions.
 * 4. Redirects to /login?reset=success.
 */
export async function updatePasswordAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  const parsed = passwordUpdateSchema.safeParse({ password, confirmPassword });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "ข้อมูลรหัสผ่านไม่ถูกต้อง",
    };
  }

  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    cookieStore = null;
  }
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      success: false,
      error: "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่อีกครั้ง",
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (error) {
      if (isTestAuthFallbackAllowed()) {
        // Allowed in test runners
      } else {
        return {
          success: false,
          error:
            error.message ||
            "ไม่สามารถตั้งรหัสผ่านใหม่ได้ กรุณาลองใหม่อีกครั้ง",
        };
      }
    }

    // Sign out recovery session and clear cookies
    cookieStore?.delete("finn_session");
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  } catch {
    if (!isTestAuthFallbackAllowed()) {
      return {
        success: false,
        error: "ไม่สามารถตั้งรหัสผ่านใหม่ได้ กรุณาลองใหม่อีกครั้ง",
      };
    }
  }

  redirect("/login?reset=success");
}
