"use server";

import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { TransactionEvidence } from "@/types/multi-source";
import { Transaction, TransactionType } from "@/types/finance";
import { revalidatePath } from "next/cache";

export interface LinkItemResult {
  success: boolean;
  evidence?: TransactionEvidence;
  error?: string;
}

export interface CreateFromItemResult {
  success: boolean;
  transaction?: Transaction;
  evidence?: TransactionEvidence;
  error?: string;
}

/**
 * Links an ingestion item to an existing transaction as evidence.
 */
export async function linkIngestionItemAction(
  itemId: string,
  transactionId: string
): Promise<LinkItemResult> {
  const user = await requireUser();

  try {
    const item = await DataStore.getIngestionItemById(user.id, itemId);
    if (!item) {
      return { success: false, error: "Ingestion item not found" };
    }

    const tx = await DataStore.getTransactionById(user.id, transactionId);
    if (!tx) {
      return { success: false, error: "Target transaction not found" };
    }

    // Create evidence link (enforces Decision 1 constraint & cross-user integrity)
    const evidence = await DataStore.createTransactionEvidence(user.id, {
      transaction_id: tx.id,
      ingestion_item_id: item.id,
      evidence_type: item.item_type === "email_notification" ? "email_notification" : "statement_row",
    });

    // Update item status
    await DataStore.updateIngestionItem(user.id, item.id, {
      status: "linked",
      matched_transaction_id: tx.id,
    });

    revalidatePath("/inbox");
    revalidatePath("/transactions");
    return { success: true, evidence };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to link item";
    return { success: false, error: message };
  }
}

/**
 * Creates a new transaction from an ingestion item and records the evidence bridge.
 */
export async function createTransactionFromItemAction(
  itemId: string,
  overrides: {
    accountId: string;
    categoryId?: string | null;
    description?: string | null;
    note?: string | null;
  }
): Promise<CreateFromItemResult> {
  const user = await requireUser();

  try {
    const item = await DataStore.getIngestionItemById(user.id, itemId);
    if (!item) {
      return { success: false, error: "Ingestion item not found" };
    }

    const parsed = item.parsed_data;
    const amountSatang = parsed?.amount || 0;
    const amountThb = parsed?.amount_decimal || amountSatang / 100;
    const txType: TransactionType =
      (parsed?.transaction_type as TransactionType) ||
      (parsed?.direction === "incoming" ? "income" : "expense");

    const txData = {
      type: txType,
      amount: amountThb,
      currency: parsed?.currency || "THB",
      transaction_date: parsed?.occurred_at || new Date().toISOString(),
      description: overrides.description || parsed?.description || parsed?.merchant_name || "Imported transaction",
      note: overrides.note || parsed?.note || null,
      from_account_id: txType === "expense" ? overrides.accountId : null,
      to_account_id: txType === "income" ? overrides.accountId : null,
      category_id: overrides.categoryId || null,
      source: "import" as const,
      reference_number: parsed?.reference_number || null,
      confidence: 1.0,
      review_status: "confirmed" as const,
    };

    const newTx = await DataStore.createTransaction(user.id, txData);

    // Create evidence bridge
    const evidence = await DataStore.createTransactionEvidence(user.id, {
      transaction_id: newTx.id,
      ingestion_item_id: item.id,
      evidence_type: item.item_type === "email_notification" ? "email_notification" : "statement_row",
    });

    // Update item status
    await DataStore.updateIngestionItem(user.id, item.id, {
      status: "linked",
      matched_transaction_id: newTx.id,
    });

    revalidatePath("/inbox");
    revalidatePath("/transactions");
    return { success: true, transaction: newTx, evidence };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create transaction from item";
    return { success: false, error: message };
  }
}

/**
 * Dismisses an ingestion item without linking.
 */
export async function dismissIngestionItemAction(itemId: string): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  try {
    await DataStore.updateIngestionItem(user.id, itemId, {
      status: "dismissed",
    });
    revalidatePath("/inbox");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to dismiss item";
    return { success: false, error: message };
  }
}

/**
 * Rejects an ingestion item with an error reason.
 */
export async function rejectIngestionItemAction(
  itemId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  try {
    await DataStore.updateIngestionItem(user.id, itemId, {
      status: "error",
      raw_data: { rejectionReason: reason || "User rejected item" },
    });
    revalidatePath("/inbox");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reject item";
    return { success: false, error: message };
  }
}
