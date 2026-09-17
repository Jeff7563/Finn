import React from "react";
import Link from "next/link";
import { TransactionWithRelations } from "@/types/finance";
import { MoneyAmount } from "./MoneyAmount";
import { formatDateTimeThai } from "@/lib/finance/formatters";
import { getCategoryDisplayName } from "@/lib/finance/category-labels";
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
  onRestore?: (transaction: TransactionWithRelations) => void;
}

export function TransactionItem({ transaction, onRestore }: TransactionItemProps) {
  const isVoided = Boolean(transaction.voided_at);

  // Title determination
  let title = transaction.description || "รายการ";
  if (transaction.type === "transfer") {
    title = "โอนระหว่างบัญชี";
  } else if (transaction.merchant?.display_name) {
    title = transaction.merchant.display_name;
  } else if (transaction.person?.display_name) {
    title = transaction.person.display_name;
  } else if (transaction.category?.name) {
    title = getCategoryDisplayName(transaction.category);
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

  const isPreBaseline = Boolean(
    (transaction.from_account?.balance_as_of &&
      new Date(transaction.transaction_date).getTime() <=
        new Date(transaction.from_account.balance_as_of).getTime()) ||
    (transaction.to_account?.balance_as_of &&
      new Date(transaction.transaction_date).getTime() <=
        new Date(transaction.to_account.balance_as_of).getTime())
  );

  return (
    <Link
      href={`/transactions/${transaction.id}`}
      className={`group flex items-center justify-between py-3 px-3 sm:px-4 hover:bg-surface-soft rounded-xl transition-colors min-h-[56px] ${
        isVoided ? "opacity-60 bg-surface-soft/40 hover:bg-surface-soft/80" : ""
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 pr-3">
        {getTransactionIcon()}

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-semibold text-sm truncate block ${
                isVoided ? "line-through text-text-muted" : "text-text-primary"
              }`}
            >
              {title}
            </span>
            {isVoided && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-850">
                ยกเลิกแล้ว (Voided)
              </span>
            )}
          </div>

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
                    {getCategoryDisplayName(transaction.category)}
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
            {isPreBaseline && (
              <>
                <span>·</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-soft text-text-muted border border-border">
                  ก่อนจุดอ้างอิงยอดคงเหลือ
                </span>
              </>
            )}
            {isVoided && transaction.void_reason && (
              <>
                <span>·</span>
                <span className="text-rose-600 dark:text-rose-400 font-medium truncate">
                  เหตุผล: {transaction.void_reason}
                </span>
              </>
            )}
            {isVoided && transaction.voided_at && (
              <>
                <span>·</span>
                <span className="text-text-muted">
                  (ยกเลิกเมื่อ {formatDateTimeThai(transaction.voided_at)})
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 text-right">
        <div className={isVoided ? "line-through text-text-muted opacity-60" : ""}>
          <MoneyAmount
            amount={transaction.amount}
            type={transaction.type}
            currency={transaction.currency}
            size="md"
          />
        </div>

        {isVoided && onRestore && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRestore(transaction);
            }}
            className="px-2.5 py-1 text-xs font-semibold text-text-primary bg-surface hover:bg-surface-soft border border-border rounded-lg shadow-2xs transition-colors"
            title="คืนรายการ"
          >
            คืนรายการ
          </button>
        )}
      </div>
    </Link>
  );
}
