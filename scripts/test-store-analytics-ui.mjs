import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";
import { chooseSelect, nativeSelect } from "./ui-controls.mjs";

const expect = baseExpect.configure({ timeout: 20000 });
const fixture = JSON.parse(
  await readFile(".local/analytics-fixture.json", "utf8"),
);
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
await mkdir(".local/screenshots", { recursive: true });
function report(from, to, empty = false) {
  const result = structuredClone(empty ? fixture.empty : fixture.data);
  const start = Date.parse(from),
    days = Math.round((Date.parse(to) - start) / 86400000) + 1;
  const date = (ms) => new Date(ms).toISOString().slice(0, 10);
  result.period = {
    from,
    to,
    days,
    previousFrom: date(start - days * 86400000),
    previousTo: date(start - 86400000),
  };
  result.daily = Array.from({ length: days }, (_, i) => ({
    ...fixture.empty.daily[0],
    ...(!empty ? fixture.data.daily[i - days + 3] || {} : {}),
    day: date(start + i * 86400000),
  }));
  return result;
}
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "vi-VN",
      timezoneId: "America/Los_Angeles",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage(),
      errors = [],
      writes = [],
      calls = [];
    let empty = false,
      fail = false;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date("2026-10-18T17:05:00Z"));
    await context.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname;
      if (path === "/api/activity") return route.fulfill({ json: { ok: true } });
      if (req.method() !== "GET") writes.push(path);
      let data = [];
      if (path === "/api/auth/me")
        data = {
          user: {
            id: 999999,
            name: "QA",
            email: "qa@example.test",
            role: "owner",
            memberships: [],
          },
        };
      else if (path.endsWith("/notifications")) data = { items: [] };
      else if (path === "/api/workspace/analytics") {
        calls.push(url.search);
        if (fail)
          return route.fulfill({
            status: 503,
            json: { error: "Không thể tải báo cáo QA" },
          });
        data = report(
          url.searchParams.get("from"),
          url.searchParams.get("to"),
          empty,
        );
      }
      await route.fulfill({ json: data });
    });
    await page.goto(origin + "/admin/analytics");
    await expect(
      page.getByRole("heading", { name: "Nhịp kinh doanh", exact: true }),
    ).toBeVisible();
    assert(
      calls[0].includes("from=2026-09-20&to=2026-10-19"),
      "Default 30 inclusive Hanoi days even for US browser",
    );
    await expect(page.locator(".stat-card").first()).toContainText(
      "1.700.000 VNĐ",
    );
    await expect(page.locator(".stat-card").nth(1)).toContainText(
      "1.900.000 VNĐ",
    );
    await expect(page.locator(".stat-card").nth(3)).toContainText(
      "500.000 VNĐ",
    );
    const progress = await page
      .locator(".analytics-breakdown")
      .first()
      .locator(".small-progress i")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    assert.equal(progress[0], 0);
    assert(
      progress[1] > 0 && progress[1] < 150,
      "Fractional percentages render as valid CSS widths",
    );
    const from = page.getByLabel("Từ ngày", { exact: true }),
      to = page.getByLabel("Đến ngày", { exact: true });
    const count = calls.length;
    await from.fill("2026-10-01");
    await to.fill("2026-10-03");
    assert.equal(
      calls.length,
      count,
      "Date drafts do not refetch until applied",
    );
    await page.getByRole("button", { name: "Áp dụng", exact: true }).click();
    await expect(page.locator(".analytics-context")).toContainText(
      "01/10/2026 – 03/10/2026",
    );
    await expect(page.locator(".analytics-bar")).toHaveCount(3);
    await page.locator(".analytics-bar").first().click();
    await expect(page.locator(".analytics-chart-detail")).toContainText(
      "01/10/2026",
    );
    await chooseSelect(nativeSelect(page, "Chỉ số biểu đồ"), "collected");
    await expect(page.locator(".analytics-chart-detail")).toContainText(
      "900.000 VNĐ",
    );
    await page.locator(".analytics-daily > summary").click();
    await expect(page.locator(".analytics-daily tbody tr")).toHaveCount(3);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Xuất CSV", exact: true }).click();
    const download = await downloadPromise;
    const csvPath = ".local/analytics-" + engine.name() + ".csv";
    await download.saveAs(csvPath);
    const csv = await readFile(csvPath, "utf8");
    assert.equal(csv.split("\r\n").length, 4);
    assert(csv.includes("2026-10-01;1;0;1000000;1000000;900000;100000"));
    const focusedCalls = calls.length;
    await page.evaluate(() => {
      window.qaAnalyticsPanel = document.querySelector(".analytics-results");
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(150);
    assert.equal(
      calls.length,
      focusedCalls,
      "Returning to tab does not refetch or blank report",
    );
    assert(
      await page.evaluate(
        () =>
          window.qaAnalyticsPanel ===
          document.querySelector(".analytics-results"),
      ),
    );
    await from.fill("2026-10-05");
    await to.fill("2026-10-01");
    await page.getByRole("button", { name: "Áp dụng", exact: true }).click();
    await expect(
      page.locator(".store-analytics").getByRole("alert"),
    ).toContainText("Khoảng ngày không hợp lệ");
    assert.equal(
      calls.length,
      focusedCalls,
      "Invalid range does not query database",
    );
    await page.getByRole("button", { name: "7 ngày", exact: true }).click();
    await expect(page.locator(".analytics-bar")).toHaveCount(7);
    await expect(
      page.locator(".store-analytics").getByRole("alert"),
    ).toHaveCount(0);
    fail = true;
    await page
      .getByRole("button", { name: "Làm mới báo cáo", exact: true })
      .click();
    await expect(
      page.locator(".store-analytics").getByRole("alert"),
    ).toContainText("Không thể tải báo cáo QA");
    await expect(page.locator(".analytics-results")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Thử lại", exact: true }).click();
    await expect(
      page.locator(".store-analytics").getByRole("alert"),
    ).toHaveCount(0);
    for (const [width, height] of [
      [1440, 1000],
      [1024, 900],
      [390, 844],
      [320, 740],
    ]) {
      await page.setViewportSize({ width, height });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "No page overflow at " + width,
      );
      for (const input of [from, to]) {
        const box = await input.boundingBox();
        assert(
          box.width > 80 && box.x >= 0 && box.x + box.width <= width + 1,
          "Date input stays within mobile viewport",
        );
      }
      const boxes = await Promise.all([from.boundingBox(), to.boundingBox()]);
      assert(
        boxes[0].x + boxes[0].width <= boxes[1].x ||
          boxes[0].y + boxes[0].height <= boxes[1].y,
        "Date fields do not overlap",
      );
      if (width === 1440 || width === 390)
        await page.screenshot({
          path: `.local/screenshots/analytics-${engine.name()}-${width}.png`,
          fullPage: true,
        });
    }
    empty = true;
    await page
      .getByRole("button", { name: "Làm mới báo cáo", exact: true })
      .click();
    await expect(page.locator(".stat-card").first()).toContainText("0 VNĐ");
    await expect(page.locator(".analytics-chart-detail")).toContainText(
      "Chưa phát sinh",
    );
    assert((await page.locator(".analytics-empty").count()) >= 4);
    empty = false;
    await page.goto(origin + "/workspace/1/analytics?from=2026-10-14&to=2026-10-20");
    await expect(page.locator(".analytics-context")).toContainText("14/10/2026 – 20/10/2026");
    await expect(page.getByLabel("Từ ngày", { exact: true })).toHaveValue("2026-10-14");
    await expect(page.getByLabel("Đến ngày", { exact: true })).toHaveValue("2026-10-20");
    await page.evaluate(() => window.history.pushState(null, "", "?from=2026-10-01&to=2026-10-03"));
    await expect(page.locator(".analytics-context")).toContainText("01/10/2026 – 03/10/2026");
    await page.goto(origin + "/workspace/1/analytics?from=2026-02-30&to=2026-10-20");
    await expect(page.locator(".analytics-context")).toContainText("20/09/2026 – 19/10/2026");
    assert.deepEqual(errors, []);
    assert.deepEqual(
      writes,
      [],
      "No orders, receipts, email or tracking writes",
    );
    console.log(
      `PASS ${engine.name()} analytics: Hanoi dates, correct totals, filters, interactive chart, CSV, focus stability, error/retry/empty states, desktop/mobile layout`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
