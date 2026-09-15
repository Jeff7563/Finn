import React from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { getAuthenticatedUser } from "@/lib/server/auth";
import ResetPasswordClient from "./ResetPasswordClient";

/**
 * Server component gate for Reset Password.
 *
 * CRITICAL SECURITY INVARIANT:
 * If opened without a valid recovery session, NEVER render the reset password form.
 * Displays "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว" with a "ขอลิงก์ใหม่" button.
 */
export default async function ResetPasswordPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 bg-bg py-12">
        <div className="w-full max-w-sm space-y-6 bg-surface dark:bg-surface-raised p-7 sm:p-8 rounded-2xl border border-border shadow-sm text-center">
          <div className="w-12 h-12 rounded-2xl bg-expense-soft text-expense mx-auto flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold tracking-tight text-text-primary">
              ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว
            </h1>
            <p className="text-xs text-text-muted leading-relaxed">
              ลิงก์ยืนยันตัวตนนี้หมดอายุแล้ว หรือไม่มีเซสชันการกู้คืนที่ถูกต้อง กรุณาส่งคำขอใหม่อีกครั้ง
            </p>
          </div>
          <Link
            href="/forgot-password"
            className="w-full py-2.5 px-4 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover text-white text-sm font-semibold rounded-xl shadow-xs transition-all active:scale-[0.99]"
          >
            ขอลิงก์ใหม่
          </Link>
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

  return <ResetPasswordClient />;
}
