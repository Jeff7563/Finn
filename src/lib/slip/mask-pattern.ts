/**
 * Masked Account Pattern Intelligence for Thai Bank Slips.
 *
 * Preserves:
 * - Visible digits
 * - Masked positions
 * - Length
 * - Bank/institution
 * - Separator-independent pattern
 *
 * Canonicalizes mask characters (x, X, *, •, ·, _, ~, #) to '*'
 * Strips separators (-, space, /, .)
 */

/**
 * Canonicalizes raw masked account string into a normalized positional mask pattern.
 * E.g.:
 * "xxx-x-x7520-x" -> "*****7520*" (length 10)
 * "123-x-xxxx-4"  -> "123*****4"  (length 9)
 * "xxx-1-23456-x" -> "***123456*" (length 10)
 * "··5205"        -> "**5205"     (length 6)
 * "x-1234"        -> "*1234"      (length 5)
 * "1234"          -> "1234"       (length 4)
 */
export function normalizeMaskedPattern(raw?: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // 1. Remove separators: dashes, spaces, slashes, middle dots when separated
  // Keep mask characters and digits
  let result = "";
  for (const char of trimmed) {
    if (char === "-" || char === " " || char === "/" || char === ".") {
      continue;
    }
    // Mask characters: x, X, *, • (\u2022), · (\u00b7), _, ~, #
    if (
      char === "x" ||
      char === "X" ||
      char === "*" ||
      char === "•" ||
      char === "·" ||
      char === "_" ||
      char === "~" ||
      char === "#"
    ) {
      result += "*";
    } else if (char >= "0" && char <= "9") {
      result += char;
    }
  }

  return result;
}

/**
 * Extracts visible digits from a pattern or raw string.
 */
export function extractDigitsFromPattern(patternOrRaw?: string | null): string {
  if (!patternOrRaw) return "";
  return patternOrRaw.replace(/\D/g, "");
}

/**
 * Checks if the pattern has any visible digits.
 */
export function hasVisibleDigits(pattern?: string | null): boolean {
  return extractDigitsFromPattern(pattern).length > 0;
}

/**
 * Counts the number of matching identical digits at identical positions.
 * Returns 0 if there is any contradictory digit at the same position,
 * or if lengths differ.
 */
export function countSharedPositionalDigits(
  patternA: string,
  patternB: string
): number {
  if (!patternA || !patternB) return 0;
  if (patternA.length !== patternB.length) return 0;

  let sharedDigits = 0;
  for (let i = 0; i < patternA.length; i++) {
    const cA = patternA[i];
    const cB = patternB[i];

    const isDigitA = cA >= "0" && cA <= "9";
    const isDigitB = cB >= "0" && cB <= "9";

    if (isDigitA && isDigitB) {
      if (cA !== cB) return 0; // Contradictory digit at identical index
      sharedDigits++;
    }
  }

  return sharedDigits;
}

/**
 * Determines whether two normalized positional patterns match positionally.
 *
 * Rules:
 * 1. Must have the same length.
 * 2. At every position i:
 *    - If both are digits, they must be equal.
 *    - If one is '*' and other is digit, compatible.
 *    - If both are '*', compatible.
 * 3. Must share at least minSharedDigits visible digits (default: 1).
 */
export function isPositionalPatternMatch(
  patternA: string,
  patternB: string,
  minSharedDigits: number = 1
): boolean {
  return countSharedPositionalDigits(patternA, patternB) >= minSharedDigits;
}

/**
 * Checks if an account's masked number is a safe suffix match for a slip pattern.
 *
 * CRITICAL RULE:
 * A suffix match is ONLY valid if the slip pattern has NO trailing masks after its visible digits!
 * E.g.:
 * Slip: "******1234" (ends with 1234, no trailing '*') and Account: "1234" -> MATCH
 * Slip: "*****7520*" (ends with '*', NOT 7520) and Account: "7520" -> NO MATCH (incompatible position)
 */
export function isSafeSuffixMatch(
  accountMasked: string | null | undefined,
  slipPattern: string
): boolean {
  if (!accountMasked || !slipPattern) return false;
  // If slip pattern has trailing mask (*), digits are not trailing; suffix match is unsafe!
  if (slipPattern.endsWith("*")) return false;

  const slipDigits = extractDigitsFromPattern(slipPattern);
  const accPattern = normalizeMaskedPattern(accountMasked);
  const accDigits = extractDigitsFromPattern(accPattern);

  if (slipDigits.length < 3 || accDigits.length < 3) return false;

  // Acc digits must match the end of slip digits
  return slipDigits.endsWith(accDigits) || accDigits.endsWith(slipDigits);
}

/**
 * Detects if an account's masked number directly contradicts the slip pattern.
 * E.g. Slip has "7520" in positions 5..8 with trailing '*', while Account has "5205" at end.
 */
export function hasContradictingDigits(
  accountMasked: string | null | undefined,
  slipPattern: string
): boolean {
  if (!accountMasked || !slipPattern) return false;

  const accPattern = normalizeMaskedPattern(accountMasked);
  const accDigits = extractDigitsFromPattern(accPattern);
  const slipDigits = extractDigitsFromPattern(slipPattern);

  if (!accDigits || !slipDigits) return false;

  // 1. If same length, check positional digit collision
  if (accPattern.length === slipPattern.length) {
    for (let i = 0; i < accPattern.length; i++) {
      const cA = accPattern[i];
      const cS = slipPattern[i];
      const isDigitA = cA >= "0" && cA <= "9";
      const isDigitS = cS >= "0" && cS <= "9";
      if (isDigitA && isDigitS && cA !== cS) {
        return true;
      }
    }
  }

  // 2. If one pattern has a trailing mask while the other has explicit terminal digits:
  // E.g. slipPattern is "*****7520*" (non-terminal digits) while accPattern is "7520" (terminal digits)
  if (!accPattern.endsWith("*") && slipPattern.endsWith("*")) {
    return true;
  }
  if (accPattern.endsWith("*") && !slipPattern.endsWith("*")) {
    return true;
  }

  // 3. If neither ends with mask, but their trailing digits differ
  if (!accPattern.endsWith("*") && !slipPattern.endsWith("*")) {
    const minLen = Math.min(accDigits.length, slipDigits.length);
    if (minLen >= 3) {
      const accTail = accDigits.slice(-minLen);
      const slipTail = slipDigits.slice(-minLen);
      if (accTail !== slipTail) {
        return true;
      }
    }
  }

  return false;
}
