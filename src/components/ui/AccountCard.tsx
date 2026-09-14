import React from "react";
import Link from "next/link";
import { AccountBalance } from "@/types/finance";
import { MoneyAmount } from "./MoneyAmount";
import { Landmark, Wallet, CreditCard, Layers, TrendingUp, HelpCircle } from "lucide-react";

interface AccountCardProps {
  accountBalance: AccountBalance;
}

export function AccountCard({ accountBalance }: AccountCardProps) {
  const { account, current_balance, transaction_count } = accountBalance;

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "bank":
        return "ธนาคาร";
      case "cash":
        return "เงินสด";
      case "e_wallet":
        return "E-wallet";
      case "credit_card":
        return "บัตรเครดิต";
      case "investment":
        return "การลงทุน";
      default:
        return "อื่น ๆ";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "bank":
        return <Landmark className="w-4 h-4 text-slate-700" />;
      case "cash":
        return <Wallet className="w-4 h-4 text-slate-700" />;
      case "credit_card":
        return <CreditCard className="w-4 h-4 text-slate-700" />;
      case "e_wallet":
        return <Layers className="w-4 h-4 text-slate-700" />;
      case "investment":
        return <TrendingUp className="w-4 h-4 text-slate-700" />;
      default:
        return <HelpCircle className="w-4 h-4 text-slate-700" />;
    }
  };

  return (
    <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
              {getTypeIcon(account.type)}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-slate-900 truncate">
                {account.name}
              </h3>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                {account.institution || getTypeLabel(account.type)}
                {account.masked_number && ` · ••${account.masked_number.slice(-4)}`}
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
            {account.active ? "ใช้งาน" : "เก็บถาวร"}
          </span>
        </div>

        {/* Balance Display */}
        <div className="mt-5">
          <span className="block text-[11px] font-medium text-slate-400 mb-1">
            ยอดคงเหลือ
          </span>
          <MoneyAmount
            amount={current_balance}
            currency={account.currency}
            size="xl"
          />
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
        <Link
          href={`/transactions?accountId=${account.id}`}
          className="text-slate-500 hover:text-slate-900 font-medium"
        >
          {transaction_count} รายการ
        </Link>
      </div>
    </div>
  );
}
