import React from "react";
import {
  Skeleton,
  SkeletonHeader,
  SkeletonMetricCard,
} from "@/components/ui/Skeleton";

export default function OverviewLoading() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-6">
      {/* Header */}
      <SkeletonHeader />

      {/* Top 4 Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SkeletonMetricCard />
        <SkeletonMetricCard />
        <SkeletonMetricCard />
        <SkeletonMetricCard />
      </div>

      {/* Calendar Section Card */}
      <div className="p-6 rounded-2xl bg-surface border border-border shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>

      {/* 2-Column Section (Categories & Contacts) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-surface border border-border shadow-xs space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
        <div className="p-5 rounded-2xl bg-surface border border-border shadow-xs space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
