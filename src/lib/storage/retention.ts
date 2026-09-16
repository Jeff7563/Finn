import { SourceDocument, IngestionItem } from "@/types/multi-source";

/**
 * ARCHITECTURAL NOTICE — STORAGE RETENTION & IMAGE OPTIMIZATION:
 *
 * Active binary image transcoding, resizing, and compression (e.g., sharp/canvas pipelines)
 * are DEFERRED ARCHITECTURE for future phases.
 *
 * Current Phase 3 implementation provides:
 * 1. Storage retention rules, age calculations, and non-destructive binary pruning.
 * 2. Dimension constraints and policy specification (no upscaling, max dimension ratios).
 * 3. Contractual SHA-256 cryptographic hash preservation.
 *
 * Binary resizing is NOT executed in-flight at this stage.
 */

export interface StorageCleanupOptions {
  retentionDays?: number; // default 90 days
  failedRetentionDays?: number; // default 7 days for failed/duplicate files
  now?: Date | string;
}

export interface StorageCleanupCandidate {
  documentId: string;
  originalFilename: string | null;
  fileHash: string | null;
  fileSize: number;
  storedFileSize: number;
  ageDays: number;
  receivedAt: string;
}

export interface StorageCleanupDryRunResult {
  candidates: StorageCleanupCandidate[];
  exemptPinnedCount: number;
  exemptRecentCount: number;
  alreadyPrunedCount: number;
  totalDocuments: number;
  bytesRecoverable: number;
}

export interface StorageUsageSummary {
  totalDocuments: number;
  totalOriginalBytes: number;
  totalStoredBytes: number;
  bytesSavedByOptimization: number;
  pinnedCount: number;
  cleanupEligibleCount: number;
  binariesDeletedCount: number;
  duplicateCount: number;
  failedOrRejectedCount: number;
}

export interface OptimizedDimensions {
  width: number;
  height: number;
  wasScaled: boolean;
}

const DEFAULT_RETENTION_DAYS = 90;

/**
 * Checks if a source document is eligible for binary retention cleanup.
 *
 * Rules:
 * 1. Pinned documents are NEVER cleanup candidates (pinned behavior).
 * 2. Documents whose binary has already been pruned are skipped.
 * 3. Documents must be older than the retention threshold (e.g. 90 days).
 * 4. Confirmed evidence is retained by default unless older than retention threshold and unpinned.
 */
export function isDocumentRetentionEligible(
  doc: SourceDocument,
  options: StorageCleanupOptions = {}
): { eligible: boolean; reason: string; ageDays: number } {
  const now = options.now ? new Date(options.now) : new Date();
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;

  // Rule 1: Pinned behavior - NEVER clean up pinned documents
  if (doc.is_pinned) {
    return {
      eligible: false,
      reason: "Pinned document: is pinned by user, protected from retention deletion",
      ageDays: 0,
    };
  }

  // Rule 2: Already pruned
  if (doc.binary_deleted_at || !doc.storage_path) {
    return {
      eligible: false,
      reason: "Binary already deleted (already pruned)",
      ageDays: 0,
    };
  }

  const docDate = new Date(doc.received_at || doc.created_at);
  if (isNaN(docDate.getTime())) {
    return {
      eligible: false,
      reason: "Invalid document timestamp",
      ageDays: 0,
    };
  }

  const ageMs = now.getTime() - docDate.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  const isFailedOrDuplicate = doc.status === "failed";
  const thresholdDays = isFailedOrDuplicate ? (options.failedRetentionDays ?? 7) : retentionDays;

  if (ageDays < thresholdDays) {
    return {
      eligible: false,
      reason: `Within retention window (${ageDays}/${thresholdDays} days)`,
      ageDays,
    };
  }

  return {
    eligible: true,
    reason: isFailedOrDuplicate
      ? `Failed or duplicate document exceeded cleanup threshold (${ageDays} >= ${thresholdDays} days)`
      : `Exceeded retention threshold (${ageDays} >= ${retentionDays} days) and not pinned`,
    ageDays,
  };
}

/**
 * Performs a dry-run evaluation of storage cleanup across a user's documents.
 * Returns candidate documents, recoverable bytes, and exemption breakdowns.
 */
