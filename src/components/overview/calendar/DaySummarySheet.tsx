"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { MonthCalendarDay } from "@/lib/finance/calendar";
import { formatDateThai, formatMoney, formatSignedMoney } from "@/lib/finance/formatters";
import { X, ArrowRight, Plus, Calendar, Tag, ArrowLeftRight } from "lucide-react";

interface DaySummarySheetProps {
  day: MonthCalendarDay | null;
  onClose: () => void;
}

export function DaySummarySheet({ day, onClose }: DaySummarySheetProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!day) return null;

  const { summary } = day;
  const hasTransactions = summary.transactionCount > 0;
  const thaiFullDate = formatDateThai(day.date, true);
  const previewTransactions = summary.transactions.slice(0, 3);
  const remainingCount = Math.max(0, summary.transactionCount - 3);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-summary-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface rounded-t-3xl sm:rounded-2xl border border-border shadow-xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[90vh] transition-transform animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile handle indicator */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border-strong" />
        </div>

        {/* Header */}
        <div className="px-5 py-3.5 sm:py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-soft border border-border flex items-center justify-center text-text-primary">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="day-summary-title"
                className="font-semibold text-text-primary text-sm sm:text-base leading-tight"
              >
                {thaiFullDate}
              </h2>
              <span className="text-[11px] text-text-muted">
                {hasTransactions ? `${summary.transactionCount} รายการในวันนี้` : "ไม่มีรายการ"}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างสรุปประจำวัน"
            className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-soft transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {hasTransactions ? (
            <>
              {/* Daily Totals Cards */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 bg-income-soft border border-income/20 rounded-xl">
                  <span className="text-[11px] font-medium text-income block">
                    รายรับ
                  </span>
                  <div className="text-base font-bold text-income tabular-nums mt-0.5">
                    +{formatMoney(summary.income)}
                  </div>
                </div>

                <div className="p-3 bg-expense-soft border border-expense/20 rounded-xl">
                  <span className="text-[11px] font-medium text-expense block">
                    รายจ่าย
                  </span>
                  <div className="text-base font-bold text-expense tabular-nums mt-0.5">
                    -{formatMoney(summary.expense)}
                  </div>
                </div>
              </div>

              {/* Transfer & Net Row */}
              <div className="p-3 bg-surface-soft border border-border rounded-xl flex items-center justify-between text-xs">
                {summary.transfer > 0 ? (
                  <div className="flex items-center gap-1.5 text-transfer font-medium">
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>โอนเงิน: {formatMoney(summary.transfer)}</span>
                  </div>
                ) : (
                  <div className="text-text-muted">
                    ยอดรวมสุทธิวันนี้
                  </div>
                )}

                <div className="font-semibold tabular-nums text-text-primary">
                  สุทธิ:{" "}
                  <span
                    className={
                      summary.net >= 0 ? "text-income" : "text-expense"
                    }
                  >
                    {summary.net >= 0 ? "+" : ""}
                    {formatMoney(summary.net)}
                  </span>
                </div>
              </div>

              {/* Top Expense Category */}
              {summary.topExpenseCategory && (
                <div className="flex items-center justify-between p-3 bg-surface-soft border border-border rounded-xl text-xs">
                  <div className="flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-text-muted">ใช้จ่ายมากที่สุด</span>
                  </div>
                  <span className="font-semibold text-text-primary">
                    {summary.topExpenseCategory.name} · {formatMoney(summary.topExpenseCategory.amount)}
                  </span>
                </div>
              )}

              {/* Transactions Preview */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs text-text-secondary font-medium">
                  <span>ตัวอย่างรายการ</span>
                  {remainingCount > 0 && (
                    <span className="text-text-muted">
                      (+ อีก {remainingCount} รายการ)
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 divide-y divide-border">
                  {previewTransactions.map((tx) => {
                    const title =
                      tx.description ||
                      tx.merchant?.display_name ||
                      tx.person?.display_name ||
                      (tx.type === "transfer" ? "โอนระหว่างบัญชี" : "รายการไม่ระบุชื่อ");

                    return (
                      <div
                        key={tx.id}
                        className="pt-1.5 first:pt-0 flex items-center justify-between text-xs"
                      >
                        <div className="truncate pr-2">
                          <span className="font-medium text-text-primary block truncate">
                            {title}
                          </span>
                          <span className="text-[10px] text-text-muted">
                            {tx.category?.name || (tx.type === "transfer" ? "โอนเงิน" : "ทั่วไป")}
                          </span>
                        </div>
                        <div className="tabular-nums font-semibold flex-shrink-0">
                          {formatSignedMoney(tx.amount, tx.type)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* CTA: ดูรายการวันนี้ */}
              <div className="pt-2">
                <Link
                  href={`/transactions?date=${day.date}`}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover transition-all shadow-xs active:scale-[0.98]"
                >
                  <span>ดูรายการวันนี้</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </>
          ) : (
            /* Empty state for the selected day */
            <div className="py-6 text-center space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-text-primary">
                  ยังไม่มีรายการในวันนี้
                </p>
                <p className="text-xs text-text-muted">
                  ไม่มีการเคลื่อนไหวทางการเงินในวันที่ {thaiFullDate}
                </p>
              </div>

              <Link
                href={`/transactions/new?date=${day.date}`}
                className="inline-flex items-center gap-1.5 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-text-primary bg-surface-soft hover:bg-surface-muted border border-border transition-all active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                <span>+ เพิ่มรายการ</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
