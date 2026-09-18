"use client";

import React, { useState } from "react";
import {
  HardDrive,
  Shield,
  Pin,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Info,
} from "lucide-react";
import {
  StorageRetentionSettings,
  StorageBinaryEvent,
} from "@/types/storage";
import {
  UnifiedCleanupCandidate,
  UnifiedCleanupDryRunResult,
  StorageUsageSummary,
} from "@/lib/storage/retention";
import {
  updateRetentionSettingsAction,
  getCleanupDryRunAction,
  pruneEvidenceBinaryAction,
  bulkPruneAction,
  toggleEvidencePinAction,
  getStorageAuditEventsAction,
} from "@/app/actions/storage";

interface StorageRetentionSettingsClientProps {
  initialSettings: StorageRetentionSettings;
  initialSummary: StorageUsageSummary;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function StorageRetentionSettingsClient({
  initialSettings,
  initialSummary,
}: StorageRetentionSettingsClientProps) {
  const [settings, setSettings] = useState<StorageRetentionSettings>(initialSettings);
  const [summary, setSummary] = useState<StorageUsageSummary>(initialSummary);

  // Form states
  const [slipDays, setSlipDays] = useState(settings.slip_retention_days);
  const [sourceDocDays, setSourceDocDays] = useState(settings.source_document_retention_days);
  const [failedDays, setFailedDays] = useState(settings.failed_retention_days);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Dry-run states
  const [dryRunResult, setDryRunResult] = useState<UnifiedCleanupDryRunResult | null>(null);
  const [isLoadingDryRun, setIsLoadingDryRun] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  // Bulk prune states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isPruning, setIsPruning] = useState(false);
  const [pruneProgress, setPruneProgress] = useState<string | null>(null);

  // Audit events states
  const [auditEvents, setAuditEvents] = useState<StorageBinaryEvent[]>([]);
  const [showAuditEvents, setShowAuditEvents] = useState(false);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Action status message
  const [actionNotice, setActionNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSettingsMessage(null);

    // Client-side validation matching server/DB constraints
    if (slipDays < 7 || slipDays > 3650) {
      setValidationError("ระยะเวลาเก็บรักษาสลิปต้องอยู่ระหว่าง 7 ถึง 3,650 วัน");
      return;
    }
    if (sourceDocDays < 7 || sourceDocDays > 3650) {
      setValidationError("ระยะเวลาเก็บรักษาเอกสารนำเข้าต้องอยู่ระหว่าง 7 ถึง 3,650 วัน");
      return;
    }
    if (failedDays < 1 || failedDays > 365) {
      setValidationError("ระยะเวลาเก็บรักษาไฟล์ที่ล้มเหลวต้องอยู่ระหว่าง 1 ถึง 365 วัน");
      return;
    }

    setIsSavingSettings(true);
    try {
      const res = await updateRetentionSettingsAction({
        slip_retention_days: slipDays,
        source_document_retention_days: sourceDocDays,
        failed_retention_days: failedDays,
      });
      if (res.success && res.settings) {
        setSettings(res.settings);
        setSettingsMessage("บันทึกนโยบายการเก็บรักษาข้อมูลสำเร็จ");
        setTimeout(() => setSettingsMessage(null), 3500);
      } else {
        setSettingsMessage(res.error || "ไม่สามารถบันทึกการตั้งค่าได้");
      }
    } catch {
      setSettingsMessage("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleRunDryRun = async () => {
    setIsLoadingDryRun(true);
    setDryRunError(null);
    try {
      const res = await getCleanupDryRunAction();
      if (res.success && res.dryRun && res.usageSummary) {
        setDryRunResult(res.dryRun);
        setSummary(res.usageSummary);
      } else {
        setDryRunError(res.error || "เกิดข้อผิดพลาดในการประเมินผล");
      }
    } catch {
      setDryRunError("ไม่สามารถเรียกดูรายการที่ครบกำหนดได้");
    } finally {
      setIsLoadingDryRun(false);
    }
  };

  const handleTogglePin = async (candidate: UnifiedCleanupCandidate) => {
    try {
      const nextPin = !candidate.isPinned;
      const res = await toggleEvidencePinAction(candidate.id, candidate.kind, nextPin);
      if (res.success) {
        setActionNotice({
          type: "success",
          message: nextPin ? "ปักหมุดหลักฐานสำเร็จ (ได้รับการยกเว้นจากการลบ)" : "ยกเลิกการปักหมุดหลักฐานสำเร็จ",
        });
        setTimeout(() => setActionNotice(null), 3000);
        // Refresh dry run candidates
        await handleRunDryRun();
      } else {
        setActionNotice({ type: "error", message: res.error || "เกิดข้อผิดพลาด" });
      }
    } catch {
      setActionNotice({ type: "error", message: "ไม่สามารถเปลี่ยนสถานะการปักหมุดได้" });
    }
  };

  const handleSinglePrune = async (candidate: UnifiedCleanupCandidate) => {
    if (!confirm(`ยืนยันการลบไฟล์ต้นฉบับ (${formatBytes(candidate.storedFileSize)}) ? ข้อมูลธุรกรรมและประวัติยังคงอยู่ครบถ้วน`)) {
      return;
    }
    try {
      const res = await pruneEvidenceBinaryAction(candidate.id, candidate.kind);
      if (res.success) {
        setActionNotice({
          type: "success",
          message: `ลบไฟล์ต้นฉบับสำเร็จ คืนพื้นที่ ${formatBytes(res.bytesFreed)}`,
        });
        setTimeout(() => setActionNotice(null), 3500);
        await handleRunDryRun();
      } else {
        setActionNotice({ type: "error", message: res.error || "เกิดข้อผิดพลาดในการลบไฟล์" });
      }
    } catch {
      setActionNotice({ type: "error", message: "ไม่สามารถลบไฟล์ต้นฉบับได้" });
    }
  };

  const handleConfirmBulkPrune = async () => {
    if (!dryRunResult || dryRunResult.candidates.length === 0) return;
    setIsPruning(true);
    setPruneProgress("กำลังลบไฟล์ต้นฉบับอย่างปลอดภัย...");
    try {
      const targets = dryRunResult.candidates.map((c) => ({
        targetId: c.id,
        targetType: c.kind,
      }));
      const res = await bulkPruneAction(targets);
      setShowConfirmModal(false);
      if (res.success) {
        setActionNotice({
          type: "success",
          message: `ลบไฟล์ต้นฉบับสำเร็จ ${res.totalPruned} รายการ คืนพื้นที่ทั้งหมด ${formatBytes(res.totalBytesFreed)}`,
        });
      } else {
        setActionNotice({
          type: "error",
          message: `ลบสำเร็จ ${res.totalPruned} รายการ, ล้มเหลว ${res.failedCount} รายการ`,
        });
      }
      setTimeout(() => setActionNotice(null), 4000);
      await handleRunDryRun();
    } catch {
      setActionNotice({ type: "error", message: "เกิดข้อผิดพลาดขณะลบไฟล์เป็นกลุ่ม" });
    } finally {
      setIsPruning(false);
      setPruneProgress(null);
    }
  };

  const handleLoadAuditEvents = async () => {
    if (!showAuditEvents) {
      setIsLoadingAudit(true);
      try {
        const res = await getStorageAuditEventsAction(15);
        if (res.success && res.events) {
          setAuditEvents(res.events);
        }
      } catch {
        // ignore
      } finally {
        setIsLoadingAudit(false);
      }
    }
    setShowAuditEvents(!showAuditEvents);
  };

  return (
    <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-sm">
          <HardDrive className="w-4 h-4 text-text-muted" />
          <span>การจัดการพื้นที่จัดเก็บและนโยบายการเก็บรักษา (Storage & Privacy)</span>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-text-muted font-mono">
          Private Bucket
        </span>
      </div>

      {actionNotice && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
            actionNotice.type === "success"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900"
              : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900"
          }`}
        >
          {actionNotice.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{actionNotice.message}</span>
        </div>
      )}

      {/* Storage Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-surface-soft rounded-xl border border-border">
          <p className="text-[11px] text-text-muted font-medium">พื้นที่ใช้งานจริง</p>
          <p className="text-base font-semibold text-text-primary mt-0.5">
            {formatBytes(summary.totalStoredBytes)}
          </p>
          <p className="text-[10px] text-text-muted mt-0.5">
            จากทั้งหมด {summary.totalDocuments} รายการ
          </p>
        </div>

        <div className="p-3 bg-surface-soft rounded-xl border border-border">
          <p className="text-[11px] text-text-muted font-medium">ปักหมุดเก็บถาวร</p>
          <p className="text-base font-semibold text-text-primary mt-0.5 flex items-center gap-1">
            <Pin className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            {summary.pinnedCount}
          </p>
          <p className="text-[10px] text-text-muted mt-0.5">ยกเว้นจากการลบ</p>
        </div>

        <div className="p-3 bg-surface-soft rounded-xl border border-border">
          <p className="text-[11px] text-text-muted font-medium">ลบไฟล์ต้นฉบับแล้ว</p>
          <p className="text-base font-semibold text-text-primary mt-0.5">
            {summary.binariesDeletedCount}
          </p>
          <p className="text-[10px] text-text-muted mt-0.5">คงเหลือเฉพาะข้อมูลบัญชี</p>
        </div>

        <div className="p-3 bg-surface-soft rounded-xl border border-border">
          <p className="text-[11px] text-text-muted font-medium">ครบกำหนดลบได้</p>
          <p className="text-base font-semibold text-primary mt-0.5">
            {summary.cleanupEligibleCount}
          </p>
          <p className="text-[10px] text-text-muted mt-0.5">ตามเงื่อนไขวันเก็บรักษา</p>
        </div>
      </div>

      {/* Privacy Guarantee Note */}
      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-border/80 flex items-start gap-2.5 text-xs text-text-muted leading-relaxed">
        <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-text-primary">
            หลักประกันความปลอดภัยและความถูกต้องทางบัญชี (Financial Integrity Guarantee)
          </p>
          <p className="mt-0.5 text-[11px]">
            ไฟล์หลักฐานทั้งหมดถูกจัดเก็บใน Private Storage โดยไม่มี Public URL การลบไฟล์ต้นฉบับจะลบเฉพาะข้อมูลรูปภาพ/ไบนารี
            โดย <strong>ข้อมูลธุรกรรม จำนวนเงิน บัญชี วันที่ และรหัสแฮช (SHA-256)</strong> จะยังคงถูกบันทึกไว้อย่างครบถ้วนเพื่อใช้อ้างอิงและป้องกันรายการซ้ำ
          </p>
        </div>
      </div>

      {/* Retention Policy Form */}
      <form onSubmit={handleSaveSettings} className="space-y-4 pt-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <Clock className="w-3.5 h-3.5 text-text-muted" />
          <span>กำหนดระยะเวลาจัดเก็บไฟล์ต้นฉบับ (Retention Window)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-text-muted font-medium mb-1">
              สลิปที่บันทึกแล้ว (วัน)
            </label>
            <input
              type="number"
              min={7}
              max={3650}
              value={slipDays}
              onChange={(e) => setSlipDays(parseInt(e.target.value, 10) || 7)}
              className="w-full px-3 py-2 bg-surface-soft border border-border rounded-xl text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-[10px] text-text-muted mt-1">
              สลิปที่ยืนยันแล้วเกินกำหนดนี้จะถือว่าครบกำหนดลบไฟล์ภาพ (ค่าเริ่มต้น 90 วัน, ต่ำสุด 7 วัน)
            </p>
          </div>

          <div>
            <label className="block text-text-muted font-medium mb-1">
              เอกสารนำเข้า / Statement (วัน)
            </label>
            <input
              type="number"
              min={7}
              max={3650}
              value={sourceDocDays}
              onChange={(e) => setSourceDocDays(parseInt(e.target.value, 10) || 7)}
              className="w-full px-3 py-2 bg-surface-soft border border-border rounded-xl text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-[10px] text-text-muted mt-1">
              เอกสารต้นทางที่นำเข้า (CSV, PDF) เกินกำหนดนี้จะถือว่าครบกำหนดลบไฟล์ (ค่าเริ่มต้น 90 วัน, ต่ำสุด 7 วัน)
            </p>
          </div>

          <div>
            <label className="block text-text-muted font-medium mb-1">
              สลิปที่ประมวลผลล้มเหลว / รายการซ้ำ (วัน)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={failedDays}
              onChange={(e) => setFailedDays(parseInt(e.target.value, 10) || 1)}
              className="w-full px-3 py-2 bg-surface-soft border border-border rounded-xl text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-[10px] text-text-muted mt-1">
              สลิปที่ล้มเหลวหรือซ้ำซ้อนจะถูกลบเร็วกว่าเพื่อประหยัดพื้นที่ (ค่าเริ่มต้น 7 วัน, ต่ำสุด 1 วัน)
            </p>
          </div>
        </div>

        {validationError && (
          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-400 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            type="submit"
            disabled={isSavingSettings}
            className="px-4 py-2 bg-primary hover:opacity-90 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-all shadow-sm active:scale-[0.98]"
          >
            {isSavingSettings ? "กำลังบันทึก..." : "บันทึกนโยบายการเก็บรักษา"}
          </button>
          {settingsMessage && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {settingsMessage}
            </span>
          )}
        </div>
      </form>

      {/* Dry Run / Manual Prune Section */}
      <div className="pt-4 border-t border-border space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-text-primary">
              ตรวจสอบรายการครบกำหนดและล้างพื้นที่ (Dry-run & Cleanup)
            </h3>
            <p className="text-[11px] text-text-muted mt-0.5">
              ระบบจะไม่ลบไฟล์อัตโนมัติ คุณสามารถตรวจสอบรายการและสั่งลบไฟล์ต้นฉบับด้วยตนเอง
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunDryRun}
            disabled={isLoadingDryRun}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-surface-soft hover:bg-surface-raised border border-border rounded-xl text-xs font-medium text-text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDryRun ? "animate-spin" : ""}`} />
            <span>{isLoadingDryRun ? "กำลังตรวจสอบ..." : "ตรวจสอบรายการ (Dry-run)"}</span>
          </button>
        </div>

        {dryRunError && (
          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
            {dryRunError}
          </p>
        )}

        {/* Dry Run Results */}
        {dryRunResult && (
          <div className="p-4 bg-surface-soft rounded-xl border border-border space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border/60">
              <div className="text-xs text-text-muted">
                พบรายการที่ครบกำหนด{" "}
                <span className="font-semibold text-text-primary">
                  {dryRunResult.candidates.length}
                </span>{" "}
                รายการ (สามารถคืนพื้นที่ได้{" "}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatBytes(dryRunResult.bytesRecoverable)}
                </span>
                )
              </div>
              <div className="text-[10px] text-text-muted flex flex-wrap gap-x-3 gap-y-0.5">
                <span>ครบกำหนดลบได้: {dryRunResult.candidates.length}</span>
                <span>ปักหมุดยกเว้น: {dryRunResult.exemptPinnedCount}</span>
                <span>ยังไม่ครบกำหนด: {dryRunResult.exemptRecentCount}</span>
                <span>รอตรวจสอบ/กำลังประมวลผล: {dryRunResult.exemptUnresolvedCount}</span>
                <span>ไม่มีไฟล์ต้นฉบับ (Metadata-only): {dryRunResult.metadataOnlyCount}</span>
                <span>ลบไฟล์ต้นฉบับแล้วจริง: {dryRunResult.actuallyPrunedCount}</span>
              </div>
            </div>

            {dryRunResult.candidates.length === 0 ? (
              <p className="text-xs text-text-muted py-2 text-center">
                ไม่มีไฟล์หลักฐานที่ครบกำหนดลบในขณะนี้
              </p>
            ) : (
              <>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {dryRunResult.candidates.map((cand) => (
                    <div
                      key={cand.id}
                      className="p-2.5 bg-surface dark:bg-surface-raised rounded-lg border border-border/80 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-text-muted shrink-0" />
                        <div className="truncate">
                          <p className="font-medium text-text-primary truncate">
                            {cand.kind === "slip" ? "สลิปโอนเงิน" : cand.originalFilename || "เอกสารต้นทาง"}
                          </p>
                          <p className="text-[10px] text-text-muted">
                            อายุ {cand.ageDays} วัน · ขนาด {formatBytes(cand.storedFileSize)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTogglePin(cand)}
                          title="ปักหมุดเพื่อไม่ให้ลบ"
                          className="p-1.5 hover:bg-surface-soft rounded-lg text-text-muted hover:text-amber-500 transition-colors"
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSinglePrune(cand)}
                          title="ลบไฟล์ต้นฉบับนี้"
                          className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg text-text-muted hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bulk Prune Button */}
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs rounded-xl transition-all shadow-sm active:scale-[0.98]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      ลบไฟล์ต้นฉบับทั้งหมด ({dryRunResult.candidates.length} รายการ,{" "}
                      {formatBytes(dryRunResult.bytesRecoverable)})
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Audit Log Viewer Toggle */}
      <div className="pt-2 border-t border-border">
        <button
          type="button"
          onClick={handleLoadAuditEvents}
          className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1.5 transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
          <span>
            {showAuditEvents ? "ซ่อนประวัติการจัดการไฟล์" : "ดูประวัติการจัดการไฟล์ (Audit Log)"}
          </span>
        </button>

        {showAuditEvents && (
          <div className="mt-3 p-3 bg-surface-soft rounded-xl border border-border text-xs space-y-2">
            {isLoadingAudit ? (
              <p className="text-text-muted text-center py-2">กำลังโหลดประวัติ...</p>
            ) : auditEvents.length === 0 ? (
              <p className="text-text-muted text-center py-2">ยังไม่มีประวัติการจัดการไฟล์</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {auditEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="text-[11px] p-2 bg-surface dark:bg-surface-raised rounded-lg border border-border flex items-center justify-between"
                  >
                    <div>
                      <span className="font-semibold text-text-primary uppercase">
                        {evt.action}
                      </span>
                      <span className="text-text-muted ml-2">
                        {evt.slip_id ? `Slip: ${evt.slip_id.slice(0, 8)}...` : ""}
                      </span>
                      {evt.bytes_affected ? (
                        <span className="text-text-muted ml-2">
                          ({formatBytes(evt.bytes_affected)})
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[10px] text-text-muted font-mono">
                      {new Date(evt.created_at).toLocaleTimeString("th-TH")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-surface dark:bg-surface-raised rounded-2xl border border-border max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-semibold text-text-primary">
                ยืนยันการลบไฟล์ต้นฉบับอย่างปลอดภัย
              </h3>
            </div>

            <div className="text-xs text-text-muted space-y-2 leading-relaxed">
              <p>
                คุณกำลังจะลบไฟล์ต้นฉบับจำนวน{" "}
                <strong className="text-text-primary">
                  {dryRunResult?.candidates.length} รายการ
                </strong>{" "}
                ซึ่งจะคืนพื้นที่จัดเก็บข้อมูลได้ประมาณ{" "}
                <strong className="text-text-primary">
                  {formatBytes(dryRunResult?.bytesRecoverable || 0)}
                </strong>
              </p>
              <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-border/80 text-[11px]">
                <p className="font-semibold text-text-primary mb-1">
                  สิ่งที่ได้รับการปกป้อง:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>ข้อมูลรายการธุรกรรม บัญชี จำนวนเงิน และวันที่ไม่สูญหาย</li>
                  <li>ข้อความ OCR และรหัสแฮช SHA-256 ยังคงอยู่ครบถ้วน</li>
                  <li>ไม่สามารถสร้างรายการซ้ำได้</li>
                </ul>
              </div>
            </div>

            {pruneProgress && (
              <p className="text-xs text-primary font-medium">{pruneProgress}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isPruning}
                className="px-4 py-2 border border-border hover:bg-surface-soft text-text-muted font-medium text-xs rounded-xl transition-colors disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkPrune}
                disabled={isPruning}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs rounded-xl transition-all shadow-sm disabled:opacity-50 active:scale-[0.98]"
              >
                {isPruning ? "กำลังดำเนินการ..." : "ยืนยันการลบไฟล์"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
