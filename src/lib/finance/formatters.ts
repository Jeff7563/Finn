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
  if (
    type === "income" ||
    type === "refund" ||
    type === "reimbursement" ||
    type === "gift"
  ) {
    return `+${base}`;
  }
  if (type === "expense" || type === "loan_payment") {
    return `-${base}`;
  }
  return base;
}

/**
 * Formats a date string into readable English date (preserved for backwards compatibility).
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
 * Formats a date string with time (preserved for backwards compatibility).
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

const THAI_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

const THAI_MONTHS_FULL = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

/**
 * Formats date into Thai: e.g. "14 ก.ย. 2569" or "14 กันยายน 2569"
 */
export function formatDateThai(
  dateInput: string | Date,
  fullMonth: boolean = false
): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);

  const day = date.getDate();
  const month = fullMonth
    ? THAI_MONTHS_FULL[date.getMonth()]
    : THAI_MONTHS_SHORT[date.getMonth()];
  const year = date.getFullYear() + 543;

  return `${day} ${month} ${year}`;
}

/**
 * Formats time into Thai format: "12:42"
 */
export function formatTime(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Formats relative date or full date for transaction ledger:
 * "วันนี้ 12:42", "เมื่อวาน 18:15", "14 ก.ย. 12:42"
 */
export function formatDateTimeThai(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);

  const now = new Date();
  const timeStr = formatTime(date);

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isToday) {
    return `วันนี้ ${timeStr}`;
  }
  if (isYesterday) {
    return `เมื่อวาน ${timeStr}`;
  }

  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${timeStr}`;
}

/**
 * Groups date heading: "วันนี้ · 14 ก.ย.", "เมื่อวาน · 13 ก.ย.", "10 ก.ย. 2569"
 */
export function formatDayHeadingThai(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);

  const now = new Date();
  const day = date.getDate();
  const monthShort = THAI_MONTHS_SHORT[date.getMonth()];
  const yearBE = date.getFullYear() + 543;

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isToday) {
    return `วันนี้ · ${day} ${monthShort}`;
  }
  if (isYesterday) {
    return `เมื่อวาน · ${day} ${monthShort}`;
  }

  return `${day} ${monthShort} ${yearBE}`;
}

/**
 * Thai greeting based on current hour
 */
export function getGreetingThai(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return "สวัสดีตอนเช้า";
  }
  if (hour >= 12 && hour < 17) {
    return "สวัสดีตอนบ่าย";
  }
  return "สวัสดีตอนเย็น";
}
