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
      className="inline-flex items-center p-1 bg-surface-soft rounded-xl border border-border"
    >
      <button
        type="button"
        onClick={() => onChange("heatmap")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          mode === "heatmap"
            ? "bg-surface text-text-primary shadow-xs border border-border/80"
            : "text-text-muted hover:text-text-primary"
        }`}
        aria-pressed={mode === "heatmap"}
      >
        <Flame className="w-3.5 h-3.5 text-expense" />
        <span>Heatmap</span>
      </button>

      <button
        type="button"
        onClick={() => onChange("calendar")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          mode === "calendar"
            ? "bg-surface text-text-primary shadow-xs border border-border/80"
            : "text-text-muted hover:text-text-primary"
        }`}
        aria-pressed={mode === "calendar"}
      >
        <CalendarIcon className="w-3.5 h-3.5 text-text-secondary" />
        <span>Calendar</span>
      </button>
    </div>
  );
}
