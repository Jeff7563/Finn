"use client";

import React, { useTransition } from "react";
import { useRouter } from "next/navigation";
import { seedSampleDataAction } from "@/app/actions/seed";
import { Sparkles } from "lucide-react";

export function SeedSampleDataButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSeed = () => {
    startTransition(async () => {
      const res = await seedSampleDataAction();
      if (res.success) {
        router.push("/today");
      } else {
        alert(res.error || "Failed to populate sample data");
      }
    });
  };

  return (
    <button
      onClick={handleSeed}
      disabled={isPending}
      className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-sm transition-all disabled:opacity-50"
    >
      {isPending ? (
        <span>Populating...</span>
      ) : (
        <>
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Load Sample Data (Accounts, Transfers, Groceries, Salary)</span>
        </>
      )}
    </button>
  );
}
