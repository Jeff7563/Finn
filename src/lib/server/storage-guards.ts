import type { StorageMutationOptions } from "./data-store-interface";

/**
 * Validates and simulates DB-level storage metadata mutation guard triggers.
 * Verifies whether operations on public.slips or public.source_documents
 * are permitted under RLS and trigger enforcement.
 */
export function evaluateStorageMutationGuard(
  table: "slips" | "source_documents",
  op: "INSERT" | "UPDATE" | "DELETE",
  payload: Record<string, unknown>,
  roleOrOptions?: "authenticated" | "anon" | "service_role" | StorageMutationOptions
): { allowed: boolean; error?: string } {
  let isTrusted = false;

  if (typeof roleOrOptions === "string") {
    isTrusted = roleOrOptions === "service_role";
  } else if (roleOrOptions) {
    if (roleOrOptions.trustedServer) {
      isTrusted = true;
    } else if (roleOrOptions.asClientRole) {
      isTrusted = false;
    }
  }

  if (isTrusted) {
    return { allowed: true };
  }

  // Hard deletion of slip or source document records by browser roles is strictly prohibited
  if (op === "DELETE") {
    return {
      allowed: false,
      error: `Direct client deletion of ${table} records is prohibited. Metadata and audit evidence must be preserved for retention.`,
    };
  }

  const sensitiveFields =
    table === "slips"
      ? [
          "storage_path",
          "file_hash_sha256",
          "file_size",
          "stored_file_size",
          "binary_deleted_at",
          "is_pinned",
        ]
      : [
          "storage_path",
          "file_hash",
          "file_size",
          "stored_file_size",
          "binary_deleted_at",
          "is_pinned",
        ];

  if (op === "INSERT") {
    for (const field of sensitiveFields) {
      if (field === "is_pinned") {
        if (payload.is_pinned !== undefined && payload.is_pinned !== false) {
          return {
            allowed: false,
            error: `Direct client initialization of ${table} storage metadata or pin state (${field}) is prohibited. Mutations must execute via trusted server flow.`,
          };
        }
      } else if (payload[field] !== undefined && payload[field] !== null) {
        return {
          allowed: false,
          error: `Direct client initialization of ${table} storage metadata or pin state (${field}) is prohibited. Mutations must execute via trusted server flow.`,
        };
      }
    }
  } else if (op === "UPDATE") {
    for (const field of sensitiveFields) {
      if (payload[field] !== undefined) {
        return {
          allowed: false,
          error: `Direct client modification of ${table} storage metadata or pin state (${field}) is prohibited. Mutations must execute via trusted server flow.`,
        };
      }
    }
  }

  return { allowed: true };
}
