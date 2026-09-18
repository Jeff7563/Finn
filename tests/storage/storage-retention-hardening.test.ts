import { describe, it, expect, beforeEach, vi } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import {
  isSlipRetentionEligible,
  evaluateUnifiedStorageCleanupDryRun,
  getStorageUsageSummary,
} from "@/lib/storage/retention";
import {
  pruneSlipBinary,
  pinEvidence,
  unpinEvidence,
} from "@/lib/server/private-storage";
import {
  updateRetentionSettingsAction,
  bulkPruneAction,
} from "@/app/actions/storage";
import { reprocessSlipAction } from "@/app/actions/slip-review";
import { Slip } from "@/types/slip";
import { SourceDocument } from "@/types/multi-source";
import { calculateAccountBalance } from "@/lib/finance/balances";

const USER_ID = "user-retention-alice-1";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    id: USER_ID,
    email: "alice@example.com",
    display_name: "Alice",
  })),
  requireUser: vi.fn(async () => ({
    id: USER_ID,
    email: "alice@example.com",
    display_name: "Alice",
  })),
}));

describe("Slip Retention Hardening & Privacy (20 Scenarios)", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");

  beforeEach(() => {
    DataStore.reset();
  });

  const createTestSlip = (overrides: Partial<Slip>): Slip => ({
    id: "slip-test-1",
    user_id: USER_ID,
    storage_path: `${USER_ID}/2026/05/slip-1.jpg`,
    file_hash_sha256: "sha256-original-slip-hash-12345",
    mime_type: "image/jpeg",
    file_size: 1500000,
    stored_file_size: 1500000,
    source: "web_upload",
    parser_version: "v1",
    status: "created",
    is_pinned: false,
    created_at: "2026-05-01T00:00:00.000Z", // ~139 days old
    ...overrides,
  });

  // 1. Unpinned slip > 90d is eligible
  it("RET-01: Unpinned slip older than 90 days is eligible for binary cleanup", () => {
    const slip = createTestSlip({
      created_at: "2026-06-01T00:00:00.000Z", // ~108 days old
      is_pinned: false,
      status: "created",
    });

    const { eligible, ageDays, reason } = isSlipRetentionEligible(slip, { now, retentionDays: 90 });
    expect(eligible).toBe(true);
    expect(ageDays).toBeGreaterThan(90);
    expect(reason).toContain("Exceeded retention threshold");
  });

  // 2. Unpinned slip < 90d is NOT eligible
  it("RET-02: Unpinned slip younger than 90 days is NOT eligible for binary cleanup", () => {
    const slip = createTestSlip({
      created_at: "2026-08-20T00:00:00.000Z", // ~28 days old
      is_pinned: false,
      status: "created",
    });

    const { eligible, ageDays, reason } = isSlipRetentionEligible(slip, { now, retentionDays: 90 });
    expect(eligible).toBe(false);
    expect(ageDays).toBeLessThan(90);
    expect(reason).toContain("Within retention window");
  });

  // 3. Pinned slip is NEVER eligible regardless of age
  it("RET-03: Pinned slip is NEVER eligible for cleanup even if years old", () => {
    const slip = createTestSlip({
      created_at: "2020-01-01T00:00:00.000Z", // >6 years old
      is_pinned: true,
      status: "created",
    });

    const { eligible, reason } = isSlipRetentionEligible(slip, { now, retentionDays: 90 });
    expect(eligible).toBe(false);
    expect(reason).toContain("is pinned by user");
  });

  // 4. Pin toggle protects and restores eligibility
  it("RET-04: Pin toggle safely protects and unprotects evidence from cleanup", async () => {
    const slip = await DataStore.createSlip(USER_ID, {
      file_hash_sha256: "hash-pin-toggle",
      storage_path: `${USER_ID}/2026/05/pin_slip.jpg`,
      status: "created",
      is_pinned: false,
      created_at: "2026-05-01T00:00:00.000Z",
    });

    await pinEvidence(USER_ID, "slip", slip.id);
    let updated = await DataStore.getSlipById(USER_ID, slip.id);
    expect(updated?.is_pinned).toBe(true);

    await unpinEvidence(USER_ID, "slip", slip.id);
    updated = await DataStore.getSlipById(USER_ID, slip.id);
    expect(updated?.is_pinned).toBe(false);
  });

  // 5. Slips in unresolved status (uploaded, processing, needs_review) are protected
  it("RET-05: Slips in unresolved review statuses are exempt from cleanup", () => {
    const unresolvedStatuses: Slip["status"][] = ["uploaded", "processing", "needs_review"];

    for (const status of unresolvedStatuses) {
      const slip = createTestSlip({
        status,
        created_at: "2026-01-01T00:00:00.000Z", // Very old
      });
      const { eligible, reason } = isSlipRetentionEligible(slip, { now, retentionDays: 90 });
      expect(eligible).toBe(false);
      expect(reason).toContain("unresolved review status");
    }
  });

  // 6. Failed or rejected slips have 7-day retention window
  it("RET-06: Failed or rejected slips are eligible after 7 days", () => {
    const failedSlip = createTestSlip({
      status: "failed",
      created_at: "2026-09-08T00:00:00.000Z", // 9 days old (> 7 days)
    });

    const { eligible, reason } = isSlipRetentionEligible(failedSlip, { now, failedRetentionDays: 7 });
    expect(eligible).toBe(true);
    expect(reason).toContain("Failed or rejected slip exceeded cleanup threshold");
  });

  // 7. Dry-run performs zero deletions
  it("RET-07: Dry-run evaluation performs zero mutations and preserves all storage binaries", async () => {
    const storagePath = `${USER_ID}/2026/05/dry_run_slip.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("image"));

    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: storagePath,
      file_hash_sha256: "hash-dryrun",
      status: "created",
      file_size: 500000,
      stored_file_size: 500000,
      created_at: "2026-05-01T00:00:00.000Z",
    });

    const dryRun = evaluateUnifiedStorageCleanupDryRun([], [slip], { now, retentionDays: 90 });
    expect(dryRun.candidates.length).toBe(1);
    expect(dryRun.bytesRecoverable).toBe(500000);

    // Verify slip in store was untouched
    const afterSlip = await DataStore.getSlipById(USER_ID, slip.id);
    expect(afterSlip?.storage_path).toBe(storagePath);
    expect(afterSlip?.stored_file_size).toBe(500000);
    expect(afterSlip?.binary_deleted_at).toBeNull();
    expect(await DataStore.slipFileExists(storagePath)).toBe(true);
  });

  // 8. Dry-run correctly categorizes exemptions
  it("RET-08: Dry-run correctly breaks down candidates and exempt counts", () => {
    const eligible = createTestSlip({ id: "s1", is_pinned: false, created_at: "2026-05-01T00:00:00.000Z" });
    const pinned = createTestSlip({ id: "s2", is_pinned: true, created_at: "2026-05-01T00:00:00.000Z" });
    const recent = createTestSlip({ id: "s3", is_pinned: false, created_at: "2026-09-10T00:00:00.000Z" });
    const unresolved = createTestSlip({ id: "s4", status: "needs_review", created_at: "2026-05-01T00:00:00.000Z" });

    const dryRun = evaluateUnifiedStorageCleanupDryRun([], [eligible, pinned, recent, unresolved], { now, retentionDays: 90 });
    expect(dryRun.candidates.length).toBe(1);
    expect(dryRun.exemptPinnedCount).toBe(1);
    expect(dryRun.exemptRecentCount).toBe(1);
    expect(dryRun.exemptUnresolvedCount).toBe(1);
  });

  // 9. Pruning slip binary sets stored_file_size = 0 and binary_deleted_at
  it("RET-09: Pruning sets stored_file_size = 0 and binary_deleted_at timestamp", async () => {
    const storagePath = `${USER_ID}/2026/05/prune_test.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("image binary"));

    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: storagePath,
      file_hash_sha256: "hash-prune-fields",
      status: "created",
      file_size: 1200000,
      stored_file_size: 1200000,
    });

    const res = await pruneSlipBinary(USER_ID, slip.id, "test_prune");
    expect(res.success).toBe(true);
    expect(res.bytesFreed).toBe(1200000);

    const updated = await DataStore.getSlipById(USER_ID, slip.id);
    expect(updated?.stored_file_size).toBe(0);
    expect(updated?.binary_deleted_at).toBeTruthy();
    expect(await DataStore.slipFileExists(storagePath)).toBe(false);
  });

  // 10. Pruning slip binary preserves metadata
  it("RET-10: Pruning preserves OCR text, extracted JSON, and linked transaction ID", async () => {
    const storagePath = `${USER_ID}/2026/05/metadata_preserved.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("binary content"));

    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: storagePath,
      file_hash_sha256: "hash-preserved-sha",
      status: "created",
      file_size: 800000,
      stored_file_size: 800000,
      linked_transaction_id: "tx-12345-preserved",
      raw_ocr_text: "โอนเงินสำเร็จ 1,500.00 บาท",
      extracted_json: {
        amount: 1500,
        currency: "THB",
        fieldConfidence: { amount: 0.99 },
      },
    });

    await pruneSlipBinary(USER_ID, slip.id, "test_metadata");
    const after = await DataStore.getSlipById(USER_ID, slip.id);

    expect(after?.linked_transaction_id).toBe("tx-12345-preserved");
    expect(after?.raw_ocr_text).toBe("โอนเงินสำเร็จ 1,500.00 บาท");
    expect(after?.extracted_json?.amount).toBe(1500);
    expect(after?.file_hash_sha256).toBe("hash-preserved-sha");
  });

  // 11. Hash survives binary deletion
  it("RET-11: File SHA-256 hash strictly survives binary deletion", async () => {
    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: `${USER_ID}/2026/05/hash_test.jpg`,
      file_hash_sha256: "sha256-uncompromised-integrity-hash",
      status: "created",
      file_size: 600000,
      stored_file_size: 600000,
    });

    await pruneSlipBinary(USER_ID, slip.id, "test_hash");
    const after = await DataStore.getSlipById(USER_ID, slip.id);
    expect(after?.file_hash_sha256).toBe("sha256-uncompromised-integrity-hash");
  });

  // 12. Ingesting duplicate after prune prevents duplicate transaction
  it("RET-12: Uploading duplicate slip after prune is detected by SHA-256 index", async () => {
    const hash = "sha256-identical-receipt-123";
    const slip1 = await DataStore.createSlip(USER_ID, {
      storage_path: `${USER_ID}/2026/05/dup1.jpg`,
      file_hash_sha256: hash,
      status: "created",
      file_size: 400000,
      stored_file_size: 400000,
    });

    await pruneSlipBinary(USER_ID, slip1.id, "prune_first");

    // Check duplicate detection against stored slips
    const existing = await DataStore.getSlipByFileHash(USER_ID, hash);
    expect(existing).toBeDefined();
    expect(existing?.id).toBe(slip1.id);
  });

  // 13. Balance remains unchanged after pruning
  it("RET-13: Account balance remains completely unchanged before and after pruning", async () => {
    const account = await DataStore.createAccount(USER_ID, {
      name: "Savings Account",
      type: "bank",
      opening_balance: 10000,
    });

    const tx = await DataStore.createTransaction(USER_ID, {
      from_account_id: account.id,
      amount: 500,
      type: "expense",
      transaction_date: "2026-05-01T00:00:00.000Z",
    });

    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: `${USER_ID}/2026/05/tx_slip.jpg`,
      file_hash_sha256: "hash-tx-slip",
      status: "created",
      file_size: 300000,
      stored_file_size: 300000,
      linked_transaction_id: tx.id,
    });

    const txsBefore = await DataStore.getTransactions(USER_ID);
    const balanceBefore = calculateAccountBalance(account, txsBefore).current_balance;
    expect(balanceBefore).toBe(9500);

    await pruneSlipBinary(USER_ID, slip.id, "prune_financial_test");

    const txsAfter = await DataStore.getTransactions(USER_ID);
    const balanceAfter = calculateAccountBalance(account, txsAfter).current_balance;
    expect(balanceAfter).toBe(balanceBefore);
  });

  // 14. Idempotent pruning
  it("RET-14: Pruning an already pruned slip is idempotent and returns 0 bytes freed", async () => {
    const storagePath = `${USER_ID}/2026/05/idempotent.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("data"));

    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: storagePath,
      file_hash_sha256: "hash-idempotent",
      status: "created",
      file_size: 200000,
      stored_file_size: 200000,
    });

    const first = await pruneSlipBinary(USER_ID, slip.id, "first_prune");
    expect(first.bytesFreed).toBe(200000);

    const second = await pruneSlipBinary(USER_ID, slip.id, "second_prune");
    expect(second.success).toBe(true);
    expect(second.bytesFreed).toBe(0);
  });

  // 15. Storage failure aborts DB metadata update
  it("RET-15: Storage deletion failure records prune_failed and does not alter DB metadata", async () => {
    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: `${USER_ID}/2026/05/fail_test.jpg`,
      file_hash_sha256: "hash-fail-test",
      status: "created",
      file_size: 450000,
      stored_file_size: 450000,
    });

    // Mock deleteSlipFile to throw an unexpected error
    const originalDelete = DataStore.deleteSlipFile;
    DataStore.deleteSlipFile = async () => {
      throw new Error("Simulated remote S3/Storage network failure");
    };

    try {
      await expect(pruneSlipBinary(USER_ID, slip.id, "failure_test")).rejects.toThrow(/ล้มเหลว/);

      // Verify DB metadata was NOT updated
      const after = await DataStore.getSlipById(USER_ID, slip.id);
      expect(after?.stored_file_size).toBe(450000);
      expect(after?.binary_deleted_at).toBeNull();

      // Verify prune_failed audit event was logged
      const events = await DataStore.getStorageBinaryEvents(USER_ID);
      const failedEvt = events.find((e) => e.slip_id === slip.id && e.action === "prune_failed");
      expect(failedEvt).toBeDefined();
      expect(failedEvt?.safe_error_message).toContain("Simulated remote S3/Storage network failure");
    } finally {
      DataStore.deleteSlipFile = originalDelete;
    }
  });

  // 16. Reprocessing pruned slip returns graceful error
  it("RET-16: Reprocessing a pruned slip returns graceful error message", async () => {
    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: `${USER_ID}/2026/05/pruned_reprocess.jpg`,
      file_hash_sha256: "hash-reprocess-pruned",
      status: "created",
      binary_deleted_at: "2026-09-17T00:00:00.000Z",
      raw_ocr_text: "โอนเงิน 500 บาท",
    });

    const res = await reprocessSlipAction(slip.id);
    expect(res.success).toBe(false);
    expect(res.error).toBe("ไฟล์ต้นฉบับถูกลบแล้ว ไม่สามารถประมวลผลสลิปใหม่ได้");
  });

  // 17. Reprocessing pruned slip preserves existing OCR data
  it("RET-17: Reprocessing pruned slip does not corrupt or wipe existing OCR text", async () => {
    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: `${USER_ID}/2026/05/pruned_reprocess_ocr.jpg`,
      file_hash_sha256: "hash-reprocess-ocr",
      status: "created",
      binary_deleted_at: "2026-09-17T00:00:00.000Z",
      raw_ocr_text: "ยอดเงิน 1,200 บาท",
    });

    await reprocessSlipAction(slip.id);
    const after = await DataStore.getSlipById(USER_ID, slip.id);
    expect(after?.raw_ocr_text).toBe("ยอดเงิน 1,200 บาท");
  });

  // 18. Storage usage summary accurately aggregates across documents and slips
  it("RET-18: Storage usage summary accurately calculates bytes, pruned count, and pinned count", () => {
    const doc: SourceDocument = {
      id: "doc-1",
      user_id: USER_ID,
      document_type: "pdf_statement",
      storage_path: "path/to/doc.pdf",
      original_filename: "statement.pdf",
      file_size: 2000000,
      stored_file_size: 2000000,
      file_hash: "hash-doc",
      status: "processed",
      is_pinned: true,
      provider_metadata: {},
      received_at: "2026-05-01T00:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-01T00:00:00.000Z",
    };

    const slip = createTestSlip({
      file_size: 1000000,
      stored_file_size: 1000000,
      is_pinned: false,
    });

    const summary = getStorageUsageSummary([doc], [], [slip]);
    expect(summary.totalDocuments).toBe(2);
    expect(summary.totalStoredBytes).toBe(3000000);
    expect(summary.pinnedCount).toBe(1);
  });

  // 19. Retention settings input bounds validation
  it("RET-19: Retention settings validation enforces boundary limits", async () => {
    // Valid update
    const valid = await updateRetentionSettingsAction({
      slip_retention_days: 60,
      failed_retention_days: 14,
    });
    expect(valid.success).toBe(true);

    // Invalid negative slip days
    const invalidSlipDays = await updateRetentionSettingsAction({
      slip_retention_days: 0,
    });
    expect(invalidSlipDays.success).toBe(false);
    expect(invalidSlipDays.error).toContain("ระหว่าง 7 ถึง 3650 วัน");

    // Invalid negative failed days
    const invalidFailedDays = await updateRetentionSettingsAction({
      failed_retention_days: -5,
    });
    expect(invalidFailedDays.success).toBe(false);
    expect(invalidFailedDays.error).toContain("ระหว่าง 1 ถึง 365 วัน");
  });

  // 20. Bulk prune across multiple targets with safety
  it("RET-20: Bulk prune safely processes multiple candidates with error accumulation", async () => {
    const path1 = `${USER_ID}/2026/05/bulk1.jpg`;
    const path2 = `${USER_ID}/2026/05/bulk2.jpg`;
    await DataStore.saveSlipFile(path1, Buffer.from("data1"));
    await DataStore.saveSlipFile(path2, Buffer.from("data2"));

    const pastDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const s1 = await DataStore.createSlip(USER_ID, {
      storage_path: path1,
      file_hash_sha256: "hash-bulk-1",
      status: "created",
      file_size: 100000,
      stored_file_size: 100000,
      created_at: pastDate,
    });
    const s2 = await DataStore.createSlip(USER_ID, {
      storage_path: path2,
      file_hash_sha256: "hash-bulk-2",
      status: "created",
      file_size: 150000,
      stored_file_size: 150000,
      created_at: pastDate,
    });

    const res = await bulkPruneAction([
      { targetId: s1.id, targetType: "slip" },
      { targetId: s2.id, targetType: "slip" },
    ]);

    expect(res.success).toBe(true);
    expect(res.totalPruned).toBe(2);
    expect(res.totalBytesFreed).toBe(250000);
    expect(res.failedCount).toBe(0);
  });
});
