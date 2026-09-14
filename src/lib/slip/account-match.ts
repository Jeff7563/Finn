import { Account } from "@/types/finance";
import { AccountMatchResult, SlipParty } from "@/types/slip";
import { normalizeBankName } from "./bank-normalization";

/**
 * Extracts visible trailing digits from a masked account string (e.g. "xxx-x-xx123-4" -> "1234", "x-9876" -> "9876").
 */
export function extractDigits(masked?: string | null): string {
  if (!masked) return "";
  return masked.replace(/\D/g, "");
}

/**
 * Matches a sender or receiver party against a list of owned accounts.
 *
 * Requirements:
 * 1. Match by canonical bank institution.
 * 2. Match by masked digits (last 3-4 digits).
 * 3. Match by account name / alias.
 * 4. STRICT RULE: If multiple owned accounts belong to the same bank and
 *    masked digits do not uniquely match, NEVER match by bank alone.
 */
export function matchOwnedAccount(
  party: SlipParty | undefined,
  accounts: Account[]
): AccountMatchResult {
  if (!party || !accounts || accounts.length === 0) {
    return {
      accountId: null,
      confidence: 0,
      reason: "No party data or no owned accounts available",
    };
  }

  const activeAccounts = accounts.filter((a) => a.active);
  const partyBank = normalizeBankName(party.bank);
  const partyDigits = extractDigits(party.accountMasked);
  const partyName = (party.name || "").trim().toLowerCase();

  // Find all candidate accounts matching the bank
  const bankCandidates = partyBank
    ? activeAccounts.filter((acc) => {
        const accBank = normalizeBankName(acc.institution || acc.name);
        return accBank && accBank === partyBank;
      })
    : [];

  // Check digits match among bank candidates first
  if (partyDigits.length >= 3) {
    const digitAndBankMatches = bankCandidates.filter((acc) => {
      const accDigits = extractDigits(acc.masked_number || "");
      if (!accDigits) return false;
      // Match if trailing digits match
      return (
        accDigits.endsWith(partyDigits) ||
        partyDigits.endsWith(accDigits) ||
        accDigits === partyDigits
      );
    });

    if (digitAndBankMatches.length === 1) {
      return {
        accountId: digitAndBankMatches[0].id,
        accountName: digitAndBankMatches[0].name,
        confidence: 0.99,
        reason: `Matched by bank (${partyBank}) and account digits (...${partyDigits.slice(-4)})`,
      };
    }

    if (digitAndBankMatches.length > 1) {
      const firstName = digitAndBankMatches[0].name.trim().toLowerCase();
      const allIdentical = digitAndBankMatches.every(
        (a) => a.name.trim().toLowerCase() === firstName
      );
      if (allIdentical) {
        return {
          accountId: digitAndBankMatches[0].id,
          accountName: digitAndBankMatches[0].name,
          confidence: 0.99,
          reason: `Matched by bank (${partyBank}) and account digits (...${partyDigits.slice(-4)})`,
        };
      }

      return {
        accountId: null,
        confidence: 0.5,
        reason: `Multiple accounts matched bank ${partyBank} and digits ${partyDigits}`,
      };
    }

    // Check digit matches across all accounts even if bank was not recognized
    const allDigitMatches = activeAccounts.filter((acc) => {
      const accDigits = extractDigits(acc.masked_number || "");
      if (!accDigits) return false;
      return (
        accDigits.endsWith(partyDigits) ||
        partyDigits.endsWith(accDigits) ||
        accDigits === partyDigits
      );
    });

    if (allDigitMatches.length === 1) {
      return {
        accountId: allDigitMatches[0].id,
        accountName: allDigitMatches[0].name,
        confidence: 0.95,
        reason: `Matched by distinctive account digits (...${partyDigits.slice(-4)})`,
      };
    }
  }

  // If bank matches and there is EXACTLY ONE account for this bank
  if (bankCandidates.length === 1) {
    // If party has no digits, or account has no masked digits, match cautiously
    const acc = bankCandidates[0];
    const accDigits = extractDigits(acc.masked_number);

    if (partyDigits && accDigits && partyDigits !== accDigits) {
      // Digits contradict each other! Do NOT match!
      return {
        accountId: null,
        confidence: 0,
        reason: `Bank ${partyBank} matched but digits contradict (slip: ${partyDigits}, account: ${accDigits})`,
      };
    }

    // If party has NO digits:
    // If the account has specific masked digits (e.g. 5678) but the party provided NO digits,
    // we should only match if the party name matches the account name or alias.
    // If party name is clearly different (e.g. merchant or external person like "Starbucks Cafe"), do NOT match!
    if (!partyDigits && accDigits) {
      if (
        partyName &&
        !acc.name.toLowerCase().includes(partyName) &&
        !partyName.includes(acc.name.toLowerCase())
      ) {
        return {
          accountId: null,
          confidence: 0,
          reason: `Bank ${partyBank} matched but account has digits (${accDigits}) while party has no digits and different name (${party.name})`,
        };
      }
    }

    return {
      accountId: acc.id,
      accountName: acc.name,
      confidence: partyDigits ? 0.95 : 0.85,
      reason: `Single account found for bank ${partyBank}`,
    };
  }

  // If multiple accounts for the bank exist and digits couldn't distinguish them:
  if (bankCandidates.length > 1) {
    // Check if account name contains party name
    if (partyName) {
      const nameMatches = bankCandidates.filter((acc) =>
        acc.name.toLowerCase().includes(partyName)
      );
      if (nameMatches.length === 1) {
        return {
          accountId: nameMatches[0].id,
          accountName: nameMatches[0].name,
          confidence: 0.9,
          reason: `Matched by bank ${partyBank} and account name alias`,
        };
      }
    }

    // RULE: NEVER match solely by bank when multiple accounts exist!
    return {
      accountId: null,
      confidence: 0.3,
      reason: `Ambiguous: user has ${bankCandidates.length} accounts at ${partyBank} and no distinctive digits`,
    };
  }

  return {
    accountId: null,
    confidence: 0,
    reason: "No matching owned account found",
  };
}
