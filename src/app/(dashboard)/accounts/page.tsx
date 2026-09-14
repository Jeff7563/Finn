import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculateAllAccountBalances } from "@/lib/finance/balances";
import { AccountsClient } from "@/components/accounts/AccountsClient";

export default async function AccountsPage() {
  const user = await requireUser();

  const [accounts, transactions] = await Promise.all([
    DataStore.getAccounts(user.id),
    DataStore.getTransactions(user.id),
  ]);

  const accountBalances = calculateAllAccountBalances(accounts, transactions);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-6">
      <div className="border-b border-slate-100 pb-3">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
          บัญชี <span className="text-sm font-normal text-slate-400">· Accounts</span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          บัญชีธนาคาร เงินสด กระเป๋าเงินอิเล็กทรอนิกส์ และบัตร
        </p>
      </div>

      <AccountsClient initialAccountBalances={accountBalances} />
    </div>
  );
}
