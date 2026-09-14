"use client";

import React, { useState, useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Account, Category, Merchant, Person, TransactionType } from "@/types/finance";
import { createTransactionAction } from "@/app/actions/transactions";
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
}

export function TransactionForm({
  accounts,
  categories,
  people,
  merchants,
  defaultType = "expense",
}: TransactionFormProps) {
  const router = useRouter();
  const [type, setType] = useState<TransactionType>(defaultType);
  const [counterpartyMode, setCounterpartyMode] = useState<"merchant" | "person">("merchant");

  // Form states
  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id || "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id || accounts[0]?.id || "");

  // Date and Time default (current local datetime in YYYY-MM-DDTHH:mm format)
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

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
    <div className="max-w-lg mx-auto bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      {/* Type Switcher Tabs */}
      <div className="grid grid-cols-3 p-1.5 bg-slate-100/80 border-b border-slate-200/80">
        <button
          type="button"
          onClick={() => setType("expense")}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            type === "expense"
              ? "bg-white text-rose-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ArrowUpRight className="w-4 h-4" />
          <span>Expense</span>
        </button>

        <button
          type="button"
          onClick={() => setType("income")}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            type === "income"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ArrowDownLeft className="w-4 h-4" />
          <span>Income</span>
        </button>

        <button
          type="button"
          onClick={() => setType("transfer")}
          className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            type === "transfer"
              ? "bg-white text-blue-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>Transfer</span>
        </button>
      </div>

      <form action={formAction} className="p-5 sm:p-6 space-y-4">
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="currency" value="THB" />

        {/* Error Alert */}
        {state.error && (
          <div
            role="alert"
            className="flex items-center gap-2 p-3 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-xl"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{state.error}</span>
          </div>
        )}

        {/* Amount Input (Prominent & Clear) */}
        <div className="space-y-1">
          <label
            htmlFor="amount"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
          >
            Amount (THB)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-400">
              ฿
            </span>
            <input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              autoFocus
              placeholder="0.00"
              className="w-full pl-11 pr-4 py-3 text-2xl sm:text-3xl font-extrabold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 tabular-nums transition-all"
            />
          </div>
        </div>

        {/* Account Selection */}
        {type === "expense" && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              From Account
            </label>
            <div className="relative">
              <Wallet className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              <select
                name="from_account_id"
                required
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                {accounts.length === 0 ? (
                  <option value="">No accounts available (Create one first)</option>
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

        {type === "income" && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Destination Account
            </label>
            <div className="relative">
              <Wallet className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              <select
                name="to_account_id"
                required
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                {accounts.length === 0 ? (
                  <option value="">No accounts available (Create one first)</option>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                From Account
              </label>
              <select
                name="from_account_id"
                required
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                To Account
              </label>
              <select
                name="to_account_id"
                required
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
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

        {/* Category (Expense / Income only) */}
        {type !== "transfer" && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">
                Category
              </label>
              <Link
                href="/categories"
                className="text-[11px] text-slate-500 hover:text-slate-900"
              >
                + Add category
              </Link>
            </div>
            <div className="relative">
              <Tag className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              <select
                name="category_id"
                className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="">Select category...</option>
                {(type === "expense" ? expenseCategories : incomeCategories).map(
                  (c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>
        )}

        {/* Counterparty: Merchant or Person (Expense / Income) */}
        {type !== "transfer" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">
                Counterparty
              </span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setCounterpartyMode("merchant")}
                  className={`px-2 py-0.5 rounded font-medium ${
                    counterpartyMode === "merchant"
                      ? "bg-slate-200 text-slate-900"
                      : "text-slate-500"
                  }`}
                >
                  Merchant
                </button>
                <button
                  type="button"
                  onClick={() => setCounterpartyMode("person")}
                  className={`px-2 py-0.5 rounded font-medium ${
                    counterpartyMode === "person"
                      ? "bg-slate-200 text-slate-900"
                      : "text-slate-500"
                  }`}
                >
                  Person
                </button>
              </div>
            </div>

            {counterpartyMode === "merchant" ? (
              <div className="relative">
                <Store className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                <select
                  name="merchant_id"
                  className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
                >
                  <option value="">None / Select merchant...</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                <select
                  name="person_id"
                  className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
                >
                  <option value="">None / Select person...</option>
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

        {/* Date & Time */}
        <div>
          <label
            htmlFor="transaction_date"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Date & Time
          </label>
          <div className="relative">
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              id="transaction_date"
              name="transaction_date"
              type="datetime-local"
              required
              defaultValue={nowLocal}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>
        </div>

        {/* Description / Note */}
        <div>
          <label
            htmlFor="description"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Description
          </label>
          <input
            id="description"
            name="description"
            type="text"
            placeholder={
              type === "expense"
                ? "e.g., Grocery at Lotus's"
                : type === "income"
                ? "e.g., September Freelance"
                : "e.g., Transfer to savings"
            }
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <div>
          <label
            htmlFor="note"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Note (Optional)
          </label>
          <textarea
            id="note"
            name="note"
            rows={2}
            placeholder="Additional details, memo..."
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none"
          />
        </div>

        {/* Submit Actions */}
        <div className="pt-2 flex items-center justify-end gap-3">
          <Link
            href="/transactions"
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-xl transition-colors"
          >
            Cancel
          </Link>

          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-all shadow-sm active:scale-[0.99] disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>{isPending ? "Saving..." : "Save Transaction"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
