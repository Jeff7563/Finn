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
        className="w-full min-h-[44px] sm:min-h-[52px] rounded-xl border border-transparent bg-slate-50/30 text-slate-300 flex items-center justify-center text-xs select-none pointer-events-none"
      >
        <span>{day.day}</span>
      </div>
    );
  }

  // Heatmap mode styling based on intensity 0-4
  if (mode === "heatmap") {
    let intensityClasses = "bg-slate-50/80 border-slate-200/60 text-slate-700 hover:bg-slate-100";

    if (heatmapIntensity === 1) {
      intensityClasses = "bg-rose-50 border-rose-200/70 text-rose-700 hover:bg-rose-100";
    } else if (heatmapIntensity === 2) {
      intensityClasses = "bg-rose-100 border-rose-200 text-rose-800 hover:bg-rose-200";
    } else if (heatmapIntensity === 3) {
      intensityClasses = "bg-rose-200 border-rose-300 text-rose-900 hover:bg-rose-300 font-semibold";
    } else if (heatmapIntensity === 4) {
      intensityClasses = "bg-rose-300 border-rose-400 text-rose-950 hover:bg-rose-400 font-bold";
    }

    return (
      <button
        type="button"
        onClick={() => onSelect(day)}
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        className={`relative w-full min-h-[44px] sm:min-h-[52px] rounded-xl border p-1 sm:p-1.5 flex flex-col items-center justify-between transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 ${intensityClasses} ${
          isSelected
            ? "ring-2 ring-slate-900 ring-offset-2 z-10 shadow-sm"
            : ""
        } ${
          isToday
            ? "ring-1.5 ring-slate-800 ring-offset-0.5"
            : ""
        }`}
      >
        {/* Day Number */}
        <span
          className={`text-xs sm:text-sm tabular-nums leading-none ${
            isToday ? "font-bold underline decoration-slate-800 underline-offset-2" : ""
          }`}
        >
          {day.day}
        </span>

        {/* Activity Indicators: Income (green) and Transfer (blue) */}
        <div className="flex items-center justify-center gap-1 min-h-[6px]">
          {summary.income > 0 && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0"
              title={`รายรับ ${formatMoney(summary.income)}`}
            />
          )}
          {summary.transfer > 0 && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"
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
      className={`relative w-full min-h-[56px] sm:min-h-[72px] rounded-xl border p-1 sm:p-1.5 flex flex-col justify-between text-left transition-all bg-white hover:bg-slate-50/80 border-slate-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 ${
        isSelected
          ? "ring-2 ring-slate-900 ring-offset-2 z-10 shadow-sm"
          : ""
      } ${
        isToday
          ? "ring-1.5 ring-slate-800 bg-slate-50/50"
          : ""
      }`}
    >
      {/* Top row: day number and transfer dot */}
      <div className="flex items-center justify-between w-full">
        <span
          className={`text-xs sm:text-sm tabular-nums leading-none ${
            isToday
              ? "font-bold text-slate-950 underline decoration-slate-800 underline-offset-2"
              : "text-slate-700 font-medium"
          }`}
        >
          {day.day}
        </span>
        {summary.transfer > 0 && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-blue-500"
            title={`โอนเงิน ${formatMoney(summary.transfer)}`}
          />
        )}
      </div>

      {/* Middle: Financial amounts (clean and responsive) */}
      <div className="w-full space-y-0.5 overflow-hidden my-0.5">
        {summary.expense > 0 && (
          <div className="text-[10px] sm:text-xs font-semibold text-rose-600 truncate tabular-nums leading-tight">
            -{formatMoney(summary.expense, "THB", false)}
          </div>
        )}
        {summary.income > 0 && (
          <div className="text-[10px] sm:text-xs font-semibold text-emerald-600 truncate tabular-nums leading-tight">
            +{formatMoney(summary.income, "THB", false)}
          </div>
        )}
      </div>

      {/* Bottom: Transaction count (desktop only) */}
      <div className="hidden sm:block text-[9px] text-slate-400 truncate leading-none">
        {summary.transactionCount > 0 ? `${summary.transactionCount} รายการ` : ""}
      </div>
    </button>
  );
}
