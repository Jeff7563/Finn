import React from "react";
import { Skeleton, SkeletonHeader } from "@/components/ui/Skeleton";

export default function AccountsLoading() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-6">
      {/* Header */}
      <SkeletonHeader withAction />

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-5 rounded-2xl bg-surface border border-border shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Skeleton className="w-9 h-9 rounded-xl" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-4 w-12 rounded-full" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
