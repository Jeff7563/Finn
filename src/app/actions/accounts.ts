"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { accountSchema } from "@/lib/validation/schemas";
import { bangkokDateTimeLocalToCanonicalInstant } from "@/lib/finance/formatters";
import { ActionResult } from "./auth";

export async function createAccountAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const balanceAsOfRaw = (formData.get("balance_as_of") as string)?.trim();
    const balanceAsOf = balanceAsOfRaw
      ? bangkokDateTimeLocalToCanonicalInstant(balanceAsOfRaw)
      : null;

    const rawData = {
      name: formData.get("name") as string,
      institution: (formData.get("institution") as string) || undefined,
      type: formData.get("type") as string,
      masked_number: (formData.get("masked_number") as string) || undefined,
      opening_balance: Number(formData.get("opening_balance") || 0),
      currency: (formData.get("currency") as string) || "THB",
      active: true,
      balance_as_of: balanceAsOf,
    };

    const parsed = accountSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.createAccount(user.id, parsed.data);

    revalidatePath("/accounts");
    revalidatePath("/today");
    revalidatePath("/overview");

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create account";
    return { success: false, error: message };
  }
}

export async function updateAccountAction(
  id: string,
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const balanceAsOfRaw = (formData.get("balance_as_of") as string)?.trim();
    const balanceAsOf = balanceAsOfRaw
      ? bangkokDateTimeLocalToCanonicalInstant(balanceAsOfRaw)
      : null;

    const rawData = {
      name: formData.get("name") as string,
      institution: (formData.get("institution") as string) || undefined,
      type: formData.get("type") as string,
      masked_number: (formData.get("masked_number") as string) || undefined,
      opening_balance: Number(formData.get("opening_balance") || 0),
      currency: (formData.get("currency") as string) || "THB",
      active: formData.get("active") !== "false",
      balance_as_of: balanceAsOf,
    };

    const parsed = accountSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.updateAccount(user.id, id, parsed.data);

    revalidatePath("/accounts");
    revalidatePath("/today");
    revalidatePath("/overview");

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update account";
    return { success: false, error: message };
  }
}

export async function archiveAccountAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await DataStore.archiveAccount(user.id, id);

    revalidatePath("/accounts");
    revalidatePath("/today");
    revalidatePath("/overview");

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to archive account";
    return { success: false, error: message };
  }
}
