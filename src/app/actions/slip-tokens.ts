"use server";

import { getAuthenticatedUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { IngestToken } from "@/types/slip";
import { revalidatePath } from "next/cache";

export interface CreateTokenResult {
  success: boolean;
  rawToken?: string;
  token?: IngestToken;
  error?: string;
}

/**
 * Creates a new scoped ingest token for iOS Shortcut or automated ingestion.
 * Shows the raw token ONCE to the user.
 */
export async function createIngestTokenAction(
  label: string = "iPhone 11 Pro Max"
): Promise<CreateTokenResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    const cleanLabel = (label || "iPhone 11 Pro Max").trim().slice(0, 50);
    const { rawToken, record } = await DataStore.createIngestToken(user.id, {
      label: cleanLabel,
      scope: "slip:ingest",
    });

    revalidatePath("/settings");
    revalidatePath("/settings/automation/ios");

    return {
      success: true,
      rawToken,
      token: record,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถสร้าง Token ได้",
    };
  }
}

/**
 * Revokes an existing ingest token immediately.
 */
export async function revokeIngestTokenAction(
  tokenId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" };
  }

  try {
    await DataStore.revokeIngestToken(user.id, tokenId);
    revalidatePath("/settings");
    revalidatePath("/settings/automation/ios");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ไม่สามารถยกเลิก Token ได้",
    };
  }
}

/**
 * Lists user's ingest tokens.
 */
export async function getIngestTokensAction(): Promise<IngestToken[]> {
  const user = await getAuthenticatedUser();
  if (!user) return [];
  return DataStore.getIngestTokens(user.id);
}
