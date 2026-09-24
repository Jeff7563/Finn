"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { transactionSchema } from "@/lib/validation/schemas";
import { bangkokDateTimeLocalToCanonicalInstant } from "@/lib/finance/formatters";
import { ActionResult } from "./auth";

export async function createTransactionAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const rawType = formData.get("type") as string;
    const rawDateInput = formData.get("transaction_date") as string;
    const normalizedDate =
      bangkokDateTimeLocalToCanonicalInstant(rawDateInput) ||
      new Date().toISOString();

    const rawData = {
      type: rawType,
      amount: Number(formData.get("amount")),
      currency: (formData.get("currency") as string) || "THB",
      transaction_date: normalizedDate,
      description: (formData.get("description") as string) || null,
      note: (formData.get("note") as string) || null,
      from_account_id: (formData.get("from_account_id") as string) || null,
      to_account_id: (formData.get("to_account_id") as string) || null,
      person_id: (formData.get("person_id") as string) || null,
      merchant_id: (formData.get("merchant_id") as string) || null,
      category_id: (formData.get("category_id") as string) || null,
      payment_method: (formData.get("payment_method") as string) || null,
      reference_number: (formData.get("reference_number") as string) || null,
      source: "manual" as const,
      tax_deductible: formData.get("tax_deductible") === "true",
      tax_income_type: (formData.get("tax_income_type") as string) || null,
    };

    const parsed = transactionSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.createTransaction(user.id, parsed.data);

    revalidatePath("/transactions");
    revalidatePath("/today");
    revalidatePath("/overview");
    revalidatePath("/accounts");
    revalidatePath("/people");
    revalidatePath("/merchants");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to record transaction";
    return { success: false, error: message };
  }
}

export async function updateTransactionAction(
  id: string,
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const rawDateInput = formData.get("transaction_date") as string;
    const normalizedDate =
      bangkokDateTimeLocalToCanonicalInstant(rawDateInput) ||
      new Date().toISOString();

    const rawData = {
      type: formData.get("type") as string,
      amount: Number(formData.get("amount")),
      currency: (formData.get("currency") as string) || "THB",
      transaction_date: normalizedDate,
      description: (formData.get("description") as string) || null,
      note: (formData.get("note") as string) || null,
      from_account_id: (formData.get("from_account_id") as string) || null,
      to_account_id: (formData.get("to_account_id") as string) || null,
      person_id: (formData.get("person_id") as string) || null,
      merchant_id: (formData.get("merchant_id") as string) || null,
      category_id: (formData.get("category_id") as string) || null,
      payment_method: (formData.get("payment_method") as string) || null,
      reference_number: (formData.get("reference_number") as string) || null,
      tax_deductible: formData.get("tax_deductible") === "true",
      tax_income_type: (formData.get("tax_income_type") as string) || null,
    };

    const parsed = transactionSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.updateTransaction(user.id, id, parsed.data);

    revalidatePath(`/transactions/${id}`);
    revalidatePath("/transactions");
    revalidatePath("/today");
    revalidatePath("/overview");
    revalidatePath("/accounts");
    revalidatePath("/people");
    revalidatePath("/merchants");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update transaction";
    return { success: false, error: message };
  }
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();

    // 1. Fetch transaction
    const tx = await DataStore.getTransactionById(user.id, id);
    if (!tx) {
      return { success: false, error: "ไม่พบรายการที่ต้องการลบ" };
    }

    // 2. Check for evidence (poly-source evidence bridge or legacy slip/document)
    const isEvidenceBacked =
      tx.source !== "manual" ||
      Boolean(tx.source_slip_id) ||
      Boolean(tx.source_document_id);

    let hasEvidence = isEvidenceBacked;
    if (!hasEvidence) {
      const evidenceList = await DataStore.getTransactionEvidence(user.id, id);
      hasEvidence = evidenceList.length > 0;
    }

    // 3. Check for void/restore audit history
    const voidEvents = await DataStore.getTransactionVoidEvents(user.id, id);
    const hasVoidHistory = voidEvents.length > 0;

    if (hasEvidence || hasVoidHistory) {
      return {
        success: false,
        error:
          "รายการนี้มีหลักฐานหรือประวัติการยกเลิก จึงไม่สามารถลบถาวรได้ กรุณาใช้ยกเลิกรายการ (Void) แทน",
      };
    }

    await DataStore.deleteTransaction(user.id, id);

    revalidatePath("/transactions");
    revalidatePath("/today");
    revalidatePath("/overview");
    revalidatePath("/accounts");
    revalidatePath("/people");
    revalidatePath("/merchants");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to delete transaction";
    return { success: false, error: message };
  }
}

