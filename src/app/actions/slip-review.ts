"use server";

import { getAuthenticatedUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { privateStorage } from "@/lib/server/private-storage";
import { TransactionFormData } from "@/lib/validation/schemas";
import { defaultSlipProcessor } from "@/lib/slip/processor";
import { SlipProcessingResult } from "@/types/slip";
import { revalidatePath } from "next/cache";

import { matchOwnedAccount } from "@/lib/slip/account-match";
import { classifyDirection } from "@/lib/slip/direction";
import { matchCounterparty } from "@/lib/slip/counterparty-match";
import { suggestCategory } from "@/lib/slip/category-suggest";
import { bangkokDateTimeLocalToCanonicalInstant } from "@/lib/finance/formatters";
import {
  normalizeMaskedPattern,
  hasSufficientVisibleDigits,
} from "@/lib/slip/mask-pattern";

export interface ReviewActionResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

/**
 * Best-effort helper to learn account match aliases from confirmed slips.
 * Crucial guarantee: Alias-learning failure NEVER rolls back or fails a valid financial transaction.
 * Hardening: Verified aliases must contain at least 3 visible digits after normalization.
 */
async function safelyLearnAlias(
  userId: string,
  accountId: string | null | undefined,
  bank: string | null | undefined,
  rawMasked: string | null | undefined,
  source: string
): Promise<void> {
  if (!accountId || !rawMasked) return;
  const pattern = normalizeMaskedPattern(rawMasked);
  if (!pattern || !hasSufficientVisibleDigits(pattern, 3)) return;

  try {
    await DataStore.recordAccountMatchAlias(userId, {
      account_id: accountId,
      institution: bank || null,
      raw_masked_pattern: rawMasked,
      normalized_masked_pattern: pattern,
      source,
    });
  } catch (err) {
    // Non-blocking best-effort
    console.warn("Best-effort alias recording skipped:", err);
  }
}

/**
 * Confirms a pending slip directly as a transaction without edits.
 * Enforces strict financial classification rules and idempotent execution.
 */
export async function confirmSlipAction(
  slipId: string
): Promise<ReviewActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const slip = await DataStore.getSlipById(user.id, slipId);
    if (!slip) {
      return { success: false, error: "ไม่พบข้อมูลสลิปหรือคุณไม่มีสิทธิ์เข้าถึง" };
    }

    // Idempotency: if already confirmed or linked, return existing transaction
    if (slip.linked_transaction_id) {
      return { success: true, transactionId: slip.linked_transaction_id };
    }
    if (slip.status === "created" && slip.linked_transaction_id) {
      return { success: true, transactionId: slip.linked_transaction_id };
    }

    if (slip.status !== "needs_review") {
      return { success: false, error: `สถานะของสลิปไม่อยู่ในขั้นตอนรอตรวจสอบ (${slip.status})` };
    }

    const ext = slip.extracted_json;
    if (!ext || !ext.amount || ext.amount <= 0) {
      return { success: false, error: "สลิปนี้ไม่มีจำนวนเงินที่ถูกต้อง กรุณาแก้ไขก่อนยืนยัน" };
    }

    // Match accounts against user's owned accounts (leveraging learned aliases)
    const accounts = await DataStore.getAccounts(user.id);
    const aliases = await DataStore.getAccountMatchAliases(user.id);
    const sMatch = matchOwnedAccount(ext.sender, accounts, aliases);
    const rMatch = matchOwnedAccount(ext.receiver, accounts, aliases);
    const directionClass = classifyDirection(sMatch.accountId, rMatch.accountId);

    let fromAccountId: string | null = null;
    let toAccountId: string | null = null;
    const txType = directionClass.suggestedType;

    // Strict Account Ownership & Invariant Verification:
    // Never guess account ownership; require user selection if not matched!
    if (txType === "expense") {
      if (!sMatch.accountId) {
        return {
          success: false,
          error: "ไม่พบบัญชีต้นทางของท่านที่ตรงกับสลิปนี้ กรุณากดแก้ไขเพื่อเลือกบัญชีก่อนยืนยัน",
        };
      }
      fromAccountId = sMatch.accountId;
    } else if (txType === "income") {
      if (!rMatch.accountId) {
        return {
          success: false,
          error: "ไม่พบบัญชีปลายทางของท่านที่ตรงกับสลิปนี้ กรุณากดแก้ไขเพื่อเลือกบัญชีก่อนยืนยัน",
        };
      }
      toAccountId = rMatch.accountId;
    } else if (txType === "transfer") {
      if (!sMatch.accountId || !rMatch.accountId) {
        return {
          success: false,
          error: "การโอนเงินระหว่างบัญชีต้องระบุทั้งบัญชีต้นทางและปลายทาง กรุณากดแก้ไขเพื่อเลือกบัญชี",
        };
      }
      if (sMatch.accountId === rMatch.accountId) {
        return {
          success: false,
          error: "บัญชีต้นทางและปลายทางต้องไม่เป็นบัญชีเดียวกัน",
        };
      }
      fromAccountId = sMatch.accountId;
      toAccountId = rMatch.accountId;
    } else {
      return {
        success: false,
        error: "ไม่สามารถระบุทิศทางของรายการได้ กรุณากดแก้ไขเพื่อเลือกประเภทรายการและบัญชี",
      };
    }

    // Safe counterparty and category suggestions
    const merchants = await DataStore.getMerchants(user.id);
    const people = await DataStore.getPeople(user.id);
    const counterpartyName =
      txType === "income" ? ext.sender?.name : ext.receiver?.name;
    const cpMatch = matchCounterparty(counterpartyName, merchants, people);

    const categories = await DataStore.getCategories(user.id);
    const matchedMerchant = cpMatch.merchantId
      ? merchants.find((m) => m.id === cpMatch.merchantId)
      : null;
    const catSuggest = suggestCategory({
      merchant: matchedMerchant,
      counterpartyName,
      userTransactions: [],
      categories,
    });

    let description = "บันทึกจากสลิป";
    if (txType === "transfer") {
      description = "โอนเงินระหว่างบัญชี";
    } else if (txType === "income") {
      description = counterpartyName ? `รับเงินจาก ${counterpartyName}` : "เงินโอนเข้า";
    } else {
      description = counterpartyName ? `ชำระให้ ${counterpartyName}` : "ชำระเงิน";
    }

    // Atomically create transaction and update slip status to 'created'
    const canonicalTxDate =
      bangkokDateTimeLocalToCanonicalInstant(ext.transactionDate) ||
      ext.transactionDate ||
      new Date().toISOString();

    const confirmRes = await DataStore.confirmSlipTransaction(user.id, {
      slipId: slip.id,
      type: txType,
      amount: ext.amount,
      currency: ext.currency || "THB",
      transaction_date: canonicalTxDate,
      description,
      note: null,
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      category_id: catSuggest.categoryId || null,
      merchant_id: cpMatch.merchantId || null,
      person_id: cpMatch.personId || null,
      reference_number: ext.reference || null,
      confidence: slip.overall_confidence || 1.0,
      review_status: "confirmed",
    });

    // Best-effort: Learn alias from verified selection after financial confirmation succeeds
    if (txType === "expense") {
      await safelyLearnAlias(user.id, fromAccountId, ext.sender?.bank, ext.sender?.accountMasked, "manual_confirm");
    } else if (txType === "income") {
      await safelyLearnAlias(user.id, toAccountId, ext.receiver?.bank, ext.receiver?.accountMasked, "manual_confirm");
    } else if (txType === "transfer") {
      await safelyLearnAlias(user.id, fromAccountId, ext.sender?.bank, ext.sender?.accountMasked, "manual_confirm");
      await safelyLearnAlias(user.id, toAccountId, ext.receiver?.bank, ext.receiver?.accountMasked, "manual_confirm");
    }

    revalidatePath("/review");
    revalidatePath("/today");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/overview");

    return { success: true, transactionId: confirmRes.transaction.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการยืนยันสลิป",
    };
  }
}

