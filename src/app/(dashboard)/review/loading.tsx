import React from "react";
import { Skeleton, SkeletonHeader } from "@/components/ui/Skeleton";

export default function ReviewLoading() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-6">
      {/* Header */}
      <SkeletonHeader />

      {/* Review Slips List */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-5 rounded-2xl bg-surface border border-border shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="w-12 h-12 rounded-xl" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border">
              <Skeleton className="h-8 rounded-lg" />
              <Skeleton className="h-8 rounded-lg" />
              <Skeleton className="h-8 rounded-lg" />
              <Skeleton className="h-8 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
