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
import { MoneyAmount } from "@/components/ui/MoneyAmount";
import { AccountCard } from "@/components/ui/AccountCard";
import { PersonRow } from "@/components/ui/PersonRow";
import { MerchantRow } from "@/components/ui/MerchantRow";
import { OverviewCalendarSection } from "@/components/overview/calendar/OverviewCalendarSection";
import { formatMoney, formatDateThai } from "@/lib/finance/formatters";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Scale,
  Users,
  Store,
  ChevronRight,
  PieChart,
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

  const hasTrendData = monthlyTrends.some((t) => t.income > 0 || t.expense > 0);

  // Month Thai label (e.g. กันยายน 2569)
  const currentMonthThai = formatDateThai(new Date(), true).split(" ").slice(1).join(" ");

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary">
            ภาพรวม <span className="text-sm font-normal text-text-muted">· Financial Overview</span>
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            สรุปกระแสเงินสด ยอดคงเหลือ บัญชี และหมวดหมู่ค่าใช้จ่าย
          </p>
        </div>

        <div className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-soft border border-border rounded-lg text-xs font-semibold text-text-primary w-fit">
          <span>{currentMonthThai}</span>
        </div>
      </div>

      {/* Main Cash Flow & Balance Hero */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Hero Net Cash Flow */}
        <div className="md:col-span-2 bg-surface dark:bg-surface-raised rounded-2xl p-5 sm:p-6 border border-border shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                กระแสเงินสดเดือนนี้ <span className="font-normal text-text-muted">· Net Cash Flow</span>
              </span>
              <Scale className="w-4 h-4 text-text-muted" />
            </div>
            <div className="mt-2">
              <MoneyAmount amount={monthSummary.net_cash_flow} type="net" size="2xl" />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-income-soft text-income flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[11px] text-text-muted block">รายรับ</span>
                <MoneyAmount amount={monthSummary.income_total} type="income" size="sm" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-expense-soft text-expense flex items-center justify-center flex-shrink-0">
                <TrendingDown className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[11px] text-text-muted block">รายจ่าย</span>
                <MoneyAmount amount={monthSummary.expense_total} type="expense" size="sm" />
              </div>
            </div>
          </div>
        </div>

        {/* Total Balance Card */}
        <div className="bg-surface dark:bg-surface-raised rounded-2xl p-5 sm:p-6 border border-border shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                ยอดเงินทั้งหมด <span className="font-normal text-text-muted">· Total Balance</span>
              </span>
              <Wallet className="w-4 h-4 text-text-muted" />
            </div>
            <div className="mt-2">
              <MoneyAmount amount={totalBalance} size="xl" />
            </div>
            <p className="text-xs text-text-muted mt-1">
              อัตราการออม: {monthSummary.savings_rate}%
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-text-muted">
            <span>{accounts.length} บัญชีที่ใช้งาน</span>
            <Link
              href="/accounts"
              className="font-medium text-text-secondary hover:text-text-primary flex items-center gap-0.5"
            >
              <span>จัดการ</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Monthly Trend & Spending Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 6-Month Trend */}
        <div className="p-5 sm:p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm sm:text-base text-text-primary">
              แนวโน้ม 6 เดือน (รายรับ vs รายจ่าย)
            </h2>
            <div className="flex items-center gap-2.5 text-xs">
              <span className="inline-flex items-center gap-1 text-text-secondary">
                <span className="w-2 h-2 rounded-full bg-income" />
                รายรับ
              </span>
              <span className="inline-flex items-center gap-1 text-text-secondary">
                <span className="w-2 h-2 rounded-full bg-expense" />
                รายจ่าย
              </span>
            </div>
          </div>

          {!hasTrendData ? (
            <div className="py-10 text-center text-xs text-text-muted">
              ยังไม่มีข้อมูลย้อนหลังเพียงพอสำหรับแสดงแนวโน้ม
            </div>
          ) : (
            <div className="pt-2 space-y-3">
              {monthlyTrends.map((trend) => {
                const incomeWidth = (trend.income / maxTrend) * 100;
                const expenseWidth = (trend.expense / maxTrend) * 100;

                return (
                  <div key={trend.yearMonth} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-text-secondary font-medium">
                      <span>{trend.label}</span>
                      <span className="tabular-nums">
                        สุทธิ:{" "}
                        <strong
                          className={
                            trend.net >= 0 ? "text-income" : "text-expense"
                          }
                        >
                          {formatMoney(trend.net)}
                        </strong>
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="w-full bg-surface-soft rounded-full h-1.5 overflow-hidden flex">
                        <div
                          className="bg-income h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(incomeWidth, 1)}%` }}
                          title={`รายรับ: ${formatMoney(trend.income)}`}
                        />
                      </div>
                      <div className="w-full bg-surface-soft rounded-full h-1.5 overflow-hidden flex">
                        <div
                          className="bg-expense h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(expenseWidth, 1)}%` }}
                          title={`รายจ่าย: ${formatMoney(trend.expense)}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Spending Categories */}
        <div className="p-5 sm:p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <PieChart className="w-4 h-4 text-text-muted" />
              <h2 className="font-semibold text-sm sm:text-base text-text-primary">
                เงินออกไปกับอะไร (หมวดหมู่ยอดนิยม)
              </h2>
            </div>
            <Link
              href="/categories"
              className="text-xs font-semibold text-text-secondary hover:text-text-primary"
            >
              ดูทั้งหมด
            </Link>
          </div>

          {categoryExpenses.length === 0 ? (
            <div className="py-10 text-center text-xs text-text-muted">
              ยังไม่มีบันทึกรายจ่ายแยกตามหมวดหมู่ในเดือนนี้
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {categoryExpenses.map((cat) => (
                <div key={cat.category_id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-text-primary truncate pr-2">
                      {cat.category_name}
                    </span>
                    <div className="flex items-center gap-2 text-right flex-shrink-0">
                      <span className="text-text-muted tabular-nums">
                        {cat.percentage}%
                      </span>
                      <MoneyAmount amount={cat.total} size="sm" />
                    </div>
                  </div>
                  <div className="w-full bg-surface-soft rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-300"
                      style={{ width: `${cat.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Calendar Insights: ภาพรวมตามปฏิทิน */}
      <OverviewCalendarSection
        transactions={transactions}
        categories={categories}
      />

      {/* Accounts Snapshot */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base text-text-primary">
            บัญชีของฉัน
          </h2>
          <Link
            href="/accounts"
            className="text-xs font-semibold text-text-secondary hover:text-text-primary flex items-center gap-1"
          >
            <span>ดูทุกบัญชี ({accounts.length})</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {accountBalances.length === 0 ? (
          <p className="text-xs text-text-muted p-4 bg-surface dark:bg-surface-raised rounded-xl border border-border">
            ยังไม่มีบัญชี
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accountBalances.map((ab) => (
              <AccountCard key={ab.account.id} accountBalance={ab} />
            ))}
          </div>
        )}
      </div>

      {/* Insights: Top People & Top Merchants (Only if data exists) */}
      {(peopleSummaries.length > 0 || merchantSummaries.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
          {peopleSummaries.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-text-muted" />
                  <h2 className="font-semibold text-sm sm:text-base text-text-primary">
                    บุคคลที่ทำธุรกรรมด้วย
                  </h2>
                </div>
                <Link
                  href="/people"
                  className="text-xs font-semibold text-text-secondary hover:text-text-primary"
                >
                  ดูทั้งหมด
                </Link>
              </div>

              <div className="space-y-2">
                {peopleSummaries.map((ps) => (
                  <PersonRow key={ps.person.id} summary={ps} />
                ))}
              </div>
            </div>
          )}

          {merchantSummaries.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Store className="w-4 h-4 text-text-muted" />
                  <h2 className="font-semibold text-sm sm:text-base text-text-primary">
                    ร้านค้ายอดนิยม
                  </h2>
                </div>
                <Link
                  href="/merchants"
                  className="text-xs font-semibold text-text-secondary hover:text-text-primary"
                >
                  ดูทั้งหมด
                </Link>
              </div>

              <div className="space-y-2">
                {merchantSummaries.map((ms) => (
                  <MerchantRow key={ms.merchant.id} summary={ms} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
