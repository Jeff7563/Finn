import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculatePersonSummary } from "@/lib/finance/people";
import { TransactionItem } from "@/components/ui/TransactionItem";
import { SummaryMetric } from "@/components/ui/SummaryMetric";
import { ArrowLeft, User, TrendingDown, TrendingUp, Scale, Clock } from "lucide-react";

interface PersonDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function PersonDetailPage({
  params,
}: PersonDetailPageProps) {
  const user = await requireUser();
  const { id } = await params;

  const [person, allTransactions] = await Promise.all([
    DataStore.getPersonById(user.id, id),
    DataStore.getTransactions(user.id),
  ]);

  if (!person) {
    notFound();
  }

  const summary = calculatePersonSummary(person, allTransactions);

  // Transactions with this person
  const personTransactions = allTransactions
    .filter((tx) => tx.person_id === person.id)
    .sort(
      (a, b) =>
        new Date(b.transaction_date).getTime() -
        new Date(a.transaction_date).getTime()
    );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        href="/people"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to people</span>
      </Link>

      {/* Header Profile Card */}
      <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-surface-soft border border-border flex items-center justify-center text-text-primary flex-shrink-0">
          <User className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">
            {person.display_name}
          </h1>
          {person.aliases && person.aliases.length > 0 && (
            <p className="text-xs text-text-muted mt-0.5">
              Aliases: {person.aliases.join(", ")}
            </p>
          )}
          {person.phone && (
            <p className="text-xs text-text-muted mt-0.5 font-mono">
              {person.phone}
            </p>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryMetric
          label="Received"
          amount={summary.total_received}
          type="income"
          icon={<TrendingUp className="w-4 h-4 text-income" />}
        />
        <SummaryMetric
          label="Paid"
          amount={summary.total_paid}
          type="expense"
          icon={<TrendingDown className="w-4 h-4 text-expense" />}
        />
        <SummaryMetric
          label="Net"
          amount={summary.net}
          type="net"
          icon={<Scale className="w-4 h-4 text-text-muted" />}
        />
      </div>

      {/* Transaction History with Person */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-text-muted" />
            <h2 className="font-semibold text-base text-text-primary">
              Transaction History ({personTransactions.length})
            </h2>
          </div>
          <Link
            href={`/transactions/new?type=expense`}
            className="text-xs font-semibold text-text-secondary hover:text-text-primary"
          >
            + Add Transaction
          </Link>
        </div>

        {personTransactions.length === 0 ? (
          <div className="p-8 text-center bg-surface rounded-xl border border-dashed border-border text-sm text-text-muted">
            No transactions linked to {person.display_name} yet.
          </div>
        ) : (
          <div className="bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm overflow-hidden divide-y divide-border">
            {personTransactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
