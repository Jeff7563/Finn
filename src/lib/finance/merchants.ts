import {
  Category,
  Merchant,
  MerchantSummary,
  Transaction,
} from "@/types/finance";
import { roundToTwoDecimals } from "./formatters";
import { isFinanciallyActiveTransaction } from "./balances";

/**
 * Calculates analytics for a merchant based on expense transactions.
 */
export function calculateMerchantSummary(
  merchant: Merchant,
  transactions: Transaction[],
  categories: Category[] = []
): MerchantSummary {
  let totalSpent = 0;
  let count = 0;
  const categoryCounts = new Map<string, number>();

  for (const tx of transactions) {
    if (!isFinanciallyActiveTransaction(tx)) continue;
    if (tx.merchant_id !== merchant.id) continue;

    count++;
    const amount = Number(tx.amount) || 0;
    if (tx.type === "expense") {
      totalSpent += amount;
    }

    if (tx.category_id) {
      categoryCounts.set(
        tx.category_id,
        (categoryCounts.get(tx.category_id) || 0) + 1
      );
    }
  }

  // Find top category
  let topCategoryName: string | null = null;
  let highestCount = 0;
  for (const [catId, catCount] of categoryCounts.entries()) {
    if (catCount > highestCount) {
      highestCount = catCount;
      const cat = categories.find((c) => c.id === catId);
      if (cat) topCategoryName = cat.name;
    }
  }

  const roundedTotal = roundToTwoDecimals(totalSpent);
  const avg = count > 0 ? roundToTwoDecimals(totalSpent / count) : 0;

  return {
    merchant,
    total_spent: roundedTotal,
    transaction_count: count,
    average_transaction: avg,
    top_category_name: topCategoryName || merchant.category_hint || null,
  };
}

/**
 * Calculates summaries for an array of merchants, sorted by total spent descending.
 */
export function calculateAllMerchantSummaries(
  merchants: Merchant[],
  transactions: Transaction[],
  categories: Category[] = []
): MerchantSummary[] {
  return merchants
    .map((m) => calculateMerchantSummary(m, transactions, categories))
    .sort((a, b) => b.total_spent - a.total_spent);
}
