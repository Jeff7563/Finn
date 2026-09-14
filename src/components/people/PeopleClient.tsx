"use client";

import React, { useState, useActionState } from "react";
import { PersonSummary } from "@/types/finance";
import { createPersonAction } from "@/app/actions/people";
import { PersonRow } from "@/components/ui/PersonRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Plus, Users, X, Check, Search } from "lucide-react";

interface PeopleClientProps {
  initialSummaries: PersonSummary[];
}

export function PeopleClient({ initialSummaries }: PeopleClientProps) {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);

  const [createState, formAction, isCreating] = useActionState(
    async (prevState: unknown, formData: FormData) => {
      const res = await createPersonAction(prevState, formData);
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
    const matchName = s.person.display_name.toLowerCase().includes(q);
    const matchAlias = s.person.aliases?.some((a) =>
      a.toLowerCase().includes(q)
    );
    return matchName || matchAlias;
  });

  return (
    <div className="space-y-4">
      {/* Top Search & Add Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search person or alias..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
          />
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-all flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Person</span>
        </button>
      </div>

      {filteredSummaries.length === 0 ? (
        <EmptyState
          icon={<Users className="w-8 h-8 text-slate-400" />}
          title="ยังไม่มีข้อมูลบุคคล"
          description="เมื่อมีรายการรับหรือจ่าย ระบบจะแสดงข้อมูลสรุปที่นี่"
          actionHref="#"
          actionLabel="+ Add New Person"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredSummaries.map((s) => (
            <PersonRow key={s.person.id} summary={s} />
          ))}
        </div>
      )}

      {/* Add Person Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-base text-slate-900">
                Add Counterparty Person
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
                  Full Name / Display Name
                </label>
                <input
                  type="text"
                  name="display_name"
                  required
                  placeholder="e.g. Somchai Jaidee, Alice Tan"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Aliases (comma separated)
                </label>
                <input
                  type="text"
                  name="aliases"
                  placeholder="e.g. สมชาย, Somchai J, น้องบอย"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Phone (Optional)
                </label>
                <input
                  type="tel"
                  name="phone"
                  placeholder="081-xxx-xxxx"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Note (Optional)
                </label>
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Relationship, PromptPay account note..."
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
                  <span>{isCreating ? "Saving..." : "Add Person"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
