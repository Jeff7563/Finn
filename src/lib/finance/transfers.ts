import { Transaction } from "@/types/finance";

/**
 * Checks if a transaction is an internal transfer between user accounts.
 */
export function isTransfer(transaction: Pick<Transaction, "type">): boolean {
  return transaction.type === "transfer";
}

/**
 * Validates whether a transfer transaction has valid source and destination accounts.
 */
export function isValidTransfer(
  fromAccountId?: string | null,
  toAccountId?: string | null
): boolean {
  if (!fromAccountId || !toAccountId) {
    return false;
  }
  return fromAccountId !== toAccountId;
}

/**
 * Ensures transfer amounts do NOT alter income or expense totals.
 * This pure function is a guard to verify transfers are excluded.
 */
export function shouldIncludeInIncomeExpense(
  transaction: Pick<Transaction, "type">
): boolean {
  return transaction.type === "income" || transaction.type === "expense";
}
