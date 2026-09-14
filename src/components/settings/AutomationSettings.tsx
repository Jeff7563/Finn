"use client";

import React, { useState } from "react";
import Link from "next/link";
import { IngestToken } from "@/types/slip";
import {
  createIngestTokenAction,
  revokeIngestTokenAction,
} from "@/app/actions/slip-tokens";
import {
  Smartphone,
  Key,
  Copy,
  Check,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Plus,
  ShieldCheck,
} from "lucide-react";

interface AutomationSettingsProps {
  initialTokens: IngestToken[];
}

export function AutomationSettings({ initialTokens }: AutomationSettingsProps) {
  const [tokens, setTokens] = useState<IngestToken[]>(initialTokens);
  const [label, setLabel] = useState("iPhone 11 Pro Max");
  const [isCreating, setIsCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const activeTokens = tokens.filter((t) => !t.revoked_at);
  const isConnected = activeTokens.length > 0;
  const latestUsedToken = activeTokens
    .filter((t) => t.last_used_at)
    .sort(
      (a, b) =>
        new Date(b.last_used_at!).getTime() - new Date(a.last_used_at!).getTime()
    )[0];

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);
    try {
      const res = await createIngestTokenAction(label);
      if (res.success && res.rawToken && res.token) {
        setRevealedToken(res.rawToken);
        setTokens([res.token, ...tokens]);
      } else {
        setError(res.error || "ไม่สามารถสร้าง Token ได้");
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeToken = async (id: string) => {
    if (!confirm("คุณต้องการยกเลิก Token นี้ใช่หรือไม่? Shortcut ที่ใช้อยู่จะไม่สามารถส่งสลิปได้อีกต่อไป")) {
      return;
    }
    setRevokingId(id);
    try {
      const res = await revokeIngestTokenAction(id);
      if (res.success) {
        setTokens(
          tokens.map((t) =>
            t.id === id ? { ...t, revoked_at: new Date().toISOString() } : t
          )
        );
        if (revealedToken) {
          setRevealedToken(null);
        }
      } else {
        alert(res.error || "ไม่สามารถยกเลิก Token ได้");
      }
    } finally {
      setRevokingId(null);
    }
  };

  const copyToClipboard = () => {
    if (!revealedToken) return;
    navigator.clipboard.writeText(revealedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-sm">
          <Smartphone className="w-4 h-4 text-text-muted" />
          <span>Automation / iPhone Shortcut</span>
        </div>
        <Link
          href="/settings/automation/ios"
          className="inline-flex items-center gap-1.5 text-xs text-primary dark:text-primary font-medium hover:underline"
        >
          <span>คู่มือติดตั้ง iPhone Shortcut</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Connection Status Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="p-3.5 bg-surface-soft rounded-xl border border-border space-y-1">
          <span className="text-text-muted font-medium block">สถานะการเชื่อมต่อ</span>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-income" : "bg-text-muted"
              }`}
            />
            <span className="font-semibold text-text-primary">
              {isConnected ? "เชื่อมต่อแล้ว (พร้อมรับสลิป)" : "ยังไม่ได้เชื่อมต่อ"}
            </span>
          </div>
        </div>

        <div className="p-3.5 bg-surface-soft rounded-xl border border-border space-y-1">
          <span className="text-text-muted font-medium block">ใช้งานล่าสุด</span>
          <span className="font-semibold text-text-primary">
            {latestUsedToken?.last_used_at
              ? new Date(latestUsedToken.last_used_at).toLocaleString("th-TH")
              : "ยังไม่มีประวัติการส่งสลิป"}
          </span>
        </div>
      </div>

      {/* One-Time Revealed Token Alert */}
      {revealedToken && (
        <div className="p-4 bg-income-soft dark:bg-income/10 border border-income/30 rounded-xl space-y-3 animate-in fade-in">
          <div className="flex items-start gap-2 text-income font-semibold text-xs">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <span>สร้าง Ingest Token สำเร็จ — แสดงเพียงครั้งเดียวเท่านั้น</span>
              <p className="font-normal text-text-secondary mt-0.5">
                กรุณาคัดลอก Token นี้ไปใส่ใน Shortcut ทันที Finn จะไม่แสดงรหัสนี้ซ้ำอีก
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-surface p-2.5 rounded-lg border border-border font-mono text-xs text-text-primary break-all">
            <span className="flex-1 select-all">{revealedToken}</span>
            <button
              onClick={copyToClipboard}
              className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md flex items-center gap-1.5 transition-transform active:scale-95 flex-shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>คัดลอกแล้ว</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>คัดลอก</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-start gap-1.5 text-[11px] text-expense leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              คำเตือนความปลอดภัย: อย่าแชร์ Shortcut ที่ฝัง Token นี้ให้ผู้อื่น หากอุปกรณ์หายหรือ Token รั่ว ให้กดยกเลิก Token ด้านล่างทันที
            </span>
          </div>
        </div>
      )}

      {/* Error Notice */}
      {error && (
        <div className="p-3 bg-expense-soft text-expense border border-expense/30 rounded-xl text-xs">
          {error}
        </div>
      )}

      {/* Create Token Form */}
      <form onSubmit={handleCreateToken} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="ชื่ออุปกรณ์ เช่น iPhone 11 Pro Max"
          required
          maxLength={50}
          className="flex-1 px-3 py-2 text-xs rounded-xl bg-surface-soft border border-border text-text-primary placeholder:text-text-muted focus:outline-hidden focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={isCreating}
          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-primary dark:hover:bg-primary-hover text-white dark:text-primary-foreground text-xs font-semibold rounded-xl shadow-xs transition-all active:scale-[0.99] disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isCreating ? "กำลังสร้าง..." : "สร้าง Ingest Token"}</span>
        </button>
      </form>

      {/* Existing Tokens Table */}
      <div className="space-y-2 pt-2">
        <span className="text-xs font-medium text-text-muted block">
          รายการ Token ที่ใช้งานอยู่ ({activeTokens.length})
        </span>

        {tokens.length === 0 ? (
          <p className="text-xs text-text-muted py-2">
            ยังไม่มี Ingest Token กดปุ่มสร้าง Token เพื่อเริ่มเชื่อมต่อกับ iPhone
          </p>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => {
              const isRevoked = Boolean(token.revoked_at);
              return (
                <div
                  key={token.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border text-xs gap-3 transition-colors ${
                    isRevoked
                      ? "bg-surface-soft/40 border-border/50 opacity-60"
                      : "bg-surface-soft border-border"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text-primary">
                        {token.label}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          isRevoked
                            ? "bg-expense-soft text-expense"
                            : "bg-income-soft text-income"
                        }`}
                      >
                        {isRevoked ? "ยกเลิกแล้ว (Revoked)" : "พร้อมใช้งาน (Active)"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-text-muted font-mono text-[11px]">
                      <Key className="w-3 h-3" />
                      <span>{token.token_prefix}</span>
                      <span>·</span>
                      <span>สิทธิ์: {token.scope}</span>
                    </div>
                    <p className="text-[11px] text-text-muted">
                      สร้างเมื่อ: {new Date(token.created_at).toLocaleDateString("th-TH")}
                      {token.last_used_at &&
                        ` · ใช้ล่าสุด: ${new Date(token.last_used_at).toLocaleString("th-TH")}`}
                    </p>
                  </div>

                  {!isRevoked && (
                    <button
                      onClick={() => handleRevokeToken(token.id)}
                      disabled={revokingId === token.id}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-expense-soft hover:opacity-80 text-expense font-semibold rounded-lg transition-colors self-end sm:self-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{revokingId === token.id ? "กำลังยกเลิก..." : "ยกเลิก Token"}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
