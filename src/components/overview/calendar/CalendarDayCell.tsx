"use client";

import React from "react";
import { MonthCalendarDay } from "@/lib/finance/calendar";
import { CalendarMode } from "./CalendarModeToggle";
import { formatMoney } from "@/lib/finance/formatters";

interface CalendarDayCellProps {
  day: MonthCalendarDay;
  mode: CalendarMode;
  isSelected: boolean;
  onSelect: (day: MonthCalendarDay) => void;
}

export function CalendarDayCell({
  day,
  mode,
  isSelected,
  onSelect,
}: CalendarDayCellProps) {
  const { isCurrentMonth, isToday, summary, heatmapIntensity } = day;

  // Build accessible label for screen readers
  const accessibleParts = [`วันที่ ${day.day}`];
  if (summary.income > 0) {
    accessibleParts.push(`รายรับ ${formatMoney(summary.income)}`);
  }
  if (summary.expense > 0) {
    accessibleParts.push(`รายจ่าย ${formatMoney(summary.expense)}`);
  }
  if (summary.transfer > 0) {
    accessibleParts.push(`โอนเงิน ${formatMoney(summary.transfer)}`);
  }
  if (summary.transactionCount > 0) {
    accessibleParts.push(`${summary.transactionCount} รายการ`);
  } else {
    accessibleParts.push("ไม่มีรายการ");
  }
  const ariaLabel = accessibleParts.join(", ");

  if (!isCurrentMonth) {
    return (
      <div
        aria-hidden="true"
        className="w-full min-h-[44px] sm:min-h-[52px] rounded-xl border border-transparent bg-surface-soft/20 text-text-muted/40 flex items-center justify-center text-xs select-none pointer-events-none"
      >
        <span>{day.day}</span>
      </div>
    );
  }

  // Heatmap mode styling based on intensity 0-4
  // Light: neutral → lavender → violet
  // Dark: muted navy → teal → emerald-teal
  if (mode === "heatmap") {
    let intensityClasses =
      "bg-surface-soft border-border text-text-primary hover:bg-surface-muted dark:bg-[#142133] dark:border-[#223149] dark:text-slate-200 dark:hover:bg-[#182639]";

    if (heatmapIntensity === 1) {
      intensityClasses =
        "bg-[#EEF2FF] border-[#C7D2FE] text-[#4338CA] hover:bg-[#E0E7FF] dark:bg-[#0D2830] dark:border-[#134E5E] dark:text-[#2DD4BF] dark:hover:bg-[#10343F]";
    } else if (heatmapIntensity === 2) {
      intensityClasses =
        "bg-[#DDD6FE] border-[#C4B5FD] text-[#4C1D95] hover:bg-[#EDE9FE] dark:bg-[#113E4B] dark:border-[#147287] dark:text-[#5EEAD4] dark:hover:bg-[#144A59]";
    } else if (heatmapIntensity === 3) {
      intensityClasses =
        "bg-[#C4B5FD] border-[#A78BFA] text-[#3B0764] hover:bg-[#B496FC] font-semibold dark:bg-[#135263] dark:border-[#14B8A6] dark:text-[#99F6E4] dark:hover:bg-[#165E71]";
    } else if (heatmapIntensity === 4) {
      intensityClasses =
        "bg-[#A78BFA] border-[#8B5CF6] text-[#2E1065] hover:bg-[#9061F9] font-bold dark:bg-[#166574] dark:border-[#2DD4BF] dark:text-[#CCFBF1] dark:hover:bg-[#197485]";
    }

    return (
      <button
        type="button"
        onClick={() => onSelect(day)}
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        className={`relative w-full min-h-[44px] sm:min-h-[52px] rounded-xl border p-1 sm:p-1.5 flex flex-col items-center justify-between transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${intensityClasses} ${
          isSelected
            ? "ring-2 ring-indigo-600 dark:ring-teal-400 ring-offset-2 ring-offset-surface dark:ring-offset-[#08111F] z-10 shadow-sm"
            : ""
        } ${
          isToday
            ? "ring-1.5 ring-slate-800 dark:ring-teal-400 ring-offset-0.5"
            : ""
        }`}
      >
        {/* Day Number */}
        <span
          className={`text-xs sm:text-sm tabular-nums leading-none ${
            isToday ? "font-bold underline decoration-current underline-offset-2" : ""
          }`}
        >
          {day.day}
        </span>

        {/* Activity Indicators: Income (green) and Transfer (blue) */}
        <div className="flex items-center justify-center gap-1 min-h-[6px]">
          {summary.income > 0 && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-income flex-shrink-0"
              title={`รายรับ ${formatMoney(summary.income)}`}
            />
          )}
          {summary.transfer > 0 && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-transfer flex-shrink-0"
              title={`โอนเงิน ${formatMoney(summary.transfer)}`}
            />
          )}
        </div>
      </button>
    );
  }

  // Calendar mode styling
  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      className={`relative w-full min-h-[56px] sm:min-h-[72px] rounded-xl border p-1 sm:p-1.5 flex flex-col justify-between text-left transition-all bg-surface hover:bg-surface-soft border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
        isSelected
          ? "ring-2 ring-indigo-600 dark:ring-teal-400 ring-offset-2 ring-offset-surface dark:ring-offset-[#08111F] z-10 shadow-sm"
          : ""
      } ${
        isToday
          ? "ring-1.5 ring-primary bg-primary-soft/20"
          : ""
      }`}
    >
      {/* Top row: day number and transfer dot */}
      <div className="flex items-center justify-between w-full">
        <span
          className={`text-xs sm:text-sm tabular-nums leading-none ${
            isToday
              ? "font-bold text-text-primary underline decoration-current underline-offset-2"
              : "text-text-primary font-medium"
          }`}
        >
          {day.day}
        </span>
        {summary.transfer > 0 && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-transfer"
            title={`โอนเงิน ${formatMoney(summary.transfer)}`}
          />
        )}
      </div>

      {/* Middle: Financial amounts */}
      <div className="w-full space-y-0.5 overflow-hidden my-0.5">
        {summary.expense > 0 && (
          <div className="text-[10px] sm:text-xs font-semibold text-expense truncate tabular-nums leading-tight">
            -{formatMoney(summary.expense, "THB", false)}
          </div>
        )}
        {summary.income > 0 && (
          <div className="text-[10px] sm:text-xs font-semibold text-income truncate tabular-nums leading-tight">
            +{formatMoney(summary.income, "THB", false)}
          </div>
        )}
      </div>

      {/* Bottom: Transaction count (desktop only) */}
      <div className="hidden sm:block text-[9px] text-text-muted truncate leading-none">
        {summary.transactionCount > 0 ? `${summary.transactionCount} รายการ` : ""}
      </div>
    </button>
  );
}
