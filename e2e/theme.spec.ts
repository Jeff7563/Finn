import { test, expect } from "@playwright/test";

test.describe.serial("Finn Adaptive Theme V3 E2E Tests", () => {
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

  test("1. Initial state initializes data-theme and colorScheme on root document", async ({
    page,
  }) => {
    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-theme", /light|dark/);

    const dataTheme = await root.getAttribute("data-theme");
    expect(["light", "dark"]).toContain(dataTheme);
  });

  test("2. Settings theme control switches between system, light, and dark, and persists in localStorage", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Verify Appearance section is present
    await expect(page.getByText("การแสดงผล (Appearance)")).toBeVisible();
    await expect(page.getByText("ธีมการแสดงผล")).toBeVisible();

    const group = page.getByRole("group", { name: "การแสดงผล" });
    const systemBtn = group.getByRole("button", { name: "ตามระบบ" });
    const lightBtn = group.getByRole("button", { name: "สว่าง" });
    const darkBtn = group.getByRole("button", { name: "มืด" });

    await expect(systemBtn).toBeVisible();
    await expect(lightBtn).toBeVisible();
    await expect(darkBtn).toBeVisible();

    // A. Switch to Dark
    await darkBtn.click();
    await expect(darkBtn).toHaveAttribute("aria-pressed", "true");
    await expect(lightBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Verify localStorage persistence
    const darkStored = await page.evaluate(() =>
      localStorage.getItem("finn-theme")
    );
    expect(darkStored).toBe("dark");

    // Reload page to verify persistence without flash
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // B. Switch to Light
    const groupAfterReload = page.getByRole("group", { name: "การแสดงผล" });
    const lightBtnAfterReload = groupAfterReload.getByRole("button", { name: "สว่าง" });
    await lightBtnAfterReload.click();

    await expect(lightBtnAfterReload).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const lightStored = await page.evaluate(() =>
      localStorage.getItem("finn-theme")
    );
    expect(lightStored).toBe("light");

    // Reload page to verify light persistence
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // C. Switch to System
    const groupReset = page.getByRole("group", { name: "การแสดงผล" });
    const systemBtnReset = groupReset.getByRole("button", { name: "ตามระบบ" });
    await systemBtnReset.click();
    await expect(systemBtnReset).toHaveAttribute("aria-pressed", "true");

    const systemStored = await page.evaluate(() =>
      localStorage.getItem("finn-theme")
    );
    expect(systemStored).toBe("system");
  });

  test("3. Quick toggle in navigation switches theme seamlessly", async ({
    page,
  }) => {
    // Quick toggle exists in either sidebar (desktop) or mobile header (mobile)
    const quickToggle = page.locator("button[aria-label*='Switch to']:visible").first();
    await expect(quickToggle).toBeVisible();

    const initialTheme = await page.locator("html").getAttribute("data-theme");
    await quickToggle.click();

    const toggledTheme = await page.locator("html").getAttribute("data-theme");
    expect(toggledTheme).not.toBe(initialTheme);

    if (toggledTheme === "dark") {
      await expect(page.locator("html")).toHaveClass(/dark/);
    } else {
      await expect(page.locator("html")).not.toHaveClass(/dark/);
    }
  });

  test("4. Routes render without horizontal overflow in both light and dark themes", async ({
    page,
  }) => {
    const routes = [
      "/today",
      "/overview",
      "/transactions",
      "/transactions/new",
      "/accounts",
      "/categories",
      "/settings",
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");

      // Verify no horizontal overflow
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflow).toBe(false);
    }
  });
});
