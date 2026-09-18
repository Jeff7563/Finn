import { SourceDocument, IngestionItem } from "@/types/multi-source";
import { Slip } from "@/types/slip";

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
  retentionDays?: number; // legacy fallback / general retention
  slipRetentionDays?: number; // explicit slip retention days (default 90)
  sourceDocumentRetentionDays?: number; // explicit source document retention days (default 90)
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

export interface SlipCleanupCandidate {
  slipId: string;
  originalFilename: string | null;
  fileHash: string | null;
  fileSize: number;
  storedFileSize: number;
  ageDays: number;
  createdAt: string;
  status: string;
}

export interface UnifiedCleanupCandidate {
  id: string;
  kind: "slip" | "source_document";
  originalFilename: string | null;
  fileHash: string | null;
  fileSize: number;
  storedFileSize: number;
  ageDays: number;
  createdAt: string;
  status?: string;
  isPinned: boolean;
}

export interface StorageCleanupDryRunResult {
  candidates: StorageCleanupCandidate[];
  exemptPinnedCount: number;
  exemptRecentCount: number;
  alreadyPrunedCount: number;
  totalDocuments: number;
  bytesRecoverable: number;
}

export interface UnifiedCleanupDryRunResult {
  candidates: UnifiedCleanupCandidate[];
  exemptPinnedCount: number;
  exemptRecentCount: number;
  exemptUnresolvedCount: number;
  /** @deprecated Use actuallyPrunedCount instead. Kept for backward compat = actuallyPrunedCount */
  alreadyPrunedCount: number;
  /** Documents/slips whose binary was actually deleted (binary_deleted_at IS NOT NULL) */
  actuallyPrunedCount: number;
  /** Documents that never had a stored binary (e.g. CSV imports, metadata-only). NOT cleanup candidates. */
  metadataOnlyCount: number;
  totalItems: number;
  bytesRecoverable: number;
  slipCandidatesCount: number;
  sourceDocumentCandidatesCount: number;
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
  const retentionDays =
    options.sourceDocumentRetentionDays ??
    options.retentionDays ??
    DEFAULT_RETENTION_DAYS;

  // Rule 1: Pinned behavior - NEVER clean up pinned documents
  if (doc.is_pinned) {
    return {
      eligible: false,
      reason: "Pinned document: is pinned by user, protected from retention deletion",
      ageDays: 0,
    };
  }

  // Rule 2a: Actually pruned — binary was explicitly deleted
  if (doc.binary_deleted_at) {
    return {
      eligible: false,
      reason: "Binary already deleted (actually pruned)",
      ageDays: 0,
    };
  }

  // Rule 2b: Metadata-only — never had a stored binary (e.g. CSV import)
  if (!doc.storage_path && !doc.stored_file_size) {
    return {
      eligible: false,
      reason: "No binary stored (metadata-only document)",
      ageDays: 0,
    };
  }

