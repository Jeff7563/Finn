import React from "react";
import Link from "next/link";
import { TransactionWithRelations } from "@/types/finance";
import { MoneyAmount } from "./MoneyAmount";
import { formatDate } from "@/lib/finance/formatters";
import { ArrowRight, Tag, Wallet } from "lucide-react";

interface TransactionItemProps {
  transaction: TransactionWithRelations;
}

export function TransactionItem({ transaction }: TransactionItemProps) {
  // Determine title
  let title = transaction.description || "Untitled Transaction";
  if (transaction.type === "transfer") {
    const fromName = transaction.from_account?.name || "Account";
    const toName = transaction.to_account?.name || "Account";
    title = `${fromName} → ${toName}`;
  } else if (transaction.merchant?.display_name) {
    title = transaction.merchant.display_name;
  } else if (transaction.person?.display_name) {
    title = transaction.person.display_name;
  } else if (transaction.category?.name) {
    title = transaction.category.name;
  }

  const accountLabel =
    transaction.type === "transfer"
      ? null
      : transaction.type === "income"
      ? transaction.to_account?.name
      : transaction.from_account?.name;

  return (
    <Link
      href={`/transactions/${transaction.id}`}
      className="group flex items-center justify-between p-3.5 sm:p-4 bg-white hover:bg-slate-50 border-b border-slate-100 last:border-b-0 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0 pr-3">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm sm:text-base text-slate-900 truncate">
              {title}
            </span>
          </div>

          <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 text-xs text-slate-500 mt-0.5">
            <span>{formatDate(transaction.transaction_date)}</span>

            {accountLabel && (
              <span className="inline-flex items-center gap-1 text-slate-600">
                <span className="text-slate-300">•</span>
                <Wallet className="w-3 h-3 text-slate-400" />
                {accountLabel}
              </span>
            )}

            {transaction.category && (
              <span className="inline-flex items-center gap-1 text-slate-600">
                <span className="text-slate-300">•</span>
                <Tag className="w-3 h-3 text-slate-400" />
                {transaction.category.name}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <MoneyAmount
          amount={transaction.amount}
          type={transaction.type}
          currency={transaction.currency}
          size="md"
        />
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors hidden sm:block" />
      </div>
    </Link>
  );
}
