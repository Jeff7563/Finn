"use client";

import React, { useState, useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Account, Category, Merchant, Person, TransactionType } from "@/types/finance";
import { createTransactionAction } from "@/app/actions/transactions";
import { canonicalInstantToBangkokDateTimeLocal } from "@/lib/finance/formatters";
import { getCategoryDisplayName } from "@/lib/finance/category-labels";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  Calendar,
  Wallet,
  Tag,
  Store,
  User,
  AlertCircle,
} from "lucide-react";

interface TransactionFormProps {
  accounts: Account[];
  categories: Category[];
  people: Person[];
  merchants: Merchant[];
  defaultType?: TransactionType;
  defaultDate?: string;
}

export function TransactionForm({
  accounts,
  categories,
  people,
  merchants,
  defaultType = "expense",
  defaultDate,
}: TransactionFormProps) {
  const router = useRouter();
  const [type, setType] = useState<TransactionType>(defaultType);
  const [counterpartyMode, setCounterpartyMode] = useState<"merchant" | "person">("merchant");

  // Form states
  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id || "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id || accounts[0]?.id || "");

  // Date and Time default (current local datetime in YYYY-MM-DDTHH:mm format, or prefilled defaultDate)
  const nowLocal = defaultDate
    ? `${defaultDate}T12:00`
    : canonicalInstantToBangkokDateTimeLocal(new Date());

  const [state, formAction, isPending] = useActionState(
    async (prevState: unknown, formData: FormData) => {
      const res = await createTransactionAction(prevState, formData);
      if (res.success) {
        router.push("/transactions");
      }
      return res;
    },
    { success: false, error: undefined }
  );

  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  return (
    <div className="max-w-lg mx-auto bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-3 p-1.5 bg-surface-soft border-b border-border">
        <button
          type="button"
          onClick={() => setType("expense")}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            type === "expense"
              ? "bg-surface text-expense shadow-xs"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          <ArrowUpRight className="w-4 h-4" />
          <span>รายจ่าย</span>
        </button>

        <button
          type="button"
          onClick={() => setType("income")}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            type === "income"
              ? "bg-surface text-income shadow-xs"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          <ArrowDownLeft className="w-4 h-4" />
          <span>รายรับ</span>
        </button>

        <button
          type="button"
          onClick={() => setType("transfer")}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            type === "transfer"
              ? "bg-surface text-transfer shadow-xs"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>โอนเงิน</span>
        </button>
      </div>

      <form action={formAction} className="p-5 sm:p-6 space-y-4">
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="currency" value="THB" />

        {/* Error Alert */}
        {state.error && (
          <div
            role="alert"
            className="flex items-center gap-2 p-3 text-xs font-medium text-expense bg-expense-soft border border-expense/30 rounded-xl"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{state.error}</span>
          </div>
        )}

        {/* Amount Input (Hero First) */}
        <div className="space-y-1.5 pb-1">
          <label
            htmlFor="amount"
            className="block text-xs font-semibold text-text-muted uppercase tracking-wider"
          >
            จำนวนเงิน (Amount THB)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-text-muted pointer-events-none">
              ฿
            </span>
            <input
              id="amount"
              name="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              autoFocus
              placeholder="0"
              className="w-full pl-11 pr-4 py-3 text-3xl sm:text-4xl font-extrabold text-text-primary bg-surface-soft border border-border rounded-xl focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary tabular-nums transition-all placeholder:text-text-muted/40"
            />
          </div>
        </div>

        {/* Account Selector (Expense: From, Income: To) */}
        {type !== "transfer" && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {type === "expense" ? "จ่ายจากบัญชี" : "เข้าบัญชี"}
            </label>
            <div className="relative">
              <Wallet className="w-4 h-4 text-text-muted absolute left-3 top-3 pointer-events-none" />
              <select
                name={type === "expense" ? "from_account_id" : "to_account_id"}
                required
                className="w-full pl-9 pr-8 py-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {accounts.length === 0 ? (
                  <option value="">ยังไม่มีบัญชี (สร้างบัญชีก่อน)</option>
                ) : (
                  accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.institution || acc.type})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
        )}

        {type === "transfer" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-surface-soft rounded-xl border border-border">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                จากบัญชี
              </label>
              <select
                name="from_account_id"
                required
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full text-xs p-2.5 bg-surface border border-border text-text-primary rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                ไปยังบัญชี
              </label>
              <select
                name="to_account_id"
                required
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="w-full text-xs p-2.5 bg-surface border border-border text-text-primary rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Counterparty: Merchant or Person (Expense / Income) */}
        {type !== "transfer" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">
                {type === "expense" ? "จ่ายให้ (ร้านค้า / บุคคล)" : "รับจาก (บุคคล / ร้านค้า)"}
              </span>
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setCounterpartyMode("merchant")}
                  className={`px-2 py-0.5 rounded font-medium transition-colors ${
                    counterpartyMode === "merchant"
                      ? "bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  ร้านค้า
                </button>
                <button
                  type="button"
                  onClick={() => setCounterpartyMode("person")}
                  className={`px-2 py-0.5 rounded font-medium transition-colors ${
                    counterpartyMode === "person"
                      ? "bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  บุคคล
                </button>
              </div>
            </div>

            {counterpartyMode === "merchant" ? (
              <div className="relative">
                <Store className="w-4 h-4 text-text-muted absolute left-3 top-3 pointer-events-none" />
                <select
                  name="merchant_id"
                  className="w-full pl-9 pr-8 py-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">ไม่ระบุ / เลือกร้านค้า...</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="relative">
                <User className="w-4 h-4 text-text-muted absolute left-3 top-3 pointer-events-none" />
                <select
                  name="person_id"
                  className="w-full pl-9 pr-8 py-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">ไม่ระบุ / เลือกบุคคล...</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Category (Expense / Income) */}
        {type !== "transfer" && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-text-secondary">
                หมวดหมู่
              </label>
              <Link
                href="/categories"
                className="text-[11px] text-text-muted hover:text-text-primary"
              >
                + เพิ่มหมวดหมู่
              </Link>
            </div>
            <div className="relative">
              <Tag className="w-4 h-4 text-text-muted absolute left-3 top-3 pointer-events-none" />
              <select
                name="category_id"
                className="w-full pl-9 pr-8 py-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">เลือกหมวดหมู่...</option>
                {(type === "expense" ? expenseCategories : incomeCategories).map(
                  (c) => (
                    <option key={c.id} value={c.id}>
                      {getCategoryDisplayName(c)}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>
        )}

        {/* Date & Time */}
        <div>
          <label
            htmlFor="transaction_date"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            วันและเวลา
          </label>
          <div className="relative">
            <Calendar className="w-4 h-4 text-text-muted absolute left-3 top-3 pointer-events-none" />
            <input
              id="transaction_date"
              name="transaction_date"
              type="datetime-local"
              required
              defaultValue={nowLocal}
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Description / Note */}
        <div>
          <label
            htmlFor="description"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            รายละเอียดรายการ (Description)
          </label>
          <input
            id="description"
            name="description"
            type="text"
            placeholder={
              type === "expense"
                ? "เช่น ข้าวกลางวัน, ซื้อของ Lotus's"
                : type === "income"
                ? "เช่น เงินเดือน, งานฟรีแลนซ์"
                : "เช่น โอนเข้าบัญชีออมเงิน"
            }
            className="w-full px-3.5 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-text-muted/60"
          />
        </div>

        <div>
          <label
            htmlFor="note"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            บันทึกช่วยจำ (ไม่บังคับ)
          </label>
          <textarea
            id="note"
            name="note"
            rows={2}
            placeholder="หมายเหตุเพิ่มเติม..."
            className="w-full px-3.5 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-text-muted/60"
          />
        </div>

        {/* Sticky Save Action on Mobile */}
        <div className="pt-2 sticky bottom-0 sm:static bg-surface/95 sm:bg-transparent backdrop-blur-sm p-3 -mx-5 -mb-5 sm:p-0 sm:m-0 border-t border-border sm:border-0 flex items-center justify-end gap-3">
          <Link
            href="/transactions"
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary rounded-xl transition-colors"
          >
            ยกเลิก
          </Link>

          <button
            type="submit"
            aria-label="Save Transaction"
            disabled={isPending}
            className="flex items-center justify-center gap-1.5 px-6 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover rounded-xl transition-all shadow-xs active:scale-[0.99] disabled:opacity-50 min-w-[140px]"
          >
            <Check className="w-4 h-4" />
            <span>{isPending ? "กำลังบันทึก..." : "Save Transaction"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
