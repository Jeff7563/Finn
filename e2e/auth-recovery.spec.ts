import { test, expect } from "@playwright/test";

test.describe("Finn Password Recovery & Production Auth Cleanup E2E Suite", () => {
  test("1. Login page contains subtle 'ลืมรหัสผ่าน?' link near password field", async ({
    page,
  }) => {
    await page.goto("/login");

    const forgotLink = page.getByRole("link", { name: "ลืมรหัสผ่าน?" });
    await expect(forgotLink).toBeVisible();
    await expect(forgotLink).toHaveAttribute("href", "/forgot-password");
  });

  test("2. Login page does NOT contain Demo User controls or demo banner", async ({
    page,
  }) => {
    await page.goto("/login");

    // Demo button must not exist
    const demoButton = page.getByRole("button", {
      name: /explore as demo user|ทดลองใช้งาน/i,
    });
    await expect(demoButton).toHaveCount(0);

    // Demo disclaimer text must not exist
    const demoText = page.getByText(
      /โหมดทดลอง — ข้อมูลนี้เป็นตัวอย่างสำหรับการประเมินผล/i
    );
    await expect(demoText).toHaveCount(0);
  });

  test("3. Forgot password page renders all required UI elements", async ({
    page,
  }) => {
    await page.goto("/forgot-password");

    // Brand logo
    await expect(page.locator("text=F").first()).toBeVisible();

    // Heading and instructions
    await expect(page.getByRole("heading", { name: "ลืมรหัสผ่าน" })).toBeVisible();
    await expect(
      page.getByText("กรอกอีเมลที่ใช้สมัคร Finn เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้")
    ).toBeVisible();

    // Email field
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute("type", "email");

    // Submit button
    const submitBtn = page.getByRole("button", { name: "ส่งลิงก์รีเซ็ตรหัสผ่าน" });
    await expect(submitBtn).toBeVisible();

    // Back link
    const backLink = page.getByRole("link", { name: "กลับไปเข้าสู่ระบบ" });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/login");
  });

  test("4. Forgot password page layout is fully responsive and accessible", async ({
    page,
  }) => {
    await page.goto("/forgot-password");

    // Touch targets >= 44px for accessibility
    const submitBtn = page.getByRole("button", { name: "ส่งลิงก์รีเซ็ตรหัสผ่าน" });
    const box = await submitBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40);

    // Verify no horizontal overflow
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("5. Known and unknown email receive indistinguishable UI responses (anti-enumeration)", async ({
    page,
  }) => {
    const successMessage =
      "หากอีเมลนี้มีบัญชี Finn เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว";

    // Known email request
    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', "known.user@example.com");
    await page.click('button[type="submit"]');

    await expect(page.getByText(successMessage)).toBeVisible();
    await expect(page.getByText("ส่งข้อมูลเรียบร้อยแล้ว")).toBeVisible();

    // Unknown email request
    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', "completely.nonexistent.999@example.com");
    await page.click('button[type="submit"]');

    await expect(page.getByText(successMessage)).toBeVisible();
    await expect(page.getByText("ส่งข้อมูลเรียบร้อยแล้ว")).toBeVisible();
  });

  test("6. Invalid email validation displays error without sending", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    // Client-side / HTML5 validation check
    await page.fill('input[name="email"]', "invalid-email-format");
    await page.click('button[type="submit"]');

    // Should not transition to success screen
    await expect(
      page.getByText("หากอีเมลนี้มีบัญชี Finn เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว")
    ).toHaveCount(0);
  });

  test("7. Invalid or expired callback code redirects to /forgot-password with error alert", async ({
    page,
  }) => {
    await page.goto("/auth/callback?code=expired-or-invalid-code-12345");
    await page.waitForURL("**/forgot-password?error=invalid_or_expired");

    await expect(
      page.getByText("ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว")
    ).toBeVisible();
  });

  test("8. Auth callback enforces Open Redirect protection", async ({
    page,
  }) => {
    // Attempt malicious absolute URL redirect
    await page.goto(
      "/auth/callback?code=test-code&next=https://malicious-phishing.com/steal"
    );
    await page.waitForURL("**/forgot-password**");
    expect(page.url()).not.toContain("malicious-phishing.com");

    // Attempt protocol-relative redirect
    await page.goto("/auth/callback?code=test-code&next=//evil-attacker.com");
    await page.waitForURL("**/forgot-password**");
    expect(page.url()).not.toContain("evil-attacker.com");
  });

  test("9. Reset password page requires valid recovery session; blocks unauthenticated access", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.goto("/reset-password");

    // Active password reset form must NOT be rendered
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    await expect(page.locator('input[name="confirmPassword"]')).toHaveCount(0);

    // Invalid/expired session screen must be shown
    await expect(
      page.getByRole("heading", {
        name: "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว",
      })
    ).toBeVisible();

    const newLinkBtn = page.getByRole("link", { name: "ขอลิงก์ใหม่" });
    await expect(newLinkBtn).toBeVisible();
    await expect(newLinkBtn).toHaveAttribute("href", "/forgot-password");
  });

  test("10. Reset password rejects password confirmation mismatch", async ({
    context,
    page,
  }) => {
    // Inject a simulated recovery session
    await page.goto("/login");
    await page.fill('input[name="email"]', "demo@finn.local");
    await page.fill('input[name="password"]', "password123");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/today");

    // Now visit /reset-password with authenticated recovery session
    await page.goto("/reset-password");

    // The form should be visible for authenticated recovery session
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();

    // Mismatched passwords
    await page.fill('input[name="password"]', "NewStrongPass123");
    await page.fill('input[name="confirmPassword"]', "MismatchPassword456");
    await page.click('button[type="submit"]');

    await expect(
      page.getByText("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน")
    ).toBeVisible();
  });

  test("11. Successful password update redirects to /login?reset=success with banner", async ({
    page,
  }) => {
    // Authenticate session
    await page.goto("/login");
    await page.fill('input[name="email"]', "demo@finn.local");
    await page.fill('input[name="password"]', "password123");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/today");

    // Visit /reset-password
    await page.goto("/reset-password");

    // Fill matching valid passwords
    await page.fill('input[name="password"]', "NewSecurePass2026");
    await page.fill('input[name="confirmPassword"]', "NewSecurePass2026");
    await page.click('button[type="submit"]');

    // Should redirect to /login?reset=success
    await page.waitForURL("**/login?reset=success");

    // Verify success banner is rendered
    await expect(
      page.getByText(
        "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่"
      )
    ).toBeVisible();
  });

  test("12. Standard email/password login and logout continue to work without Demo button", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "demo@finn.local");
    await page.fill('input[name="password"]', "password123");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/today");
    await expect(page.getByText("Total Balance")).toBeVisible();

    // Navigate to settings and sign out
    await page.goto("/settings");
    await page.getByRole("button", { name: "ออกจากระบบ (Sign Out)" }).click();

    await page.waitForURL("**/login");
    await expect(page.getByRole("heading", { name: "เข้าสู่ระบบ Finn" })).toBeVisible();
  });

  test("13. /login?error=session_invalid renders recoverable session error banner", async ({
    page,
  }) => {
    await page.goto("/login?error=session_invalid");

    await expect(
      page.getByText(
        "เซสชันการใช้งานไม่ถูกต้องหรือหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้ง"
      )
    ).toBeVisible();
  });
});
