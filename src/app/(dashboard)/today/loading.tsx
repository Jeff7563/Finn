import React from "react";
import {
  Skeleton,
  SkeletonHeader,
  SkeletonMetricCard,
  SkeletonListItem,
} from "@/components/ui/Skeleton";

export default function TodayLoading() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-6">
      {/* Header Greeting & Date */}
      <SkeletonHeader />

      {/* Hero Balance Card */}
      <div className="p-6 rounded-2xl bg-surface border border-border shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-16 rounded-md" />
        </div>
        <Skeleton className="h-10 w-48 sm:w-64" />
        <div className="pt-2 border-t border-border flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      {/* Month Summary 3-Column Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SkeletonMetricCard />
        <SkeletonMetricCard />
        <SkeletonMetricCard />
      </div>

      {/* Recent Transactions Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="space-y-2">
          <SkeletonListItem />
          <SkeletonListItem />
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      </div>
    </div>
  );
}
