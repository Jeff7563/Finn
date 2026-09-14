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
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาร้านค้า หรือแบรนด์..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors placeholder:text-text-muted/60"
          />
        </div>

        <button
          onClick={() => setShowModal(true)}
          aria-label="Add Merchant"
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-all flex-shrink-0 active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>+ เพิ่มร้านค้า</span>
        </button>
      </div>

      {filteredSummaries.length === 0 ? (
        <EmptyState
          icon={<Store className="w-8 h-8 text-text-muted" />}
          title="ยังไม่มีข้อมูลร้านค้า"
          description="เมื่อคุณเริ่มบันทึกรายการ ร้านค้า ซูเปอร์มาร์เก็ต และผู้ให้บริการจะปรากฏที่นี่"
          onAction={() => setShowModal(true)}
          actionLabel="+ เพิ่มร้านค้า"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-surface dark:bg-surface-raised rounded-2xl p-6 max-w-md w-full shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-semibold text-base text-text-primary">
                เพิ่มร้านค้า (Add Merchant)
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-text-muted hover:text-text-primary"
                aria-label="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form action={formAction} className="space-y-3.5">
              {createState.error && (
                <div className="p-3 text-xs text-expense bg-expense-soft rounded-xl border border-expense/30">
                  {createState.error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  ชื่อร้านค้า (Merchant Name)
                </label>
                <input
                  type="text"
                  name="display_name"
                  required
                  placeholder="เช่น 7-Eleven, Grab, Lotus's, Shopee"
                  className="w-full px-3 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  คำแนะนำหมวดหมู่ (Category Hint)
                </label>
                <input
                  type="text"
                  name="category_hint"
                  placeholder="เช่น อาหาร, การเดินทาง, ค่าน้ำมัน"
                  className="w-full px-3 py-2 text-xs bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  ชื่อเรียกอื่น / แบรนด์ (Aliases, คั่นด้วยจุลภาค)
                </label>
                <input
                  type="text"
                  name="aliases"
                  placeholder="เช่น เซเว่น, CP ALL, 7-11"
                  className="w-full px-3 py-2 text-xs bg-surface border border-border text-text-primary rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  aria-label="Save Merchant"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover rounded-xl disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>{isCreating ? "กำลังบันทึก..." : "บันทึกร้านค้า"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
