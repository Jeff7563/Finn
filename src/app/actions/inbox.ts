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

    if (item.status === "linked") {
      return { success: false, error: "Ingestion item is already linked to a transaction" };
    }

    const parsed = item.parsed_data;
    if (!parsed) {
      return { success: false, error: "Ingestion item has no parsed financial data" };
    }

    // 1. Validate amount strictly: must be > 0 (FAIL CLOSED)
    const amountSatang = parsed.amount;
    const amountThb =
      parsed.amount_decimal !== undefined && parsed.amount_decimal !== null
        ? parsed.amount_decimal
        : amountSatang !== undefined && amountSatang !== null
        ? amountSatang / 100
        : null;

    if (amountThb === null || isNaN(amountThb) || amountThb <= 0) {
      return {
        success: false,
        error: "Missing or invalid amount: transaction amount must be greater than zero",
      };
    }

    // 2. Validate occurred_at strictly: must be present and valid timestamp (FAIL CLOSED)
    if (!parsed.occurred_at) {
      return {
        success: false,
        error: "Missing transaction date: cannot create transaction without a valid date/time",
      };
    }
    const dateTimestamp = new Date(parsed.occurred_at).getTime();
    if (isNaN(dateTimestamp)) {
      return {
        success: false,
        error: `Invalid transaction date timestamp: "${parsed.occurred_at}"`,
      };
    }

    // 3. Validate direction / type strictly (FAIL CLOSED)
    const txType: TransactionType | undefined =
      (parsed.transaction_type as TransactionType) ||
      (parsed.direction === "incoming" ? "income" : parsed.direction === "outgoing" ? "expense" : undefined);

    if (!txType) {
      return {
        success: false,
        error: "Missing transaction direction or type (cannot determine income vs expense)",
      };
    }

    // 4. Validate account pointer strictly (FAIL CLOSED)
    if (!overrides.accountId) {
      return {
        success: false,
        error: "Account selection is required to create a transaction",
      };
    }

    const account = await DataStore.getAccountById(user.id, overrides.accountId);
    if (!account) {
      return {
        success: false,
        error: "Selected account not found or does not belong to user",
      };
    }

    const txData = {
      type: txType,
      amount: amountThb,
      currency: parsed.currency || "THB",
      transaction_date: parsed.occurred_at,
      description: overrides.description || parsed.description || parsed.merchant_name || "Imported transaction",
      note: overrides.note || parsed.note || null,
      from_account_id: txType === "expense" ? overrides.accountId : null,
      to_account_id: txType === "income" ? overrides.accountId : null,
      category_id: overrides.categoryId || null,
      source: "import" as const,
      reference_number: parsed.reference_number || null,
      confidence: 1.0,
      review_status: "confirmed" as const,
      tax_deductible: false,
    };

    // ATOMIC operation: creates transaction, creates evidence, updates item to linked
    const result = await DataStore.createTransactionFromIngestionItem(user.id, item.id, txData);

    revalidatePath("/inbox");
    revalidatePath("/transactions");
    return { success: true, transaction: result.transaction, evidence: result.evidence };
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
 * Rejects an ingestion item with an error reason, preserving raw data.
 */
export async function rejectIngestionItemAction(
  itemId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  try {
    const item = await DataStore.getIngestionItemById(user.id, itemId);
    if (!item) {
      return { success: false, error: "Ingestion item not found" };
    }

    const rejectionReason = reason || "User rejected item";
    const existingParsed = item.parsed_data || {
      amount: null,
    };

    // Preserve raw_data completely! Store rejection reason in parsed_data.rejection_reason
    await DataStore.updateIngestionItem(user.id, itemId, {
      status: "error",
      parsed_data: {
        ...existingParsed,
        rejection_reason: rejectionReason,
      },
    });

    revalidatePath("/inbox");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reject item";
    return { success: false, error: message };
  }
}
