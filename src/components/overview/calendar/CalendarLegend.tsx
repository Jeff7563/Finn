"use client";

import React from "react";
import { CalendarMode } from "./CalendarModeToggle";

interface CalendarLegendProps {
  mode: CalendarMode;
}

export function CalendarLegend({ mode }: CalendarLegendProps) {
  if (mode === "heatmap") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-text-secondary pt-3 border-t border-border">
        {/* Heatmap intensity scale */}
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">ใช้จ่ายน้อย</span>
          <div className="flex items-center gap-1" aria-hidden="true">
            <span
              className="w-3.5 h-3.5 rounded bg-surface-soft border border-border dark:bg-[#142133] dark:border-[#223149]"
              title="ไม่มีรายจ่าย (0)"
            />
            <span
              className="w-3.5 h-3.5 rounded bg-[#EEF2FF] border border-[#C7D2FE] dark:bg-[#0D2830] dark:border-[#134E5E]"
              title="ระดับ 1 (น้อย)"
            />
            <span
              className="w-3.5 h-3.5 rounded bg-[#DDD6FE] border border-[#C4B5FD] dark:bg-[#113E4B] dark:border-[#147287]"
              title="ระดับ 2 (ปานกลางค่อนข้างน้อย)"
            />
            <span
              className="w-3.5 h-3.5 rounded bg-[#C4B5FD] border border-[#A78BFA] dark:bg-[#135263] dark:border-[#14B8A6]"
              title="ระดับ 3 (ปานกลางค่อนข้างมาก)"
            />
            <span
              className="w-3.5 h-3.5 rounded bg-[#A78BFA] border border-[#8B5CF6] dark:bg-[#166574] dark:border-[#2DD4BF]"
              title="ระดับ 4 (มาก)"
            />
          </div>
          <span className="text-text-primary font-medium">ใช้จ่ายมาก</span>
        </div>

        {/* Activity dots explanation */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-income" />
            <span className="text-text-secondary">มีรายรับ</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-transfer" />
            <span className="text-text-secondary">มีโอนเงิน</span>
          </div>
        </div>
      </div>
    );
  }

  // Calendar mode legend
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-text-secondary pt-3 border-t border-border">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-income font-semibold">+฿</span>
          <span className="text-text-secondary">รายรับ</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-expense font-semibold">-฿</span>
          <span className="text-text-secondary">รายจ่าย</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-transfer" />
          <span className="text-text-secondary">โอนเงิน</span>
        </div>
      </div>

      <span className="text-[10px] text-text-muted">
        แตะที่วันเพื่อดูรายละเอียดธุรกรรม
      </span>
    </div>
  );
}
