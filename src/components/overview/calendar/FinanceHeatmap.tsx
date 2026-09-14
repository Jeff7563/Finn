"use client";

import React from "react";
import { MonthCalendarDay } from "@/lib/finance/calendar";
import { CalendarDayCell } from "./CalendarDayCell";
import { CalendarLegend } from "./CalendarLegend";

interface FinanceHeatmapProps {
  days: MonthCalendarDay[];
  selectedDate: string | null;
  onSelectDay: (day: MonthCalendarDay) => void;
}

const WEEKDAYS_THAI = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];

export function FinanceHeatmap({
  days,
  selectedDate,
  onSelectDay,
}: FinanceHeatmapProps) {
  return (
    <div className="space-y-3">
      {/* 7-column Weekday Headers */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center">
        {WEEKDAYS_THAI.map((dayLabel, idx) => (
          <div
            key={dayLabel}
            className={`text-xs font-medium py-1 ${
              idx >= 5 ? "text-slate-400" : "text-slate-600"
            }`}
          >
            {dayLabel}
          </div>
        ))}
      </div>

      {/* 7-column Day Grid */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {days.map((day) => (
          <CalendarDayCell
            key={day.date}
            day={day}
            mode="heatmap"
            isSelected={selectedDate === day.date}
            onSelect={onSelectDay}
          />
        ))}
      </div>

      {/* Heatmap Legend */}
      <CalendarLegend mode="heatmap" />
    </div>
  );
}
