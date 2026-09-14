import React from "react";
import Link from "next/link";
import { FolderOpen } from "lucide-react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = <FolderOpen className="w-6 h-6 text-slate-400" />,
  title,
  description,
  actionHref,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-xs text-slate-500 max-w-xs mb-4 leading-relaxed">
        {description}
      </p>
      {actionLabel && (
        actionHref ? (
          <Link
            href={actionHref}
            className="inline-flex items-center justify-center px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
          >
            {actionLabel}
          </Link>
        ) : onAction ? (
          <button
            onClick={onAction}
            className="inline-flex items-center justify-center px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
          >
            {actionLabel}
          </button>
        ) : null
      )}
    </div>
  );
}
