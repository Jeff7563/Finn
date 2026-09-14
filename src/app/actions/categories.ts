"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { categorySchema } from "@/lib/validation/schemas";
import { ActionResult } from "./auth";

export async function createCategoryAction(
  prevState: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const rawData = {
      name: formData.get("name") as string,
      type: formData.get("type") as "income" | "expense",
      icon: (formData.get("icon") as string) || undefined,
      color: (formData.get("color") as string) || undefined,
    };

    const parsed = categorySchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.createCategory(user.id, parsed.data);

    revalidatePath("/categories");
    revalidatePath("/transactions/new");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create category";
    return { success: false, error: message };
  }
}
