"use client";

import React, { useActionState, useState } from "react";
import Link from "next/link";
import { updatePasswordAction } from "@/app/actions/auth";
import { Lock, ArrowRight, Eye, EyeOff, ArrowLeft } from "lucide-react";

export default function ResetPasswordClient() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const [state, formAction, isPending] = useActionState(updatePasswordAction, {
    success: false,
    error: undefined,
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (!password || password.length < 6) {
      e.preventDefault();
      setClientError("รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }

    if (password !== confirmPassword) {
      e.preventDefault();
      setClientError("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
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
            ตั้งรหัสผ่านใหม่
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            กรุณากำหนดรหัสผ่านใหม่สำหรับบัญชี Finn ของคุณ
          </p>
        </div>

        {/* Form */}
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
              htmlFor="password"
              className="block text-xs font-medium text-text-secondary mb-1"
            >
              รหัสผ่านใหม่
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-text-muted absolute left-3.5 top-3 pointer-events-none" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                placeholder="อย่างน้อย 6 ตัวอักษร"
                onChange={() => clientError && setClientError(null)}
                className="w-full pl-9 pr-10 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors bg-surface text-text-primary placeholder:text-text-muted/60"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-text-muted hover:text-text-primary p-0.5 rounded focus:outline-none"
                aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-xs font-medium text-text-secondary mb-1"
            >
              ยืนยันรหัสผ่านใหม่
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-text-muted absolute left-3.5 top-3 pointer-events-none" />
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง"
                onChange={() => clientError && setClientError(null)}
                className="w-full pl-9 pr-10 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors bg-surface text-text-primary placeholder:text-text-muted/60"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-2.5 text-text-muted hover:text-text-primary p-0.5 rounded focus:outline-none"
                aria-label={
                  showConfirmPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"
                }
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full mt-2 py-2.5 px-4 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover text-white text-sm font-semibold rounded-xl shadow-xs transition-all active:scale-[0.99] disabled:opacity-50"
          >
            <span>{isPending ? "กำลังตั้งรหัสผ่านใหม่..." : "ตั้งรหัสผ่านใหม่"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-text-muted pt-2 border-t border-border">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 font-semibold text-text-primary hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            กลับไปเข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  );
}
