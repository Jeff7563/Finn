import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { CategoriesClient } from "@/components/categories/CategoriesClient";

export default async function CategoriesPage() {
  const user = await requireUser();
  const categories = await DataStore.getCategories(user.id);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-6">
      <div className="border-b border-slate-100 pb-3">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
          หมวดหมู่ <span className="text-sm font-normal text-slate-400">· Categories</span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          จัดกลุ่มรายรับและรายจ่ายเพื่อวิเคราะห์กระแสเงินสด
        </p>
      </div>

      <CategoriesClient initialCategories={categories} />
    </div>
  );
}
