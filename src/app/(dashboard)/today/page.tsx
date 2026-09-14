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
  formatDateThai,
  getGreetingThai,
  formatSignedMoney,
} from "@/lib/finance/formatters";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Sparkles,
  ChevronRight,
  Clock,
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

  const greeting = getGreetingThai();
  const displayName = user.display_name && user.display_name !== "User" && user.display_name !== "Fintech User"
    ? user.display_name
    : "";

  const todayThai = formatDateThai(new Date(), true);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-6">
      {/* Header Greeting & Date */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 border-b border-slate-100 pb-3">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {todayThai}
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 mt-0.5">
            {displayName ? `${greeting}, ${displayName}` : greeting}
          </h1>
        </div>

        {accounts.length === 0 && (
          <Link
            href="/accounts"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors w-fit self-start sm:self-auto"
          >
            <span>ตั้งค่าบัญชีแรก</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      {/* Hero Balance Section */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              ยอดเงินทั้งหมด <span className="text-[11px] font-normal text-slate-400">· Total Balance</span>
            </span>
            <div className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">
              <MoneyAmount amount={totalBalance} size="2xl" />
            </div>
            <div className="flex items-center gap-2 pt-1 text-xs text-slate-500">
              <span
                className={`font-semibold tabular-nums ${
                  monthSummary.net_cash_flow >= 0
                    ? "text-emerald-700"
                    : "text-rose-700"
                }`}
              >
                {monthSummary.net_cash_flow >= 0 ? "+" : ""}
                {formatSignedMoney(monthSummary.net_cash_flow, monthSummary.net_cash_flow >= 0 ? "income" : "expense")} เดือนนี้
              </span>
              <span>·</span>
              <Link href="/accounts" className="hover:text-slate-800 hover:underline">
                {accounts.length} บัญชี
              </Link>
            </div>
          </div>

          {/* Safe-to-Spend Subtle Indicator (Phase 1 placeholder, calm and compact) */}
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200/60 text-xs text-slate-600 max-w-sm">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <div className="leading-tight">
              <span className="font-semibold text-slate-700">ใช้ได้อย่างปลอดภัย (Safe to Spend)</span>
              <span className="block text-[11px] text-slate-400">
                Coming in Budget & Forecast phase
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions (3 buttons) */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Link
          href="/transactions/new?type=expense"
          className="flex items-center justify-center gap-2 p-3 sm:p-3.5 bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold shadow-sm transition-all active:scale-[0.98]"
        >
          <ArrowUpRight className="w-4 h-4 text-rose-600" />
          <span>+ รายจ่าย</span>
        </Link>
        <Link
          href="/transactions/new?type=income"
          className="flex items-center justify-center gap-2 p-3 sm:p-3.5 bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold shadow-sm transition-all active:scale-[0.98]"
        >
          <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
          <span>+ รายรับ</span>
        </Link>
        <Link
          href="/transactions/new?type=transfer"
          className="flex items-center justify-center gap-2 p-3 sm:p-3.5 bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold shadow-sm transition-all active:scale-[0.98]"
        >
          <ArrowLeftRight className="w-4 h-4 text-blue-600" />
          <span>↔ โอนเงิน</span>
        </Link>
      </div>

      {/* This Month's Cash Flow Summary */}
      <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            เดือนนี้ <span className="font-normal text-slate-400">· This Month Summary</span>
          </h2>
          <span className="text-[11px] text-slate-400">
            ไม่รวมการโอนเงินระหว่างบัญชี
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1 divide-x divide-slate-100">
          <div>
            <span className="block text-xs text-slate-500 mb-1">รายรับ</span>
            <MoneyAmount
              amount={monthSummary.income_total}
              type="income"
              size="lg"
            />
          </div>
          <div className="pl-3">
            <span className="block text-xs text-slate-500 mb-1">รายจ่าย</span>
            <MoneyAmount
              amount={monthSummary.expense_total}
              type="expense"
              size="lg"
            />
          </div>
          <div className="pl-3">
            <span className="block text-xs text-slate-500 mb-1">สุทธิ</span>
            <MoneyAmount
              amount={monthSummary.net_cash_flow}
              type="net"
              size="lg"
            />
          </div>
        </div>
      </div>

      {/* Recent Transactions Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-base text-slate-900">
              รายการล่าสุด
            </h2>
          </div>
          {allTransactions.length > 0 && (
            <Link
              href="/transactions"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
            >
              <span>ดูทั้งหมด ({allTransactions.length})</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>

        {recentTransactions.length === 0 ? (
          <EmptyState
            title="ยังไม่มีรายการ"
            description="เพิ่มรายรับหรือรายจ่ายรายการแรก เพื่อเริ่มดูภาพรวมการเงินของคุณ"
            actionHref="/transactions/new"
            actionLabel="+ เพิ่มรายการ"
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden divide-y divide-slate-100">
            {recentTransactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
