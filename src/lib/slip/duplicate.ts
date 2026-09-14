import { TransactionWithRelations } from "@/types/finance";
import { Slip } from "@/types/slip";

export interface DuplicateCheckParams {
  userId: string;
  fileHash: string;
  currentSlipId?: string;
  referenceNumber?: string | null;
  amount?: number | null;
  transactionDate?: string | null;
  accountId?: string | null;
  direction?: string;
  existingSlips: Slip[];
  existingTransactions: TransactionWithRelations[];
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateType: "none" | "exact_file" | "reference_match" | "fuzzy_match";
  matchedSlipId?: string;
  matchedTransactionId?: string;
  confidence: number;
  reason?: string;
  requiresReview: boolean;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Checks for duplicates across exact file hash, reference number, and fuzzy heuristic matching.
 */
export function detectDuplicate({
  userId,
  fileHash,
  currentSlipId,
  referenceNumber,
  amount,
  transactionDate,
  accountId,
  existingSlips,
  existingTransactions,
}: DuplicateCheckParams): DuplicateCheckResult {
  const candidateSlips = existingSlips.filter(
    (s) =>
      s.user_id === userId &&
      (!currentSlipId || s.id !== currentSlipId) &&
      s.status !== "rejected" &&
      s.status !== "duplicate" &&
      !s.deleted_at
  );

  // 1. Exact File Hash Duplicate
  const exactFileMatch = candidateSlips.find(
    (s) => s.file_hash_sha256 === fileHash
  );

  if (exactFileMatch) {
    return {
      isDuplicate: true,
      duplicateType: "exact_file",
      matchedSlipId: exactFileMatch.id,
      matchedTransactionId: exactFileMatch.linked_transaction_id || undefined,
      confidence: 1.0,
      reason: "สลิปนี้ถูกส่งเข้ามาแล้ว (Exact file hash match)",
      requiresReview: false,
    };
  }

  // 2. Strong Reference Number Duplicate
  if (referenceNumber && referenceNumber.trim().length >= 6) {
    const cleanRef = referenceNumber.trim().toLowerCase();

    // Check existing slips with same reference
    const slipRefMatch = candidateSlips.find((s) => {
      const ref = s.extracted_json?.reference;
      return ref && ref.trim().toLowerCase() === cleanRef;
    });

    if (slipRefMatch) {
      return {
        isDuplicate: true,
        duplicateType: "reference_match",
        matchedSlipId: slipRefMatch.id,
        matchedTransactionId: slipRefMatch.linked_transaction_id || undefined,
        confidence: 1.0,
        reason: `พบสลิปเดิมที่มีรหัสอ้างอิงตรงกัน (${referenceNumber})`,
        requiresReview: false,
      };
    }

    // Check existing transactions with same reference_number
    const txRefMatch = existingTransactions.find(
      (tx) =>
        tx.user_id === userId &&
        tx.reference_number &&
        tx.reference_number.trim().toLowerCase() === cleanRef
    );

    if (txRefMatch) {
      return {
        isDuplicate: true,
        duplicateType: "reference_match",
        matchedTransactionId: txRefMatch.id,
        confidence: 1.0,
        reason: `พบรายการเดิมที่มีรหัสอ้างอิงตรงกัน (${referenceNumber})`,
        requiresReview: false,
      };
    }
  }

  // 3. Conservative Fuzzy Duplicate
  // Criteria: Same amount, same account, close time (within ±5 minutes)
  if (amount && Number.isFinite(amount) && transactionDate && accountId) {
    const targetTime = new Date(transactionDate).getTime();

    if (!isNaN(targetTime)) {
      const fuzzyTxMatch = existingTransactions.find((tx) => {
        if (tx.user_id !== userId) return false;
        if (Math.abs(tx.amount - amount) > 0.001) return false;

        // Must involve the same account
        const involvesAccount =
          tx.from_account_id === accountId || tx.to_account_id === accountId;
        if (!involvesAccount) return false;

        // Check timestamp proximity (+/- 5 min)
        const txTime = new Date(tx.transaction_date).getTime();
        if (isNaN(txTime)) return false;

        return Math.abs(txTime - targetTime) <= FIVE_MINUTES_MS;
      });

      if (fuzzyTxMatch) {
        return {
          isDuplicate: false, // Don't silently discard; route to review
          duplicateType: "fuzzy_match",
          matchedTransactionId: fuzzyTxMatch.id,
          confidence: 0.8,
          reason: `พบรายการที่มีจำนวนเงิน ฿${amount.toLocaleString()} และเวลาใกล้เคียงกัน (อาจเป็นรายการซ้ำ)`,
          requiresReview: true,
        };
      }
    }
  }

  return {
    isDuplicate: false,
    duplicateType: "none",
    confidence: 0,
    requiresReview: false,
  };
}
