import { describe, it, expect, beforeEach, vi } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import {
  evaluateUnifiedStorageCleanupDryRun,
  getStorageUsageSummary,
  isDocumentRetentionEligible,
  isSlipRetentionEligible,
  StorageCleanupOptions,
} from "@/lib/storage/retention";
import {
  updateRetentionSettingsAction,
  getCleanupDryRunAction,
} from "@/app/actions/storage";
import {
  validateSlipRetentionDays,
  validateSourceDocRetentionDays,
  validateFailedRetentionDays,
  validateRetentionInputs,
} from "@/components/settings/StorageRetentionSettingsClient";
import fs from "fs";
import path from "path";
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

  // ==================================================
  // SECTION 3: RECONCILIATION INVARIANT
  // ==================================================
  describe("Section 3: Reconciliation Invariant (summary.cleanupEligibleCount === dryRun.candidates.length)", () => {
    it("guarantees summary.cleanupEligibleCount === dryRun.candidates.length across all policy configurations", () => {
      // Build snapshot with diverse item states
      const candidateSlip = createSlip({
        id: "slip-cand-1",
        created_at: "2026-05-01T00:00:00.000Z", // ~140 days old
        is_pinned: false,
        status: "created",
      });
      const recentSlip = createSlip({
        id: "slip-recent-1",
        created_at: "2026-09-10T00:00:00.000Z", // ~8 days old
        is_pinned: false,
        status: "created",
      });
      const pinnedSlip = createSlip({
        id: "slip-pinned-1",
        created_at: "2026-01-01T00:00:00.000Z", // >250 days old but pinned
        is_pinned: true,
        status: "created",
      });
      const prunedSlip = createSlip({
        id: "slip-pruned-1",
        created_at: "2026-01-01T00:00:00.000Z",
        binary_deleted_at: "2026-08-01T00:00:00.000Z",
        storage_path: null,
        stored_file_size: 0,
      });
      const unconfirmedSlip = createSlip({
        id: "slip-unconfirmed-1",
        created_at: "2026-01-01T00:00:00.000Z",
        status: "needs_review",
      });
      const candidateDoc = createDoc({
        id: "doc-cand-1",
        document_type: "pdf_statement",
        storage_path: "storage/doc1.pdf",
        stored_file_size: 2000000,
        file_size: 2000000,
        received_at: "2026-06-01T00:00:00.000Z", // ~109 days old
        status: "processed",
      });
      const recentDoc = createDoc({
        id: "doc-recent-1",
        document_type: "pdf_statement",
        storage_path: "storage/doc2.pdf",
        stored_file_size: 1500000,
        file_size: 1500000,
        received_at: "2026-09-15T00:00:00.000Z", // ~3 days old
        status: "processed",
      });
      const metadataOnlyDoc = createDoc({
        id: "doc-meta-1",
        document_type: "csv_statement",
        storage_path: null,
        stored_file_size: 0,
        received_at: "2026-01-01T00:00:00.000Z",
      });

      const docs = [candidateDoc, recentDoc, metadataOnlyDoc];
      const slips = [candidateSlip, recentSlip, pinnedSlip, prunedSlip, unconfirmedSlip];

      const testConfigurations: StorageCleanupOptions[] = [
        // Standard default
        { slipRetentionDays: 90, sourceDocumentRetentionDays: 90, failedRetentionDays: 7, now },
        // Short slip, long doc
        { slipRetentionDays: 14, sourceDocumentRetentionDays: 180, failedRetentionDays: 7, now },
        // Long slip, short doc
        { slipRetentionDays: 180, sourceDocumentRetentionDays: 30, failedRetentionDays: 7, now },
        // Strict: both short
        { slipRetentionDays: 7, sourceDocumentRetentionDays: 7, failedRetentionDays: 1, now },
        // Lenient: both long
        { slipRetentionDays: 365, sourceDocumentRetentionDays: 365, failedRetentionDays: 30, now },
      ];

      for (const opts of testConfigurations) {
        const dryRun = evaluateUnifiedStorageCleanupDryRun(docs, slips, opts);
        const summary = getStorageUsageSummary(docs, [], slips, opts);

        expect(summary.cleanupEligibleCount).toBe(dryRun.candidates.length);
      }
    });

    it("getCleanupDryRunAction reconciles usageSummary.cleanupEligibleCount with dryRun.candidates.length", async () => {
      // Seed user with custom retention settings and slips in DataStore
      await DataStore.updateStorageRetentionSettings(USER_ID, {
        slip_retention_days: 45,
        source_document_retention_days: 60,
        failed_retention_days: 7,
      });

      const oldSlipDate = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();
      const freshSlipDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      await DataStore.createSlip(USER_ID, {
        storage_path: `${USER_ID}/old.jpg`,
        file_hash_sha256: "hash-old-reconcile",
        status: "created",
        file_size: 500000,
        stored_file_size: 500000,
        created_at: oldSlipDate,
      });

      await DataStore.createSlip(USER_ID, {
        storage_path: `${USER_ID}/fresh.jpg`,
        file_hash_sha256: "hash-fresh-reconcile",
        status: "created",
        file_size: 500000,
        stored_file_size: 500000,
        created_at: freshSlipDate,
      });

      const res = await getCleanupDryRunAction();
      expect(res.success).toBe(true);
      expect(res.dryRun).toBeDefined();
      expect(res.usageSummary).toBeDefined();

      // Invariant: summary.cleanupEligibleCount === dryRun.candidates.length
      expect(res.usageSummary!.cleanupEligibleCount).toBe(res.dryRun!.candidates.length);
      expect(res.dryRun!.candidates.length).toBe(1);
    });
  });

  // ==================================================
  // SECTION 4: TEST INPUT BEHAVIOR (Requirements 1 - 10)
  // ==================================================
  describe("Section 4: Test Input Behavior (Requirements 1-10)", () => {
    // 1. blank slip value is rejected, not converted to 7
    it("1. blank slip value is rejected, not converted to 7", () => {
      const fieldRes = validateSlipRetentionDays("");
      expect(fieldRes.valid).toBe(false);
      expect(fieldRes.error).toContain("กรุณาระบุจำนวนวันเก็บรักษาสลิป");
      expect(fieldRes.parsed).toBeUndefined();

      const formRes = validateRetentionInputs("", "90", "7");
      expect(formRes.valid).toBe(false);
      expect(formRes.error).toContain("กรุณาระบุจำนวนวันเก็บรักษาสลิป");
      expect(formRes.values).toBeUndefined();
    });

    // 2. slip 0 rejected
    it("2. slip 0 rejected", async () => {
      const fieldRes = validateSlipRetentionDays("0");
      expect(fieldRes.valid).toBe(false);
      expect(fieldRes.error).toContain("7 ถึง 3,650 วัน");

      const actionRes = await updateRetentionSettingsAction({ slip_retention_days: 0 });
      expect(actionRes.success).toBe(false);
      expect(actionRes.error).toContain("7 ถึง 3650 วัน");
    });

    // 3. slip 6 rejected
    it("3. slip 6 rejected", async () => {
      const fieldRes = validateSlipRetentionDays("6");
      expect(fieldRes.valid).toBe(false);
      expect(fieldRes.error).toContain("7 ถึง 3,650 วัน");

      const actionRes = await updateRetentionSettingsAction({ slip_retention_days: 6 });
      expect(actionRes.success).toBe(false);
      expect(actionRes.error).toContain("7 ถึง 3650 วัน");
    });

    // 4. slip 7 accepted
    it("4. slip 7 accepted", async () => {
      const fieldRes = validateSlipRetentionDays("7");
      expect(fieldRes.valid).toBe(true);
      expect(fieldRes.parsed).toBe(7);

      const formRes = validateRetentionInputs("7", "90", "7");
      expect(formRes.valid).toBe(true);
      expect(formRes.values?.slipDays).toBe(7);

      const actionRes = await updateRetentionSettingsAction({ slip_retention_days: 7 });
      expect(actionRes.success).toBe(true);
      expect(actionRes.settings?.slip_retention_days).toBe(7);
    });

    // 5. blank source document value rejected
    it("5. blank source document value rejected", () => {
      const fieldRes = validateSourceDocRetentionDays("");
      expect(fieldRes.valid).toBe(false);
      expect(fieldRes.error).toContain("กรุณาระบุจำนวนวันเก็บรักษาเอกสารนำเข้า");
      expect(fieldRes.parsed).toBeUndefined();

      const formRes = validateRetentionInputs("90", "", "7");
      expect(formRes.valid).toBe(false);
      expect(formRes.error).toContain("กรุณาระบุจำนวนวันเก็บรักษาเอกสารนำเข้า");
      expect(formRes.values).toBeUndefined();
    });

    // 6. source document 6 rejected
    it("6. source document 6 rejected", async () => {
      const fieldRes = validateSourceDocRetentionDays("6");
      expect(fieldRes.valid).toBe(false);
      expect(fieldRes.error).toContain("7 ถึง 3,650 วัน");

      const actionRes = await updateRetentionSettingsAction({ source_document_retention_days: 6 });
      expect(actionRes.success).toBe(false);
      expect(actionRes.error).toContain("7 ถึง 3650 วัน");
    });

    // 7. source document 7 accepted
    it("7. source document 7 accepted", async () => {
      const fieldRes = validateSourceDocRetentionDays("7");
      expect(fieldRes.valid).toBe(true);
      expect(fieldRes.parsed).toBe(7);

      const formRes = validateRetentionInputs("90", "7", "7");
      expect(formRes.valid).toBe(true);
      expect(formRes.values?.sourceDocDays).toBe(7);

      const actionRes = await updateRetentionSettingsAction({ source_document_retention_days: 7 });
      expect(actionRes.success).toBe(true);
      expect(actionRes.settings?.source_document_retention_days).toBe(7);
    });

    // 8. failed 0 rejected
    it("8. failed 0 rejected", async () => {
      const fieldRes = validateFailedRetentionDays("0");
      expect(fieldRes.valid).toBe(false);
      expect(fieldRes.error).toContain("1 ถึง 365 วัน");

      const actionRes = await updateRetentionSettingsAction({ failed_retention_days: 0 });
      expect(actionRes.success).toBe(false);
      expect(actionRes.error).toContain("1 ถึง 365 วัน");
    });

    // 9. failed 1 accepted
    it("9. failed 1 accepted", async () => {
      const fieldRes = validateFailedRetentionDays("1");
      expect(fieldRes.valid).toBe(true);
      expect(fieldRes.parsed).toBe(1);

      const formRes = validateRetentionInputs("90", "90", "1");
      expect(formRes.valid).toBe(true);
      expect(formRes.values?.failedDays).toBe(1);

      const actionRes = await updateRetentionSettingsAction({ failed_retention_days: 1 });
      expect(actionRes.success).toBe(true);
      expect(actionRes.settings?.failed_retention_days).toBe(1);
    });

    // 10. no `parseInt(...) || 7` / `|| 1` silent fallback remains
    it("10. no `parseInt(...) || 7` / `|| 1` silent fallback remains", () => {
      const clientFilePath = path.resolve(
        __dirname,
        "../../src/components/settings/StorageRetentionSettingsClient.tsx"
      );
      const fileContent = fs.readFileSync(clientFilePath, "utf-8");

      // Verify no silent clamp patterns exist
      expect(fileContent).not.toContain("parseInt(e.target.value, 10) || 7");
      expect(fileContent).not.toContain("parseInt(e.target.value, 10) || 1");
      expect(fileContent).not.toMatch(/parseInt\([^)]+\)\s*\|\|\s*[0-9]+/);

      // Verify raw string input state bindings exist
      expect(fileContent).toContain("setSlipDaysInput(e.target.value)");
      expect(fileContent).toContain("setSourceDocDaysInput(e.target.value)");
      expect(fileContent).toContain("setFailedDaysInput(e.target.value)");

      // Verify boundary upper bounds
      expect(validateSlipRetentionDays("3651").valid).toBe(false);
      expect(validateSourceDocRetentionDays("3651").valid).toBe(false);
      expect(validateFailedRetentionDays("366").valid).toBe(false);
    });
  });

  // ==================================================
  // SECTION 5: CUSTOM RETENTION SUMMARY TEST
  // ==================================================
  describe("Section 5: Custom Retention Summary Test", () => {
    it("custom retention: 45-day slip with retention=30 is candidate and reconciles; retention=90 is NOT candidate and reconciles", () => {
      // 45 days before 'now' (2026-09-18T12:00:00.000Z) -> 2026-08-04T12:00:00.000Z
      const slip45d = createSlip({
        id: "slip-45-days-old",
        created_at: "2026-08-04T12:00:00.000Z",
        status: "created",
        is_pinned: false,
        file_size: 1500000,
        stored_file_size: 1500000,
      });

      // Step 1: slip retention = 30 days, source doc retention = 180 days
      const policy30 = {
        slipRetentionDays: 30,
        sourceDocumentRetentionDays: 180,
        failedRetentionDays: 7,
        now,
      };

      const dryRun30 = evaluateUnifiedStorageCleanupDryRun([], [slip45d], policy30);
      const summary30 = getStorageUsageSummary([], [], [slip45d], policy30);

      // Expected: slip = cleanup candidate
      expect(dryRun30.candidates).toHaveLength(1);
      expect(dryRun30.candidates[0].id).toBe("slip-45-days-old");
      expect(dryRun30.candidates[0].ageDays).toBe(45);

      // Invariant: summary.cleanupEligibleCount === dryRun.candidates.length
      expect(summary30.cleanupEligibleCount).toBe(1);
      expect(summary30.cleanupEligibleCount).toBe(dryRun30.candidates.length);

      // Step 2: change slip retention to 90
      const policy90 = {
        slipRetentionDays: 90,
        sourceDocumentRetentionDays: 180,
        failedRetentionDays: 7,
        now,
      };

      const dryRun90 = evaluateUnifiedStorageCleanupDryRun([], [slip45d], policy90);
      const summary90 = getStorageUsageSummary([], [], [slip45d], policy90);

      // Expected: same slip is NOT candidate
      expect(dryRun90.candidates).toHaveLength(0);
      expect(dryRun90.exemptRecentCount).toBe(1);

      // Invariant: summary remains reconciled
      expect(summary90.cleanupEligibleCount).toBe(0);
      expect(summary90.cleanupEligibleCount).toBe(dryRun90.candidates.length);
    });

    it("independent source document retention operates independently from slip retention", () => {
      // 45-day old slip (2026-08-04T12:00:00.000Z)
      const slip45d = createSlip({
        id: "slip-45-days",
        created_at: "2026-08-04T12:00:00.000Z",
        status: "created",
        is_pinned: false,
      });

      // 60-day old source document (2026-07-20T12:00:00.000Z)
      const doc60d = createDoc({
        id: "doc-60-days",
        document_type: "pdf_statement",
        storage_path: "storage/statement_60d.pdf",
        stored_file_size: 2500000,
        file_size: 2500000,
        received_at: "2026-07-20T12:00:00.000Z",
        status: "processed",
        is_pinned: false,
      });

      // Configuration A: slip retention = 30, source document retention = 90
      // Expected: slip is candidate (45 >= 30), doc is exempt recent (60 < 90)
      const configA = {
        slipRetentionDays: 30,
        sourceDocumentRetentionDays: 90,
        failedRetentionDays: 7,
        now,
      };
      const dryRunA = evaluateUnifiedStorageCleanupDryRun([doc60d], [slip45d], configA);
      const summaryA = getStorageUsageSummary([doc60d], [], [slip45d], configA);

      expect(dryRunA.candidates).toHaveLength(1);
      expect(dryRunA.candidates[0].kind).toBe("slip");
      expect(summaryA.cleanupEligibleCount).toBe(1);
      expect(summaryA.cleanupEligibleCount).toBe(dryRunA.candidates.length);

      // Configuration B: slip retention = 30, source document retention = 30
      // Expected: both slip and doc are candidates (45 >= 30, 60 >= 30)
      const configB = {
        slipRetentionDays: 30,
        sourceDocumentRetentionDays: 30,
        failedRetentionDays: 7,
        now,
      };
      const dryRunB = evaluateUnifiedStorageCleanupDryRun([doc60d], [slip45d], configB);
      const summaryB = getStorageUsageSummary([doc60d], [], [slip45d], configB);

      expect(dryRunB.candidates).toHaveLength(2);
      expect(summaryB.cleanupEligibleCount).toBe(2);
      expect(summaryB.cleanupEligibleCount).toBe(dryRunB.candidates.length);

      // Configuration C: slip retention = 90, source document retention = 30
      // Expected: slip is exempt recent (45 < 90), doc is candidate (60 >= 30)
      const configC = {
        slipRetentionDays: 90,
        sourceDocumentRetentionDays: 30,
        failedRetentionDays: 7,
        now,
      };
      const dryRunC = evaluateUnifiedStorageCleanupDryRun([doc60d], [slip45d], configC);
      const summaryC = getStorageUsageSummary([doc60d], [], [slip45d], configC);

      expect(dryRunC.candidates).toHaveLength(1);
      expect(dryRunC.candidates[0].kind).toBe("source_document");
      expect(summaryC.cleanupEligibleCount).toBe(1);
      expect(summaryC.cleanupEligibleCount).toBe(dryRunC.candidates.length);
    });
  });
});
