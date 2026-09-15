import React from "react";
import { Skeleton, SkeletonHeader } from "@/components/ui/Skeleton";

export default function MerchantsLoading() {
  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-6">
      {/* Header & Tabs */}
      <SkeletonHeader withAction />

      {/* Search Bar */}
      <Skeleton className="h-10 w-full sm:w-72 rounded-xl" />

      {/* Merchant Rows */}
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="p-4 rounded-xl bg-surface border border-border flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
