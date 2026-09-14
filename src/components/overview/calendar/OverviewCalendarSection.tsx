"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Category, TransactionWithRelations } from "@/types/finance";
import { getLocalDateString, getMonthCalendarMatrix, MonthCalendarDay } from "@/lib/finance/calendar";
import { formatMoney } from "@/lib/finance/formatters";
import { CalendarMode, CalendarModeToggle } from "./CalendarModeToggle";
import { FinanceHeatmap } from "./FinanceHeatmap";
import { FinanceMonthCalendar } from "./FinanceMonthCalendar";
import { DaySummarySheet } from "./DaySummarySheet";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus } from "lucide-react";

interface OverviewCalendarSectionProps {
  transactions: TransactionWithRelations[];
  categories: Category[];
}

export function OverviewCalendarSection({
  transactions,
  categories,
}: OverviewCalendarSectionProps) {
  // Determine current year and month in Bangkok timezone
  const todayStr = getLocalDateString(new Date());
  const [initialYear, initialMonth] = todayStr
    ? todayStr.split("-").map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1];

  const [currentYear, setCurrentYear] = useState<number>(initialYear);
  const [currentMonth, setCurrentMonth] = useState<number>(initialMonth);
  const [mode, setMode] = useState<CalendarMode>("heatmap");
  const [selectedDay, setSelectedDay] = useState<MonthCalendarDay | null>(null);

  const isCurrentMonthView =
    currentYear === initialYear && currentMonth === initialMonth;

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleResetToCurrentMonth = () => {
    setCurrentYear(initialYear);
    setCurrentMonth(initialMonth);
  };

  // Deterministically compute calendar matrix & statistics for visible month
  const { days, stats } = useMemo(() => {
    return getMonthCalendarMatrix(
      currentYear,
      currentMonth,
      transactions,
      categories
    );
  }, [currentYear, currentMonth, transactions, categories]);

  // Update selectedDay if calendar recalculates
  const activeSelectedDay = useMemo(() => {
    if (!selectedDay) return null;
    return days.find((d) => d.date === selectedDay.date) || selectedDay;
  }, [selectedDay, days]);

  return (
    <section
      aria-labelledby="calendar-insights-title"
      className="p-5 sm:p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-4 transition-colors"
    >
      {/* Top Header: Section Title & Mode Segmented Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-text-muted" />
            <h2
              id="calendar-insights-title"
              className="font-semibold text-base sm:text-lg text-text-primary tracking-tight"
            >
              ภาพรวมตามปฏิทิน
            </h2>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            ความหนาแน่นของการใช้จ่ายและกิจกรรมรายวัน
          </p>
        </div>

        <div className="flex items-center gap-2">
          <CalendarModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      {/* Navigation & Compact Month Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Month Selector: ‹ กันยายน 2569 › */}
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center border border-border rounded-xl bg-surface-soft p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="เดือนก่อนหน้า"
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-all active:scale-95"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="px-3 text-xs sm:text-sm font-semibold text-text-primary min-w-[130px] text-center">
              {stats.monthNameThai}
            </span>

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="เดือนถัดไป"
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-all active:scale-95"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {!isCurrentMonthView && (
            <button
              type="button"
              onClick={handleResetToCurrentMonth}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-text-secondary bg-surface-soft hover:bg-surface-muted border border-border transition-all active:scale-95"
            >
              เดือนนี้
            </button>
          )}
        </div>

        {/* Compact Month Summary */}
        {stats.hasData && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary font-medium bg-surface-soft px-3 py-1.5 rounded-xl border border-border">
            <div>
              <span className="text-text-muted">รับ: </span>
              <span className="text-income font-semibold tabular-nums">
                +{formatMoney(stats.totalIncome, "THB", false)}
              </span>
            </div>
            <div className="w-px h-3 bg-border" />
            <div>
              <span className="text-text-muted">จ่าย: </span>
              <span className="text-expense font-semibold tabular-nums">
                -{formatMoney(stats.totalExpense, "THB", false)}
              </span>
            </div>
            <div className="w-px h-3 bg-border" />
            <div>
              <span className="text-text-muted">สุทธิ: </span>
              <span
                className={`font-semibold tabular-nums ${
                  stats.totalNet >= 0 ? "text-income" : "text-expense"
                }`}
              >
                {stats.totalNet >= 0 ? "+" : ""}
                {formatMoney(stats.totalNet, "THB", false)}
              </span>
            </div>
            <div className="w-px h-3 bg-border" />
            <div className="text-text-muted">
              {stats.totalTransactions} รายการ
            </div>
          </div>
        )}
      </div>

      {/* Main Grid View or Empty State */}
      {!stats.hasData ? (
        <div className="py-12 px-4 rounded-2xl border border-dashed border-border text-center space-y-3 bg-surface-soft/50">
          <div className="w-10 h-10 rounded-xl bg-surface-soft text-text-muted flex items-center justify-center mx-auto border border-border">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-text-primary">
              ยังไม่มีข้อมูลสำหรับปฏิทิน
            </h3>
            <p className="text-xs text-text-muted max-w-sm mx-auto">
              เมื่อคุณเริ่มบันทึกรายการ ระบบจะแสดงภาพรวมรายวันให้ที่นี่
            </p>
          </div>
          <div>
            <Link
              href="/transactions/new"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-text-primary bg-surface hover:bg-surface-soft border border-border rounded-xl transition-all shadow-2xs active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ เพิ่มรายการ</span>
            </Link>
          </div>
        </div>
      ) : mode === "heatmap" ? (
        <FinanceHeatmap
          days={days}
          selectedDate={activeSelectedDay?.date || null}
          onSelectDay={(d) => setSelectedDay(d)}
        />
      ) : (
        <FinanceMonthCalendar
          days={days}
          selectedDate={activeSelectedDay?.date || null}
          onSelectDay={(d) => setSelectedDay(d)}
        />
      )}

      {/* Day Summary Sheet modal */}
      <DaySummarySheet
        day={activeSelectedDay}
        onClose={() => setSelectedDay(null)}
      />
    </section>
  );
}
