"use client";

import React, { useState } from "react";
import { voidTransactionAction } from "@/app/actions/transactions";
import { formatMoney } from "@/lib/finance/formatters";
import { AlertTriangle, X, Loader2, Ban } from "lucide-react";

interface VoidTransactionModalProps {
  isOpen: boolean;
  transactionId: string;
  transactionDescription?: string | null;
  amount?: number;
  currency?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const COMMON_REASONS = [
  "รายการทดสอบ",
  "บันทึกผิดประเภท",
  "เลือกบัญชีผิด",
  "รายการถูกยกเลิกจริง",
  "อื่น ๆ",
];

export function VoidTransactionModal({
  isOpen,
  transactionId,
  transactionDescription,
  amount,
  currency = "THB",
  onClose,
  onSuccess,
}: VoidTransactionModalProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("กรุณาระบุเหตุผลในการยกเลิกรายการ");
      return;
    }
    if (trimmed.length > 500) {
      setError("เหตุผลต้องมีความยาวไม่เกิน 500 ตัวอักษร");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await voidTransactionAction(transactionId, trimmed);
      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setError(res.error || "ไม่สามารถยกเลิกรายการได้");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการยกเลิกรายการ");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-surface dark:bg-surface-raised w-full max-w-md rounded-2xl border border-border shadow-xl overflow-hidden animate-in zoom-in-95">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <Ban className="w-5 h-5" />
            <h3 className="font-semibold text-text-primary text-base">
              ยกเลิกรายการ (Void Transaction)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-soft transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-800 dark:text-rose-200 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>รายการจะไม่ถูกลบออกจากฐานข้อมูล</span>
            </div>
            <p className="leading-relaxed">
              รายการที่ถูกยกเลิก (Voided) จะไม่ถูกนำไปคำนวณในยอดเงินคงเหลือและรายงานทุกชนิด
              แต่หลักฐานและสลิปยังคงถูกเก็บไว้เพื่อตรวจสอบย้อนหลัง
            </p>
          </div>

          {(transactionDescription || amount !== undefined) && (
            <div className="p-3 bg-surface-soft border border-border rounded-xl text-xs text-text-secondary flex items-center justify-between">
              <span className="truncate pr-2 font-medium">
                {transactionDescription || "รายการ"}
              </span>
              {amount !== undefined && (
                <span className="font-bold text-text-primary flex-shrink-0">
                  {formatMoney(amount, currency)}
                </span>
              )}
            </div>
          )}

          {/* Quick Reasons */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-secondary">
              เลือกเหตุผลด่วน:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    if (r === "อื่น ๆ") {
                      setReason("");
                    } else {
                      setReason(r);
                    }
                  }}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    reason === r
                      ? "bg-slate-900 text-white dark:bg-primary dark:text-primary-foreground border-transparent font-medium"
                      : "bg-surface text-text-secondary border-border hover:bg-surface-soft"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Reason Textarea */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-text-secondary">
              เหตุผลในการยกเลิก <span className="text-rose-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุเหตุผลในการยกเลิกรายการ เช่น รายการทดสอบ, ลูกค้าโอนซ้ำ..."
              className="w-full text-xs p-2.5 bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 placeholder:text-text-muted/60"
            />
            <div className="flex justify-between text-[11px] text-text-muted">
              <span>จำเป็นต้องระบุเหตุผล</span>
              <span>{reason.length}/500</span>
            </div>
          </div>

          {error && (
            <div className="p-2.5 bg-expense-soft text-expense rounded-lg text-xs font-medium border border-expense/20">
              {error}
            </div>
          )}

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-text-secondary hover:bg-surface-soft border border-border transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl text-white bg-rose-600 hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600 transition-colors shadow-xs disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังยกเลิก...</span>
                </>
              ) : (
                <span>ยืนยันการยกเลิกรายการ (Void)</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
