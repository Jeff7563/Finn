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
        <div className="w-9 h-9 rounded-xl bg-transfer-soft text-transfer flex items-center justify-center flex-shrink-0">
          <ArrowLeftRight className="w-4 h-4" />
        </div>
      );
    }

    const catName = transaction.category?.name?.toLowerCase() || "";
    if (catName.includes("food") || catName.includes("อาหาร")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
          <Utensils className="w-4 h-4" />
        </div>
      );
    }
    if (catName.includes("transport") || catName.includes("เดินทาง")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
          <Car className="w-4 h-4" />
        </div>
      );
    }
    if (catName.includes("fuel") || catName.includes("น้ำมัน")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 flex items-center justify-center flex-shrink-0">
          <Fuel className="w-4 h-4" />
        </div>
      );
    }
    if (catName.includes("shopping") || catName.includes("ช้อปปิ้ง")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
          <ShoppingBag className="w-4 h-4" />
        </div>
      );
    }
    if (catName.includes("salary") || catName.includes("เงินเดือน")) {
      return (
        <div className="w-9 h-9 rounded-xl bg-income-soft text-income flex items-center justify-center flex-shrink-0">
          <Briefcase className="w-4 h-4" />
        </div>
      );
    }
    if (transaction.type === "income") {
      return (
        <div className="w-9 h-9 rounded-xl bg-income-soft text-income flex items-center justify-center flex-shrink-0">
          <ArrowDownLeft className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div className="w-9 h-9 rounded-xl bg-surface-soft text-text-secondary flex items-center justify-center flex-shrink-0 border border-border">
        <ArrowUpRight className="w-4 h-4" />
      </div>
    );
  };

  const formattedDateTime = formatDateTimeThai(transaction.transaction_date);

  return (
    <Link
      href={`/transactions/${transaction.id}`}
      className="group flex items-center justify-between py-3 px-3 sm:px-4 hover:bg-surface-soft rounded-xl transition-colors min-h-[56px]"
    >
      <div className="flex items-center gap-3 min-w-0 pr-3">
        {getTransactionIcon()}

        <div className="min-w-0">
          <span className="font-semibold text-sm text-text-primary truncate block">
            {title}
          </span>

          <div className="flex items-center flex-wrap gap-x-2 text-xs text-text-muted mt-0.5 font-normal">
            {transaction.type === "transfer" ? (
              <span className="text-text-secondary font-medium truncate">
                {transaction.from_account?.name || "บัญชีต้นทาง"} →{" "}
                {transaction.to_account?.name || "บัญชีปลายทาง"}
              </span>
            ) : (
              <>
                {transaction.category && (
                  <span className="text-text-secondary font-medium">
                    {transaction.category.name}
                  </span>
                )}
                {accountName && (
                  <>
                    <span>·</span>
                    <span className="text-text-muted">{accountName}</span>
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
