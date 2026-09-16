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
