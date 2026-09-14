import React from "react";
import Link from "next/link";
import { PersonSummary } from "@/types/finance";
import { MoneyAmount } from "./MoneyAmount";
import { User, ChevronRight } from "lucide-react";

interface PersonRowProps {
  summary: PersonSummary;
}

export function PersonRow({ summary }: PersonRowProps) {
  const { person, net, transaction_count } = summary;

  return (
    <Link
      href={`/people/${person.id}`}
      className="flex items-center justify-between p-3.5 sm:p-4 bg-white hover:bg-slate-50 border border-slate-200/70 rounded-xl transition-all shadow-sm min-h-[52px]"
    >
      <div className="flex items-center gap-3 min-w-0 pr-3">
        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 flex-shrink-0">
          <User className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-slate-900 truncate">
            {person.display_name}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {transaction_count} รายการ
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 text-right">
        <div>
          <MoneyAmount amount={net} type="net" size="md" />
          <span className="block text-[11px] text-slate-400 font-normal">
            สุทธิ
          </span>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300" />
      </div>
    </Link>
  );
}
