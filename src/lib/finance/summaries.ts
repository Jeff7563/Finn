import {
  Category,
  CategorySummary,
  MonthSummary,
  Transaction,
} from "@/types/finance";
import { roundToTwoDecimals, getBangkokLocalDateParts } from "./formatters";

/**
 * Deterministically calculates monthly cash flow metrics.
 * CRITICAL RULE: Transfers between accounts MUST NOT affect income, expense, or spending totals!
 */
export function calculateMonthSummary(
  transactions: Transaction[],
  targetDate?: Date
): MonthSummary {
  let incomeTotal = 0;
  let expenseTotal = 0;

  const targetParts = targetDate ? getBangkokLocalDateParts(targetDate) : null;
  const filterMonth = targetParts ? targetParts.month : null;
  const filterYear = targetParts ? targetParts.year : null;

  for (const tx of transactions) {
    if (filterMonth !== null && filterYear !== null) {
      const txParts = getBangkokLocalDateParts(tx.transaction_date);
      if (
        txParts.month !== filterMonth ||
        txParts.year !== filterYear
      ) {
        continue;
      }
    }

    const amount = Number(tx.amount) || 0;

    // Transfers are explicitly excluded from income and expense
    if (tx.type === "income") {
      incomeTotal += amount;
    } else if (tx.type === "expense") {
      expenseTotal += amount;
    }
  }

  const roundedIncome = roundToTwoDecimals(incomeTotal);
  const roundedExpense = roundToTwoDecimals(expenseTotal);
  const netCashFlow = roundToTwoDecimals(roundedIncome - roundedExpense);
  const savingsRate =
    roundedIncome > 0
      ? roundToTwoDecimals((netCashFlow / roundedIncome) * 100)
      : 0;

  return {
    income_total: roundedIncome,
    expense_total: roundedExpense,
    net_cash_flow: netCashFlow,
    savings_rate: savingsRate,
  };
}

/**
 * Calculates category-level spending or income breakdowns with percentages.
 */
export function calculateCategorySummaries(
  transactions: Transaction[],
  categories: Category[],
  type: "income" | "expense" = "expense"
): CategorySummary[] {
  const categoryMap = new Map<string, Category>();
  for (const cat of categories) {
    categoryMap.set(cat.id, cat);
  }

  const totals = new Map<string, { total: number; count: number }>();
  let grandTotal = 0;

  for (const tx of transactions) {
    if (tx.type !== type) continue;

    const amount = Number(tx.amount) || 0;
    const catId = tx.category_id || "uncategorized";

    const current = totals.get(catId) || { total: 0, count: 0 };
    current.total += amount;
    current.count += 1;
    totals.set(catId, current);

    grandTotal += amount;
  }

  const results: CategorySummary[] = [];

  for (const [catId, data] of totals.entries()) {
    const category = categoryMap.get(catId);
    const categoryName =
      catId === "uncategorized"
        ? "Uncategorized"
        : category?.name || "Other";

    const roundedTotal = roundToTwoDecimals(data.total);
    const percentage =
      grandTotal > 0
        ? roundToTwoDecimals((roundedTotal / grandTotal) * 100)
        : 0;

    results.push({
      category_id: catId,
      category_name: categoryName,
      type,
      total: roundedTotal,
      count: data.count,
      percentage,
    });
  }

  // Sort descending by total amount
  return results.sort((a, b) => b.total - a.total);
}

export interface MonthlyTrend {
  yearMonth: string; // e.g. "2026-09"
  label: string; // e.g. "Sep 2026"
  income: number;
  expense: number;
  net: number;
}

/**
 * Calculates monthly income vs expense trends over a specified period.
 */
export function calculateMonthlyTrends(
  transactions: Transaction[],
  monthsCount: number = 6
): MonthlyTrend[] {
  const trendMap = new Map<string, { income: number; expense: number }>();

  // Determine sorted unique months from transactions or generate last N months
  const now = new Date();
  const nowParts = getBangkokLocalDateParts(now);
  const months: string[] = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(nowParts.year, nowParts.month - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(ym);
    trendMap.set(ym, { income: 0, expense: 0 });
  }

  for (const tx of transactions) {
    const txParts = getBangkokLocalDateParts(tx.transaction_date);
    const ym = `${txParts.year}-${String(txParts.month + 1).padStart(2, "0")}`;

    if (trendMap.has(ym)) {
      const current = trendMap.get(ym)!;
      const amount = Number(tx.amount) || 0;
      if (tx.type === "income") {
        current.income += amount;
      } else if (tx.type === "expense") {
        current.expense += amount;
      }
    }
  }

  return months.map((ym) => {
    const [year, month] = ym.split("-").map(Number);
    const date = new Date(year, month - 1, 1);
    const label = new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(date);

    const data = trendMap.get(ym) || { income: 0, expense: 0 };
    const income = roundToTwoDecimals(data.income);
    const expense = roundToTwoDecimals(data.expense);

    return {
      yearMonth: ym,
      label,
      income,
      expense,
      net: roundToTwoDecimals(income - expense),
    };
  });
}
