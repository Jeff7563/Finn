"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  ReceiptText,
  Plus,
  MoreHorizontal,
  Landmark,
  Users,
  Store,
  Tag,
  Settings,
  LogOut,
  X,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";

export function MobileBottomNav() {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);

  const isToday = pathname === "/today";
  const isTransactions =
    pathname.startsWith("/transactions") && pathname !== "/transactions/new";
  const isOverview = pathname.startsWith("/overview");
  const isMoreActive =
    pathname.startsWith("/accounts") ||
    pathname.startsWith("/people") ||
    pathname.startsWith("/merchants") ||
    pathname.startsWith("/categories") ||
    pathname.startsWith("/settings");

  return (
    <>
      {/* Mobile Drawer / Sheet for 'More' */}
      {showMore && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div
            className="fixed inset-0"
            onClick={() => setShowMore(false)}
            aria-hidden="true"
          />

          <div className="relative bg-white rounded-t-2xl p-5 shadow-2xl border-t border-slate-200 space-y-4 pb-10">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="font-semibold text-base text-slate-900">
                More Features
              </h2>
              <button
                onClick={() => setShowMore(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Link
                href="/accounts"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-800 font-medium text-sm border border-slate-200/50"
              >
                <Landmark className="w-4 h-4 text-slate-600" />
                <span>Accounts</span>
              </Link>
              <Link
                href="/people"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-800 font-medium text-sm border border-slate-200/50"
              >
                <Users className="w-4 h-4 text-slate-600" />
                <span>People</span>
              </Link>
              <Link
                href="/merchants"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-800 font-medium text-sm border border-slate-200/50"
              >
                <Store className="w-4 h-4 text-slate-600" />
                <span>Merchants</span>
              </Link>
              <Link
                href="/categories"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-800 font-medium text-sm border border-slate-200/50"
              >
                <Tag className="w-4 h-4 text-slate-600" />
                <span>Categories</span>
              </Link>
              <Link
                href="/settings"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-800 font-medium text-sm border border-slate-200/50 col-span-2"
              >
                <Settings className="w-4 h-4 text-slate-600" />
                <span>Settings</span>
              </Link>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex items-center justify-center gap-2 w-full p-2.5 rounded-xl bg-rose-50 text-rose-700 font-medium text-sm hover:bg-rose-100 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Fixed Bottom Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-slate-200/80 z-40 pb-safe"
      >
        <div className="flex items-center justify-around h-16 px-2">
          {/* Today */}
          <Link
            href="/today"
            className={`flex flex-col items-center justify-center w-14 h-full gap-1 text-[11px] font-medium transition-colors ${
              isToday ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <CalendarDays className="w-5 h-5" />
            <span>Today</span>
          </Link>

          {/* Transactions */}
          <Link
            href="/transactions"
            className={`flex flex-col items-center justify-center w-14 h-full gap-1 text-[11px] font-medium transition-colors ${
              isTransactions
                ? "text-slate-900"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <ReceiptText className="w-5 h-5" />
            <span>Ledger</span>
          </Link>

          {/* Fast Add Action Center (+) */}
          <Link
            href="/transactions/new"
            aria-label="Add transaction"
            className="flex items-center justify-center w-12 h-12 -mt-4 bg-slate-900 text-white rounded-full shadow-lg hover:bg-slate-800 transition-transform active:scale-95"
          >
            <Plus className="w-6 h-6 stroke-[2.5]" />
          </Link>

          {/* Overview */}
          <Link
            href="/overview"
            className={`flex flex-col items-center justify-center w-14 h-full gap-1 text-[11px] font-medium transition-colors ${
              isOverview
                ? "text-slate-900"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>Overview</span>
          </Link>

          {/* More */}
          <button
            onClick={() => setShowMore(true)}
            className={`flex flex-col items-center justify-center w-14 h-full gap-1 text-[11px] font-medium transition-colors ${
              isMoreActive || showMore
                ? "text-slate-900"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span>More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
