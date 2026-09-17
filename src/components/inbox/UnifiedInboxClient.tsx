"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  Upload,
} from "lucide-react";
import {
  linkIngestionItemAction,
  createTransactionFromItemAction,
  dismissIngestionItemAction,
  rejectIngestionItemAction,
  ImportStatementCsvResult,
} from "@/app/actions/inbox";
import { formatBangkokDateTime, formatBangkokDate } from "@/lib/finance/formatters";
import { getStorageUsageSummary } from "@/lib/storage/retention";
import { CsvImportModal } from "./CsvImportModal";
import { getCategoryDisplayName } from "@/lib/finance/category-labels";

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
  const router = useRouter();
  const [items, setItems] = useState<IngestionItem[]>(initialItems);
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("pending");
  const [isPending, startTransition] = useTransition();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [reviewedItemId, setReviewedItemId] = useState<string | null>(null);
  const [showStorageSummary, setShowStorageSummary] = useState<boolean>(true);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || "");
  const [selectedToAccountId, setSelectedToAccountId] = useState<string>(
    accounts.length > 1 ? accounts[1].id : accounts[0]?.id || ""
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [reviewFormMap, setReviewFormMap] = useState<
    Record<
      string,
      {
        type: "expense" | "income" | "transfer";
        fromAccountId: string;
        toAccountId: string;
        categoryId: string;
        confirmMismatch: boolean;
      }
    >
  >({});

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const handleImportSuccess = (result: ImportStatementCsvResult) => {
    setSelectedSourceFilter("statement");
    setSelectedStatusFilter("pending");
    router.refresh();
    setActionMessage({
      text: result.message || "นำเข้า Statement สำเร็จ",
      isError: false,
    });
  };

  const docMap = new Map(sourceDocuments.map((d) => [d.id, d]));
  const storageSummary = getStorageUsageSummary(sourceDocuments, items);

function getStatementAccountId(
  doc?: SourceDocument,
  item?: IngestionItem
): string {
  if (
    doc?.provider_metadata?.statementAccountId &&
    typeof doc.provider_metadata.statementAccountId === "string"
  ) {
    return doc.provider_metadata.statementAccountId;
  }
  const rawMetadata = item?.raw_data as Record<string, unknown> | null | undefined;
  if (rawMetadata?.statementAccountId && typeof rawMetadata.statementAccountId === "string") {
    return rawMetadata.statementAccountId;
  }
  return "";
}

  const getReviewForm = (item: IngestionItem) => {
    const existing = reviewFormMap[item.id];
    if (existing) return existing;

    const doc = docMap.get(item.source_document_id);
    const stmtAccountId = getStatementAccountId(doc, item);

    const parsed = item.parsed_data;
    const isOriginallyIncoming =
      parsed?.direction === "incoming" || parsed?.transaction_type === "income";
    const isOriginallyTransfer = parsed?.transaction_type === "transfer";
    const type: "expense" | "income" | "transfer" = isOriginallyTransfer
      ? "transfer"
      : isOriginallyIncoming
      ? "income"
      : "expense";

    let fromAccountId = "";
    let toAccountId = "";

    if (type === "transfer") {
      if (isOriginallyIncoming) {
        toAccountId = stmtAccountId || "";
        fromAccountId = "";
      } else {
        fromAccountId = stmtAccountId || "";
        toAccountId = "";
      }
    } else if (type === "expense") {
      fromAccountId = stmtAccountId || accounts[0]?.id || "";
    } else if (type === "income") {
      toAccountId = stmtAccountId || accounts[0]?.id || "";
    }

    return {
      type,
      fromAccountId,
      toAccountId,
      categoryId: "",
      confirmMismatch: false,
    };
  };

  const updateReviewForm = (
    itemId: string,
    patch: Partial<{
      type: "expense" | "income" | "transfer";
      fromAccountId: string;
      toAccountId: string;
      categoryId: string;
      confirmMismatch: boolean;
    }>
  ) => {
    setReviewFormMap((prev) => {
      const item = items.find((i) => i.id === itemId);
      const current =
        prev[itemId] ||
        (item
          ? getReviewForm(item)
          : {
              type: "expense",
              fromAccountId: "",
              toAccountId: "",
              categoryId: "",
              confirmMismatch: false,
            });
      return {
        ...prev,
        [itemId]: { ...current, ...patch },
      };
    });
  };

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
    if (!item) return;

    if (item.match_class === "exact_duplicate") {
      setActionMessage({
        text: "ไม่อนุญาตให้สร้างรายการจากหลักฐานที่ซ้ำแน่นอน (Exact Duplicate) เพื่อความปลอดภัยทางบัญชี",
        isError: true,
      });
      return;
    }

    const form = getReviewForm(item);
    const doc = docMap.get(item.source_document_id);
    const stmtAccountId = getStatementAccountId(doc, item);

    if (form.type === "transfer") {
      if (!form.fromAccountId || !form.toAccountId) {
        setReviewedItemId(item.id);
        setActionMessage({
          text: "การโอนเงินต้องระบุทั้งบัญชีต้นทางและบัญชีปลายทาง กรุณาเลือกบัญชีในส่วนตรวจสอบ",
          isError: true,
        });
        return;
      }
      if (form.fromAccountId === form.toAccountId) {
        setReviewedItemId(item.id);
        setActionMessage({
          text: "บัญชีต้นทางและปลายทางต้องไม่เป็นบัญชีเดียวกันสำหรับการโอนเงิน",
          isError: true,
        });
        return;
      }
    } else if (form.type === "expense") {
      if (!form.fromAccountId) {
        setActionMessage({ text: "กรุณาเลือกบัญชีสำหรับรายจ่าย", isError: true });
        return;
      }
      if (stmtAccountId && form.fromAccountId !== stmtAccountId && !form.confirmMismatch) {
        setReviewedItemId(item.id);
        setActionMessage({
          text: "บัญชีที่เลือกไม่ตรงกับ Statement Account กรุณายืนยันความต้องการในส่วนตรวจสอบ",
          isError: true,
        });
        return;
      }
    } else if (form.type === "income") {
      if (!form.toAccountId) {
        setActionMessage({ text: "กรุณาเลือกบัญชีสำหรับรายรับ", isError: true });
        return;
      }
      if (stmtAccountId && form.toAccountId !== stmtAccountId && !form.confirmMismatch) {
        setReviewedItemId(item.id);
        setActionMessage({
          text: "บัญชีที่เลือกไม่ตรงกับ Statement Account กรุณายืนยันความต้องการในส่วนตรวจสอบ",
          isError: true,
        });
        return;
      }
    }

    startTransition(async () => {
      const res = await createTransactionFromItemAction(itemId, {
        type: form.type,
        accountId: form.type === "expense" ? form.fromAccountId : form.toAccountId,
        fromAccountId: form.fromAccountId || undefined,
        toAccountId: form.toAccountId || undefined,
        categoryId: form.categoryId || null,
        confirmAccountMismatch: form.confirmMismatch,
      });
      if (res.success && res.transaction) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? { ...i, status: "linked", matched_transaction_id: res.transaction!.id }
              : i
          )
        );
        setReviewedItemId(null);
        setActionMessage({
          text:
            form.type === "transfer"
              ? `สร้างรายการโอนเงินสำเร็จ ${(res.transaction.amount || 0).toFixed(2)} THB`
              : `สร้างรายการสำเร็จ ${(res.transaction.amount || 0).toFixed(2)} THB`,
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
            อาจจะตรงกัน (Possible Match — ต้องให้ผู้ใช้ตรวจสอบ)
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

        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
          {/* CSV Import Button */}
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span>นำเข้า Statement CSV</span>
          </button>

          {/* Safety Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border text-xs text-text-secondary">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>ระบบป้องกันการรวมรายการผิดพลาด (Financial Safety Active)</span>
          </div>
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
                    {getCategoryDisplayName(cat)}
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
            const doc = docMap.get(item.source_document_id);
            const isReviewOpen = reviewedItemId === item.id;
            const form = getReviewForm(item);

            const stmtAccountId = getStatementAccountId(doc, item);
            const stmtAccount = accounts.find((a) => a.id === stmtAccountId);

            const isTransfer = form.type === "transfer";
            const isIncoming = form.type === "income";

            // Check if there is an account mismatch that requires confirmation
            const isOriginallyIncoming =
              parsed?.direction === "incoming" || parsed?.transaction_type === "income";
            let hasMismatch = false;
            let mismatchMessage = "";

            if (stmtAccountId) {
              if (form.type === "expense" && form.fromAccountId && form.fromAccountId !== stmtAccountId) {
                hasMismatch = true;
                mismatchMessage = `บัญชีต้นทาง (${accounts.find((a) => a.id === form.fromAccountId)?.name || form.fromAccountId}) ไม่ตรงกับบัญชี Statement (${stmtAccount?.name || stmtAccountId})`;
              } else if (form.type === "income" && form.toAccountId && form.toAccountId !== stmtAccountId) {
                hasMismatch = true;
                mismatchMessage = `บัญชีปลายทาง (${accounts.find((a) => a.id === form.toAccountId)?.name || form.toAccountId}) ไม่ตรงกับบัญชี Statement (${stmtAccount?.name || stmtAccountId})`;
              } else if (form.type === "transfer") {
                if (isOriginallyIncoming && form.toAccountId && form.toAccountId !== stmtAccountId) {
                  hasMismatch = true;
                  mismatchMessage = `รายการรับโอนเงินควรมีบัญชีปลายทางเป็นบัญชี Statement (${stmtAccount?.name || stmtAccountId})`;
                } else if (!isOriginallyIncoming && form.fromAccountId && form.fromAccountId !== stmtAccountId) {
                  hasMismatch = true;
                  mismatchMessage = `รายการโอนออกควรมีบัญชีต้นทางเป็นบัญชี Statement (${stmtAccount?.name || stmtAccountId})`;
                }
              }
            }

            const isDuplicate = item.match_class === "exact_duplicate";

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
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary mt-0.5">
                        <span>{formatBangkokDateTime(parsed?.occurred_at)}</span>
                        {stmtAccount && (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            Statement account: {stmtAccount.name}
                          </span>
                        )}
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

                {/* Parse Error Banner if Malformed Row */}
                {parsed?.parse_error && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>
                      <strong className="font-semibold">ข้อผิดพลาดในการแยกข้อมูล (Parse Error):</strong> {parsed.parse_error}
                    </span>
                  </div>
                )}

                {/* Strong Match Suggested Transaction Banner */}
                {item.match_class === "strong_match" && item.status === "pending" && item.matched_transaction_id && (() => {
                  const suggestedTx = existingTransactions.find((t) => t.id === item.matched_transaction_id);
                  return (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <span className="font-semibold">พบรายการตรงกันในระบบ (Suggested Match): </span>
                          {suggestedTx ? (
                            <span>
                              {formatBangkokDate(suggestedTx.transaction_date)} — {suggestedTx.description} ({(suggestedTx.amount || 0).toLocaleString()} THB)
                            </span>
                          ) : (
                            <span>รหัสรายการ: {item.matched_transaction_id}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleLink(item.id, item.matched_transaction_id!)}
                        disabled={isPending}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs transition-colors shrink-0 flex items-center gap-1 self-start sm:self-auto"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                        <span>เชื่อมโยงทันที (Link)</span>
                      </button>
                    </div>
                  );
                })()}

                {/* Possible Match Human Review Notice */}
                {item.match_class === "possible_match" && item.status === "pending" && (
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                    <span>
                      สัญญาณความตรงกันไม่สมบูรณ์ — <strong>ต้องให้ผู้ใช้ตรวจสอบและตัดสินใจด้วยตนเอง (Human confirmation required)</strong>
                    </span>
                  </div>
                )}

                {/* Inline Detailed Review & Creation Inspector */}
                {isReviewOpen && (
                  <div className="p-4 bg-surface-soft rounded-xl border border-border/80 space-y-4 text-xs">
                    <div className="font-semibold text-text-primary flex items-center justify-between border-b border-border/50 pb-2">
                      <div className="flex items-center gap-2">
                        <span>รายละเอียดการตรวจสอบ (Item Review & Type Override):</span>
                        {stmtAccount && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
                            Statement account: {stmtAccount.name}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-text-muted font-mono">ID: {item.id}</span>
                    </div>

                    {/* Metadata summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] bg-surface p-3 rounded-lg border border-border/50">
                      <div>
                        <span className="text-text-muted block">ประเภทข้อมูลนำเข้า:</span>
                        <span className="font-medium text-text-primary">{item.item_type}</span>
                      </div>
                      <div>
                        <span className="text-text-muted block">เวลาที่เกิดรายการ:</span>
                        <span className="font-medium text-text-primary">{formatBangkokDateTime(parsed?.occurred_at)}</span>
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

                    {/* Type Override Selector */}
                    <div className="space-y-1.5">
                      <label className="font-semibold text-text-primary block">
                        กำหนดประเภทรายการก่อนบันทึก (Override Transaction Type):
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: "expense", label: "รายจ่าย (Expense)" },
                          { id: "income", label: "รายรับ (Income)" },
                          { id: "transfer", label: "โอนเงินระหว่างบัญชีตนเอง (Transfer)" },
                        ].map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              const newType = t.id as "expense" | "income" | "transfer";
                              let newFrom = form.fromAccountId;
                              let newTo = form.toAccountId;
                              if (newType === "transfer") {
                                if (isOriginallyIncoming) {
                                  newTo = stmtAccountId || "";
                                  newFrom = "";
                                } else {
                                  newFrom = stmtAccountId || "";
                                  newTo = "";
                                }
                              } else if (newType === "expense") {
                                newFrom = stmtAccountId || accounts[0]?.id || "";
                                newTo = "";
                              } else if (newType === "income") {
                                newTo = stmtAccountId || accounts[0]?.id || "";
                                newFrom = "";
                              }
                              updateReviewForm(item.id, {
                                type: newType,
                                fromAccountId: newFrom,
                                toAccountId: newTo,
                              });
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              form.type === t.id
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "bg-surface border border-border text-text-secondary hover:text-text-primary"
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Account Controls based on chosen type */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {(form.type === "expense" || form.type === "transfer") && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-text-secondary block">
                            บัญชีต้นทาง (From Account):
                          </label>
                          <select
                            value={form.fromAccountId}
                            onChange={(e) => updateReviewForm(item.id, { fromAccountId: e.target.value })}
                            className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:ring-1 focus:ring-primary focus:outline-none"
                          >
                            <option value="">-- เลือกบัญชีต้นทาง --</option>
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} ({acc.institution || "บัญชี"}) {acc.id === stmtAccountId ? "★ [Statement Account]" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {(form.type === "income" || form.type === "transfer") && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-text-secondary block">
                            บัญชีปลายทาง (To Account):
                          </label>
                          <select
                            value={form.toAccountId}
                            onChange={(e) => updateReviewForm(item.id, { toAccountId: e.target.value })}
                            className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:ring-1 focus:ring-primary focus:outline-none"
                          >
                            <option value="">-- เลือกบัญชีปลายทาง --</option>
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} ({acc.institution || "บัญชี"}) {acc.id === stmtAccountId ? "★ [Statement Account]" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Transfer Distinct Check */}
                    {form.type === "transfer" && form.fromAccountId && form.toAccountId && form.fromAccountId === form.toAccountId && (
                      <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-xs flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>บัญชีต้นทางและบัญชีปลายทางต้องไม่เป็นบัญชีเดียวกันสำหรับการโอนเงิน (Accounts must be distinct)</span>
                      </div>
                    )}

                    {/* Mismatch Warning & Confirmation Checkbox */}
                    {hasMismatch && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2 text-xs text-amber-800 dark:text-amber-300">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                          <span>
                            <strong>คำเตือนเรื่องบัญชี (Account Mismatch Warning):</strong> {mismatchMessage}
                          </span>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer pt-1">
                          <input
                            type="checkbox"
                            checked={form.confirmMismatch}
                            onChange={(e) => updateReviewForm(item.id, { confirmMismatch: e.target.checked })}
                            className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                          />
                          <span className="font-semibold text-text-primary">
                            ยืนยันการใช้บัญชีที่ไม่ตรงกับ Statement (Confirm deliberate account mismatch)
                          </span>
                        </label>
                      </div>
                    )}

                    {/* Category Selection (Non-transfer only) */}
                    {form.type !== "transfer" && categories.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-secondary block">
                          หมวดหมู่ (ไม่บังคับ):
                        </label>
                        <select
                          value={form.categoryId}
                          onChange={(e) => updateReviewForm(item.id, { categoryId: e.target.value })}
                          className="bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:ring-1 focus:ring-primary focus:outline-none max-w-xs"
                        >
                          <option value="">ไม่ระบุหมวดหมู่</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {getCategoryDisplayName(cat)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Duplicate Safety Warning or Create Button in Review Form */}
                    <div className="pt-2 border-t border-border/50 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-text-muted">
                        * ข้อมูลหลักฐานดิบ (Raw Evidence) จะถูกเก็บรักษาไว้โดยไม่มีการแก้ไขดัดแปลง
                      </div>

                      <div className="flex items-center gap-2">
                        {isDuplicate ? (
                          <span className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-600 rounded-lg text-xs font-semibold">
                            ⚠️ ห้ามสร้างรายการ: รายการซ้ำแน่นอน (Exact Duplicate Blocked)
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleCreate(item.id)}
                            disabled={
                              isPending ||
                              (form.type === "transfer" &&
                                (!form.fromAccountId ||
                                  !form.toAccountId ||
                                  form.fromAccountId === form.toAccountId)) ||
                              (hasMismatch && !form.confirmMismatch)
                            }
                            className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-primary-foreground font-semibold rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>ยืนยันสร้างรายการ ({form.type === "transfer" ? "โอนเงิน" : form.type === "income" ? "รายรับ" : "รายจ่าย"})</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setReviewedItemId(null)}
                          className="px-3 py-2 bg-surface border border-border hover:bg-surface-soft text-text-secondary text-xs rounded-lg transition-colors"
                        >
                          ปิด
                        </button>
                      </div>
                    </div>
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
                          {formatBangkokDate(tx.transaction_date)} - {tx.description} ({(tx.amount || 0).toLocaleString()} THB)
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
                    {/* Action 1: Review Button (inspect & configure item details) */}
                    <button
                      onClick={() => setReviewedItemId(isReviewOpen ? null : item.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-soft hover:bg-surface-soft/80 text-text-secondary text-xs font-medium transition-colors flex items-center gap-1"
                    >
                      {isReviewOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{isReviewOpen ? "ปิดรายละเอียด" : "ตรวจสอบ (Review)"}</span>
                    </button>

                    {item.status === "pending" && (
                      <>
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

                        {/* Action 3: Create Transaction Button (BLOCKED FOR EXACT DUPLICATES) */}
                        {!isDuplicate && (() => {
                          const form = getReviewForm(item);
                          const isTransferIncomplete =
                            form.type === "transfer" &&
                            (!form.fromAccountId ||
                              !form.toAccountId ||
                              form.fromAccountId === form.toAccountId);
                          return (
                            <button
                              onClick={() => {
                                if (isTransferIncomplete) {
                                  setReviewedItemId(item.id);
                                } else {
                                  handleCreate(item.id);
                                }
                              }}
                              disabled={isPending || isTransferIncomplete}
                              title={
                                isTransferIncomplete
                                  ? "การโอนเงินต้องระบุทั้งบัญชีต้นทางและปลายทาง กรุณาเลือกบัญชีในส่วนตรวจสอบ"
                                  : undefined
                              }
                              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {form.type === "transfer" ? "สร้างรายการโอน" : "สร้างรายการใหม่"}
                            </button>
                          );
                        })()}

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

      {/* CSV Import Modal */}
      <CsvImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        accounts={accounts}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
