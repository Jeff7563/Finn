/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  FileImage,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Copy,
} from "lucide-react";
import { IngestApiResponse } from "@/types/slip";

interface SlipUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SlipUploadModal({
  isOpen,
  onClose,
  onSuccess,
}: SlipUploadModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<string>("");
  const [result, setResult] = useState<IngestApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError("ไฟล์มีขนาดเกิน 10 MB กรุณาเลือกไฟล์ใหม่");
      return;
    }

    setError(null);
    setResult(null);
    setSelectedFile(file);

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);
    setUploadStep("กำลังอัปโหลดสลิป...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("source", "web_upload");

      setUploadStep("กำลังอ่านและวิเคราะห์ข้อมูลสลิป...");

      const res = await fetch("/api/ingest/slip", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as IngestApiResponse & { error?: string };

      if (!res.ok) {
        throw new Error(data.error || "ไม่สามารถประมวลผลสลิปได้");
      }

      setResult(data);
      router.refresh();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการอัปโหลด");
    } finally {
      setIsUploading(false);
      setUploadStep("");
    }
  };

  const resetState = () => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
      <div
        className="fixed inset-0"
        onClick={resetState}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-lg bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-2xl overflow-hidden z-10 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border">
          <div className="flex items-center gap-2 font-semibold text-base text-text-primary">
            <UploadCloud className="w-5 h-5 text-primary" />
            <span>อัปโหลดสลิปธนาคาร</span>
          </div>
          <button
            onClick={resetState}
            className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-soft transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {/* Success / Result View */}
          {result ? (
            <div className="space-y-4 text-center py-4 animate-in fade-in">
              {result.status === "created" && (
                <div className="space-y-2">
                  <div className="w-12 h-12 bg-income-soft text-income rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-semibold text-text-primary">
                    บันทึกรายการสำเร็จแล้ว!
                  </h3>
                  <p className="text-text-secondary text-sm">
                    บันทึกรายการจำนวน <strong>฿{result.amount?.toLocaleString()}</strong> เรียบร้อยแล้ว
                  </p>
                </div>
              )}

              {result.status === "needs_review" && (
                <div className="space-y-2">
                  <div className="w-12 h-12 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto">
                    <Clock className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-semibold text-text-primary">
                    ส่งรายการไปยังกล่องรอตรวจสอบ
                  </h3>
                  <p className="text-text-secondary text-xs">
                    รายการนี้ต้องการการตรวจสอบเพิ่มเติม (เช่น บัญชีหรือทิศทางการเงิน)
                  </p>
                </div>
              )}

              {result.status === "duplicate" && (
                <div className="space-y-2">
                  <div className="w-12 h-12 bg-surface-soft text-text-muted rounded-full flex items-center justify-center mx-auto">
                    <Copy className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-semibold text-text-primary">
                    สลิปนี้เคยถูกบันทึกแล้ว
                  </h3>
                  <p className="text-text-secondary text-xs">
                    ระบบป้องกันการบันทึกรายการซ้ำจากสลิปเดิม
                  </p>
                </div>
              )}

              <div className="flex items-center justify-center gap-2 pt-2">
                {result.reviewUrl && (
                  <button
                    onClick={() => {
                      resetState();
                      router.push(result.reviewUrl!);
                    }}
                    className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-xl text-xs shadow-xs"
                  >
                    เปิดตรวจสอบรายการ
                  </button>
                )}
                <button
                  onClick={resetState}
                  className="px-4 py-2 bg-surface-soft border border-border text-text-primary font-semibold rounded-xl text-xs hover:bg-surface-muted transition-colors"
                >
                  เสร็จสิ้น
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* File Dropzone / Picker */}
              {!selectedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border hover:border-primary/50 bg-surface-soft/50 hover:bg-surface-soft rounded-2xl p-8 text-center cursor-pointer transition-colors space-y-3"
                >
                  <div className="w-12 h-12 bg-surface rounded-full flex items-center justify-center mx-auto border border-border shadow-2xs">
                    <FileImage className="w-6 h-6 text-text-muted" />
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary text-sm">
                      คลิกเพื่อเลือกไฟล์สลิป หรือลากไฟล์มาวางที่นี่
                    </p>
                    <p className="text-text-muted text-xs mt-1">
                      รองรับไฟล์ภาพ JPEG, PNG, WebP ขนาดไม่เกิน 10 MB
                    </p>
                  </div>
                </div>
              ) : (
                /* Selected File Preview */
                <div className="space-y-3">
                  <div className="relative max-h-64 rounded-xl overflow-hidden border border-border bg-slate-950 flex items-center justify-center">
                    {previewUrl && (
                      <img
                        src={previewUrl}
                        alt="Slip preview"
                        className="max-h-64 object-contain"
                      />
                    )}
                    <button
                      onClick={() => {
                        setSelectedFile(null);
                        setPreviewUrl(null);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-slate-900/80 text-white rounded-full hover:bg-slate-900 transition-colors"
                      title="เลือกภาพใหม่"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-muted px-1">
                    <span className="truncate max-w-[240px] font-medium text-text-primary">
                      {selectedFile.name}
                    </span>
                    <span>{(selectedFile.size / 1024).toFixed(0)} KB</span>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />

              {/* Error Alert */}
              {error && (
                <div className="p-3 bg-expense-soft text-expense border border-expense/30 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Upload Actions */}
              {selectedFile && !result && (
                <div className="pt-2">
                  <button
                    onClick={handleUpload}
                    disabled={isUploading}
                    className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:hover:bg-primary-hover text-white dark:text-primary-foreground font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition-transform active:scale-[0.99] disabled:opacity-50"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{uploadStep || "กำลังประมวลผล..."}</span>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-4 h-4" />
                        <span>เริ่มอ่านและประมวลผลสลิป</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
