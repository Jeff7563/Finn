"use client";

import React, { useState } from "react";
import { restoreTransactionAction } from "@/app/actions/transactions";
import { formatMoney } from "@/lib/finance/formatters";
import { RotateCcw, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface RestoreTransactionModalProps {
  isOpen: boolean;
  transactionId: string;
  transactionDescription?: string | null;
  amount?: number;
  currency?: string;
  hasActiveReplacement?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function RestoreTransactionModal({
  isOpen,
  transactionId,
  transactionDescription,
  amount,
  currency = "THB",
  hasActiveReplacement = false,
  onClose,
  onSuccess,
}: RestoreTransactionModalProps) {
  const [reason, setReason] = useState("ยกเลิกการ Void — รายการนี้ถูกต้อง");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length > 500) {
      setError("เหตุผลต้องมีความยาวไม่เกิน 500 ตัวอักษร");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await restoreTransactionAction(transactionId, trimmed || undefined);
      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setError(res.error || "ไม่สามารถคืนรายการได้");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการคืนรายการ");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-surface dark:bg-surface-raised w-full max-w-md rounded-2xl border border-border shadow-xl overflow-hidden animate-in zoom-in-95">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2 text-income">
            <RotateCcw className="w-5 h-5" />
            <h3 className="font-semibold text-text-primary text-base">
              คืนรายการ (Restore Transaction)
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
          <div className="p-3.5 bg-income-soft border border-income/20 rounded-xl text-xs text-income-foreground space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-income">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>รายการจะกลับมามีผลทางการเงิน</span>
            </div>
            <p className="leading-relaxed text-text-secondary">
              การคืนรายการจะทำให้รายการนี้ถูกนำกลับมาคำนวณในยอดเงินคงเหลือ รายงาน และภาษีตามปกติ
              โดยใช้ข้อมูลและหลักฐานเดิมที่มีอยู่
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

          {/* Reason Input */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-text-secondary">
              เหตุผลในการคืนรายการ (Restore Reason)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุเหตุผลในการคืนรายการ..."
              className="w-full text-xs p-2.5 bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-text-muted/60"
            />
            <div className="flex justify-end text-[11px] text-text-muted">
              <span>{reason.length}/500</span>
            </div>
          </div>

          {hasActiveReplacement && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800 rounded-xl text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>ไม่สามารถคืนรายการได้</span>
              </div>
              <p className="leading-relaxed">
                ไม่สามารถคืนรายการนี้ได้ เนื่องจากมีรายการทดแทนที่กำลังใช้งานอยู่ กรุณายกเลิกรายการทดแทนก่อน
              </p>
            </div>
          )}

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
              disabled={isSubmitting || hasActiveReplacement}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover transition-colors shadow-xs disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังคืนรายการ...</span>
                </>
              ) : (
                <span>ยืนยันการคืนรายการ (Restore)</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
