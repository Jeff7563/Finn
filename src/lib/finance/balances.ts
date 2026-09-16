import { Account, AccountBalance, Transaction } from "@/types/finance";
import { roundToTwoDecimals } from "./formatters";

/**
 * Determines whether a transaction is eligible to affect an account's current balance.
 *
 * Rules:
 * 1. If account.balance_as_of is NULL, undefined, or empty:
 *    Preserves legacy Finn behavior exactly: all transactions affect balance (returns true).
 * 2. If account.balance_as_of is set:
 *    The baseline timestamp is INCLUSIVE. Transactions with transaction_date <= balance_as_of
 *    are already accounted for in the baseline opening_balance and MUST NOT affect current balance.
 *    Only transactions strictly AFTER balance_as_of (transaction_date > balance_as_of) affect current balance.
 */
export function doesTransactionAffectAccountBalance(
  account: Account,
  transaction: Transaction
): boolean {
  if (!account.balance_as_of) {
    return true;
  }
  if (!transaction.transaction_date) {
    return false;
  }

  const txTime = new Date(transaction.transaction_date).getTime();
  const baselineTime = new Date(account.balance_as_of).getTime();

  if (isNaN(txTime) || isNaN(baselineTime)) {
    return true;
  }

  // Strictly after baseline
  return txTime > baselineTime;
}

/**
 * Deterministically calculates the current balance for a single account based on:
 * - Authoritative baseline opening_balance
 * - Inflows strictly after balance_as_of (or all inflows if balance_as_of is null)
 * - Outflows strictly after balance_as_of (or all outflows if balance_as_of is null)
 *
 * Transaction count continues to include ALL transactions associated with the account.
 */
export function calculateAccountBalance(
  account: Account,
  transactions: Transaction[]
): AccountBalance {
  let balance = Number(account.opening_balance) || 0;
  let txCount = 0;

  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    const isFromAccount = tx.from_account_id === account.id;
    const isToAccount = tx.to_account_id === account.id;

    if (!isFromAccount && !isToAccount) {
      continue;
    }

    // Historical count includes all transactions linked to this account
    txCount++;

    // Only transactions strictly after balance_as_of affect current balance
    if (!doesTransactionAffectAccountBalance(account, tx)) {
      continue;
    }

    if (tx.type === "transfer") {
      if (isFromAccount && isToAccount) {
        // Same account transfer is a no-op defensively
        continue;
      }
      if (isFromAccount) {
        balance -= amount;
      } else if (isToAccount) {
        balance += amount;
      }
    } else if (
      tx.type === "income" ||
      tx.type === "refund" ||
      tx.type === "reimbursement" ||
      tx.type === "gift" ||
      tx.type === "loan_received"
    ) {
      if (isToAccount) {
        balance += amount;
      }
    } else if (
      tx.type === "expense" ||
      tx.type === "loan_payment" ||
      tx.type === "investment"
    ) {
      if (isFromAccount) {
        balance -= amount;
      }
    } else if (tx.type === "adjustment") {
      if (isToAccount) {
        balance += amount;
      } else if (isFromAccount) {
        balance -= amount;
      }
    }
  }

  return {
    account,
    current_balance: roundToTwoDecimals(balance),
    transaction_count: txCount,
  };
}

/**
 * Calculates current balances for all accounts.
 */
export function calculateAllAccountBalances(
  accounts: Account[],
  transactions: Transaction[]
): AccountBalance[] {
  return accounts.map((acc) => calculateAccountBalance(acc, transactions));
}

/**
 * Deterministically sums the current balances of all active accounts.
 */
export function calculateTotalActiveBalance(
  accounts: Account[],
  transactions: Transaction[]
): number {
  const activeAccounts = accounts.filter((acc) => acc.active);
  const total = activeAccounts.reduce((sum, acc) => {
    const { current_balance } = calculateAccountBalance(acc, transactions);
    return sum + current_balance;
  }, 0);

  return roundToTwoDecimals(total);
}
