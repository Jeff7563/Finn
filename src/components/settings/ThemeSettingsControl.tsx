"use client";

import React from "react";
import { useTheme, ThemeMode } from "@/components/theme/ThemeProvider";
import { Monitor, Sun, Moon } from "lucide-react";

export function ThemeSettingsControl() {
  const { mode, setMode } = useTheme();

  const options: { value: ThemeMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: "system", label: "ตามระบบ", icon: Monitor },
    { value: "light", label: "สว่าง", icon: Sun },
    { value: "dark", label: "มืด", icon: Moon },
  ];

  return (
    <div
      role="group"
      aria-label="การแสดงผล"
      className="inline-flex items-center p-1 bg-surface-soft border border-border rounded-xl w-full sm:w-auto"
    >
      {options.map(({ value, label, icon: Icon }) => {
        const isSelected = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={isSelected}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px] ${
              isSelected
                ? "bg-surface text-text-primary shadow-xs border border-border/80"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ThemeQuickToggle() {
  const { mode, resolvedTheme, setMode } = useTheme();

  const toggle = () => {
    if (resolvedTheme === "dark") {
      setMode("light");
    } else {
      setMode("dark");
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
      title={`Theme: ${mode} (${resolvedTheme})`}
      className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-soft transition-colors"
    >
      {resolvedTheme === "dark" ? (
        <Sun className="w-4 h-4 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 text-slate-600" />
      )}
    </button>
  );
}
