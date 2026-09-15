import React from "react";
import { Skeleton, SkeletonHeader } from "@/components/ui/Skeleton";

export default function CategoriesLoading() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-6">
      {/* Header */}
      <SkeletonHeader withAction />

      {/* Categories Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {[1, 2, 3, 4, 6, 7, 8, 9].map((i) => (
          <div
            key={i}
            className="p-3.5 rounded-xl bg-surface border border-border flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-lg" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
