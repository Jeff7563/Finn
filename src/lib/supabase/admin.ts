import "server-only";
import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a server-only administrative Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. NEVER import or call this function in client components or browser code.
 * 2. NEVER expose SUPABASE_SERVICE_ROLE_KEY to the public or client.
 * 3. Ordinary user operations MUST use the user session client (createClient in server.ts)
 *    so Row Level Security (RLS) is strictly enforced by PostgreSQL.
 * 4. This client is used EXCLUSIVELY on the server for:
 *    - Validating scoped ingest tokens from iOS Shortcuts (which have no browser cookie)
 *    - Looking up unscoped slips for HMAC-signed preview verification
 */
export function createAdminClient(): SupabaseClient {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin credentials: SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required on the server."
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function hasAdminCredentials(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && key && !url.includes("dummy") && !key.includes("dummy"));
}
