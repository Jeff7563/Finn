import React from "react";
import Link from "next/link";
import { AccountBalance } from "@/types/finance";
import { MoneyAmount } from "./MoneyAmount";
import { Building2, CreditCard, Landmark, Wallet, Layers } from "lucide-react";

interface AccountCardProps {
  accountBalance: AccountBalance;
}

export function AccountCard({ accountBalance }: AccountCardProps) {
  const { account, current_balance, transaction_count } = accountBalance;

  const getAccountIcon = (type: string) => {
    switch (type) {
      case "bank":
        return <Landmark className="w-4 h-4 text-slate-700" />;
      case "credit_card":
        return <CreditCard className="w-4 h-4 text-slate-700" />;
      case "cash":
        return <Wallet className="w-4 h-4 text-slate-700" />;
      case "e_wallet":
        return <Layers className="w-4 h-4 text-slate-700" />;
      default:
        return <Building2 className="w-4 h-4 text-slate-700" />;
    }
  };

  return (
    <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-sm hover:border-slate-300 transition-all">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            {getAccountIcon(account.type)}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-slate-900 truncate">
              {account.name}
            </h3>
            <p className="text-xs text-slate-500 truncate">
              {account.institution || account.type}
              {account.masked_number && ` ••${account.masked_number.slice(-4)}`}
            </p>
          </div>
        </div>

        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
            account.active
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {account.active ? "Active" : "Archived"}
        </span>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex items-end justify-between">
        <div>
          <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Balance
          </span>
          <MoneyAmount
            amount={current_balance}
            currency={account.currency}
            size="lg"
          />
        </div>

        <Link
          href={`/transactions?accountId=${account.id}`}
          className="text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 rounded-md transition-colors"
        >
          {transaction_count} {transaction_count === 1 ? "entry" : "entries"}
        </Link>
      </div>
    </div>
  );
}
