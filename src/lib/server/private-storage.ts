import "server-only";

import crypto from "crypto";
import { DataStore } from "@/lib/server/data-store";
import type { IDataStore } from "./data-store-interface";
import { StoragePruneResult } from "@/types/storage";
import { evaluateStorageMutationGuard } from "./storage-guards";

/**
 * Server-only helper enforcing that SESSION_SECRET is configured and meets
 * minimum entropy requirements (>= 32 characters).
 * Fails closed without any hardcoded secret fallback.
 * Secret is never logged.
 */
export function requirePreviewSigningSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || typeof secret !== "string" || secret.trim().length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or insufficient (must be at least 32 characters)"
    );
  }
  return secret.trim();
}

/**
 * Generates an HMAC-SHA256 signature for slip preview URL using SESSION_SECRET.
 */
export function signSlipPreview(slipId: string, exp: number): string {
  const secret = requirePreviewSigningSecret();
  return crypto
    .createHmac("sha256", secret)
    .update(`${slipId}:${exp}`)
    .digest("hex");
}

/**
 * Timing-safe verification of slip preview HMAC signature.
 * Enforces hard TTL bounds:
 * Rejects exp <= now (expired)
 * Rejects exp > now + 300 seconds (hard maximum allowed preview lifetime)
 * Fails closed if SESSION_SECRET is missing, secret is weak, or timestamp is out of bounds.
 */
