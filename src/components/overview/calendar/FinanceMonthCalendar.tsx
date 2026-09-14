"use client";

import React from "react";
import { MonthCalendarDay } from "@/lib/finance/calendar";
import { CalendarDayCell } from "./CalendarDayCell";
import { CalendarLegend } from "./CalendarLegend";

interface FinanceMonthCalendarProps {
  days: MonthCalendarDay[];
  selectedDate: string | null;
  onSelectDay: (day: MonthCalendarDay) => void;
}

const WEEKDAYS_THAI = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];

export function FinanceMonthCalendar({
  days,
  selectedDate,
  onSelectDay,
}: FinanceMonthCalendarProps) {
  return (
    <div className="space-y-3">
      {/* 7-column Weekday Headers */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center">
        {WEEKDAYS_THAI.map((dayLabel, idx) => (
          <div
            key={dayLabel}
            className={`text-xs font-medium py-1 ${
              idx >= 5 ? "text-text-muted" : "text-text-secondary"
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
            mode="calendar"
            isSelected={selectedDate === day.date}
            onSelect={onSelectDay}
          />
        ))}
      </div>

      {/* Calendar Legend */}
      <CalendarLegend mode="calendar" />
    </div>
  );
}
