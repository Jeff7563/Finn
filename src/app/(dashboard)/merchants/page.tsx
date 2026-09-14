import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculateAllMerchantSummaries } from "@/lib/finance/merchants";
import { MerchantsClient } from "@/components/merchants/MerchantsClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function MerchantsPage() {
  const user = await requireUser();

  const [merchants, transactions, categories] = await Promise.all([
    DataStore.getMerchants(user.id),
    DataStore.getTransactions(user.id),
    DataStore.getCategories(user.id),
  ]);

  const summaries = calculateAllMerchantSummaries(
    merchants,
    transactions,
    categories
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Merchants"
        description="Stores, supermarkets, service providers, and vendors."
      />

      <MerchantsClient initialSummaries={summaries} />
    </div>
  );
}
