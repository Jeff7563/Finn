import React from "react";
import { Sidebar } from "@/components/navigation/Sidebar";
import { MobileBottomNav } from "@/components/navigation/MobileBottomNav";
import { requireUser } from "@/lib/server/auth";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-slate-50/50 flex">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:pl-56 lg:pl-60 min-w-0">
        {/* Mobile Top Header */}
        <header className="md:hidden sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-slate-200/70 px-4 h-14 flex items-center justify-between">
          <Link href="/today" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-slate-950 text-white flex items-center justify-center font-bold text-xs">
              F
            </div>
            <span className="font-bold text-slate-900 text-base tracking-tight">
              Finn
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/transactions/new"
              className="p-1.5 rounded-lg bg-slate-950 text-white hover:bg-slate-800 transition-colors"
              aria-label="New transaction"
            >
              <Plus className="w-4 h-4" />
            </Link>
            <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-semibold text-slate-700">
              {user.display_name?.charAt(0).toUpperCase() || "U"}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8 pb-28 md:pb-12 max-w-4xl lg:max-w-5xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />
    </div>
  );
}
