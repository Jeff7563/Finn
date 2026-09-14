import { Category, Merchant, TransactionWithRelations } from "@/types/finance";

export interface CategorySuggestionResult {
  categoryId: string | null;
  categoryName?: string;
  confidence: number;
  reason: string;
}

const KEYWORD_CATEGORY_MAP: Array<{
  keywords: string[];
  categoryNames: string[];
}> = [
  {
    keywords: ["cafe", "coffee", "restaurant", "food", "kitchen", "shabu", "suki", "ชาบู", "ก๋วยเตี๋ยว", "กาแฟ", "อาหาร", "ข้าวมันไก่", "เบเกอรี่"],
    categoryNames: ["Food", "อาหาร"],
  },
  {
    keywords: ["ptt", "bangchak", "shell", "caltex", "ปตท", "บางจาก", "เชลล์", "น้ำมัน"],
    categoryNames: ["Fuel", "น้ำมัน"],
  },
  {
    keywords: ["bts", "mrt", "grab", "bolt", "line man", "taxi", "รถไฟฟ้า"],
    categoryNames: ["Transport", "เดินทาง"],
  },
  {
    keywords: ["7-eleven", "7-11", "lotus", "big c", "tops", "เซเว่น", "โลตัส", "บิ๊กซี", "ท็อปส์", "cj express", "ซีเจ"],
    categoryNames: ["Food", "Shopping", "ของใช้"],
  },
  {
    keywords: ["lazada", "shopee", "tiktok shop", "ลาซาด้า", "ช้อปปี้"],
    categoryNames: ["Shopping", "ช้อปปิ้ง"],
  },
  {
    keywords: ["pea", "mea", "mwa", "pwa", "การไฟฟ้า", "การประปา"],
    categoryNames: ["Utilities", "ค่าน้ำค่าไฟ"],
  },
  {
    keywords: ["ais", "true", "dtac", "nt mobile", "อินเทอร์เน็ต"],
    categoryNames: ["Internet", "Phone", "ค่าโทรศัพท์"],
  },
];

/**
 * Suggests category based on priority:
 * 1. User's previous transaction history for this merchant.
 * 2. Merchant's `category_hint`.
 * 3. Keyword rules against merchant/counterparty name.
 */
export function suggestCategory({
  merchant,
  counterpartyName,
  userTransactions,
  categories,
}: {
  merchant?: Merchant | null;
  counterpartyName?: string | null;
  userTransactions: TransactionWithRelations[];
  categories: Category[];
}): CategorySuggestionResult {
  // 1. Previous transaction history with this merchant
  if (merchant) {
    const prevTx = userTransactions
      .filter((tx) => tx.merchant_id === merchant.id && tx.category_id)
      .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());

    if (prevTx.length > 0 && prevTx[0].category_id) {
      const cat = categories.find((c) => c.id === prevTx[0].category_id);
      if (cat) {
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          confidence: 0.95,
          reason: `ตรงกับรายการก่อนหน้าของ ${merchant.display_name}`,
        };
      }
    }

    // 2. Merchant category_hint
    if (merchant.category_hint) {
      const hint = merchant.category_hint.toLowerCase();
      const cat = categories.find(
        (c) => c.name.toLowerCase() === hint || c.id === merchant.category_hint
      );
      if (cat) {
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          confidence: 0.85,
          reason: `ตามคำแนะนำของร้านค้า (${cat.name})`,
        };
      }
    }
  }

  // 3. Keyword Heuristics
  const targetText = (counterpartyName || merchant?.display_name || "").toLowerCase();
  if (targetText) {
    for (const rule of KEYWORD_CATEGORY_MAP) {
      if (rule.keywords.some((k) => targetText.includes(k))) {
        const cat = categories.find((c) =>
          rule.categoryNames.some((targetName) =>
            c.name.toLowerCase() === targetName.toLowerCase()
          )
        );
        if (cat) {
          return {
            categoryId: cat.id,
            categoryName: cat.name,
            confidence: 0.8,
            reason: `วิเคราะห์จากชื่อคู่ค้า (${cat.name})`,
          };
        }
      }
    }
  }

  return {
    categoryId: null,
    confidence: 0,
    reason: "No category suggested; transaction remains uncategorized",
  };
}
