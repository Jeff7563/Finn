import { Account } from "@/types/finance";
import { AccountMatchAlias, AccountMatchResult, SlipParty } from "@/types/slip";
import { normalizeBankName } from "./bank-normalization";
import {
  extractDigitsFromPattern,
  hasContradictingDigits,
  hasVisibleDigits,
  isPositionalPatternMatch,
  isSafeSuffixMatch,
  normalizeMaskedPattern,
} from "./mask-pattern";

/**
 * Extracts visible trailing digits from a masked account string (e.g. "xxx-x-xx123-4" -> "1234", "x-9876" -> "9876").
 * Preserved for backwards compatibility with existing callers and tests.
 */
export function extractDigits(masked?: string | null): string {
  if (!masked) return "";
  return masked.replace(/\D/g, "");
}

/**
 * Matches a sender or receiver party against a list of owned accounts.
 *
 * Evidence Priority:
 * A. VERIFIED LEARNED ALIAS: bank + normalized positional pattern -> extremely high confidence (0.99)
 * B. UNIQUE POSITIONAL PATTERN MATCH: exact positional length & digits match (0.95)
 * C. SAFE existing masked-number match: trailing digits match when no trailing mask exists (0.92)
 * D. Account name / known alias evidence (0.88)
 * E. Bank-only match: single account at bank; NEVER matches when multiple accounts exist at bank (0.80 - 0.90)
 *
 * Invariants:
 * - If evidence conflicts: return NO MATCH (ambiguous).
 * - Never choose "closest account".
 * - Never guess.
 */
