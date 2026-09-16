import { z } from "zod";

export const sourceProviderSchema = z.enum([
  "gmail",
  "google_drive",
  "bank_statement",
  "api",
  "manual",
]);

export const connectionStatusSchema = z.enum([
  "active",
  "paused",
  "error",
  "revoked",
]);

export const documentTypeSchema = z.enum([
  "email",
  "csv_statement",
  "pdf_statement",
  "statement_image",
  "manual_upload",
  "provider_document",
  "api_response",
]);

export const documentStatusSchema = z.enum([
  "received",
  "processing",
  "processed",
  "failed",
]);

export const batchTypeSchema = z.enum([
  "csv_statement",
  "gmail_sync",
  "drive_sync",
  "manual_import",
]);

export const batchStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const ingestionItemTypeSchema = z.enum([
  "email_notification",
  "statement_row",
  "api_transaction",
]);

export const ingestionStatusSchema = z.enum([
  "pending",
  "matched",
  "linked",
  "dismissed",
  "error",
]);

export const matchClassSchema = z.enum([
  "exact_duplicate",
  "strong_match",
  "possible_match",
  "no_match",
]);

export const evidenceTypeSchema = z.enum([
  "slip",
  "email_notification",
  "statement_row",
  "api_import",
]);

export const reconciliationStatusSchema = z.enum([
  "balanced",
  "difference_found",
  "cannot_calculate_safely",
]);

// Source Connection Schema (browser-visible metadata, NO credentials)
export const sourceConnectionSchema = z.object({
  user_id: z.string().uuid(),
  provider: sourceProviderSchema,
  label: z.string().trim().max(100).optional().nullable(),
  status: connectionStatusSchema.default("active"),
  provider_account_id: z.string().trim().max(255).optional().nullable(),
  last_synced_at: z.string().datetime().optional().nullable(),
  config: z.record(z.unknown()).default({}),
});

// Source Document Schema (with storage/retention tracking)
export const sourceDocumentSchema = z.object({
  user_id: z.string().uuid(),
  connection_id: z.string().uuid().optional().nullable(),
  document_type: documentTypeSchema,
  storage_path: z.string().trim().max(1000).optional().nullable(),
  original_filename: z.string().trim().max(255).optional().nullable(),
  file_hash: z.string().trim().regex(/^[a-f0-9]{64}$/i, "Must be a 64-char SHA-256 hash").optional().nullable(),
  file_size: z.number().int().nonnegative().optional().nullable(),
  stored_file_size: z.number().int().nonnegative().optional().nullable(),
  is_pinned: z.boolean().default(false),
  binary_deleted_at: z.string().datetime().optional().nullable(),
  status: documentStatusSchema.default("received"),
  provider_metadata: z.record(z.unknown()).default({}),
  received_at: z.string().datetime().optional(),
});

// Import Batch Schema
export const importBatchSchema = z.object({
  user_id: z.string().uuid(),
  connection_id: z.string().uuid().optional().nullable(),
  source_document_id: z.string().uuid().optional().nullable(),
  batch_type: batchTypeSchema,
  status: batchStatusSchema.default("pending"),
  total_items: z.number().int().nonnegative().default(0),
  success_count: z.number().int().nonnegative().default(0),
  error_count: z.number().int().nonnegative().default(0),
  duplicate_count: z.number().int().nonnegative().default(0),
  metadata: z.record(z.unknown()).default({}),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional().nullable(),
});

// Ingestion Parsed Data Schema
export const ingestionParsedDataSchema = z.object({
  amount: z.number().int().optional().nullable(), // satang integer
  amount_decimal: z.number().optional().nullable(), // standard THB decimal
  currency: z.string().trim().default("THB").optional().nullable(),
  merchant_name: z.string().trim().max(255).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  occurred_at: z.string().datetime().optional().nullable(),
  account_number: z.string().trim().max(50).optional().nullable(),
  bank_code: z.string().trim().max(20).optional().nullable(),
  transaction_type: z.enum(["income", "expense", "transfer"]).optional().nullable(),
  direction: z.enum(["incoming", "outgoing"]).optional().nullable(),
  reference_number: z.string().trim().max(100).optional().nullable(),
  counterparty_name: z.string().trim().max(255).optional().nullable(),
  counterparty_account: z.string().trim().max(50).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  parse_error: z.string().optional().nullable(),
  rejection_reason: z.string().optional().nullable(),
  raw_metadata: z.record(z.unknown()).optional().nullable(),
});

// Ingestion Item Schema
export const ingestionItemSchema = z.object({
  user_id: z.string().uuid(),
  source_document_id: z.string().uuid(),
  connection_id: z.string().uuid().optional().nullable(),
  batch_id: z.string().uuid().optional().nullable(),
  item_type: ingestionItemTypeSchema,
  status: ingestionStatusSchema.default("pending"),
  raw_data: z.record(z.unknown()).optional().nullable(),
  parsed_data: ingestionParsedDataSchema.optional().nullable(),
  fingerprint: z.string().trim().max(128).optional().nullable(),
  provider_external_id: z.string().trim().max(255).optional().nullable(),
  reference_number: z.string().trim().max(100).optional().nullable(),
  match_class: matchClassSchema.optional().nullable(),
  matched_transaction_id: z.string().uuid().optional().nullable(),
  confidence_score: z.number().min(0).max(1).optional().nullable(),
});

// Transaction Evidence Schema (Decision 1)
// EXACTLY ONE of slip_id or ingestion_item_id must be non-null
export const transactionEvidenceSchema = z
  .object({
    user_id: z.string().uuid(),
    transaction_id: z.string().uuid(),
    slip_id: z.string().uuid().optional().nullable(),
    ingestion_item_id: z.string().uuid().optional().nullable(),
    evidence_type: evidenceTypeSchema,
  })
  .refine(
    (data) => {
      const hasSlip = Boolean(data.slip_id);
      const hasItem = Boolean(data.ingestion_item_id);
      return (hasSlip ? 1 : 0) + (hasItem ? 1 : 0) === 1;
    },
    {
      message:
        "Constraint violation: Exactly one of slip_id or ingestion_item_id must be provided.",
      path: ["slip_id"],
    }
  );

// Reconciliation Run Schema (Decision 4 - Audit Snapshot)
export const reconciliationRunSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid(),
  target_instant: z.string().datetime(),
  authoritative_balance: z.number().int(), // Satang integer
  calculated_balance: z.number().int().optional().nullable(), // Satang integer (null if cannot calculate safely)
  difference: z.number().int().optional().nullable(), // Satang integer: authoritative - calculated
  status: reconciliationStatusSchema,
  source_document_id: z.string().uuid().optional().nullable(),
  calculation_version: z.number().int().positive().default(1),
  note: z.string().trim().max(1000).optional().nullable(),
});

export type SourceConnectionInput = z.input<typeof sourceConnectionSchema>;
export type SourceDocumentInput = z.input<typeof sourceDocumentSchema>;
export type ImportBatchInput = z.input<typeof importBatchSchema>;
export type IngestionItemInput = z.input<typeof ingestionItemSchema>;
export type TransactionEvidenceInput = z.input<typeof transactionEvidenceSchema>;
export type ReconciliationRunInput = z.input<typeof reconciliationRunSchema>;

