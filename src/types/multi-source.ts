import { Transaction } from "./finance";

// ============================================================================
// 1. Source Connections (Browser-visible metadata only)
// ============================================================================
export type SourceProvider = "gmail" | "google_drive" | "bank_statement" | "api" | "manual";
export type ConnectionStatus = "active" | "paused" | "error" | "revoked";

export interface SourceConnection {
  id: string;
  user_id: string;
  provider: SourceProvider;
  label?: string | null;
  status: ConnectionStatus;
  provider_account_id?: string | null;
  last_synced_at?: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 2. Source Documents & Storage Retention
// ============================================================================
export type DocumentType =
  | "email"
  | "csv_statement"
  | "pdf_statement"
  | "api_response";
export type DocumentStatus = "received" | "processing" | "processed" | "failed";

export interface SourceDocument {
  id: string;
  user_id: string;
  connection_id?: string | null;
  document_type: DocumentType;
  storage_path?: string | null;
  original_filename?: string | null;
  file_hash?: string | null; // SHA-256
  file_size?: number | null; // original file size in bytes
  stored_file_size?: number | null; // stored/compressed file size in bytes
  is_pinned?: boolean; // pinned items are protected from retention deletion
  binary_deleted_at?: string | null; // set when binary pruned while preserving metadata
  status: DocumentStatus;
  provider_metadata: Record<string, unknown>;
  received_at: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 3. Import Batches
// ============================================================================
export type BatchType =
  | "csv_statement"
  | "gmail_sync"
  | "drive_sync"
  | "manual_import";

export type BatchStatus = "pending" | "processing" | "completed" | "failed";

export interface ImportBatch {
  id: string;
  user_id: string;
  connection_id?: string | null;
  source_document_id?: string | null;
  batch_type: BatchType;
  status: BatchStatus;
  total_items: number;
  success_count: number;
  error_count: number;
  duplicate_count: number;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 4. Ingestion Items & Deduplication
// ============================================================================
export type IngestionItemType =
  | "email_notification"
  | "statement_row"
  | "api_transaction";

export type IngestionStatus =
  | "pending"
  | "matched"
  | "linked"
  | "dismissed"
  | "error";

export type MatchClass =
  | "exact_duplicate"
  | "strong_match"
  | "possible_match"
  | "no_match";

export interface IngestionParsedData {
  amount: number | null; // in satang (integer)
  amount_decimal?: number | null; // in standard THB unit (e.g. 150.50)
  currency?: string | null;
  merchant_name?: string | null;
  description?: string | null;
  occurred_at?: string | null; // ISO 8601 string
  account_number?: string | null; // masked or last 4 digits
  bank_code?: string | null; // e.g. KBANK, SCB, BBL
  transaction_type?: "income" | "expense" | "transfer" | null;
  direction?: "incoming" | "outgoing" | null;
  reference_number?: string | null;
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  note?: string | null;
  raw_metadata?: Record<string, unknown> | null;
}

export interface IngestionItem {
  id: string;
  user_id: string;
  source_document_id: string;
  connection_id?: string | null;
  batch_id?: string | null;
  item_type: IngestionItemType;
  status: IngestionStatus;
  raw_data?: Record<string, unknown> | null;
  parsed_data?: IngestionParsedData | null;
  fingerprint?: string | null;
  provider_external_id?: string | null;
  reference_number?: string | null;
  match_class?: MatchClass | null;
  matched_transaction_id?: string | null;
  confidence_score?: number | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 4. Transaction Evidence Bridge
// ============================================================================
export type EvidenceType =
  | "slip"
  | "email_notification"
  | "statement_row"
  | "api_import";

export interface TransactionEvidence {
  id: string;
  user_id: string;
  transaction_id: string;
  slip_id?: string | null;
  ingestion_item_id?: string | null;
  evidence_type: EvidenceType;
  created_at: string;
}

// ============================================================================
// 5. Reconciliation Runs (Audit Snapshots)
// ============================================================================
export type ReconciliationStatus =
  | "balanced"
  | "difference_found"
  | "cannot_calculate_safely";

export interface ReconciliationRun {
  id: string;
  user_id: string;
  account_id: string;
  target_instant: string; // ISO 8601 string
  authoritative_balance: number; // in satang (integer)
  calculated_balance: number | null; // in satang (integer) or null if cannot calculate safely
  difference: number | null; // authoritative_balance - calculated_balance
  status: ReconciliationStatus;
  source_document_id?: string | null;
  calculation_version: number;
  note?: string | null;
  created_at: string;
}

// ============================================================================
// 6. Deduplication Engine Results & Inbox
// ============================================================================
export interface MatchCandidate {
  transaction_id: string;
  confidence: number;
  reasons: string[];
}

export interface MatchResult {
  matchClass: MatchClass;
  confidence: number;
  matchedTransactionId?: string | null;
  reasons: string[];
  candidates?: MatchCandidate[];
}

export interface ScopedReference {
  institution?: string | null;
  account?: string | null;
  direction?: string | null;
  reference: string;
}

export interface InboxItem {
  ingestion_item: IngestionItem;
  source_document: SourceDocument;
  connection?: SourceConnection | null;
  possible_matches: Array<{
    transaction: Transaction;
    confidence: number;
    reasons: string[];
  }>;
}