export function evaluateStorageCleanupDryRun(
  documents: SourceDocument[],
  options: StorageCleanupOptions = {}
): StorageCleanupDryRunResult {
  const candidates: StorageCleanupCandidate[] = [];
  let exemptPinnedCount = 0;
  let exemptRecentCount = 0;
  let alreadyPrunedCount = 0;
  let bytesRecoverable = 0;

  for (const doc of documents) {
    if (doc.binary_deleted_at || !doc.storage_path) {
      alreadyPrunedCount++;
      continue;
    }

    if (doc.is_pinned) {
      exemptPinnedCount++;
      continue;
    }

    const { eligible, ageDays } = isDocumentRetentionEligible(doc, options);
    if (eligible) {
      const activeSize = doc.stored_file_size || doc.file_size || 0;
      candidates.push({
        documentId: doc.id,
        originalFilename: doc.original_filename ?? null,
        fileHash: doc.file_hash ?? null,
        fileSize: doc.file_size || 0,
        storedFileSize: activeSize,
        ageDays,
        receivedAt: doc.received_at,
      });
      bytesRecoverable += activeSize;
    } else {
      exemptRecentCount++;
    }
  }

  return {
    candidates,
    exemptPinnedCount,
    exemptRecentCount,
    alreadyPrunedCount,
    totalDocuments: documents.length,
    bytesRecoverable,
  };
}

/**
 * Prunes the storage binary for a document while preserving all metadata in the DB.
 *
 * Integrity Guarantee:
 * - `id, user_id, document_type, original_filename, file_hash, file_size, provider_metadata`
 *   remain completely intact.
 * - Deduplication indexes, audit snapshots, and linked transaction_evidence continue
 *   to reference this document without interruption.
 */
export function deleteSourceDocumentBinary(
  doc: SourceDocument,
  deletedAt: string = new Date().toISOString()
): SourceDocument {
  return {
    ...doc,
    storage_path: null, // Binary removed from storage
    stored_file_size: 0,
    binary_deleted_at: deletedAt,
    updated_at: deletedAt,
  };
}

/**
 * Summarizes storage usage, compression savings, and retention metrics.
 */
export function getStorageUsageSummary(
  documents: SourceDocument[],
  ingestionItems: IngestionItem[] = []
): StorageUsageSummary {
  let totalOriginalBytes = 0;
  let totalStoredBytes = 0;
  let pinnedCount = 0;
  let cleanupEligibleCount = 0;
  let binariesDeletedCount = 0;
  let duplicateCount = 0;
  let failedOrRejectedCount = 0;
  let bytesSavedByOptimization = 0;

  for (const doc of documents) {
    const origSize = doc.file_size || 0;
    totalOriginalBytes += origSize;

    if (doc.status === "failed") {
      failedOrRejectedCount++;
    }

    if (doc.binary_deleted_at) {
      binariesDeletedCount++;
    } else {
      const stored =
        doc.stored_file_size !== null && doc.stored_file_size !== undefined
          ? doc.stored_file_size
          : origSize;
      totalStoredBytes += stored;
      bytesSavedByOptimization += Math.max(0, origSize - stored);
    }

    if (doc.is_pinned) {
      pinnedCount++;
    } else if (!doc.binary_deleted_at && isDocumentRetentionEligible(doc).eligible) {
      cleanupEligibleCount++;
    }
  }

  for (const item of ingestionItems) {
    if (item.match_class === "exact_duplicate") {
      duplicateCount++;
    }
    if (item.status === "error") {
      failedOrRejectedCount++;
    }
  }

  return {
    totalDocuments: documents.length,
    totalOriginalBytes,
    totalStoredBytes,
    bytesSavedByOptimization,
    pinnedCount,
    cleanupEligibleCount,
    binariesDeletedCount,
    duplicateCount,
    failedOrRejectedCount,
  };
}

/**
 * Calculates optimized dimensions for an image without upscaling.
 *
 * Principle: NO IMAGE UPSCALING.
 * If the original image is already smaller than the max bounds, dimensions
 * are preserved exactly to avoid inflating storage or degrading quality.
 */
export function calculateOptimizedDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth = 1600,
  maxHeight = 1600
): OptimizedDimensions {
  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new Error("Invalid image dimensions: width and height must be positive");
  }

  // If already within target bounds, never upscale!
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return {
      width: originalWidth,
      height: originalHeight,
      wasScaled: false,
    };
  }

  const widthRatio = maxWidth / originalWidth;
  const heightRatio = maxHeight / originalHeight;
  const scale = Math.min(widthRatio, heightRatio);

  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale),
    wasScaled: true,
  };
}

export const pruneSourceDocumentBinary = deleteSourceDocumentBinary;
export const calculateStorageUsageSummary = getStorageUsageSummary;

/**
 * Preserves the original file SHA-256 hash across image optimization.
 */
export function preserveOriginalHashAcrossOptimization(
  originalHash: string,
  optimizedHash: string
): { canonicalHash: string; optimizedHash: string; hashPreserved: boolean } {
  return {
    canonicalHash: originalHash,
    optimizedHash,
    hashPreserved: true,
  };
}
