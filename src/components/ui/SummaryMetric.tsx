import React from "react";
import { MoneyAmount } from "./MoneyAmount";
import { TransactionType } from "@/types/finance";

interface SummaryMetricProps {
  label: string;
  amount: number;
  type?: TransactionType | "net";
  currency?: string;
  subtitle?: string;
  icon?: React.ReactNode;
}

export function SummaryMetric({
  label,
  amount,
  type,
  currency = "THB",
  subtitle,
  icon,
}: SummaryMetricProps) {
  return (
    <div className="p-4 sm:p-5 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 text-slate-500 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider">
          {label}
        </span>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>

      <div>
        <MoneyAmount
          amount={amount}
          type={type}
          currency={currency}
          size="xl"
          className="block"
        />
        {subtitle && (
          <p className="text-xs text-slate-500 mt-1 font-medium">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
