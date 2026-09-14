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
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to people</span>
      </Link>

      {/* Header Profile Card */}
      <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 flex-shrink-0">
          <User className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            {person.display_name}
          </h1>
          {person.aliases && person.aliases.length > 0 && (
            <p className="text-xs text-slate-500 mt-0.5">
              Aliases: {person.aliases.join(", ")}
            </p>
          )}
          {person.phone && (
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
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
          icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
        />
        <SummaryMetric
          label="Paid"
          amount={summary.total_paid}
          type="expense"
          icon={<TrendingDown className="w-4 h-4 text-rose-600" />}
        />
        <SummaryMetric
          label="Net"
          amount={summary.net}
          type="net"
          icon={<Scale className="w-4 h-4 text-slate-600" />}
        />
      </div>

      {/* Transaction History with Person */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-base text-slate-900">
              Transaction History ({personTransactions.length})
            </h2>
          </div>
          <Link
            href={`/transactions/new?type=expense`}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            + Add Transaction
          </Link>
        </div>

        {personTransactions.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
            No transactions linked to {person.display_name} yet.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden divide-y divide-slate-100">
            {personTransactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
