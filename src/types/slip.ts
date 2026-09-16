export type SlipSource = "web_upload" | "ios_shortcut" | "manual";

export type SlipStatus =
  | "uploaded"
  | "processing"
  | "needs_review"
  | "created"
  | "duplicate"
  | "failed"
  | "rejected";

export type JobStatus =
  | "processing"
  | "created"
  | "needs_review"
  | "duplicate"
  | "failed";

export type Direction = "outgoing" | "incoming" | "internal_transfer" | "unknown";

export interface IngestToken {
  id: string;
  user_id: string;
  token_hash: string;
  token_prefix: string;
  label: string;
  scope: string; // 'slip:ingest'
  created_at: string;
  last_used_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SlipParty {
  name?: string | null;
  bank?: string | null;
  accountMasked?: string | null;
}

export interface FieldConfidence {
  amount?: number;
  transactionDate?: number;
  senderName?: number;
  senderBank?: number;
  senderAccount?: number;
  receiverName?: number;
  receiverBank?: number;
  receiverAccount?: number;
  reference?: number;
}

export interface SlipExtraction {
  amount?: number;
  currency?: "THB";
  transactionDate?: string; // ISO 8601 string
  sender?: SlipParty;
  receiver?: SlipParty;
  reference?: string;
  channel?: string;
  qrPayload?: string;
  fieldConfidence: FieldConfidence;
}

export interface Slip {
  id: string;
  user_id: string;
  storage_path: string;
  file_hash_sha256: string;
  mime_type: string;
  file_size: number;
  source: SlipSource;
  parser_version: string;
  qr_payload?: string | null;
  extracted_json?: SlipExtraction | null;
  raw_ocr_text?: string | null;
  overall_confidence?: number | null;
  status: SlipStatus;
  linked_transaction_id?: string | null;
  duplicate_of_slip_id?: string | null;
  created_at: string;
  processed_at?: string | null;
  deleted_at?: string | null;
}

export interface SlipIngestionJob {
  id: string;
  user_id: string;
  slip_id: string;
  status: JobStatus;
  attempt_count: number;
  processor_version: string;
  error_code?: string | null;
  safe_error_message?: string | null;
  started_at: string;
  finished_at?: string | null;
  created_at: string;
}

export interface SlipCorrection {
  id: string;
  user_id: string;
  slip_id: string;
  field_name: string;
  extracted_value?: unknown;
  corrected_value?: unknown;
  created_at: string;
}

export type AccountMatchMethod =
  | "verified_alias"
  | "positional_mask"
  | "weak_pattern_match"
  | "masked_suffix"
  | "name_alias"
  | "bank_only"
  | "ambiguous"
  | "no_match";

export interface AccountMatchCandidate {
  id: string;
  name: string;
}

export interface AccountMatchResult {
  accountId: string | null;
  accountName?: string;
  confidence: number;
  reason: string;
  matchMethod?: AccountMatchMethod;
  sharedDigits?: number;
  ambiguousCandidates?: AccountMatchCandidate[];
}

export interface AccountMatchAlias {
  id: string;
  user_id: string;
  account_id: string;
  institution?: string | null;
  raw_masked_pattern?: string | null;
  normalized_masked_pattern: string;
  source: string;
  confirmed_count: number;
  created_at: string;
  updated_at: string;
}

export interface MatchedAccountSummary {
  id?: string;
  name?: string;
  institution?: string | null;
}

export interface SlipProcessingResult {
  jobId: string;
  slipId: string;
  status: "created" | "needs_review" | "duplicate" | "failed";
  amount?: number;
  currency: "THB";
  reviewUrl?: string;
  transactionId?: string;
  duplicateOfSlipId?: string;
  errorCode?: string;
  errorMessage?: string;
  warningMessage?: string;
  preservedPrevious?: boolean;
  completenessScore?: number;
  extracted?: SlipExtraction;
  overallConfidence?: number;
  direction?: Direction;
  matchedFromAccountId?: string | null;
  matchedToAccountId?: string | null;
  matchedAccountInfo?: MatchedAccountSummary;
}

export interface IngestApiResponse {
  jobId: string;
  status: "created" | "needs_review" | "duplicate" | "processing" | "failed";
  amount?: number;
  currency: "THB";
  reviewUrl?: string;
  transactionId?: string;
  direction?: Direction;
  matchedAccount?: MatchedAccountSummary;
  warning?: string;
  error?: string;
  reason?: string;
}

