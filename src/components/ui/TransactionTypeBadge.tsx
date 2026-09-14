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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-income-soft text-income border border-income/30">
          {showIcon && <ArrowDownLeft className="w-3 h-3 text-income" aria-hidden="true" />}
          รายรับ
        </span>
      );
    case "expense":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-expense-soft text-expense border border-expense/30">
          {showIcon && <ArrowUpRight className="w-3 h-3 text-expense" aria-hidden="true" />}
          รายจ่าย
        </span>
      );
    case "transfer":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-transfer-soft text-transfer border border-transfer/30">
          {showIcon && <ArrowLeftRight className="w-3 h-3 text-transfer" aria-hidden="true" />}
          โอนเงิน
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-surface-soft text-text-secondary border border-border">
          {showIcon && <HelpCircle className="w-3 h-3 text-text-muted" aria-hidden="true" />}
          {type}
        </span>
      );
  }
}
