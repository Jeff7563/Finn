"use client";

import React, { useActionState } from "react";
import Link from "next/link";
import { signInAction, signInDemoAction } from "@/app/actions/auth";
import { Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(signInAction, {
    success: false,
    error: undefined,
  });

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="w-full max-w-sm space-y-8 bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/80 shadow-sm">
        {/* Header */}
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-white font-bold text-xl mx-auto flex items-center justify-center shadow-sm">
            F
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
            Sign In to Finn
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Deterministic Personal Finance OS
          </p>
        </div>

        {/* Form */}
        <form action={formAction} className="mt-6 space-y-4">
          {state.error && (
            <div
              role="alert"
              className="p-3 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg"
            >
              {state.error}
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Email address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-colors bg-white"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-colors bg-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full mt-2 py-2.5 px-4 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-all active:scale-[0.99] disabled:opacity-50"
          >
            {isPending ? "Signing In..." : "Sign In"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Demo Fast Login */}
        <div className="pt-2 border-t border-slate-100">
          <form action={signInDemoAction}>
            <button
              type="submit"
              className="w-full py-2 px-3 flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 transition-colors"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Explore as Demo User</span>
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-semibold text-slate-900 hover:underline"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
