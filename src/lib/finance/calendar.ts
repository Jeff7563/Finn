import {
  Category,
  TransactionWithRelations,
} from "@/types/finance";
import { roundToTwoDecimals } from "./formatters";

export type HeatmapIntensity = 0 | 1 | 2 | 3 | 4;

export interface DailyFinancialSummary {
  date: string; // "YYYY-MM-DD"
  year: number;
  month: number; // 1-12
  day: number;
  income: number;
  expense: number;
  transfer: number;
  net: number; // income - expense (transfers strictly excluded!)
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;
  topExpenseCategory?: {
    id?: string;
    name: string;
    amount: number;
  };
  transactions: TransactionWithRelations[];
}

export interface MonthCalendarDay {
  date: string; // "YYYY-MM-DD"
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  summary: DailyFinancialSummary;
  heatmapIntensity: HeatmapIntensity;
}

export interface MonthSummaryStats {
  year: number;
  month: number; // 1-12
  monthNameThai: string; // e.g. "กันยายน 2569"
  totalIncome: number;
  totalExpense: number;
  totalNet: number;
  totalTransfer: number;
  totalTransactions: number;
  maxExpenseDay: number;
  hasData: boolean;
}

const THAI_MONTHS_FULL = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

/**
 * Returns date in YYYY-MM-DD format based on Bangkok (UTC+7) timezone.
 */
export function getLocalDateString(
  dateInput: string | Date,
  timeZone: string = "Asia/Bangkok"
): string {
  if (!dateInput) return "";

  try {
    const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) {
      // Fallback if string is already formatted as YYYY-MM-DD
      if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
        return dateInput.slice(0, 10);
      }
      return "";
    }

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    return formatter.format(date);
  } catch {
    if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
      return dateInput.slice(0, 10);
    }
    return "";
  }
}

/**
 * Deterministically maps daily expense amount into 5 discrete visual levels (0 to 4).
 * 0 = no expense
 * 1 = low
 * 2 = medium-low
 * 3 = medium-high
 * 4 = high
 */
