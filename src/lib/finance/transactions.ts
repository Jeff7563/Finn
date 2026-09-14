import {
  TransactionType,
  TransactionWithRelations,
} from "@/types/finance";

export interface TransactionFilterOptions {
  type?: TransactionType | "all";
  accountId?: string;
  categoryId?: string;
  personId?: string;
  merchantId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

/**
 * Deterministically filters a list of transactions based on criteria.
 */
export function filterTransactions(
  transactions: TransactionWithRelations[],
  filters: TransactionFilterOptions
): TransactionWithRelations[] {
  return transactions.filter((tx) => {
    // Type filter
    if (filters.type && filters.type !== "all" && tx.type !== filters.type) {
      return false;
    }

    // Account filter (matches either from or to account)
    if (filters.accountId) {
      if (
        tx.from_account_id !== filters.accountId &&
        tx.to_account_id !== filters.accountId
      ) {
        return false;
      }
    }

    // Category filter
    if (filters.categoryId && tx.category_id !== filters.categoryId) {
      return false;
    }

    // Person filter
    if (filters.personId && tx.person_id !== filters.personId) {
      return false;
    }

    // Merchant filter
    if (filters.merchantId && tx.merchant_id !== filters.merchantId) {
      return false;
    }

    // Date range filter
    if (filters.startDate) {
      const txTime = new Date(tx.transaction_date).getTime();
      const startTime = new Date(filters.startDate).getTime();
      if (txTime < startTime) return false;
    }

    if (filters.endDate) {
      const txTime = new Date(tx.transaction_date).getTime();
      const endTime = new Date(filters.endDate).getTime();
      if (txTime > endTime) return false;
    }

    // Text search filter
    if (filters.search && filters.search.trim() !== "") {
      const query = filters.search.toLowerCase().trim();
      const matchDesc = tx.description?.toLowerCase().includes(query);
      const matchNote = tx.note?.toLowerCase().includes(query);
      const matchRef = tx.reference_number?.toLowerCase().includes(query);
      const matchAmount = tx.amount.toString().includes(query);
      const matchPerson =
        tx.person?.display_name?.toLowerCase().includes(query) ||
        tx.person?.aliases?.some((a) => a.toLowerCase().includes(query));
      const matchMerchant =
        tx.merchant?.display_name?.toLowerCase().includes(query) ||
        tx.merchant?.aliases?.some((a) => a.toLowerCase().includes(query));
      const matchCategory = tx.category?.name?.toLowerCase().includes(query);

      if (
        !matchDesc &&
        !matchNote &&
        !matchRef &&
        !matchAmount &&
        !matchPerson &&
        !matchMerchant &&
        !matchCategory
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Sorts transactions by date descending (newest first).
 */
export function sortTransactionsChronological(
  transactions: TransactionWithRelations[],
  order: "asc" | "desc" = "desc"
): TransactionWithRelations[] {
  return [...transactions].sort((a, b) => {
    const timeA = new Date(a.transaction_date).getTime();
    const timeB = new Date(b.transaction_date).getTime();
    return order === "desc" ? timeB - timeA : timeA - timeB;
  });
}
