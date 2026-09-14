import React from "react";
import { requireUser } from "@/lib/server/auth";
import { signOutAction } from "@/app/actions/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Shield,
  Coins,
  Globe,
  LogOut,
  Sparkles,
} from "lucide-react";
import { SeedSampleDataButton } from "@/components/settings/SeedSampleDataButton";

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your profile, currency, and system preferences."
      />

      {/* User Profile Card */}
      <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-bold text-lg text-slate-800">
            {user.display_name?.charAt(0).toUpperCase() || "U"}
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {user.display_name || "Finance User"}
            </h2>
            <p className="text-xs text-slate-500 font-mono">{user.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <Coins className="w-3.5 h-3.5" />
              Primary Currency
            </span>
            <span className="font-semibold text-slate-900 mt-1 block">
              THB (฿ Thai Baht)
            </span>
          </div>

          <div>
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <Globe className="w-3.5 h-3.5" />
              Timezone
            </span>
            <span className="font-semibold text-slate-900 mt-1 block">
              Asia/Bangkok (UTC+7)
            </span>
          </div>
        </div>
      </div>

      {/* Demo & Test Environment Tools */}
      <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-slate-800">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold text-sm">Development & Demo Tools</h3>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Populate realistic sample accounts, transfers, salary income, and daily expenses to test calculations across Today, Overview, and Ledger screens.
        </p>
        <div className="pt-2">
          <SeedSampleDataButton />
        </div>
      </div>

      {/* Security & Sessions */}
      <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-slate-800">
          <Shield className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-sm">Security & Access</h3>
        </div>
        <p className="text-xs text-slate-500">
          All financial records are encrypted and protected by Supabase Row Level Security.
        </p>

        <form action={signOutAction} className="pt-2">
          <button
            type="submit"
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-xl transition-colors w-full sm:w-auto"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out Current Session</span>
          </button>
        </form>
      </div>
    </div>
  );
}
