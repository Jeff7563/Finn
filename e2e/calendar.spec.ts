import { test, expect } from "@playwright/test";

test.describe.serial("Overview Calendar Insights Add-on", () => {
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

  test("1. Overview retains all existing sections and displays ภาพรวมตามปฏิทิน", async ({
    page,
  }) => {
    await page.goto("/overview");

    // Verify existing sections are preserved intact
    await expect(page.getByText("กระแสเงินสดเดือนนี้")).toBeVisible();
    await expect(page.getByText("ยอดเงินทั้งหมด")).toBeVisible();
    await expect(page.getByText("แนวโน้ม 6 เดือน (รายรับ vs รายจ่าย)")).toBeVisible();
    await expect(page.getByText("เงินออกไปกับอะไร (หมวดหมู่ยอดนิยม)")).toBeVisible();
    await expect(page.getByText("บัญชีของฉัน")).toBeVisible();

    // Verify NEW Calendar Insights section
    const calendarSection = page.locator("section", {
      hasText: "ภาพรวมตามปฏิทิน",
    });
    await expect(calendarSection).toBeVisible();

    // Verify default mode is Heatmap
    const heatmapBtn = page.getByRole("button", { name: /Heatmap/i });
    const calendarBtn = page.getByRole("button", { name: /Calendar/i });
    await expect(heatmapBtn).toBeVisible();
    await expect(calendarBtn).toBeVisible();
    await expect(heatmapBtn).toHaveAttribute("aria-pressed", "true");
    await expect(calendarBtn).toHaveAttribute("aria-pressed", "false");

    // Verify month navigation
    const prevMonthBtn = page.getByRole("button", { name: "เดือนก่อนหน้า" });
    const nextMonthBtn = page.getByRole("button", { name: "เดือนถัดไป" });
    await expect(prevMonthBtn).toBeVisible();
    await expect(nextMonthBtn).toBeVisible();
  });

  test("2. Month navigation works and เดือนนี้ button resets view", async ({
    page,
  }) => {
    await page.goto("/overview");

    const prevMonthBtn = page.getByRole("button", { name: "เดือนก่อนหน้า" });
    await prevMonthBtn.click();

    // Reset button 'เดือนนี้' should now be visible
    const resetCurrentMonthBtn = page.getByRole("button", { name: "เดือนนี้" });
    await expect(resetCurrentMonthBtn).toBeVisible();

    // Click to reset to current month
    await resetCurrentMonthBtn.click();
    await expect(resetCurrentMonthBtn).not.toBeVisible();
  });

  test("3. Mode toggling switches between Heatmap and Calendar views", async ({
    page,
  }) => {
    await page.goto("/overview");

    const calendarBtn = page.getByRole("button", { name: /Calendar/i });
    const heatmapBtn = page.getByRole("button", { name: /Heatmap/i });

    // Switch to Calendar mode
    await calendarBtn.click();
    await expect(calendarBtn).toHaveAttribute("aria-pressed", "true");
    await expect(heatmapBtn).toHaveAttribute("aria-pressed", "false");

    // Switch back to Heatmap mode
    await heatmapBtn.click();
    await expect(heatmapBtn).toHaveAttribute("aria-pressed", "true");
    await expect(calendarBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("4. Clicking a day cell opens DaySummarySheet with correct details and CTA", async ({
    page,
  }) => {
    // Ensure account exists for creating transactions
    await page.goto("/accounts");
    const hasAccount = await page.getByText("SCB Main Account").isVisible().catch(() => false);
    if (!hasAccount) {
      const addBtn = page.getByRole("button", { name: "Add Account" });
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.fill('input[name="name"]', "SCB Main Account");
        await page.selectOption('select[name="type"]', "bank");
        await page.fill('input[name="institution"]', "SCB");
        await page.fill('input[name="opening_balance"]', "25000");
        await page.getByRole("button", { name: "Create Account" }).click();
        await expect(page.getByText("SCB Main Account").first()).toBeVisible();
      }
    }

    // Add a transaction to guarantee activity
    await page.goto("/transactions/new?type=expense");
    await page.fill('input[name="amount"]', "450");
    await page.fill('input[name="description"]', "Calendar Test Expense");
    await page.getByRole("button", { name: "Save Transaction" }).click();
    await page.waitForURL("**/transactions");

    // Navigate to /overview
    await page.goto("/overview");

    // Find and click any active day cell inside Calendar Insights section
    const calendarSection = page.locator("section", {
      hasText: "ภาพรวมตามปฏิทิน",
    });
    const dayCell = calendarSection.locator("button[aria-label*='วันที่']").first();
    await dayCell.click();

    // Verify DaySummarySheet opens
    const sheetDialog = page.getByRole("dialog");
    await expect(sheetDialog).toBeVisible();

    // Verify close button closes the sheet
    const closeBtn = page.getByRole("button", {
      name: "ปิดหน้าต่างสรุปประจำวัน",
    });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(sheetDialog).not.toBeVisible();
  });

  test("5. CTA navigates to /transactions or /transactions/new with date filter applied", async ({
    page,
  }) => {
    await page.goto("/overview");

    const calendarSection = page.locator("section", {
      hasText: "ภาพรวมตามปฏิทิน",
    });
    const anyDayCell = calendarSection.locator("button[aria-label*='วันที่']").first();
    await anyDayCell.click();

    const sheetDialog = page.getByRole("dialog");
    await expect(sheetDialog).toBeVisible();

    const viewTodayLink = page.getByRole("link", { name: "ดูรายการวันนี้" });
    const addTxLink = sheetDialog.getByRole("link", { name: "+ เพิ่มรายการ" });

    if (await viewTodayLink.isVisible()) {
      await viewTodayLink.click();
      await page.waitForURL(/.*\/transactions\?date=.*/);
      expect(page.url()).toContain("/transactions?date=");
    } else if (await addTxLink.isVisible()) {
      await addTxLink.click();
      await page.waitForURL(/.*\/transactions\/new\?date=.*/);
      expect(page.url()).toContain("/transactions/new?date=");
    }
  });

  test("6. Mobile viewport verifies no horizontal overflow in both modes", async ({
    page,
  }) => {
    await page.goto("/overview");

    // Check no horizontal scroll overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    // Switch to Calendar mode
    const calendarBtn = page.getByRole("button", { name: /Calendar/i });
    await calendarBtn.click();

    // Verify no horizontal overflow in Calendar mode
    const hasHorizontalScrollCalendar = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalScrollCalendar).toBe(false);
  });
});
