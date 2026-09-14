import React from "react";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import {
  ArrowLeft,
  Smartphone,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";

export default async function IosShortcutSetupPage() {
  await requireUser();

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      {/* Back Link */}
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>กลับไปหน้าตั้งค่า (Settings)</span>
      </Link>

      {/* Header */}
      <div className="border-b border-border pb-3">
        <div className="flex items-center gap-2 text-primary dark:text-primary mb-1">
          <Smartphone className="w-5 h-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            iPhone 11 Pro Max & iOS Setup
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary">
          วิธีติดตั้งและตั้งค่า iPhone Shortcut
        </h1>
        <p className="text-xs text-text-muted mt-1">
          แชร์สลิปจากแอปธนาคารหรือรูปภาพเข้า Finn ใน 1 วินาที โดยไม่ต้องกรอกยอดเงินเอง
        </p>
      </div>

      {/* Security Banner */}
      <div className="p-4 bg-income-soft dark:bg-income/10 border border-income/30 rounded-2xl flex items-start gap-3 text-xs leading-relaxed text-text-secondary">
        <ShieldAlert className="w-5 h-5 text-income flex-shrink-0 mt-0.5" />
        <div>
          <strong className="text-text-primary block mb-0.5">
            ความปลอดภัยระดับสูง (Scoped Token Security)
          </strong>
          Shortcut ใช้ Token ที่มีสิทธิ์เฉพาะการส่งสลิป (<code className="font-mono text-[11px] bg-surface px-1 py-0.5 rounded">slip:ingest</code>) เท่านั้น ไม่สามารถดูยอดเงิน ย้อนดูรายการ หรือเข้าถึงข้อมูลบัญชีส่วนตัวได้ และสามารถกดยกเลิกในหน้าตั้งค่าได้ทันที
        </div>
      </div>

      {/* Step by Step Guide */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-text-primary">
          ขั้นตอนการตั้งค่า (11 ขั้นตอนตามมาตรฐาน iOS)
        </h2>

        <div className="space-y-3 text-xs">
          {/* Step 1 */}
          <div className="p-4 bg-surface dark:bg-surface-raised rounded-xl border border-border space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="w-5 h-5 rounded-full bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground flex items-center justify-center text-[10px]">
                1
              </span>
              <span>สร้าง Ingest Token ใน Finn</span>
            </div>
            <p className="text-text-muted pl-7">
              ไปที่เมนู <strong>ตั้งค่า → Automation / iPhone Shortcut</strong> แล้วกดสร้าง Ingest Token พร้อมคัดลอกรหัสที่แสดงขึ้นมา
            </p>
          </div>

          {/* Step 2 & 3 */}
          <div className="p-4 bg-surface dark:bg-surface-raised rounded-xl border border-border space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="w-5 h-5 rounded-full bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground flex items-center justify-center text-[10px]">
                2
              </span>
              <span>เปิดแอป Shortcuts (คำสั่งลัด) บน iPhone</span>
            </div>
            <p className="text-text-muted pl-7">
              กดปุ่ม <code className="font-mono bg-surface-soft px-1 rounded">+</code> เพื่อสร้างคำสั่งลัดใหม่ และตั้งชื่อว่า{" "}
              <strong className="text-text-primary">“บันทึกสลิปใน Finn”</strong>
            </p>
          </div>

          {/* Step 4 */}
          <div className="p-4 bg-surface dark:bg-surface-raised rounded-xl border border-border space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="w-5 h-5 rounded-full bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground flex items-center justify-center text-[10px]">
                3
              </span>
              <span>เปิดรับข้อมูลจาก Share Sheet</span>
            </div>
            <p className="text-text-muted pl-7">
              กดที่ไอคอนตั้งค่าคำสั่งลัด (วงกลม i) → เปิดสวิตช์ <strong>Show in Share Sheet (แสดงในแผ่นงานการแชร์)</strong> โดยเลือกรับประเภท <strong>Images (รูปภาพ)</strong> และ <strong>Files (ไฟล์)</strong>
            </p>
          </div>

          {/* Step 5 */}
          <div className="p-4 bg-surface dark:bg-surface-raised rounded-xl border border-border space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="w-5 h-5 rounded-full bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground flex items-center justify-center text-[10px]">
                4
              </span>
              <span>เพิ่ม Action: “Get Contents of URL” (รับเนื้อหาของ URL)</span>
            </div>
            <div className="pl-7 space-y-2">
              <p className="text-text-muted">กำหนดค่าในคำสั่งลัดดังนี้:</p>
              <div className="p-3 bg-surface-soft rounded-lg font-mono text-[11px] space-y-1 border border-border">
                <p><strong>URL:</strong> https://finn.example.com/api/ingest/slip</p>
                <p><strong>Method:</strong> POST</p>
                <p><strong>Headers:</strong></p>
                <p className="pl-4">Authorization: Bearer finn_ingest_...</p>
                <p className="pl-4">Accept: application/json</p>
                <p><strong>Request Body:</strong> Form</p>
                <p className="pl-4">file: Shortcut Input (File)</p>
                <p className="pl-4">source: ios_shortcut</p>
                <p className="pl-4">client_id: iphone-11-pro-max</p>
              </div>
            </div>
          </div>

          {/* Step 6 */}
          <div className="p-4 bg-surface dark:bg-surface-raised rounded-xl border border-border space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="w-5 h-5 rounded-full bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground flex items-center justify-center text-[10px]">
                5
              </span>
              <span>เพิ่ม Action: “Show Notification” (แสดงการแจ้งเตือน)</span>
            </div>
            <p className="text-text-muted pl-7">
              ใส่ข้อความแจ้งเตือนความเป็นส่วนตัว เช่น <strong>“บันทึกสลิปสำเร็จแล้ว”</strong> (หลีกเลี่ยงการแสดงเลขบัญชีบน Lock Screen)
            </p>
          </div>
        </div>
      </div>

      {/* Verification Checklist */}
      <div className="p-5 bg-surface dark:bg-surface-raised rounded-2xl border border-border shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-income" />
          <span>รายการทดสอบบนเครื่อง iPhone 11 Pro Max</span>
        </h3>
        <ul className="space-y-1.5 text-xs text-text-muted pl-2">
          <li>✓ ถ่ายภาพหน้าจอหรือเลือกสลิปจาก Photos แล้วกด Share → บันทึกสลิปใน Finn</li>
          <li>✓ ได้รับการแจ้งเตือนสำเร็จ และรายการปรากฏใน Finn ทันที</li>
          <li>✓ สลิปที่ต้องตรวจสอบ (เช่น เงินโอนเข้า) จะปรากฏในเมนู “รอตรวจสอบ” (/review)</li>
          <li>✓ หากส่งสลิปเดิมซ้ำ ระบบจะปฏิเสธและไม่สร้างรายการซ้ำ</li>
        </ul>
      </div>
    </div>
  );
}
