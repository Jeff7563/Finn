import { test, expect } from "@playwright/test";

test.describe.serial("Multi-Source Inbox E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Sign In Flow with Demo User
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

  test("1. Multi-Source Inbox route renders with header, filters, and safety banner", async ({
    page,
  }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("domcontentloaded");

    // Header checks
    await expect(page.getByText("กล่องข้อความหลายแหล่งที่มา (Multi-Source Inbox)")).toBeVisible();

    // Financial Safety active badge
    await expect(page.getByText("ระบบป้องกันการรวมรายการผิดพลาด (Financial Safety Active)")).toBeVisible();

    // Mandatory notice: No Ambiguous Confirm-All
    await expect(page.getByText("ไม่มีปุ่มยืนยันทั้งหมดแบบเหมารวม (No Ambiguous Confirm-All)")).toBeVisible();

    // Filter bar checks
    await expect(page.getByRole("button", { name: "ทั้งหมด" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Gmail / อีเมล" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Statement CSV", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "API" })).toBeVisible();

    // Status filter checks
    await expect(page.getByRole("button", { name: "รอตรวจสอบ" })).toBeVisible();
    await expect(page.getByRole("button", { name: "เชื่อมโยงแล้ว" })).toBeVisible();

    // Verify no horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("2. Import bank statement CSV: choose account -> choose sample CSV -> import -> rows become visible", async ({
    page,
  }) => {
    // 1. Ensure at least one account exists
    await page.goto("/accounts");
    await page.waitForLoadState("domcontentloaded");
    const accountItem = page.locator("text=KBANK").first();
    const hasAccount = await accountItem.isVisible().catch(() => false);
    if (!hasAccount) {
      const addBtn = page.getByRole("button", { name: "Add Account" });
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.fill('input[name="name"]', "KBANK Salary Account");
        await page.selectOption('select[name="type"]', "bank");
        await page.fill('input[name="institution"]', "KBANK");
        await page.fill('input[name="opening_balance"]', "10000");
        await page.fill('input[name="masked_number"]', "4567");
        await page.getByRole("button", { name: "Create Account" }).click();
        await page.waitForTimeout(500);
      }
    }

    // 2. Prepare synthetic test fixture CSV with unique timestamp
    const fs = await import("fs");
    const path = await import("path");
    const fixturesDir = path.resolve(process.cwd(), "scratch", "test-fixtures");
    fs.mkdirSync(fixturesDir, { recursive: true });
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const uniqueFilename = `e2e_statement_${uniqueSuffix}.csv`;
    const fixturePath = path.join(fixturesDir, uniqueFilename);
    const groceryDesc = `Supermarket Groceries ${uniqueSuffix}`;
    const payrollDesc = `Monthly Payroll ${uniqueSuffix}`;
    const sampleCsv = `Date,Time,Description,Withdrawal,Deposit,Reference
2026-09-15,08:30:00,${groceryDesc},850.50,,KBANK-E2E-${uniqueSuffix}-1
2026-09-15,12:00:00,${payrollDesc},,35000.00,KBANK-E2E-${uniqueSuffix}-2`;
    fs.writeFileSync(fixturePath, sampleCsv, "utf8");

    // 3. Navigate to /inbox
    await page.goto("/inbox");
    await page.waitForLoadState("domcontentloaded");

    // 4. Click 'นำเข้า Statement CSV' button to open modal
    const importBtn = page.getByRole("button", { name: "นำเข้า Statement CSV" });
    await expect(importBtn).toBeVisible();
    await importBtn.click();

    // 5. Verify modal rendered
    await expect(page.getByRole("heading", { name: "นำเข้า Statement CSV" })).toBeVisible();
    await expect(page.getByText("บัญชี Finn ที่สเตตเมนต์นี้สังกัด (Statement Account)")).toBeVisible();

    // 6. Set input file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(fixturePath);

    // Verify selected filename appears in modal
    await expect(page.getByText(uniqueFilename, { exact: true })).toBeVisible();

    // 7. Submit import form
    const submitBtn = page.getByRole("button", { name: "นำเข้าข้อมูล (Import)" });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 8. Expect success view in modal
    await expect(page.getByRole("heading", { name: "นำเข้า Statement สำเร็จ" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("ดูรายการในกล่องข้อความ (Inbox)")).toBeVisible();

    // 9. Click to view imported items in Inbox
    await page.getByRole("button", { name: "ดูรายการในกล่องข้อความ (Inbox)" }).click();

    // Modal should close
    await expect(page.getByRole("heading", { name: "นำเข้า Statement CSV" })).not.toBeVisible();

    // Switch to Statement CSV tab if not already active
    const statementTab = page.getByRole("button", { name: "Statement CSV", exact: true });
    await statementTab.click();

    // 10. Verify rows became visible in Inbox!
    await expect(page.getByText(groceryDesc)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(payrollDesc)).toBeVisible({ timeout: 5000 });
  });
});
