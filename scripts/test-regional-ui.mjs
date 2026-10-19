import assert from "node:assert/strict";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { chooseSelect, nativeSelect } from "./ui-controls.mjs";

const expect = baseExpect.configure({ timeout: 20000 });
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
await mkdir(".local/screenshots", { recursive: true });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const timezoneId of ["America/Los_Angeles", "Asia/Ho_Chi_Minh"]) {
      const context = await browser.newContext({ timezoneId, viewport: { width: engine === webkit ? 390 : 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
      const page = await context.newPage(), errors = [], calls = [];
      let draft;
      page.on("pageerror", e => errors.push(e.message));
      await page.clock.setFixedTime(new Date("2026-10-18T17:05:00Z"));
      await context.route("**/api/**", async route => {
        const req = route.request(), url = new URL(req.url()), path = url.pathname;
        calls.push({ path, search: url.search, body: req.method() === "GET" ? null : req.postDataJSON() });
        let data = [];
        if (path === "/api/auth/me") data = { user: { id: 999999, name: "QA Hà Nội", email: "qa@example.test", role: "owner", memberships: [] }, ghost: null };
        else if (path.endsWith("/notifications")) data = { items: [] };
        else if (path === "/api/workspace/calendar") data = { orders: [], notes: [] };
        else if (path === "/api/workspace/analytics") data = { sources: [], daily: [], segments: [], funnel: [] };
        else if (path === "/api/workspace/manual-orders/options") data = { settings: { slots: ["09:00–12:00"], lead_minutes: 0, advance_days: 90 }, capabilities: { create: true, collect: true, adjust: true, confirm: true }, currentUserId: 999999, staff: [{ id: 999999, name: "QA Hà Nội" }], requiresCoordinates: false };
        else if (path === "/api/workspace/manual-orders/quote") data = { total: 100000, subtotal: 100000, shipping: 0, discount: 0, items: [], warnings: [], token: "qa" };
        else if (path === "/api/workspace/order-drafts" && req.method() === "POST") data = draft = {id: 99001, version: 1, status: "draft", payload: req.postDataJSON()};
        else if (path === "/api/workspace/order-drafts/99001") data = draft;
        else if (path.startsWith("/api/goong/")) data = { predictions: [] };
        await route.fulfill({ json: data });
      });
      // Stub the SDK, not the app: inspect actual map constructor options.
      await context.route("https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@*/dist/goong-js.js", route => route.fulfill({ contentType: "application/javascript", body: `window.goongjs={Map:class{constructor(o){window.qaMapCenter=o.center}on(){}remove(){}flyTo(o){window.qaFlyTo=o.center}},Marker:class{setLngLat(){return this}addTo(){return this}remove(){}}};` }));
      await context.route("https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@*/dist/goong-js.css", route => route.fulfill({ contentType: "text/css", body: "" }));
      await page.goto(origin + "/admin/calendar");
      await expect(page.getByText("Ngày giao hoa · Hà Nội (UTC+7)", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Tạo đơn ngày này" })).toHaveAttribute("href", /date=2026-10-19/);
      await expect(page.locator('input[type="month"]')).toHaveValue("2026-10");
      await expect(page.getByRole("heading", { name: "Ngày 19/10/2026", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Tuần", exact: true }).click();
      await expect.poll(() => calls.filter(c => c.path.endsWith("/calendar")).at(-1)?.search).toContain("from=2026-10-19&to=2026-10-25");
      await page.goto(origin + "/admin/analytics");
      await expect.poll(() => calls.filter(c => c.path.endsWith("/analytics")).at(-1)?.search).toContain("from=2026-09-19&to=2026-10-19");
      await page.goto(origin + "/admin/orders/new");
      await expect(page.getByRole("heading", { name: "1. Khách hàng", exact: true })).toBeVisible();
      await chooseSelect(nativeSelect(page, "Trạng thái thanh toán"), "partially_paid");
      const receivedAt = page.getByLabel("Thời điểm nhận tiền · Hà Nội (bỏ trống: hiện tại)", { exact: true });
      await page.getByLabel("Số tiền thực tế đã nhận (VNĐ)", { exact: true }).fill("50000");
      await receivedAt.fill("2026-10-19T00:05");
      await expect(receivedAt).toHaveValue("2026-10-19T00:05");
      await page.getByRole("button", {name: "Lưu nháp", exact: true}).click();
      await expect.poll(() => draft?.payload?.receivedAt).toBe("2026-10-18T17:05:00.000Z");
      await expect(page).toHaveURL(/draft=99001/);
      await expect(receivedAt).toHaveValue("2026-10-19T00:05");
      await page.screenshot({ path: `.local/screenshots/regional-${engine.name()}-${timezoneId.split("/").at(-1)}.png`, fullPage: true });
      // Reload navigation avoids the unsaved form guard, without sending an order.
      await page.goto(origin + "/");
      await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.qaMapCenter)).toEqual([105.8342, 21.0278]);
      await page.evaluate(() => localStorage.setItem("fleur.delivery-location", JSON.stringify({lat: 10.77, lng: 106.7, label: "Vị trí đã chọn"})));
      await page.reload();
      await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.qaMapCenter)).toEqual([106.7, 10.77]);
      assert.deepEqual(errors, []);
      console.log(`PASS actual calendar, report dates, Hanoi received-time input and Goong map center: ${engine.name()} / ${timezoneId}`);
      await context.close();
    }
  } finally { await browser.close(); }
}
