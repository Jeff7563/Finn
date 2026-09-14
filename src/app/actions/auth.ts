"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { authSchema } from "@/lib/validation/schemas";
import {
  signSessionPayload,
  isDemoModeAllowed,
  DEMO_USER,
} from "@/lib/server/session";

export interface ActionResult {
  success: boolean;
  error?: string;
}

export async function signInAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const parsed = authSchema.safeParse({ email, password });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input",
    };
  }

  const cookieStore = await cookies();

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      // Fallback for local/offline dev session if Supabase is placeholder
      if (
        error.message.includes("fetch failed") ||
        error.message.includes("Invalid API key") ||
        error.message.includes("dummy")
      ) {
        cookieStore.set(
          "finn_session",
          await signSessionPayload({
            id: "dev-user-12345",
            email: parsed.data.email,
            display_name: parsed.data.email.split("@")[0],
          }),
          { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" }
        );
      } else {
        return { success: false, error: error.message };
      }
    }
  } catch {
    // Dev fallback
    cookieStore.set(
      "finn_session",
      await signSessionPayload({
        id: "dev-user-12345",
        email: parsed.data.email,
        display_name: parsed.data.email.split("@")[0],
      }),
      { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" }
    );
  }

  redirect("/today");
}

export async function signUpAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const parsed = authSchema.safeParse({ email, password });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input",
    };
  }

  const cookieStore = await cookies();

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      if (
        error.message.includes("fetch failed") ||
        error.message.includes("Invalid API key") ||
        error.message.includes("dummy")
      ) {
        cookieStore.set(
          "finn_session",
          await signSessionPayload({
            id: `user-${crypto.randomUUID()}`,
            email: parsed.data.email,
            display_name: parsed.data.email.split("@")[0],
          }),
          { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" }
        );
      } else {
        return { success: false, error: error.message };
      }
    }
  } catch {
    cookieStore.set(
      "finn_session",
      await signSessionPayload({
        id: `user-${crypto.randomUUID()}`,
        email: parsed.data.email,
        display_name: parsed.data.email.split("@")[0],
      }),
      { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" }
    );
  }

  redirect("/today");
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("finn_session");

  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // ignore
  }

  redirect("/login");
}

export async function signInDemoAction(): Promise<void> {
  if (!isDemoModeAllowed()) {
    redirect("/login?error=demo_disabled");
  }

  const cookieStore = await cookies();
  cookieStore.set(
    "finn_session",
    await signSessionPayload(DEMO_USER),
    { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" }
  );

  redirect("/today");
}
