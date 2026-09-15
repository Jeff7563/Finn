import React from "react";
import {
  Skeleton,
  SkeletonHeader,
  SkeletonListItem,
} from "@/components/ui/Skeleton";

export default function TransactionsLoading() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-6">
      {/* Header */}
      <SkeletonHeader withAction />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <Skeleton className="h-10 w-full sm:w-36 rounded-xl" />
        <Skeleton className="h-10 w-full sm:w-32 rounded-xl" />
      </div>

      {/* Transaction List */}
      <div className="space-y-2">
        <SkeletonListItem />
        <SkeletonListItem />
        <SkeletonListItem />
        <SkeletonListItem />
        <SkeletonListItem />
        <SkeletonListItem />
      </div>
    </div>
  );
}