/**
 * Edits extracted slip values and confirms the transaction.
 * Records audit corrections in slip_corrections.
 */
export async function editAndConfirmSlipAction(
  slipId: string,
  data: TransactionFormData
): Promise<ReviewActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const slip = await DataStore.getSlipById(user.id, slipId);
    if (!slip) {
      return { success: false, error: "ไม่พบข้อมูลสลิปหรือคุณไม่มีสิทธิ์เข้าถึง" };
    }

    // Idempotency: if already confirmed or linked, return existing transaction
    if (slip.linked_transaction_id) {
      return { success: true, transactionId: slip.linked_transaction_id };
    }

    // Invariant checks for transaction type & accounts
    if (data.type === "expense" && !data.from_account_id) {
      return { success: false, error: "กรุณาระบุบัญชีต้นทางสำหรับรายจ่าย" };
    }
    if (data.type === "income" && !data.to_account_id) {
      return { success: false, error: "กรุณาระบุบัญชีปลายทางสำหรับรายรับ" };
    }
    if (data.type === "transfer") {
      if (!data.from_account_id || !data.to_account_id) {
        return {
          success: false,
          error: "การโอนเงินต้องระบุทั้งบัญชีต้นทางและปลายทาง",
        };
      }
      if (data.from_account_id === data.to_account_id) {
        return {
          success: false,
          error: "บัญชีต้นทางและปลายทางต้องไม่เป็นบัญชีเดียวกัน",
        };
      }
    }

    const ext = slip.extracted_json;

    const canonicalTxDate =
      bangkokDateTimeLocalToCanonicalInstant(data.transaction_date) ||
      data.transaction_date;

    // Track user corrections for audit and future intelligence
    if (ext) {
      if (ext.amount && Math.abs(ext.amount - Number(data.amount)) > 0.001) {
        await DataStore.createSlipCorrection(user.id, {
          slip_id: slip.id,
          field_name: "amount",
          extracted_value: ext.amount,
          corrected_value: Number(data.amount),
        });
      }
      if (ext.reference && ext.reference !== data.reference_number) {
        await DataStore.createSlipCorrection(user.id, {
          slip_id: slip.id,
          field_name: "reference",
          extracted_value: ext.reference,
          corrected_value: data.reference_number,
        });
      }
      if (canonicalTxDate && ext.transactionDate !== canonicalTxDate) {
        await DataStore.createSlipCorrection(user.id, {
          slip_id: slip.id,
          field_name: "transaction_date",
          extracted_value: ext.transactionDate,
          corrected_value: canonicalTxDate,
        });
      }
    }

    // Atomically create transaction and update slip status to 'created'
    const confirmRes = await DataStore.confirmSlipTransaction(user.id, {
      slipId: slip.id,
      type: data.type,
      amount: Number(data.amount),
      currency: data.currency || "THB",
      transaction_date: canonicalTxDate,
      description: data.description || null,
      note: data.note || null,
      from_account_id: data.type === "income" ? null : data.from_account_id || null,
      to_account_id: data.type === "expense" ? null : data.to_account_id || null,
      category_id: data.category_id || null,
      merchant_id: data.merchant_id || null,
      person_id: data.person_id || null,
      reference_number: data.reference_number || null,
      confidence: 1.0,
      review_status: "corrected",
    });

    // Best-effort: Learn alias from user-corrected account selection
    if (data.type === "expense" && data.from_account_id) {
      await safelyLearnAlias(user.id, data.from_account_id, ext?.sender?.bank, ext?.sender?.accountMasked, "manual_edit");
    } else if (data.type === "income" && data.to_account_id) {
      await safelyLearnAlias(user.id, data.to_account_id, ext?.receiver?.bank, ext?.receiver?.accountMasked, "manual_edit");
    } else if (data.type === "transfer") {
      if (data.from_account_id) {
        await safelyLearnAlias(user.id, data.from_account_id, ext?.sender?.bank, ext?.sender?.accountMasked, "manual_edit");
      }
      if (data.to_account_id) {
        await safelyLearnAlias(user.id, data.to_account_id, ext?.receiver?.bank, ext?.receiver?.accountMasked, "manual_edit");
      }
    }

    revalidatePath("/review");
    revalidatePath("/today");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/overview");

    return { success: true, transactionId: confirmRes.transaction.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการแก้ไขและยืนยันสลิป",
    };
  }
}

