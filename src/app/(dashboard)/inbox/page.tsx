import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { UnifiedInboxClient } from "@/components/inbox/UnifiedInboxClient";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const user = await requireUser();

  const [items, sourceDocuments, accounts, categories, existingTransactions] =
    await Promise.all([
      DataStore.getIngestionItems(user.id),
      DataStore.getSourceDocuments(user.id),
      DataStore.getAccounts(user.id),
      DataStore.getCategories(user.id),
      DataStore.getTransactions(user.id),
    ]);

  return (
    <UnifiedInboxClient
      userId={user.id}
      items={items}
      sourceDocuments={sourceDocuments}
      accounts={accounts}
      categories={categories}
      existingTransactions={existingTransactions}
    />
  );
}
