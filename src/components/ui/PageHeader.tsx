import React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
  actionIcon?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  actionHref,
  actionLabel,
  actionIcon = <Plus className="w-4 h-4" />,
  children,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-text-muted mt-1 font-normal">
            {description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover rounded-xl transition-colors shadow-xs active:scale-[0.98]"
          >
            {actionIcon}
            <span>{actionLabel}</span>
          </Link>
        )}
        {children}
      </div>
    </div>
  );
}
