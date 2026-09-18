export interface StorageRetentionSettings {
  user_id: string;
  slip_retention_days: number;
  failed_retention_days: number;
  source_document_retention_days: number;
  created_at: string;
  updated_at: string;
}

export type StorageBinaryAction =
  | "prune_requested"
  | "prune_completed"
  | "prune_failed"
  | "pin"
  | "unpin";

export interface StorageBinaryEvent {
  id: string;
  user_id: string;
  slip_id?: string | null;
  source_document_id?: string | null;
  action: StorageBinaryAction;
  storage_path_snapshot?: string | null;
  file_hash_snapshot?: string | null;
  bytes_affected?: number | null;
  reason?: string | null;
  safe_error_message?: string | null;
  created_at: string;
}

export interface StoragePruneResult {
  success: boolean;
  targetId: string;
  targetType: "slip" | "source_document";
  bytesFreed: number;
  error?: string;
}

export interface StorageBulkPruneResult {
  success: boolean;
  totalPruned: number;
  totalBytesFreed: number;
  failedCount: number;
  errors?: string[];
}
