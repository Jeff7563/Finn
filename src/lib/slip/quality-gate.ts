import { SlipExtraction, SlipParty, FieldConfidence } from "@/types/slip";

/**
 * Checks whether a party (sender or receiver) is effectively empty.
 */
export function isPartyEmpty(party?: SlipParty | null): boolean {
  if (!party) return true;
  const hasName = Boolean(party.name && party.name.trim().length > 0);
  const hasBank = Boolean(party.bank && party.bank.trim().length > 0);
  const hasAccount = Boolean(party.accountMasked && party.accountMasked.trim().length > 0);
  return !hasName && !hasBank && !hasAccount;
}

/**
 * Checks whether an amount is valid and positive.
 */
export function isAmountValid(amount?: number | null): boolean {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

/**
 * Checks whether a transaction date string is valid and parseable.
 */
export function isDateValid(dateStr?: string | null): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  return !isNaN(new Date(dateStr).getTime());
}

/**
 * Evaluates whether a Vision extraction is materially unusable.
 * An extraction is classified as materially unusable when:
 * - amount is missing or <= 0
 * AND
 * - transactionDate is missing or invalid
 * AND
 * - sender and receiver are effectively empty
 * AND
 * - reference is missing
 */
export function isMateriallyUnusable(
  ext: Partial<SlipExtraction> | null | undefined
): boolean {
  if (!ext) return true;

  const hasAmount = isAmountValid(ext.amount);
  const hasDate = isDateValid(ext.transactionDate);
  const hasSender = !isPartyEmpty(ext.sender);
  const hasReceiver = !isPartyEmpty(ext.receiver);
  const hasReference = Boolean(ext.reference && ext.reference.trim().length > 0);

  return !hasAmount && !hasDate && !hasSender && !hasReceiver && !hasReference;
}

/**
 * Calculates a normalized completeness score (0.0 to 1.0) for an extraction.
 * Weight distribution:
 * - amount: 0.35 (Critical)
 * - transactionDate: 0.25 (Critical)
 * - sender: 0.15 (Important)
 * - receiver: 0.15 (Important)
 * - reference: 0.10 (Important)
 */
export function calculateCompletenessScore(
  ext: Partial<SlipExtraction> | null | undefined
): number {
  if (!ext) return 0.0;

  let score = 0.0;
  if (isAmountValid(ext.amount)) {
    score += 0.35;
  }
  if (isDateValid(ext.transactionDate)) {
    score += 0.25;
  }
  if (!isPartyEmpty(ext.sender)) {
    score += 0.15;
  }
  if (!isPartyEmpty(ext.receiver)) {
    score += 0.15;
  }
  if (ext.reference && ext.reference.trim().length > 0) {
    score += 0.10;
  }

  return Math.round(score * 100) / 100;
}

export interface MergeResult {
  merged: SlipExtraction;
  changedFields: string[];
  preservedFields: string[];
  fieldMergeOccurred: boolean;
}

/**
 * Merges an incoming extraction into an existing extraction non-destructively.
 * Rules:
 * 1. Never overwrite a valid existing field with an undefined/null/empty/invalid incoming field.
 * 2. If the incoming extraction is materially unusable, the existing extraction is preserved entirely.
 * 3. Incoming valid fields overwrite or enhance existing fields (e.g. corrected transactionDate).
 * 4. The merged completeness score is guaranteed to be >= existing completeness score.
 */
