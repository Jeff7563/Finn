"use client";

import React, { useState, useRef } from "react";
import { Account } from "@/types/finance";
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  X,
  Loader2,
  Building2,
} from "lucide-react";
import { importStatementCsvAction, ImportStatementCsvResult } from "@/app/actions/inbox";

export interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onSuccess: (result: ImportStatementCsvResult) => void;
}

type ModalState =
  | "idle"
  | "uploading"
  | "success"
  | "duplicate"
  | "validation_error"
  | "import_failure";

export function CsvImportModal({
  isOpen,
  onClose,
  accounts,
  onSuccess,
}: CsvImportModalProps) {
  const [modalState, setModalState] = useState<ModalState>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const activeAccounts = accounts.filter((a) => a.active !== false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    activeAccounts[0]?.id || ""
  );
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [resultData, setResultData] = useState<ImportStatementCsvResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleReset = () => {
    setModalState("idle");
    setErrorMessage("");
    setResultData(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrorMessage("รองรับเฉพาะไฟล์นามสกุล .csv เท่านั้น (Only .csv files supported)");
      setModalState("validation_error");
      setSelectedFile(null);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("ขนาดไฟล์เกินกำหนด (สูงสุดไม่เกิน 5 MB)");
      setModalState("validation_error");
      setSelectedFile(null);
      return;
    }

    if (file.size === 0) {
      setErrorMessage("ไฟล์ที่เลือกว่างเปล่า (0 bytes)");
      setModalState("validation_error");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setErrorMessage("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFile) {
      setErrorMessage("กรุณาเลือกไฟล์ Statement CSV");
      setModalState("validation_error");
      return;
    }

    if (!selectedAccountId) {
      setErrorMessage("กรุณาเลือกบัญชี Finn ที่สเตตเมนต์นี้สังกัด");
      setModalState("validation_error");
      return;
    }

    setModalState("uploading");
    setErrorMessage("");

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("accountId", selectedAccountId);

    try {
      const res = await importStatementCsvAction(formData);
      setResultData(res);

      if (res.status === "success") {
        setModalState("success");
      } else if (res.status === "duplicate") {
        setModalState("duplicate");
      } else if (res.status === "validation_error") {
        setErrorMessage(res.error || "ข้อมูลไม่ถูกต้อง");
        setModalState("validation_error");
      } else {
        setErrorMessage(res.error || "เกิดข้อผิดพลาดในการนำเข้าไฟล์");
        setModalState("import_failure");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "การนำเข้าล้มเหลว";
      setErrorMessage(msg);
      setModalState("import_failure");
    }
  };

  const handleViewImported = () => {
    if (resultData) {
      onSuccess(resultData);
    }
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface rounded-2xl border border-border max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary">
                นำเข้า Statement CSV
              </h2>
              <p className="text-xs text-text-muted">
                Import Bank Statement CSV into Inbox
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-surface-soft transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {/* State: Uploading */}
          {modalState === "uploading" && (
            <div className="py-10 text-center space-y-4">
              <Loader2 className="w-10 h-10 mx-auto animate-spin text-emerald-600" />
              <div>
                <p className="font-semibold text-text-primary text-sm">
                  กำลังตรวจสอบและนำเข้าข้อมูล...
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  คำนวณ Original-Byte Hash, แยกวิเคราะห์รายการ และตรวจสอบความซ้ำซ้อน
                </p>
              </div>
            </div>
          )}

          {/* State: Success */}
          {modalState === "success" && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-text-primary">
                  นำเข้า Statement สำเร็จ
                </h3>
                <p className="text-xs text-text-secondary max-w-sm mx-auto">
                  {resultData?.message || "รายการทั้งหมดถูกนำเข้าสู่ Inbox เรียบร้อยแล้ว"}
                </p>
              </div>

              {resultData && (
                <div className="grid grid-cols-3 gap-2 p-3 bg-surface-soft rounded-xl border border-border text-xs">
                  <div className="space-y-0.5">
                    <span className="text-text-muted block text-[11px]">ทั้งหมด</span>
                    <span className="font-bold text-text-primary text-sm">
                      {resultData.totalItems || 0}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-text-muted block text-[11px]">สมบูรณ์</span>
                    <span className="font-bold text-emerald-600 text-sm">
                      {resultData.successCount || 0}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-text-muted block text-[11px]">รอตรวจสอบ</span>
                    <span className="font-bold text-amber-600 text-sm">
                      {resultData.errorCount || 0}
                    </span>
                  </div>
                </div>
              )}

              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-left text-xs text-blue-700 dark:text-blue-300">
                <span className="font-semibold">ความปลอดภัยทางการเงิน: </span>
                รายการถูกนำเข้าเป็นหลักฐานรอตรวจสอบใน Inbox เท่านั้น ระบบยังไม่ได้สร้างหรือตัดยอดธุรกรรมทางการเงินใดๆ
              </div>

              <div className="pt-2 flex justify-center">
                <button
                  onClick={handleViewImported}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow transition-colors"
                >
                  ดูรายการในกล่องข้อความ (Inbox)
                </button>
              </div>
            </div>
          )}

          {/* State: Duplicate File */}
          {modalState === "duplicate" && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-text-primary">
                  ไฟล์นี้เคยถูกนำเข้าแล้ว (Duplicate File)
                </h3>
                <p className="text-xs text-text-secondary max-w-sm mx-auto">
                  {resultData?.message || resultData?.error || "ตรวจพบไฟล์ที่มีเนื้อหาและค่า Hash ตรงกันในระบบ"}
                </p>
              </div>

              {resultData?.existingDocumentId && (
                <div className="p-3 bg-surface-soft rounded-xl border border-border text-xs text-left space-y-1">
                  <span className="text-text-muted block text-[11px]">รหัสเอกสารเดิมในระบบ:</span>
                  <span className="font-mono text-text-primary block break-all text-[11px]">
                    {resultData.existingDocumentId}
                  </span>
                </div>
              )}

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-left text-xs text-amber-700 dark:text-amber-300">
                <span className="font-semibold">การป้องกันรายการซ้ำ (Idempotency): </span>
                ระบบจะไม่สร้างเอกสารหรือรายการที่ซ้ำกันซ้อน เพื่อรักษาความถูกต้องของข้อมูล
              </div>

              <div className="pt-2 flex justify-center gap-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-xl bg-surface-soft hover:bg-surface-soft/80 text-text-primary text-xs font-semibold transition-colors"
                >
                  เลือกไฟล์อื่น
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold transition-colors"
                >
                  ปิด
                </button>
              </div>
            </div>
          )}

          {/* State: Validation Error / Import Failure */}
          {(modalState === "validation_error" || modalState === "import_failure") && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-text-primary">
                  {modalState === "validation_error"
                    ? "ข้อมูลไม่ถูกต้อง (Validation Error)"
                    : "การนำเข้าล้มเหลว (Import Failed)"}
                </h3>
                <p className="text-xs text-red-600 max-w-sm mx-auto">
                  {errorMessage || "เกิดข้อผิดพลาดในการตรวจสอบไฟล์หรือการนำเข้า"}
                </p>
              </div>

              <div className="pt-2 flex justify-center">
                <button
                  onClick={() => setModalState("idle")}
                  className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold transition-colors"
                >
                  กลับไปแก้ไขข้อมูล
                </button>
              </div>
            </div>
          )}

          {/* State: Idle (Form) */}
          {modalState === "idle" && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Account Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-primary" />
                  บัญชี Finn ที่สเตตเมนต์นี้สังกัด (Statement Account)
                  <span className="text-red-500">*</span>
                </label>
                {activeAccounts.length === 0 ? (
                  <p className="text-xs text-red-500">
                    ไม่พบบัญชีที่พร้อมใช้งาน กรุณาสร้างบัญชีก่อนนำเข้า Statement
                  </p>
                ) : (
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full bg-surface-soft border border-border rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    {activeAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.institution || "ไม่ระบุสถาบัน"})
                        {acc.masked_number ? ` - ${acc.masked_number}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-text-muted">
                  ใช้เป็นบริบทและหลักฐานในการจำแนกรายการ ไม่มีการตัดยอดเงินอัตโนมัติ
                </p>
              </div>

              {/* File Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  เลือกไฟล์ Statement CSV
                  <span className="text-red-500">*</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border hover:border-emerald-500/60 rounded-xl p-5 text-center cursor-pointer transition-colors bg-surface-soft/50 hover:bg-surface-soft"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,application/vnd.ms-excel"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2 text-text-primary font-medium text-xs">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="truncate max-w-[220px]">{selectedFile.name}</span>
                      <span className="text-text-muted text-[11px]">
                        ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-6 h-6 mx-auto text-text-muted" />
                      <p className="text-xs text-text-secondary font-medium">
                        คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่
                      </p>
                      <p className="text-[10px] text-text-muted">
                        รองรับ .csv ขนาดไม่เกิน 5 MB (ไม่เกิน 10,000 แถว)
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Safety notice banner */}
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-[11px] text-emerald-800 dark:text-emerald-300">
                <span className="font-semibold">ข้อตกลงความปลอดภัย: </span>
                การนำเข้าไฟล์จะไม่สร้างหรือตัดยอดธุรกรรมทางการเงินโดยอัตโนมัติ ทุกแถวจะเข้าสู่ Inbox เพื่อรอการตรวจสอบและยืนยันจากคุณ
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 rounded-xl bg-surface-soft hover:bg-surface-soft/80 text-text-secondary text-xs font-semibold transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={!selectedFile || !selectedAccountId}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
                >
                  <Upload className="w-4 h-4" />
                  <span>นำเข้าข้อมูล (Import)</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
