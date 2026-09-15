import React from "react";
import { Skeleton, SkeletonHeader } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-6">
      {/* Header */}
      <SkeletonHeader />

      {/* Card 1: Appearance */}
      <div className="p-6 rounded-2xl bg-surface border border-border shadow-xs space-y-4">
        <Skeleton className="h-5 w-36" />
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-9 w-32 rounded-xl" />
        </div>
      </div>

      {/* Card 2: Automation */}
      <div className="p-6 rounded-2xl bg-surface border border-border shadow-xs space-y-4">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>

      {/* Card 3: Profile */}
      <div className="p-6 rounded-2xl bg-surface border border-border shadow-xs space-y-4">
        <Skeleton className="h-5 w-32" />
        <div className="flex items-center gap-3">
          <Skeleton className="w-12 h-12 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
      </div>
    </div>
  );
}
