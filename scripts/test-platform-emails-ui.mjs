import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";

// Every API is intercepted. No SMTP connection, email or database writes.
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
await mkdir(".local/platform-emails-qa", { recursive: true });
const payload = {
  configuration: { enabled: true, ready: true },
  templates: [
    { id: 1, name: "Chào mừng đăng ký tài khoản", subject: "Chào {{customer_name}}", body: "Chào mừng {{customer_name}} đến với Fleurious.", kind: "transactional", active: 1, variables: [] },
    { id: 2, name: "Chăm sóc khách hàng", subject: "Một lời nhắn", body: "Chào {{customer_name}}, {{campaign_message}}", kind: "marketing", active: 1 },
  ],
  stats: [{ status: "sent", count: 1234 }], campaigns: [], customers: [],
  messages: [{ id: "platform-1", subject: "Thư kiểm thử", recipient: "qa@example.test", attempts: 1, status: "sent", created_at: "2026-10-20 10:00:00" }],
};
let checks = 0;
for (const [engine, width] of [[chromium, 1440], [chromium, 768], [chromium, 390], [chromium, 360], [webkit, 390]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    let reads = 0, verifies = 0;
    const unexpected = [], errors = [];
    await context.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let data = [];
      if (path === "/api/activity") data = { ok: true };
      else if (path.endsWith("/emails/verify")) { verifies++; data = { ok: true }; }
      else if (req.method() !== "GET") { unexpected.push(path); data = { error: "Unexpected write" }; }
      else if (path === "/api/auth/me") data = { user: { id: 999999, name: "Email QA", email: "qa@example.test", role: "owner", platformRole: "platform_admin", memberships: [] }, ghost: null };
      else if (path.endsWith("/emails")) { reads++; data = payload; }
      else if (path.endsWith("/notifications")) data = { items: [] };
      await route.fulfill({ status: 200, json: data });
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(origin + "/platform/emails");
    await expect(page.locator(".platform-email-workspace")).toBeVisible();
    const statusText = await page.locator(".email-config > div").first().boundingBox();
    assert(statusText.width >= Math.min(180, width / 2), "Connection status text has enough room to read"); checks++;
    const refresh = page.getByRole("button", { name: "Làm mới", exact: true });
    await expect(refresh).toHaveCount(1); checks++;
    await page.locator(".email-template-list button").first().click();
    await page.getByLabel("Tiêu đề email", { exact: true }).fill("Bản nháp chưa lưu");
    const before = reads;
    await refresh.click();
    await expect.poll(() => reads).toBe(before + 1);
    await expect(page.getByLabel("Tiêu đề email", { exact: true })).toHaveValue("Bản nháp chưa lưu");
    assert.equal(verifies, 0); checks++;
    await page.getByRole("button", { name: "Kiểm tra kết nối", exact: true }).click();
    await expect.poll(() => verifies).toBe(1); checks++;
    for (const tab of ["Mẫu email", "Chương trình nền tảng", "Lịch sử gửi"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const beforeTab = reads;
      await refresh.click();
      await expect.poll(() => reads).toBe(beforeTab + 1);
      await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${tab}: no page overflow`); checks++;
    }
    await page.getByRole("tab", { name: "Mẫu email", exact: true }).click();
    await page.screenshot({ path: `.local/platform-emails-qa/${engine.name()}-${width}.png`, fullPage: true });
    await page.goto(origin + "/admin/emails");
    await expect(page.locator(".email-workspace")).toBeVisible();
    await expect(page.locator(".email-config").getByRole("button", { name: "Làm mới", exact: true })).toHaveCount(1);
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []); checks++;
    console.log(`PASS ${engine.name()} ${width}px: single platform refresh, draft/tab preservation, SMTP action separate, responsive tabs, store refresh retained`);
  } finally { await browser.close(); }
}
console.log(`${checks} platform email UI checks passed`);