export async function voidTransactionAction(
  id: string,
  reason: string
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const trimmedReason = (reason || "").trim();
    if (!trimmedReason) {
      return {
        success: false,
        error: "กรุณาระบุเหตุผลในการยกเลิกรายการ (Void reason is required)",
      };
    }
    if (trimmedReason.length > 500) {
      return {
        success: false,
        error: "เหตุผลต้องมีความยาวไม่เกิน 500 ตัวอักษร",
      };
    }

    await DataStore.voidTransaction(user.id, id, trimmedReason);

    revalidatePath(`/transactions/${id}`);
    revalidatePath("/transactions");
    revalidatePath("/today");
    revalidatePath("/overview");
    revalidatePath("/accounts");
    revalidatePath("/people");
    revalidatePath("/merchants");
    revalidatePath("/inbox");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to void transaction";
    return { success: false, error: message };
  }
}

export async function restoreTransactionAction(
  id: string,
  reason?: string
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const trimmedReason = reason?.trim();
    if (trimmedReason && trimmedReason.length > 500) {
      return {
        success: false,
        error: "เหตุผลต้องมีความยาวไม่เกิน 500 ตัวอักษร",
      };
    }

    await DataStore.restoreTransaction(user.id, id, trimmedReason);

    revalidatePath(`/transactions/${id}`);
    revalidatePath("/transactions");
    revalidatePath("/today");
    revalidatePath("/overview");
    revalidatePath("/accounts");
    revalidatePath("/people");
    revalidatePath("/merchants");
    revalidatePath("/inbox");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to restore transaction";
    return { success: false, error: message };
  }
}

export async function getTransactionVoidEventsAction(
  id: string
): Promise<{ success: boolean; events?: import("@/types/finance").TransactionVoidEvent[]; error?: string }> {
  try {
    const user = await requireUser();
    const events = await DataStore.getTransactionVoidEvents(user.id, id);
    return { success: true, events };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch void events";
    return { success: false, error: message };
  }
}

export interface ReplaceTransactionActionResult {
  success: boolean;
  newTransactionId?: string;
  error?: string;
}

export async function replaceVoidedSlipTransactionAction(
  input: import("@/types/finance").ReplaceVoidedSlipTransactionInput
): Promise<ReplaceTransactionActionResult> {
  try {
    const user = await requireUser();
    const res = await DataStore.replaceVoidedSlipTransaction(user.id, input);

    revalidatePath(`/transactions/${input.old_transaction_id}`);
    revalidatePath(`/transactions/${res.transaction.id}`);
    revalidatePath("/transactions");
    revalidatePath("/today");
    revalidatePath("/overview");
    revalidatePath("/accounts");
    revalidatePath("/people");
    revalidatePath("/merchants");
    revalidatePath("/inbox");
    revalidatePath("/review");

    return {
      success: true,
      newTransactionId: res.transaction.id,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to replace voided transaction";
    return { success: false, error: message };
  }
}

export async function getTransactionReplacementEventsAction(
  id: string
): Promise<{
  success: boolean;
  replacedBy?: import("@/types/finance").TransactionReplacementEvent | null;
  replaces?: import("@/types/finance").TransactionReplacementEvent | null;
  error?: string;
}> {
  try {
    const user = await requireUser();
    const result = await DataStore.getTransactionReplacementEvents(user.id, id);
    return { success: true, ...result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch replacement events";
    return { success: false, error: message };
  }
}

