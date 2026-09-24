/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useState, useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Account,
  Category,
  Merchant,
  Person,
  TransactionWithRelations,
} from "@/types/finance";
import {
  deleteTransactionAction,
  updateTransactionAction,
} from "@/app/actions/transactions";
import { MoneyAmount } from "@/components/ui/MoneyAmount";
import { TransactionTypeBadge } from "@/components/ui/TransactionTypeBadge";
import {
  formatDateTimeThai,
  canonicalInstantToBangkokDateTimeLocal,
} from "@/lib/finance/formatters";
import { getCategoryDisplayName } from "@/lib/finance/category-labels";
import {
  Trash2,
  Edit2,
  Calendar,
  Wallet,
  Tag,
  User,
  Store,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Check,
  X,
  Eye,
  Loader2,
  Ban,
  RotateCcw,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { getSlipSignedPreviewUrlAction } from "@/app/actions/slip-review";
import { VoidTransactionModal } from "@/components/transactions/VoidTransactionModal";
import { RestoreTransactionModal } from "@/components/transactions/RestoreTransactionModal";
import { RestoreSlipBinaryModal } from "@/components/slips/RestoreSlipBinaryModal";
import { ReplaceSlipTransactionModal } from "@/components/transactions/ReplaceSlipTransactionModal";
import { Slip } from "@/types/slip";

interface TransactionDetailClientProps {
  transaction: TransactionWithRelations;
  slip?: Slip | null;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  merchants: Merchant[];
  hasVoidHistory?: boolean;
}

export function TransactionDetailClient({
  transaction,
  slip,
  accounts,
  categories,
  people,
  merchants,
  hasVoidHistory = false,
}: TransactionDetailClientProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isLoadingSlip, setIsLoadingSlip] = useState(false);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [isRestoreBinaryModalOpen, setIsRestoreBinaryModalOpen] = useState(false);
  const [isMissingBinary, setIsMissingBinary] = useState(false);

  const activeSlipId =
    transaction.source_slip_id ||
    slip?.id ||
    transaction.replaced_by_event?.slip_id ||
    transaction.replacement_event?.slip_id;

  const isVoided = Boolean(transaction.voided_at);
  const isEvidenceBacked =
    transaction.source !== "manual" ||
    Boolean(transaction.source_slip_id) ||
    Boolean(transaction.source_document_id) ||
    Boolean(activeSlipId);
  const canDelete = !isVoided && !isEvidenceBacked && !hasVoidHistory && !transaction.replacement_event && !transaction.replaced_by_event;

  const handleViewSlip = async () => {
    if (!activeSlipId) return;
    setIsLoadingSlip(true);
    setIsMissingBinary(false);
    setIsPreviewModalOpen(true);
    try {
      const res = await getSlipSignedPreviewUrlAction(activeSlipId);
      if (res.success && res.url) {
        setPreviewUrl(res.url);
      } else if (
        res.binaryStatus === "missing" ||
        res.error?.includes("ไม่พบไฟล์ต้นฉบับในพื้นที่จัดเก็บ")
      ) {
        setPreviewUrl(null);
        setIsMissingBinary(true);
      } else {
        alert(res.error || "ไม่สามารถโหลดภาพสลิปได้");
        setIsPreviewModalOpen(false);
      }
    } finally {
      setIsLoadingSlip(false);
    }
  };


  // Edit Action State
  const [editState, updateAction, isUpdating] = useActionState(
    async (prevState: unknown, formData: FormData) => {
      const res = await updateTransactionAction(
        transaction.id,
        prevState,
        formData
      );
      if (res.success) {
        setIsEditing(false);
      }
      return res;
    },
    { success: false, error: undefined }
  );

  const handleDelete = async () => {
    if (!confirm("คุณต้องการลบรายการนี้ใช่หรือไม่?")) return;
    setIsDeleting(true);
    const res = await deleteTransactionAction(transaction.id);
    if (res.success) {
      router.push("/transactions");
    } else {
      alert(res.error || "ไม่สามารถลบรายการได้ กรุณาลองใหม่อีกครั้ง");
      setIsDeleting(false);
    }
  };

  const formattedDateTime = formatDateTimeThai(transaction.transaction_date);

  return (
    <div className="max-w-xl mx-auto space-y-6 pb-6">
      {/* Back link */}
      <Link
        href="/transactions"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>กลับไปหน้ารายการ (Transactions)</span>
      </Link>

      {/* Main Card */}
      <div className={`bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm overflow-hidden ${isVoided ? "border-rose-200 dark:border-rose-900/50" : ""}`}>
        {/* Replaced By Banner (When this transaction was replaced by a newer one) */}
        {transaction.replaced_by_event && (
          <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-indigo-800 dark:text-indigo-300">
                <RefreshCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                <span>รายการนี้ถูกแทนที่ด้วยรายการใหม่</span>
              </div>
              <p className="text-indigo-700 dark:text-indigo-400">
                รหัสรายการทดแทน:{" "}
                <Link
                  href={`/transactions/${transaction.replaced_by_event.new_transaction_id}`}
                  className="font-mono font-semibold underline hover:text-indigo-950 dark:hover:text-indigo-200"
                >
                  {transaction.replaced_by_event.new_transaction_id.slice(0, 8)}...
                </Link>{" "}
                | รหัสสลิป: <span className="font-mono">{transaction.replaced_by_event.slip_id.slice(0, 8)}...</span>
              </p>
              {transaction.replaced_by_event.reason && (
                <p className="text-text-muted text-[11px]">
                  เหตุผล: {transaction.replaced_by_event.reason}
                </p>
              )}
            </div>
            <Link
              href={`/transactions/${transaction.replaced_by_event.new_transaction_id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-surface-soft font-semibold text-xs transition-colors flex-shrink-0"
            >
              <span>ไปยังรายการทดแทน</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Replacement Of Banner (When this transaction was created as a replacement for an old voided one) */}
        {transaction.replacement_event && (
          <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-indigo-800 dark:text-indigo-300">
                <RefreshCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                <span>สร้างแทนรายการที่ถูกยกเลิก</span>
              </div>
              <p className="text-indigo-700 dark:text-indigo-400">
                สร้างแทนรายการเดิม:{" "}
                <Link
                  href={`/transactions/${transaction.replacement_event.old_transaction_id}`}
                  className="font-mono font-semibold underline hover:text-indigo-950 dark:hover:text-indigo-200"
                >
                  {transaction.replacement_event.old_transaction_id.slice(0, 8)}...
                </Link>{" "}
                | รหัสสลิป: <span className="font-mono">{transaction.replacement_event.slip_id.slice(0, 8)}...</span>
              </p>
              {transaction.replacement_event.reason && (
                <p className="text-text-muted text-[11px]">
                  เหตุผล: {transaction.replacement_event.reason}
                </p>
              )}
            </div>
            <Link
              href={`/transactions/${transaction.replacement_event.old_transaction_id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-surface-soft font-semibold text-xs transition-colors flex-shrink-0"
            >
              <span>ดูรายการเดิม</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Voided Warning Banner */}
        {isVoided && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-rose-700 dark:text-rose-400">
                <Ban className="w-4 h-4 text-rose-600 dark:text-rose-400 flex-shrink-0" />
                <span>รายการนี้ถูกยกเลิกแล้ว (Voided) — ไม่ถูกนำไปคำนวณในยอดเงินคงเหลือหรือรายงานใดๆ</span>
              </div>
              {transaction.void_reason && (
                <p className="text-rose-600/90 dark:text-rose-400/90 pl-6">
                  เหตุผล: <span className="font-medium">{transaction.void_reason}</span>
                </p>
              )}
              {transaction.voided_at && (
                <p className="text-text-muted pl-6 text-[11px]">
                  ยกเลิกเมื่อ: {formatDateTimeThai(transaction.voided_at)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (transaction.replaced_by_event) {
                  alert("ไม่สามารถคืนรายการนี้ได้ เนื่องจากมีรายการทดแทนที่กำลังใช้งานอยู่ กรุณายกเลิกรายการทดแทนก่อน");
                  return;
                }
                setIsRestoreModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border text-text-primary hover:bg-surface-soft font-semibold text-xs transition-colors flex-shrink-0 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
              <span>กู้คืนรายการ</span>
            </button>
          </div>
        )}

        {/* Header Banner */}
        <div className="p-6 border-b border-border flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <TransactionTypeBadge type={transaction.type} />
              {isVoided && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                  <Ban className="w-3 h-3" />
                  <span>ยกเลิกแล้ว (Voided)</span>
                </span>
              )}
              {transaction.replaced_by_event && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  <RefreshCw className="w-3 h-3" />
                  <span>ถูกแทนที่แล้ว</span>
                </span>
              )}
              {transaction.replacement_event && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  <RefreshCw className="w-3 h-3" />
                  <span>รายการทดแทน</span>
                </span>
              )}
              <span className="text-xs font-medium text-text-muted">
                {transaction.source === "slip" || transaction.source === "shortcut"
                  ? "แหล่งที่มา: สลิปธนาคาร"
                  : `ที่มา: ${transaction.source}`}
              </span>
              {activeSlipId && (
                <button
                  type="button"
                  onClick={handleViewSlip}
                  disabled={isLoadingSlip}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold bg-surface-soft hover:bg-surface-muted border border-border rounded-lg text-text-primary transition-colors disabled:opacity-50"
                >
                  {isLoadingSlip ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  <span>ดูสลิป</span>
                </button>
              )}
            </div>
            <div className={isVoided ? "line-through opacity-60" : ""}>
              <MoneyAmount
                amount={transaction.amount}
                type={transaction.type}
                currency={transaction.currency}
                size="2xl"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isVoided ? (
              <>
                {!transaction.replaced_by_event && activeSlipId && (
                  <button
                    type="button"
                    onClick={() => setIsReplaceModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-colors"
                    title="สร้างรายการทดแทนจากสลิปเดิม"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>สร้างรายการทดแทนจากสลิปเดิม</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (transaction.replaced_by_event) {
                      alert("ไม่สามารถคืนรายการนี้ได้ เนื่องจากมีรายการทดแทนที่กำลังใช้งานอยู่ กรุณายกเลิกรายการทดแทนก่อน");
                      return;
                    }
                    setIsRestoreModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-soft hover:bg-surface-muted border border-border text-xs font-semibold text-text-primary transition-colors disabled:opacity-50"
                  title="กู้คืนรายการนี้"
                >
                  <RotateCcw className="w-4 h-4 text-emerald-600" />
                  <span>กู้คืนรายการ</span>
                </button>
              </>
            ) : !isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="p-2 rounded-xl bg-surface-soft hover:bg-surface-muted border border-border text-text-primary transition-colors"
                  title="แก้ไขรายการ"
                  aria-label="Edit transaction"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsVoidModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-xs font-semibold text-rose-600 dark:text-rose-400 transition-colors"
                  title="ยกเลิกรายการ (Void)"
                >
                  <Ban className="w-4 h-4" />
                  <span>ยกเลิก</span>
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="p-2 rounded-xl bg-expense-soft hover:opacity-80 text-expense transition-colors"
                    title="ลบรายการ"
                    aria-label="Delete transaction"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="p-2 rounded-xl bg-surface-soft hover:bg-surface-muted border border-border text-text-primary transition-colors"
                title="ยกเลิกการแก้ไข"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* View Mode */}
        {!isEditing ? (
          <div className="p-6 space-y-4 divide-y divide-border text-sm">
            {/* Transfer flow presentation if transfer */}
            {transaction.type === "transfer" && (
              <div className="pb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block mb-2">
                  เส้นทางการโอนเงิน (Transfer Flow)
                </span>
                <div className="flex items-center gap-3 p-3.5 bg-surface-soft rounded-xl border border-border">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-text-muted block">จากบัญชี</span>
                    <strong className="text-text-primary font-semibold truncate block">
                      {transaction.from_account?.name || "บัญชี"}
                    </strong>
                  </div>
                  <ArrowRight className="w-4 h-4 text-transfer flex-shrink-0" />
                  <div className="flex-1 min-w-0 text-right">
                    <span className="text-xs text-text-muted block">ไปยังบัญชี</span>
                    <strong className="text-text-primary font-semibold truncate block">
                      {transaction.to_account?.name || "บัญชี"}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {transaction.description && (
              <div className="pt-4 first:pt-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block mb-1">
                  รายละเอียด
                </span>
                <p className="text-text-primary font-medium">
                  {transaction.description}
                </p>
              </div>
            )}

            {/* Account (for income/expense) */}
            {transaction.type !== "transfer" && (
              <div className="pt-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-text-muted">
                  <Wallet className="w-4 h-4 text-text-muted" />
                  บัญชี
                </span>
                <span className="font-medium text-text-primary">
                  {transaction.type === "income"
                    ? transaction.to_account?.name || "ไม่ได้ระบุ"
                    : transaction.from_account?.name || "ไม่ได้ระบุ"}
                </span>
              </div>
            )}

            {/* Category */}
            {transaction.type !== "transfer" && (
              <div className="pt-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-text-muted">
                  <Tag className="w-4 h-4 text-text-muted" />
                  หมวดหมู่
                </span>
                <span className="font-medium text-text-primary">
                  {getCategoryDisplayName(transaction.category) || "ไม่มีหมวดหมู่"}
                </span>
              </div>
            )}

            {/* Counterparty (Merchant or Person) */}
            {transaction.merchant && (
              <div className="pt-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-text-muted">
                  <Store className="w-4 h-4 text-text-muted" />
                  ร้านค้า
                </span>
                <Link
                  href={`/merchants/${transaction.merchant.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {transaction.merchant.display_name}
                </Link>
              </div>
            )}

            {transaction.person && (
              <div className="pt-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-text-muted">
                  <User className="w-4 h-4 text-text-muted" />
                  บุคคล
                </span>
                <Link
                  href={`/people/${transaction.person.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {transaction.person.display_name}
                </Link>
              </div>
            )}

            {/* Date and Time */}
            <div className="pt-4 flex items-center justify-between">
              <span className="flex items-center gap-2 text-text-muted">
                <Calendar className="w-4 h-4 text-text-muted" />
                วันและเวลา
              </span>
              <span className="font-medium text-text-primary tabular-nums">
                {formattedDateTime}
              </span>
            </div>

            {/* Payment Method */}
            {transaction.payment_method && (
              <div className="pt-4 flex items-center justify-between">
                <span className="text-text-muted">ช่องทางการชำระ</span>
                <span className="font-medium text-text-primary">
                  {transaction.payment_method}
                </span>
              </div>
            )}

            {/* Audit & Confidence */}
            <div className="pt-4 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-text-muted">
                <ShieldCheck className="w-3.5 h-3.5 text-income" />
                ความมั่นใจ (Confidence)
              </span>
              <span className="font-semibold text-text-secondary tabular-nums">
                {Math.round(transaction.confidence * 100)}% ({transaction.review_status})
              </span>
            </div>

            {/* Note */}
            {transaction.note && (
              <div className="pt-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block mb-1">
                  บันทึกช่วยจำ
                </span>
                <p className="text-text-secondary bg-surface-soft p-3 rounded-xl border border-border text-xs leading-relaxed">
                  {transaction.note}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Edit Form */
          <form action={updateAction} className="p-6 space-y-4 text-sm">
            <input type="hidden" name="type" value={transaction.type} />
            <input type="hidden" name="currency" value={transaction.currency} />

            {editState.error && (
              <div className="p-3 text-xs text-expense bg-expense-soft border border-expense/30 rounded-xl">
                {editState.error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                จำนวนเงิน (THB)
              </label>
              <input
                type="number"
                name="amount"
                step="0.01"
                required
                defaultValue={transaction.amount}
                className="w-full p-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl tabular-nums focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                รายละเอียด
              </label>
              <input
                type="text"
                name="description"
                defaultValue={transaction.description || ""}
                className="w-full p-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Accounts */}
            {transaction.type === "transfer" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    จากบัญชี
                  </label>
                  <select
                    name="from_account_id"
                    defaultValue={transaction.from_account_id || ""}
                    className="w-full p-2 text-xs bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    ไปยังบัญชี
                  </label>
                  <select
                    name="to_account_id"
                    defaultValue={transaction.to_account_id || ""}
                    className="w-full p-2 text-xs bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  บัญชี
                </label>
                <select
                  name={
                    transaction.type === "income"
                      ? "to_account_id"
                      : "from_account_id"
                  }
                  defaultValue={
                    transaction.type === "income"
                      ? transaction.to_account_id || ""
                      : transaction.from_account_id || ""
                  }
                  className="w-full p-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Category */}
            {transaction.type !== "transfer" && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  หมวดหมู่
                </label>
                <select
                  name="category_id"
                  defaultValue={transaction.category_id || ""}
                  className="w-full p-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
                >
                  <option value="">ไม่มีหมวดหมู่</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {getCategoryDisplayName(c)} ({c.type === "expense" ? "รายจ่าย" : "รายรับ"})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Counterparties */}
            {transaction.type !== "transfer" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    ร้านค้า
                  </label>
                  <select
                    name="merchant_id"
                    defaultValue={transaction.merchant_id || ""}
                    className="w-full p-2 text-xs bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
                  >
                    <option value="">ไม่ระบุ</option>
                    {merchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    บุคคล
                  </label>
                  <select
                    name="person_id"
                    defaultValue={transaction.person_id || ""}
                    className="w-full p-2 text-xs bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
                  >
                    <option value="">ไม่ระบุ</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                วันและเวลา
              </label>
              <input
                type="datetime-local"
                name="transaction_date"
                defaultValue={canonicalInstantToBangkokDateTimeLocal(transaction.transaction_date)}
                required
                className="w-full p-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                บันทึกช่วยจำ
              </label>
              <textarea
                name="note"
                rows={2}
                defaultValue={transaction.note || ""}
                className="w-full p-2.5 text-sm bg-surface border border-border text-text-primary rounded-xl focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover rounded-xl disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{isUpdating ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Private Slip Preview Modal */}
      {isPreviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div
            className="fixed inset-0"
            onClick={() => {
              setIsPreviewModalOpen(false);
              setPreviewUrl(null);
              setIsMissingBinary(false);
            }}
            aria-hidden="true"
          />
          <div className="relative max-w-lg w-full bg-surface rounded-2xl border border-border shadow-2xl p-4 z-10 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="font-semibold text-xs text-text-primary">
                สลิปธนาคาร (Private Preview)
              </span>
              <button
                onClick={() => {
                  setIsPreviewModalOpen(false);
                  setPreviewUrl(null);
                  setIsMissingBinary(false);
                }}
                className="p-1 text-text-muted hover:text-text-primary rounded-md hover:bg-surface-soft transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isLoadingSlip && (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-text-muted">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-xs">กำลังตรวจสอบและโหลดหลักฐาน...</span>
              </div>
            )}

            {!isLoadingSlip && isMissingBinary && (
              <div className="py-6 px-4 space-y-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-text-primary">
                    ไม่พบไฟล์ต้นฉบับในพื้นที่จัดเก็บ
                  </h4>
                  <p className="text-xs text-text-muted max-w-sm mx-auto">
                    ข้อมูลสลิปและรหัสตรวจสอบความถูกต้อง (SHA-256) ยังคงอยู่ในระบบ แต่ไฟล์ภาพต้นฉบับใน Storage สูญหายหรือถูกลบ
                  </p>
                </div>
                {activeSlipId && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsPreviewModalOpen(false);
                      setIsRestoreBinaryModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-xs transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>กู้คืนไฟล์หลักฐานเดิม</span>
                  </button>
                )}
              </div>
            )}

            {!isLoadingSlip && previewUrl && (
              <div className="flex items-center justify-center max-h-[75vh] overflow-hidden rounded-xl bg-slate-950">
                <img
                  src={previewUrl}
                  alt="Slip preview"
                  className="max-h-[70vh] object-contain"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Replace Slip Transaction Modal */}
      {activeSlipId && (
        <ReplaceSlipTransactionModal
          isOpen={isReplaceModalOpen}
          transaction={transaction}
          slip={slip}
          accounts={accounts}
          categories={categories}
          merchants={merchants}
          people={people}
          onClose={() => setIsReplaceModalOpen(false)}
          onSuccess={(newTxId) => {
            setIsReplaceModalOpen(false);
            router.push(`/transactions/${newTxId}`);
          }}
        />
      )}

      {/* Restore Slip Binary Modal */}
      {activeSlipId && (
        <RestoreSlipBinaryModal
          isOpen={isRestoreBinaryModalOpen}
          slipId={activeSlipId}
          onClose={() => setIsRestoreBinaryModalOpen(false)}
          onSuccess={() => {
            setIsRestoreBinaryModalOpen(false);
            handleViewSlip();
          }}
        />
      )}

      {/* Void Transaction Modal */}
      <VoidTransactionModal
        isOpen={isVoidModalOpen}
        transactionId={transaction.id}
        transactionDescription={
          transaction.description ||
          transaction.merchant?.display_name ||
          transaction.person?.display_name ||
          getCategoryDisplayName(transaction.category)
        }
        amount={transaction.amount}
        currency={transaction.currency}
        onClose={() => setIsVoidModalOpen(false)}
        onSuccess={() => {
          setIsVoidModalOpen(false);
          router.refresh();
        }}
      />

      {/* Restore Transaction Modal */}
      <RestoreTransactionModal
        isOpen={isRestoreModalOpen}
        transactionId={transaction.id}
        transactionDescription={
          transaction.description ||
          transaction.merchant?.display_name ||
          transaction.person?.display_name ||
          getCategoryDisplayName(transaction.category)
        }
        amount={transaction.amount}
        currency={transaction.currency}
        onClose={() => setIsRestoreModalOpen(false)}
        onSuccess={() => {
          setIsRestoreModalOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
