import { describe, expect, it } from "vitest";
import {
  calculateAccountBalance,
  calculateAllAccountBalances,
  calculateTotalActiveBalance,
} from "@/lib/finance/balances";
import {
  calculateCategorySummaries,
  calculateMonthSummary,
  calculateMonthlyTrends,
} from "@/lib/finance/summaries";
import {
  isTransfer,
  isValidTransfer,
  shouldIncludeInIncomeExpense,
} from "@/lib/finance/transfers";
import {
  calculateAllPeopleSummaries,
  calculatePersonSummary,
} from "@/lib/finance/people";
import {
  calculateAllMerchantSummaries,
  calculateMerchantSummary,
} from "@/lib/finance/merchants";
import {
  filterTransactions,
  sortTransactionsChronological,
} from "@/lib/finance/transactions";
import {
  formatMoney,
  formatSignedMoney,
  roundToTwoDecimals,
} from "@/lib/finance/formatters";
import {
  Account,
  Category,
  Merchant,
  Person,
  Transaction,
  TransactionWithRelations,
} from "@/types/finance";

describe("Finance Engine: Transfers & Income/Expense Isolation", () => {
  it("strictly excludes transfers between own accounts from income and expense", () => {
    const transactions: Transaction[] = [
      {
        id: "tx-1",
        user_id: "user-1",
        type: "income",
        amount: 25000,
        currency: "THB",
        transaction_date: "2026-09-01T10:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-2",
        user_id: "user-1",
        type: "expense",
        amount: 3500,
        currency: "THB",
        transaction_date: "2026-09-02T12:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-3",
        user_id: "user-1",
        type: "transfer", // Transfer SCB -> KBank 5000 THB
        amount: 5000,
        from_account_id: "acc-scb",
        to_account_id: "acc-kbank",
        currency: "THB",
        transaction_date: "2026-09-03T15:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const summary = calculateMonthSummary(
      transactions,
      new Date("2026-09-10")
    );

    // Transfer 5,000 must NOT inflate income or expense
    expect(summary.income_total).toBe(25000);
    expect(summary.expense_total).toBe(3500);
    expect(summary.net_cash_flow).toBe(21500);
    expect(summary.savings_rate).toBe(86);
  });

  it("validates transfer requirements", () => {
    expect(isTransfer({ type: "transfer" })).toBe(true);
    expect(isTransfer({ type: "income" })).toBe(false);
    expect(isTransfer({ type: "expense" })).toBe(false);

    expect(isValidTransfer("acc-1", "acc-2")).toBe(true);
    expect(isValidTransfer("acc-1", "acc-1")).toBe(false); // same account
    expect(isValidTransfer("acc-1", null)).toBe(false);

    expect(shouldIncludeInIncomeExpense({ type: "transfer" })).toBe(false);
    expect(shouldIncludeInIncomeExpense({ type: "income" })).toBe(true);
    expect(shouldIncludeInIncomeExpense({ type: "expense" })).toBe(true);
  });
});

describe("Finance Engine: Account Balances", () => {
  const accountSCB: Account = {
    id: "acc-scb",
    user_id: "user-1",
    name: "SCB Main",
    institution: "SCB",
    type: "bank",
    masked_number: "1234",
    opening_balance: 10000,
    currency: "THB",
    active: true,
    created_at: "",
    updated_at: "",
  };

  const accountKBank: Account = {
    id: "acc-kbank",
    user_id: "user-1",
    name: "KBank Savings",
    institution: "KBANK",
    type: "bank",
    masked_number: "5678",
    opening_balance: 2000,
    currency: "THB",
    active: true,
    created_at: "",
    updated_at: "",
  };

  it("updates account balances accurately after income, expense, and transfer", () => {
    const transactions: Transaction[] = [
      // SCB receives salary 30,000
      {
        id: "tx-1",
        user_id: "user-1",
        type: "income",
        amount: 30000,
        to_account_id: "acc-scb",
        currency: "THB",
        transaction_date: "2026-09-01T10:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      // SCB pays rent 8,000
      {
        id: "tx-2",
        user_id: "user-1",
        type: "expense",
        amount: 8000,
        from_account_id: "acc-scb",
        currency: "THB",
        transaction_date: "2026-09-02T10:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      // Transfer SCB -> KBank 5,000
      {
        id: "tx-3",
        user_id: "user-1",
        type: "transfer",
        amount: 5000,
        from_account_id: "acc-scb",
        to_account_id: "acc-kbank",
        currency: "THB",
        transaction_date: "2026-09-03T10:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const scbBalance = calculateAccountBalance(accountSCB, transactions);
    // Opening 10,000 + 30,000 - 8,000 - 5,000 = 27,000
    expect(scbBalance.current_balance).toBe(27000);
    expect(scbBalance.transaction_count).toBe(3);

    const kbankBalance = calculateAccountBalance(accountKBank, transactions);
    // Opening 2,000 + 5,000 = 7,000
    expect(kbankBalance.current_balance).toBe(7000);
    expect(kbankBalance.transaction_count).toBe(1);

    const total = calculateTotalActiveBalance(
      [accountSCB, accountKBank],
      transactions
    );
    // 27,000 + 7,000 = 34,000
    expect(total).toBe(34000);
  });
});

describe("Finance Engine: People & Merchants", () => {
  const somchai: Person = {
    id: "person-1",
    user_id: "user-1",
    display_name: "Somchai",
    normalized_name: "somchai",
    aliases: ["สมชาย"],
    created_at: "",
    updated_at: "",
  };

  const sevenEleven: Merchant = {
    id: "merchant-1",
    user_id: "user-1",
    display_name: "7-Eleven",
    normalized_name: "7-eleven",
    category_hint: "Food",
    aliases: ["เซเว่น"],
    created_at: "",
    updated_at: "",
  };

  it("calculates person received, paid, and net balance", () => {
    const transactions: Transaction[] = [
      {
        id: "tx-1",
        user_id: "user-1",
        type: "income",
        person_id: "person-1",
        amount: 2000,
        currency: "THB",
        transaction_date: "2026-09-01T00:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-2",
        user_id: "user-1",
        type: "expense",
        person_id: "person-1",
        amount: 500,
        currency: "THB",
        transaction_date: "2026-09-02T00:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const summary = calculatePersonSummary(somchai, transactions);
    expect(summary.total_received).toBe(2000);
    expect(summary.total_paid).toBe(500);
    expect(summary.net).toBe(1500);
    expect(summary.transaction_count).toBe(2);
  });

  it("calculates merchant total spent and averages", () => {
    const transactions: Transaction[] = [
      {
        id: "tx-1",
        user_id: "user-1",
        type: "expense",
        merchant_id: "merchant-1",
        amount: 120,
        currency: "THB",
        transaction_date: "2026-09-01T00:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-2",
        user_id: "user-1",
        type: "expense",
        merchant_id: "merchant-1",
        amount: 80,
        currency: "THB",
        transaction_date: "2026-09-02T00:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const summary = calculateMerchantSummary(sevenEleven, transactions);
    expect(summary.total_spent).toBe(200);
    expect(summary.transaction_count).toBe(2);
    expect(summary.average_transaction).toBe(100);
  });
});

describe("Finance Engine: Filtering & Formatting", () => {
  it("formats currency and signs properly", () => {
    expect(formatMoney(12450)).toBe("฿12,450.00");
    expect(formatSignedMoney(4800, "income")).toBe("+฿4,800.00");
    expect(formatSignedMoney(389, "expense")).toBe("-฿389.00");
    expect(formatSignedMoney(5000, "transfer")).toBe("฿5,000.00");
  });

  it("filters transactions accurately by query", () => {
    const list: TransactionWithRelations[] = [
      {
        id: "tx-1",
        user_id: "user-1",
        type: "expense",
        amount: 150,
        currency: "THB",
        description: "Dinner with friends",
        transaction_date: "2026-09-05T19:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
      {
        id: "tx-2",
        user_id: "user-1",
        type: "income",
        amount: 15000,
        currency: "THB",
        description: "Monthly freelance client",
        transaction_date: "2026-09-06T10:00:00Z",
        source: "manual",
        confidence: 1,
        review_status: "confirmed",
        tax_deductible: false,
        created_at: "",
        updated_at: "",
      },
    ];

    const filtered = filterTransactions(list, { search: "freelance" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("tx-2");
  });
});
