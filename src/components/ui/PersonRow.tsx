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
      className="flex items-center justify-between p-3.5 sm:p-4 bg-surface dark:bg-surface-raised hover:bg-surface-soft border border-border rounded-xl transition-all shadow-xs min-h-[52px]"
    >
      <div className="flex items-center gap-3 min-w-0 pr-3">
        <div className="w-9 h-9 rounded-xl bg-surface-soft border border-border flex items-center justify-center text-text-secondary flex-shrink-0">
          <User className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-text-primary truncate">
            {person.display_name}
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {transaction_count} รายการ
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 text-right">
        <div>
          <MoneyAmount amount={net} type="net" size="md" />
          <span className="block text-[11px] text-text-muted font-normal">
            สุทธิ
          </span>
        </div>
        <ChevronRight className="w-4 h-4 text-text-muted" />
      </div>
    </Link>
  );
}