export function matchOwnedAccount(
  party: SlipParty | undefined,
  accounts: Account[],
  aliases?: AccountMatchAlias[]
): AccountMatchResult {
  if (!party || !accounts || accounts.length === 0) {
    return {
      accountId: null,
      confidence: 0,
      matchMethod: "no_match",
      reason: "No party data or no owned accounts available",
    };
  }

  const activeAccounts = accounts.filter((a) => a.active);
  if (activeAccounts.length === 0) {
    return {
      accountId: null,
      confidence: 0,
      matchMethod: "no_match",
      reason: "No active owned accounts available",
    };
  }

  const partyBank = normalizeBankName(party.bank);
  const partyRawMask = party.accountMasked || "";
  const partyPattern = normalizeMaskedPattern(partyRawMask);
  const partyDigits = extractDigitsFromPattern(partyPattern || partyRawMask);
  const partyName = (party.name || "").trim().toLowerCase();

  // Filter accounts matching the bank institution
  const bankCandidates = partyBank
    ? activeAccounts.filter((acc) => {
        const accBank = normalizeBankName(acc.institution || acc.name);
        return accBank && accBank === partyBank;
      })
    : [];

  // -------------------------------------------------------------------------
  // Priority A: VERIFIED LEARNED ALIAS
  // -------------------------------------------------------------------------
  if (partyPattern && aliases && aliases.length > 0) {
    const matchingAliases = aliases.filter((al) => {
      if (al.normalized_masked_pattern !== partyPattern) return false;
      // If alias specifies an institution, it must match partyBank
      if (al.institution && partyBank) {
        const alBank = normalizeBankName(al.institution);
        if (alBank && alBank !== partyBank) return false;
      }
      // Must map to an active account
      return activeAccounts.some((a) => a.id === al.account_id);
    });

    const uniqueAccountIds = Array.from(
      new Set(matchingAliases.map((a) => a.account_id))
    );

    if (uniqueAccountIds.length === 1) {
      const matchedAcc = activeAccounts.find((a) => a.id === uniqueAccountIds[0])!;
      return {
        accountId: matchedAcc.id,
        accountName: matchedAcc.name,
        confidence: 0.99,
        matchMethod: "verified_alias",
        reason: `Matched by verified learned alias for ${partyBank || "bank"} and pattern ${partyPattern}`,
      };
    }

    if (uniqueAccountIds.length > 1) {
      const ambiguousList = activeAccounts
        .filter((a) => uniqueAccountIds.includes(a.id))
        .map((a) => ({ id: a.id, name: a.name }));
      return {
        accountId: null,
        confidence: 0.5,
        matchMethod: "ambiguous",
        reason: `Ambiguous: multiple learned aliases for pattern ${partyPattern}`,
        ambiguousCandidates: ambiguousList,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Priority B: UNIQUE POSITIONAL PATTERN MATCH
  // -------------------------------------------------------------------------
  if (partyPattern && hasVisibleDigits(partyPattern)) {
    const candidatesToSearch = bankCandidates.length > 0 ? bankCandidates : activeAccounts;
    const positionalMatches = candidatesToSearch.filter((acc) => {
      if (!acc.masked_number) return false;
      const accPattern = normalizeMaskedPattern(acc.masked_number);
      return isPositionalPatternMatch(partyPattern, accPattern);
    });

    if (positionalMatches.length === 1) {
      return {
        accountId: positionalMatches[0].id,
        accountName: positionalMatches[0].name,
        confidence: 0.95,
        matchMethod: "positional_mask",
        reason: `Matched by unique positional mask pattern (${partyPattern})`,
      };
    }

    if (positionalMatches.length > 1) {
      return {
        accountId: null,
        confidence: 0.5,
        matchMethod: "ambiguous",
        reason: `Multiple accounts matched positional pattern ${partyPattern}`,
        ambiguousCandidates: positionalMatches.map((a) => ({ id: a.id, name: a.name })),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Priority C: SAFE existing masked-number match (suffix)
  // Only valid when party pattern does NOT end with a trailing mask '*'!
  // -------------------------------------------------------------------------
  if (!partyPattern.endsWith("*") && partyDigits.length >= 3) {
    // Search among bank candidates first
    if (bankCandidates.length > 0) {
      const suffixMatches = bankCandidates.filter((acc) => {
        if (!acc.masked_number) return false;
        if (hasContradictingDigits(acc.masked_number, partyPattern)) return false;
        return isSafeSuffixMatch(acc.masked_number, partyPattern);
      });

      if (suffixMatches.length === 1) {
        return {
          accountId: suffixMatches[0].id,
          accountName: suffixMatches[0].name,
          confidence: 0.95,
          matchMethod: "masked_suffix",
          reason: `Matched by bank (${partyBank}) and account digits (...${partyDigits.slice(-4)})`,
        };
      }

      if (suffixMatches.length > 1) {
        const firstName = suffixMatches[0].name.trim().toLowerCase();
        const allIdentical = suffixMatches.every(
          (a) => a.name.trim().toLowerCase() === firstName
        );
        if (allIdentical) {
          return {
            accountId: suffixMatches[0].id,
            accountName: suffixMatches[0].name,
            confidence: 0.92,
            matchMethod: "masked_suffix",
            reason: `Matched by bank (${partyBank}) and account digits (...${partyDigits.slice(-4)})`,
          };
        }

        return {
          accountId: null,
          confidence: 0.5,
          matchMethod: "ambiguous",
          reason: `Multiple accounts matched bank ${partyBank} and digits ${partyDigits}`,
          ambiguousCandidates: suffixMatches.map((a) => ({ id: a.id, name: a.name })),
        };
      }
    }

    // If bank was not identified, check unique across all accounts
    if (!partyBank) {
      const allSuffixMatches = activeAccounts.filter((acc) => {
        if (!acc.masked_number) return false;
        if (hasContradictingDigits(acc.masked_number, partyPattern)) return false;
        return isSafeSuffixMatch(acc.masked_number, partyPattern);
      });

      if (allSuffixMatches.length === 1) {
        return {
          accountId: allSuffixMatches[0].id,
          accountName: allSuffixMatches[0].name,
          confidence: 0.90,
          matchMethod: "masked_suffix",
          reason: `Matched by distinctive account digits (...${partyDigits.slice(-4)})`,
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Priority D: Account name / known alias evidence
  // -------------------------------------------------------------------------
  if (partyName && partyName.length >= 3) {
    const candidates = bankCandidates.length > 0 ? bankCandidates : activeAccounts;
    const nameMatches = candidates.filter((acc) => {
      const accName = acc.name.toLowerCase();
      const matches = accName.includes(partyName) || partyName.includes(accName);
      if (!matches) return false;
      if (partyPattern && hasContradictingDigits(acc.masked_number, partyPattern)) {
        return false;
      }
      return true;
    });

    if (nameMatches.length === 1) {
      return {
        accountId: nameMatches[0].id,
        accountName: nameMatches[0].name,
        confidence: 0.88,
        matchMethod: "name_alias",
        reason: `Matched by account name alias (${nameMatches[0].name})`,
      };
    }

    if (nameMatches.length > 1) {
      return {
        accountId: null,
        confidence: 0.5,
        matchMethod: "ambiguous",
        reason: `Multiple accounts matched name alias ${partyName}`,
        ambiguousCandidates: nameMatches.map((a) => ({ id: a.id, name: a.name })),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Priority E: Bank-only match (Single account for this bank)
  // -------------------------------------------------------------------------
  if (bankCandidates.length === 1) {
    const acc = bankCandidates[0];

    // Check if account has digits or pattern that contradicts slip
    if (partyPattern && hasContradictingDigits(acc.masked_number, partyPattern)) {
      return {
        accountId: null,
        confidence: 0,
        matchMethod: "no_match",
        reason: `Bank ${partyBank} matched but account digits/pattern contradict`,
      };
    }

    const accDigits = extractDigits(acc.masked_number);
    // If party has NO digits:
    // If account has specific digits, but party has none and different name, do NOT match
    if (!partyDigits && accDigits) {
      if (
        partyName &&
        !acc.name.toLowerCase().includes(partyName) &&
        !partyName.includes(acc.name.toLowerCase())
      ) {
        return {
          accountId: null,
          confidence: 0,
          matchMethod: "no_match",
          reason: `Bank ${partyBank} matched but account has digits (${accDigits}) while party has no digits and different name (${party.name})`,
        };
      }
    }

    return {
      accountId: acc.id,
      accountName: acc.name,
      confidence: partyDigits ? 0.95 : 0.85,
      matchMethod: "bank_only",
      reason: `Single account found for bank ${partyBank}`,
    };
  }

  // RULE: NEVER match solely by bank when multiple accounts exist!
  if (bankCandidates.length > 1) {
    return {
      accountId: null,
      confidence: 0.3,
      matchMethod: "ambiguous",
      reason: `Ambiguous: user has ${bankCandidates.length} accounts at ${partyBank} and no distinctive digits`,
      ambiguousCandidates: bankCandidates.map((a) => ({ id: a.id, name: a.name })),
    };
  }

  return {
    accountId: null,
    confidence: 0,
    matchMethod: "no_match",
    reason: "No matching owned account found",
  };
}
