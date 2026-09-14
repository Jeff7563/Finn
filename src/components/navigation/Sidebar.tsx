"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  ReceiptText,
  Landmark,
  Users2,
  Tag,
  Settings,
  LogOut,
  Plus,
  FileCheck,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { ThemeQuickToggle } from "@/components/settings/ThemeSettingsControl";

const PRIMARY_NAV = [
  { href: "/today", label: "วันนี้", icon: CalendarDays },
  { href: "/overview", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/transactions", label: "รายการ", icon: ReceiptText },
  { href: "/accounts", label: "บัญชี", icon: Landmark },
  {
    href: "/people",
    label: "คนและร้านค้า",
    icon: Users2,
    matchPaths: ["/people", "/merchants", "/contacts"],
  },
];

const SECONDARY_NAV = [
  { href: "/review", label: "รอตรวจสอบ", icon: FileCheck },
  { href: "/categories", label: "หมวดหมู่", icon: Tag },
];

export function Sidebar() {
  const pathname = usePathname();

  const isItemActive = (item: { href: string; matchPaths?: string[] }) => {
    if (item.matchPaths) {
      return item.matchPaths.some((p) => pathname.startsWith(p));
    }
    if (item.href === "/today") return pathname === "/today";
    return pathname.startsWith(item.href);
  };

  return (
    <aside className="hidden md:flex md:w-56 lg:w-60 md:flex-col md:fixed md:inset-y-0 bg-surface dark:bg-bg-subtle border-r border-border z-30 transition-colors">
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-6">
        <Link href="/today" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-xl bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground flex items-center justify-center font-bold text-sm tracking-wider shadow-sm transition-transform group-hover:scale-95">
            F
          </div>
          <span className="font-bold text-text-primary text-lg tracking-tight">
            Finn
          </span>
        </Link>
        <ThemeQuickToggle />
      </div>

      {/* Quick Fast Add Action */}
      <div className="px-4 pt-1 pb-3">
        <Link
          href="/transactions/new"
          className="flex items-center justify-center gap-2 w-full py-2 px-3.5 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:hover:bg-primary-hover text-white dark:text-primary-foreground text-xs font-semibold rounded-xl shadow-xs transition-all active:scale-[0.99]"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>เพิ่มรายการ</span>
        </Link>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 space-y-6 overflow-y-auto py-2">
        <div className="space-y-0.5">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 text-sm rounded-xl transition-colors ${
                  active
                    ? "bg-surface-soft dark:bg-surface-raised text-text-primary font-semibold shadow-2xs"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-soft font-medium"
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    active ? "text-primary dark:text-primary" : "text-text-muted"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="space-y-0.5 pt-2 border-t border-border">
          {SECONDARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 text-sm rounded-xl transition-colors ${
                  active
                    ? "bg-surface-soft dark:bg-surface-raised text-text-primary font-semibold shadow-2xs"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-soft font-medium"
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    active ? "text-primary dark:text-primary" : "text-text-muted"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer Settings & Sign Out */}
      <div className="p-3 border-t border-border space-y-1">
        <Link
          href="/settings"
          className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-xl transition-colors ${
            pathname.startsWith("/settings")
              ? "bg-surface-soft dark:bg-surface-raised text-text-primary font-semibold"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-soft font-medium"
          }`}
        >
          <Settings className="w-4 h-4 text-text-muted" />
          <span>ตั้งค่า</span>
        </Link>

        <form action={signOutAction}>
          <button
            type="submit"
            className="flex items-center gap-3 w-full px-3 py-2 text-sm font-medium text-text-muted hover:text-expense hover:bg-expense-soft rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4 text-text-muted group-hover:text-expense" />
            <span>ออกจากระบบ</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
