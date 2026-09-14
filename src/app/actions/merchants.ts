"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { merchantSchema } from "@/lib/validation/schemas";
import { ActionResult } from "./auth";

export async function createMerchantAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const aliasesRaw = (formData.get("aliases") as string) || "";
    const aliases = aliasesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const rawData = {
      display_name: formData.get("display_name") as string,
      category_hint: (formData.get("category_hint") as string) || undefined,
      aliases,
    };

    const parsed = merchantSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.createMerchant(user.id, parsed.data);

    revalidatePath("/merchants");
    revalidatePath("/transactions/new");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create merchant";
    return { success: false, error: message };
  }
}

export async function updateMerchantAction(
  id: string,
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const aliasesRaw = (formData.get("aliases") as string) || "";
    const aliases = aliasesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const rawData = {
      display_name: formData.get("display_name") as string,
      category_hint: (formData.get("category_hint") as string) || undefined,
      aliases,
    };

    const parsed = merchantSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.updateMerchant(user.id, id, parsed.data);

    revalidatePath(`/merchants/${id}`);
    revalidatePath("/merchants");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update merchant";
    return { success: false, error: message };
  }
}
