import React from "react";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import {
  calculateAllAccountBalances,
  calculateTotalActiveBalance,
} from "@/lib/finance/balances";
import {
  calculateCategorySummaries,
  calculateMonthSummary,
  calculateMonthlyTrends,
} from "@/lib/finance/summaries";
import { calculateAllPeopleSummaries } from "@/lib/finance/people";
import { calculateAllMerchantSummaries } from "@/lib/finance/merchants";
import { PageHeader } from "@/components/ui/PageHeader";
import { SummaryMetric } from "@/components/ui/SummaryMetric";
import { MoneyAmount } from "@/components/ui/MoneyAmount";
import { AccountCard } from "@/components/ui/AccountCard";
import { PersonRow } from "@/components/ui/PersonRow";
import { MerchantRow } from "@/components/ui/MerchantRow";
import { formatMoney } from "@/lib/finance/formatters";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Scale,
  Users,
  Store,
  ChevronRight,
} from "lucide-react";

export default async function OverviewPage() {
  const user = await requireUser();

  const [accounts, categories, people, merchants, transactions] =
    await Promise.all([
      DataStore.getAccounts(user.id),
      DataStore.getCategories(user.id),
      DataStore.getPeople(user.id),
      DataStore.getMerchants(user.id),
      DataStore.getTransactions(user.id),
    ]);

  const totalBalance = calculateTotalActiveBalance(accounts, transactions);
  const accountBalances = calculateAllAccountBalances(accounts, transactions);
  const monthSummary = calculateMonthSummary(transactions, new Date());
  const categoryExpenses = calculateCategorySummaries(
    transactions,
    categories,
    "expense"
  ).slice(0, 5);
  const monthlyTrends = calculateMonthlyTrends(transactions, 6);
  const peopleSummaries = calculateAllPeopleSummaries(
    people,
    transactions
  ).slice(0, 3);
  const merchantSummaries = calculateAllMerchantSummaries(
    merchants,
    transactions,
    categories
  ).slice(0, 3);

  // Determine max value for trend chart scaling
  const maxTrend = Math.max(
    ...monthlyTrends.map((t) => Math.max(t.income, t.expense)),
    1000
  );

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <PageHeader
        title="Financial Overview"
        description="Comprehensive analysis of cash flow, accounts, categories, and counterparties."
      />

      {/* Top 4 Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryMetric
          label="Total Balance"
          amount={totalBalance}
          icon={<Wallet className="w-4 h-4" />}
          subtitle={`${accounts.length} active accounts`}
        />
        <SummaryMetric
          label="Income (This Mo)"
          amount={monthSummary.income_total}
          type="income"
          icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
        />
        <SummaryMetric
          label="Expense (This Mo)"
          amount={monthSummary.expense_total}
          type="expense"
          icon={<TrendingDown className="w-4 h-4 text-rose-600" />}
        />
        <SummaryMetric
          label="Net Cash Flow"
          amount={monthSummary.net_cash_flow}
          type="net"
          icon={<Scale className="w-4 h-4" />}
          subtitle={`Savings rate: ${monthSummary.savings_rate}%`}
        />
      </div>

      {/* Monthly Trend & Category Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend Chart */}
        <div className="p-5 sm:p-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-base text-slate-900">
              6-Month Income vs Expense
            </h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                Income
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                Expense
              </span>
            </div>
          </div>

          <div className="pt-4 space-y-3">
            {monthlyTrends.map((trend) => {
              const incomeWidth = (trend.income / maxTrend) * 100;
              const expenseWidth = (trend.expense / maxTrend) * 100;

              return (
                <div key={trend.yearMonth} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                    <span>{trend.label}</span>
                    <span className="tabular-nums">
                      Net:{" "}
                      <strong
                        className={
                          trend.net >= 0 ? "text-emerald-700" : "text-rose-700"
                        }
                      >
                        {formatMoney(trend.net)}
                      </strong>
                    </span>
                  </div>

                  {/* Dual Bar */}
                  <div className="space-y-1">
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(incomeWidth, 1)}%` }}
                        title={`Income: ${formatMoney(trend.income)}`}
                      />
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex">
                      <div
                        className="bg-rose-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(expenseWidth, 1)}%` }}
                        title={`Expense: ${formatMoney(trend.expense)}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Spending Categories */}
        <div className="p-5 sm:p-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-base text-slate-900">
              Top Spending Categories
            </h2>
            <Link
              href="/categories"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              View All
            </Link>
          </div>

          {categoryExpenses.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              No expense categories recorded yet.
            </p>
          ) : (
            <div className="space-y-3.5 pt-2">
              {categoryExpenses.map((cat) => (
                <div key={cat.category_id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-slate-700 truncate pr-2">
                      {cat.category_name}
                    </span>
                    <div className="flex items-center gap-2 text-right flex-shrink-0">
                      <span className="text-slate-400 tabular-nums">
                        {cat.percentage}%
                      </span>
                      <MoneyAmount amount={cat.total} size="sm" />
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-slate-800 h-full rounded-full transition-all duration-300"
                      style={{ width: `${cat.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Account Balances Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base text-slate-900">
            Account Balances
          </h2>
          <Link
            href="/accounts"
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
          >
            <span>All accounts ({accounts.length})</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {accountBalances.length === 0 ? (
          <p className="text-sm text-slate-500 p-4 bg-white rounded-xl border border-slate-200">
            No accounts added yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accountBalances.map((ab) => (
              <AccountCard key={ab.account.id} accountBalance={ab} />
            ))}
          </div>
        )}
      </div>

      {/* Counterparties: Top People & Top Merchants */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top People */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-slate-500" />
              <h2 className="font-semibold text-base text-slate-900">
                Top People
              </h2>
            </div>
            <Link
              href="/people"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              View All ({people.length})
            </Link>
          </div>

          {peopleSummaries.length === 0 ? (
            <p className="text-sm text-slate-500 p-4 bg-white rounded-xl border border-slate-200">
              No counterparty persons recorded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {peopleSummaries.map((ps) => (
                <PersonRow key={ps.person.id} summary={ps} />
              ))}
            </div>
          )}
        </div>

        {/* Top Merchants */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Store className="w-4 h-4 text-slate-500" />
              <h2 className="font-semibold text-base text-slate-900">
                Top Merchants
              </h2>
            </div>
            <Link
              href="/merchants"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              View All ({merchants.length})
            </Link>
          </div>

          {merchantSummaries.length === 0 ? (
            <p className="text-sm text-slate-500 p-4 bg-white rounded-xl border border-slate-200">
              No merchants recorded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {merchantSummaries.map((ms) => (
                <MerchantRow key={ms.merchant.id} summary={ms} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
