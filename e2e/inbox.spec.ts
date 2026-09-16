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
    await expect(page.getByRole("button", { name: "Statement CSV" })).toBeVisible();
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
});
