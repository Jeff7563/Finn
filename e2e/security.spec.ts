import { test, expect } from "@playwright/test";

test.describe("Phase 1 Security E2E Hardening Suite", () => {
  test("1. Unauthenticated access to protected routes redirects to /login", async ({
    page,
  }) => {
    const protectedRoutes = [
      "/today",
      "/overview",
      "/transactions",
      "/transactions/new",
      "/accounts",
      "/categories",
      "/people",
      "/merchants",
      "/settings",
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await page.waitForURL("**/login**");
      expect(page.url()).toContain("/login");
    }
  });

  test("2. Forged unsigned finn_session cookie is rejected and redirects to /login", async ({
    context,
    page,
  }) => {
    // Inject malicious unsigned forged session cookie
    await context.addCookies([
      {
        name: "finn_session",
        value: JSON.stringify({
          id: "victim-uuid-12345",
          email: "victim@example.com",
        }),
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/today");
    // Should be rejected by verifySessionToken and redirected to /login
    await page.waitForURL("**/login**");
    expect(page.url()).toContain("/login");

    // Clear forged cookies so subsequent tests start clean
    await context.clearCookies();
  });

  test("3. Security response headers are present on responses", async ({
    page,
  }) => {
    const response = await page.goto("/login");
    expect(response).not.toBeNull();

    const headers = response!.headers();
    expect(headers["x-frame-options"]?.toUpperCase()).toBe("DENY");
    expect(headers["x-content-type-options"]?.toLowerCase()).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["referrer-policy"]).toContain("strict-origin-when-cross-origin");
  });

  test("4. Account identifiers are strictly masked in the DOM (no full account numbers)", async ({
    page,
  }) => {
    // Sign in flow matching flows.spec.ts
    await page.goto("/login");
    const demoBtn = page.getByRole("button", { name: /explore as demo user/i });
    if (await demoBtn.isVisible()) {
      await demoBtn.click();
    } else {
      await page.fill('input[name="email"]', "demo@finn.local");
      await page.fill('input[name="password"]', "password123");
      await page.click('button[type="submit"]');
    }
    await page.waitForURL("**/today");

    await page.goto("/accounts");
    // If accounts exist, check that any masked numbers show ••last4
    const accountTexts = await page.locator("body").innerText();
    // Verify no raw unmasked numbers like 10-digit account numbers appear
    const unmaskedTenDigits = /\b\d{10,}\b/;
    expect(unmaskedTenDigits.test(accountTexts)).toBe(false);
  });
});
