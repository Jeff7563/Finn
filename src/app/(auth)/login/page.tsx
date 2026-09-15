"use client";

import React, { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signInAction } from "@/app/actions/auth";
import { Lock, Mail, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";

function LoginForm() {
  const searchParams = useSearchParams();
  const resetSuccess = searchParams.get("reset") === "success";
  const sessionInvalid = searchParams.get("error") === "session_invalid";

  const [state, formAction, isPending] = useActionState(signInAction, {
    success: false,
    error: undefined,
  });

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 bg-bg py-12">
      <div className="w-full max-w-sm space-y-6 bg-surface dark:bg-surface-raised p-7 sm:p-8 rounded-2xl border border-border shadow-sm">
        {/* Header */}
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground font-extrabold text-xl mx-auto flex items-center justify-center shadow-sm">
            F
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-text-primary">
            เข้าสู่ระบบ Finn
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            Personal Finance Operating System
          </p>
        </div>

        {/* Reset Password Success Banner */}
        {resetSuccess && (
          <div
            role="status"
            className="p-3 text-xs font-medium text-income bg-income-soft border border-income/30 rounded-xl flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>เปลี่ยนรหัสผ่านเรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่</span>
          </div>
        )}

        {/* Invalid / Expired Session Banner */}
        {sessionInvalid && (
          <div
            role="alert"
            className="p-3 text-xs font-medium text-expense bg-expense-soft border border-expense/30 rounded-xl flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>เซสชันการใช้งานไม่ถูกต้องหรือหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้ง</span>
          </div>
        )}

        {/* Form */}
        <form action={formAction} className="space-y-4">
          {state.error && (
            <div
              role="alert"
              className="p-3 text-xs font-medium text-expense bg-expense-soft border border-expense/30 rounded-xl"
            >
              {state.error}
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium text-text-secondary mb-1"
            >
              อีเมล (Email address)
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-text-muted absolute left-3.5 top-3 pointer-events-none" />
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors bg-surface text-text-primary placeholder:text-text-muted/60"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="password"
                className="block text-xs font-medium text-text-secondary"
              >
                รหัสผ่าน (Password)
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-text-muted hover:text-text-primary hover:underline transition-colors"
              >
                ลืมรหัสผ่าน?
              </Link>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-text-muted absolute left-3.5 top-3 pointer-events-none" />
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors bg-surface text-text-primary placeholder:text-text-muted/60"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full mt-2 py-2.5 px-4 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover text-white text-sm font-semibold rounded-xl shadow-xs transition-all active:scale-[0.99] disabled:opacity-50"
          >
            <span>{isPending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-text-muted pt-1">
          ยังไม่มีบัญชีผู้ใช้?{" "}
          <Link
            href="/signup"
            className="font-semibold text-text-primary hover:underline"
          >
            สมัครสมาชิก
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <LoginForm />
    </Suspense>
  );
}
