import { Category } from "@/types/finance";

/**
 * Canonical English system category to Thai localization dictionary.
 * Strictly preserves canonical English names in the database for relations/matching
 * while presenting Thai-first labels in the UI.
 */
export const SYSTEM_CATEGORY_THAI_MAP: Record<string, string> = {
  // Income
  Salary: "เงินเดือน",
  Freelance: "งานฟรีแลนซ์",
  Business: "รายได้จากธุรกิจ",
  Affiliate: "รายได้แอฟฟิลิเอต",
  Commission: "ค่าคอมมิชชัน",
  Refund: "เงินคืน",
  "Investment Income": "รายได้จากการลงทุน",
  Gift: "ของขวัญ / เงินให้",
  "Loan Received": "เงินกู้ที่ได้รับ",
  "Other Income": "รายรับอื่น ๆ",

  // Expense
  Food: "อาหาร",
  Transport: "ค่าเดินทาง",
  Fuel: "ค่าน้ำมัน / เชื้อเพลิง",
  Rent: "ค่าเช่า",
  Utilities: "ค่าสาธารณูปโภค",
  Internet: "ค่าอินเทอร์เน็ต",
  Phone: "ค่าโทรศัพท์",
  Shopping: "ช้อปปิ้ง",
  Entertainment: "ความบันเทิง",
  Education: "การศึกษา",
  Health: "สุขภาพ",
  Pet: "สัตว์เลี้ยง",
  Family: "ครอบครัว",
  Debt: "หนี้สิน / ชำระหนี้",
  Subscription: "ค่าสมาชิก / บริการรายเดือน",
  Investment: "การลงทุน",
  Tax: "ภาษี",
  Donation: "เงินบริจาค",
  "Business Expense": "ค่าใช้จ่ายธุรกิจ",
  Other: "อื่น ๆ",
};

/**
 * Returns the Thai translated name for a canonical system category name.
 * If not found in mapping, safely falls back to original name.
 * Never returns blank text when name is non-empty.
 */
export function getSystemCategoryThaiName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  return SYSTEM_CATEGORY_THAI_MAP[trimmed] || trimmed;
}

/**
 * Returns the primary display label for a category.
 * For system categories: returns Thai translation (or original name fallback).
 * For custom user categories: preserves exactly what the user entered.
 * Never returns blank text if category and name are provided.
 */
export function getCategoryDisplayName(
  category: Category | { name: string; is_system?: boolean } | null | undefined
): string {
  if (!category || !category.name) return "";
  if (category.is_system) {
    return getSystemCategoryThaiName(category.name);
  }
  return category.name;
}

/**
 * Returns primary and secondary presentation labels for a category:
 * - primary: Thai translation for system category, or exact user name for custom category.
 * - secondary: Canonical English name for system category (if translated), null for custom category.
 */
export function getCategoryLabelPair(
  category: Category | { name: string; is_system?: boolean } | null | undefined
): { primary: string; secondary: string | null } {
  if (!category || !category.name) {
    return { primary: "", secondary: null };
  }

  if (category.is_system) {
    const thaiName = getSystemCategoryThaiName(category.name);
    // If a Thai translation exists and differs from canonical English name, show English as secondary
    const secondary = thaiName !== category.name ? category.name : null;
    return {
      primary: thaiName,
      secondary,
    };
  }

  // Custom user categories: preserve user's exact input with no secondary label
  return {
    primary: category.name,
    secondary: null,
  };
}
