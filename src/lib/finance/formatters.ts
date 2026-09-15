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
export function formatDate(
  dateString: string,
  timeZone: string = "Asia/Bangkok"
): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Formats a date string with time (preserved for backwards compatibility).
 */
export function formatDateTime(
  dateString: string,
  timeZone: string = "Asia/Bangkok"
): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
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
  fullMonth: boolean = false,
  timeZone: string = "Asia/Bangkok"
): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);
  const monthIdx =
    parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
  const year =
    parseInt(parts.find((p) => p.type === "year")?.value || "0", 10) + 543;

  const month = fullMonth
    ? THAI_MONTHS_FULL[monthIdx]
    : THAI_MONTHS_SHORT[monthIdx];

  return `${day} ${month} ${year}`;
}

/**
 * Formats time into Thai format: "12:42" (Asia/Bangkok by default)
 */
export function formatTime(
  dateInput: string | Date,
  timeZone: string = "Asia/Bangkok"
): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Formats relative date or full date for transaction ledger:
 * "วันนี้ 12:42", "เมื่อวาน 18:15", "14 ก.ย. 12:42" (Asia/Bangkok by default)
 */
export function formatDateTimeThai(
  dateInput: string | Date,
  timeZone: string = "Asia/Bangkok"
): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);

  const now = new Date();
  const timeStr = formatTime(date, timeZone);

  const getLocalDateParts = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(d);
    const day = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);
    const month =
      parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
    const year = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
    return { day, month, year };
  };

  const dParts = getLocalDateParts(date);
  const nowParts = getLocalDateParts(now);

  const isToday =
    dParts.day === nowParts.day &&
    dParts.month === nowParts.month &&
    dParts.year === nowParts.year;

  const nowDayEpoch = Date.UTC(nowParts.year, nowParts.month, nowParts.day);
  const dDayEpoch = Date.UTC(dParts.year, dParts.month, dParts.day);
  const diffDays = Math.round(
    (nowDayEpoch - dDayEpoch) / (1000 * 60 * 60 * 24)
  );
  const isYesterday = diffDays === 1;

  if (isToday) {
    return `วันนี้ ${timeStr}`;
  }
  if (isYesterday) {
    return `เมื่อวาน ${timeStr}`;
  }

  return `${dParts.day} ${THAI_MONTHS_SHORT[dParts.month]} ${timeStr}`;
}

/**
 * Groups date heading: "วันนี้ · 14 ก.ย.", "เมื่อวาน · 13 ก.ย.", "10 ก.ย. 2569"
 */
export function formatDayHeadingThai(
  dateInput: string | Date,
  timeZone: string = "Asia/Bangkok"
): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);

  const now = new Date();
  const getLocalDateParts = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(d);
    const day = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);
    const month =
      parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
    const year = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
    return { day, month, year };
  };

  const dParts = getLocalDateParts(date);
  const nowParts = getLocalDateParts(now);

  const isToday =
    dParts.day === nowParts.day &&
    dParts.month === nowParts.month &&
    dParts.year === nowParts.year;

  const nowDayEpoch = Date.UTC(nowParts.year, nowParts.month, nowParts.day);
  const dDayEpoch = Date.UTC(dParts.year, dParts.month, dParts.day);
  const diffDays = Math.round(
    (nowDayEpoch - dDayEpoch) / (1000 * 60 * 60 * 24)
  );
  const isYesterday = diffDays === 1;

  const monthShort = THAI_MONTHS_SHORT[dParts.month];
  const yearBE = dParts.year + 543;

  if (isToday) {
    return `วันนี้ · ${dParts.day} ${monthShort}`;
  }
  if (isYesterday) {
    return `เมื่อวาน · ${dParts.day} ${monthShort}`;
  }

  return `${dParts.day} ${monthShort} ${yearBE}`;
}

/**
 * Formats a date into `YYYY-MM-DDTHH:mm` format suitable for `<input type="datetime-local">` in Asia/Bangkok local time.
 */
export function formatDateTimeLocal(
  dateInput: string | Date,
  timeZone: string = "Asia/Bangkok"
): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Thai greeting based on current hour in Asia/Bangkok
 */
export function getGreetingThai(timeZone: string = "Asia/Bangkok"): string {
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  const hour = parseInt(hourStr, 10);
  if (hour >= 5 && hour < 12) {
    return "สวัสดีตอนเช้า";
  }
  if (hour >= 12 && hour < 17) {
    return "สวัสดีตอนบ่าย";
  }
  return "สวัสดีตอนเย็น";
}
