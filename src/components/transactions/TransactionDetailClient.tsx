"use client";

import React, { useState, useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Account,
  Category,
  Merchant,
  Person,
  TransactionWithRelations,
} from "@/types/finance";
import {
  deleteTransactionAction,
  updateTransactionAction,
} from "@/app/actions/transactions";
import { MoneyAmount } from "@/components/ui/MoneyAmount";
import { TransactionTypeBadge } from "@/components/ui/TransactionTypeBadge";
import { formatDateTimeThai } from "@/lib/finance/formatters";
import {
  Trash2,
  Edit2,
  Calendar,
  Wallet,
  Tag,
  User,
  Store,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Check,
  X,
} from "lucide-react";

interface TransactionDetailClientProps {
  transaction: TransactionWithRelations;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  merchants: Merchant[];
}

export function TransactionDetailClient({
  transaction,
  accounts,
  categories,
  people,
  merchants,
}: TransactionDetailClientProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Edit Action State
  const [editState, updateAction, isUpdating] = useActionState(
    async (prevState: unknown, formData: FormData) => {
      const res = await updateTransactionAction(
        transaction.id,
        prevState,
        formData
      );
      if (res.success) {
        setIsEditing(false);
      }
      return res;
    },
    { success: false, error: undefined }
  );

  const handleDelete = async () => {
    if (!confirm("คุณต้องการลบรายการนี้ใช่หรือไม่?")) return;
    setIsDeleting(true);
    const res = await deleteTransactionAction(transaction.id);
    if (res.success) {
      router.push("/transactions");
    } else {
      alert(res.error || "ไม่สามารถลบรายการได้ กรุณาลองใหม่อีกครั้ง");
      setIsDeleting(false);
    }
  };

  const formattedDateTime = formatDateTimeThai(transaction.transaction_date);

  return (
    <div className="max-w-xl mx-auto space-y-6 pb-6">
      {/* Back link */}
      <Link
        href="/transactions"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>กลับไปหน้ารายการ (Transactions)</span>
      </Link>

      {/* Main Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Header Banner */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TransactionTypeBadge type={transaction.type} />
              <span className="text-xs font-medium text-slate-400 capitalize">
                ที่มา: {transaction.source}
              </span>
            </div>
            <MoneyAmount
              amount={transaction.amount}
              type={transaction.type}
              currency={transaction.currency}
              size="2xl"
            />
          </div>

          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  title="แก้ไขรายการ"
                  aria-label="Edit transaction"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors"
                  title="ลบรายการ"
                  aria-label="Delete transaction"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(false)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                title="ยกเลิกการแก้ไข"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* View Mode */}
        {!isEditing ? (
          <div className="p-6 space-y-4 divide-y divide-slate-100 text-sm">
            {/* Transfer flow presentation if transfer */}
            {transaction.type === "transfer" && (
              <div className="pb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
                  เส้นทางการโอนเงิน (Transfer Flow)
                </span>
                <div className="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-slate-500 block">จากบัญชี</span>
                    <strong className="text-slate-900 font-semibold truncate block">
                      {transaction.from_account?.name || "บัญชี"}
                    </strong>
                  </div>
                  <ArrowRight className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0 text-right">
                    <span className="text-xs text-slate-500 block">ไปยังบัญชี</span>
                    <strong className="text-slate-900 font-semibold truncate block">
                      {transaction.to_account?.name || "บัญชี"}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {transaction.description && (
              <div className="pt-4 first:pt-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                  รายละเอียด
                </span>
                <p className="text-slate-800 font-medium">
                  {transaction.description}
                </p>
              </div>
            )}

            {/* Account (for income/expense) */}
            {transaction.type !== "transfer" && (
              <div className="pt-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-500">
                  <Wallet className="w-4 h-4 text-slate-400" />
                  บัญชี
                </span>
                <span className="font-medium text-slate-900">
                  {transaction.type === "income"
                    ? transaction.to_account?.name || "ไม่ได้ระบุ"
                    : transaction.from_account?.name || "ไม่ได้ระบุ"}
                </span>
              </div>
            )}

            {/* Category */}
            {transaction.type !== "transfer" && (
              <div className="pt-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-500">
                  <Tag className="w-4 h-4 text-slate-400" />
                  หมวดหมู่
                </span>
                <span className="font-medium text-slate-900">
                  {transaction.category?.name || "ไม่มีหมวดหมู่"}
                </span>
              </div>
            )}

            {/* Counterparty (Merchant or Person) */}
            {transaction.merchant && (
              <div className="pt-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-500">
                  <Store className="w-4 h-4 text-slate-400" />
                  ร้านค้า
                </span>
                <Link
                  href={`/merchants/${transaction.merchant.id}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {transaction.merchant.display_name}
                </Link>
              </div>
            )}

            {transaction.person && (
              <div className="pt-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-500">
                  <User className="w-4 h-4 text-slate-400" />
                  บุคคล
                </span>
                <Link
                  href={`/people/${transaction.person.id}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {transaction.person.display_name}
                </Link>
              </div>
            )}

            {/* Date and Time */}
            <div className="pt-4 flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-500">
                <Calendar className="w-4 h-4 text-slate-400" />
                วันและเวลา
              </span>
              <span className="font-medium text-slate-900 tabular-nums">
                {formattedDateTime}
              </span>
            </div>

            {/* Payment Method */}
            {transaction.payment_method && (
              <div className="pt-4 flex items-center justify-between">
                <span className="text-slate-500">ช่องทางการชำระ</span>
                <span className="font-medium text-slate-900">
                  {transaction.payment_method}
                </span>
              </div>
            )}

            {/* Audit & Confidence */}
            <div className="pt-4 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                ความมั่นใจ (Confidence)
              </span>
              <span className="font-semibold text-slate-700 tabular-nums">
                {Math.round(transaction.confidence * 100)}% ({transaction.review_status})
              </span>
            </div>

            {/* Note */}
            {transaction.note && (
              <div className="pt-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                  บันทึกช่วยจำ
                </span>
                <p className="text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs leading-relaxed">
                  {transaction.note}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Edit Form */
          <form action={updateAction} className="p-6 space-y-4 text-sm">
            <input type="hidden" name="type" value={transaction.type} />
            <input type="hidden" name="currency" value={transaction.currency} />

            {editState.error && (
              <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">
                {editState.error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                จำนวนเงิน (THB)
              </label>
              <input
                type="number"
                name="amount"
                step="0.01"
                required
                defaultValue={transaction.amount}
                className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                รายละเอียด
              </label>
              <input
                type="text"
                name="description"
                defaultValue={transaction.description || ""}
                className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            {/* Accounts */}
            {transaction.type === "transfer" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    จากบัญชี
                  </label>
                  <select
                    name="from_account_id"
                    defaultValue={transaction.from_account_id || ""}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ไปยังบัญชี
                  </label>
                  <select
                    name="to_account_id"
                    defaultValue={transaction.to_account_id || ""}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  บัญชี
                </label>
                <select
                  name={
                    transaction.type === "income"
                      ? "to_account_id"
                      : "from_account_id"
                  }
                  defaultValue={
                    transaction.type === "income"
                      ? transaction.to_account_id || ""
                      : transaction.from_account_id || ""
                  }
                  className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Category */}
            {transaction.type !== "transfer" && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  หมวดหมู่
                </label>
                <select
                  name="category_id"
                  defaultValue={transaction.category_id || ""}
                  className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <option value="">ไม่มีหมวดหมู่</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type === "expense" ? "รายจ่าย" : "รายรับ"})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Counterparties */}
            {transaction.type !== "transfer" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ร้านค้า
                  </label>
                  <select
                    name="merchant_id"
                    defaultValue={transaction.merchant_id || ""}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="">ไม่ระบุ</option>
                    {merchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    บุคคล
                  </label>
                  <select
                    name="person_id"
                    defaultValue={transaction.person_id || ""}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="">ไม่ระบุ</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                วันและเวลา
              </label>
              <input
                type="datetime-local"
                name="transaction_date"
                defaultValue={transaction.transaction_date.slice(0, 16)}
                required
                className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                บันทึกช่วยจำ
              </label>
              <textarea
                name="note"
                rows={2}
                defaultValue={transaction.note || ""}
                className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{isUpdating ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
