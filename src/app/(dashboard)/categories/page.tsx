import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { CategoriesClient } from "@/components/categories/CategoriesClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function CategoriesPage() {
  const user = await requireUser();
  const categories = await DataStore.getCategories(user.id);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Categories"
        description="Standardized classification for income and expense cash flow."
      />

      <CategoriesClient initialCategories={categories} />
    </div>
  );
}