export function getExpenseHeatmapIntensity(
  dailyExpense: number,
  maxExpenseInMonth: number
): HeatmapIntensity {
  if (dailyExpense <= 0 || maxExpenseInMonth <= 0) {
    return 0;
  }

  const ratio = dailyExpense / maxExpenseInMonth;

  if (ratio <= 0.25) return 1;
  if (ratio <= 0.50) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * Aggregates transactions by date for the specified year and month.
 * Strictly guarantees transfer isolation:
 * - Transfers do NOT count as income
 * - Transfers do NOT count as expense
 * - Transfers do NOT affect net cash flow
 * - Transfers do NOT contribute to expense heatmap intensity
 */
export function getDailyFinancialSummaries(
  transactions: TransactionWithRelations[],
  year: number,
  month: number, // 1-12
  categories?: Category[]
): Map<string, DailyFinancialSummary> {
  const categoryMap = new Map<string, string>();
  if (categories) {
    for (const c of categories) {
      categoryMap.set(c.id, c.name);
    }
  }

  const summaries = new Map<string, DailyFinancialSummary>();
  const expenseCategoryMap = new Map<string, Map<string, number>>();

  // Filter transactions for this month and group by local Bangkok date
  for (const tx of transactions) {
    const localDate = getLocalDateString(tx.transaction_date);
    if (!localDate) continue;

    const [txY, txM, txD] = localDate.split("-").map(Number);
    if (txY !== year || txM !== month) continue;

    if (!summaries.has(localDate)) {
      summaries.set(localDate, {
        date: localDate,
        year: txY,
        month: txM,
        day: txD,
        income: 0,
        expense: 0,
        transfer: 0,
        net: 0,
        transactionCount: 0,
        incomeCount: 0,
        expenseCount: 0,
        transferCount: 0,
        transactions: [],
      });
      expenseCategoryMap.set(localDate, new Map<string, number>());
    }

    const summary = summaries.get(localDate)!;
    summary.transactionCount += 1;
    summary.transactions.push(tx);

    const amount = Number(tx.amount) || 0;

    if (
      tx.type === "income" ||
      tx.type === "refund" ||
      tx.type === "reimbursement" ||
      tx.type === "gift"
    ) {
      summary.income = roundToTwoDecimals(summary.income + amount);
      summary.incomeCount += 1;
    } else if (tx.type === "expense" || tx.type === "loan_payment") {
      summary.expense = roundToTwoDecimals(summary.expense + amount);
      summary.expenseCount += 1;

      // Track top expense category for this day
      const catId = tx.category_id || "uncategorized";
      const catMap = expenseCategoryMap.get(localDate)!;
      catMap.set(catId, (catMap.get(catId) || 0) + amount);
    } else if (tx.type === "transfer") {
      // Transfer isolated
      summary.transfer = roundToTwoDecimals(summary.transfer + amount);
      summary.transferCount += 1;
    }

    summary.net = roundToTwoDecimals(summary.income - summary.expense);
  }

  // Calculate top expense category for each day
  for (const [date, summary] of summaries.entries()) {
    const catMap = expenseCategoryMap.get(date);
    if (catMap && catMap.size > 0) {
      let maxCatId = "";
      let maxCatAmount = -1;

      for (const [catId, total] of catMap.entries()) {
        if (total > maxCatAmount) {
          maxCatAmount = total;
          maxCatId = catId;
        }
      }

      if (maxCatAmount > 0) {
        const catName =
          maxCatId === "uncategorized"
            ? "ยังไม่จัดหมวดหมู่"
            : categoryMap.get(maxCatId) || summary.transactions.find(t => t.category_id === maxCatId)?.category?.name || "ทั่วไป";

        summary.topExpenseCategory = {
          id: maxCatId === "uncategorized" ? undefined : maxCatId,
          name: catName,
          amount: roundToTwoDecimals(maxCatAmount),
        };
      }
    }
  }

  return summaries;
}

/**
 * Builds the complete 7-column calendar grid for a given year & month (Monday-first: จ, อ, พ, พฤ, ศ, ส, อา).
 */
export function getMonthCalendarMatrix(
  year: number,
  month: number, // 1-12
  transactions: TransactionWithRelations[],
  categories?: Category[]
): {
  days: MonthCalendarDay[];
  stats: MonthSummaryStats;
} {
  const summaries = getDailyFinancialSummaries(transactions, year, month, categories);

  // Month boundary calculations (using local dates)
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  // Monday-first offset: Mon -> 0, Tue -> 1, ..., Sun -> 6
  const leadingDaysCount = (firstDayOfWeek + 6) % 7;

  // Maximum expense in the current visible month for relative scaling
  let maxExpense = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  let totalTransfer = 0;
  let totalTransactions = 0;

  for (const summary of summaries.values()) {
    if (summary.expense > maxExpense) {
      maxExpense = summary.expense;
    }
    totalIncome = roundToTwoDecimals(totalIncome + summary.income);
    totalExpense = roundToTwoDecimals(totalExpense + summary.expense);
    totalTransfer = roundToTwoDecimals(totalTransfer + summary.transfer);
    totalTransactions += summary.transactionCount;
  }

  const todayStr = getLocalDateString(new Date());

  const days: MonthCalendarDay[] = [];

  // 1. Leading days from previous month
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  for (let i = leadingDaysCount - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const dateStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;

    days.push({
      date: dateStr,
      day: dayNum,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      summary: {
        date: dateStr,
        year: prevYear,
        month: prevMonth,
        day: dayNum,
        income: 0,
        expense: 0,
        transfer: 0,
        net: 0,
        transactionCount: 0,
        incomeCount: 0,
        expenseCount: 0,
        transferCount: 0,
        transactions: [],
      },
      heatmapIntensity: 0,
    });
  }

  // 2. Days in current month
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    const summary = summaries.get(dateStr) || {
      date: dateStr,
      year,
      month,
      day: dayNum,
      income: 0,
      expense: 0,
      transfer: 0,
      net: 0,
      transactionCount: 0,
      incomeCount: 0,
      expenseCount: 0,
      transferCount: 0,
      transactions: [],
    };

    const heatmapIntensity = getExpenseHeatmapIntensity(summary.expense, maxExpense);

    days.push({
      date: dateStr,
      day: dayNum,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      summary,
      heatmapIntensity,
    });
  }

  // 3. Trailing days from next month to complete the row
  const trailingDaysCount = (7 - (days.length % 7)) % 7;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  for (let dayNum = 1; dayNum <= trailingDaysCount; dayNum++) {
    const dateStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;

    days.push({
      date: dateStr,
      day: dayNum,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      summary: {
        date: dateStr,
        year: nextYear,
        month: nextMonth,
        day: dayNum,
        income: 0,
        expense: 0,
        transfer: 0,
        net: 0,
        transactionCount: 0,
        incomeCount: 0,
        expenseCount: 0,
        transferCount: 0,
        transactions: [],
      },
      heatmapIntensity: 0,
    });
  }

  const monthNameThai = `${THAI_MONTHS_FULL[month - 1]} ${year + 543}`;
  const totalNet = roundToTwoDecimals(totalIncome - totalExpense);

  return {
    days,
    stats: {
      year,
      month,
      monthNameThai,
      totalIncome,
      totalExpense,
      totalNet,
      totalTransfer,
      totalTransactions,
      maxExpenseDay: maxExpense,
      hasData: totalTransactions > 0,
    },
  };
}
