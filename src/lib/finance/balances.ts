import { Account, AccountBalance, Transaction } from "@/types/finance";
import { roundToTwoDecimals } from "./formatters";

/**
 * Deterministically calculates the current balance for a single account based on:
 * - Opening balance
 * - Inflows (income, refund, reimbursement, gift, loan_received, adjustment in, transfers in)
 * - Outflows (expense, loan_payment, investment, adjustment out, transfers out)
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

    txCount++;

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