/**
 * Rejects a slip so it is dismissed without creating a transaction.
 */
export async function rejectSlipAction(
  slipId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const slip = await DataStore.getSlipById(user.id, slipId);
    if (!slip) {
      return { success: false, error: "ไม่พบข้อมูลสลิป" };
    }

    await DataStore.updateSlip(user.id, slip.id, {
      status: "rejected",
      processed_at: new Date().toISOString(),
    });

    revalidatePath("/review");
    revalidatePath("/today");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถปฏิเสธสลิปได้",
    };
  }
}

/**
 * Marks a slip as a duplicate and links to an existing slip if provided.
 */
export async function markSlipDuplicateAction(
  slipId: string,
  duplicateOfSlipId?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    await DataStore.updateSlip(user.id, slipId, {
      status: "duplicate",
      duplicate_of_slip_id: duplicateOfSlipId || null,
      processed_at: new Date().toISOString(),
    });

    revalidatePath("/review");
    revalidatePath("/today");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถระบุเป็นรายการซ้ำได้",
    };
  }
}

/**
 * Returns pending review count for notification badges.
 */
export async function getPendingReviewCountAction(): Promise<number> {
  const user = await getAuthenticatedUser();
  if (!user) return 0;
  const pending = await DataStore.getPendingReviewSlips(user.id);
  return pending.length;
}

