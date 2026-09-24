"use client";

import React, { useState } from "react";
import { X, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import {
  Account,
  Category,
  Merchant,
  Person,
  TransactionType,
  TransactionWithRelations,
} from "@/types/finance";
import { Slip } from "@/types/slip";
import { replaceVoidedSlipTransactionAction } from "@/app/actions/transactions";

interface ReplaceSlipTransactionModalProps {
  isOpen: boolean;
  transaction: TransactionWithRelations;
  slip?: Slip | null;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  merchants: Merchant[];
  onClose: () => void;
  onSuccess: (newTxId: string) => void;
}

export function ReplaceSlipTransactionModal({
  isOpen,
  transaction,
  slip,
  accounts,
  categories,
  people,
  merchants,
  onClose,
  onSuccess,
}: ReplaceSlipTransactionModalProps) {
  const initialDateStr = transaction.transaction_date
    ? new Date(transaction.transaction_date).toISOString().slice(0, 16)
    : new Date().toISOString().slice(0, 16);

  const [type, setType] = useState<TransactionType>(transaction.type || "expense");
  const [amount, setAmount] = useState<string>(String(transaction.amount || ""));
  const [dateTime, setDateTime] = useState<string>(initialDateStr);
  const [description, setDescription] = useState<string>(transaction.description || "");
  const [note, setNote] = useState<string>(transaction.note || "");
  const [fromAccountId, setFromAccountId] = useState<string>(transaction.from_account_id || "");
  const [toAccountId, setToAccountId] = useState<string>(transaction.to_account_id || "");
  const [categoryId, setCategoryId] = useState<string>(transaction.category_id || "");
  const [merchantId, setMerchantId] = useState<string>(transaction.merchant_id || "");
  const [personId, setPersonId] = useState<string>(transaction.person_id || "");
  const [reason, setReason] = useState<string>("แก้ไขข้อมูลรายการที่บันทึกผิดพลาด");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const slipId = transaction.source_slip_id || slip?.id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slipId) {
      setErrorMessage("ไม่พบหลักฐานสลิปสำหรับสร้างรายการทดแทน");
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMessage("จำนวนเงินต้องมากกว่า 0");
      return;
    }

    if (!reason.trim()) {
      setErrorMessage("กรุณาระบุเหตุผลในการสร้างรายการทดแทน");
      return;
    }

    if (type === "expense" && !fromAccountId) {
      setErrorMessage("กรุณาเลือกบัญชีที่จ่ายเงิน");
      return;
    }

    if (type === "income" && !toAccountId) {
      setErrorMessage("กรุณาเลือกบัญชีที่รับเงิน");
      return;
    }

    if (type === "transfer") {
      if (!fromAccountId || !toAccountId) {
        setErrorMessage("การโอนเงินต้องระบุทั้งบัญชีต้นทางและปลายทาง");
        return;
      }
      if (fromAccountId === toAccountId) {
        setErrorMessage("บัญชีต้นทางและปลายทางต้องไม่ซ้ำกัน");
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await replaceVoidedSlipTransactionAction({
        old_transaction_id: transaction.id,
        slip_id: slipId,
        reason: reason.trim(),
        type,
        amount: numAmount,
        currency: transaction.currency || "THB",
        transaction_date: new Date(dateTime).toISOString(),
        description: description.trim() || null,
        note: note.trim() || null,
        from_account_id: type === "income" ? null : fromAccountId || null,
        to_account_id: type === "expense" ? null : toAccountId || null,
        category_id: type === "transfer" ? null : categoryId || null,
        merchant_id: type === "transfer" ? null : merchantId || null,
        person_id: type === "transfer" ? null : personId || null,
        reference_number: transaction.reference_number || null,
      });

      if (res.success && res.newTransactionId) {
        onSuccess(res.newTransactionId);
        onClose();
      } else {
        setErrorMessage(res.error || "เกิดข้อผิดพลาดในการสร้างรายการทดแทน");
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
      <div className="relative max-w-lg w-full bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-2xl p-5 z-10 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold text-sm text-text-primary">
              สร้างรายการทดแทนจากสลิปเดิม
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
        <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 rounded-xl text-xs space-y-1">
          <p className="font-semibold text-indigo-800 dark:text-indigo-300">
            สร้างรายการใหม่โดยใช้หลักฐานสลิปเดิม
          </p>
          <p className="text-indigo-700 dark:text-indigo-400/90 leading-relaxed">
            รายการเดิมที่ถูกยกเลิกจะยังคงอยู่ในระบบเพื่อการตรวจสอบ
            และหลักฐานสลิปจะถูกเชื่อมโยงไปยังรายการทดแทนใหม่นี้อย่างถูกต้อง
          </p>
        </div>

        {/* Error Feedback */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 rounded-xl text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {/* Reason */}
          <div>
            <label className="block font-semibold text-text-muted mb-1">
              เหตุผลในการสร้างรายการทดแทน <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น แก้ไขจำนวนเงินและหมวดหมู่ที่ระบุผิดพลาด"
              className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Type Selection */}
          <div>
            <label className="block font-semibold text-text-muted mb-1">
              ประเภทรายการ
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setType("expense")}
                className={`py-2 px-3 rounded-xl border text-center font-semibold transition-all ${
                  type === "expense"
                    ? "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 shadow-xs"
                    : "border-border text-text-muted hover:bg-surface-soft"
                }`}
              >
                รายจ่าย
              </button>
              <button
                type="button"
                onClick={() => setType("income")}
                className={`py-2 px-3 rounded-xl border text-center font-semibold transition-all ${
                  type === "income"
                    ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 shadow-xs"
                    : "border-border text-text-muted hover:bg-surface-soft"
                }`}
              >
                รายรับ
              </button>
              <button
                type="button"
                onClick={() => setType("transfer")}
                className={`py-2 px-3 rounded-xl border text-center font-semibold transition-all ${
                  type === "transfer"
                    ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 shadow-xs"
                    : "border-border text-text-muted hover:bg-surface-soft"
                }`}
              >
                โอนเงิน
              </button>
            </div>
          </div>

          {/* Amount & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-text-muted mb-1">
                จำนวนเงิน (฿) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
              />
            </div>
            <div>
              <label className="block font-semibold text-text-muted mb-1">
                วันและเวลา <span className="text-rose-500">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={dateTime}
                onChange={(e) => setDateTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          {/* Accounts */}
          {type === "transfer" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-text-muted mb-1">
                  จากบัญชี <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
                >
                  <option value="">เลือกบัญชีต้นทาง</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-text-muted mb-1">
                  ไปยังบัญชี <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
                >
                  <option value="">เลือกบัญชีปลายทาง</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : type === "expense" ? (
            <div>
              <label className="block font-semibold text-text-muted mb-1">
                จากบัญชี <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
              >
                <option value="">เลือกบัญชีที่จ่ายเงิน</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block font-semibold text-text-muted mb-1">
                เข้าบัญชี <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
              >
                <option value="">เลือกบัญชีที่รับเงิน</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Category (if not transfer) */}
          {type !== "transfer" && (
            <div>
              <label className="block font-semibold text-text-muted mb-1">
                หมวดหมู่
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
              >
                <option value="">ไม่ระบุหมวดหมู่</option>
                {categories
                  .filter((cat) => !cat.type || cat.type === type)
                  .map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Description & Note */}
          <div>
            <label className="block font-semibold text-text-muted mb-1">
              รายละเอียด
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ระบุรายละเอียดรายการ"
              className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block font-semibold text-text-muted mb-1">
              บันทึกช่วยจำ (Note)
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="บันทึกเพิ่มเติม"
              className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Counterparty (Merchant / Person) if not transfer */}
          {type !== "transfer" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-text-muted mb-1">
                  ร้านค้า / ผู้รับเงิน (Merchant)
                </label>
                <select
                  value={merchantId}
                  onChange={(e) => setMerchantId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
                >
                  <option value="">ไม่ระบุร้านค้า</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-text-muted mb-1">
                  บุคคลที่เกี่ยวข้อง (Person)
                </label>
                <select
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-soft border border-border text-text-primary focus:outline-hidden focus:border-indigo-500 transition-colors"
                >
                  <option value="">ไม่ระบุบุคคล</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
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
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded-xl disabled:opacity-50 transition-colors shadow-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังสร้างรายการทดแทน...</span>
                </>
              ) : (
                <span>ยืนยันสร้างรายการทดแทน</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