export function mergeSlipExtractions(
  existing: SlipExtraction | null | undefined,
  incoming: SlipExtraction | null | undefined
): MergeResult {
  // If no existing extraction, return incoming if valid, or a safe fallback
  if (!existing) {
    const fallback: SlipExtraction = incoming || {
      currency: "THB",
      fieldConfidence: {},
    };
    return {
      merged: fallback,
      changedFields: incoming ? Object.keys(incoming) : [],
      preservedFields: [],
      fieldMergeOccurred: false,
    };
  }

  // If incoming is missing or materially unusable, keep existing 100% intact
  if (!incoming || isMateriallyUnusable(incoming)) {
    return {
      merged: existing,
      changedFields: [],
      preservedFields: ["amount", "transactionDate", "sender", "receiver", "reference"],
      fieldMergeOccurred: false,
    };
  }

  const changedFields: string[] = [];
  const preservedFields: string[] = [];

  // 1. Amount
  let amount = existing.amount;
  let amountConfidence = existing.fieldConfidence?.amount;
  if (isAmountValid(incoming.amount)) {
    if (incoming.amount !== existing.amount) {
      changedFields.push("amount");
    }
    amount = incoming.amount;
    amountConfidence = incoming.fieldConfidence?.amount ?? existing.fieldConfidence?.amount;
  } else if (isAmountValid(existing.amount)) {
    preservedFields.push("amount");
  }

  // 2. Transaction Date
  let transactionDate = existing.transactionDate;
  let dateConfidence = existing.fieldConfidence?.transactionDate;
  if (isDateValid(incoming.transactionDate)) {
    if (incoming.transactionDate !== existing.transactionDate) {
      changedFields.push("transactionDate");
    }
    transactionDate = incoming.transactionDate;
    dateConfidence = incoming.fieldConfidence?.transactionDate ?? existing.fieldConfidence?.transactionDate;
  } else if (isDateValid(existing.transactionDate)) {
    preservedFields.push("transactionDate");
  }

  // 3. Sender
  const senderName = incoming.sender?.name?.trim() || existing.sender?.name || null;
  const senderBank = incoming.sender?.bank?.trim() || existing.sender?.bank || null;
  const senderAccount = incoming.sender?.accountMasked?.trim() || existing.sender?.accountMasked || null;

  if (incoming.sender?.name && incoming.sender.name !== existing.sender?.name) changedFields.push("sender.name");
  else if (existing.sender?.name && !incoming.sender?.name) preservedFields.push("sender.name");

  if (incoming.sender?.bank && incoming.sender.bank !== existing.sender?.bank) changedFields.push("sender.bank");
  else if (existing.sender?.bank && !incoming.sender?.bank) preservedFields.push("sender.bank");

  if (incoming.sender?.accountMasked && incoming.sender.accountMasked !== existing.sender?.accountMasked) changedFields.push("sender.accountMasked");
  else if (existing.sender?.accountMasked && !incoming.sender?.accountMasked) preservedFields.push("sender.accountMasked");

  const sender: SlipParty = {
    name: senderName,
    bank: senderBank,
    accountMasked: senderAccount,
  };

  // 4. Receiver
  const receiverName = incoming.receiver?.name?.trim() || existing.receiver?.name || null;
  const receiverBank = incoming.receiver?.bank?.trim() || existing.receiver?.bank || null;
  const receiverAccount = incoming.receiver?.accountMasked?.trim() || existing.receiver?.accountMasked || null;

  if (incoming.receiver?.name && incoming.receiver.name !== existing.receiver?.name) changedFields.push("receiver.name");
  else if (existing.receiver?.name && !incoming.receiver?.name) preservedFields.push("receiver.name");

  if (incoming.receiver?.bank && incoming.receiver.bank !== existing.receiver?.bank) changedFields.push("receiver.bank");
  else if (existing.receiver?.bank && !incoming.receiver?.bank) preservedFields.push("receiver.bank");

  if (incoming.receiver?.accountMasked && incoming.receiver.accountMasked !== existing.receiver?.accountMasked) changedFields.push("receiver.accountMasked");
  else if (existing.receiver?.accountMasked && !incoming.receiver?.accountMasked) preservedFields.push("receiver.accountMasked");

  const receiver: SlipParty = {
    name: receiverName,
    bank: receiverBank,
    accountMasked: receiverAccount,
  };

  // 5. Reference
  let reference = existing.reference;
  let refConfidence = existing.fieldConfidence?.reference;
  if (incoming.reference && incoming.reference.trim().length > 0) {
    if (incoming.reference !== existing.reference) {
      changedFields.push("reference");
    }
    reference = incoming.reference.trim();
    refConfidence = incoming.fieldConfidence?.reference ?? existing.fieldConfidence?.reference;
  } else if (existing.reference) {
    preservedFields.push("reference");
  }

  // 6. Confidences
  const mergedConfidence: FieldConfidence = {
    ...existing.fieldConfidence,
    ...incoming.fieldConfidence,
    amount: amountConfidence,
    transactionDate: dateConfidence,
    reference: refConfidence,
    senderName: incoming.sender?.name ? incoming.fieldConfidence?.senderName : existing.fieldConfidence?.senderName,
    senderBank: incoming.sender?.bank ? incoming.fieldConfidence?.senderBank : existing.fieldConfidence?.senderBank,
    senderAccount: incoming.sender?.accountMasked ? incoming.fieldConfidence?.senderAccount : existing.fieldConfidence?.senderAccount,
    receiverName: incoming.receiver?.name ? incoming.fieldConfidence?.receiverName : existing.fieldConfidence?.receiverName,
    receiverBank: incoming.receiver?.bank ? incoming.fieldConfidence?.receiverBank : existing.fieldConfidence?.receiverBank,
    receiverAccount: incoming.receiver?.accountMasked ? incoming.fieldConfidence?.receiverAccount : existing.fieldConfidence?.receiverAccount,
  };

  const merged: SlipExtraction = {
    amount,
    currency: "THB",
    transactionDate,
    sender,
    receiver,
    reference,
    channel: incoming.channel || existing.channel || "Mobile Banking",
    qrPayload: incoming.qrPayload || existing.qrPayload,
    fieldConfidence: mergedConfidence,
  };

  // Completeness score gate: reprocess must never downgrade completeness
  const existingScore = calculateCompletenessScore(existing);
  const mergedScore = calculateCompletenessScore(merged);

  if (mergedScore < existingScore) {
    return {
      merged: existing,
      changedFields: [],
      preservedFields: ["amount", "transactionDate", "sender", "receiver", "reference"],
      fieldMergeOccurred: false,
    };
  }

  return {
    merged,
    changedFields,
    preservedFields,
    fieldMergeOccurred: changedFields.length > 0,
  };
}
