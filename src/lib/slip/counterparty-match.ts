import { Merchant, Person } from "@/types/finance";

export interface CounterpartyMatchResult {
  merchantId: string | null;
  personId: string | null;
  matchedName: string | null;
  confidence: number;
}

const CLEAN_PREFIXES = [
  "บจก.",
  "บมจ.",
  "หจก.",
  "บริษัท",
  "จำกัด",
  "ร้าน",
  "นาย",
  "นาง",
  "นางสาว",
  "น.ส.",
  "ด.ช.",
  "ด.ญ.",
  "mr.",
  "mrs.",
  "ms.",
  "co.,",
  "ltd.",
  "inc.",
];

export function cleanPartyName(raw?: string | null): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  for (const prefix of CLEAN_PREFIXES) {
    s = s.replaceAll(prefix.toLowerCase(), "");
  }
  return s.replace(/[\s\-_.]+/g, " ").trim();
}

/**
 * Matches extracted party name against user's existing merchants and people.
 */
export function matchCounterparty(
  partyName: string | undefined | null,
  merchants: Merchant[],
  people: Person[]
): CounterpartyMatchResult {
  if (!partyName || !partyName.trim()) {
    return { merchantId: null, personId: null, matchedName: null, confidence: 0 };
  }

  const rawClean = partyName.trim().toLowerCase();
  const normalized = cleanPartyName(partyName);

  // 1. Check Merchants exact or normalized match
  for (const m of merchants) {
    const mNorm = m.normalized_name.toLowerCase();
    const mDisplay = m.display_name.toLowerCase();
    if (mNorm === rawClean || mDisplay === rawClean || mNorm === normalized) {
      return {
        merchantId: m.id,
        personId: null,
        matchedName: m.display_name,
        confidence: 0.95,
      };
    }
    // Check aliases
    if (m.aliases && m.aliases.some((a) => a.toLowerCase() === rawClean || a.toLowerCase() === normalized)) {
      return {
        merchantId: m.id,
        personId: null,
        matchedName: m.display_name,
        confidence: 0.92,
      };
    }
  }

  // 2. Check People exact or normalized match
  for (const p of people) {
    const pNorm = p.normalized_name.toLowerCase();
    const pDisplay = p.display_name.toLowerCase();
    if (pNorm === rawClean || pDisplay === rawClean || pNorm === normalized) {
      return {
        merchantId: null,
        personId: p.id,
        matchedName: p.display_name,
        confidence: 0.95,
      };
    }
    // Check aliases
    if (p.aliases && p.aliases.some((a) => a.toLowerCase() === rawClean || a.toLowerCase() === normalized)) {
      return {
        merchantId: null,
        personId: p.id,
        matchedName: p.display_name,
        confidence: 0.92,
      };
    }
  }

  // 3. Partial / Substring Match for Merchants
  if (normalized.length >= 3) {
    for (const m of merchants) {
      const mNorm = cleanPartyName(m.display_name);
      if (mNorm.length >= 3 && (normalized.includes(mNorm) || mNorm.includes(normalized))) {
        return {
          merchantId: m.id,
          personId: null,
          matchedName: m.display_name,
          confidence: 0.8,
        };
      }
    }
  }

  return { merchantId: null, personId: null, matchedName: null, confidence: 0 };
}