  // Rule 3: Unresolved review status - protect received / processing inbox documents
  if (doc.status === "received" || doc.status === "processing") {
    return {
      eligible: false,
      reason: `Source document is in unresolved status (${doc.status}), protected from cleanup`,
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
 * Checks if a slip is eligible for binary retention cleanup.
 *
 * Rules:
 * 1. Pinned slips are NEVER cleanup candidates (pinned behavior).
 * 2. Slips whose binary has already been pruned are skipped.
 * 3. Unresolved slips (uploaded, processing, needs_review) are NOT eligible.
 * 4. Slips must be older than the retention threshold.
 *    - Failed or rejected slips: failedRetentionDays (default 7)
 *    - Confirmed/created/duplicate slips: retentionDays (default 90)
 */
export function isSlipRetentionEligible(
  slip: Slip,
  options: StorageCleanupOptions = {}
): { eligible: boolean; reason: string; ageDays: number } {
  const now = options.now ? new Date(options.now) : new Date();
  const retentionDays =
    options.slipRetentionDays ??
    options.retentionDays ??
    DEFAULT_RETENTION_DAYS;

  // Rule 1: Pinned behavior - NEVER clean up pinned slips
  if (slip.is_pinned) {
    return {
      eligible: false,
      reason: "Pinned slip: is pinned by user, protected from retention deletion",
      ageDays: 0,
    };
  }

  // Rule 2a: Actually pruned — binary was explicitly deleted
  if (slip.binary_deleted_at) {
    return {
      eligible: false,
      reason: "Binary already deleted (actually pruned)",
      ageDays: 0,
    };
  }

  // Rule 2b: Metadata-only — never had a stored binary
  if (!slip.storage_path && !slip.stored_file_size) {
    return {
      eligible: false,
      reason: "No binary stored (metadata-only)",
      ageDays: 0,
    };
  }

  // Rule 3: Unresolved review status - protect active inbox items
  const unresolvedStatuses = ["uploaded", "processing", "needs_review"];
  if (unresolvedStatuses.includes(slip.status)) {
    return {
      eligible: false,
      reason: `Slip is in unresolved review status (${slip.status}), protected from cleanup`,
      ageDays: 0,
    };
  }

  const dateStr = slip.created_at || slip.processed_at;
  const slipDate = dateStr ? new Date(dateStr) : null;
  if (!slipDate || isNaN(slipDate.getTime())) {
    return {
      eligible: false,
      reason: "Invalid slip timestamp",
      ageDays: 0,
    };
  }

  const ageMs = now.getTime() - slipDate.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  const isFailedOrRejected = slip.status === "failed" || slip.status === "rejected";
  const thresholdDays = isFailedOrRejected ? (options.failedRetentionDays ?? 7) : retentionDays;

  if (ageDays < thresholdDays) {
    return {
      eligible: false,
      reason: `Within retention window (${ageDays}/${thresholdDays} days)`,
      ageDays,
    };
  }

  return {
    eligible: true,
    reason: isFailedOrRejected
      ? `Failed or rejected slip exceeded cleanup threshold (${ageDays} >= ${thresholdDays} days)`
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
    if (doc.binary_deleted_at) {
      alreadyPrunedCount++;
      continue;
    }
    if (!doc.storage_path && !doc.stored_file_size) {
      // metadata-only document — not counted as pruned
      continue;
    }

    if (doc.is_pinned) {
      exemptPinnedCount++;
      continue;
    }

    if (doc.status === "received" || doc.status === "processing") {
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
 * Evaluates cleanup candidates across both source documents and slips.
 * Returns candidate items, recoverable bytes, and exemption breakdowns.
 */
export function evaluateUnifiedStorageCleanupDryRun(
  documents: SourceDocument[],
  slips: Slip[] = [],
  options: StorageCleanupOptions = {}
): UnifiedCleanupDryRunResult {
  const candidates: UnifiedCleanupCandidate[] = [];
  let exemptPinnedCount = 0;
  let exemptRecentCount = 0;
  let exemptUnresolvedCount = 0;
  let actuallyPrunedCount = 0;
  let metadataOnlyCount = 0;
  let bytesRecoverable = 0;
  let slipCandidatesCount = 0;
  let sourceDocumentCandidatesCount = 0;

  for (const doc of documents) {
    // Actually pruned: binary_deleted_at IS NOT NULL
    if (doc.binary_deleted_at) {
      actuallyPrunedCount++;
      continue;
    }

    // Metadata-only: never had a stored binary (e.g. CSV import)
    if (!doc.storage_path && !doc.stored_file_size) {
      metadataOnlyCount++;
      continue;
    }

    if (doc.is_pinned) {
      exemptPinnedCount++;
      continue;
    }

    if (doc.status === "received" || doc.status === "processing") {
      exemptUnresolvedCount++;
      continue;
    }

    const { eligible, ageDays } = isDocumentRetentionEligible(doc, options);
    if (eligible) {
      const activeSize = doc.stored_file_size || doc.file_size || 0;
      candidates.push({
        id: doc.id,
        kind: "source_document",
        originalFilename: doc.original_filename ?? null,
        fileHash: doc.file_hash ?? null,
        fileSize: doc.file_size || 0,
        storedFileSize: activeSize,
        ageDays,
        createdAt: doc.received_at || doc.created_at,
        status: doc.status,
        isPinned: false,
      });
      sourceDocumentCandidatesCount++;
      bytesRecoverable += activeSize;
    } else {
      exemptRecentCount++;
    }
  }

  for (const slip of slips) {
    // Actually pruned: binary_deleted_at IS NOT NULL
    if (slip.binary_deleted_at) {
      actuallyPrunedCount++;
      continue;
    }

    // Metadata-only: never had a stored binary
    if (!slip.storage_path && !slip.stored_file_size) {
      metadataOnlyCount++;
      continue;
    }

    if (slip.is_pinned) {
      exemptPinnedCount++;
      continue;
    }

    const unresolvedStatuses = ["uploaded", "processing", "needs_review"];
    if (unresolvedStatuses.includes(slip.status)) {
      exemptUnresolvedCount++;
      continue;
    }

    const { eligible, ageDays } = isSlipRetentionEligible(slip, options);
    if (eligible) {
      const activeSize = slip.stored_file_size ?? slip.file_size ?? 0;
      candidates.push({
        id: slip.id,
        kind: "slip",
        originalFilename: null,
        fileHash: slip.file_hash_sha256,
        fileSize: slip.file_size,
        storedFileSize: activeSize,
        ageDays,
        createdAt: slip.created_at,
        status: slip.status,
        isPinned: false,
      });
      slipCandidatesCount++;
      bytesRecoverable += activeSize;
    } else {
      exemptRecentCount++;
    }
  }

  return {
    candidates,
    exemptPinnedCount,
    exemptRecentCount,
    exemptUnresolvedCount,
    alreadyPrunedCount: actuallyPrunedCount, // backward compat
    actuallyPrunedCount,
    metadataOnlyCount,
    totalItems: documents.length + slips.length,
    bytesRecoverable,
    slipCandidatesCount,
    sourceDocumentCandidatesCount,
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
 * Prunes the storage binary for a slip while preserving all metadata in the DB.
 *
 * Integrity Guarantee:
 * - `id, user_id, file_hash_sha256, file_size, extracted_json, raw_ocr_text, linked_transaction_id`
 *   remain completely intact.
 * - Deduplication indexes and linked transactions continue to reference this slip.
 */
export function deleteSlipBinary(
  slip: Slip,
  deletedAt: string = new Date().toISOString()
): Slip {
  return {
    ...slip,
    storage_path: null,
    stored_file_size: 0,
    binary_deleted_at: deletedAt,
  };
}

export const pruneSlipBinary = deleteSlipBinary;

/**
 * Summarizes storage usage, compression savings, and retention metrics across
 * source documents and slips.
 */
export function getStorageUsageSummary(
  documents: SourceDocument[],
  ingestionItems: IngestionItem[] = [],
  slips: Slip[] = []
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

  for (const slip of slips) {
    const origSize = slip.file_size || 0;
    totalOriginalBytes += origSize;

    if (slip.status === "failed" || slip.status === "rejected") {
      failedOrRejectedCount++;
    }
    if (slip.status === "duplicate") {
      duplicateCount++;
    }

    if (slip.binary_deleted_at) {
      binariesDeletedCount++;
    } else {
      const stored =
        slip.stored_file_size !== null && slip.stored_file_size !== undefined
          ? slip.stored_file_size
          : origSize;
      totalStoredBytes += stored;
      bytesSavedByOptimization += Math.max(0, origSize - stored);
    }

    if (slip.is_pinned) {
      pinnedCount++;
    } else if (!slip.binary_deleted_at && isSlipRetentionEligible(slip).eligible) {
      cleanupEligibleCount++;
    }
  }

  return {
    totalDocuments: documents.length + slips.length,
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
