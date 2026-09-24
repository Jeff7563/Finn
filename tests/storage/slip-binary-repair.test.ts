import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { DataStore } from "@/lib/server/data-store";
import {
  restoreMissingSlipBinary,
  detectSlipBinaryStatus,
  authorizeAndReadSlipPreview,
  deriveTrustedSlipPath,
} from "@/lib/server/private-storage";
import { getSlipSignedPreviewUrlAction } from "@/app/actions/slip-review";
import {
  restoreMissingSlipBinaryAction,
  getSlipBinaryStatusAction,
} from "@/app/actions/storage";
import { Slip } from "@/types/slip";

let mockUser: { id: string; email: string; display_name?: string } | null = null;

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: vi.fn(async () => mockUser),
  requireUser: vi.fn(async () => {
    if (!mockUser) throw new Error("Unauthorized");
    return mockUser;
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Part A: Missing Slip Binary Repair & Detection Suite (Scenarios 1-13, 30)", () => {
  const USER_ID = "user-binary-repair-1";
  const OTHER_USER = "user-binary-repair-attacker";

  const originalBuffer = Buffer.from("ORIGINAL_SLIP_IMAGE_CONTENT_XYZ_12345");
  const originalSha256 = crypto.createHash("sha256").update(originalBuffer).digest("hex");

  const wrongBuffer = Buffer.from("DIFFERENT_IMAGE_CONTENT_ABC_99999");

  beforeEach(() => {
    DataStore.reset();
    mockUser = { id: USER_ID, email: "tester@example.com" };
  });

  const setupTestSlip = async (
    options: {
      userId?: string;
      saveBinary?: boolean;
      isPruned?: boolean;
      customPath?: string;
    } = {}
  ): Promise<Slip> => {
    const uid = options.userId || USER_ID;
    const slipId = crypto.randomUUID();
    const storagePath =
      options.customPath !== undefined
        ? options.customPath
        : deriveTrustedSlipPath(uid, slipId, "image/jpeg");

    const slip = await DataStore.createSlip(uid, {
      id: slipId,
      user_id: uid,
      file_hash_sha256: originalSha256,
      storage_path: storagePath,
      stored_file_size: originalBuffer.length,
      status: "needs_review",
      binary_deleted_at: options.isPruned ? new Date().toISOString() : null,
      extracted_json: {
        amount: 500,
        currency: "THB",
        transactionDate: new Date().toISOString(),
        fieldConfidence: {},
      },
    });

    if (options.saveBinary) {
      await DataStore.saveSlipFile(storagePath, originalBuffer);
    }

    return slip;
  };

  // Scenario 1: Missing binary preview: returns binaryStatus: 'missing' / descriptive error, doesn't throw unhandled exception
  it("Scenario 1: Missing binary preview returns binaryStatus: 'missing' and doesn't throw unhandled exception", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    // Directly via authorizeAndReadSlipPreview
    const previewResult = await authorizeAndReadSlipPreview({
      slipId: slip.id,
      expStr: null,
      sig: null,
      authenticatedUserId: USER_ID,
    });
    expect(previewResult.status).toBe(404);
    expect(previewResult.error).toBeDefined();

    // Via server action getSlipSignedPreviewUrlAction
    const actionResult = await getSlipSignedPreviewUrlAction(slip.id);
    expect(actionResult.success).toBe(false);
    expect(actionResult.binaryStatus).toBe("missing");
    expect(actionResult.error).toBeDefined();
  });

  // Scenario 2: Missing binary preview error string contains "ไม่พบไฟล์ต้นฉบับในพื้นที่จัดเก็บ"
  it("Scenario 2: Missing binary preview error string contains 'ไม่พบไฟล์ต้นฉบับในพื้นที่จัดเก็บ'", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    const previewResult = await authorizeAndReadSlipPreview({
      slipId: slip.id,
      expStr: null,
      sig: null,
      authenticatedUserId: USER_ID,
    });
    expect(previewResult.error).toContain("ไม่พบไฟล์ต้นฉบับในพื้นที่จัดเก็บ");

    const actionResult = await getSlipSignedPreviewUrlAction(slip.id);
    expect(actionResult.error).toContain("ไม่พบไฟล์ต้นฉบับในพื้นที่จัดเก็บ");
  });

  // Scenario 3: Re-upload with EXACT matching SHA-256 succeeds, restores file to exact original storage_path
  it("Scenario 3: Re-upload with EXACT matching SHA-256 succeeds and restores file to original storage_path", async () => {
    const slip = await setupTestSlip({ saveBinary: false });
    expect(await DataStore.slipFileExists(slip.storage_path!)).toBe(false);

    const restoreRes = await restoreMissingSlipBinary(USER_ID, slip.id, originalBuffer, "image/jpeg");
    expect(restoreRes.success).toBe(true);
    expect(restoreRes.slipId).toBe(slip.id);
    expect(restoreRes.storagePath).toBe(slip.storage_path!);
    expect(restoreRes.bytes).toBe(originalBuffer.length);

    // Verify file exists on disk at original path with exact content
    expect(await DataStore.slipFileExists(slip.storage_path!)).toBe(true);
    const readBack = await DataStore.getSlipFile(slip.storage_path!);
    expect(readBack).toEqual(originalBuffer);

    // Preview should now succeed
    const previewRes = await authorizeAndReadSlipPreview({
      slipId: slip.id,
      expStr: null,
      sig: null,
      authenticatedUserId: USER_ID,
    });
    expect(previewRes.status).toBe(200);
    expect(previewRes.buffer).toEqual(originalBuffer);
  });

  // Scenario 4: Re-upload with DIFFERENT SHA-256 fails closed with error indicating SHA-256 mismatch
  it("Scenario 4: Re-upload with DIFFERENT SHA-256 fails closed with explicit mismatch error", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    await expect(
      restoreMissingSlipBinary(USER_ID, slip.id, wrongBuffer, "image/jpeg")
    ).rejects.toThrow("รหัส SHA-256 ไม่ตรงกับหลักฐานเดิม");
  });

  // Scenario 5: Re-upload with wrong SHA-256 leaves slip unchanged (no overwrite)
  it("Scenario 5: Re-upload with wrong SHA-256 leaves slip unchanged (no overwrite in storage)", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    try {
      await restoreMissingSlipBinary(USER_ID, slip.id, wrongBuffer, "image/jpeg");
    } catch {
      // Expected failure
    }

    // Storage file should still not exist
    expect(await DataStore.slipFileExists(slip.storage_path!)).toBe(false);

    // Slip record metadata should remain intact
    const fetchedSlip = await DataStore.getSlipById(USER_ID, slip.id);
    expect(fetchedSlip?.file_hash_sha256).toBe(originalSha256);
  });

  // Scenario 6: Re-upload with wrong SHA-256 does NOT create a duplicate slip record
  it("Scenario 6: Re-upload with wrong SHA-256 does NOT create a duplicate slip record", async () => {
    const slip = await setupTestSlip({ saveBinary: false });
    const initialSlips = await DataStore.getSlips(USER_ID);
    expect(initialSlips.length).toBe(1);

    try {
      await restoreMissingSlipBinary(USER_ID, slip.id, wrongBuffer, "image/jpeg");
    } catch {
      // Expected failure
    }

    const afterSlips = await DataStore.getSlips(USER_ID);
    expect(afterSlips.length).toBe(1);
    expect(afterSlips[0].id).toBe(slip.id);
  });

  // Scenario 7: Re-upload when binary is ALREADY PRESENT succeeds idempotently (returns success, doesn't overwrite / corrupt)
  it("Scenario 7: Re-upload when binary is ALREADY PRESENT succeeds idempotently without corruption", async () => {
    const slip = await setupTestSlip({ saveBinary: true });
    expect(await DataStore.slipFileExists(slip.storage_path!)).toBe(true);

    const res = await restoreMissingSlipBinary(USER_ID, slip.id, originalBuffer, "image/jpeg");
    expect(res.success).toBe(true);
    expect(res.message).toContain("ไฟล์ต้นฉบับยังอยู่ในระบบ");

    // File remains intact
    const content = await DataStore.getSlipFile(slip.storage_path!);
    expect(content).toEqual(originalBuffer);
  });

  // Scenario 8: Re-upload when slip is pruned (is_pruned = true / binary_deleted_at set): restores binary and clears binary_deleted_at
  it("Scenario 8: Re-upload when slip is pruned restores binary and clears binary_deleted_at", async () => {
    const slip = await setupTestSlip({ saveBinary: false, isPruned: true });
    expect(slip.binary_deleted_at).toBeDefined();

    // Verify detection sees pruned
    const statusBefore = await detectSlipBinaryStatus(USER_ID, slip.id);
    expect(statusBefore).toBe("pruned");

    const res = await restoreMissingSlipBinary(USER_ID, slip.id, originalBuffer, "image/jpeg");
    expect(res.success).toBe(true);

    // Verify database record has binary_deleted_at cleared
    const updatedSlip = await DataStore.getSlipById(USER_ID, slip.id);
    expect(updatedSlip?.binary_deleted_at).toBeNull();

    // Binary status is now available
    const statusAfter = await detectSlipBinaryStatus(USER_ID, updatedSlip!.id);
    expect(statusAfter).toBe("available");
  });

  // Scenario 9: Re-upload by unauthorized user (wrong user_id / non-owner) fails closed with access denied
  it("Scenario 9: Re-upload by unauthorized user fails closed with access denied", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    // Non-owner attempts restore
    await expect(
      restoreMissingSlipBinary(OTHER_USER, slip.id, originalBuffer, "image/jpeg")
    ).rejects.toThrow(/ไม่พบข้อมูลสลิป|Access denied/);

    // Server action with non-owner session
    mockUser = { id: OTHER_USER, email: "attacker@test.local" };
    const formData = new FormData();
    const file = new File([originalBuffer], "slip.jpg", { type: "image/jpeg" });
    formData.append("file", file);

    const actionRes = await restoreMissingSlipBinaryAction(slip.id, formData);
    expect(actionRes.success).toBe(false);
    expect(actionRes.error).toBeDefined();
  });

  // Scenario 10: Re-upload with path traversal in storage_path fails closed
  it("Scenario 10: Re-upload with path traversal in storage_path fails closed", async () => {
    const maliciousPath = `${USER_ID}/../../../etc/passwd`;
    const slip = await setupTestSlip({
      saveBinary: false,
      customPath: maliciousPath,
    });

    await expect(
      restoreMissingSlipBinary(USER_ID, slip.id, originalBuffer, "image/jpeg")
    ).rejects.toThrow("เส้นทางจัดเก็บไฟล์ไม่ถูกต้องหรือไม่ปลอดภัย");
  });

  // Scenario 11: Re-upload with corrupted/empty file buffer fails closed with validation error
  it("Scenario 11: Re-upload with empty buffer or oversized buffer fails closed", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    // Empty buffer
    await expect(
      restoreMissingSlipBinary(USER_ID, slip.id, Buffer.alloc(0), "image/jpeg")
    ).rejects.toThrow("ไฟล์ที่อัปโหลดว่างเปล่า");

    // Invalid mime type
    await expect(
      restoreMissingSlipBinary(USER_ID, slip.id, originalBuffer, "application/x-executable")
    ).rejects.toThrow("ประเภทไฟล์ไม่ถูกต้อง");
  });

  // Scenario 12: Audit event restore_completed is logged on successful repair with accurate bytes_affected and SHA-256
  it("Scenario 12: Audit event restore_completed is logged on successful repair with accurate bytes_affected and SHA-256", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    await restoreMissingSlipBinary(USER_ID, slip.id, originalBuffer, "image/jpeg");

    const events = await DataStore.getStorageBinaryEvents(USER_ID);
    const requestedEvent = events.find((e) => e.slip_id === slip.id && e.action === "restore_requested");
    const completedEvent = events.find((e) => e.slip_id === slip.id && e.action === "restore_completed");

    expect(requestedEvent).toBeDefined();
    expect(requestedEvent?.file_hash_snapshot).toBe(originalSha256);
    expect(requestedEvent?.bytes_affected).toBe(originalBuffer.length);

    expect(completedEvent).toBeDefined();
    expect(completedEvent?.file_hash_snapshot).toBe(originalSha256);
    expect(completedEvent?.bytes_affected).toBe(originalBuffer.length);
  });

  // Scenario 13: Audit event restore_failed is logged on failed repair attempt (if storage upload fails)
  it("Scenario 13: Audit event restore_failed is logged on failed repair attempt if storage upload fails", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    // Mock saveSlipFile to simulate storage failure
    vi.spyOn(DataStore, "saveSlipFile").mockRejectedValueOnce(new Error("Disk quota exceeded"));

    await expect(
      restoreMissingSlipBinary(USER_ID, slip.id, originalBuffer, "image/jpeg")
    ).rejects.toThrow("การอัปโหลดไฟล์ไปยังพื้นที่จัดเก็บล้มเหลว: Disk quota exceeded");

    const events = await DataStore.getStorageBinaryEvents(USER_ID);
    const failedEvent = events.find((e) => e.slip_id === slip.id && e.action === "restore_failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.safe_error_message).toContain("Disk quota exceeded");
  });

  // Scenario 30: Audit trail: storage_binary_events records restore_completed with correct user_id, slip_id, file_hash_snapshot
  it("Scenario 30: Audit trail records restore_completed with exact user_id, slip_id, and file_hash_snapshot", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    await restoreMissingSlipBinary(USER_ID, slip.id, originalBuffer, "image/jpeg");

    const events = await DataStore.getStorageBinaryEvents(USER_ID);
    const completed = events.find((e) => e.slip_id === slip.id && e.action === "restore_completed");

    expect(completed).toBeDefined();
    expect(completed?.user_id).toBe(USER_ID);
    expect(completed?.slip_id).toBe(slip.id);
    expect(completed?.file_hash_snapshot).toBe(originalSha256);
    expect(completed?.storage_path_snapshot).toBe(slip.storage_path!);
  });

  // Extra coverage: getSlipBinaryStatusAction
  it("Server Action: getSlipBinaryStatusAction returns correct status", async () => {
    const slipMissing = await setupTestSlip({ saveBinary: false });
    const resMissing = await getSlipBinaryStatusAction(slipMissing.id);
    expect(resMissing.success).toBe(true);
    expect(resMissing.status).toBe("missing");

    const slipPresent = await setupTestSlip({ saveBinary: true });
    const resPresent = await getSlipBinaryStatusAction(slipPresent.id);
    expect(resPresent.success).toBe(true);
    expect(resPresent.status).toBe("available");
  });

  // Extra coverage: restoreMissingSlipBinaryAction end-to-end with FormData
  it("Server Action: restoreMissingSlipBinaryAction succeeds with valid FormData and matching SHA-256", async () => {
    const slip = await setupTestSlip({ saveBinary: false });

    const formData = new FormData();
    const file = new File([originalBuffer], "slip.jpg", { type: "image/jpeg" });
    formData.append("file", file);

    const actionRes = await restoreMissingSlipBinaryAction(slip.id, formData);
    expect(actionRes.success).toBe(true);
    expect(actionRes.message).toContain("สำเร็จ");

    // Verify binary is now restored
    expect(await DataStore.slipFileExists(slip.storage_path!)).toBe(true);
  });
});
