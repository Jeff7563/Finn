"use server";

import { getAuthenticatedUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { privateStorage } from "@/lib/server/private-storage";
import {
  evaluateUnifiedStorageCleanupDryRun,
  getStorageUsageSummary,
  UnifiedCleanupDryRunResult,
  StorageUsageSummary,
} from "@/lib/storage/retention";
import { revalidatePath } from "next/cache";
import {
  StorageRetentionSettings,
  StorageBinaryEvent,
  StoragePruneResult,
  StorageBulkPruneResult,
  SlipBinaryStatus,
} from "@/types/storage";

export interface DryRunResponse {
  success: boolean;
  dryRun?: UnifiedCleanupDryRunResult;
  usageSummary?: StorageUsageSummary;
  settings?: StorageRetentionSettings;
  error?: string;
}

/**
 * Retrieves the current user's storage retention policy settings.
 */
export async function getRetentionSettingsAction(): Promise<{
  success: boolean;
  settings?: StorageRetentionSettings;
  error?: string;
}> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const settings = await DataStore.getStorageRetentionSettings(user.id);
    return { success: true, settings };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถโหลดการตั้งค่าการเก็บรักษาข้อมูลได้",
    };
  }
}

/**
 * Updates the user's storage retention policy settings.
 */
export async function updateRetentionSettingsAction(
  updates: Partial<Pick<StorageRetentionSettings, "slip_retention_days" | "failed_retention_days" | "source_document_retention_days">>
): Promise<{
  success: boolean;
  settings?: StorageRetentionSettings;
  error?: string;
}> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    // Basic bounds validation matching database CHECK constraints exactly
    if (updates.slip_retention_days !== undefined && (!Number.isInteger(updates.slip_retention_days) || updates.slip_retention_days < 7 || updates.slip_retention_days > 3650)) {
      return { success: false, error: "ระยะเวลาเก็บรักษาสลิปต้องอยู่ระหว่าง 7 ถึง 3650 วัน" };
    }
    if (updates.failed_retention_days !== undefined && (!Number.isInteger(updates.failed_retention_days) || updates.failed_retention_days < 1 || updates.failed_retention_days > 365)) {
      return { success: false, error: "ระยะเวลาเก็บรักษาไฟล์ที่ล้มเหลวต้องอยู่ระหว่าง 1 ถึง 365 วัน" };
    }
    if (updates.source_document_retention_days !== undefined && (!Number.isInteger(updates.source_document_retention_days) || updates.source_document_retention_days < 7 || updates.source_document_retention_days > 3650)) {
      return { success: false, error: "ระยะเวลาเก็บรักษาเอกสารต้นทางต้องอยู่ระหว่าง 7 ถึง 3650 วัน" };
    }

    const settings = await DataStore.updateStorageRetentionSettings(user.id, updates);
    revalidatePath("/settings");
    return { success: true, settings };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถบันทึกการตั้งค่าการเก็บรักษาข้อมูลได้",
    };
  }
}

/**
 * Evaluates cleanup candidates in dry-run mode (zero mutations).
 */
export async function getCleanupDryRunAction(): Promise<DryRunResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const settings = await DataStore.getStorageRetentionSettings(user.id);
    const documents = await DataStore.getSourceDocuments(user.id);
    const slips = await DataStore.getSlips(user.id);

    const cleanupOptions = {
      slipRetentionDays: settings.slip_retention_days,
      sourceDocumentRetentionDays: settings.source_document_retention_days,
      failedRetentionDays: settings.failed_retention_days,
    };

    const dryRun = evaluateUnifiedStorageCleanupDryRun(documents, slips, cleanupOptions);
    const usageSummary = getStorageUsageSummary(documents, [], slips, cleanupOptions);

    return {
      success: true,
      dryRun,
      usageSummary,
      settings,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถประเมินผลการล้างข้อมูลได้",
    };
  }
}

/**
 * Manually prunes binary storage for a single piece of financial evidence.
 */
export async function pruneEvidenceBinaryAction(
  targetId: string,
  targetType: "slip" | "source_document"
): Promise<StoragePruneResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      success: false,
      targetId,
      targetType,
      bytesFreed: 0,
      error: "กรุณาเข้าสู่ระบบก่อนทำรายการ",
    };
  }

  try {
    let result: StoragePruneResult;
    if (targetType === "slip") {
      result = await privateStorage.pruneSlipBinary(user.id, targetId, "manual_prune");
    } else {
      result = await privateStorage.pruneSourceDocumentBinary(user.id, targetId, "manual_prune");
    }

    revalidatePath("/settings");
    revalidatePath("/review");
    return result;
  } catch (err: unknown) {
    return {
      success: false,
      targetId,
      targetType,
      bytesFreed: 0,
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการลบไฟล์หลักฐาน",
    };
  }
}

/**
 * Bulk prunes eligible binaries with safety checks and error accumulation.
 * Authoritatively recomputes retention eligibility on the server:
 * Malicious client cannot supply an ineligible target ID to bypass retention rules.
 */
