import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculateAllAccountBalances } from "@/lib/finance/balances";
import { AccountsClient } from "@/components/accounts/AccountsClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AccountsPage() {
  const user = await requireUser();

  const [accounts, transactions] = await Promise.all([
    DataStore.getAccounts(user.id),
    DataStore.getTransactions(user.id),
  ]);

  const accountBalances = calculateAllAccountBalances(accounts, transactions);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Accounts"
        description="Bank accounts, cash reserves, cards, and investments."
      />

      <AccountsClient initialAccountBalances={accountBalances} />
    </div>
  );
}
