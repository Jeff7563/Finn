import { Direction, FieldConfidence, AccountMatchMethod } from "@/types/slip";

export const AUTOCONFIRM_SAFE_MATCH_METHODS: readonly AccountMatchMethod[] = [
  "verified_alias",
  "positional_mask",
  "masked_suffix",
] as const;

export interface ConfidenceEvaluationParams {
  amount?: number;
  transactionDate?: string;
  direction: Direction;
  directionRequiresReview: boolean;
  senderAccountId?: string | null;
  senderAccountConfidence?: number;
  senderMatchMethod?: AccountMatchMethod;
  receiverAccountId?: string | null;
  receiverAccountConfidence?: number;
  receiverMatchMethod?: AccountMatchMethod;
  fieldConfidence: FieldConfidence;
  duplicateWarning?: boolean;
  duplicateRequiresReview?: boolean;
}

export interface ConfidenceDecision {
  overallConfidence: number;
  canAutoCreate: boolean;
  status: "created" | "needs_review";
  reasons: string[];
}

export const THRESHOLDS = {
  AMOUNT_CONFIDENCE_MIN: 0.98,
  ACCOUNT_CONFIDENCE_MIN: 0.95,
  DIRECTION_CONFIDENCE_MIN: 0.95,
};

/**
 * Evaluates extraction confidence and applies strict rule-based gating.
 *
 * Rules:
 * 1. Amount must be positive finite number and confidence >= 0.98.
 * 2. At least one owned account must match with confidence >= 0.95.
 * 3. Direction must be clear (internal_transfer or outgoing).
 * 4. INCOMING MONEY MUST NEVER AUTO-CONFIRM (always needs_review).
 * 5. DUPLICATE RISK MUST ROUTE TO REVIEW.
 * 6. Date must be valid.
 */
export function evaluateConfidence(
  params: ConfidenceEvaluationParams
): ConfidenceDecision {
  const reasons: string[] = [];
  let canAutoCreate = true;

  // 1. Amount Verification
  const amountConf = params.fieldConfidence.amount ?? 0;
  if (!params.amount || !Number.isFinite(params.amount) || params.amount <= 0) {
    canAutoCreate = false;
    reasons.push("จำนวนเงินไม่ถูกต้องหรืออ่านค่าไม่ได้");
  } else if (amountConf < THRESHOLDS.AMOUNT_CONFIDENCE_MIN) {
    canAutoCreate = false;
    reasons.push(`ความมั่นใจของจำนวนเงิน (${Math.round(amountConf * 100)}%) ต่ำกว่าเกณฑ์ที่กำหนด (98%)`);
  }

  // 2. Date Verification
  if (!params.transactionDate || isNaN(new Date(params.transactionDate).getTime())) {
    canAutoCreate = false;
    reasons.push("วันที่และเวลาของรายการไม่ถูกต้องหรือไม่ครบถ้วน");
  }

  // 3. Direction and Account Verification
  if (params.direction === "unknown") {
    canAutoCreate = false;
    reasons.push("ไม่สามารถระบุทิศทางการเงินได้ (ไม่พบบัญชีของท่านที่ตรงกัน)");
  } else if (params.direction === "internal_transfer") {
    // Both accounts must match with high confidence
    const sConf = params.senderAccountConfidence ?? 0;
    const rConf = params.receiverAccountConfidence ?? 0;
    if (sConf < THRESHOLDS.ACCOUNT_CONFIDENCE_MIN || rConf < THRESHOLDS.ACCOUNT_CONFIDENCE_MIN) {
      canAutoCreate = false;
      reasons.push("การโอนระหว่างบัญชีตนเองต้องการความมั่นใจของทั้งสองบัญชีอย่างน้อย 95%");
    }
    if (params.senderMatchMethod && !AUTOCONFIRM_SAFE_MATCH_METHODS.includes(params.senderMatchMethod)) {
      canAutoCreate = false;
      reasons.push(`วิธีการระบุบัญชีต้นทาง (${params.senderMatchMethod}) ไม่อยู่ในเกณฑ์ที่สามารถบันทึกอัตโนมัติได้`);
    }
    if (params.receiverMatchMethod && !AUTOCONFIRM_SAFE_MATCH_METHODS.includes(params.receiverMatchMethod)) {
      canAutoCreate = false;
      reasons.push(`วิธีการระบุบัญชีปลายทาง (${params.receiverMatchMethod}) ไม่อยู่ในเกณฑ์ที่สามารถบันทึกอัตโนมัติได้`);
    }
  } else if (params.direction === "outgoing") {
    const sConf = params.senderAccountConfidence ?? 0;
    if (sConf < THRESHOLDS.ACCOUNT_CONFIDENCE_MIN) {
      canAutoCreate = false;
      reasons.push(`ความมั่นใจของบัญชีต้นทาง (${Math.round(sConf * 100)}%) ต่ำกว่าเกณฑ์ 95%`);
    }
    if (params.senderMatchMethod && !AUTOCONFIRM_SAFE_MATCH_METHODS.includes(params.senderMatchMethod)) {
      canAutoCreate = false;
      reasons.push(`วิธีการระบุบัญชีต้นทาง (${params.senderMatchMethod}) ไม่อยู่ในเกณฑ์ที่สามารถบันทึกอัตโนมัติได้`);
    }
  } else if (params.direction === "incoming") {
    // MANDATORY CONSTRAINT: ALL incoming external funds remain needs_review
    canAutoCreate = false;
    reasons.push("เงินโอนเข้าบัญชีต้องได้รับการยืนยันประเภทรายการจากผู้ใช้เสมอ (Incoming funds require user review)");
  }

  // 4. Direction Flag Check
  if (params.directionRequiresReview) {
    canAutoCreate = false;
  }

  // 5. Duplicate Risk Check
  if (params.duplicateWarning || params.duplicateRequiresReview) {
    canAutoCreate = false;
    reasons.push("ตรวจพบความเสี่ยงรายการซ้ำ (Duplicate risk requires review)");
  }

  // Calculate composite confidence score
  // Critical weights: Amount (35%), Account (35%), Date (15%), Others (15%)
  const amountWeight = 0.35 * (amountConf || 0);
  const accountWeight =
    0.35 *
    (params.direction === "internal_transfer"
      ? Math.min(params.senderAccountConfidence ?? 0, params.receiverAccountConfidence ?? 0)
      : params.direction === "outgoing"
      ? params.senderAccountConfidence ?? 0
      : params.receiverAccountConfidence ?? 0);
  const dateWeight = 0.15 * (params.fieldConfidence.transactionDate ?? 0.8);
  const otherWeight = 0.15 * (params.fieldConfidence.reference ? 1.0 : 0.7);

  const overallConfidence = Math.min(
    1.0,
    Math.max(0.1, Number((amountWeight + accountWeight + dateWeight + otherWeight).toFixed(2)))
  );

  return {
    overallConfidence,
    canAutoCreate,
    status: canAutoCreate ? "created" : "needs_review",
    reasons,
  };
}
