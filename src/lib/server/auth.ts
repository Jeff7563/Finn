import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "../supabase/server";
import { verifySessionToken } from "./session";
import { withJwtSkewRetry, isTransientJwtSkewError } from "./jwt-resilience";
import { measurePerf } from "./perf";

export interface AuthenticatedUser {
  id: string;
  email: string;
  display_name?: string;
}

export const getAuthenticatedUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    return measurePerf("auth.getAuthenticatedUser", async () => {
      let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
      try {
        cookieStore = await cookies();
      } catch {
        cookieStore = null;
      }

      // 1. Check verified demo/session token
      const sessionCookie = cookieStore?.get("finn_session")?.value;
      if (sessionCookie) {
        const verified = await verifySessionToken(sessionCookie);
        if (verified) {
          return verified;
        }
      }

      // 2. Check Supabase Auth
      try {
        const supabase = await createClient();
        const { data, error } = await withJwtSkewRetry(async () => {
          const res = await supabase.auth.getUser();
          if (res.error && isTransientJwtSkewError(res.error)) {
            throw res.error;
          }
          return res;
        });
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
        // Supabase not configured, network unavailable, or retry exhausted
      }

      return null;
    });
  }
);

export const requireUser = cache(async (): Promise<AuthenticatedUser> => {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
});
