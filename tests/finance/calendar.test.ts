import { describe, expect, it } from "vitest";
import {
  getDailyFinancialSummaries,
  getExpenseHeatmapIntensity,
  getLocalDateString,
  getMonthCalendarMatrix,
} from "@/lib/finance/calendar";
import { Category, TransactionWithRelations } from "@/types/finance";

describe("Calendar Finance Engine & Intensity Mapping", () => {
  const categories: Category[] = [
    {
      id: "cat-food",
      name: "อาหาร",
      type: "expense",
      is_system: true,
      created_at: "",
      updated_at: "",
    },
    {
      id: "cat-transport",
      name: "เดินทาง",
      type: "expense",
      is_system: true,
      created_at: "",
      updated_at: "",
    },
    {
      id: "cat-salary",
      name: "เงินเดือน",
      type: "income",
      is_system: true,
      created_at: "",
      updated_at: "",
    },
  ];

  it("1. groups income to the correct day", () => {
    const transactions: TransactionWithRelations[] = [
      {
        id: "tx-inc-1",
        user_id: "u1",
        type: "income",
        amount: 30000,
        currency: "THB",
        transaction_date: "2026-09-15T09:00:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const summaries = getDailyFinancialSummaries(transactions, 2026, 9, categories);
    const daySummary = summaries.get("2026-09-15");

    expect(daySummary).toBeDefined();
    expect(daySummary?.income).toBe(30000);
    expect(daySummary?.incomeCount).toBe(1);
    expect(daySummary?.expense).toBe(0);
    expect(daySummary?.transfer).toBe(0);
    expect(daySummary?.net).toBe(30000);
  });

  it("2. groups expense to the correct day", () => {
    const transactions: TransactionWithRelations[] = [
      {
        id: "tx-exp-1",
        user_id: "u1",
        type: "expense",
        amount: 650,
        category_id: "cat-food",
        currency: "THB",
        transaction_date: "2026-09-14T12:30:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const summaries = getDailyFinancialSummaries(transactions, 2026, 9, categories);
    const daySummary = summaries.get("2026-09-14");

    expect(daySummary).toBeDefined();
    expect(daySummary?.expense).toBe(650);
    expect(daySummary?.expenseCount).toBe(1);
    expect(daySummary?.income).toBe(0);
    expect(daySummary?.net).toBe(-650);
  });

  it("3. transfer grouped separately and strictly isolated from income, expense, and net", () => {
    const transactions: TransactionWithRelations[] = [
      {
        id: "tx-tr-1",
        user_id: "u1",
        type: "transfer",
        amount: 5000,
        from_account_id: "acc-1",
        to_account_id: "acc-2",
        currency: "THB",
        transaction_date: "2026-09-21T15:00:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const summaries = getDailyFinancialSummaries(transactions, 2026, 9, categories);
    const daySummary = summaries.get("2026-09-21");

    expect(daySummary).toBeDefined();
    expect(daySummary?.transfer).toBe(5000);
    expect(daySummary?.transferCount).toBe(1);
    // Strict isolation
    expect(daySummary?.income).toBe(0);
    expect(daySummary?.expense).toBe(0);
    expect(daySummary?.net).toBe(0);
  });

  it("4. multiple transactions on same day aggregate correctly", () => {
    const transactions: TransactionWithRelations[] = [
      {
        id: "tx-1",
        user_id: "u1",
        type: "income",
        amount: 15000,
        currency: "THB",
        transaction_date: "2026-09-14T08:00:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-2",
        user_id: "u1",
        type: "expense",
        amount: 389,
        category_id: "cat-food",
        currency: "THB",
        transaction_date: "2026-09-14T12:00:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-3",
        user_id: "u1",
        type: "transfer",
        amount: 4000,
        currency: "THB",
        transaction_date: "2026-09-14T16:00:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const summaries = getDailyFinancialSummaries(transactions, 2026, 9, categories);
    const daySummary = summaries.get("2026-09-14");

    expect(daySummary).toBeDefined();
    expect(daySummary?.transactionCount).toBe(3);
    expect(daySummary?.income).toBe(15000);
    expect(daySummary?.expense).toBe(389);
    expect(daySummary?.transfer).toBe(4000);
    // Net is strictly income - expense = 15000 - 389 = 14611 (transfer excluded!)
    expect(daySummary?.net).toBe(14611);
  });

  it("5. calculates top expense category accurately", () => {
    const transactions: TransactionWithRelations[] = [
      {
        id: "tx-1",
        user_id: "u1",
        type: "expense",
        amount: 150,
        category_id: "cat-transport",
        currency: "THB",
        transaction_date: "2026-09-14T08:30:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-2",
        user_id: "u1",
        type: "expense",
        amount: 389,
        category_id: "cat-food",
        currency: "THB",
        transaction_date: "2026-09-14T13:00:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const summaries = getDailyFinancialSummaries(transactions, 2026, 9, categories);
    const daySummary = summaries.get("2026-09-14");

    expect(daySummary?.topExpenseCategory).toBeDefined();
    expect(daySummary?.topExpenseCategory?.name).toBe("อาหาร");
    expect(daySummary?.topExpenseCategory?.amount).toBe(389);
  });

  it("6. preserves Bangkok timezone conversion without UTC date shift", () => {
    // 2026-09-14 at 02:30 UTC is 09:30 in Bangkok (UTC+7) -> Same day 2026-09-14
    expect(getLocalDateString("2026-09-14T02:30:00.000Z")).toBe("2026-09-14");

    // 2026-09-13 at 18:30 UTC is 2026-09-14 at 01:30 in Bangkok -> Must be 2026-09-14!
    expect(getLocalDateString("2026-09-13T18:30:00.000Z")).toBe("2026-09-14");
  });

  it("7. calculates stable heatmap intensity levels 0 through 4", () => {
    const maxExpense = 1000;

    // 0 expense = Level 0
    expect(getExpenseHeatmapIntensity(0, maxExpense)).toBe(0);

    // <= 25% = Level 1
    expect(getExpenseHeatmapIntensity(200, maxExpense)).toBe(1);
    expect(getExpenseHeatmapIntensity(250, maxExpense)).toBe(1);

    // <= 50% = Level 2
    expect(getExpenseHeatmapIntensity(300, maxExpense)).toBe(2);
    expect(getExpenseHeatmapIntensity(500, maxExpense)).toBe(2);

    // <= 75% = Level 3
    expect(getExpenseHeatmapIntensity(600, maxExpense)).toBe(3);
    expect(getExpenseHeatmapIntensity(750, maxExpense)).toBe(3);

    // > 75% = Level 4
    expect(getExpenseHeatmapIntensity(800, maxExpense)).toBe(4);
    expect(getExpenseHeatmapIntensity(1000, maxExpense)).toBe(4);
  });

  it("8. builds complete 7-column calendar matrix with stats", () => {
    const transactions: TransactionWithRelations[] = [
      {
        id: "tx-1",
        user_id: "u1",
        type: "income",
        amount: 30000,
        currency: "THB",
        transaction_date: "2026-09-01T10:00:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-2",
        user_id: "u1",
        type: "expense",
        amount: 800,
        currency: "THB",
        transaction_date: "2026-09-15T12:00:00+07:00",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const matrix = getMonthCalendarMatrix(2026, 9, transactions, categories);

    expect(matrix.days.length % 7).toBe(0); // Multiple of 7
    expect(matrix.stats.totalIncome).toBe(30000);
    expect(matrix.stats.totalExpense).toBe(800);
    expect(matrix.stats.totalNet).toBe(29200);
    expect(matrix.stats.hasData).toBe(true);

    const activeDays = matrix.days.filter((d) => d.isCurrentMonth);
    expect(activeDays.length).toBe(30); // September has 30 days
  });

  it("9. handles zero-data month gracefully", () => {
    const matrix = getMonthCalendarMatrix(2026, 10, [], categories);

    expect(matrix.stats.hasData).toBe(false);
    expect(matrix.stats.totalIncome).toBe(0);
    expect(matrix.stats.totalExpense).toBe(0);
    expect(matrix.stats.totalNet).toBe(0);
    expect(matrix.stats.totalTransactions).toBe(0);
  });
});