/**
 * Generates an authorized signed preview URL for viewing a private slip image.
 */
export async function getSlipSignedPreviewUrlAction(
  slipId: string
): Promise<{
  success: boolean;
  url?: string;
  binaryStatus?: import("@/types/storage").SlipBinaryStatus;
  error?: string;
}> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const status = await privateStorage.detectSlipBinaryStatus(user.id, slipId);
    if (status === "missing") {
      return {
        success: false,
        binaryStatus: "missing",
        error: "ไม่พบไฟล์ต้นฉบับในพื้นที่จัดเก็บ",
      };
    }
    if (status === "pruned") {
      return {
        success: false,
        binaryStatus: "pruned",
        error: "ไฟล์ต้นฉบับถูกลบตามนโยบายการเก็บรักษาแล้ว",
      };
    }

    const { url } = await privateStorage.createSlipSignedViewUrl(user.id, slipId, 120);
    return { success: true, url, binaryStatus: "available" };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถสร้าง URL พรีวิวสลิปได้",
    };
  }
}

/**
 * Reprocesses an existing slip using current Vision parser and re-evaluates confidence.
 */
export async function reprocessSlipAction(
  slipId: string
): Promise<{ success: boolean; result?: SlipProcessingResult; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const slip = await DataStore.getSlipById(user.id, slipId);
    if (!slip) {
      return { success: false, error: "ไม่พบข้อมูลสลิป" };
    }

    const binary = await privateStorage.getSlipBinary(user.id, slipId);
    if (!binary || !binary.buffer) {
      return { success: false, error: "ไฟล์ต้นฉบับถูกลบแล้ว ไม่สามารถประมวลผลสลิปใหม่ได้" };
    }

    const result = await defaultSlipProcessor.reprocessSlip({
      userId: user.id,
      slipId: slip.id,
      buffer: binary.buffer,
    });

    revalidatePath("/review");
    revalidatePath("/today");
    revalidatePath("/transactions");
    revalidatePath("/overview");

    return {
      success: result.status !== "failed",
      result,
      error: result.status === "failed" ? result.errorMessage : undefined,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการประมวลผลสลิปใหม่",
    };
  }
}

