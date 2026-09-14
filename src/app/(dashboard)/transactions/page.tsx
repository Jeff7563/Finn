import React from "react";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { TransactionListClient } from "@/components/transactions/TransactionListClient";
import { Plus } from "lucide-react";

interface TransactionsPageProps {
  searchParams: Promise<{
    accountId?: string;
    date?: string;
  }>;
}

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const user = await requireUser();
  const params = await searchParams;

  const [transactions, accounts, categories, people, merchants] =
    await Promise.all([
      DataStore.getTransactions(user.id),
      DataStore.getAccounts(user.id),
      DataStore.getCategories(user.id),
      DataStore.getPeople(user.id),
      DataStore.getMerchants(user.id),
    ]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary">
            รายการทั้งหมด
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            บันทึกรายรับ รายจ่าย และการโอนเงิน
          </p>
        </div>

        <Link
          href="/transactions/new"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover rounded-xl transition-all shadow-xs active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>+ เพิ่มรายการ</span>
        </Link>
      </div>

      <TransactionListClient
        initialTransactions={transactions}
        accounts={accounts}
        categories={categories}
        people={people}
        merchants={merchants}
        initialAccountId={params.accountId}
        initialDate={params.date}
      />
    </div>
  );
}
