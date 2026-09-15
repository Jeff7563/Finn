import React from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { TransactionDetailClient } from "@/components/transactions/TransactionDetailClient";

interface TransactionPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function TransactionPage({
  params,
}: TransactionPageProps) {
  const user = await requireUser();
  const { id } = await params;

  const [accounts, categories, people, merchants] = await Promise.all([
    DataStore.getAccounts(user.id),
    DataStore.getCategories(user.id),
    DataStore.getPeople(user.id),
    DataStore.getMerchants(user.id),
  ]);

  const transaction = await DataStore.getTransactionById(user.id, id, {
    accounts,
    categories,
    people,
    merchants,
  });

  if (!transaction) {
    notFound();
  }

  return (
    <TransactionDetailClient
      transaction={transaction}
      accounts={accounts}
      categories={categories}
      people={people}
      merchants={merchants}
    />
  );
}
