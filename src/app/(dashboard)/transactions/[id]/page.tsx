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

  const [accounts, categories, people, merchants, voidEvents, replacementEvents] = await Promise.all([
    DataStore.getAccounts(user.id),
    DataStore.getCategories(user.id),
    DataStore.getPeople(user.id),
    DataStore.getMerchants(user.id),
    DataStore.getTransactionVoidEvents(user.id, id),
    DataStore.getTransactionReplacementEvents(user.id, id),
  ]);

  const rawTransaction = await DataStore.getTransactionById(user.id, id, {
    accounts,
    categories,
    people,
    merchants,
  });

  if (!rawTransaction) {
    notFound();
  }

  const transaction = {
    ...rawTransaction,
    replacement_event: replacementEvents.replaces || null,
    replaced_by_event: replacementEvents.replacedBy || null,
  };

  let slip = null;
  const slipId = transaction.source_slip_id || replacementEvents.replacedBy?.slip_id || replacementEvents.replaces?.slip_id;
  if (slipId) {
    slip = await DataStore.getSlipById(user.id, slipId);
  }

  const hasVoidHistory = voidEvents.length > 0;

  return (
    <TransactionDetailClient
      transaction={transaction}
      slip={slip}
      accounts={accounts}
      categories={categories}
      people={people}
      merchants={merchants}
      hasVoidHistory={hasVoidHistory}
    />
  );
}
