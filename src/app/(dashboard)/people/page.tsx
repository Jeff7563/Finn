import React from "react";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculateAllPeopleSummaries } from "@/lib/finance/people";
import { PeopleClient } from "@/components/people/PeopleClient";
import { User, Store } from "lucide-react";

export default async function PeoplePage() {
  const user = await requireUser();

  const { people, transactions } =
    await DataStore.getTransactionsPageData(user.id);

  const summaries = calculateAllPeopleSummaries(people, transactions);

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-6">
      {/* Header & Unified Contacts Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary">
            คนและร้านค้า <span className="text-sm font-normal text-text-muted">· Contacts</span>
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            จัดการข้อมูลบุคคลและร้านค้าที่คุณทำธุรกรรมด้วย
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 bg-surface-soft border border-border rounded-xl w-fit">
          <Link
            href="/people"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold bg-surface text-text-primary shadow-xs border border-border/80 transition-all"
          >
            <User className="w-3.5 h-3.5" />
            <span>บุคคล (People)</span>
          </Link>
          <Link
            href="/merchants"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium text-text-muted hover:text-text-primary transition-all"
          >
            <Store className="w-3.5 h-3.5" />
            <span>ร้านค้า (Merchants)</span>
          </Link>
        </div>
      </div>

      <PeopleClient initialSummaries={summaries} />
    </div>
  );
}
