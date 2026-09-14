import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { TransactionListClient } from "@/components/transactions/TransactionListClient";
import { PageHeader } from "@/components/ui/PageHeader";

interface TransactionsPageProps {
  searchParams: Promise<{
    accountId?: string;
  }>;
}

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const user = await requireUser();
  const params = await searchParams;

  const [transactions, accounts, categories, people, merchants] =
    await Promise.all([
      DataStore.getTransactions(user.id),
      DataStore.getAccounts(user.id),
      DataStore.getCategories(user.id),
      DataStore.getPeople(user.id),
      DataStore.getMerchants(user.id),
    ]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Transactions"
        description="Comprehensive central ledger of all financial entries."
        actionHref="/transactions/new"
        actionLabel="New Transaction"
      />

      <TransactionListClient
        initialTransactions={transactions}
        accounts={accounts}
        categories={categories}
        people={people}
        merchants={merchants}
        initialAccountId={params.accountId}
      />
    </div>
  );
}
