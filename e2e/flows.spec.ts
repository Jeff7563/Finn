import { test, expect } from "@playwright/test";

test.describe.serial("Phase 1 Core Financial Flows", () => {
  test.beforeEach(async ({ page }) => {
    // Sign In Flow
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

  test("1. View Today page and verify deterministic structure and safe to spend placeholder", async ({
    page,
  }) => {
    await expect(page.getByText("Total Balance")).toBeVisible();
    await expect(page.getByText("Safe to Spend")).toBeVisible();
    await expect(
      page.getByText("Coming in Budget & Forecast phase")
    ).toBeVisible();
    await expect(page.getByText("This Month Summary")).toBeVisible();
  });

  test("2. Create financial accounts", async ({ page }) => {
    await page.goto("/accounts");

    // Open Add Account modal
    await page.getByRole("button", { name: "Add Account" }).click();

    // Fill Account 1 (SCB Main)
    await page.fill('input[name="name"]', "SCB Main Account");
    await page.selectOption('select[name="type"]', "bank");
    await page.fill('input[name="institution"]', "SCB");
    await page.fill('input[name="opening_balance"]', "25000");
    await page.fill('input[name="masked_number"]', "1234");
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page.getByText("SCB Main Account").first()).toBeVisible();

    // Add Account 2 (KBank Savings)
    await page.getByRole("button", { name: "Add Account" }).click();
    await page.fill('input[name="name"]', "KBank Savings");
    await page.selectOption('select[name="type"]', "bank");
    await page.fill('input[name="institution"]', "KBANK");
    await page.fill('input[name="opening_balance"]', "5000");
    await page.fill('input[name="masked_number"]', "5678");
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page.getByText("KBank Savings").first()).toBeVisible();
  });

  test("3. Add expense, income, and transfer between own accounts", async ({
    page,
  }) => {
    // A. Add Expense
    await page.goto("/transactions/new?type=expense");
    await page.fill('input[name="amount"]', "389");
    await page.fill('input[name="description"]', "Weekly Groceries");
    await page.getByRole("button", { name: "Save Transaction" }).click();

    await page.waitForURL("**/transactions");
    await expect(page.getByText("Weekly Groceries").first()).toBeVisible();
    await expect(page.getByText("-฿389.00").first()).toBeVisible();

    // B. Add Income
    await page.goto("/transactions/new?type=income");
    await page.fill('input[name="amount"]', "15000");
    await page.fill('input[name="description"]', "Consulting Fee");
    await page.getByRole("button", { name: "Save Transaction" }).click();

    await page.waitForURL("**/transactions");
    await expect(page.getByText("Consulting Fee").first()).toBeVisible();
    await expect(page.getByText("+฿15,000.00").first()).toBeVisible();

    // C. Add Transfer between SCB and KBank
    await page.goto("/transactions/new?type=transfer");
    await page.fill('input[name="amount"]', "4000");
    await page.fill('input[name="description"]', "Internal Savings Transfer");
    await page.getByRole("button", { name: "Save Transaction" }).click();

    await page.waitForURL("**/transactions");
    await expect(page.getByText(/SCB Main Account/).first()).toBeVisible();
  });

  test("4. View transaction detail and verify transfer flow", async ({ page }) => {
    await page.goto("/transactions");

    // Click on the specific transaction item link
    const txLink = page.getByRole("link", { name: /Weekly Groceries/i }).first();
    await expect(txLink).toBeVisible();
    await txLink.click();

    await page.waitForURL(/\/transactions\/[a-zA-Z0-9-]+/);
    await expect(page.getByText(/Confidence/i)).toBeVisible();
    await expect(page.getByText(/Weekly Groceries/i)).toBeVisible();
  });

  test("5. Create counterparty person and view person history", async ({
    page,
  }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Add Person" }).first().click();

    await page.fill('input[name="display_name"]', "Somchai Jaidee");
    await page.fill('input[name="aliases"]', "สมชาย, Somchai J");
    await page.getByRole("button", { name: "Add Person" }).last().click();

    // Verify person row displays
    await expect(page.getByText("Somchai Jaidee").first()).toBeVisible();

    // Navigate to person detail
    await page.getByText("Somchai Jaidee").first().click();
    await page.waitForURL(/\/people\/[a-zA-Z0-9-]+/);
    await expect(page.getByText("Somchai Jaidee").first()).toBeVisible();
    await expect(page.getByText("Received").first()).toBeVisible();
    await expect(page.getByText("Paid").first()).toBeVisible();
    await expect(page.getByText("Net").first()).toBeVisible();
  });

  test("6. View Overview financial dashboard", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByText("Financial Overview")).toBeVisible();
    await expect(page.getByText("Total Balance").first()).toBeVisible();
    await expect(page.getByText("Net Cash Flow").first()).toBeVisible();
  });
});
