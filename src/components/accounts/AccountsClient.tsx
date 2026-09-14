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
        <p className="text-xs text-slate-500 font-medium">
          {initialAccountBalances.length} บัญชีที่ใช้งาน
        </p>

        <button
          onClick={() => setShowAddModal(true)}
          aria-label="Add Account"
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Add Account</span>
        </button>
      </div>

      {initialAccountBalances.length === 0 ? (
        <EmptyState
          icon={<Landmark className="w-8 h-8 text-slate-400" />}
          title="ยังไม่มีบัญชี"
          description="เพิ่มบัญชีธนาคาร เงินสด หรือ E-wallet เพื่อเริ่มติดตามยอดเงิน"
          onAction={() => setShowAddModal(true)}
          actionLabel="+ เพิ่มบัญชี"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {initialAccountBalances.map((ab) => (
            <div key={ab.account.id} className="relative group">
              <AccountCard accountBalance={ab} />
              <div className="absolute top-3.5 right-3.5 flex items-center gap-1 bg-white/90 p-1 rounded-lg border border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setEditingAccount(ab.account)}
                  className="p-1 text-slate-500 hover:text-slate-900 rounded"
                  title="แก้ไขบัญชี"
                  aria-label="Edit Account"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleArchive(ab.account.id)}
                  className="p-1 text-rose-500 hover:text-rose-700 rounded"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-base text-slate-900">
                เพิ่มบัญชีใหม่ (Add Account)
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form action={createAction} className="space-y-3.5">
              {createState.error && (
                <div className="p-3 text-xs text-rose-700 bg-rose-50 rounded-xl border border-rose-200">
                  {createState.error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ชื่อบัญชี (Account Name)
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="เช่น SCB Main Account, เงินสด, KBank ออมทรัพย์"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ประเภท (Type)
                  </label>
                  <select
                    name="type"
                    required
                    defaultValue="bank"
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    สถาบันการเงิน (Institution)
                  </label>
                  <input
                    type="text"
                    name="institution"
                    placeholder="เช่น SCB, KBANK, BBL"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ยอดเงินตั้งต้น (Opening Balance)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="opening_balance"
                    defaultValue="0"
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    เลขท้าย 4 หลัก (Masked Number)
                  </label>
                  <input
                    type="text"
                    name="masked_number"
                    placeholder="เช่น 1234"
                    maxLength={10}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  aria-label="Create Account"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-base text-slate-900">
                แก้ไขบัญชี: {editingAccount.name}
              </h3>
              <button
                onClick={() => setEditingAccount(null)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form action={updateAction} className="space-y-3.5">
              {updateState.error && (
                <div className="p-3 text-xs text-rose-700 bg-rose-50 rounded-xl border border-rose-200">
                  {updateState.error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ชื่อบัญชี (Account Name)
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={editingAccount.name}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ประเภท
                  </label>
                  <select
                    name="type"
                    required
                    defaultValue={editingAccount.type}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    สถาบันการเงิน
                  </label>
                  <input
                    type="text"
                    name="institution"
                    defaultValue={editingAccount.institution || ""}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ยอดเงินตั้งต้น
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="opening_balance"
                    defaultValue={editingAccount.opening_balance}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    เลขท้าย 4 หลัก
                  </label>
                  <input
                    type="text"
                    name="masked_number"
                    defaultValue={editingAccount.masked_number || ""}
                    maxLength={10}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 disabled:opacity-50"
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
