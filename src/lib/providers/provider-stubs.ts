import { SourceConnection, SourceDocument, IngestionItem } from "@/types/multi-source";

export interface GmailConnectionConfig {
  query?: string;
  pollIntervalMinutes?: number;
  label?: string;
  watchLabel?: string;
  [key: string]: unknown;
}

export interface DriveConnectionConfig {
  folderId?: string;
  folderName?: string;
  allowedMimeTypes?: string[];
  includeSubfolders?: boolean;
  [key: string]: unknown;
}

/**
 * Validates that no OAuth tokens, secrets, or credential ciphertexts
 * are mistakenly placed into connection configs.
 */
export function assertNoCredentials(obj: Record<string, unknown>): void {
  const forbiddenExactKeys = [
    "token",
    "tokens",
    "access_token",
    "refresh_token",
    "id_token",
    "oauth_token",
  ];
  const forbiddenSubstrings = [
    "client_secret",
    "secret",
    "password",
    "private_key",
    "encrypted_access_token",
    "encrypted_refresh_token",
  ];

  function check(target: unknown) {
    if (!target || typeof target !== "object") return;
    const rec = target as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      const lower = key.toLowerCase();
      if (
        forbiddenExactKeys.includes(lower) ||
        lower.endsWith("_token") ||
        lower.startsWith("token_") ||
        forbiddenSubstrings.some((sub) => lower.includes(sub))
      ) {
        throw new Error(
          `Zero-token safety violation: detected prohibited credential key "${key}".`
        );
      }
      if (typeof rec[key] === "object") {
        check(rec[key]);
      }
    }
  }

  check(obj);
}

export const assertZeroTokenPersistence = assertNoCredentials;

/**
 * Creates a Gmail connection metadata stub.
 *
 * Security Guarantee (Decision 3):
 * - ZERO credentials/tokens stored in browser-visible connection metadata.
 * - Stubs connection metadata only until real Phase 4 OAuth infrastructure begins.
 */
export function createGmailConnectionStub(
  userIdOrEmail: string,
  emailOrConfig?: string | GmailConnectionConfig,
  config?: GmailConnectionConfig
): Omit<SourceConnection, "id" | "created_at" | "updated_at"> {
  let userId = userIdOrEmail;
  let emailAddress = typeof emailOrConfig === "string" ? emailOrConfig : userIdOrEmail;
  const cfg = (typeof emailOrConfig === "object" ? emailOrConfig : config) || {};

  if (typeof emailOrConfig !== "string" && userIdOrEmail.includes("@")) {
    emailAddress = userIdOrEmail;
    userId = "stub-user";
  }

  assertNoCredentials(cfg as Record<string, unknown>);

  return {
    user_id: userId,
    provider: "gmail",
    label: cfg.label || `Gmail (${emailAddress})`,
    status: "active",
    provider_account_id: emailAddress.toLowerCase().trim(),
    last_synced_at: null,
    config: {
      email: emailAddress,
      query: cfg.query || "subject:(transfer OR alert OR statement OR receipt)",
      pollIntervalMinutes: cfg.pollIntervalMinutes || 15,
      isStub: true,
      authType: "oauth2_deferred",
      tokenPersistence: "disabled",
      ...cfg,
    },
  };
}

/**
 * Creates a Google Drive connection metadata stub.
 *
 * Security Guarantee (Decision 3):
 * - ZERO credentials/tokens stored in browser-visible connection metadata.
 */
export function createDriveConnectionStub(
  userIdOrEmail: string,
  accountEmailOrFolderId: string,
  folderIdOrConfig?: string | DriveConnectionConfig,
  config?: DriveConnectionConfig
): Omit<SourceConnection, "id" | "created_at" | "updated_at"> {
  let userId = userIdOrEmail;
  let accountEmail = accountEmailOrFolderId;
  let folderId = typeof folderIdOrConfig === "string" ? folderIdOrConfig : "";
  const cfg = (typeof folderIdOrConfig === "object" ? folderIdOrConfig : config) || {};

  if (userIdOrEmail.includes("@")) {
    accountEmail = userIdOrEmail;
    folderId = accountEmailOrFolderId;
    userId = "stub-user";
  }

  assertNoCredentials(cfg as Record<string, unknown>);

  return {
    user_id: userId,
    provider: "google_drive",
    label: cfg.folderName ? `Google Drive (${cfg.folderName})` : `Google Drive (${accountEmail})`,
    status: "active",
    provider_account_id: accountEmail.toLowerCase().trim(),
    last_synced_at: null,
    config: {
      email: accountEmail,
      folderId: folderId || cfg.folderId,
      folderName: cfg.folderName || "Finn Statements",
      allowedMimeTypes: cfg.allowedMimeTypes || ["text/csv", "application/pdf"],
      isStub: true,
      authType: "oauth2_deferred",
      tokenPersistence: "disabled",
      ...cfg,
    },
  };
}

/**
 * Checks idempotency for Gmail bank notification messages.
 * If the provider_external_id (Gmail Message ID) is already linked within this connection,
 * it MUST NOT be reprocessed.
 */
export function isGmailMessageAlreadyProcessed(
  arg1: string,
  arg2: string | string[],
  arg3?: IngestionItem[]
): boolean {
  if (Array.isArray(arg2)) {
    // Called as: isGmailMessageAlreadyProcessed(messageId, existingMessageIds)
    const messageId = arg1;
    const existingIds = arg2;
    return existingIds.includes(messageId);
  }

  const connectionId = arg1;
  const messageId = arg2 as string;
  const existingItems = arg3 || [];
  return existingItems.some(
    (item) =>
      item.connection_id === connectionId &&
      item.provider_external_id === messageId &&
      (item.status === "linked" || item.status === "matched" || item.status === "pending")
  );
}

/**
 * Checks idempotency for Google Drive files using file ID and modified time.
 * If a Drive file has already been ingested and its modified time has NOT changed,
 * it MUST NOT be reprocessed.
 */
export function isDriveFileAlreadyProcessed(
  arg1: string,
  arg2: string,
  arg3: string | Array<{ fileId: string; modifiedTime: string }>,
  arg4?: SourceDocument[]
): boolean {
  if (Array.isArray(arg3)) {
    // Called as: isDriveFileAlreadyProcessed(fileId, modifiedTime, existingMetadataList)
    const fileId = arg1;
    const modifiedTime = arg2;
    const list = arg3;
    return list.some((item) => item.fileId === fileId && item.modifiedTime === modifiedTime);
  }

  const connectionId = arg1;
  const driveFileId = arg2;
  const modifiedTime = arg3 as string;
  const existingDocuments = arg4 || [];

  return existingDocuments.some((doc) => {
    if (doc.connection_id !== connectionId) return false;
    const meta = doc.provider_metadata as Record<string, unknown> | undefined;
    if (!meta) return false;

    const matchesFileId = meta.driveFileId === driveFileId;
    const matchesModifiedTime = meta.modifiedTime === modifiedTime;
    return matchesFileId && matchesModifiedTime;
  });
}
