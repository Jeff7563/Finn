import React from "react";
import Link from "next/link";
import { TransactionWithRelations } from "@/types/finance";
import { MoneyAmount } from "./MoneyAmount";
import { formatDateTimeThai } from "@/lib/finance/formatters";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ShoppingBag,
  Utensils,
  Car,
  Fuel,
  Briefcase,
} from "lucide-react";

interface TransactionItemProps {
  transaction: TransactionWithRelations;
}

export function TransactionItem({ transaction }: TransactionItemProps) {
  // Title determination
  let title = transaction.description || "รายการ";
  if (transaction.type === "transfer") {
    title = "โอนระหว่างบัญชี";
  } else if (transaction.merchant?.display_name) {
    title = transaction.merchant.display_name;
  } else if (transaction.person?.display_name) {
    title = transaction.person.display_name;
  } else if (transaction.category?.name) {
    title = transaction.category.name;
  }

  // Account label
  const accountName =
    transaction.type === "transfer"
      ? null
      : transaction.type === "income"
      ? transaction.to_account?.name
      : transaction.from_account?.name;

  // Icon mapping
  const getTransactionIcon = () => {
    if (transaction.type === "transfer") {
      return (
        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
          <ArrowLeftRight className="w-4 h-4" />
        </div>
      );
    }

    const catName = transaction.category?.name?.toLowerCase() || "";
    if (catName.includes("food") || catName.includes("อาหาร")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center flex-shrink-0">
          <Utensils className="w-4 h-4" />
        </div>
      );
    }
    if (catName.includes("transport") || catName.includes("เดินทาง")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
          <Car className="w-4 h-4" />
        </div>
      );
    }
    if (catName.includes("fuel") || catName.includes("น้ำมัน")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center flex-shrink-0">
          <Fuel className="w-4 h-4" />
        </div>
      );
    }
    if (catName.includes("shopping") || catName.includes("ช้อปปิ้ง")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
          <ShoppingBag className="w-4 h-4" />
        </div>
      );
    }
    if (catName.includes("salary") || catName.includes("เงินเดือน")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
          <Briefcase className="w-4 h-4" />
        </div>
      );
    }
    if (transaction.type === "income") {
      return (
        <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
          <ArrowDownLeft className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
        <ArrowUpRight className="w-4 h-4" />
      </div>
    );
  };

  const formattedDateTime = formatDateTimeThai(transaction.transaction_date);

  return (
    <Link
      href={`/transactions/${transaction.id}`}
      className="group flex items-center justify-between py-3 px-3 sm:px-4 hover:bg-slate-50/80 rounded-xl transition-colors min-h-[56px]"
    >
      <div className="flex items-center gap-3 min-w-0 pr-3">
        {getTransactionIcon()}

        <div className="min-w-0">
          <span className="font-semibold text-sm text-slate-900 truncate block">
            {title}
          </span>

          <div className="flex items-center flex-wrap gap-x-2 text-xs text-slate-400 mt-0.5 font-normal">
            {transaction.type === "transfer" ? (
              <span className="text-slate-500 font-medium truncate">
                {transaction.from_account?.name || "บัญชีต้นทาง"} →{" "}
                {transaction.to_account?.name || "บัญชีปลายทาง"}
              </span>
            ) : (
              <>
                {transaction.category && (
                  <span className="text-slate-600 font-medium">
                    {transaction.category.name}
                  </span>
                )}
                {accountName && (
                  <>
                    <span>·</span>
                    <span className="text-slate-500">{accountName}</span>
                  </>
                )}
              </>
            )}
            <span>·</span>
            <span>{formattedDateTime}</span>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 text-right">
        <MoneyAmount
          amount={transaction.amount}
          type={transaction.type}
          currency={transaction.currency}
          size="md"
        />
      </div>
    </Link>
  );
}
