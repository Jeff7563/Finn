import React from "react";
import { requireUser } from "@/lib/server/auth";
import { signOutAction } from "@/app/actions/auth";
import {
  Shield,
  Coins,
  Globe,
  LogOut,
  Code2,
  FileSpreadsheet,
  UserCheck,
  SunMoon,
} from "lucide-react";
import { SeedSampleDataButton } from "@/components/settings/SeedSampleDataButton";
import { ThemeSettingsControl } from "@/components/settings/ThemeSettingsControl";
import { AutomationSettings } from "@/components/settings/AutomationSettings";
import { DataStore } from "@/lib/server/data-store";

export default async function SettingsPage() {
  const user = await requireUser();
  const tokens = await DataStore.getIngestTokens(user.id);

  const userInitial = user.display_name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase() || "U";
  const userDisplayName = user.display_name || user.email?.split("@")[0] || "ผู้ใช้งาน";

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-6">
      {/* Header */}
      <div className="border-b border-border pb-3">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary">
          ตั้งค่า <span className="text-sm font-normal text-text-muted">· Settings</span>
        </h1>
        <p className="text-xs text-text-muted mt-0.5">
          จัดการการแสดงผล ข้อมูลส่วนตัว ค่าเงิน และความปลอดภัย
        </p>
      </div>

      {/* 0. การแสดงผล (Theme / Appearance) */}
      <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-sm pb-2 border-b border-border">
          <SunMoon className="w-4 h-4 text-text-muted" />
          <span>การแสดงผล (Appearance)</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">ธีมการแสดงผล</p>
            <p className="text-xs text-text-muted mt-0.5">
              เลือกตามระบบ ธีมสว่าง (Soft Gradient) หรือธีมมืด (Premium Dark)
            </p>
          </div>
          <ThemeSettingsControl />
        </div>
      </div>

      {/* 1. Automation / iPhone Shortcut */}
      <AutomationSettings initialTokens={tokens} />

      {/* 2. บัญชีผู้ใช้ (User Profile) */}
      <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-sm pb-2 border-b border-border">
          <UserCheck className="w-4 h-4 text-text-muted" />
          <span>บัญชีผู้ใช้ (Account)</span>
        </div>

        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-full bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground flex items-center justify-center font-bold text-base shadow-sm">
            {userInitial}
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              {userDisplayName}
            </h2>
            <p className="text-xs text-text-muted font-mono">{user.email}</p>
          </div>
        </div>
      </div>

      {/* 2. การเงิน (Financial Preferences) */}
      <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-sm pb-2 border-b border-border">
          <Coins className="w-4 h-4 text-text-muted" />
          <span>การเงิน (Preferences)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-surface-soft rounded-xl border border-border">
            <span className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
              <Coins className="w-3.5 h-3.5 text-text-muted" />
              สกุลเงินหลัก
            </span>
            <span className="font-semibold text-text-primary mt-1 block">
              THB (฿ บาท)
            </span>
          </div>

          <div className="p-3 bg-surface-soft rounded-xl border border-border">
            <span className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
              <Globe className="w-3.5 h-3.5 text-text-muted" />
              เขตเวลา (Timezone)
            </span>
            <span className="font-semibold text-text-primary mt-1 block">
              Asia/Bangkok (UTC+7)
            </span>
          </div>
        </div>
      </div>

      {/* 3. ความเป็นส่วนตัวและความปลอดภัย (Privacy & Security) */}
      <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-sm pb-2 border-b border-border">
          <Shield className="w-4 h-4 text-text-muted" />
          <span>ความเป็นส่วนตัวและความปลอดภัย</span>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          ข้อมูลของคุณถูกจำกัดการเข้าถึงตามบัญชีผู้ใช้และจัดการผ่าน Supabase Row Level Security (RLS) โดยระบบจะไม่ร้องขอรหัสผ่านธนาคาร รหัส PIN หรือเลขบัตรเครดิตเต็ม
        </p>

        <form action={signOutAction} className="pt-2">
          <button
            type="submit"
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-expense-soft hover:opacity-90 text-expense text-xs font-semibold rounded-xl transition-colors w-full sm:w-auto active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            <span>ออกจากระบบ (Sign Out)</span>
          </button>
        </form>
      </div>

      {/* 4. ข้อมูลและการส่งออก (Data & Export) */}
      <div className="p-6 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-sm pb-2 border-b border-border">
          <FileSpreadsheet className="w-4 h-4 text-text-muted" />
          <span>ข้อมูลและการส่งออก</span>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          การสำรองและส่งออกข้อมูลเป็น CSV / Excel สำหรับทำภาษีและการวิเคราะห์ขั้นสูง กำลังพัฒนาใน Phase ถัดไป
        </p>
      </div>

      {/* 5. สำหรับนักพัฒนาและทดสอบระบบ (Developer & Demo Tools) */}
      <div className="p-6 bg-surface-soft rounded-2xl border border-border shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-sm">
          <Code2 className="w-4 h-4 text-text-muted" />
          <span>สำหรับนักพัฒนาและโหมดทดสอบ (Developer Tools)</span>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          โหลดชุดข้อมูลตัวอย่างที่สมจริง (บัญชี SCB/KBank/เงินสด, เงินเดือน, ค่าใช้จ่ายประจำวัน, การโอนข้ามบัญชี) เพื่อทดสอบการคำนวณและหน้าจอต่าง ๆ
        </p>
        <div className="pt-1">
          <SeedSampleDataButton />
        </div>
      </div>
    </div>
  );
}
