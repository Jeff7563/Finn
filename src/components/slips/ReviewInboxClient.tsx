/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Slip } from "@/types/slip";
import {
  Account,
  Category,
  Merchant,
  Person,
} from "@/types/finance";
import {
  confirmSlipAction,
  editAndConfirmSlipAction,
  rejectSlipAction,
  markSlipDuplicateAction,
  getSlipSignedPreviewUrlAction,
  reprocessSlipAction,
} from "@/app/actions/slip-review";
import { MoneyAmount } from "@/components/ui/MoneyAmount";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDateTimeThai, formatDateTimeLocal } from "@/lib/finance/formatters";
import { parseThaiSlipDate } from "@/lib/slip/ocr/thai-slip-normalizer";
import { matchOwnedAccount } from "@/lib/slip/account-match";
import { useSlipsRealtime } from "@/lib/slip/realtime/slips-realtime";
import {
  Check,
  Edit2,
  Trash2,
  Copy,
  Eye,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  RefreshCw,
  Calendar,
  X,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { SlipUploadModal } from "./SlipUploadModal";

interface ReviewInboxClientProps {
  userId?: string;
  initialSlips: Slip[];
  accounts: Account[];
  categories: Category[];
  merchants: Merchant[];
  people: Person[];
}

export function ReviewInboxClient({
  userId,
  initialSlips,
  accounts,
  categories,
  merchants,
  people,
}: ReviewInboxClientProps) {
  const router = useRouter();
  const [slips, setSlips] = useState<Slip[]>(initialSlips);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Sync initialSlips to state when server re-renders after router.refresh()
  useEffect(() => {
    setSlips(initialSlips);
  }, [initialSlips]);

  // Realtime subscription: automatically calls router.refresh() when slips change in Supabase
  const { justUpdated } = useSlipsRealtime({ userId });

  // Preview Modal State
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);

  // Edit Modal State
  const [editingSlip, setEditingSlip] = useState<Slip | null>(null);
  const [editFormData, setEditFormData] = useState({
    type: "expense",
    amount: 0,
    transaction_date: "",
    from_account_id: "",
    to_account_id: "",
    category_id: "",
    merchant_id: "",
    person_id: "",
    description: "",
    note: "",
  });

  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  // Reprocess Slip with Vision
  const handleReprocess = async (slipId: string) => {
    setReprocessingId(slipId);
    try {
      const res = await reprocessSlipAction(slipId);
      if (res.success && res.result) {
        if (res.result.preservedPrevious) {
          alert(
            res.result.warningMessage ||
              "ประมวลผลใหม่ไม่สำเร็จ — ระบบคงข้อมูลเดิมไว้แล้ว"
          );
        }
        if (res.result.status === "created") {
          // Auto created, remove from review inbox
          setSlips(slips.filter((s) => s.id !== slipId));
        } else if (res.result.extracted) {
          // Update slip details in-place
          setSlips(
            slips.map((s) =>
              s.id === slipId
                ? {
                    ...s,
                    extracted_json: res.result!.extracted,
                    overall_confidence:
                      res.result!.overallConfidence !== undefined
                        ? res.result!.overallConfidence
                        : s.overall_confidence,
                    status: "needs_review",
                  }
                : s
            )
          );
        }
        router.refresh();
      } else {
        alert(res.error || "ไม่สามารถประมวลผลสลิปใหม่ได้");
      }
    } finally {
      setReprocessingId(null);
    }
  };

  // Open Preview Modal with Signed URL
  const handleOpenPreview = async (slipId: string) => {
    setLoadingPreviewId(slipId);
    try {
      const res = await getSlipSignedPreviewUrlAction(slipId);
      if (res.success && res.url) {
        setPreviewModalUrl(res.url);
      } else {
        alert(res.error || "ไม่สามารถโหลดภาพสลิปได้");
      }
    } finally {
      setLoadingPreviewId(null);
    }
  };

  // Direct Confirm
  const handleConfirm = async (slipId: string) => {
    setActiveActionId(slipId);
    try {
      const res = await confirmSlipAction(slipId);
      if (res.success) {
        setSlips(slips.filter((s) => s.id !== slipId));
        router.refresh();
      } else {
        alert(res.error || "ไม่สามารถยืนยันสลิปได้");
      }
    } finally {
      setActiveActionId(null);
    }
  };

  // Reject
  const handleReject = async (slipId: string) => {
    if (!confirm("คุณต้องการปฏิเสธและลบสลิปนี้ออกจากรายการรอตรวจสอบใช่หรือไม่?")) {
      return;
    }
    setActiveActionId(slipId);
    try {
      const res = await rejectSlipAction(slipId);
      if (res.success) {
        setSlips(slips.filter((s) => s.id !== slipId));
        router.refresh();
      } else {
        alert(res.error || "ไม่สามารถปฏิเสธสลิปได้");
      }
    } finally {
      setActiveActionId(null);
    }
  };

  // Mark Duplicate
  const handleMarkDuplicate = async (slipId: string) => {
    setActiveActionId(slipId);
    try {
      const res = await markSlipDuplicateAction(slipId);
      if (res.success) {
        setSlips(slips.filter((s) => s.id !== slipId));
        router.refresh();
      } else {
        alert(res.error || "ไม่สามารถทำเครื่องหมายเป็นรายการซ้ำได้");
      }
    } finally {
      setActiveActionId(null);
    }
  };

  // Open Edit Form
  const openEditModal = (slip: Slip) => {
    const ext = slip.extracted_json;
    const defaultAcc = accounts.find((a) => a.active)?.id || "";
    const sMatch = matchOwnedAccount(ext?.sender, accounts);
    const rMatch = matchOwnedAccount(ext?.receiver, accounts);
    const isSlipIncoming = Boolean(rMatch.accountId && !sMatch.accountId);

    setEditingSlip(slip);
    setEditFormData({
      type: isSlipIncoming ? "income" : "expense",
      amount: ext?.amount || 0,
      transaction_date: ext?.transactionDate
        ? formatDateTimeLocal(ext.transactionDate)
        : formatDateTimeLocal(new Date()),
      from_account_id: (isSlipIncoming ? rMatch.accountId : sMatch.accountId) || defaultAcc,
      to_account_id: "",
      category_id: "",
      merchant_id: "",
      person_id: "",
      description: isSlipIncoming
        ? (ext?.sender?.name ? `รับจาก ${ext.sender.name}` : "เงินโอนเข้า")
        : (ext?.receiver?.name ? `ชำระให้ ${ext.receiver.name}` : ""),
      note: "",
    });
  };

  // Submit Edit & Confirm
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSlip) return;

    setActiveActionId(editingSlip.id);
    try {
      const res = await editAndConfirmSlipAction(editingSlip.id, {
        type: editFormData.type as "income" | "expense" | "transfer",
        amount: Number(editFormData.amount),
        currency: "THB",
        transaction_date:
          parseThaiSlipDate(editFormData.transaction_date) ||
          new Date(editFormData.transaction_date).toISOString(),
        description: editFormData.description || null,
        note: editFormData.note || null,
        from_account_id: editFormData.from_account_id || null,
        to_account_id: editFormData.to_account_id || null,
        category_id: editFormData.category_id || null,
        merchant_id: editFormData.merchant_id || null,
        person_id: editFormData.person_id || null,
        source: "slip",
        tax_deductible: false,
      });

      if (res.success) {
        setSlips(slips.filter((s) => s.id !== editingSlip.id));
        setEditingSlip(null);
        router.refresh();
      } else {
        alert(res.error || "ไม่สามารถบันทึกรายการได้");
      }
    } finally {
      setActiveActionId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary flex items-center flex-wrap gap-2">
            <span>รายการรอตรวจสอบ</span>
            <span className="text-sm font-normal text-text-muted">
              · Review Inbox ({slips.length})
            </span>
            {justUpdated && (
              <span
                data-testid="realtime-updated-indicator"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 rounded-full transition-all duration-300"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                อัปเดตแล้ว
              </span>
            )}
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            สลิปธนาคารที่ต้องการการยืนยันประเภทรายการ บัญชี หรือมีข้อสงสัย
          </p>
        </div>

        <button
          onClick={() => setIsUploadModalOpen(true)}
          className="flex items-center justify-center gap-2 py-2 px-3.5 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:hover:bg-primary-hover text-white dark:text-primary-foreground text-xs font-semibold rounded-xl shadow-xs transition-all active:scale-[0.99] self-start sm:self-center"
        >
          <UploadCloud className="w-4 h-4" />
          <span>อัปโหลดสลิป</span>
        </button>
      </div>

      {/* Slips List */}
      {slips.length === 0 ? (
        <EmptyState
          title="ไม่มีรายการที่ต้องตรวจสอบ"
          description="สลิปทั้งหมดได้รับการประมวลผลหรือยืนยันเรียบร้อยแล้ว เมื่อคุณแชร์สลิปจาก iPhone หรืออัปโหลดเข้ามา รายการจะปรากฏที่นี่"
          actionLabel="อัปโหลดสลิปใหม่"
          onAction={() => setIsUploadModalOpen(true)}
        />
      ) : (
        <div className="space-y-4">
          {slips.map((slip) => {
            const ext = slip.extracted_json;
            const amount = ext?.amount || 0;
            const isAmountValid = typeof ext?.amount === "number" && ext.amount > 0;
            const formattedDate = ext?.transactionDate
              ? formatDateTimeThai(ext.transactionDate)
              : "ไม่ได้ระบุวันที่";

            const hasConfidence = slip.overall_confidence != null;
            const confidencePercent = hasConfidence
              ? Math.round(slip.overall_confidence! * 100)
              : 0;

            const senderMatch = matchOwnedAccount(ext?.sender, accounts);
            const receiverMatch = matchOwnedAccount(ext?.receiver, accounts);
            const isIncoming = Boolean(receiverMatch.accountId && !senderMatch.accountId);
            const isActing = activeActionId === slip.id;

            return (
              <div
                key={slip.id}
                className="bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-xs p-5 space-y-4 transition-colors"
              >
                {/* Header: Amount and Badges */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted block mb-1">
                      {isIncoming
                        ? "เงินโอนเข้า (รอตรวจสอบประเภทรายรับ)"
                        : "รายจ่ายที่คาดไว้"}
                    </span>
                    <MoneyAmount
                      amount={amount}
                      type={isIncoming ? "income" : "expense"}
                      currency={ext?.currency || "THB"}
                      size="xl"
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {!isAmountValid && (
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>อ่านข้อมูลสลิปไม่ครบ</span>
                      </span>
                    )}

                    {hasConfidence ? (
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-soft border border-border text-[11px] font-medium text-text-secondary">
                        <ShieldCheck className="w-3.5 h-3.5 text-income" />
                        <span>ความมั่นใจ {confidencePercent}%</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-soft border border-border text-[11px] font-medium text-text-muted">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                        <span>ยังไม่ประเมิน</span>
                      </span>
                    )}

                    <button
                      onClick={() => handleOpenPreview(slip.id)}
                      disabled={loadingPreviewId === slip.id}
                      className="flex items-center gap-1.5 px-3 py-1 bg-surface-soft hover:bg-surface-muted border border-border text-text-primary rounded-full text-xs font-medium transition-colors"
                    >
                      {loadingPreviewId === slip.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                      <span>ดูสลิป</span>
                    </button>
                  </div>
                </div>

                {/* Transfer / Parties Flow */}
                <div className="p-3.5 bg-surface-soft rounded-xl border border-border flex items-center gap-3 text-xs">
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] uppercase font-semibold text-text-muted block">
                      ผู้โอน (Sender)
                    </span>
                    <strong className="text-text-primary truncate block font-medium">
                      {ext?.sender?.bank || "ไม่ระบุธนาคาร"}{" "}
                      {ext?.sender?.accountMasked ? `••${ext.sender.accountMasked}` : ""}
                    </strong>
                    {ext?.sender?.name && (
                      <span className="text-[11px] text-text-muted truncate block">
                        {ext.sender.name}
                      </span>
                    )}
                  </div>

                  <ArrowRight className="w-4 h-4 text-text-muted flex-shrink-0" />

                  <div className="flex-1 min-w-0 text-right">
                    <span className="text-[10px] uppercase font-semibold text-text-muted block">
                      ผู้รับ (Receiver)
                    </span>
                    <strong className="text-text-primary truncate block font-medium">
                      {ext?.receiver?.bank || "ไม่ระบุธนาคาร"}{" "}
                      {ext?.receiver?.accountMasked ? `••${ext.receiver.accountMasked}` : ""}
                    </strong>
                    {ext?.receiver?.name && (
                      <span className="text-[11px] text-text-muted truncate block">
                        {ext.receiver.name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Meta details: Date & Ref */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-text-muted">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formattedDate}</span>
                  </div>
                  {ext?.reference && (
                    <div className="truncate font-mono text-[11px]">
                      รหัสอ้างอิง: {ext.reference}
                    </div>
                  )}
                </div>

                {/* Actions Row */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleConfirm(slip.id)}
                        disabled={isActing || !isAmountValid}
                        title={!isAmountValid ? "กรุณาแก้ไขจำนวนเงินก่อนยืนยัน" : "ยืนยันรายการ"}
                        className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:hover:bg-primary-hover text-white dark:text-primary-foreground font-semibold rounded-xl text-xs shadow-xs transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>ยืนยันรายการ</span>
                      </button>

                      <button
                        onClick={() => openEditModal(slip)}
                        disabled={isActing}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-surface-soft hover:bg-surface-muted border border-border text-text-primary font-semibold rounded-xl text-xs transition-colors disabled:opacity-50"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>แก้ไข</span>
                      </button>

                      <button
                        onClick={() => handleReprocess(slip.id)}
                        disabled={isActing || reprocessingId === slip.id}
                        className="flex items-center gap-1.5 px-3 py-2 bg-surface-soft hover:bg-surface-muted border border-border text-text-primary font-semibold rounded-xl text-xs transition-colors disabled:opacity-50"
                        title="ประมวลผลข้อมูลสลิปนี้ใหม่อีกครั้ง"
                      >
                        {reprocessingId === slip.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>ประมวลผลใหม่</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleMarkDuplicate(slip.id)}
                        disabled={isActing}
                        className="flex items-center gap-1 px-3 py-2 text-text-muted hover:text-text-primary text-xs rounded-xl hover:bg-surface-soft transition-colors"
                        title="ทำเครื่องหมายว่าเป็นรายการซ้ำ"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>รายการซ้ำ</span>
                      </button>

                      <button
                        onClick={() => handleReject(slip.id)}
                        disabled={isActing}
                        className="flex items-center gap-1 px-3 py-2 text-expense hover:bg-expense-soft text-xs rounded-xl transition-colors"
                        title="ปฏิเสธสลิปนี้"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ปฏิเสธ</span>
                      </button>
                    </div>
                  </div>

                  {!isAmountValid && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                      * ข้อมูลสลิปยังไม่สมบูรณ์ (จำนวนเงินไม่ถูกต้อง) กรุณากด &quot;แก้ไข&quot; เพื่อระบุจำนวนเงิน หรือกด &quot;ประมวลผลใหม่&quot;
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Slip Image Preview Modal */}
      {previewModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div
            className="fixed inset-0"
            onClick={() => setPreviewModalUrl(null)}
          />
          <div className="relative max-w-lg w-full bg-surface rounded-2xl border border-border shadow-2xl p-4 z-10 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="font-semibold text-xs text-text-primary">
                สลิปธนาคาร (Private Preview)
              </span>
              <button
                onClick={() => setPreviewModalUrl(null)}
                className="p-1 text-text-muted hover:text-text-primary rounded-md hover:bg-surface-soft"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-center max-h-[75vh] overflow-hidden rounded-xl bg-slate-950">
              <img
                src={previewModalUrl}
                alt="Slip preview"
                className="max-h-[70vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit & Confirm Modal */}
      {editingSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div
            className="fixed inset-0"
            onClick={() => setEditingSlip(null)}
          />
          <div className="relative max-w-md w-full bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-2xl p-5 z-10 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="font-semibold text-sm text-text-primary">
                แก้ไขและยืนยันรายการสลิป
              </span>
              <button
                onClick={() => setEditingSlip(null)}
                className="p-1 text-text-muted hover:text-text-primary rounded-md hover:bg-surface-soft"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="font-medium text-text-muted block mb-1">
                  ประเภทรายการ
                </label>
                <select
                  value={editFormData.type}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, type: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="expense">รายจ่าย (Expense)</option>
                  <option value="income">รายรับ (Income)</option>
                  <option value="transfer">โอนข้ามบัญชี (Transfer)</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-text-muted block mb-1">
                  จำนวนเงิน (บาท) *
                </label>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  required
                  value={editFormData.amount}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary font-semibold text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="font-medium text-text-muted block mb-1">
                  บัญชี
                </label>
                <select
                  name="from_account_id"
                  value={editFormData.from_account_id}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      from_account_id: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">เลือกบัญชี</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.institution || acc.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-medium text-text-muted block mb-1">
                  หมวดหมู่
                </label>
                <select
                  name="category_id"
                  value={editFormData.category_id}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      category_id: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">ไม่มีหมวดหมู่</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-medium text-text-muted block mb-1">
                  ร้านค้า / ผู้รับเงิน (ถ้ามี)
                </label>
                <select
                  name="merchant_id"
                  value={editFormData.merchant_id}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      merchant_id: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">ไม่มีร้านค้า</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-medium text-text-muted block mb-1">
                  บุคคลที่เกี่ยวข้อง (ถ้ามี)
                </label>
                <select
                  name="person_id"
                  value={editFormData.person_id}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      person_id: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">ไม่มีบุคคล</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-medium text-text-muted block mb-1">
                  รายละเอียด
                </label>
                <input
                  type="text"
                  name="description"
                  value={editFormData.description}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      description: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingSlip(null)}
                  className="px-4 py-2 bg-surface-soft border border-border rounded-xl text-text-primary font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground font-semibold rounded-xl"
                >
                  บันทึกและยืนยันรายการ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      <SlipUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}
