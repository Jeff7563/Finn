"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  ReceiptText,
  Landmark,
  Users,
  Store,
  Tag,
  Settings,
  LogOut,
  PlusCircle,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";

const NAV_ITEMS = [
  { href: "/today", label: "Today", icon: CalendarDays },
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/people", label: "People", icon: Users },
  { href: "/merchants", label: "Merchants", icon: Store },
  { href: "/categories", label: "Categories", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200/80 z-30">
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-6 border-b border-slate-100">
        <Link href="/today" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-base shadow-sm">
            F
          </div>
          <div>
            <span className="font-bold text-slate-900 text-lg tracking-tight block leading-none">
              Finn
            </span>
            <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
              Finance OS
            </span>
          </div>
        </Link>
      </div>

      {/* Quick Action Button */}
      <div className="p-4">
        <Link
          href="/transactions/new"
          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-all active:scale-[0.99]"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Add Transaction</span>
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/today" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                isActive
                  ? "bg-slate-100 text-slate-900 font-semibold"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Icon
                className={`w-4 h-4 ${
                  isActive ? "text-slate-900" : "text-slate-400"
                }`}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer / Sign Out */}
      <div className="p-4 border-t border-slate-100">
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex items-center gap-3 w-full px-3.5 py-2 text-sm font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50/50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4 text-slate-400 group-hover:text-rose-600" />
            <span>Sign Out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
