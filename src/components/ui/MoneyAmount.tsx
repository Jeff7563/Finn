import React from "react";
import { TransactionType } from "@/types/finance";
import { formatMoney, formatSignedMoney } from "@/lib/finance/formatters";

interface MoneyAmountProps {
  amount: number;
  type?: TransactionType | "net";
  currency?: string;
  showDecimals?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
}

export function MoneyAmount({
  amount,
  type,
  currency = "THB",
  showDecimals = true,
  size = "md",
  className = "",
}: MoneyAmountProps) {
  const sizeClasses = {
    sm: "text-sm font-medium",
    md: "text-base font-semibold",
    lg: "text-lg font-semibold tracking-tight",
    xl: "text-2xl font-bold tracking-tight",
    "2xl": "text-3xl sm:text-4xl font-extrabold tracking-tight",
  };

  if (!type) {
    return (
      <span className={`tabular-nums text-text-primary ${sizeClasses[size]} ${className}`}>
        {formatMoney(amount, currency, showDecimals)}
      </span>
    );
  }

  if (type === "net") {
    const isPositive = amount > 0;
    const isNegative = amount < 0;
    const color = isPositive
      ? "text-income"
      : isNegative
      ? "text-expense"
      : "text-text-primary";
    const sign = isPositive ? "+" : isNegative ? "-" : "";

    return (
      <span className={`tabular-nums ${color} ${sizeClasses[size]} ${className}`}>
        {sign}
        {formatMoney(Math.abs(amount), currency, showDecimals)}
      </span>
    );
  }

  const formatted = formatSignedMoney(amount, type, currency, showDecimals);
  const color =
    type === "income" || type === "refund" || type === "reimbursement" || type === "gift"
      ? "text-income"
      : type === "expense" || type === "loan_payment"
      ? "text-expense"
      : "text-text-primary";

  return (
    <span className={`tabular-nums ${color} ${sizeClasses[size]} ${className}`}>
      {formatted}
    </span>
  );
}
