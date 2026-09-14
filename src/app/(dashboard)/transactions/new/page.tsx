import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { TransactionType } from "@/types/finance";

interface NewTransactionPageProps {
  searchParams: Promise<{
    type?: string;
  }>;
}

export default async function NewTransactionPage({
  searchParams,
}: NewTransactionPageProps) {
  const user = await requireUser();
  const params = await searchParams;

  const defaultType = (params.type || "expense") as TransactionType;

  const [accounts, categories, people, merchants] = await Promise.all([
    DataStore.getAccounts(user.id),
    DataStore.getCategories(user.id),
    DataStore.getPeople(user.id),
    DataStore.getMerchants(user.id),
  ]);

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <PageHeader
        title="Record Transaction"
        description="Add manual income, expense, or transfer entry."
      />

      <TransactionForm
        accounts={accounts}
        categories={categories}
        people={people}
        merchants={merchants}
        defaultType={defaultType}
      />
    </div>
  );
}
