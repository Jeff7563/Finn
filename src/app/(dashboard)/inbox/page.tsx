import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { UnifiedInboxClient } from "@/components/inbox/UnifiedInboxClient";
import { calculateAllAccountBalances } from "@/lib/finance/balances";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const user = await requireUser();

  const [items, sourceDocuments, accounts, categories, existingTransactions, slips] =
    await Promise.all([
      DataStore.getIngestionItems(user.id),
      DataStore.getSourceDocuments(user.id),
      DataStore.getAccounts(user.id),
      DataStore.getCategories(user.id),
      DataStore.getTransactions(user.id),
      DataStore.getSlips(user.id),
    ]);

  // Compute canonical current balances server-side using the same logic as Accounts page
  const accountBalances = calculateAllAccountBalances(accounts, existingTransactions);
  const accountBalanceMap: Record<string, number> = {};
  for (const ab of accountBalances) {
    accountBalanceMap[ab.account.id] = ab.current_balance;
  }

  // Compute legacy slip storage metrics for combined storage summary
  const activeSlips = slips.filter((s) => !s.deleted_at && s.status !== "duplicate");
  const legacySlipBytes = activeSlips.reduce((sum, s) => sum + (s.file_size || 0), 0);
  const legacySlipCount = activeSlips.length;

  return (
    <UnifiedInboxClient
      userId={user.id}
      items={items}
      sourceDocuments={sourceDocuments}
      accounts={accounts}
      categories={categories}
      existingTransactions={existingTransactions}
      accountBalanceMap={accountBalanceMap}
      legacySlipStorageBytes={legacySlipBytes}
      legacySlipStorageCount={legacySlipCount}
    />
  );
}
