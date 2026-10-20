import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Local UI only");
const output = ".local/platform-overview-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
let checks = 0;
const check = (value, title) => {
  assert(value, title);
  checks++;
  console.log("PASS", title);
};
const identity = {
  id: 999991,
  name: "Overview Admin QA",
  email: "overview@example.test",
  platformRole: "platform_admin",
  memberships: [],
};
const activity = [],
  reads = [],
  errors = [],
  unexpected = [];
let fail = false,
  slow = false;
const now = new Date().toISOString();
const quotas = {
  products: { used: 9, limit: 10, percent: 90, level: "near" },
  staff: { used: 1, limit: 3, percent: 33, level: "normal" },
  storage_mb: { used: 1, limit: 100, percent: 1, level: "normal" },
  email_sends: { used: 51, limit: 50, percent: 102, level: "over" },
  ai_messages: { used: 10, limit: 10, percent: 100, level: "full" },
};
function payload(url) {
  const from = url.searchParams.get("from"),
    to = url.searchParams.get("to"),
    page = Number(url.searchParams.get("page") || 1),
    userPage = Number(url.searchParams.get("user_page") || 1);
  const daily = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000)
    daily.push({
      day: new Date(t).toISOString().slice(0, 10),
      collected: 139000,
      gmv: 1000000,
      orders_count: 2,
      stores: 1,
    });
  const store = {
    id: page === 1 ? 999991 : 999992,
    name: page === 1 ? "Tiệm Hoa Hà Nội QA" : "Tiệm Hoa Trang Hai QA",
    slug: "qa-flower",
    plan_name: "Studio",
    status: "approved",
    usage: quotas,
    last_activity_at: now,
    last_seen_at: now,
  };
  return {
    generated_at: now,
    period: { from, to, days: daily.length },
    daily,
    stats: {
      stores: 12,
      approved: 10,
      pending: 2,
      users: 25,
      new_users: 3,
      collected: 417000,
      mrr: 598000,
      paid: 2,
      orders: 60,
      gmv: 30000000,
      active_users_30d: 8,
      near_limit: 1,
      free: 7,
      trialing: 3,
      needs_sync: 1,
      expiring: 2,
      overdue: 1,
      suspended: 1,
      inactive: 1,
    },
    health: {
      email_issues: 1,
      payment_issues: 2,
      ai_failures: 0,
      open_issues: 1,
    },
    plans: [
      { id: 1, name: "Khởi đầu", stores: 3, paid: 1, mrr: 139000 },
      { id: 2, name: "Studio", stores: 2, paid: 1, mrr: 459000 },
      { id: 3, name: "Atelier", stores: 0, paid: 0, mrr: 0 },
      { id: 4, name: "Trải nghiệm", stores: 7, paid: 0, mrr: 0 },
    ],
    usage: { rows: [store], total: 12, page, page_size: 10 },
    top_stores: [{ ...store, orders: 12, gmv: 10000000, collected: 139000 }],
    users: {
      rows: [
        {
          id: 999990,
          name: userPage === 1 ? "Khách QA" : "Khách Trang Hai QA",
          email: "qa@example.test",
          active: 1,
          created_at: now,
          last_seen_at: null,
          platform_admin: 0,
          memberships: [
            { store_id: 999991, store_name: store.name, role: "owner" },
          ],
        },
      ],
      total: 12,
      page: userPage,
      page_size: 10,
    },
  };
}
try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  await ctx.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    let data = [],
      status = 200;
    if (path === "/api/auth/me") data = { user: identity, ghost: null };
    else if (path === "/api/activity" && request.method() === "POST") {
      activity.push(request.postDataJSON());
      data = { ok: true };
    } else if (request.method() !== "GET") {
      unexpected.push(path);
      status = 400;
      data = { error: "Unexpected UI write blocked" };
    } else if (path === "/api/platform/overview") {
      reads.push(url);
      if (slow) await new Promise((resolve) => setTimeout(resolve, 250));
      if (fail) {
        status = 503;
        data = { error: "QA: lỗi kết nối tạm thời" };
      } else data = payload(url);
    } else if (path === "/api/platform/stores/999991")
      data = {
        store: {
          id: 999991,
          name: "Tiệm Hoa Hà Nội QA",
          slug: "qa-flower",
          status: "approved",
          version: 1,
        },
        subscription: {
          plan_id: 2,
          plan_name: "Studio",
          status: "active",
          billing_policy: 1,
          trial_days_granted: null,
        },
        tasks: [],
        audit: [],
      };
    else if (path.endsWith("/notifications")) data = { items: [] };
    await route.fulfill({ status, json: data });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/platform/overview");
  const report = page.locator(".platform-overview");
  await expect(report.locator(".stat-card")).toHaveCount(8);
  const menu = await page
    .locator('nav[aria-label="Điều hướng platform"] a')
    .allTextContents();
  check(
    menu.indexOf("Cửa hàng & Merchant CRM") <
      menu.indexOf("Danh mục gói dịch vụ"),
    "Store CRM appears before plan catalog",
  );
  await expect(
    report.getByRole("heading", { name: "Hạn mức sử dụng của cửa hàng" }),
  ).toBeVisible();
  await expect(report.locator(".platform-quota.over")).toContainText("51 / 50");
  await expect(report.locator(".platform-quota.full")).toContainText(
    "Đã hết hạn mức",
  );
  check(true, "KPI, usage limits and warning colors render actual data");
  const usage = report
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Hạn mức sử dụng của cửa hàng",
        exact: true,
      }),
    });
  const accounts = report
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Hoạt động tài khoản",
        exact: true,
      }),
    });
  await expect(accounts).toContainText("Quản trị cửa hàng");
  await expect(accounts).toContainText("Chưa ghi nhận");
  check(
    !(await accounts.getByText("0", { exact: true }).count()),
    "Account roles and unknown activity have clear labels, no numeric role artifact",
  );
  await usage
    .getByRole("button", {
      name: "Xem cửa hàng Tiệm Hoa Hà Nội QA",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Tiệm Hoa Hà Nội QA");
  await page.keyboard.press("Escape");
  check(true, "Unified icon opens the existing store detail modal");
  await report.getByRole("button", { name: "7 ngày", exact: true }).click();
  await expect(report.locator(".platform-chart-bar")).toHaveCount(7);
  await report.locator(".platform-chart-bar").first().click();
  await expect(report.locator(".platform-chart-bar").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await report.getByRole("combobox", { name: "Chỉ số biểu đồ" }).click();
  await page
    .getByRole("option", { name: "GMV đơn đã giao", exact: true })
    .click();
  await expect(report.locator(".platform-chart-caption").first()).toContainText(
    "GMV đơn đã giao",
  );
  check(true, "Date presets and interactive chart metric selection work");
  await report.locator('input[type="date"]').first().fill("2026-10-01");
  await report.locator('input[type="date"]').nth(1).fill("2026-10-03");
  await report.getByRole("button", { name: "Áp dụng", exact: true }).click();
  await expect(report.locator(".platform-chart-bar")).toHaveCount(3);
  check(
    reads.at(-1).searchParams.get("from") === "2026-10-01" &&
      reads.at(-1).searchParams.get("to") === "2026-10-03",
    "Custom date range reaches the API without timezone shifts",
  );
  await usage.getByRole("textbox").fill("Hà Nội");
  await usage.getByRole("combobox", { name: "Gói dịch vụ" }).click();
  await page.getByRole("option", { name: "Studio", exact: true }).click();
  await usage.getByRole("combobox", { name: "Mức sử dụng" }).click();
  await page
    .getByRole("option", { name: "Từ 80% hạn mức", exact: true })
    .click();
  await usage
    .getByRole("button", { name: "Lọc cửa hàng", exact: true })
    .click();
  await expect.poll(() => reads.at(-1).searchParams.get("q")).toBe("Hà Nội");
  check(
    reads.at(-1).searchParams.get("plan") === "2" &&
      reads.at(-1).searchParams.get("usage") === "near",
    "Store, plan and quota filters combine in the report request",
  );
  await usage.getByRole("button", { name: "Sau", exact: true }).click();
  await expect(usage).toContainText("Tiệm Hoa Trang Hai QA");
  await accounts.getByRole("textbox").fill("Khách");
  await accounts
    .getByRole("button", { name: "Lọc tài khoản", exact: true })
    .click();
  await expect
    .poll(() => reads.at(-1).searchParams.get("user_q"))
    .toBe("Khách");
  await accounts.getByRole("button", { name: "Sau", exact: true }).click();
  await expect(accounts).toContainText("Khách Trang Hai QA");
  check(
    reads.at(-1).searchParams.get("page") === "2" &&
      reads.at(-1).searchParams.get("user_page") === "2",
    "Store and account pagination are independent and retain filters",
  );
  const beforeReads = reads.length,
    beforeActivity = activity.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(report.locator(".stat-card")).toHaveCount(8);
  await page.waitForTimeout(350);
  check(
    reads.length === beforeReads && activity.length === beforeActivity,
    "Window focus neither reloads report nor fabricates user activity",
  );
  slow = true;
  fail = true;
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(report.locator(".stat-card")).toHaveCount(8);
  await expect(report.getByRole("alert")).toContainText(
    "QA: lỗi kết nối tạm thời",
  );
  check(
    true,
    "Existing report remains visible while refreshing and on temporary failure",
  );
  fail = false;
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(report.getByRole("alert")).toHaveCount(0);
  await expect(report.locator(".analytics-results")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  check(true, "Explicit refresh recovers from errors");
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(100);
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Overview stays within viewport at ${width}px`,
    );
    const dates = await report
      .locator(".date-control")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          left: n.getBoundingClientRect().left,
          right: n.getBoundingClientRect().right,
          width: n.getBoundingClientRect().width,
        })),
      );
    check(
      dates.length === 2 &&
        dates.every((r) => r.left >= 0 && r.right <= width && r.width > 80),
      `Date fields fit at ${width}px`,
    );
    await page.screenshot({
      path: `${output}/overview-${width}.png`,
      fullPage: true,
    });
  }
  check(
    activity.length > 0 && unexpected.length === 0,
    "Signed-in navigation records presence; UI QA sends no business writes",
  );
  check(errors.length === 0, "No runtime errors: " + errors.join("; "));
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ checks, api: "intercepted fixtures", errors }, null, 2),
  );
  console.log(`${checks} platform overview UI checks passed`);
} finally {
  await browser.close();
}
