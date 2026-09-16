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

  // Fail closed: If either timestamp is invalid/unparseable, do NOT include in current balance
  if (isNaN(txTime) || isNaN(baselineTime)) {
    console.warn(
      `[balances] Invalid timestamp encountered for account ${account.id} (baseline: ${account.balance_as_of}) or transaction ${transaction.id} (txDate: ${transaction.transaction_date}). Failing closed (excluded from current balance).`
    );
    return false;
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

export interface BalanceAtResult {
  balance: number | null; // THB decimal, or null if cannot calculate safely
  status: "success" | "cannot_calculate_safely";
  reason?: string;
  transaction_count?: number;
}

/**
 * Calculates account balance at an exact point in time according to Decision 4 semantics:
 * - target == balance_as_of -> exactly opening_balance
 * - target > balance_as_of -> opening_balance + sum(transactions in (balance_as_of, target])
 * - target < balance_as_of -> cannot_calculate_safely (returns null, NO fake reconstruction)
 * - insufficient data (no balance_as_of or unparseable timestamps) -> cannot_calculate_safely
 */
export function calculateAccountBalanceAt(
  account: Account,
  transactions: Transaction[],
  targetInstant: string | Date
): BalanceAtResult {
  if (!account.balance_as_of) {
    return {
      balance: null,
      status: "cannot_calculate_safely",
      reason: "Account has no authoritative balance_as_of baseline",
    };
  }

  const baselineTime = new Date(account.balance_as_of).getTime();
  if (isNaN(baselineTime)) {
    return {
      balance: null,
      status: "cannot_calculate_safely",
      reason: "Account baseline timestamp is invalid",
    };
  }

  const targetDate =
    typeof targetInstant === "string" ? new Date(targetInstant) : targetInstant;
  const targetTime = targetDate.getTime();
  if (isNaN(targetTime)) {
    return {
      balance: null,
      status: "cannot_calculate_safely",
      reason: "Target instant is invalid",
    };
  }

  // target < balance_as_of => strictly cannot calculate safely (no backward extrapolation)
  if (targetTime < baselineTime) {
    return {
      balance: null,
      status: "cannot_calculate_safely",
      reason:
        "Target instant is earlier than authoritative baseline (target < balance_as_of)",
    };
  }

  // target == balance_as_of => exactly opening_balance
  if (targetTime === baselineTime) {
    return {
      balance: roundToTwoDecimals(Number(account.opening_balance) || 0),
      status: "success",
      transaction_count: 0,
    };
  }

  // target > balance_as_of => opening_balance + transactions in (balance_as_of, target]
  let balance = Number(account.opening_balance) || 0;
  let txCount = 0;

  for (const tx of transactions) {
    const isFromAccount = tx.from_account_id === account.id;
    const isToAccount = tx.to_account_id === account.id;
    if (!isFromAccount && !isToAccount) {
      continue;
    }

    if (!tx.transaction_date) {
      continue;
    }

    const txTime = new Date(tx.transaction_date).getTime();
    if (isNaN(txTime)) {
      continue;
    }

    // Interval: (balance_as_of, target]
    // Strictly after baseline, on or before target
    if (txTime > baselineTime && txTime <= targetTime) {
      txCount++;
      const amount = Number(tx.amount) || 0;

      if (tx.type === "transfer") {
        if (isFromAccount && isToAccount) {
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
  }

  return {
    balance: roundToTwoDecimals(balance),
    status: "success",
    transaction_count: txCount,
  };
}

