import { cookies } from "next/headers";
import { createClient } from "../supabase/server";

export interface AuthenticatedUser {
  id: string;
  email: string;
  display_name?: string;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();

  // 1. Check demo/session cookie
  const sessionCookie = cookieStore.get("finn_session")?.value;
  if (sessionCookie) {
    try {
      const user = JSON.parse(sessionCookie);
      if (user && user.id && user.email) {
        return user;
      }
    } catch {
      // ignore
    }
  }

  // 2. Check Supabase Auth
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (!error && data?.user) {
      return {
        id: data.user.id,
        email: data.user.email || "user@example.com",
        display_name:
          data.user.user_metadata?.display_name ||
          data.user.email?.split("@")[0] ||
          "User",
      };
    }
  } catch {
    // Supabase not configured or network unavailable
  }

  return null;
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}
