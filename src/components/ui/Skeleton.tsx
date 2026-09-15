import React from "react";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className = "", ...props }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-surface-muted/70 dark:bg-surface-soft/70 ${className}`}
      {...props}
    />
  );
}

export function SkeletonHeader({
  withAction = false,
}: {
  withAction?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-36 sm:w-48" />
        <Skeleton className="h-3.5 w-48 sm:w-64" />
      </div>
      {withAction && <Skeleton className="h-9 w-24 rounded-xl" />}
    </div>
  );
}

export function SkeletonMetricCard() {
  return (
    <div className="p-5 rounded-2xl bg-surface border border-border shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-5 w-5 rounded-md" />
      </div>
      <Skeleton className="h-7 w-36" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

export function SkeletonListItem() {
  return (
    <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/60 bg-surface/50">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="space-y-1.5 text-right">
        <Skeleton className="h-4 w-20 ml-auto" />
        <Skeleton className="h-3 w-14 ml-auto" />
      </div>
    </div>
  );
}
