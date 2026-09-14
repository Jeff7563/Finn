import { TransactionType } from "@/types/finance";

/**
 * Deterministically rounds a number to 2 decimal places to prevent floating point inaccuracies.
 */
export function roundToTwoDecimals(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Format a number as Thai Baht or given currency.
 * Example: formatMoney(12450) => "฿12,450.00"
 */
export function formatMoney(
  amount: number,
  currency: string = "THB",
  showDecimals: boolean = true
): string {
  const rounded = roundToTwoDecimals(Math.abs(amount));
  const symbol = currency === "THB" ? "฿" : `${currency} `;
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });

  return `${symbol}${formatted}`;
}

/**
 * Format an amount with standard sign and currency according to spec:
 * Income: +฿4,800.00
 * Expense: -฿389.00
 * Transfer: ฿5,000.00
 */
export function formatSignedMoney(
  amount: number,
  type: TransactionType,
  currency: string = "THB",
  showDecimals: boolean = true
): string {
  const base = formatMoney(amount, currency, showDecimals);
  if (type === "income" || type === "refund" || type === "reimbursement" || type === "gift") {
    return `+${base}`;
  }
  if (type === "expense" || type === "loan_payment") {
    return `-${base}`;
  }
  return base;
}

/**
 * Formats a date string into Thai/English readable date.
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Formats a date string with time.
 */
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
