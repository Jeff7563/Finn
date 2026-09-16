"use client";

import React, { useState, useTransition } from "react";
import {
  IngestionItem,
  SourceDocument,
} from "@/types/multi-source";
import { Account, Category, Transaction } from "@/types/finance";
import {
  Mail,
  FileSpreadsheet,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  Link as LinkIcon,
  Plus,
  Filter,
  ShieldCheck,
  Clock,
  HardDrive,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  linkIngestionItemAction,
  createTransactionFromItemAction,
  dismissIngestionItemAction,
  rejectIngestionItemAction,
} from "@/app/actions/inbox";
import { getStorageUsageSummary } from "@/lib/storage/retention";

export interface UnifiedInboxClientProps {
  userId?: string;
  items: IngestionItem[];
  sourceDocuments: SourceDocument[];
  accounts: Account[];
  categories?: Category[];
  existingTransactions?: Transaction[];
  /** Server-computed canonical current balances keyed by account ID */
  accountBalanceMap?: Record<string, number>;
  /** Total bytes of legacy slip evidence (active, non-deleted, non-duplicate) */
  legacySlipStorageBytes?: number;
  /** Count of legacy slip evidence files */
  legacySlipStorageCount?: number;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function UnifiedInboxClient({
  items: initialItems,
  sourceDocuments,
  accounts,
  categories = [],
  existingTransactions = [],
  accountBalanceMap = {},
  legacySlipStorageBytes = 0,
  legacySlipStorageCount = 0,
}: UnifiedInboxClientProps) {
  const [items, setItems] = useState<IngestionItem[]>(initialItems);
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("pending");
  const [isPending, startTransition] = useTransition();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [reviewedItemId, setReviewedItemId] = useState<string | null>(null);
  const [showStorageSummary, setShowStorageSummary] = useState<boolean>(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || "");
  const [selectedToAccountId, setSelectedToAccountId] = useState<string>(
    accounts.length > 1 ? accounts[1].id : accounts[0]?.id || ""
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const docMap = new Map(sourceDocuments.map((d) => [d.id, d]));
  const storageSummary = getStorageUsageSummary(sourceDocuments, items);

  const filteredItems = items.filter((item) => {
    if (selectedStatusFilter !== "all" && item.status !== selectedStatusFilter) {
      return false;
    }
    if (selectedSourceFilter === "email" && item.item_type !== "email_notification") {
      return false;
    }
    if (selectedSourceFilter === "statement" && item.item_type !== "statement_row") {
      return false;
    }
    if (selectedSourceFilter === "api" && item.item_type !== "api_transaction") {
      return false;
    }
    return true;
  });

  const handleLink = (itemId: string, transactionId: string) => {
    startTransition(async () => {
      const res = await linkIngestionItemAction(itemId, transactionId);
      if (res.success) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? { ...i, status: "linked", matched_transaction_id: transactionId }
              : i
          )
        );
        setActionMessage({ text: "Linked evidence to transaction successfully", isError: false });
      } else {
        setActionMessage({ text: res.error || "Failed to link", isError: true });
      }
    });
  };

  const handleCreate = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    const parsed = item?.parsed_data;
    const isTransfer = parsed?.transaction_type === "transfer";

    if (!selectedAccountId) {
      setActionMessage({ text: "Please select an account first", isError: true });
      return;
    }

    if (isTransfer) {
      if (!selectedToAccountId) {
        setActionMessage({ text: "Please select a destination account for transfer", isError: true });
        return;
      }
      if (selectedAccountId === selectedToAccountId) {
        setActionMessage({ text: "Source and destination accounts must be distinct for transfer", isError: true });
        return;
      }
    }

    startTransition(async () => {
      const res = await createTransactionFromItemAction(itemId, {
        accountId: selectedAccountId,
        fromAccountId: isTransfer ? selectedAccountId : undefined,
        toAccountId: isTransfer ? selectedToAccountId : undefined,
        categoryId: selectedCategoryId || null,
      });
      if (res.success && res.transaction) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? { ...i, status: "linked", matched_transaction_id: res.transaction!.id }
              : i
          )
        );
        setActionMessage({
          text: isTransfer
            ? `Created transfer transaction for ${(res.transaction.amount || 0).toFixed(2)} THB`
            : `Created transaction for ${(res.transaction.amount || 0).toFixed(2)} THB`,
          isError: false,
        });
      } else {
        setActionMessage({ text: res.error || "Failed to create", isError: true });
      }
    });
  };

  const handleDismiss = (itemId: string) => {
    startTransition(async () => {
      const res = await dismissIngestionItemAction(itemId);
      if (res.success) {
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, status: "dismissed" } : i))
        );
        setActionMessage({ text: "Item dismissed (ignored)", isError: false });
      } else {
        setActionMessage({ text: res.error || "Failed to dismiss", isError: true });
      }
    });
  };

  const handleReject = (itemId: string) => {
    startTransition(async () => {
      const res = await rejectIngestionItemAction(itemId, "User rejected via Inbox");
      if (res.success) {
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, status: "error" } : i))
        );
        setActionMessage({ text: "Item rejected", isError: false });
      } else {
        setActionMessage({ text: res.error || "Failed to reject", isError: true });
      }
    });
  };

  const getItemIcon = (type: string) => {
    switch (type) {
      case "email_notification":
        return <Mail className="w-5 h-5 text-blue-500" />;
      case "statement_row":
        return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
      default:
        return <Receipt className="w-5 h-5 text-purple-500" />;
    }
  };

  const getMatchBadge = (matchClass?: string | null) => {
    switch (matchClass) {
      case "exact_duplicate":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
            ซ้ำแน่นอน (Exact Duplicate)
          </span>
        );
      case "strong_match":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            ตรงกันชัดเจน (Strong Match)
          </span>
        );
      case "possible_match":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            อาจจะตรงกัน (Possible Match)
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            รายการใหม่ (New Item)
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            กล่องข้อความหลายแหล่งที่มา (Multi-Source Inbox)
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            ตรวจสอบ เชื่อมโยงหลักฐาน หรือสร้างรายการจากธนาคาร สลิป และอีเมล
          </p>
        </div>

        {/* Safety Badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border text-xs text-text-secondary self-start">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>ระบบป้องกันการรวมรายการผิดพลาด (Financial Safety Active)</span>
        </div>
      </div>

      {/* Notice: No Ambiguous Confirm-All */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">ไม่มีปุ่มยืนยันทั้งหมดแบบเหมารวม (No Ambiguous Confirm-All): </span>
          ตามมาตรฐานความปลอดภัยทางการเงิน แต่ละรายการต้องได้รับการตรวจสอบและเลือกเชื่อมโยงอย่างชัดเจน เพื่อป้องกันความผิดพลาดของยอดเงินและบัญชี
        </div>
      </div>

      {/* Storage Visibility Card (Finn-Owned Storage Metrics) */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden transition-all">
        <div
          onClick={() => setShowStorageSummary(!showStorageSummary)}
          className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface-soft/60 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm text-text-primary">
              ภาพรวมพื้นที่จัดเก็บของระบบ (Finn Storage Usage & Retention)
            </span>
          </div>
          <button className="text-text-muted hover:text-text-primary text-xs flex items-center gap-1">
            <span>{showStorageSummary ? "ซ่อน" : "แสดง"}</span>
            {showStorageSummary ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {showStorageSummary && (() => {
          const combinedBytes = storageSummary.totalStoredBytes + legacySlipStorageBytes;
          const combinedCount = storageSummary.totalDocuments + legacySlipStorageCount;
          return (
          <div className="p-4 pt-0 border-t border-border/40 space-y-3 text-xs">
            {/* Combined totals */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="p-3 bg-surface-soft rounded-lg space-y-1">
                <span className="text-text-muted block text-[11px]">หลักฐานทั้งหมด</span>
                <span className="font-bold text-text-primary text-sm">{combinedCount} ไฟล์</span>
              </div>
              <div className="p-3 bg-surface-soft rounded-lg space-y-1">
                <span className="text-text-muted block text-[11px]">พื้นที่จัดเก็บรวม</span>
                <span className="font-bold text-text-primary text-sm">{formatBytes(combinedBytes)}</span>
              </div>
              <div className="p-3 bg-surface-soft rounded-lg space-y-1">
                <span className="text-text-muted block text-[11px]">สลิป (Legacy)</span>
                <span className="font-bold text-text-primary text-sm">{legacySlipStorageCount} ไฟล์ / {formatBytes(legacySlipStorageBytes)}</span>
              </div>
              <div className="p-3 bg-surface-soft rounded-lg space-y-1">
                <span className="text-text-muted block text-[11px]">เอกสารนำเข้า (Multi-Source)</span>
                <span className="font-bold text-text-primary text-sm">{storageSummary.totalDocuments} ไฟล์ / {formatBytes(storageSummary.totalStoredBytes)}</span>
              </div>
              <div className="p-3 bg-surface-soft rounded-lg space-y-1">
                <span className="text-text-muted block text-[11px]">รายการซ้ำ (Duplicates)</span>
                <span className="font-bold text-text-primary text-sm">{storageSummary.duplicateCount}</span>
              </div>
              <div className="p-3 bg-surface-soft rounded-lg space-y-1">
                <span className="text-text-muted block text-[11px]">ไฟล์ล้มเหลว/ปฏิเสธ</span>
                <span className="font-bold text-text-primary text-sm">{storageSummary.failedOrRejectedCount}</span>
              </div>
              <div className="p-3 bg-surface-soft rounded-lg space-y-1">
                <span className="text-text-muted block text-[11px]">พร้อมล้างไฟล์ ({">"}90 วัน)</span>
                <span className="font-bold text-text-primary text-sm">{storageSummary.cleanupEligibleCount}</span>
              </div>
            </div>
            <p className="text-[11px] text-text-muted">
              แสดงเฉพาะพื้นที่จัดเก็บที่ Finn เป็นเจ้าของ (Finn-owned metadata-based storage) — การล้างไฟล์ตามระยะเวลาเก็บรักษาใช้กับเอกสารนำเข้าเท่านั้น
            </p>
          </div>
          );
        })()}
      </div>

      {actionMessage && (
        <div
          className={`p-3 rounded-lg text-sm flex items-center justify-between ${
            actionMessage.isError
              ? "bg-red-500/10 border border-red-500/20 text-red-600"
              : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600"
          }`}
        >
          <span>{actionMessage.text}</span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-xs hover:opacity-70"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface rounded-xl border border-border">
        {/* Source Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs font-semibold text-text-secondary mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> แหล่งที่มา:
          </span>
          {[
            { id: "all", label: "ทั้งหมด" },
            { id: "email", label: "Gmail / อีเมล" },
            { id: "statement", label: "Statement CSV" },
            { id: "api", label: "API" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedSourceFilter(tab.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                selectedSourceFilter === tab.id
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-surface-soft text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text-secondary mr-1">สถานะ:</span>
          {[
            { id: "pending", label: "รอตรวจสอบ" },
            { id: "linked", label: "เชื่อมโยงแล้ว" },
            { id: "dismissed", label: "ยกเลิก/ซ่อน" },
            { id: "all", label: "ทั้งหมด" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedStatusFilter(tab.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                selectedStatusFilter === tab.id
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold"
                  : "bg-surface-soft text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Account & Category Selection for Quick Creation */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary px-1">
          <div className="flex items-center gap-2">
            <span>บัญชีต้นทาง (หรือบัญชีหลัก):</span>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-medium text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {accounts.map((acc) => {
                const displayBalance = accountBalanceMap[acc.id] ?? (Number(acc.opening_balance) || 0);
                return (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.institution || "บัญชี"}) - คงเหลือ{" "}
                  {displayBalance.toLocaleString()} THB
                </option>
                );
              })}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span>บัญชีปลายทาง (สำหรับโอนเงิน):</span>
            <select
              value={selectedToAccountId}
              onChange={(e) => setSelectedToAccountId(e.target.value)}
              className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-medium text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.institution || "บัญชี"})
                </option>
              ))}
            </select>
          </div>

          {categories.length > 0 && (
            <div className="flex items-center gap-2">
              <span>หมวดหมู่ (ไม่บังคับ):</span>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-medium text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">ไม่ระบุหมวดหมู่</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Item List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="text-center py-16 px-4 bg-surface rounded-2xl border border-dashed border-border text-text-secondary">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-semibold text-base">ไม่มีรายการในกล่องข้อความ</p>
            <p className="text-xs mt-1">
              {selectedStatusFilter === "pending"
                ? "คุณได้ตรวจสอบรายการทั้งหมดเรียบร้อยแล้ว"
                : "ไม่พบรายการตามตัวกรองที่เลือก"}
            </p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const parsed = item.parsed_data;
            const amountThb = parsed?.amount_decimal || (parsed?.amount ? parsed.amount / 100 : 0);
            const isTransfer = parsed?.transaction_type === "transfer";
            const isIncoming = !isTransfer && (parsed?.direction === "incoming" || parsed?.transaction_type === "income");
            const doc = docMap.get(item.source_document_id);
            const isReviewOpen = reviewedItemId === item.id;

            return (
              <div
                key={item.id}
                className="p-4 rounded-xl bg-surface border border-border hover:border-border/80 transition-all shadow-sm space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-surface-soft border border-border/50">
                      {getItemIcon(item.item_type)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text-primary text-sm">
                          {parsed?.description || parsed?.merchant_name || "รายการนำเข้า"}
                        </span>
                        {isTransfer && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20">
                            โอนเงิน (Transfer)
                          </span>
                        )}
                        {getMatchBadge(item.match_class)}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-secondary mt-0.5">
                        <span>
                          {parsed?.occurred_at
                            ? new Date(parsed.occurred_at).toLocaleString("th-TH")
                            : "ไม่ระบุเวลา"}
                        </span>
                        {parsed?.account_number && (
                          <span>บัญชี: {parsed.account_number}</span>
                        )}
                        {doc?.original_filename && (
                          <span className="truncate max-w-[140px]">
                            ไฟล์: {doc.original_filename}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Amount Display */}
                  <div className="text-right sm:self-auto self-end">
                    <span
                      className={`text-base font-bold ${
                        isTransfer
                          ? "text-blue-600 dark:text-blue-400"
                          : isIncoming
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-text-primary"
                      }`}
                    >
                      {isTransfer ? "⇄" : isIncoming ? "+" : "-"}
                      {amountThb.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      THB
                    </span>
                    {parsed?.reference_number && (
                      <div className="text-[11px] text-text-muted">
                        Ref: {parsed.reference_number}
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline Detailed Review Inspector */}
                {isReviewOpen && (
                  <div className="p-3.5 bg-surface-soft rounded-lg border border-border/80 space-y-2 text-xs">
                    <div className="font-semibold text-text-primary flex items-center justify-between">
                      <span>รายละเอียดการตรวจสอบ (Item Review & Metadata):</span>
                      <span className="text-[11px] text-text-muted font-mono">ID: {item.id}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                      <div>
                        <span className="text-text-muted block">ประเภทรายการ:</span>
                        <span className="font-medium text-text-primary">{item.item_type}</span>
                      </div>
                      <div>
                        <span className="text-text-muted block">ระดับความมั่นใจ:</span>
                        <span className="font-medium text-text-primary">
                          {item.confidence_score !== null && item.confidence_score !== undefined
                            ? `${(item.confidence_score * 100).toFixed(0)}%`
                            : "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted block">รหัสอ้างอิง:</span>
                        <span className="font-medium text-text-primary font-mono">{parsed?.reference_number || "ไม่มี"}</span>
                      </div>
                      <div>
                        <span className="text-text-muted block">ธนาคาร:</span>
                        <span className="font-medium text-text-primary">{parsed?.bank_code || "ไม่ระบุ"}</span>
                      </div>
                    </div>
                    {item.fingerprint && (
                      <div className="pt-1 text-[11px]">
                        <span className="text-text-muted block">Fingerprint:</span>
                        <span className="font-mono text-text-secondary break-all">{item.fingerprint}</span>
                      </div>
                    )}
                    {item.raw_data && (
                      <div className="pt-1 text-[11px]">
                        <span className="text-text-muted block">ข้อมูลดิบ (Raw Data):</span>
                        <pre className="p-2 bg-surface rounded border border-border/60 text-[10px] overflow-x-auto text-text-secondary">
                          {JSON.stringify(item.raw_data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Inline Link Picker */}
                {selectedItemId === item.id && existingTransactions.length > 0 && (
                  <div className="p-3 bg-surface-soft rounded-lg border border-border/70 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-text-secondary">เลือกรายการที่ตรงกัน:</span>
                    <select
                      id={`link-tx-${item.id}`}
                      className="bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary flex-1 min-w-[200px]"
                      defaultValue={item.matched_transaction_id || existingTransactions[0]?.id}
                    >
                      {existingTransactions.map((tx) => (
                        <option key={tx.id} value={tx.id}>
                          {new Date(tx.transaction_date).toLocaleDateString("th-TH")} - {tx.description} ({(tx.amount || 0).toLocaleString()} THB)
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          const selectEl = document.getElementById(`link-tx-${item.id}`) as HTMLSelectElement;
                          if (selectEl?.value) {
                            handleLink(item.id, selectEl.value);
                            setSelectedItemId(null);
                          }
                        }}
                        disabled={isPending}
                        className="px-2.5 py-1 bg-primary text-primary-foreground text-xs font-medium rounded hover:bg-primary-hover transition-colors"
                      >
                        ยืนยันการเชื่อมโยง
                      </button>
                      <button
                        onClick={() => setSelectedItemId(null)}
                        className="px-2 py-1 bg-surface hover:bg-surface-raised text-xs text-text-secondary rounded transition-colors"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions Row */}
                <div className="pt-2 border-t border-border/60 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-text-secondary">
                    {item.status === "linked" ? (
                      <span className="flex items-center gap-1 text-emerald-600 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> เชื่อมโยงกับรายการแล้ว
                      </span>
                    ) : item.status === "dismissed" ? (
                      <span className="text-text-muted">ยกเลิกแล้ว (Ignored)</span>
                    ) : item.status === "error" ? (
                      <span className="text-red-500 font-medium">ปฏิเสธแล้ว (Rejected)</span>
                    ) : (
                      <span>สถานะ: รอการตัดสินใจ</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Action 1: Review Button (inspect item details) */}
                    <button
                      onClick={() => setReviewedItemId(isReviewOpen ? null : item.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-soft hover:bg-surface-soft/80 text-text-secondary text-xs font-medium transition-colors flex items-center gap-1"
                    >
                      {isReviewOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{isReviewOpen ? "ปิดรายละเอียด" : "ตรวจสอบ (Review)"}</span>
                    </button>

                    {item.status === "pending" && (
                      <>
                        {isTransfer && (
                          <span className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
                            โอน: {accounts.find((a) => a.id === selectedAccountId)?.name || "ต้นทาง"} →{" "}
                            {accounts.find((a) => a.id === selectedToAccountId)?.name || "ปลายทาง"}
                            {selectedAccountId === selectedToAccountId && (
                              <span className="text-red-500 ml-1 font-bold">⚠️ บัญชีต้องต่างกัน</span>
                            )}
                          </span>
                        )}

                        {/* Action 2: Link to Existing Transaction Button */}
                        {existingTransactions.length > 0 && (
                          <button
                            onClick={() => setSelectedItemId(selectedItemId === item.id ? null : item.id)}
                            disabled={isPending}
                            className="px-2.5 py-1.5 rounded-lg bg-surface-soft hover:bg-surface-soft/80 text-text-primary text-xs font-medium transition-colors flex items-center gap-1"
                          >
                            <LinkIcon className="w-3.5 h-3.5" />
                            <span>เชื่อมโยง</span>
                          </button>
                        )}

                        {/* Action 3: Create Transaction Button */}
                        <button
                          onClick={() => handleCreate(item.id)}
                          disabled={isPending}
                          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary-hover transition-colors flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {isTransfer ? "สร้างรายการโอน" : "สร้างรายการใหม่"}
                        </button>

                        {/* Action 4: Ignore (Dismiss) Button */}
                        <button
                          onClick={() => handleDismiss(item.id)}
                          disabled={isPending}
                          className="px-2.5 py-1.5 rounded-lg bg-surface-soft hover:bg-surface-soft/80 text-text-secondary text-xs font-medium transition-colors"
                        >
                          ละเว้น (Ignore)
                        </button>

                        {/* Action 5: Reject Button */}
                        <button
                          onClick={() => handleReject(item.id)}
                          disabled={isPending}
                          className="px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 text-xs font-medium transition-colors"
                        >
                          ปฏิเสธ (Reject)
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
