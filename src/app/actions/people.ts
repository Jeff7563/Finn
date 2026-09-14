"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { personSchema } from "@/lib/validation/schemas";
import { ActionResult } from "./auth";

export async function createPersonAction(
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
      aliases,
      phone: (formData.get("phone") as string) || undefined,
      note: (formData.get("note") as string) || undefined,
    };

    const parsed = personSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.createPerson(user.id, parsed.data);

    revalidatePath("/people");
    revalidatePath("/transactions/new");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create person";
    return { success: false, error: message };
  }
}

export async function updatePersonAction(
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
      aliases,
      phone: (formData.get("phone") as string) || undefined,
      note: (formData.get("note") as string) || undefined,
    };

    const parsed = personSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Validation error",
      };
    }

    await DataStore.updatePerson(user.id, id, parsed.data);

    revalidatePath(`/people/${id}`);
    revalidatePath("/people");

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update person";
    return { success: false, error: message };
  }
}
