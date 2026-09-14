import React from "react";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculateTotalActiveBalance } from "@/lib/finance/balances";
import { calculateMonthSummary } from "@/lib/finance/summaries";
import { MoneyAmount } from "@/components/ui/MoneyAmount";
import { TransactionItem } from "@/components/ui/TransactionItem";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Clock,
  Sparkles,
  ChevronRight,
} from "lucide-react";

export default async function TodayPage() {
  const user = await requireUser();

  const [accounts, allTransactions] = await Promise.all([
    DataStore.getAccounts(user.id),
    DataStore.getTransactions(user.id),
  ]);

  const totalBalance = calculateTotalActiveBalance(accounts, allTransactions);
  const monthSummary = calculateMonthSummary(allTransactions, new Date());

  // Recent 8 transactions
  const recentTransactions = [...allTransactions]
    .sort(
      (a, b) =>
        new Date(b.transaction_date).getTime() -
        new Date(a.transaction_date).getTime()
    )
    .slice(0, 8);

  const todayFormatted = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Greeting Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-500">
            {todayFormatted}
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-0.5">
            Hello, {user.display_name || "User"}
          </h1>
        </div>

        {accounts.length === 0 && (
          <Link
            href="/accounts"
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200/80 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors w-fit"
          >
            <span>Set up your first account</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      {/* Primary Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Total Balance Card */}
        <div className="p-5 sm:p-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total Balance
            </span>
            <div className="mt-2">
              <MoneyAmount amount={totalBalance} size="2xl" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              {accounts.length} active {accounts.length === 1 ? "account" : "accounts"}
            </span>
            <Link
              href="/accounts"
              className="font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1"
            >
              <span>Manage</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Safe to Spend Card (Explicit Phase 1 Placeholder) */}
        <div className="p-5 sm:p-6 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-slate-500">
              <Sparkles className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Safe to Spend
              </span>
            </div>
            <div className="mt-3">
              <span className="text-base sm:text-lg font-semibold text-slate-600 block">
                Coming in Budget & Forecast phase
              </span>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Will calculate liquid balance minus recurring obligations and tax reserves.
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200/60 text-[11px] text-slate-400 font-medium">
            Phase 3 Roadmap
          </div>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Link
          href="/transactions/new?type=expense"
          className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 p-3 sm:p-3.5 bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold shadow-sm transition-all active:scale-[0.98]"
        >
          <ArrowUpRight className="w-4 h-4 text-rose-600" />
          <span>Add Expense</span>
        </Link>
        <Link
          href="/transactions/new?type=income"
          className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 p-3 sm:p-3.5 bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold shadow-sm transition-all active:scale-[0.98]"
        >
          <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
          <span>Add Income</span>
        </Link>
        <Link
          href="/transactions/new?type=transfer"
          className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 p-3 sm:p-3.5 bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold shadow-sm transition-all active:scale-[0.98]"
        >
          <ArrowLeftRight className="w-4 h-4 text-blue-600" />
          <span>Transfer</span>
        </Link>
      </div>

      {/* This Month's Cash Flow Summary */}
      <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            This Month Summary
          </h2>
          <span className="text-[11px] text-slate-400 font-medium">
            Excludes internal transfers
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1 divide-x divide-slate-100">
          <div>
            <span className="block text-xs text-slate-500 mb-1">Income</span>
            <MoneyAmount
              amount={monthSummary.income_total}
              type="income"
              size="lg"
            />
          </div>
          <div className="pl-3">
            <span className="block text-xs text-slate-500 mb-1">Expense</span>
            <MoneyAmount
              amount={monthSummary.expense_total}
              type="expense"
              size="lg"
            />
          </div>
          <div className="pl-3">
            <span className="block text-xs text-slate-500 mb-1">Net Flow</span>
            <MoneyAmount
              amount={monthSummary.net_cash_flow}
              type="net"
              size="lg"
            />
          </div>
        </div>
      </div>

      {/* Recent Transactions Ledger */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-base text-slate-900">
              Recent Transactions
            </h2>
          </div>
          {allTransactions.length > 0 && (
            <Link
              href="/transactions"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
            >
              <span>View all ({allTransactions.length})</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>

        {recentTransactions.length === 0 ? (
          <EmptyState
            title="ยังไม่มีรายการวันนี้"
            description="เริ่มจากเพิ่มรายรับ รายจ่าย หรือโอนเงินระหว่างบัญชี"
            actionHref="/transactions/new"
            actionLabel="เพิ่มรายการแรก"
          />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden divide-y divide-slate-100">
            {recentTransactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
