"use client";

import React from "react";
import { CalendarMode } from "./CalendarModeToggle";

interface CalendarLegendProps {
  mode: CalendarMode;
}

export function CalendarLegend({ mode }: CalendarLegendProps) {
  if (mode === "heatmap") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 pt-3 border-t border-slate-100">
        {/* Heatmap intensity scale */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">ใช้จ่ายน้อย</span>
          <div className="flex items-center gap-1" aria-hidden="true">
            <span
              className="w-3.5 h-3.5 rounded bg-slate-100 border border-slate-200/60"
              title="ไม่มีรายจ่าย (0)"
            />
            <span
              className="w-3.5 h-3.5 rounded bg-rose-50 border border-rose-100"
              title="ระดับ 1 (น้อย)"
            />
            <span
              className="w-3.5 h-3.5 rounded bg-rose-100 border border-rose-200"
              title="ระดับ 2 (ปานกลางค่อนข้างน้อย)"
            />
            <span
              className="w-3.5 h-3.5 rounded bg-rose-200 border border-rose-300"
              title="ระดับ 3 (ปานกลางค่อนข้างมาก)"
            />
            <span
              className="w-3.5 h-3.5 rounded bg-rose-300 border border-rose-400"
              title="ระดับ 4 (มาก)"
            />
          </div>
          <span className="text-slate-600 font-medium">ใช้จ่ายมาก</span>
        </div>

        {/* Activity dots explanation */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-slate-600">มีรายรับ</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-slate-600">มีโอนเงิน</span>
          </div>
        </div>
      </div>
    );
  }

  // Calendar mode legend
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 pt-3 border-t border-slate-100">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-emerald-600 font-semibold">+฿</span>
          <span className="text-slate-600">รายรับ</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-rose-600 font-semibold">-฿</span>
          <span className="text-slate-600">รายจ่าย</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-slate-600">โอนเงิน</span>
        </div>
      </div>

      <span className="text-[10px] text-slate-400">
        แตะที่วันเพื่อดูรายละเอียดธุรกรรม
      </span>
    </div>
  );
}