export async function bulkPruneAction(
  targets: Array<{ targetId: string; targetType: "slip" | "source_document" }>
): Promise<StorageBulkPruneResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      success: false,
      totalPruned: 0,
      totalBytesFreed: 0,
      failedCount: targets.length,
      errors: ["กรุณาเข้าสู่ระบบก่อนทำรายการ"],
    };
  }

  // 1. Load current retention settings, source documents, and slips on the server
  const settings = await DataStore.getStorageRetentionSettings(user.id);
  const documents = await DataStore.getSourceDocuments(user.id);
  const slips = await DataStore.getSlips(user.id);

  // 2. Authoritatively recompute dry-run candidates on the server
  const dryRun = evaluateUnifiedStorageCleanupDryRun(documents, slips, {
    slipRetentionDays: settings.slip_retention_days,
    sourceDocumentRetentionDays: settings.source_document_retention_days,
    failedRetentionDays: settings.failed_retention_days,
  });

  // 3. Construct an authoritative eligible target Set
  const eligibleSet = new Set<string>();
  for (const c of dryRun.candidates) {
    eligibleSet.add(`${c.kind}:${c.id}`);
  }

  let totalPruned = 0;
  let totalBytesFreed = 0;
  let failedCount = 0;
  const errors: string[] = [];

  // 4. Reject/skip any submitted target not currently eligible
  for (const item of targets) {
    const key = `${item.targetType}:${item.targetId}`;
    if (!eligibleSet.has(key)) {
      failedCount++;
      errors.push(
        `${item.targetType} ${item.targetId}: ไม่เข้าเกณฑ์การล้างไฟล์ที่หมดอายุ (ไฟล์ต้องผ่านเกณฑ์ระยะเวลาเก็บรักษาและไม่ถูกปักหมุด)`
      );
      continue;
    }

    try {
      const res =
        item.targetType === "slip"
          ? await privateStorage.pruneSlipBinary(user.id, item.targetId, "bulk_retention_prune")
          : await privateStorage.pruneSourceDocumentBinary(user.id, item.targetId, "bulk_retention_prune");

      if (res.success) {
        totalPruned++;
        totalBytesFreed += res.bytesFreed;
      } else {
        failedCount++;
        if (res.error) errors.push(`${item.targetType} ${item.targetId}: ${res.error}`);
      }
    } catch (err: unknown) {
      failedCount++;
      errors.push(
        `${item.targetType} ${item.targetId}: ${
          err instanceof Error ? err.message : "Error pruning"
        }`
      );
    }
  }

  revalidatePath("/settings");
  revalidatePath("/review");

  return {
    success: failedCount === 0 && totalPruned > 0,
    totalPruned,
    totalBytesFreed,
    failedCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Toggles pin protection on an evidence item.
 */
export async function toggleEvidencePinAction(
  targetId: string,
  targetType: "slip" | "source_document",
  isPinned: boolean
): Promise<{ success: boolean; isPinned?: boolean; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    if (isPinned) {
      await privateStorage.pinEvidence(user.id, targetType, targetId);
    } else {
      await privateStorage.unpinEvidence(user.id, targetType, targetId);
    }

    revalidatePath("/settings");
    revalidatePath("/review");
    return { success: true, isPinned };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถเปลี่ยนสถานะการปักหมุดได้",
    };
  }
}

/**
 * Retrieves recent storage audit events for verification.
 */
export async function getStorageAuditEventsAction(
  limit = 20
): Promise<{ success: boolean; events?: StorageBinaryEvent[]; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const events = await DataStore.getStorageBinaryEvents(user.id, { limit });
    return { success: true, events };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถโหลดประวัติการจัดการไฟล์ได้",
    };
  }
}

/**
 * Detects physical existence and retention status of a slip binary.
 */
export async function getSlipBinaryStatusAction(
  slipId: string
): Promise<{ success: boolean; status?: SlipBinaryStatus; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const status = await privateStorage.detectSlipBinaryStatus(user.id, slipId);
    return { success: true, status };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถตรวจสอบสถานะไฟล์ได้",
    };
  }
}

/**
 * Trusted server action to restore a physically missing slip binary to an existing slip record.
 * Validates ownership, trusted storage path, and strictly requires SHA-256 exact match.
 */
export async function restoreMissingSlipBinaryAction(
  slipId: string,
  formData: FormData
): Promise<{ success: boolean; message?: string; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  if (!slipId) {
    return { success: false, error: "ไม่พบรหัสสลิป (Missing slip ID)" };
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return { success: false, error: "กรุณาเลือกไฟล์สลิปที่ต้องการกู้คืน" };
  }

  try {
    const ownedSlip = await DataStore.getSlipById(user.id, slipId);
    if (!ownedSlip) {
      return { success: false, error: "ไม่พบข้อมูลสลิป (Slip not found or access denied)" };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || "image/jpeg";

    const result = await privateStorage.restoreMissingSlipBinary(
      user.id,
      slipId,
      buffer,
      mimeType
    );

    if (ownedSlip.linked_transaction_id) {
      revalidatePath(`/transactions/${ownedSlip.linked_transaction_id}`);
    }
    revalidatePath("/review");
    revalidatePath("/transactions");
    revalidatePath("/settings");

    return {
      success: true,
      message: result.message || "กู้คืนไฟล์ต้นฉบับสำเร็จ",
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการกู้คืนไฟล์",
    };
  }
}

