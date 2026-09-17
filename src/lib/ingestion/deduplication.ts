import { createHash } from "crypto";
import { Transaction } from "@/types/finance";
import {
  IngestionItem,
  IngestionParsedData,
  MatchResult,
  MatchCandidate,
  SourceDocument,
} from "@/types/multi-source";

/**
 * Computes a SHA-256 hash string for raw buffer or text.
 */
export function computeSha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Generates a deterministic RFC 4122-compliant UUID (UUID-shaped deterministic hash) for a source document based on:
 * userId + documentType + fileHash.
 *
 * Formatted as an 8-4-4-4-12 UUID hex string with version 5 and RFC 4122 variant bits set.
 * Ensures concurrent requests for the exact same file produce the exact same primary key ID,
 * allowing database unique constraints to safely reject race conditions without schema migration.
 */
export function generateDeterministicDocId(
  userId: string,
  documentType: string,
  fileHash: string
): string {
  const seed = `${userId}:${documentType}:${fileHash}`;
  const hash = createHash("sha1").update(seed).digest("hex");
  // Form standard UUID format 8-4-4-4-12 with version 5 and variant RFC 4122
  const p1 = hash.slice(0, 8);
  const p2 = hash.slice(8, 12);
  const p3 = "5" + hash.slice(13, 16); // Version 5
  const hexVariant = (parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80;
  const p4 = hexVariant.toString(16).padStart(2, "0") + hash.slice(18, 20);
  const p5 = hash.slice(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/**
 * Generates a deterministic composite fingerprint for fast lookups and possible_match ranking.
 * Decision 2 Rule:
 * - Composite hash of normalized fields (amount, approximate timestamp, masked account, direction).
 * - Used ONLY for possible_match candidate ranking and lookup.
 * - NEVER used for auto-linking transactions.
 */
export function generateCandidateFingerprint(
  parsed: IngestionParsedData | null | undefined
): string | null {
  if (!parsed) return null;

  const amountSatang =
    parsed.amount !== null && parsed.amount !== undefined
      ? parsed.amount
      : parsed.amount_decimal !== null && parsed.amount_decimal !== undefined
      ? Math.round(parsed.amount_decimal * 100)
      : "no_amt";

  // Approximate date to date-string (YYYY-MM-DD) to tolerate minute/hour timezone jitter in banks
  let approxDate = "no_date";
  if (parsed.occurred_at) {
    const d = new Date(parsed.occurred_at);
    if (!isNaN(d.getTime())) {
      approxDate = d.toISOString().slice(0, 10);
    }
  }

  const accountNorm = (parsed.account_number ?? "").replace(/\D/g, "").slice(-4) || "no_acc";
  const directionNorm = parsed.direction ?? (parsed.transaction_type === "income" ? "incoming" : "outgoing");

  const rawSeed = `${amountSatang}|${approxDate}|${accountNorm}|${directionNorm}`;
  return computeSha256(rawSeed).slice(0, 32);
}

export interface ClassifyMatchContext {
  item: IngestionItem;
  sourceDocument?: SourceDocument | null;
  existingSourceDocuments?: SourceDocument[];
  existingIngestionItems?: IngestionItem[];
  existingTransactions?: Transaction[];
  // Account lookup helper to check account institution/masked_number
  accountMap?: Map<string, { institution?: string | null; masked_number?: string | null }>;
}

/**
 * Classifies an ingestion item into one of four mandatory result classes (Decision 2):
 * 1. exact_duplicate: Identical source document (same file SHA-256) or identical message
 * 2. strong_match: Same transaction proven by strong scoped identifier (A, B, C)
 * 3. possible_match: Weak signals (amount+time, merchant, fingerprint) - REQUIRES HUMAN REVIEW
 * 4. no_match: No matching transaction found
 *
 * AUTO-LINK / AUTO-DEDUP MAY USE ONLY STRONG IDENTIFIERS.
 */
export function classifyIngestionMatch(context: ClassifyMatchContext): MatchResult {
  const {
    item,
    sourceDocument,
    existingSourceDocuments = [],
    existingIngestionItems = [],
    existingTransactions = [],
    accountMap = new Map(),
  } = context;

  // Voided transactions MUST NOT be offered as active financial match candidates
  const activeTransactions = existingTransactions.filter((tx) => !tx.voided_at);

  // ==========================================================================
  // Signal B: Exact Original File SHA-256 (where document semantics support exact duplication)
  // ==========================================================================
  if (sourceDocument?.file_hash) {
    const duplicateDoc = existingSourceDocuments.find(
      (doc) =>
        doc.id !== sourceDocument.id &&
        doc.user_id === sourceDocument.user_id &&
        doc.file_hash === sourceDocument.file_hash
    );

    if (duplicateDoc) {
      return {
        matchClass: "exact_duplicate",
        confidence: 1.0,
        reasons: [
          `Identical source document file hash (SHA-256: ${sourceDocument.file_hash.slice(0, 12)}...) matches document ${duplicateDoc.id}`,
        ],
      };
    }
  }

  // ==========================================================================
  // Signal A: Scoped Provider External ID
  // Scoped STRICTLY within user + connection
  // ==========================================================================
  if (item.connection_id && item.provider_external_id) {
    const existingSameExternal = existingIngestionItems.find(
      (existing) =>
        existing.id !== item.id &&
        existing.user_id === item.user_id &&
        existing.connection_id === item.connection_id &&
        existing.provider_external_id === item.provider_external_id
    );

    if (existingSameExternal) {
      if (existingSameExternal.matched_transaction_id) {
        return {
          matchClass: "strong_match",
          confidence: 1.0,
          matchedTransactionId: existingSameExternal.matched_transaction_id,
          reasons: [
            `Strong match: Scoped provider external ID "${item.provider_external_id}" within connection "${item.connection_id}" already linked to transaction ${existingSameExternal.matched_transaction_id}`,
          ],
        };
      }
      return {
        matchClass: "exact_duplicate",
        confidence: 1.0,
        reasons: [
          `Exact duplicate item: Scoped provider external ID "${item.provider_external_id}" in connection "${item.connection_id}" already exists as item ${existingSameExternal.id}`,
        ],
      };
    }
  }

  const possibleCandidates: MatchCandidate[] = [];

  // ==========================================================================
  // Signal C: Scoped Transaction Reference Number
  // Scope required: institution / account / direction / reference
  // NEVER assumed globally unique across all banks!
  // ==========================================================================
  if (item.reference_number && item.reference_number.trim().length > 0) {
    const targetRef = item.reference_number.trim().toLowerCase();
    const itemBank = (item.parsed_data?.bank_code ?? "").toLowerCase().trim();
    const itemDirection = item.parsed_data?.direction;
    const itemAccountLast4 = (item.parsed_data?.account_number ?? "").replace(/\D/g, "").slice(-4);

    for (const tx of activeTransactions) {
      if (tx.user_id !== item.user_id) continue;

      const txRef = (tx.reference_number ?? "").trim().toLowerCase();
      if (txRef && txRef === targetRef) {
        // Evaluate scoping: must match institution/account and direction
        const fromAcc = tx.from_account_id ? accountMap.get(tx.from_account_id) : null;
        const toAcc = tx.to_account_id ? accountMap.get(tx.to_account_id) : null;

        const txInstitutions = [
          fromAcc?.institution?.toLowerCase(),
          toAcc?.institution?.toLowerCase(),
        ].filter(Boolean) as string[];

        const txAccountMasks = [
          fromAcc?.masked_number,
          toAcc?.masked_number,
        ].filter(Boolean) as string[];

        // Strict verification: Institution MUST be verified (both item and tx institution known and matching)
        const hasVerifiedInstitution =
          itemBank.length > 0 &&
          txInstitutions.length > 0 &&
          txInstitutions.some((inst) => inst.includes(itemBank) || itemBank.includes(inst));

        const accountMatches =
          !itemAccountLast4 ||
          txAccountMasks.some((mask) => mask && mask.includes(itemAccountLast4));

        let txDirection: "incoming" | "outgoing" | null = null;
        if (
          tx.type === "income" ||
          tx.type === "refund" ||
          tx.type === "gift" ||
          tx.type === "reimbursement" ||
          tx.type === "loan_received"
        ) {
          txDirection = "incoming";
        } else if (
          tx.type === "expense" ||
          tx.type === "investment" ||
          tx.type === "loan_payment"
        ) {
          txDirection = "outgoing";
        }

        // Strict verification: Direction MUST be verified (both item and tx direction known and identical)
        const hasVerifiedDirection =
          itemDirection !== undefined &&
          itemDirection !== null &&
          txDirection !== null &&
          itemDirection === txDirection;

        // ONLY when BOTH verified institution AND verified direction are present and matching does it qualify as strong_match!
        if (hasVerifiedInstitution && hasVerifiedDirection && accountMatches) {
          return {
            matchClass: "strong_match",
            confidence: 0.98,
            matchedTransactionId: tx.id,
            reasons: [
              `Strong match: Scoped reference "${item.reference_number}" matched transaction ${tx.id} with verified scope (institution: ${itemBank}, direction: ${itemDirection})`,
            ],
          };
        }

        // Reference number matched, but missing verified bank, verified direction, or account match:
        // MUST produce possible_match (not strong_match) to require manual operator review!
        const missingReasons: string[] = [];
        if (!hasVerifiedInstitution) {
          missingReasons.push(
            itemBank.length === 0
              ? "missing verified bank institution code on ingestion item"
              : `unverified institution: "${itemBank}" did not match transaction account institution(s) [${txInstitutions.join(", ")}]`
          );
        }
        if (!hasVerifiedDirection) {
          missingReasons.push(
            !itemDirection
              ? "missing verified direction on ingestion item"
              : !txDirection
              ? "undetermined direction on transaction"
              : `direction mismatch (item: ${itemDirection}, tx: ${txDirection})`
          );
        }
        if (!accountMatches) {
          missingReasons.push(
            `account last 4 "${itemAccountLast4}" did not match transaction account masks [${txAccountMasks.join(", ")}]`
          );
        }

        possibleCandidates.push({
          transaction_id: tx.id,
          confidence: 0.75, // Strictly capped < 0.85
          reasons: [
            `Reference number "${item.reference_number}" matches transaction ${tx.id}, but requires human review due to unverified scope (${missingReasons.join("; ")})`,
          ],
        });
      }
    }
  }

  // ==========================================================================
  // Weak Signals (MUST NOT auto-merge alone — produces possible_match)
  // - account + amount + timestamp
  // - amount + merchant
  // - amount + date
  // - fuzzy description
  // - candidate fingerprint without strong source evidence
  // ==========================================================================
  const itemSatang =
    item.parsed_data?.amount !== null && item.parsed_data?.amount !== undefined
      ? item.parsed_data.amount
      : item.parsed_data?.amount_decimal !== null && item.parsed_data?.amount_decimal !== undefined
      ? Math.round(item.parsed_data.amount_decimal * 100)
      : null;

  const itemTime = item.parsed_data?.occurred_at
    ? new Date(item.parsed_data.occurred_at).getTime()
    : null;

  const itemFingerprint = item.fingerprint || generateCandidateFingerprint(item.parsed_data);

  for (const tx of activeTransactions) {
    if (tx.user_id !== item.user_id) continue;

    const txSatang = Math.round(Number(tx.amount || 0) * 100);
    const txTime = tx.transaction_date ? new Date(tx.transaction_date).getTime() : null;

    let score = 0;
    const reasons: string[] = [];

    // 1. Amount match (mandatory for financial plausibility)
    if (itemSatang !== null && itemSatang === txSatang) {
      score += 0.4;
      reasons.push(`Exact amount match (${(itemSatang / 100).toFixed(2)} THB)`);
    } else {
      // Different amounts are almost never the same transaction
      continue;
    }

    // 2. Timestamp proximity
    if (itemTime !== null && txTime !== null && !isNaN(itemTime) && !isNaN(txTime)) {
      const diffMs = Math.abs(itemTime - txTime);
      const diffMinutes = diffMs / (1000 * 60);

      if (diffMinutes <= 5) {
        score += 0.3;
        reasons.push(`Occurred within ${Math.round(diffMinutes)} minutes`);
      } else if (diffMinutes <= 60 * 24) {
        score += 0.2;
        reasons.push(`Occurred on same day (${Math.round(diffMinutes / 60)} hours difference)`);
      } else if (diffMinutes <= 60 * 48) {
        score += 0.1;
        reasons.push("Occurred within 48 hours");
      }
    }

    // 3. Merchant or description overlap
    const itemDesc = (item.parsed_data?.description || item.parsed_data?.merchant_name || "").toLowerCase();
    const txDesc = (tx.description || tx.note || "").toLowerCase();
    if (itemDesc && txDesc) {
      if (itemDesc.includes(txDesc) || txDesc.includes(itemDesc)) {
        score += 0.15;
        reasons.push("Description / merchant match");
      }
    }

    // 4. Fingerprint alignment
    if (itemFingerprint) {
      // Reconstruct tx approximate fingerprint
      const txAccountLast4 = tx.from_account_id ? accountMap.get(tx.from_account_id)?.masked_number?.slice(-4) : "";
      const txDirection = tx.type === "income" ? "incoming" : "outgoing";
      const txApproxDate = tx.transaction_date ? tx.transaction_date.slice(0, 10) : "";
      const txRawSeed = `${txSatang}|${txApproxDate}|${txAccountLast4 || "no_acc"}|${txDirection}`;
      const txFp = computeSha256(txRawSeed).slice(0, 32);

      if (itemFingerprint === txFp) {
        score += 0.1;
        reasons.push("Normalized field fingerprint matched");
      }
    }

    // Weak signals threshold: if score >= 0.5, queue as possible_match
    if (score >= 0.5) {
      // Hard cap at 0.85: Weak signals NEVER exceed 0.85 confidence and NEVER auto-link!
      const cappedConfidence = Math.min(Number(score.toFixed(2)), 0.85);
      const existingCandidate = possibleCandidates.find((c) => c.transaction_id === tx.id);
      if (existingCandidate) {
        existingCandidate.confidence = Math.max(existingCandidate.confidence, cappedConfidence);
        existingCandidate.reasons.push(...reasons);
      } else {
        possibleCandidates.push({
          transaction_id: tx.id,
          confidence: cappedConfidence,
          reasons,
        });
      }
    }
  }

  if (possibleCandidates.length > 0) {
    // Sort candidates by highest confidence
    possibleCandidates.sort((a, b) => b.confidence - a.confidence);
    const top = possibleCandidates[0];

    return {
      matchClass: "possible_match",
      confidence: top.confidence,
      matchedTransactionId: null, // Deliberately NULL: Weak signals require manual human confirmation!
      reasons: [
        `Possible match found (${possibleCandidates.length} candidates). Financial safety rule: requires user confirmation in Inbox.`,
        ...top.reasons,
      ],
      candidates: possibleCandidates,
    };
  }

  // ==========================================================================
  // No Match
  // ==========================================================================
  return {
    matchClass: "no_match",
    confidence: 0,
    reasons: ["No existing matching transaction found"],
  };
}
