import { describe, it, expect, beforeEach, vi } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import {
  evaluateUnifiedStorageCleanupDryRun,
  getStorageUsageSummary,
  isDocumentRetentionEligible,
  isSlipRetentionEligible,
} from "@/lib/storage/retention";
import {
  updateRetentionSettingsAction,
} from "@/app/actions/storage";
import { Slip } from "@/types/slip";
import { SourceDocument } from "@/types/multi-source";

const USER_ID = "user-ui-semantics-test-1";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    id: USER_ID,
    email: "test@example.com",
    display_name: "Test User",
  })),
  requireUser: vi.fn(async () => ({
    id: USER_ID,
    email: "test@example.com",
    display_name: "Test User",
  })),
}));

describe("Storage Retention UI Semantics Hotfix", () => {
  const now = new Date("2026-09-18T12:00:00.000Z");

  beforeEach(() => {
    DataStore.reset();
  });

  const createDoc = (overrides: Partial<SourceDocument>): SourceDocument => ({
    id: "doc-default",
    user_id: USER_ID,
    document_type: "csv_statement",
    storage_path: null,
    original_filename: "transactions.csv",
    file_size: 0,
    stored_file_size: 0,
    file_hash: null,
    status: "processed",
    is_pinned: false,
    provider_metadata: {},
    received_at: "2026-05-01T00:00:00.000Z",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  });

  const createSlip = (overrides: Partial<Slip>): Slip => ({
    id: "slip-default",
    user_id: USER_ID,
    storage_path: `${USER_ID}/2026/05/slip.jpg`,
    file_hash_sha256: "sha256-test-hash",
    mime_type: "image/jpeg",
    file_size: 1500000,
    stored_file_size: 1500000,
    source: "web_upload",
    parser_version: "v1",
    status: "created",
    is_pinned: false,
    created_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  });

  // ==========================================
  // TEST 1: metadata-only CSV → metadataOnlyCount +1
  // ==========================================
  it("TEST-1: metadata-only CSV document increments metadataOnlyCount, not alreadyPrunedCount", () => {
    const csvDoc = createDoc({
      id: "csv-import-1",
      document_type: "csv_statement",
      storage_path: null,
      stored_file_size: 0,
      file_size: 0,
      binary_deleted_at: null,
    });

    const result = evaluateUnifiedStorageCleanupDryRun([csvDoc], [], { now, retentionDays: 90 });

    expect(result.metadataOnlyCount).toBe(1);
    expect(result.actuallyPrunedCount).toBe(0);
    expect(result.candidates).toHaveLength(0);
  });

  // ==========================================
  // TEST 2: metadata-only CSV → alreadyPrunedCount unchanged
  // ==========================================
  it("TEST-2: metadata-only CSV does NOT increment alreadyPrunedCount", () => {
    const csvDoc = createDoc({
      id: "csv-import-2",
      document_type: "csv_statement",
      storage_path: null,
      stored_file_size: 0,
      binary_deleted_at: null,
    });

    const result = evaluateUnifiedStorageCleanupDryRun([csvDoc], [], { now, retentionDays: 90 });

    // alreadyPrunedCount is backward compat alias for actuallyPrunedCount
    expect(result.alreadyPrunedCount).toBe(0);
    expect(result.metadataOnlyCount).toBe(1);
  });

  // ==========================================
  // TEST 3: binary_deleted_at document → actuallyPrunedCount +1
  // ==========================================
  it("TEST-3: document with binary_deleted_at set increments actuallyPrunedCount", () => {
    const prunedDoc = createDoc({
      id: "doc-pruned-1",
      storage_path: null,
      stored_file_size: 0,
      file_size: 2000000,
      binary_deleted_at: "2026-08-01T00:00:00.000Z",
    });

    const result = evaluateUnifiedStorageCleanupDryRun([prunedDoc], [], { now, retentionDays: 90 });

    expect(result.actuallyPrunedCount).toBe(1);
    expect(result.alreadyPrunedCount).toBe(1); // backward compat
    expect(result.metadataOnlyCount).toBe(0);
  });

  // ==========================================
  // TEST 4: real stored recent slip → exemptRecentCount +1
  // ==========================================
  it("TEST-4: recent slip with stored binary increments exemptRecentCount", () => {
    const recentSlip = createSlip({
      id: "slip-recent-1",
      created_at: "2026-09-10T00:00:00.000Z", // 8 days old
      storage_path: `${USER_ID}/2026/09/recent_slip.jpg`,
      file_size: 1200000,
      stored_file_size: 1200000,
    });

    const result = evaluateUnifiedStorageCleanupDryRun([], [recentSlip], { now, retentionDays: 90 });

    expect(result.exemptRecentCount).toBe(1);
    expect(result.candidates).toHaveLength(0);
  });

  // ==========================================
  // TEST 5: source_document_retention_days independently editable
  // ==========================================
  it("TEST-5: source_document_retention_days can be updated independently", async () => {
    // First update: set source_document_retention_days only
    const res1 = await updateRetentionSettingsAction({
      source_document_retention_days: 180,
    });
    expect(res1.success).toBe(true);
    expect(res1.settings?.source_document_retention_days).toBe(180);

    // Verify other settings remain at defaults
    const res2 = await updateRetentionSettingsAction({
      slip_retention_days: 60,
    });
    expect(res2.success).toBe(true);
    expect(res2.settings?.slip_retention_days).toBe(60);
    // source_document_retention_days should persist from previous update
    expect(res2.settings?.source_document_retention_days).toBe(180);
  });

  // ==========================================
  // TEST 6: slip UI min = 7
  // ==========================================
  it("TEST-6: slip_retention_days rejects values below 7", async () => {
    const res = await updateRetentionSettingsAction({
      slip_retention_days: 6,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("7");
    expect(res.error).toContain("3650");
  });

  // ==========================================
  // TEST 7: source-document UI min = 7
  // ==========================================
  it("TEST-7: source_document_retention_days rejects values below 7", async () => {
    const res = await updateRetentionSettingsAction({
      source_document_retention_days: 3,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("7");
    expect(res.error).toContain("3650");
  });

  // ==========================================
  // TEST 8: failed UI min = 1
  // ==========================================
  it("TEST-8: failed_retention_days accepts value 1 but rejects 0", async () => {
    const validRes = await updateRetentionSettingsAction({
      failed_retention_days: 1,
    });
    expect(validRes.success).toBe(true);

    const invalidRes = await updateRetentionSettingsAction({
      failed_retention_days: 0,
    });
    expect(invalidRes.success).toBe(false);
    expect(invalidRes.error).toContain("1");
    expect(invalidRes.error).toContain("365");
  });

  // ==========================================
  // TEST 9: dry-run performs zero mutation
  // ==========================================
  it("TEST-9: dry-run evaluation performs zero mutations on any data", async () => {
    const storagePath = `${USER_ID}/2026/05/dryrun_test.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("test binary data"));

    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: storagePath,
      file_hash_sha256: "hash-dryrun-zero-mutation",
      status: "created",
      file_size: 800000,
      stored_file_size: 800000,
      created_at: "2026-05-01T00:00:00.000Z",
    });

    // Run dry-run evaluation
    const dryRun = evaluateUnifiedStorageCleanupDryRun([], [slip], { now, retentionDays: 90 });
    expect(dryRun.candidates.length).toBeGreaterThan(0);

    // Verify the slip in DataStore was NOT modified
    const afterSlip = await DataStore.getSlipById(USER_ID, slip.id);
    expect(afterSlip?.storage_path).toBe(storagePath);
    expect(afterSlip?.stored_file_size).toBe(800000);
    expect(afterSlip?.binary_deleted_at).toBeNull();
    expect(await DataStore.slipFileExists(storagePath)).toBe(true);
  });

  // ==========================================
  // TEST 10: no binary deletion action executed
  // ==========================================
  it("TEST-10: no binary deletion is executed during dry-run - storage file remains", async () => {
    const storagePath = `${USER_ID}/2026/05/nodelete_test.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("important binary"));

    const slip = await DataStore.createSlip(USER_ID, {
      storage_path: storagePath,
      file_hash_sha256: "hash-nodelete",
      status: "created",
      file_size: 600000,
      stored_file_size: 600000,
      created_at: "2026-05-01T00:00:00.000Z",
    });

    // Evaluate dry run - this must NOT delete any binary
    evaluateUnifiedStorageCleanupDryRun([], [slip], { now, retentionDays: 90 });

    // Confirm binary file still exists
    expect(await DataStore.slipFileExists(storagePath)).toBe(true);

    // Confirm slip metadata untouched
    const afterSlip = await DataStore.getSlipById(USER_ID, slip.id);
    expect(afterSlip?.binary_deleted_at).toBeNull();
    expect(afterSlip?.storage_path).toBe(storagePath);
  });

  // ==========================================
  // RECONCILIATION TEST: counts sum to totalItems
  // ==========================================
  it("RECONCILE: candidate + pinned + recent + unresolved + metadataOnly + actuallyPruned = totalItems", () => {
    // Create a diverse set of items
    const candidateDoc = createDoc({
      id: "doc-candidate",
      document_type: "pdf_statement",
      storage_path: "storage/doc.pdf",
      file_size: 2000000,
      stored_file_size: 2000000,
      received_at: "2026-03-01T00:00:00.000Z", // >180 days old
      status: "processed",
    });

    const pinnedSlip = createSlip({
      id: "slip-pinned",
      is_pinned: true,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const recentSlip = createSlip({
      id: "slip-recent",
      created_at: "2026-09-15T00:00:00.000Z", // 3 days old
    });

    const unresolvedSlip = createSlip({
      id: "slip-unresolved",
      status: "needs_review",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const metadataOnlyDoc = createDoc({
      id: "doc-metadata-only",
      document_type: "csv_statement",
      storage_path: null,
      stored_file_size: 0,
      binary_deleted_at: null,
    });

    const prunedSlip = createSlip({
      id: "slip-pruned",
      binary_deleted_at: "2026-08-01T00:00:00.000Z",
      storage_path: null,
      stored_file_size: 0,
    });

    const docs = [candidateDoc, metadataOnlyDoc];
    const slips = [pinnedSlip, recentSlip, unresolvedSlip, prunedSlip];

    const result = evaluateUnifiedStorageCleanupDryRun(docs, slips, { now, retentionDays: 90 });

    const sumOfCategories =
      result.candidates.length +
      result.exemptPinnedCount +
      result.exemptRecentCount +
      result.exemptUnresolvedCount +
      result.metadataOnlyCount +
      result.actuallyPrunedCount;

    expect(sumOfCategories).toBe(result.totalItems);
    expect(result.totalItems).toBe(docs.length + slips.length);
  });

  // ==========================================
  // isDocumentRetentionEligible distinguishes metadata-only from pruned
  // ==========================================
  it("isDocumentRetentionEligible: metadata-only doc returns 'metadata-only' reason", () => {
    const csvDoc = createDoc({
      storage_path: null,
      stored_file_size: 0,
      binary_deleted_at: null,
    });

    const result = isDocumentRetentionEligible(csvDoc, { now, retentionDays: 90 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("metadata-only");
  });

  it("isDocumentRetentionEligible: actually-pruned doc returns 'actually pruned' reason", () => {
    const prunedDoc = createDoc({
      storage_path: null,
      stored_file_size: 0,
      binary_deleted_at: "2026-07-01T00:00:00.000Z",
    });

    const result = isDocumentRetentionEligible(prunedDoc, { now, retentionDays: 90 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("actually pruned");
  });

  // ==========================================
  // StorageUsageSummary.binariesDeletedCount ONLY counts binary_deleted_at != null
  // ==========================================
  it("binariesDeletedCount counts only binary_deleted_at, not metadata-only docs", () => {
    const csvDoc = createDoc({
      id: "csv-metadata",
      storage_path: null,
      stored_file_size: 0,
      binary_deleted_at: null,
    });

    const prunedDoc = createDoc({
      id: "doc-pruned",
      storage_path: null,
      stored_file_size: 0,
      file_size: 3000000,
      binary_deleted_at: "2026-08-01T00:00:00.000Z",
    });

    const summary = getStorageUsageSummary([csvDoc, prunedDoc]);
    expect(summary.binariesDeletedCount).toBe(1); // Only the pruned one
  });

  // ==========================================
  // Production scenario: 45 items, 7 CSV metadata-only, 38 recent slips
  // ==========================================
  it("Production scenario: 7 CSV metadata-only items not labeled as pruned", () => {
    const csvDocs = Array.from({ length: 7 }, (_, i) =>
      createDoc({
        id: `csv-${i}`,
        document_type: "csv_statement",
        storage_path: null,
        stored_file_size: 0,
        binary_deleted_at: null,
      })
    );

    const recentSlips = Array.from({ length: 38 }, (_, i) =>
      createSlip({
        id: `slip-recent-${i}`,
        created_at: "2026-09-10T00:00:00.000Z", // Recent
        storage_path: `${USER_ID}/2026/09/slip_${i}.jpg`,
        file_hash_sha256: `hash-recent-${i}`,
      })
    );

    const result = evaluateUnifiedStorageCleanupDryRun(csvDocs, recentSlips, {
      now,
      retentionDays: 90,
    });

    expect(result.totalItems).toBe(45);
    expect(result.metadataOnlyCount).toBe(7);
    expect(result.actuallyPrunedCount).toBe(0);
    expect(result.alreadyPrunedCount).toBe(0); // backward compat: no actual pruning
    expect(result.exemptRecentCount).toBe(38);
    expect(result.candidates).toHaveLength(0);

    // Summary: binariesDeletedCount must be 0
    const summary = getStorageUsageSummary(csvDocs, [], recentSlips);
    expect(summary.binariesDeletedCount).toBe(0);
  });
});
