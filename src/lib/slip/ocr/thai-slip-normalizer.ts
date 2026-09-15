/**
 * Thai Bank Slip Data Normalizer
 *
 * Normalizes raw vision extraction outputs for Thai banking slips:
 * - Buddhist Era (พ.ศ.) to Gregorian Calendar (ค.ศ.)
 * - Thai month abbreviations & full names
 * - Thai timezone (UTC+7) ISO 8601 formatting
 * - Thai currency and amount sanitization
 * - Masked account number extraction
 * - Clean party naming
 */

const THAI_MONTHS: Record<string, number> = {
  "ม.ค.": 1,
  "ม.ค": 1,
  มค: 1,
  มกราคม: 1,
  "ก.พ.": 2,
  "ก.พ": 2,
  กพ: 2,
  กุมภาพันธ์: 2,
  "มี.ค.": 3,
  "มี.ค": 3,
  มีค: 3,
  มีนาคม: 3,
  "เม.ย.": 4,
  "เม.ย": 4,
  เมย: 4,
  เมษายน: 4,
  "พ.ค.": 5,
  "พ.ค": 5,
  พค: 5,
  พฤษภาคม: 5,
  "มิ.ย.": 6,
  "มิ.ย": 6,
  มิย: 6,
  มิถุนายน: 6,
  "ก.ค.": 7,
  "ก.ค": 7,
  กค: 7,
  กรกฎาคม: 7,
  "ส.ค.": 8,
  "ส.ค": 8,
  สค: 8,
  สิงหาคม: 8,
  "ก.ย.": 9,
  "ก.ย": 9,
  กย: 9,
  กันยายน: 9,
  "ต.ค.": 10,
  "ต.ค": 10,
  ตค: 10,
  ตุลาคม: 10,
  "พ.ย.": 11,
  "พ.ย": 11,
  พย: 11,
  พฤศจิกายน: 11,
  "ธ.ค.": 12,
  "ธ.ค": 12,
  ธค: 12,
  ธันวาคม: 12,
};

const ENGLISH_MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Normalizes a Thai transfer amount into a valid positive float.
 * Removes commas, currency symbols, and Thai text ("บาท", "THB", "฿").
 */
export function parseThaiSlipAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    if (isNaN(raw) || !isFinite(raw) || raw <= 0) return undefined;
    return Math.round(raw * 100) / 100;
  }

  if (typeof raw !== "string") return undefined;

  let cleaned = raw.trim();
  if (!cleaned) return undefined;

  // Remove common prefixes/suffixes
  cleaned = cleaned
    .replace(/[,\s฿]/g, "")
    .replace(/(?:thb|บาท|baht|จำนวนเงิน|ยอดโอน|โอนเงิน)/gi, "")
    .replace(/\.-$/, ".00"); // e.g. "18.-" -> "18.00"

  // Match float number pattern
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return undefined;

  const parsed = parseFloat(match[1]);
  if (isNaN(parsed) || !isFinite(parsed) || parsed <= 0) return undefined;

  return Math.round(parsed * 100) / 100;
}

/**
 * Normalizes year value: converts Buddhist Era (BE >= 2400 or 2-digit Thai year) to Gregorian (CE).
 */
export function normalizeBuddhistYear(year: number): number {
  if (year >= 2400 && year <= 2700) {
    // 4-digit BE year: 2569 -> 2026
    return year - 543;
  }
  if (year >= 43 && year <= 99) {
    // 2-digit BE year: 69 -> 2569 -> 2026
    return 2500 + year - 543;
  }
  if (year >= 0 && year <= 42) {
    // 2-digit CE year: 26 -> 2026
    return 2000 + year;
  }
  return year;
}

/**
 * Parses a date string from a Thai bank slip into an ISO 8601 string.
 * Visible bank slip times are authoritative and interpreted as Asia/Bangkok (+07:00).
 * Handles Thai month abbreviations, full names, English months, and BE/CE years.
 */
