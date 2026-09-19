import { describe, it, expect } from "vitest";
import {
  isDocumentRetentionEligible,
  evaluateStorageCleanupDryRun,
  pruneSourceDocumentBinary,
  calculateStorageUsageSummary,
  calculateOptimizedDimensions,
  preserveOriginalHashAcrossOptimization,
} from "@/lib/storage/retention";
import { SourceDocument } from "@/types/multi-source";

describe("Storage Retention & Image Optimization", () => {
  const userId = "user-alice-1111-1111-1111-111111111111";
  const nowStr = "2026-09-16T12:00:00.000Z";
  const now = new Date(nowStr);

  const createDoc = (overrides: Partial<SourceDocument>): SourceDocument => ({
    id: "doc-1",
    user_id: userId,
    document_type: "pdf_statement",
    storage_path: "storage/slips/doc-1.jpg",
    original_filename: "receipt.jpg",
    file_size: 2000000, // 2MB
    stored_file_size: 2000000,
    file_hash: "sha256-original-hash-12345",
    status: "processed",
    is_pinned: false,
    provider_metadata: {},
    received_at: "2026-05-01T00:00:00.000Z", // ~138 days ago
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  });

  describe("Scenario 1: Cleanup candidate rules (unpinned older than 90d eligible, younger not)", () => {
    it("marks unpinned documents older than 90 days as eligible for binary cleanup", () => {
      // 100 days old
      const oldDoc = createDoc({
        received_at: "2026-06-08T00:00:00.000Z",
        is_pinned: false,
      });

      const { eligible, ageDays, reason } = isDocumentRetentionEligible(oldDoc, {
        now,
        retentionDays: 90,
      });

      expect(eligible).toBe(true);
      expect(ageDays).toBeGreaterThan(90);
      expect(reason).toContain("Exceeded retention threshold");
    });

    it("does NOT mark documents younger than 90 days as eligible for binary cleanup", () => {
      // 30 days old
      const recentDoc = createDoc({
        received_at: "2026-08-17T00:00:00.000Z",
        is_pinned: false,
      });

      const { eligible, ageDays, reason } = isDocumentRetentionEligible(recentDoc, {
        now,
        retentionDays: 90,
      });

      expect(eligible).toBe(false);
      expect(ageDays).toBeLessThan(90);
      expect(reason).toContain("Within retention window");
    });
  });

  describe("Scenario 2: Confirmed evidence retained by default", () => {
    it("retains confirmed evidence files as long as they are within the retention window", () => {
      const doc = createDoc({
        received_at: "2026-08-01T00:00:00.000Z", // ~46 days old
        is_pinned: false,
      });

      const dryRun = evaluateStorageCleanupDryRun([doc], { now, retentionDays: 90 });
      expect(dryRun.candidates).toHaveLength(0);
      expect(dryRun.exemptRecentCount).toBe(1);
      expect(dryRun.bytesRecoverable).toBe(0);
    });
  });

  describe("Scenario 3: Pinned evidence never cleanup candidate", () => {
    it("never cleans up pinned documents, even if years old", () => {
      const ancientPinnedDoc = createDoc({
        id: "pinned-ancient-doc",
        received_at: "2020-01-01T00:00:00.000Z", // >6 years old!
        is_pinned: true,
      });

      const { eligible, reason } = isDocumentRetentionEligible(ancientPinnedDoc, {
        now,
        retentionDays: 90,
      });

      expect(eligible).toBe(false);
      expect(reason).toContain("is pinned by user");

      const dryRun = evaluateStorageCleanupDryRun([ancientPinnedDoc], { now, retentionDays: 90 });
      expect(dryRun.candidates).toHaveLength(0);
      expect(dryRun.exemptPinnedCount).toBe(1);
      expect(dryRun.bytesRecoverable).toBe(0);
    });
  });

  describe("Scenario 4: Binary deletion preserves DB metadata & evidence records", () => {
    it("prunes binary pointer and records timestamp while preserving filename, hash, and metadata", () => {
      const original = createDoc({
        id: "doc-prune-target",
        storage_path: "storage/slips/doc-prune.jpg",
        original_filename: "receipt_2026_05.jpg",
        file_hash: "sha256-original-hash-preserved",
        file_size: 3500000,
        stored_file_size: 1200000,
      });

      const pruned = pruneSourceDocumentBinary(original, nowStr);

      // Binary reference removed & timestamp set
      expect(pruned.storage_path).toBeNull();
      expect(pruned.binary_deleted_at).toBe(nowStr);
      expect(pruned.stored_file_size).toBe(0);

      // DB metadata remains strictly intact!
      expect(pruned.id).toBe(original.id);
      expect(pruned.original_filename).toBe("receipt_2026_05.jpg");
      expect(pruned.file_hash).toBe("sha256-original-hash-preserved");
      expect(pruned.file_size).toBe(3500000); // Historical original size preserved for reporting

      // Second check: already pruned document is not eligible for further cleanup
      const check = isDocumentRetentionEligible(pruned, { now, retentionDays: 90 });
      expect(check.eligible).toBe(false);
      expect(check.reason).toContain("actually pruned");
    });
  });

  describe("Scenario 5: Original hash survives optimization", () => {
    it("preserves original cryptographic hash across optimization steps", () => {
      const originalHash = "hash-original-uncompressed-slip";
      const optimizedHash = "hash-new-downscaled-webp";

      const meta = preserveOriginalHashAcrossOptimization(originalHash, optimizedHash);
      expect(meta.canonicalHash).toBe(originalHash);
      expect(meta.optimizedHash).toBe(optimizedHash);
      expect(meta.hashPreserved).toBe(true);
    });
  });

  describe("Scenario 6: No image upscaling", () => {
    it("does not upscale images smaller than the maximum target dimension", () => {
      // 800x600 image with max bounds of 1920x1080
      const res = calculateOptimizedDimensions(800, 600, 1920, 1080);
      expect(res.width).toBe(800);
      expect(res.height).toBe(600);
      expect(res.wasScaled).toBe(false);
    });

    it("downscales images larger than the maximum target dimension while maintaining aspect ratio", () => {
      // 4000x3000 image with max bounds of 1920x1080
      const res = calculateOptimizedDimensions(4000, 3000, 1920, 1080);
      // Limited by height: 1080 / 3000 = 0.36 -> width = 4000 * 0.36 = 1440
      expect(res.width).toBe(1440);
      expect(res.height).toBe(1080);
      expect(res.wasScaled).toBe(true);
    });
  });

  describe("Scenario 7: Storage usage summary calculation", () => {
    it("accurately calculates total bytes, stored bytes, savings, and categories", () => {
      const doc1 = createDoc({
        file_size: 2000000,
        stored_file_size: 800000, // Optimized
        is_pinned: false,
        received_at: "2026-05-01T00:00:00.000Z", // Eligible
      });
      const doc2 = createDoc({
        file_size: 1500000,
        stored_file_size: 1500000,
        is_pinned: true, // Pinned
        received_at: "2026-05-01T00:00:00.000Z",
      });
      const doc3 = createDoc({
        file_size: 3000000,
        stored_file_size: 0,
        binary_deleted_at: "2026-08-01T00:00:00.000Z", // Already pruned
      });

      const summary = calculateStorageUsageSummary([doc1, doc2, doc3]);

      expect(summary.totalDocuments).toBe(3);
      expect(summary.totalOriginalBytes).toBe(6500000);
      expect(summary.totalStoredBytes).toBe(2300000);
      expect(summary.bytesSavedByOptimization).toBe(1200000);
      expect(summary.pinnedCount).toBe(1);
      expect(summary.cleanupEligibleCount).toBe(1);
      expect(summary.binariesDeletedCount).toBe(1);
    });
  });

  describe("Scenario 24: Failed/duplicate storage cleanup candidate", () => {
    it("marks failed temporary documents older than 7 days as eligible for cleanup", () => {
      const failedDoc = createDoc({
        id: "doc-failed-temp",
        status: "failed",
        is_pinned: false,
        received_at: "2026-09-05T00:00:00.000Z", // 11 days old (> 7 days)
      });

      const { eligible, reason } = isDocumentRetentionEligible(failedDoc, {
        now,
        failedRetentionDays: 7,
      });

      expect(eligible).toBe(true);
      expect(reason).toContain("Failed or duplicate document exceeded cleanup threshold");
    });
  });
});