export function verifySlipPreviewSignature(
  slipId: string,
  exp: number,
  sig: string
): boolean {
  if (!slipId || !exp || !sig) return false;
  if (typeof exp !== "number" || isNaN(exp)) return false;
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/i.test(sig)) return false;

  const now = Date.now();
  const expMs = exp < 1e11 ? exp * 1000 : exp;

  // Enforce Hard Max TTL and Expiry bounds:
  // Must reject:
  // 1. exp <= now (expired)
  // 2. exp > now + 300 seconds (too far in future; maximum allowed TTL is 300s)
  if (expMs <= now || expMs > now + 300 * 1000) {
    return false;
  }

  let secret: string;
  try {
    secret = requirePreviewSigningSecret();
  } catch {
    // Fail closed if signing secret is missing or insufficient
    return false;
  }

  try {
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${slipId}:${exp}`)
      .digest("hex");

    const expectedBuf = Buffer.from(expectedSig, "hex");
    const actualBuf = Buffer.from(sig, "hex");
    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Derives a trusted, deterministic storage path for a slip.
 * Path format: {userId}/{YYYY}/{MM}/{slipId}.{ext}
 * Never accepts an arbitrary client-specified storage path.
 */
export function deriveTrustedSlipPath(
  userId: string,
  slipId: string,
  mimeType: string = "image/jpeg",
  createdAt: string = new Date().toISOString()
): string {
  if (!userId || !slipId) {
    throw new Error("Invalid arguments: userId and slipId are required");
  }
  // Sanitize UUIDs to prevent directory traversal
  const cleanUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  const cleanSlipId = slipId.replace(/[^a-zA-Z0-9_-]/g, "");

  const date = new Date(createdAt);
  const year = isNaN(date.getFullYear()) ? new Date().getFullYear() : date.getFullYear();
  const month = isNaN(date.getMonth())
    ? String(new Date().getMonth() + 1).padStart(2, "0")
    : String(date.getMonth() + 1).padStart(2, "0");

  let ext = "jpg";
  if (mimeType.includes("png")) ext = "png";
  else if (mimeType.includes("webp")) ext = "webp";
  else if (mimeType.includes("pdf")) ext = "pdf";

  return `${cleanUserId}/${year}/${month}/${cleanSlipId}.${ext}`;
}

/**
 * Saves a slip binary into private storage with server-derived path.
 */
export async function saveSlipBinary(
  userId: string,
  slipId: string,
  buffer: Buffer,
  mimeType: string = "image/jpeg"
): Promise<{ storagePath: string; bytes: number }> {
  if (!userId || !slipId) {
    throw new Error("Unauthorized: userId and slipId are required");
  }

  const storagePath = deriveTrustedSlipPath(userId, slipId, mimeType);
  await DataStore.saveSlipFile(storagePath, buffer);

  return {
    storagePath,
    bytes: buffer.length,
  };
}

/**
 * Creates a short-lived signed URL for viewing a private slip.
 * Enforces ownership, active binary status, and TTL boundaries (default 120s, max 300s).
 */
export async function createSlipSignedViewUrl(
  userId: string,
  slipId: string,
  expiresInSeconds: number = 120,
  store: Pick<IDataStore, "getSlipById"> = DataStore
): Promise<{ url: string; expiresIn: number; expiresAt: string }> {
  if (!userId || !slipId) {
    throw new Error("Access denied: valid user session and slipId required");
  }

  // Ensure secret is present before generating URL (fail-closed)
  requirePreviewSigningSecret();

  const slip = await store.getSlipById(userId, slipId);
  if (!slip) {
    throw new Error("ไม่พบไฟล์หลักฐาน (Slip not found or access denied)");
  }

  if (slip.user_id !== userId) {
    throw new Error("Access denied: cross-user access prohibited");
  }

  if (slip.binary_deleted_at || !slip.storage_path) {
    throw new Error("ไฟล์ต้นฉบับถูกลบตามนโยบายการเก็บรักษาแล้ว (Original binary was pruned per retention policy)");
  }

  // Hard clamp: default 120s, hard ceiling 300s, minimum 1s
  const clampedTtl = Math.max(1, Math.min(expiresInSeconds, 300));
  const exp = Date.now() + clampedTtl * 1000;
  const sig = signSlipPreview(slipId, exp);
  const url = `/api/slips/${slipId}/preview?exp=${exp}&sig=${sig}`;
  const expiresAt = new Date(exp).toISOString();

  return {
    url,
    expiresIn: clampedTtl,
    expiresAt,
  };
}

export interface SlipPreviewAuthorizationResult {
  status: 200 | 400 | 401 | 403 | 404 | 410;
  buffer?: Buffer;
  mimeType?: string;
  slipId?: string;
  error?: string;
}

/**
 * Complete server-only boundary for slip preview authorization and binary streaming.
 */
export async function authorizeAndReadSlipPreview(params: {
  slipId: string;
  expStr: string | null;
  sig: string | null;
  authenticatedUserId?: string | null;
}): Promise<SlipPreviewAuthorizationResult> {
  const { slipId, expStr, sig, authenticatedUserId } = params;

  if (!slipId) {
    return { status: 400, error: "Missing slip ID" };
  }

  let isAuthorized = false;

  // 1. Verify Signed URL Signature if provided
  if (sig && expStr) {
    const exp = parseInt(expStr, 10);
    if (!isNaN(exp) && verifySlipPreviewSignature(slipId, exp, sig)) {
      isAuthorized = true;
    }
  }

  // 2. Fetch slip unscoped
  const slip = await DataStore.getSlipByIdUnscoped(slipId);
  if (!slip) {
    return { status: 404, error: "ไม่พบไฟล์หลักฐาน" };
  }

  // 3. Authorization check
  if (!isAuthorized) {
    if (!authenticatedUserId) {
      return {
        status: 401,
        error: "Unauthorized access: valid signed URL or session required",
      };
    }
    if (slip.user_id !== authenticatedUserId) {
      return {
        status: 403,
        error: "Forbidden: cross-user access denied",
      };
    }
  }

  // 4. Pruned binary check (HTTP 410 Gone)
  if (slip.binary_deleted_at || !slip.storage_path) {
    return {
      status: 410,
      error: "ไฟล์ต้นฉบับถูกลบตามนโยบายการเก็บรักษาแล้ว",
    };
  }

  // 5. Fetch file buffer from private storage
  const buffer = await DataStore.getSlipFile(slip.storage_path);
  if (!buffer) {
    return { status: 404, error: "ไม่พบไฟล์หลักฐาน" };
  }

  return {
    status: 200,
    buffer,
    mimeType: slip.mime_type || "image/jpeg",
    slipId: slip.id,
  };
}

/**
 * Retrieves the raw binary buffer of a slip, with ownership check.
 */
export async function getSlipBinary(
  userId: string,
  slipId: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!userId || !slipId) return null;

  const slip = await DataStore.getSlipById(userId, slipId);
  if (!slip || slip.user_id !== userId) return null;

  if (slip.binary_deleted_at || slip.stored_file_size === 0 || !slip.storage_path) {
    return null;
  }

  const buffer = await DataStore.getSlipFile(slip.storage_path);
  if (!buffer) return null;

  return {
    buffer,
    mimeType: slip.mime_type || "image/jpeg",
  };
}

/**
 * Server-only binary reader interface.
 */
export async function readSlipBinary(
  userId: string,
  slipId: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  return getSlipBinary(userId, slipId);
}

/**
 * Checks whether a binary exists in storage.
 */
export async function binaryExists(storagePath: string): Promise<boolean> {
  if (!storagePath) return false;
  return DataStore.slipFileExists(storagePath);
}

/**
 * SAFE CROSS-RESOURCE PRUNE FLOW FOR SLIPS (Section 14)
 *
 * 1. Authenticate user + ownership check
 * 2. Verify retention/manual eligibility (pinned slips or unresolved states rejected)
 * 3. Record prune_requested audit event
 * 4. Delete Storage binary using server-only admin client
 * 5. Only after successful deletion: update binary_deleted_at / stored_file_size
 * 6. Record prune_completed audit event
 * If storage deletion fails: record prune_failed, do NOT update metadata, surface safe error.
 * Re-prune of already-pruned binary is idempotent.
 */
export async function pruneSlipBinary(
  userId: string,
  slipId: string,
  reason: string = "manual_user_prune"
): Promise<StoragePruneResult> {
  if (!userId || !slipId) {
    throw new Error("Access denied: user and slipId are required");
  }

  const slip = await DataStore.getSlipById(userId, slipId);
  if (!slip) {
    throw new Error("ไม่พบข้อมูลสลิป (Slip not found or access denied)");
  }

  if (slip.user_id !== userId) {
    throw new Error("Access denied: cross-user prune rejected");
  }

  // Idempotency: if already pruned, return success with 0 bytes freed
  if (slip.binary_deleted_at && slip.stored_file_size === 0) {
    return {
      success: true,
      targetId: slip.id,
      targetType: "slip",
      bytesFreed: 0,
    };
  }

  // Protection: Pinned evidence must never be pruned
  if (slip.is_pinned) {
    throw new Error("ไม่สามารถลบหลักฐานที่ปักหมุดไว้ได้ กรุณายกเลิกการปักหมุดก่อนดำเนินการ (Cannot prune pinned evidence)");
  }

  // Protection: Unresolved slips need their binary for verification
  if (
    slip.status === "uploaded" ||
    slip.status === "processing" ||
    slip.status === "needs_review"
  ) {
    throw new Error("ไม่สามารถลบสลิปที่ยังรอการตรวจสอบหรือประมวลผลได้ (Cannot prune unresolved slip)");
  }

  const bytesToFree = slip.stored_file_size ?? slip.file_size ?? 0;

  // Step 4: Record prune_requested
  await DataStore.createStorageBinaryEvent(userId, {
    user_id: userId,
    slip_id: slip.id,
    action: "prune_requested",
    storage_path_snapshot: slip.storage_path,
    file_hash_snapshot: slip.file_hash_sha256,
    bytes_affected: bytesToFree,
    reason,
  });

  // Step 5: Delete Storage binary
  try {
    if (slip.storage_path) {
      await DataStore.deleteSlipFile(slip.storage_path);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Storage deletion failed";
    // Check if error indicates file already missing in storage (idempotent reconciliation)
    const isAlreadyMissing =
      errMsg.includes("not found") ||
      errMsg.includes("404") ||
      errMsg.includes("Object not found");

    if (!isAlreadyMissing) {
      // Record prune_failed and do NOT update slip metadata
      await DataStore.createStorageBinaryEvent(userId, {
        user_id: userId,
        slip_id: slip.id,
        action: "prune_failed",
        storage_path_snapshot: slip.storage_path,
        file_hash_snapshot: slip.file_hash_sha256,
        bytes_affected: bytesToFree,
        reason,
        safe_error_message: errMsg,
      });

      throw new Error(`การลบไฟล์จากที่จัดเก็บข้อมูลล้มเหลว: ${errMsg}`);
    }
  }

  // Step 6: Update slip metadata only after successful storage removal
  const nowIso = new Date().toISOString();
  await DataStore.updateSlip(userId, slip.id, {
    stored_file_size: 0,
    binary_deleted_at: nowIso,
  });

  // Step 7: Record prune_completed
  await DataStore.createStorageBinaryEvent(userId, {
    user_id: userId,
    slip_id: slip.id,
    action: "prune_completed",
    storage_path_snapshot: slip.storage_path,
    file_hash_snapshot: slip.file_hash_sha256,
    bytes_affected: bytesToFree,
    reason,
  });

  return {
    success: true,
    targetId: slip.id,
    targetType: "slip",
    bytesFreed: bytesToFree,
  };
}

/**
 * SAFE CROSS-RESOURCE PRUNE FLOW FOR SOURCE DOCUMENTS (Section 14)
 */
export async function pruneSourceDocumentBinary(
  userId: string,
  docId: string,
  reason: string = "manual_user_prune"
): Promise<StoragePruneResult> {
  if (!userId || !docId) {
    throw new Error("Access denied: user and docId are required");
  }

  const doc = await DataStore.getSourceDocumentById(userId, docId);
  if (!doc) {
    throw new Error("ไม่พบข้อมูลเอกสาร (Document not found or access denied)");
  }

  if (doc.user_id !== userId) {
    throw new Error("Access denied: cross-user prune rejected");
  }

  // Idempotency: if already pruned
  if (doc.binary_deleted_at && doc.stored_file_size === 0) {
    return {
      success: true,
      targetId: doc.id,
      targetType: "source_document",
      bytesFreed: 0,
    };
  }

  if (doc.is_pinned) {
    throw new Error("ไม่สามารถลบเอกสารที่ปักหมุดไว้ได้ กรุณายกเลิกการปักหมุดก่อนดำเนินการ (Cannot prune pinned document)");
  }

  if (doc.status === "received" || doc.status === "processing") {
    throw new Error("ไม่สามารถลบเอกสารที่อยู่ระหว่างการประมวลผลได้ (Cannot prune unresolved document)");
  }

  const bytesToFree = doc.stored_file_size ?? doc.file_size ?? 0;

  // Record prune_requested
  await DataStore.createStorageBinaryEvent(userId, {
    user_id: userId,
    source_document_id: doc.id,
    action: "prune_requested",
    storage_path_snapshot: doc.storage_path,
    file_hash_snapshot: doc.file_hash,
    bytes_affected: bytesToFree,
    reason,
  });

  // Delete storage binary if present
  try {
    if (doc.storage_path) {
      await DataStore.deleteSlipFile(doc.storage_path);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Storage deletion failed";
    const isAlreadyMissing =
      errMsg.includes("not found") ||
      errMsg.includes("404") ||
      errMsg.includes("Object not found");

    if (!isAlreadyMissing) {
      await DataStore.createStorageBinaryEvent(userId, {
        user_id: userId,
        source_document_id: doc.id,
        action: "prune_failed",
        storage_path_snapshot: doc.storage_path,
        file_hash_snapshot: doc.file_hash,
        bytes_affected: bytesToFree,
        reason,
        safe_error_message: errMsg,
      });

      throw new Error(`การลบไฟล์จากที่จัดเก็บข้อมูลล้มเหลว: ${errMsg}`);
    }
  }

  // Update source document metadata
  const nowIso = new Date().toISOString();
  await DataStore.updateSourceDocument(userId, doc.id, {
    storage_path: null,
    stored_file_size: 0,
    binary_deleted_at: nowIso,
  });

  // Record prune_completed
  await DataStore.createStorageBinaryEvent(userId, {
    user_id: userId,
    source_document_id: doc.id,
    action: "prune_completed",
    storage_path_snapshot: doc.storage_path,
    file_hash_snapshot: doc.file_hash,
    bytes_affected: bytesToFree,
    reason,
  });

  return {
    success: true,
    targetId: doc.id,
    targetType: "source_document",
    bytesFreed: bytesToFree,
  };
}

/**
 * Pins evidence to protect it from all retention cleanup.
 */
export async function pinEvidence(
  userId: string,
  itemType: "slip" | "source_document",
  itemId: string
): Promise<void> {
  if (itemType === "slip") {
    await DataStore.setSlipPinned(userId, itemId, true);
  } else {
    await DataStore.setSourceDocumentPinned(userId, itemId, true);
  }
}

/**
 * Unpins evidence, making it eligible for retention cleanup when age threshold met.
 */
export async function unpinEvidence(
  userId: string,
  itemType: "slip" | "source_document",
  itemId: string
): Promise<void> {
  if (itemType === "slip") {
    await DataStore.setSlipPinned(userId, itemId, false);
  } else {
    await DataStore.setSourceDocumentPinned(userId, itemId, false);
  }
}

/**
 * Compensating rollback helper to safely clean up an uploaded slip binary if subsequent database
 * record creation fails. Validates that the storage path strictly matches the server-derived
 * path for (userId, slipId) to prevent arbitrary path deletions.
 */
export async function rollbackUploadedSlipBinary(
  userId: string,
  slipId: string,
  storagePath: string
): Promise<{ cleaned: boolean; diagnostic?: string }> {
  try {
    if (!userId || !slipId || !storagePath) {
      return { cleaned: false, diagnostic: "Missing required parameters for rollback" };
    }
    // Strict path validation: ensure storagePath begins with sanitized userId and ends with slipId.ext
    const cleanUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "");
    const cleanSlipId = slipId.replace(/[^a-zA-Z0-9_-]/g, "");
    const expectedPrefix = `${cleanUserId}/`;
    const expectedSuffixRegex = new RegExp(`/${cleanSlipId}\\.[a-z0-9]+$`);

    if (!storagePath.startsWith(expectedPrefix) || !expectedSuffixRegex.test(storagePath)) {
      return {
        cleaned: false,
        diagnostic: "Storage path does not match trusted user and slip identifiers; rollback aborted",
      };
    }

    if (await DataStore.slipFileExists(storagePath)) {
      await DataStore.deleteSlipFile(storagePath);
      return { cleaned: true };
    }
    return { cleaned: true, diagnostic: "Binary not present in storage" };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Storage deletion failed";
    return {
      cleaned: false,
      diagnostic: `Compensating rollback failed: ${errorMsg}`,
    };
  }
}

export { evaluateStorageMutationGuard } from "./storage-guards";

export const privateStorage = {
  requirePreviewSigningSecret,
  deriveTrustedSlipPath,
  saveSlipBinary,
  rollbackUploadedSlipBinary,
  createSlipSignedViewUrl,
  signSlipPreview,
  verifySlipPreviewSignature,
  authorizeAndReadSlipPreview,
  binaryExists,
  getSlipBinary,
  readSlipBinary,
  pruneSlipBinary,
  pruneSourceDocumentBinary,
  pinEvidence,
  unpinEvidence,
  evaluateStorageMutationGuard,
};
