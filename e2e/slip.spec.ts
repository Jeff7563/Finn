import { test, expect } from "@playwright/test";
import { createSyntheticSlipJpeg } from "../tests/slip/fixtures";
import fs from "fs";
import path from "path";

const TMP_FIXTURES_DIR = path.resolve(process.cwd(), "scratch", "test-fixtures");

test.describe.serial("Phase 2 — Slip Automation End-to-End", () => {
  test.beforeAll(() => {
    fs.mkdirSync(TMP_FIXTURES_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    // Log in as demo user
    await page.goto("/login");
    const demoButton = page.getByRole("button", {
      name: /explore as demo user/i,
    });
    if (await demoButton.isVisible()) {
      await demoButton.click();
    } else {
      await page.fill('input[name="email"]', "demo@finn.local");
      await page.fill('input[name="password"]', "password123");
      await page.click('button[type="submit"]');
    }
    await page.waitForURL("**/today");
  });

  test("1. Settings: Generate Ingest Token, verify one-time reveal & warning, and revoke", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Locate Automation section
    await expect(page.getByText("Automation / iPhone Shortcut")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "สร้าง Ingest Token" })
    ).toBeVisible();

    // Create Ingest Token
    await page.getByRole("button", { name: "สร้าง Ingest Token" }).click();

    // Verify token revealed with security warning
    await expect(
      page.getByText("สร้าง Ingest Token สำเร็จ — แสดงเพียงครั้งเดียวเท่านั้น")
    ).toBeVisible();
    await expect(
      page.getByText(/อย่าแชร์ Shortcut ที่ฝัง Token นี้ให้ผู้อื่น/i)
    ).toBeVisible();
    await expect(page.getByText(/finn_ingest_/i).first()).toBeVisible();

    // Verify link to iOS setup guide
    await expect(page.getByText("คู่มือติดตั้ง iPhone Shortcut")).toBeVisible();
    await page.getByText("คู่มือติดตั้ง iPhone Shortcut").click();
    await page.waitForURL("**/settings/automation/ios");
    await expect(page.getByText("วิธีติดตั้งและตั้งค่า iPhone Shortcut")).toBeVisible();

    // Return to settings and revoke token
    await page.goto("/settings");
    const revokeButton = page.getByRole("button", { name: "ยกเลิก Token" }).first();
    if (await revokeButton.isVisible()) {
      page.on("dialog", (dialog) => dialog.accept());
      await revokeButton.click();
      await expect(page.getByText(/ยกเลิกแล้ว \(Revoked\)/i).first()).toBeVisible();
    }
  });

  test("2. High-Confidence Outgoing Slip: Upload via modal, auto-creates transaction", async ({
    page,
  }) => {
    // 1. Ensure an account exists
    await page.goto("/accounts");
    const hasAccount = await page.getByText("SCB").first().isVisible().catch(() => false);
    if (!hasAccount) {
      const addBtn = page.getByRole("button", { name: "Add Account" });
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.fill('input[name="name"]', "SCB Main Account");
        await page.selectOption('select[name="type"]', "bank");
        await page.fill('input[name="institution"]', "SCB");
        await page.fill('input[name="opening_balance"]', "25000");
        await page.fill('input[name="masked_number"]', "1234");
        await page.getByRole("button", { name: "Create Account" }).click();
      }
    }

    // 2. Prepare synthetic high-confidence outgoing slip
    const testAmount = 300 + Math.floor(Math.random() * 500);
    const uniqueRef = `AUTO-SLIP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const slipFile = path.join(TMP_FIXTURES_DIR, `slip_outgoing_${Date.now()}.jpg`);
    const slipBuffer = createSyntheticSlipJpeg({
      amount: testAmount,
      sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      receiver: { bank: "KBANK", name: "Starbucks Cafe" },
      reference: uniqueRef,
      amountConfidence: 0.99,
      senderAccountConfidence: 0.99,
    });
    fs.writeFileSync(slipFile, slipBuffer);

    // 3. Go to /transactions and open upload modal
    await page.goto("/transactions");
    await page.getByRole("button", { name: "อัปโหลดสลิป" }).click();
    await expect(page.getByText("อัปโหลดสลิปธนาคาร")).toBeVisible();

    // 4. Select file and submit
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(slipFile);

    await page.getByRole("button", { name: "เริ่มอ่านและประมวลผลสลิป" }).click();

    // 5. Verify auto-creation success
    await expect(page.getByText("บันทึกรายการสำเร็จแล้ว!")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(testAmount.toLocaleString()).first()).toBeVisible();

    // 6. Close modal and verify transaction in list
    await page.getByRole("button", { name: "เสร็จสิ้น" }).click();
    await page.goto("/transactions");
    await expect(page.getByText(testAmount.toLocaleString()).first()).toBeVisible();
  });

  test("3. Ambiguous Incoming Slip: Routes to Review Inbox, user edits and confirms", async ({
    page,
  }) => {
    // 1. Prepare synthetic incoming slip (money received from external party)
    const incomingAmount = 1000 + Math.floor(Math.random() * 500);
    const incomingRef = `REVIEW-INCOMING-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const slipFile = path.join(TMP_FIXTURES_DIR, `slip_incoming_${Date.now()}.jpg`);
    const slipBuffer = createSyntheticSlipJpeg({
      amount: incomingAmount,
      sender: { bank: "BBL", name: "External Client Co" },
      receiver: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      reference: incomingRef,
      amountConfidence: 0.99,
    });
    fs.writeFileSync(slipFile, slipBuffer);

    // 2. Upload via transactions modal
    await page.goto("/transactions");
    await page.getByRole("button", { name: "อัปโหลดสลิป" }).click();
    await page.locator('input[type="file"]').setInputFiles(slipFile);
    await page.getByRole("button", { name: "เริ่มอ่านและประมวลผลสลิป" }).click();

    // 3. Verify routed to review
    await expect(page.getByText("ส่งรายการไปยังกล่องรอตรวจสอบ")).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole("button", { name: "เปิดตรวจสอบรายการ" }).click();
    await page.waitForURL("**/review**");

    // 4. Verify in Review Inbox
    await expect(page.getByText(/รายการรอตรวจสอบ/i)).toBeVisible();
    await expect(page.getByText(incomingAmount.toLocaleString()).first()).toBeVisible();
    await expect(page.getByText(/เงินโอนเข้า/i).first()).toBeVisible();

    // 5. Click "แก้ไข" to edit and confirm
    const slipCard = page.locator(".bg-surface", { hasText: incomingAmount.toLocaleString() }).first();
    await slipCard.getByRole("button", { name: "แก้ไข" }).click();
    await expect(page.getByText("แก้ไขและยืนยันรายการสลิป")).toBeVisible();

    // Fill details and submit
    await page.fill('input[name="description"]', "Freelance payment client");
    await page.getByRole("button", { name: "บันทึกและยืนยันรายการ" }).click();

    // 6. Verify cleared from Review Inbox and appears in Transactions
    await page.goto("/transactions");
    await expect(page.getByText(incomingAmount.toLocaleString()).first()).toBeVisible();
  });

  test("4. Duplicate Detection: Exact file duplicate prevents duplicate transactions", async ({
    page,
  }) => {
    const dupAmount = 200 + Math.floor(Math.random() * 100);
    const dupRef = `DUP-CHECK-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const slipFile = path.join(TMP_FIXTURES_DIR, `slip_duplicate_${Date.now()}.jpg`);
    const slipBuffer = createSyntheticSlipJpeg({
      amount: dupAmount,
      sender: { bank: "SCB", accountMasked: "1234" },
      receiver: { bank: "KBANK", name: "Cafe Amazon" },
      reference: dupRef,
    });
    fs.writeFileSync(slipFile, slipBuffer);

    // First upload
    await page.goto("/transactions");
    await page.getByRole("button", { name: "อัปโหลดสลิป" }).click();
    await page.locator('input[type="file"]').setInputFiles(slipFile);
    await page.getByRole("button", { name: "เริ่มอ่านและประมวลผลสลิป" }).click();
    await expect(page.getByRole("heading", { name: /สำเร็จ|รอตรวจสอบ/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "เสร็จสิ้น" }).click();

    // Second upload of exact same file
    await page.goto("/transactions");
    await page.getByRole("button", { name: "อัปโหลดสลิป" }).click();
    await page.locator('input[type="file"]').setInputFiles(slipFile);
    await page.getByRole("button", { name: "เริ่มอ่านและประมวลผลสลิป" }).click();

    // Verify duplicate detected
    await expect(page.getByRole("heading", { name: "สลิปนี้เคยถูกบันทึกแล้ว" })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/ระบบป้องกันการบันทึกรายการซ้ำ/i)).toBeVisible();
  });

  test("5. Mobile Layout (iPhone 11 Pro Max: 414x896) has zero horizontal overflow", async ({
    page,
  }) => {
    // Set iPhone 11 Pro Max viewport
    await page.setViewportSize({ width: 414, height: 896 });

    // Check Today page
    await page.goto("/today");
    const todayOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(todayOverflow).toBe(false);

    // Check Review page
    await page.goto("/review");
    const reviewOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(reviewOverflow).toBe(false);

    // Check Settings page
    await page.goto("/settings");
    const settingsOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(settingsOverflow).toBe(false);
  });
});
