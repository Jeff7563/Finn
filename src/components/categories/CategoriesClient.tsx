"use client";

import React, { useState, useActionState } from "react";
import { Category } from "@/types/finance";
import { createCategoryAction } from "@/app/actions/categories";
import { Plus, Tag, X, Check } from "lucide-react";

interface CategoriesClientProps {
  initialCategories: Category[];
}

export function CategoriesClient({
  initialCategories,
}: CategoriesClientProps) {
  const [activeTab, setActiveTab] = useState<"expense" | "income">("expense");
  const [showModal, setShowModal] = useState(false);

  const [createState, formAction, isCreating] = useActionState(
    async (prevState: unknown, formData: FormData) => {
      const res = await createCategoryAction(prevState, formData);
      if (res.success) {
        setShowModal(false);
      }
      return res;
    },
    { success: false, error: undefined }
  );

  const categories = initialCategories.filter((c) => c.type === activeTab);

  return (
    <div className="space-y-5">
      {/* Type Switcher Tabs & Add Category */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center p-1 bg-surface-soft rounded-xl border border-border">
          <button
            onClick={() => setActiveTab("expense")}
            className={`px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
              activeTab === "expense"
                ? "bg-surface text-text-primary shadow-xs border border-border/80"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            รายจ่าย (Expense)
          </button>
          <button
            onClick={() => setActiveTab("income")}
            className={`px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
              activeTab === "income"
                ? "bg-surface text-text-primary shadow-xs border border-border/80"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            รายรับ (Income)
          </button>
        </div>

        <button
          onClick={() => setShowModal(true)}
          aria-label="Add Category"
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>+ สร้างหมวดหมู่</span>
        </button>
      </div>

      {/* Grid of Categories (Restrained, Modern) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="p-3.5 bg-surface dark:bg-surface-raised rounded-xl border border-border shadow-sm flex items-center justify-between hover:border-border-strong transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  cat.type === "expense"
                    ? "bg-surface-soft border border-border text-text-secondary"
                    : "bg-income-soft text-income"
                }`}
              >
                <Tag className="w-3.5 h-3.5" />
              </div>
              <span className="font-semibold text-xs sm:text-sm text-text-primary truncate">
                {cat.name}
              </span>
            </div>

            {!cat.is_system && (
              <span className="text-[10px] font-medium text-text-muted bg-surface-soft border border-border px-1.5 py-0.5 rounded">
                กำหนดเอง
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Add Custom Category Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-surface dark:bg-surface-raised rounded-2xl p-6 max-w-md w-full shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-semibold text-base text-text-primary">
                สร้างหมวดหมู่ใหม่ (Add Category)
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
                  ประเภทหมวดหมู่ (Type)
                </label>
                <select
                  name="type"
                  defaultValue={activeTab}
                  className="w-full p-2.5 text-xs bg-surface border border-border text-text-primary rounded-xl"
                >
                  <option value="expense">รายจ่าย (Expense)</option>
                  <option value="income">รายรับ (Income)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  ชื่อหมวดหมู่ (Category Name)
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="เช่น ค่ากาแฟ, งานฟรีแลนซ์, ช้อปปิ้ง"
                  className="w-full px-3.5 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
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
                  aria-label="Add Category"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover rounded-xl disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>{isCreating ? "กำลังบันทึก..." : "สร้างหมวดหมู่"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
