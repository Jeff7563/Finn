import { Direction } from "@/types/slip";
import { TransactionType } from "@/types/finance";

export interface DirectionClassification {
  direction: Direction;
  suggestedType: TransactionType;
  requiresReview: boolean;
  reason: string;
}

/**
 * Deterministically classifies the direction and suggested transaction type based on
 * which parties are owned accounts.
 *
 * Rules:
 * - sender owned + receiver owned -> internal_transfer (transfer)
 * - sender owned + receiver not owned -> outgoing (expense candidate)
 * - receiver owned + sender not owned -> incoming (requires review by default!)
 * - neither owned -> unknown (requires review)
 */
export function classifyDirection(
  senderAccountId: string | null,
  receiverAccountId: string | null
): DirectionClassification {
  const isSenderOwned = Boolean(senderAccountId);
  const isReceiverOwned = Boolean(receiverAccountId);

  if (isSenderOwned && isReceiverOwned) {
    if (senderAccountId === receiverAccountId) {
      return {
        direction: "unknown",
        suggestedType: "adjustment",
        requiresReview: true,
        reason: "Source and destination accounts are identical (suspicious self-transfer)",
      };
    }

    return {
      direction: "internal_transfer",
      suggestedType: "transfer",
      requiresReview: false,
      reason: "Both sender and receiver are owned accounts (Internal Transfer)",
    };
  }

  if (isSenderOwned && !isReceiverOwned) {
    return {
      direction: "outgoing",
      suggestedType: "expense",
      requiresReview: false,
      reason: "Sender is an owned account and receiver is external (Outgoing Expense)",
    };
  }

  if (!isSenderOwned && isReceiverOwned) {
    return {
      direction: "incoming",
      suggestedType: "income",
      requiresReview: true, // MANDATORY: Incoming money must NEVER be auto-confirmed as income without user confirmation
      reason: "Receiver is an owned account (Incoming funds require review before confirming as income)",
    };
  }

  return {
    direction: "unknown",
    suggestedType: "expense",
    requiresReview: true,
    reason: "Neither sender nor receiver matches an owned account",
  };
}