export function parseThaiSlipDate(raw: unknown): string | undefined {
  if (!raw) return undefined;

  if (typeof raw !== "string") return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const cleaned = trimmed
    .replace(/^(?:วันที่โอน|วัน-เวลาที่โอน|วัน\/เวลาที่ทำรายการ|วัน\/เวลา|ทำรายการเมื่อ|วันที่|โอนเมื่อ|เวลา|date:?|time:?)\s*/gi, "")
    .replace(/\s*(?:น\.|น\.?)\s*$/gi, "") // remove trailing 'น.' (นาฬิกา)
    .trim();

  // 1. Match: "15 ก.ย. 2569 09:25[:30]" or "15 กันยายน 2569 09:25" or "15 Sep 2026 09:25"
  // Also matches "15 ก.ย. 69, 09:25" or "15 ก.ย. 2569 09.25"
  const textMonthMatch = cleaned.match(
    /^(\d{1,2})\s+([^\s\d,]+)\s+(\d{2,4})(?:[,\s]+(?:เวลา\s*)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/i
  );

  if (textMonthMatch) {
    const day = parseInt(textMonthMatch[1], 10);
    const rawMonth = textMonthMatch[2].toLowerCase();
    const rawYear = parseInt(textMonthMatch[3], 10);
    const hour = textMonthMatch[4] ? parseInt(textMonthMatch[4], 10) : 12;
    const min = textMonthMatch[5] ? parseInt(textMonthMatch[5], 10) : 0;
    const sec = textMonthMatch[6] ? parseInt(textMonthMatch[6], 10) : 0;

    let month = THAI_MONTHS[rawMonth];
    if (!month) {
      month = ENGLISH_MONTHS[rawMonth];
    }

    if (month && day >= 1 && day <= 31 && hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
      const year = normalizeBuddhistYear(rawYear);
      const pad = (n: number) => n.toString().padStart(2, "0");
      // Create in UTC+7 (Asia/Bangkok) as Thai bank slip time is authoritative
      const isoBangkok = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(min)}:${pad(sec)}+07:00`;
      const dateObj = new Date(isoBangkok);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString();
      }
    }
  }

  // 2. Match: "15/09/2569 09:25[:30]" or "15-09-2569 09:25" or "15/09/2026"
  const slashMatch = cleaned.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[,\s]+(?:เวลา\s*)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/
  );

  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10);
    const rawYear = parseInt(slashMatch[3], 10);
    const hour = slashMatch[4] ? parseInt(slashMatch[4], 10) : 12;
    const min = slashMatch[5] ? parseInt(slashMatch[5], 10) : 0;
    const sec = slashMatch[6] ? parseInt(slashMatch[6], 10) : 0;

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
      const year = normalizeBuddhistYear(rawYear);
      const pad = (n: number) => n.toString().padStart(2, "0");
      const isoBangkok = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(min)}:${pad(sec)}+07:00`;
      const dateObj = new Date(isoBangkok);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString();
      }
    }
  }

  // 3. Match ISO 8601 or YYYY-MM-DD: e.g. "2026-09-15T09:25:00+07:00", "2026-09-15T02:25:00.000Z", "2026-09-15 09:25", "2569-09-15T09:25:00"
  const ymdMatch = cleaned.match(
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[,\sT]+(?:เวลา\s*)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2})(?:\.\d+)?)?)?(.*)$/i
  );

  if (ymdMatch) {
    const rawYear = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    const hour = ymdMatch[4] !== undefined ? parseInt(ymdMatch[4], 10) : 12;
    const min = ymdMatch[5] !== undefined ? parseInt(ymdMatch[5], 10) : 0;
    const sec = ymdMatch[6] !== undefined ? parseInt(ymdMatch[6], 10) : 0;
    const tzPart = (ymdMatch[7] || "").trim();

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
      const year = normalizeBuddhistYear(rawYear);
      const pad = (n: number) => n.toString().padStart(2, "0");

      let offset = "+07:00"; // Default for Thai bank slips
      let fraction = "";

      if (tzPart) {
        const fracMatch = tzPart.match(/^(\.\d+)(.*)$/);
        let remainder = tzPart;
        if (fracMatch) {
          fraction = fracMatch[1];
          remainder = fracMatch[2].trim();
        }
        if (remainder) {
          offset = remainder;
        } else if (fraction && !remainder) {
          offset = "+07:00";
        }
      }

      const isoString = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(min)}:${pad(sec)}${fraction}${offset}`;
      const dateObj = new Date(isoString);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString();
      }
    }
  }

  // 4. Fallback: try Native Date.parse
  const fallbackDate = new Date(cleaned);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate.toISOString();
  }

  return undefined;
}

/**
 * Normalizes masked account string (e.g. "xxx-x-xx123-4" or "1234").
 */
export function normalizeMaskedAccount(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Clean label prefixes if LLM included them
  const cleaned = trimmed
    .replace(/^(?:เลขที่บัญชี|เลขบัญชี|account\s*no:?|acc\s*no:?)\s*/i, "")
    .trim();

  return cleaned || null;
}

/**
 * Cleans party name from common slip OCR prefixes.
 */
export function cleanPartyName(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Remove common directional prefixes if LLM included them
  const cleaned = trimmed
    .replace(/^(?:จาก|ผู้โอน|from|sender)[:\s]*/i, "")
    .replace(/^(?:ถึง|ไปยัง|ผู้รับเงิน|ผู้รับ|to|receiver)[:\s]*/i, "")
    .replace(/^(?:ชื่อบัญชี|account\s*name)[:\s]*/i, "")
    .trim();

  return cleaned || null;
}
