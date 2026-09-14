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
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";

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
    <aside className="hidden md:flex md:w-56 lg:w-60 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200/70 z-30">
      {/* Brand Header */}
      <div className="flex items-center h-16 px-6">
        <Link href="/today" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-xl bg-slate-950 text-white flex items-center justify-center font-bold text-sm tracking-wider shadow-sm transition-transform group-hover:scale-95">
            F
          </div>
          <span className="font-bold text-slate-900 text-lg tracking-tight">
            Finn
          </span>
        </Link>
      </div>

      {/* Quick Fast Add Action */}
      <div className="px-4 pt-1 pb-3">
        <Link
          href="/transactions/new"
          className="flex items-center justify-center gap-2 w-full py-2 px-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-sm transition-all active:scale-[0.99]"
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
                    ? "bg-slate-100/90 text-slate-950 font-semibold"
                    : "text-slate-600 hover:text-slate-950 hover:bg-slate-50 font-medium"
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${
                    active ? "text-slate-950" : "text-slate-400"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="space-y-0.5 pt-2 border-t border-slate-100">
          {SECONDARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 text-sm rounded-xl transition-colors ${
                  active
                    ? "bg-slate-100/90 text-slate-950 font-semibold"
                    : "text-slate-600 hover:text-slate-950 hover:bg-slate-50 font-medium"
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${
                    active ? "text-slate-950" : "text-slate-400"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer Settings & Sign Out */}
      <div className="p-3 border-t border-slate-100 space-y-1">
        <Link
          href="/settings"
          className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-xl transition-colors ${
            pathname.startsWith("/settings")
              ? "bg-slate-100/90 text-slate-950 font-semibold"
              : "text-slate-600 hover:text-slate-950 hover:bg-slate-50 font-medium"
          }`}
        >
          <Settings className="w-4 h-4 text-slate-400" />
          <span>ตั้งค่า</span>
        </Link>

        <form action={signOutAction}>
          <button
            type="submit"
            className="flex items-center gap-3 w-full px-3 py-2 text-sm font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50/50 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4 text-slate-400 group-hover:text-rose-600" />
            <span>ออกจากระบบ</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
