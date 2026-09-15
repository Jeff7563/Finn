import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirectPath } from "@/lib/server/url";

/**
 * Supabase SSR / PKCE Auth Callback Route Handler.
 *
 * Handles auth recovery and verification links.
 * Exchanges authorization code for an authenticated session cookie,
 * then safely redirects to the sanitized target path (defaulting to /reset-password).
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next");

  // Enforce open redirect protection: only allow internal relative paths
  const safeNext = sanitizeRedirectPath(nextParam, "/reset-password");

  if (!code) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=invalid_or_expired", request.url)
    );
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        new URL("/forgot-password?error=invalid_or_expired", request.url)
      );
    }
  } catch {
    return NextResponse.redirect(
      new URL("/forgot-password?error=invalid_or_expired", request.url)
    );
  }

  return NextResponse.redirect(new URL(safeNext, request.url));
}
