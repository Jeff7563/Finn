"use client";

import React, { useState, useActionState } from "react";
import { MerchantSummary } from "@/types/finance";
import { createMerchantAction } from "@/app/actions/merchants";
import { MerchantRow } from "@/components/ui/MerchantRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Plus, Store, X, Check, Search } from "lucide-react";

interface MerchantsClientProps {
  initialSummaries: MerchantSummary[];
}

export function MerchantsClient({ initialSummaries }: MerchantsClientProps) {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);

  const [createState, formAction, isCreating] = useActionState(
    async (prevState: unknown, formData: FormData) => {
      const res = await createMerchantAction(prevState, formData);
      if (res.success) {
        setShowModal(false);
      }
      return res;
    },
    { success: false, error: undefined }
  );

  const filteredSummaries = initialSummaries.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const matchName = s.merchant.display_name.toLowerCase().includes(q);
    const matchAlias = s.merchant.aliases?.some((a) =>
      a.toLowerCase().includes(q)
    );
    return matchName || matchAlias;
  });

  return (
    <div className="space-y-4">
      {/* Search & Add Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchant or brand..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
          />
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-all flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Merchant</span>
        </button>
      </div>

      {filteredSummaries.length === 0 ? (
        <EmptyState
          icon={<Store className="w-8 h-8 text-slate-400" />}
          title="No merchants yet"
          description="Track repeated shops, stores, supermarkets, and service providers."
          actionHref="#"
          actionLabel="+ Add New Merchant"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredSummaries.map((s) => (
            <MerchantRow key={s.merchant.id} summary={s} />
          ))}
        </div>
      )}

      {/* Add Merchant Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-base text-slate-900">
                Add Merchant
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form action={formAction} className="space-y-3.5">
              {createState.error && (
                <div className="p-3 text-xs text-rose-700 bg-rose-50 rounded-xl border border-rose-200">
                  {createState.error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Merchant Name
                </label>
                <input
                  type="text"
                  name="display_name"
                  required
                  placeholder="e.g. 7-Eleven, Grab, Lotus's, Shopee"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Category Hint
                </label>
                <input
                  type="text"
                  name="category_hint"
                  placeholder="e.g. Food, Transport, Fuel"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Aliases (comma separated)
                </label>
                <input
                  type="text"
                  name="aliases"
                  placeholder="e.g. เซเว่น, CP ALL, 7-11"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>{isCreating ? "Saving..." : "Save Merchant"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
