"use server";

import { getAuthenticatedUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { TransactionFormData } from "@/lib/validation/schemas";
import { defaultSlipProcessor } from "@/lib/slip/processor";
import { SlipProcessingResult } from "@/types/slip";
import { revalidatePath } from "next/cache";

export interface ReviewActionResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

/**
 * Confirms a pending slip directly as a transaction without edits.
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

    if (slip.status !== "needs_review") {
      return { success: false, error: `สถานะของสลิปไม่อยู่ในขั้นตอนรอตรวจสอบ (${slip.status})` };
    }

    const ext = slip.extracted_json;
    if (!ext || !ext.amount || ext.amount <= 0) {
      return { success: false, error: "สลิปนี้ไม่มีจำนวนเงินที่ถูกต้อง กรุณาแก้ไขก่อนยืนยัน" };
    }

    // Match accounts if not yet set
    const accounts = await DataStore.getAccounts(user.id);
    let fromAccountId: string | null = null;
    let toAccountId: string | null = null;
    let txType: "income" | "expense" | "transfer" = "expense";

    // If incoming was detected, confirm as income
    if (ext.receiver?.bank && !ext.sender?.bank) {
      txType = "income";
      const toAcc = accounts.find((a) => a.active);
      toAccountId = toAcc?.id || null;
    } else {
      const fromAcc = accounts.find((a) => a.active);
      fromAccountId = fromAcc?.id || null;
    }

    const newTx = await DataStore.createTransaction(user.id, {
      type: txType,
      amount: ext.amount,
      currency: ext.currency || "THB",
      transaction_date: ext.transactionDate || new Date().toISOString(),
      description: ext.receiver?.name
        ? `ชำระให้ ${ext.receiver.name}`
        : (ext.sender?.name ? `รับเงินจาก ${ext.sender.name}` : "บันทึกจากสลิป"),
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      source: "slip",
      reference_number: ext.reference || null,
      confidence: slip.overall_confidence || 1.0,
      review_status: "confirmed",
    });

    // Link slip
    await DataStore.updateSlip(user.id, slip.id, {
      status: "created",
      linked_transaction_id: newTx.id,
      processed_at: new Date().toISOString(),
    });

    revalidatePath("/review");
    revalidatePath("/today");
    revalidatePath("/transactions");
    revalidatePath("/overview");

    return { success: true, transactionId: newTx.id };
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

    const ext = slip.extracted_json;

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
    }

    const newTx = await DataStore.createTransaction(user.id, {
      ...data,
      source: "slip",
      confidence: 1.0,
      review_status: "corrected",
    });

    await DataStore.updateSlip(user.id, slip.id, {
      status: "created",
      linked_transaction_id: newTx.id,
      processed_at: new Date().toISOString(),
    });

    revalidatePath("/review");
    revalidatePath("/today");
    revalidatePath("/transactions");
    revalidatePath("/overview");

    return { success: true, transactionId: newTx.id };
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
): Promise<{ success: boolean; url?: string; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const url = await DataStore.createSignedSlipUrl(user.id, slipId, 900);
    return { success: true, url };
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

    const buffer = await DataStore.getSlipFile(slip.storage_path);
    if (!buffer) {
      return { success: false, error: "ไม่พบไฟล์สลิปในที่จัดเก็บข้อมูลส่วนตัว" };
    }

    const result = await defaultSlipProcessor.reprocessSlip({
      userId: user.id,
      slipId: slip.id,
      buffer,
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

