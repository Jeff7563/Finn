import React from "react";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculateAllMerchantSummaries } from "@/lib/finance/merchants";
import { MerchantsClient } from "@/components/merchants/MerchantsClient";
import { User, Store } from "lucide-react";

export default async function MerchantsPage() {
  const user = await requireUser();

  const [merchants, transactions, categories] = await Promise.all([
    DataStore.getMerchants(user.id),
    DataStore.getTransactions(user.id),
    DataStore.getCategories(user.id),
  ]);

  const summaries = calculateAllMerchantSummaries(
    merchants,
    transactions,
    categories
  );

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-6">
      {/* Header & Unified Contacts Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
            คนและร้านค้า <span className="text-sm font-normal text-slate-400">· Contacts</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการข้อมูลบุคคลและร้านค้าที่คุณทำธุรกรรมด้วย
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 bg-slate-100 rounded-xl w-fit">
          <Link
            href="/people"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 transition-all"
          >
            <User className="w-3.5 h-3.5" />
            <span>บุคคล (People)</span>
          </Link>
          <Link
            href="/merchants"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold bg-white text-slate-900 shadow-sm transition-all"
          >
            <Store className="w-3.5 h-3.5" />
            <span>ร้านค้า (Merchants)</span>
          </Link>
        </div>
      </div>

      <MerchantsClient initialSummaries={summaries} />
    </div>
  );
}
