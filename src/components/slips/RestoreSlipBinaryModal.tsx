"use client";

import React, { useState } from "react";
import { X, Upload, ShieldCheck, AlertCircle, Loader2 } from "lucide-react";
import { restoreMissingSlipBinaryAction } from "@/app/actions/storage";

interface RestoreSlipBinaryModalProps {
  isOpen: boolean;
  slipId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function RestoreSlipBinaryModal({
  isOpen,
  slipId,
  onClose,
  onSuccess,
}: RestoreSlipBinaryModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMessage("กรุณาเลือกไฟล์สลิปต้นฉบับ");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await restoreMissingSlipBinaryAction(slipId, formData);
      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setErrorMessage(res.error || "เกิดข้อผิดพลาดในการกู้คืนไฟล์");
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative max-w-md w-full bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-2xl p-5 z-10 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-semibold text-sm text-text-primary">
              กู้คืนไฟล์หลักฐานเดิม
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary rounded-md hover:bg-surface-soft transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Informational Guidance */}
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>ตรวจความถูกต้องด้วย SHA-256</span>
          </div>
          <p className="text-amber-700 dark:text-amber-400/90 leading-relaxed">
            กรุณาเลือกไฟล์สลิปต้นฉบับใบเดิม ระบบจะตรวจ SHA-256
            และจะไม่ยอมรับไฟล์อื่นแทนหลักฐานเดิม
          </p>
        </div>

        {/* Error Feedback */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 rounded-xl text-xs whitespace-pre-line flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              เลือกไฟล์สลิปต้นฉบับ (JPEG, PNG, WebP, PDF)
            </label>
            <div className="border-2 border-dashed border-border hover:border-slate-400 dark:hover:border-slate-600 rounded-xl p-4 text-center cursor-pointer transition-colors bg-surface-soft">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleFileChange}
                disabled={isSubmitting}
                className="hidden"
                id="restore-file-input"
              />
              <label
                htmlFor="restore-file-input"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="w-6 h-6 text-text-muted" />
                <span className="text-xs font-medium text-text-primary">
                  {selectedFile ? selectedFile.name : "คลิกเพื่อเลือกไฟล์ต้นฉบับ"}
                </span>
                {selectedFile && (
                  <span className="text-[11px] text-text-muted">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </span>
                )}
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary rounded-xl transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={!selectedFile || isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover rounded-xl disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังตรวจสอบและกู้คืน...</span>
                </>
              ) : (
                <span>กู้คืนไฟล์ต้นฉบับ</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
