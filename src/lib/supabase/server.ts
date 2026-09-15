import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(
    url &&
    key &&
    !url.includes("dummy") &&
    !url.includes("your-project") &&
    !key.includes("dummy") &&
    !key.includes("your-anon-key")
  );
}

export const createClient = cache(async () => {
  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    // Called outside of request scope (e.g. background job, CLI, or test)
    cookieStore = null;
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://dummy-fin-project.supabase.co";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key";

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore ? cookieStore.getAll() : [];
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: CookieOptions;
        }>
      ) {
        if (!cookieStore) return;
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore?.set(name, value, options)
          );
        } catch {
          // Handled by middleware
        }
      },
    },
  });
});
