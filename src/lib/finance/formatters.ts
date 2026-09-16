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
 * Extracts { year, month, day } (0-indexed month: 0-11)
 * in Asia/Bangkok local wall-clock time.
 */
export function getBangkokLocalDateParts(
  dateInput: string | Date | number | null | undefined,
  timeZone: string = "Asia/Bangkok"
): { year: number; month: number; day: number } {
  if (dateInput == null) return { year: 0, month: 0, day: 0 };
  const date =
    dateInput instanceof Date
      ? dateInput
      : typeof dateInput === "string" || typeof dateInput === "number"
      ? new Date(dateInput)
      : null;
  if (!date || isNaN(date.getTime())) return { year: 0, month: 0, day: 0 };

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const day = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);
  const month =
    parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
  return { day, month, year };
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

  const dParts = getBangkokLocalDateParts(date, timeZone);
  const nowParts = getBangkokLocalDateParts(now, timeZone);

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
  const dParts = getBangkokLocalDateParts(date, timeZone);
  const nowParts = getBangkokLocalDateParts(now, timeZone);

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
 * Converts a canonical UTC instant (or ISO string with timezone or Date object)
 * into `YYYY-MM-DDTHH:mm` wall-clock representation in `Asia/Bangkok` (UTC+7),
 * strictly formatted for `<input type="datetime-local">`.
 *
 * If the input is already in `YYYY-MM-DDTHH:mm` format, it is returned directly
 * without double-conversion.
 */
export function canonicalInstantToBangkokDateTimeLocal(
  dateInput: string | Date,
  timeZone: string = "Asia/Bangkok"
): string {
  if (!dateInput) return "";

  if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }

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
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * Formats a date into `YYYY-MM-DDTHH:mm` format suitable for `<input type="datetime-local">` in Asia/Bangkok local time.
 * Backwards-compatible wrapper around `canonicalInstantToBangkokDateTimeLocal`.
 */
export function formatDateTimeLocal(
  dateInput: string | Date,
  timeZone: string = "Asia/Bangkok"
): string {
  return canonicalInstantToBangkokDateTimeLocal(dateInput, timeZone);
}

/**
 * Converts a datetime-local input string (e.g. `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`)
 * explicitly into a canonical UTC ISO-8601 instant string (`...Z`), binding the wall-clock components
 * strictly to `Asia/Bangkok` (+07:00).
 *
 * Environment-independent: produces the exact same UTC instant regardless of whether
 * it runs on a UTC cloud server, a Windows developer machine, or a browser with any local timezone.
 *
 * If input is already an ISO string with timezone specifier (`Z` or `+07:00`), preserves the instant
 * without reinterpreting UTC components as local time.
 */
export function bangkokDateTimeLocalToCanonicalInstant(
  datetimeLocalInput: string | Date | null | undefined
): string | null {
  if (!datetimeLocalInput) return null;

  if (datetimeLocalInput instanceof Date) {
    return isNaN(datetimeLocalInput.getTime()) ? null : datetimeLocalInput.toISOString();
  }

  if (typeof datetimeLocalInput !== "string") return null;

  const trimmed = datetimeLocalInput.trim();
  if (!trimmed) return null;

  // 1. If string already has explicit timezone offset or Z, parse directly as canonical instant
  const tzRegex = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
  if (tzRegex.test(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // 2. Parse wall-clock YYYY-MM-DDTHH:mm[:ss] without timezone and explicitly bind to Asia/Bangkok (+07:00)
  const match = trimmed.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/
  );

  if (match) {
    let year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const hour = match[4] !== undefined ? parseInt(match[4], 10) : 12;
    const min = match[5] !== undefined ? parseInt(match[5], 10) : 0;
    const sec = match[6] !== undefined ? parseInt(match[6], 10) : 0;

    // Buddhist Era normalization (e.g. 2569 -> 2026)
    if (year >= 2400 && year <= 2700) {
      year -= 543;
    }

    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31 &&
      hour >= 0 &&
      hour <= 23 &&
      min >= 0 &&
      min <= 59 &&
      sec >= 0 &&
      sec <= 59
    ) {
      const pad = (n: number) => n.toString().padStart(2, "0");
      const isoBangkok = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(min)}:${pad(sec)}+07:00`;
      const dateObj = new Date(isoBangkok);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString();
      }
    }
  }

  // 3. Fallback: Native Date parse
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d.toISOString();
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
