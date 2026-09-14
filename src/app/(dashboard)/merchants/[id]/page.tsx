import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculateMerchantSummary } from "@/lib/finance/merchants";
import { TransactionItem } from "@/components/ui/TransactionItem";
import { SummaryMetric } from "@/components/ui/SummaryMetric";
import { ArrowLeft, Store, TrendingDown, Calculator, Tag, Clock } from "lucide-react";

interface MerchantDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function MerchantDetailPage({
  params,
}: MerchantDetailPageProps) {
  const user = await requireUser();
  const { id } = await params;

  const [merchant, allTransactions, categories] = await Promise.all([
    DataStore.getMerchantById(user.id, id),
    DataStore.getTransactions(user.id),
    DataStore.getCategories(user.id),
  ]);

  if (!merchant) {
    notFound();
  }

  const summary = calculateMerchantSummary(
    merchant,
    allTransactions,
    categories
  );

  const merchantTransactions = allTransactions
    .filter((tx) => tx.merchant_id === merchant.id)
    .sort(
      (a, b) =>
        new Date(b.transaction_date).getTime() -
        new Date(a.transaction_date).getTime()
    );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        href="/merchants"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to merchants</span>
      </Link>

      {/* Header Profile Card */}
      <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-surface-soft border border-border flex items-center justify-center text-text-primary flex-shrink-0">
          <Store className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">
            {merchant.display_name}
          </h1>
          <div className="flex items-center gap-3 text-xs text-text-muted mt-1">
            {summary.top_category_name && (
              <span className="inline-flex items-center gap-1 bg-surface-soft border border-border px-2 py-0.5 rounded font-medium text-text-secondary">
                <Tag className="w-3 h-3 text-text-muted" />
                {summary.top_category_name}
              </span>
            )}
            {merchant.aliases && merchant.aliases.length > 0 && (
              <span>Aliases: {merchant.aliases.join(", ")}</span>
            )}
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryMetric
          label="Total Spent"
          amount={summary.total_spent}
          type="expense"
          icon={<TrendingDown className="w-4 h-4 text-expense" />}
        />
        <SummaryMetric
          label="Average Ticket"
          amount={summary.average_transaction}
          icon={<Calculator className="w-4 h-4 text-text-muted" />}
        />
        <div className="p-4 sm:p-5 bg-surface dark:bg-surface-raised rounded-xl border border-border shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Frequency
          </span>
          <span className="text-xl sm:text-2xl font-bold text-text-primary tabular-nums mt-2">
            {summary.transaction_count} tx
          </span>
          <span className="text-xs text-text-muted mt-1">Lifetime</span>
        </div>
      </div>

      {/* Transaction History with Merchant */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-text-muted" />
            <h2 className="font-semibold text-base text-text-primary">
              Transactions ({merchantTransactions.length})
            </h2>
          </div>
          <Link
            href={`/transactions/new?type=expense`}
            className="text-xs font-semibold text-text-secondary hover:text-text-primary"
          >
            + Add Transaction
          </Link>
        </div>

        {merchantTransactions.length === 0 ? (
          <div className="p-8 text-center bg-surface rounded-xl border border-dashed border-border text-sm text-text-muted">
            No transactions recorded for {merchant.display_name} yet.
          </div>
        ) : (
          <div className="bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm overflow-hidden divide-y divide-border">
            {merchantTransactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
