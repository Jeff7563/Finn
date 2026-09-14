import React from "react";
import Link from "next/link";
import { MerchantSummary } from "@/types/finance";
import { MoneyAmount } from "./MoneyAmount";
import { Store, ChevronRight, Tag } from "lucide-react";

interface MerchantRowProps {
  summary: MerchantSummary;
}

export function MerchantRow({ summary }: MerchantRowProps) {
  const { merchant, total_spent, transaction_count, average_transaction, top_category_name } =
    summary;

  return (
    <Link
      href={`/merchants/${merchant.id}`}
      className="flex items-center justify-between p-4 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-xl transition-all shadow-sm"
    >
      <div className="flex items-center gap-3 min-w-0 pr-4">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 flex-shrink-0">
          <Store className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm sm:text-base text-slate-900 truncate">
            {merchant.display_name}
          </h3>
          <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500 mt-1">
            {top_category_name && (
              <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                <Tag className="w-3 h-3 text-slate-400" />
                {top_category_name}
              </span>
            )}
            <span>
              Avg:{" "}
              <MoneyAmount amount={average_transaction} size="sm" />
            </span>
            <span>•</span>
            <span>{transaction_count} tx</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 text-right">
        <div>
          <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Total Spent
          </span>
          <MoneyAmount
            amount={total_spent}
            type="expense"
            size="md"
          />
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300" />
      </div>
    </Link>
  );
}
