/**
 * Canonical Bank Identifiers in Thailand
 */
export type CanonicalBank =
  | "SCB"
  | "KBANK"
  | "BBL"
  | "KTB"
  | "TTB"
  | "BAY"
  | "GSB"
  | "BAAC"
  | "CIMB"
  | "UOB"
  | "LHBANK"
  | "KKP"
  | "TISCO"
  | "PROMPTPAY"
  | "TRUEMONEY"
  | "OTHER";

interface BankDefinition {
  canonical: CanonicalBank;
  thaiName: string;
  englishName: string;
  aliases: string[];
}

export const BANK_DEFINITIONS: BankDefinition[] = [
  {
    canonical: "SCB",
    thaiName: "ไทยพาณิชย์",
    englishName: "Siam Commercial Bank",
    aliases: [
      "scb",
      "siam commercial bank",
      "ธนาคารไทยพาณิชย์",
      "ไทยพาณิชย์",
      "ธ.ไทยพาณิชย์",
      "scbeasy",
      "scb easy",
    ],
  },
  {
    canonical: "KBANK",
    thaiName: "กสิกรไทย",
    englishName: "Kasikornbank",
    aliases: [
      "kbank",
      "kasikornbank",
      "kasikorn bank",
      "kasikorn",
      "ธนาคารกสิกรไทย",
      "กสิกรไทย",
      "กสิกร",
      "ธ.กสิกรไทย",
      "k+",
      "k-plus",
      "kplus",
    ],
  },
  {
    canonical: "BBL",
    thaiName: "กรุงเทพ",
    englishName: "Bangkok Bank",
    aliases: [
      "bbl",
      "bangkok bank",
      "ธนาคารกรุงเทพ",
      "กรุงเทพ",
      "ธ.กรุงเทพ",
      "bualuang",
      "bualuang mbanking",
    ],
  },
  {
    canonical: "KTB",
    thaiName: "กรุงไทย",
    englishName: "Krungthai Bank",
    aliases: [
      "ktb",
      "krungthai bank",
      "krungthai",
      "ธนาคารกรุงไทย",
      "กรุงไทย",
      "ธ.กรุงไทย",
      "krungthai next",
      "next",
      "เป๋าตัง",
    ],
  },
  {
    canonical: "TTB",
    thaiName: "ทหารไทยธนชาต",
    englishName: "TMBThanachart Bank",
    aliases: [
      "ttb",
      "tmb",
      "thanachart",
      "tmbthanachart",
      "tmb thanachart",
      "ธนาคารทหารไทยธนชาต",
      "ทหารไทยธนชาต",
      "ทีทีบี",
      "ธ.ทหารไทยธนชาต",
    ],
  },
  {
    canonical: "BAY",
    thaiName: "กรุงศรีอยุธยา",
    englishName: "Bank of Ayudhya",
    aliases: [
      "bay",
      "krungsri",
      "bank of ayudhya",
      "ธนาคารกรุงศรีอยุธยา",
      "กรุงศรี",
      "กรุงศรีอยุธยา",
      "ธ.กรุงศรี",
      "kma",
    ],
  },
  {
    canonical: "GSB",
    thaiName: "ออมสิน",
    englishName: "Government Savings Bank",
    aliases: [
      "gsb",
      "government savings bank",
      "ธนาคารออมสิน",
      "ออมสิน",
      "ธ.ออมสิน",
      "mymo",
    ],
  },
  {
    canonical: "BAAC",
    thaiName: "ธ.ก.ส.",
    englishName: "Bank for Agriculture and Agricultural Cooperatives",
    aliases: [
      "baac",
      "ธ.ก.ส.",
      "ธกส",
      "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร",
      "a-mobile",
    ],
  },
  {
    canonical: "CIMB",
    thaiName: "ซีไอเอ็มบีไทย",
    englishName: "CIMB Thai Bank",
    aliases: ["cimb", "cimb thai", "ซีไอเอ็มบี", "ธนาคารซีไอเอ็มบีไทย"],
  },
  {
    canonical: "UOB",
    thaiName: "ยูโอบี",
    englishName: "United Overseas Bank",
    aliases: ["uob", "united overseas bank", "ยูโอบี", "ธนาคารยูโอบี", "tmrw"],
  },
  {
    canonical: "LHBANK",
    thaiName: "แลนด์ แอนด์ เฮ้าส์",
    englishName: "Land and Houses Bank",
    aliases: ["lhbank", "lh bank", "land and houses", "แลนด์ แอนด์ เฮ้าส์"],
  },
  {
    canonical: "KKP",
    thaiName: "เกียรตินาคินภัทร",
    englishName: "Kiatnakin Phatra Bank",
    aliases: ["kkp", "kiatnakin", "kiatnakin phatra", "เกียรตินาคิน", "เกียรตินาคินภัทร"],
  },
  {
    canonical: "TISCO",
    thaiName: "ทิสโก้",
    englishName: "TISCO Bank",
    aliases: ["tisco", "ทิสโก้", "ธนาคารทิสโก้"],
  },
  {
    canonical: "PROMPTPAY",
    thaiName: "พร้อมเพย์",
    englishName: "PromptPay",
    aliases: ["promptpay", "prompt pay", "พร้อมเพย์"],
  },
  {
    canonical: "TRUEMONEY",
    thaiName: "ทรูมันนี่",
    englishName: "TrueMoney",
    aliases: ["truemoney", "true money", "ทรูมันนี่", "tmn"],
  },
];

/**
 * Normalizes any Thai/English bank string into its canonical identifier.
 */
export function normalizeBankName(raw?: string | null): CanonicalBank | null {
  if (!raw || typeof raw !== "string") return null;

  const rawClean = raw.trim().toLowerCase();
  const cleanedNoSpace = rawClean.replace(/[\s\-_.]/g, "");
  if (!cleanedNoSpace) return null;

  // 1. Exact match against canonical, thaiName, englishName, or aliases
  for (const def of BANK_DEFINITIONS) {
    if (def.canonical.toLowerCase() === cleanedNoSpace) return def.canonical;
    if (def.thaiName.toLowerCase() === rawClean || def.englishName.toLowerCase() === rawClean) return def.canonical;
    for (const alias of def.aliases) {
      if (alias.toLowerCase() === rawClean) return def.canonical;
    }
  }

  // 2. Match by cleaned string without spaces (longest aliases first to prevent short-alias false positives)
  const allAliases: Array<{ canonical: CanonicalBank; alias: string }> = [];
  for (const def of BANK_DEFINITIONS) {
    allAliases.push({ canonical: def.canonical, alias: def.canonical.toLowerCase() });
    allAliases.push({ canonical: def.canonical, alias: def.thaiName.replace(/[\s\-_.]/g, "").toLowerCase() });
    allAliases.push({ canonical: def.canonical, alias: def.englishName.replace(/[\s\-_.]/g, "").toLowerCase() });
    for (const alias of def.aliases) {
      allAliases.push({ canonical: def.canonical, alias: alias.replace(/[\s\-_.]/g, "").toLowerCase() });
    }
  }

  // Sort by alias length descending so "bangkokbank" matches before "kbank"
  allAliases.sort((a, b) => b.alias.length - a.alias.length);

  for (const item of allAliases) {
    if (cleanedNoSpace === item.alias || cleanedNoSpace.includes(item.alias)) {
      return item.canonical;
    }
  }

  return "OTHER";
}
