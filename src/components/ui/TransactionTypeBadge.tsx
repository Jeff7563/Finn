import React from "react";
import { TransactionType } from "@/types/finance";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, HelpCircle } from "lucide-react";

interface TransactionTypeBadgeProps {
  type: TransactionType;
  showIcon?: boolean;
}

export function TransactionTypeBadge({
  type,
  showIcon = true,
}: TransactionTypeBadgeProps) {
  switch (type) {
    case "income":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200/60">
          {showIcon && <ArrowDownLeft className="w-3 h-3 text-emerald-600" aria-hidden="true" />}
          Income
        </span>
      );
    case "expense":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200/60">
          {showIcon && <ArrowUpRight className="w-3 h-3 text-rose-600" aria-hidden="true" />}
          Expense
        </span>
      );
    case "transfer":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200/60">
          {showIcon && <ArrowLeftRight className="w-3 h-3 text-blue-600" aria-hidden="true" />}
          Transfer
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
          {showIcon && <HelpCircle className="w-3 h-3 text-slate-500" aria-hidden="true" />}
          {type}
        </span>
      );
  }
}
