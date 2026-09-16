import { Account, Transaction } from "@/types/finance";
import { ReconciliationRun, ReconciliationStatus } from "@/types/multi-source";
import { calculateAccountBalanceAt } from "./balances";

export interface CreateReconciliationSnapshotParams {
  userId: string;
  account: Account;
  transactions: Transaction[];
  targetInstant: string;
  authoritativeBalanceSatang: number;
  sourceDocumentId?: string | null;
  note?: string | null;
  calculationVersion?: number;
}

/**
 * Creates an immutable point-in-time audit snapshot for an account reconciliation run.
 * Decision 4 Semantics:
 * - Preserves what Finn knew at that exact moment.
 * - Old runs are NEVER mutated or overwritten when transactions subsequently change.
 * - Every reconciliation event generates a distinct, new audit record.
 */
export function createReconciliationSnapshot(
  params: CreateReconciliationSnapshotParams
): ReconciliationRun {
  const {
    userId,
    account,
    transactions,
    targetInstant,
    authoritativeBalanceSatang,
    sourceDocumentId = null,
    note = null,
    calculationVersion = 1,
  } = params;

  const balanceResult = calculateAccountBalanceAt(
    account,
    transactions,
    targetInstant
  );

  let status: ReconciliationStatus;
  let calculatedBalanceSatang: number | null = null;
  let differenceSatang: number | null = null;

  if (balanceResult.status === "cannot_calculate_safely" || balanceResult.balance === null) {
    status = "cannot_calculate_safely";
    calculatedBalanceSatang = null;
    differenceSatang = null;
  } else {
    calculatedBalanceSatang = Math.round(balanceResult.balance * 100);
    differenceSatang = authoritativeBalanceSatang - calculatedBalanceSatang;
    status = differenceSatang === 0 ? "balanced" : "difference_found";
  }

  const snapshot: ReconciliationRun = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    user_id: userId,
    account_id: account.id,
    target_instant: typeof targetInstant === "string" ? targetInstant : new Date(targetInstant).toISOString(),
    authoritative_balance: Math.round(authoritativeBalanceSatang),
    calculated_balance: calculatedBalanceSatang,
    difference: differenceSatang,
    status,
    source_document_id: sourceDocumentId,
    calculation_version: calculationVersion,
    note: note ?? (balanceResult.reason ? `Calculation reason: ${balanceResult.reason}` : null),
    created_at: new Date().toISOString(),
  };

  return snapshot;
}

/**
 * Convert THB decimal to Satang integer.
 */
export function thbToSatang(thb: number): number {
  return Math.round(thb * 100);
}

/**
 * Convert Satang integer to THB decimal.
 */
export function satangToTHB(satang: number): number {
  return Number((satang / 100).toFixed(2));
}
