"use client";

import React, { useState, useActionState } from "react";
import { Account, AccountBalance } from "@/types/finance";
import {
  archiveAccountAction,
  createAccountAction,
  updateAccountAction,
} from "@/app/actions/accounts";
import { AccountCard } from "@/components/ui/AccountCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { canonicalInstantToBangkokDateTimeLocal } from "@/lib/finance/formatters";
import {
  Plus,
  Landmark,
  X,
  Check,
  Archive,
  Edit2,
} from "lucide-react";

interface AccountsClientProps {
  initialAccountBalances: AccountBalance[];
}

export function AccountsClient({
  initialAccountBalances,
}: AccountsClientProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [addHasBaseline, setAddHasBaseline] = useState(false);
  const [editHasBaseline, setEditHasBaseline] = useState(false);

  // Create Form State
  const [createState, createAction, isCreating] = useActionState(
    async (prevState: unknown, formData: FormData) => {
      const res = await createAccountAction(prevState, formData);
      if (res.success) {
        setShowAddModal(false);
      }
      return res;
    },
    { success: false, error: undefined }
  );

  // Update Form State
  const [updateState, updateAction, isUpdating] = useActionState(
    async (prevState: unknown, formData: FormData) => {
      if (!editingAccount) return { success: false };
      const res = await updateAccountAction(
        editingAccount.id,
        prevState,
        formData
      );
      if (res.success) {
        setEditingAccount(null);
      }
      return res;
    },
    { success: false, error: undefined }
  );

  const handleArchive = async (id: string) => {
    if (!confirm("คุณต้องการเก็บถาวร (Archive) บัญชีนี้ใช่หรือไม่?")) return;
    await archiveAccountAction(id);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted font-medium">
          {initialAccountBalances.length} บัญชีที่ใช้งาน
        </p>

        <button
          onClick={() => {
            setAddHasBaseline(false);
            setShowAddModal(true);
          }}
          aria-label="Add Account"
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Add Account</span>
        </button>
      </div>

      {initialAccountBalances.length === 0 ? (
        <EmptyState
          icon={<Landmark className="w-8 h-8 text-text-muted" />}
          title="ยังไม่มีบัญชี"
          description="เพิ่มบัญชีธนาคาร เงินสด หรือ E-wallet เพื่อเริ่มติดตามยอดเงิน"
          onAction={() => {
            setAddHasBaseline(false);
            setShowAddModal(true);
          }}
          actionLabel="+ เพิ่มบัญชี"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {initialAccountBalances.map((ab) => (
            <div key={ab.account.id} className="relative group">
              <AccountCard accountBalance={ab} />
              <div className="absolute top-3.5 right-3.5 flex items-center gap-1 bg-surface/90 p-1 rounded-lg border border-border opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    setEditingAccount(ab.account);
                    setEditHasBaseline(Boolean(ab.account.balance_as_of));
                  }}
                  className="p-1 text-text-muted hover:text-text-primary rounded"
                  title="แก้ไขบัญชี"
                  aria-label="Edit Account"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleArchive(ab.account.id)}
                  className="p-1 text-expense hover:opacity-80 rounded"
                  title="เก็บถาวรบัญชี"
                  aria-label="Archive Account"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-surface dark:bg-surface-raised rounded-2xl p-6 max-w-md w-full shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-semibold text-base text-text-primary">
                เพิ่มบัญชีการเงินใหม่ (Add Account)
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-text-muted hover:text-text-primary"
                aria-label="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form action={createAction} className="space-y-3.5">
              {createState.error && (
                <div className="p-3 text-xs text-expense bg-expense-soft rounded-xl border border-expense/30">
                  {createState.error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  ชื่อบัญชี (Account Name)
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="เช่น SCB หลัก, KBank เงินเดือน, กระเป๋าตังค์"
                  className="w-full px-3 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    ประเภทบัญชี
                  </label>
                  <select
                    name="type"
                    required
                    defaultValue="bank"
                    className="w-full p-2 text-xs bg-surface border border-border text-text-primary rounded-xl"
                  >
                    <option value="bank">ธนาคาร (Bank)</option>
                    <option value="cash">เงินสด (Cash)</option>
                    <option value="e_wallet">E-Wallet</option>
                    <option value="credit_card">บัตรเครดิต (Credit Card)</option>
                    <option value="investment">การลงทุน (Investment)</option>
                    <option value="other">อื่น ๆ (Other)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    สถาบันการเงิน (Institution)
                  </label>
                  <input
                    type="text"
                    name="institution"
                    placeholder="เช่น SCB, KBANK, TrueMoney"
                    className="w-full px-3 py-2 text-xs bg-surface border border-border text-text-primary rounded-xl"
                  >
                  </input>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    ยอดเงินตั้งต้น (Opening Balance)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="opening_balance"
                    defaultValue="0"
                    className="w-full px-3 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    เลขท้าย 4 หลัก (Masked Number)
                  </label>
                  <input
                    type="text"
                    name="masked_number"
                    placeholder="เช่น 1234"
                    maxLength={10}
                    className="w-full px-3 py-2 text-xs bg-surface border border-border text-text-primary rounded-xl"
                  />
                </div>
              </div>

              {/* Baseline Choice */}
              <div className="p-3 bg-surface-soft rounded-xl border border-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-text-primary">
                    การกำหนดจุดอ้างอิงยอดคงเหลือ (Balance Baseline)
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setAddHasBaseline(false)}
                    className={`px-2.5 py-1.5 rounded-lg border text-center font-medium transition-all ${
                      !addHasBaseline
                        ? "bg-surface text-text-primary border-primary/50 shadow-xs font-semibold"
                        : "bg-surface/50 text-text-muted border-transparent hover:text-text-secondary"
                    }`}
                  >
                    ยอดตั้งต้นทั่วไป
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddHasBaseline(true)}
                    className={`px-2.5 py-1.5 rounded-lg border text-center font-medium transition-all ${
                      addHasBaseline
                        ? "bg-surface text-text-primary border-primary/50 shadow-xs font-semibold"
                        : "bg-surface/50 text-text-muted border-transparent hover:text-text-secondary"
                    }`}
                  >
                    กำหนดยอดคงเหลือ ณ วันที่/เวลา
                  </button>
                </div>

                {addHasBaseline ? (
                  <div className="space-y-1.5 pt-1">
                    <label className="block text-[11px] font-medium text-text-secondary">
                      ยอดคงเหลือ ณ วันที่และเวลา (Asia/Bangkok)
                    </label>
                    <input
                      type="datetime-local"
                      name="balance_as_of"
                      defaultValue={canonicalInstantToBangkokDateTimeLocal(new Date())}
                      className="w-full px-3 py-1.5 text-xs bg-surface border border-border text-text-primary rounded-xl"
                    />
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      รายการก่อนหรือเท่ากับเวลานี้จะยังอยู่ในประวัติ แต่จะไม่ถูกนำมาคำนวณยอดคงเหลือปัจจุบันซ้ำ
                    </p>
                  </div>
                ) : (
                  <input type="hidden" name="balance_as_of" value="" />
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  aria-label="Create Account"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover rounded-xl disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>{isCreating ? "กำลังบันทึก..." : "Create Account"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-surface dark:bg-surface-raised rounded-2xl p-6 max-w-md w-full shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-semibold text-base text-text-primary">
                แก้ไขบัญชี: {editingAccount.name}
              </h3>
              <button
                onClick={() => setEditingAccount(null)}
                className="text-text-muted hover:text-text-primary"
                aria-label="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form action={updateAction} className="space-y-3.5">
              {updateState.error && (
                <div className="p-3 text-xs text-expense bg-expense-soft rounded-xl border border-expense/30">
                  {updateState.error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  ชื่อบัญชี (Account Name)
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={editingAccount.name}
                  className="w-full px-3 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    ประเภท
                  </label>
                  <select
                    name="type"
                    required
                    defaultValue={editingAccount.type}
                    className="w-full p-2 text-xs bg-surface border border-border text-text-primary rounded-xl"
                  >
                    <option value="bank">ธนาคาร (Bank)</option>
                    <option value="cash">เงินสด (Cash)</option>
                    <option value="e_wallet">E-Wallet</option>
                    <option value="credit_card">บัตรเครดิต (Credit Card)</option>
                    <option value="investment">การลงทุน (Investment)</option>
                    <option value="other">อื่น ๆ (Other)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    สถาบันการเงิน
                  </label>
                  <input
                    type="text"
                    name="institution"
                    defaultValue={editingAccount.institution || ""}
                    className="w-full px-3 py-2 text-xs bg-surface border border-border text-text-primary rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    ยอดเงินตั้งต้น
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="opening_balance"
                    defaultValue={editingAccount.opening_balance}
                    className="w-full px-3 py-2 text-sm bg-surface border border-border text-text-primary rounded-xl tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    เลขท้าย 4 หลัก
                  </label>
                  <input
                    type="text"
                    name="masked_number"
                    defaultValue={editingAccount.masked_number || ""}
                    maxLength={10}
                    className="w-full px-3 py-2 text-xs bg-surface border border-border text-text-primary rounded-xl"
                  />
                </div>
              </div>

              {/* Baseline Choice */}
              <div className="p-3 bg-surface-soft rounded-xl border border-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-text-primary">
                    การกำหนดจุดอ้างอิงยอดคงเหลือ (Balance Baseline)
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setEditHasBaseline(false)}
                    className={`px-2.5 py-1.5 rounded-lg border text-center font-medium transition-all ${
                      !editHasBaseline
                        ? "bg-surface text-text-primary border-primary/50 shadow-xs font-semibold"
                        : "bg-surface/50 text-text-muted border-transparent hover:text-text-secondary"
                    }`}
                  >
                    ยอดตั้งต้นทั่วไป
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditHasBaseline(true)}
                    className={`px-2.5 py-1.5 rounded-lg border text-center font-medium transition-all ${
                      editHasBaseline
                        ? "bg-surface text-text-primary border-primary/50 shadow-xs font-semibold"
                        : "bg-surface/50 text-text-muted border-transparent hover:text-text-secondary"
                    }`}
                  >
                    กำหนดยอดคงเหลือ ณ วันที่/เวลา
                  </button>
                </div>

                {editHasBaseline ? (
                  <div className="space-y-1.5 pt-1">
                    <label className="block text-[11px] font-medium text-text-secondary">
                      ยอดคงเหลือ ณ วันที่และเวลา (Asia/Bangkok)
                    </label>
                    <input
                      type="datetime-local"
                      name="balance_as_of"
                      defaultValue={
                        editingAccount.balance_as_of
                          ? canonicalInstantToBangkokDateTimeLocal(editingAccount.balance_as_of)
                          : canonicalInstantToBangkokDateTimeLocal(new Date())
                      }
                      className="w-full px-3 py-1.5 text-xs bg-surface border border-border text-text-primary rounded-xl"
                    />
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      รายการก่อนหรือเท่ากับเวลานี้จะยังอยู่ในประวัติ แต่จะไม่ถูกนำมาคำนวณยอดคงเหลือปัจจุบันซ้ำ
                    </p>
                  </div>
                ) : (
                  <input type="hidden" name="balance_as_of" value="" />
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
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
          </div>
        </div>
      )}
    </div>
  );
}
