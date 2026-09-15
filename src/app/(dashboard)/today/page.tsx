import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { isTransientJwtSkewError } from "@/lib/server/jwt-resilience";
import { DataStore } from "@/lib/server/data-store";
import { Account, TransactionWithRelations } from "@/types/finance";
import { Slip } from "@/types/slip";
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
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect("/login?error=session_invalid");
  }

  let accounts: Account[] = [];
  let allTransactions: TransactionWithRelations[] = [];
  let pendingSlips: Slip[] = [];

  try {
    const [pageData, fetchedSlips] = await Promise.all([
      DataStore.getTransactionsPageData(user.id),
      DataStore.getPendingReviewSlips(user.id),
    ]);
    accounts = pageData.accounts;
    allTransactions = pageData.transactions;
    pendingSlips = fetchedSlips;
  } catch (err: unknown) {
    if (isTransientJwtSkewError(err) || (err instanceof Error && err.message.includes("Authentication required"))) {
      redirect("/login?error=session_invalid");
    }
    throw err;
  }

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
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 border-b border-border pb-3">
        <div>
          <p className="text-xs font-medium text-text-muted">
            {todayThai}
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary mt-0.5">
            {displayName ? `${greeting}, ${displayName}` : greeting}
          </h1>
        </div>

        {accounts.length === 0 && (
          <Link
            href="/accounts"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary bg-surface-soft hover:bg-surface-muted px-3 py-1.5 rounded-lg border border-border transition-colors w-fit self-start sm:self-auto"
          >
            <span>ตั้งค่าบัญชีแรก</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      {/* Pending Review Slips Banner */}
      {pendingSlips.length > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-between gap-3 text-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div>
              <strong className="text-text-primary block font-semibold text-sm">
                มีสลิปที่ต้องตรวจสอบ ({pendingSlips.length} รายการ)
              </strong>
              <span className="text-text-secondary">
                มีสลิปธนาคารที่ส่งเข้ามาและรอการตรวจสอบหรือยืนยันความถูกต้อง
              </span>
            </div>
          </div>
          <Link
            href="/review"
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl text-xs flex-shrink-0 shadow-xs transition-colors"
          >
            เปิดตรวจสอบ
          </Link>
        </div>
      )}

      {/* Hero Balance Section */}
      <div className="bg-hero-gradient bg-surface dark:bg-surface-raised rounded-2xl p-6 border border-border shadow-sm relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <span className="text-xs font-semibold tracking-wider text-text-muted uppercase">
              ยอดเงินทั้งหมด <span className="text-[11px] font-normal text-text-muted">· Total Balance</span>
            </span>
            <div className="text-4xl sm:text-5xl font-extrabold text-text-primary tracking-tight">
              <MoneyAmount amount={totalBalance} size="2xl" />
            </div>
            <div className="flex items-center gap-2 pt-1 text-xs text-text-muted">
              <span
                className={`font-semibold tabular-nums ${
                  monthSummary.net_cash_flow >= 0
                    ? "text-income"
                    : "text-expense"
                }`}
              >
                {monthSummary.net_cash_flow >= 0 ? "+" : ""}
                {formatSignedMoney(monthSummary.net_cash_flow, monthSummary.net_cash_flow >= 0 ? "income" : "expense")} เดือนนี้
              </span>
              <span>·</span>
              <Link href="/accounts" className="hover:text-text-primary hover:underline">
                {accounts.length} บัญชี
              </Link>
            </div>
          </div>

          {/* Safe-to-Spend Subtle Indicator */}
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-soft/80 dark:bg-surface/80 rounded-xl border border-border text-xs text-text-secondary max-w-sm">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <div className="leading-tight">
              <span className="font-semibold text-text-primary">ใช้ได้อย่างปลอดภัย (Safe to Spend)</span>
              <span className="block text-[11px] text-text-muted">
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
          className="flex items-center justify-center gap-2 p-3 sm:p-3.5 bg-surface dark:bg-surface-raised rounded-xl border border-border hover:border-border-strong hover:bg-surface-soft text-text-primary text-xs sm:text-sm font-semibold shadow-xs transition-all active:scale-[0.98]"
        >
          <ArrowUpRight className="w-4 h-4 text-expense" />
          <span>+ รายจ่าย</span>
        </Link>
        <Link
          href="/transactions/new?type=income"
          className="flex items-center justify-center gap-2 p-3 sm:p-3.5 bg-surface dark:bg-surface-raised rounded-xl border border-border hover:border-border-strong hover:bg-surface-soft text-text-primary text-xs sm:text-sm font-semibold shadow-xs transition-all active:scale-[0.98]"
        >
          <ArrowDownLeft className="w-4 h-4 text-income" />
          <span>+ รายรับ</span>
        </Link>
        <Link
          href="/transactions/new?type=transfer"
          className="flex items-center justify-center gap-2 p-3 sm:p-3.5 bg-surface dark:bg-surface-raised rounded-xl border border-border hover:border-border-strong hover:bg-surface-soft text-text-primary text-xs sm:text-sm font-semibold shadow-xs transition-all active:scale-[0.98]"
        >
          <ArrowLeftRight className="w-4 h-4 text-transfer" />
          <span>↔ โอนเงิน</span>
        </Link>
      </div>

      {/* This Month's Cash Flow Summary */}
      <div className="p-4 sm:p-5 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            เดือนนี้ <span className="font-normal text-text-muted">· This Month Summary</span>
          </h2>
          <span className="text-[11px] text-text-muted">
            ไม่รวมการโอนเงินระหว่างบัญชี
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1 divide-x divide-border">
          <div>
            <span className="block text-xs text-text-muted mb-1">รายรับ</span>
            <MoneyAmount
              amount={monthSummary.income_total}
              type="income"
              size="lg"
            />
          </div>
          <div className="pl-3">
            <span className="block text-xs text-text-muted mb-1">รายจ่าย</span>
            <MoneyAmount
              amount={monthSummary.expense_total}
              type="expense"
              size="lg"
            />
          </div>
          <div className="pl-3">
            <span className="block text-xs text-text-muted mb-1">สุทธิ</span>
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
            <Clock className="w-4 h-4 text-text-muted" />
            <h2 className="font-semibold text-base text-text-primary">
              รายการล่าสุด
            </h2>
          </div>
          {allTransactions.length > 0 && (
            <Link
              href="/transactions"
              className="text-xs font-semibold text-text-secondary hover:text-text-primary flex items-center gap-1"
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
          <div className="bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm overflow-hidden divide-y divide-border">
            {recentTransactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
