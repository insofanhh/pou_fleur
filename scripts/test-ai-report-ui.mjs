import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";

// Render persisted tool payloads, intercepting all APIs. No provider/mail/DB calls.
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const expect = baseExpect.configure({ timeout: 15000 });
const out = ".local/ai-report-qa";
await mkdir(out, { recursive: true });
const thread = "00000000-0000-4000-8000-000000000001";
const fixture = {
  period: { from: "2026-10-14", to: "2026-10-20", days: 7, previousFrom: "2026-10-07", previousTo: "2026-10-13" },
  summary: { orders_count: 8, delivered: 5, cancellations: 1, revenue: 2500000, collected: 1800000, outstanding: 700000, gross_value: 3000000, order_value: 2800000, refund_due: 200000, paid_count: 3, partial_count: 2, unpaid_count: 0 },
  previous: { orders_count: 4, delivered: 3, cancellations: 0, revenue: 1500000, collected: 1200000, outstanding: 300000, gross_value: 1800000, order_value: 1800000, refund_due: 0, paid_count: 2, partial_count: 0, unpaid_count: 2 },
  products: [{ name: "Bó hồng Hà Nội", quantity: 5, item_value: 2500000, orders_count: 4 }],
  sources: [{ creation_source: "manual", sales_channel: "zalo", orders_count: 3, order_value: 1000000, revenue: 800000, outstanding: 200000 }, { creation_source: "manual", sales_channel: "in_person", orders_count: 2, order_value: 500000, revenue: 500000, outstanding: 0 }],
  deliveries: [{ day: "2026-10-20", orders_count: 8, delivered: 5, remaining: 3 }],
  definition: "Revenue and collected legacy payload",
};
let checks = 0;
function check(ok, message) { assert(ok, message); checks++; }
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
    let data = structuredClone(fixture);
    const errors = [], writes = [];
    await context.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let result = [];
      if (path === "/api/activity" && req.method() === "POST") result = { ok: true };
      else if (req.method() !== "GET") { writes.push(path); result = { error: "No writes during report QA" }; }
      else if (path === "/api/auth/me") result = { user: { id: 999999, name: "Report QA", email: "qa@example.test", role: "owner", memberships: [] }, ghost: null };
      else if (path.endsWith("/notifications")) result = { items: [] };
      else if (path === "/api/workspace/ai") result = { allowed: true, enabled: true, operational: true, actorRole: "owner", used: 1, limit: 10, plan: "Trải nghiệm" };
      else if (path === "/api/workspace/ai/conversations") result = [{ id: thread, title: "Báo cáo đã lưu" }];
      else if (path.includes("/ai/conversations/")) result = { messages: [{ id: "saved-report", role: "assistant", content: "Báo cáo hoạt động của cửa hàng.", cards: [{ type: "source", title: "Phân tích hoạt động", data, href: "/workspace/1/analytics?from=2026-10-14&to=2026-10-20" }] }] };
      await route.fulfill({ status: 200, json: result });
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const mode of ["full", "quick"]) {
        await page.goto(origin + (mode === "full" ? `/workspace/1/ai?conversation=${thread}` : "/workspace/1/products"));
        if (mode === "quick") {
          await page.getByRole("button", { name: "Mở chat nhanh với trợ lý AI", exact: true }).click();
          await page.getByRole("button", { name: /Hội thoại gần đây/ }).click();
          await page.getByRole("button", { name: "Báo cáo đã lưu", exact: true }).click();
        }
        const report = page.getByRole("region", { name: "Báo cáo phân tích hoạt động", exact: true });
        await expect(report).toBeVisible();
        await expect(report.locator(".ai-report-period")).toContainText("14/10/2026 – 20/10/2026 · 7 ngày");
        await expect(report.locator(".ai-report-period")).not.toContainText("07/10/2026");
        await expect(report.locator(".ai-report-metrics small")).toHaveCount(0);
        await report.getByRole("button", { name: "So sánh kỳ trước", exact: true }).click();
        await expect(report.locator(".ai-report-period")).toContainText("07/10/2026 – 13/10/2026");
        const revenue = report.locator(".ai-report-metrics > div").filter({ has: page.getByText("Doanh thu đã giao", { exact: true }) });
        await expect(revenue.locator("dd > strong")).toHaveText("2.500.000 VNĐ");
        await expect(revenue.locator("small")).toHaveText("Kỳ trước: 1.500.000 VNĐ");
        check(true, "Persisted periods, current and previous amounts stay distinct");
        const shape = await report.boundingBox();
        check(shape.width <= width && shape.height < 500, `${engine.name()} ${mode} ${width}: report fits one compact frame`);
        await report.screenshot({ path: `${out}/${engine.name()}-${mode}-${width}.png` });
        await page.screenshot({ path: `${out}/page-${engine.name()}-${mode}-${width}.png` });
        for (const tab of ["Chỉ số khác", "Sản phẩm", "Kênh tiếp nhận", "Lịch giao", "Tổng quan"]) {
          await report.getByRole("button", { name: tab, exact: true }).click();
          if (tab === "Chỉ số khác") {
            const row = report.getByRole("row").filter({ hasText: "Cần hoàn tiền" });
            await expect(row).toContainText("200.000 VNĐ");
            await expect(report.getByRole("row").filter({ hasText: "Đơn chưa thanh toán" }).getByRole("cell").nth(1)).toHaveText("0");
          }
          if (tab === "Sản phẩm") await expect(report.getByRole("row").filter({ hasText: "Bó hồng Hà Nội" })).toContainText("2.500.000 VNĐ");
          if (tab === "Kênh tiếp nhận") { await expect(report.getByText("Tại cửa hàng", { exact: true })).toBeVisible(); await expect(report.getByText("Zalo", { exact: true })).toBeVisible(); }
          if (tab === "Lịch giao") await expect(report.getByRole("cell", { name: "20/10/2026", exact: true })).toBeVisible();
          check(!/gross_value|order_value|paid_count|previousFrom|previousTo|refund_due|in_person|creation_source|Revenue|collected/.test(await report.innerText()), "No raw analytics keys or enum values leak into report");
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No horizontal page overflow");
          const region = await report.locator(".ai-report-body").boundingBox();
          check(region.height <= 311, "Report content stays bounded when changing sections");
        }
        await expect(page.getByRole("link", { name: "Mở trang chi tiết →" })).toHaveAttribute("href", /\/workspace\/1\/analytics\?from=2026-10-14&to=2026-10-20/);
        check(true, "Analytics source link retains tenant and selected period");
        console.log(`PASS ${engine.name()} ${mode} ${width}px: saved report, Vietnamese labels/dates/currency, sections, bounded layout`);
      }
    }
    data = { ...structuredClone(fixture), period: { from: "2026-10-14", to: "2026-10-20", days: 7 }, comparePrevious: false, previous: undefined, products: [], sources: [], deliveries: [] };
    await page.goto(origin + `/workspace/1/ai?conversation=${thread}`);
    const report = page.locator(".ai-report");
    await expect(report.locator(".ai-report-metrics small")).toHaveCount(0);
    await expect(report.getByRole("button", { name: "So sánh kỳ trước", exact: true })).toHaveCount(0);
    for (const label of ["Sản phẩm", "Kênh tiếp nhận", "Lịch giao"]) {
      await report.getByRole("button", { name: label, exact: true }).click();
      await expect(report.getByText("Chưa có dữ liệu trong kỳ này.", { exact: true })).toBeVisible();
    }
    check(true, "Reports without comparison hide prior-period labels, empty tables stay explicit");
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
console.log(`${checks} AI report UI checks passed; all API calls intercepted`);
