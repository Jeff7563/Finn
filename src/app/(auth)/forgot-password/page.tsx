"use client";

import React, { Suspense, useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { requestPasswordResetAction } from "@/app/actions/auth";
import { Mail, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const hasCallbackError = searchParams.get("error") === "invalid_or_expired";

  const [clientError, setClientError] = useState<string | null>(null);

  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    {
      success: false,
      error: undefined,
    }
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(e.currentTarget);
    const email = (formData.get("email") as string)?.trim();
    if (!email) {
      e.preventDefault();
      setClientError("กรุณากรอกอีเมล");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      e.preventDefault();
      setClientError("กรุณากรอกอีเมลที่ถูกต้อง");
      return;
    }
    setClientError(null);
  };

  const errorMessage = clientError || state.error;

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 bg-bg py-12">
      <div className="w-full max-w-sm space-y-6 bg-surface dark:bg-surface-raised p-7 sm:p-8 rounded-2xl border border-border shadow-sm">
        {/* Header */}
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground font-extrabold text-xl mx-auto flex items-center justify-center shadow-sm">
            F
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-text-primary">
            ลืมรหัสผ่าน
          </h1>
          <p className="mt-1 text-xs text-text-muted leading-relaxed">
            กรอกอีเมลที่ใช้สมัคร Finn เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้
          </p>
        </div>

        {/* Callback Error Alert */}
        {hasCallbackError && !state.success && (
          <div
            role="alert"
            className="p-3 text-xs font-medium text-expense bg-expense-soft border border-expense/30 rounded-xl flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว</span>
          </div>
        )}

        {/* Success Response (Identical for known and unknown emails to prevent enumeration) */}
        {state.success ? (
          <div className="space-y-4">
            <div
              role="status"
              className="p-4 text-xs font-medium text-income bg-income-soft border border-income/30 rounded-xl flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-text-primary">ส่งข้อมูลเรียบร้อยแล้ว</p>
                <p className="text-text-secondary leading-relaxed">
                  หากอีเมลนี้มีบัญชี Finn เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว
                </p>
              </div>
            </div>

            <Link
              href="/login"
              className="w-full py-2.5 px-4 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover text-white text-sm font-semibold rounded-xl shadow-xs transition-all active:scale-[0.99]"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>กลับไปเข้าสู่ระบบ</span>
            </Link>
          </div>
        ) : (
          /* Password Reset Request Form */
          <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <div
                role="alert"
                className="p-3 text-xs font-medium text-expense bg-expense-soft border border-expense/30 rounded-xl"
              >
                {errorMessage}
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
                  onChange={() => clientError && setClientError(null)}
                  className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors bg-surface text-text-primary placeholder:text-text-muted/60"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full mt-2 py-2.5 px-4 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover text-white text-sm font-semibold rounded-xl shadow-xs transition-all active:scale-[0.99] disabled:opacity-50"
            >
              <span>{isPending ? "กำลังส่งลิงก์..." : "ส่งลิงก์รีเซ็ตรหัสผ่าน"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* Footer */}
        {!state.success && (
          <p className="text-center text-xs text-text-muted pt-2 border-t border-border">
            <Link
              href="/login"
              className="inline-flex items-center gap-1 font-semibold text-text-primary hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              กลับไปเข้าสู่ระบบ
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
