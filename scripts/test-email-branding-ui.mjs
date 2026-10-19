import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

// Uses the running dev server's store catalog; all browser API calls are mocked.
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/api/**", async route => {
    assert.equal(route.request().method(), "GET", "This check must not mutate data or send email");
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/auth/me"
      ? { user: { id: 999999, name: "Email QA", email: "qa@example.test", role: "owner", platformRole: "platform_admin", memberships: [] } }
      : path.endsWith("/emails")
        ? { configuration: { enabled: false, ready: false }, templates: [{ id: 1, name: "Branding QA", subject: "Đơn tại {{store_name}}", body: "Xin chào {{customer_name}}, đơn {{order_reference}} tại {{store_name}}.", active: 1, kind: "transactional", variables: [] }], stats: [], campaigns: [], messages: [], customers: [] }
        : { items: [] };
    await route.fulfill({ status: 200, json: data });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/admin/emails");
  const label = await page.locator(".admin-sidebar .store-workspace-label").textContent();
  assert(label?.endsWith("'s workspace"), "Store fixture must have a name");
  await page.locator(".email-template-list button").first().click();
  const preview = page.frameLocator('iframe[title="Xem trước mẫu email"]');
  await expect(preview.locator(".store-workspace-label")).toHaveText(label);
  const brand = preview.locator(".store-workspace-label");
  assert.equal(await brand.evaluate(el => el.previousElementSibling.textContent), "Fleurious");
  await expect(preview.locator("body")).toContainText(label.replace(/'s workspace$/, ""));
  // Edits update the preview without losing the seller label.
  await page.getByLabel("Tiêu đề email", { exact: true }).fill("Chỉnh sửa tiêu đề");
  await expect(preview.locator(".store-workspace-label")).toHaveText(label);
  console.log("PASS store template preview: Fleurious logo with actual workspace label underneath, retained after edits");
  await page.goto(base + "/platform/emails");
  await page.locator(".email-template-list button").first().click();
  await expect(page.frameLocator('iframe[title="Xem trước mẫu email"]').locator(".store-workspace-label")).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("PASS platform template preview stays separate; no browser errors or email sends");
} finally { await browser.close(); }
