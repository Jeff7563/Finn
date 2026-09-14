"use client";

import React from "react";
import { Flame, Calendar as CalendarIcon } from "lucide-react";

export type CalendarMode = "heatmap" | "calendar";

interface CalendarModeToggleProps {
  mode: CalendarMode;
  onChange: (mode: CalendarMode) => void;
}

export function CalendarModeToggle({ mode, onChange }: CalendarModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="เลือกมุมมองปฏิทิน"
      className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200/60"
    >
      <button
        type="button"
        onClick={() => onChange("heatmap")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          mode === "heatmap"
            ? "bg-white text-slate-900 shadow-xs"
            : "text-slate-500 hover:text-slate-900"
        }`}
        aria-pressed={mode === "heatmap"}
      >
        <Flame className="w-3.5 h-3.5 text-rose-500" />
        <span>Heatmap</span>
      </button>

      <button
        type="button"
        onClick={() => onChange("calendar")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          mode === "calendar"
            ? "bg-white text-slate-900 shadow-xs"
            : "text-slate-500 hover:text-slate-900"
        }`}
        aria-pressed={mode === "calendar"}
      >
        <CalendarIcon className="w-3.5 h-3.5 text-slate-600" />
        <span>Calendar</span>
      </button>
    </div>
  );
}
