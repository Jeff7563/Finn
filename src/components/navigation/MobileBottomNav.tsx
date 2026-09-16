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
  Users2,
  Tag,
  Settings,
  LogOut,
  X,
  FileCheck,
  Inbox,
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
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/accounts") ||
    pathname.startsWith("/people") ||
    pathname.startsWith("/merchants") ||
    pathname.startsWith("/contacts") ||
    pathname.startsWith("/categories") ||
    pathname.startsWith("/review") ||
    pathname.startsWith("/settings");

  return (
    <>
      {/* Mobile Drawer / Sheet for 'More' */}
      {showMore && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div
            className="fixed inset-0"
            onClick={() => setShowMore(false)}
            aria-hidden="true"
          />

          <div className="relative bg-surface rounded-t-2xl p-5 shadow-2xl border-t border-border space-y-4 pb-safe">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="font-semibold text-sm text-text-primary">
                เพิ่มเติม
              </h2>
              <button
                onClick={() => setShowMore(false)}
                className="p-1.5 text-text-muted hover:text-text-primary rounded-full hover:bg-surface-soft transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Link
                href="/accounts"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-soft hover:bg-surface-muted text-text-primary font-medium text-sm border border-border transition-colors min-h-[44px]"
              >
                <Landmark className="w-4 h-4 text-text-secondary" />
                <span>บัญชี</span>
              </Link>
              <Link
                href="/people"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-soft hover:bg-surface-muted text-text-primary font-medium text-sm border border-border transition-colors min-h-[44px]"
              >
                <Users2 className="w-4 h-4 text-text-secondary" />
                <span>คนและร้านค้า</span>
              </Link>
              <Link
                href="/categories"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-soft hover:bg-surface-muted text-text-primary font-medium text-sm border border-border transition-colors min-h-[44px]"
              >
                <Tag className="w-4 h-4 text-text-secondary" />
                <span>หมวดหมู่</span>
              </Link>
              <Link
                href="/inbox"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-soft hover:bg-surface-muted text-text-primary font-medium text-sm border border-border transition-colors min-h-[44px]"
              >
                <Inbox className="w-4 h-4 text-text-secondary" />
                <span>กล่องข้อความ</span>
              </Link>
              <Link
                href="/review"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-soft hover:bg-surface-muted text-text-primary font-medium text-sm border border-border transition-colors min-h-[44px]"
              >
                <FileCheck className="w-4 h-4 text-text-secondary" />
                <span>รอตรวจสอบ</span>
              </Link>
              <Link
                href="/settings"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-soft hover:bg-surface-muted text-text-primary font-medium text-sm border border-border transition-colors min-h-[44px]"
              >
                <Settings className="w-4 h-4 text-text-secondary" />
                <span>ตั้งค่า</span>
              </Link>
            </div>

            <div className="pt-2 border-t border-border">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex items-center justify-center gap-2 w-full p-2.5 rounded-xl bg-expense-soft text-expense font-medium text-sm hover:opacity-90 transition-opacity min-h-[44px]"
                >
                  <LogOut className="w-4 h-4" />
                  <span>ออกจากระบบ</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Fixed Bottom Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 bg-surface/95 backdrop-blur-md border-t border-border z-40 pb-safe transition-colors"
      >
        <div className="flex items-center justify-around h-16 px-2">
          {/* วันนี้ */}
          <Link
            href="/today"
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-1 text-[11px] font-medium transition-colors ${
              isToday
                ? "text-primary dark:text-primary font-semibold"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <CalendarDays className="w-5 h-5" />
            <span>วันนี้</span>
          </Link>

          {/* รายการ */}
          <Link
            href="/transactions"
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-1 text-[11px] font-medium transition-colors ${
              isTransactions
                ? "text-primary dark:text-primary font-semibold"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <ReceiptText className="w-5 h-5" />
            <span>รายการ</span>
          </Link>

          {/* Center Action (+) */}
          <Link
            href="/transactions/new"
            aria-label="Add transaction"
            className="flex items-center justify-center w-12 h-12 -mt-4 bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground rounded-full shadow-md hover:bg-slate-800 dark:hover:bg-primary-hover transition-transform active:scale-95"
          >
            <Plus className="w-6 h-6 stroke-[2.5]" />
          </Link>

          {/* ภาพรวม */}
          <Link
            href="/overview"
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-1 text-[11px] font-medium transition-colors ${
              isOverview
                ? "text-primary dark:text-primary font-semibold"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>ภาพรวม</span>
          </Link>

          {/* เพิ่มเติม */}
          <button
            onClick={() => setShowMore(true)}
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-1 text-[11px] font-medium transition-colors ${
              isMoreActive || showMore
                ? "text-primary dark:text-primary font-semibold"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span>เพิ่มเติม</span>
          </button>
        </div>
      </nav>
    </>
  );
}
