import React from "react";
import Link from "next/link";
import { PersonSummary } from "@/types/finance";
import { MoneyAmount } from "./MoneyAmount";
import { User, ChevronRight } from "lucide-react";

interface PersonRowProps {
  summary: PersonSummary;
}

export function PersonRow({ summary }: PersonRowProps) {
  const { person, total_received, total_paid, net, transaction_count } = summary;

  return (
    <Link
      href={`/people/${person.id}`}
      className="flex items-center justify-between p-4 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-xl transition-all shadow-sm"
    >
      <div className="flex items-center gap-3 min-w-0 pr-4">
        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold flex-shrink-0">
          <User className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm sm:text-base text-slate-900 truncate">
            {person.display_name}
          </h3>
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
            <span>
              Recv:{" "}
              <strong className="text-emerald-700 font-medium">
                <MoneyAmount amount={total_received} size="sm" />
              </strong>
            </span>
            <span>•</span>
            <span>
              Paid:{" "}
              <strong className="text-rose-700 font-medium">
                <MoneyAmount amount={total_paid} size="sm" />
              </strong>
            </span>
            <span>•</span>
            <span>{transaction_count} tx</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 text-right">
        <div>
          <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Net
          </span>
          <MoneyAmount amount={net} type="net" size="md" />
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300" />
      </div>
    </Link>
  );
}
