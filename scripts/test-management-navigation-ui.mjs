import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { chromium, expect } from "@playwright/test";

if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use isolated SaaS QA database on port 3310");
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
});
const [[store]] = await db.query(
  "SELECT s.id FROM stores s JOIN store_memberships m ON m.store_id=s.id JOIN users u ON u.id=m.user_id WHERE u.email='owner@example.test' AND m.role='owner' AND m.status='active' AND s.status='approved' ORDER BY s.id DESC LIMIT 1",
);
await db.end();
assert(store, "Run SaaS fixture setup first");
const browser = await chromium.launch();
let checks = 0;
const check = (ok, label) => {
  assert(ok, label);
  checks++;
  console.log("PASS", label);
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 850 },
    reducedMotion: "reduce",
  });
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { origin: base, "x-fleur-store": String(store.id) },
    data: { email: "owner@example.test", password: "SaaS-Testing-2026-Only" },
  });
  assert(login.ok());
  const identity = await login.json();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let documentLoads = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentLoads++;
  });
  const root = `/workspace/${store.id}`;
  await page.goto(base + root + "/settings");
  await page
    .getByRole("button", { name: "Lưu cấu hình", exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.navigationSidebar = document.querySelector(".admin-sidebar");
    window.navigationShell = document.querySelector(".admin-shell");
    const nav = document.querySelector(".admin-sidebar nav");
    nav.scrollTop = nav.scrollHeight;
    window.navigationScroll = nav.scrollTop;
    window.navigationShellRemoved = false;
    new MutationObserver(() => {
      if (!window.navigationShell.isConnected)
        window.navigationShellRemoved = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const sidebar = page.locator(".admin-sidebar nav");
  await sidebar
    .getByRole("link", { name: "Khách hàng & CRM", exact: true })
    .click();
  await page.waitForURL(base + root + "/crm");
  await expect(page.locator(".crm-summary")).toBeVisible();
  check(
    await page.evaluate(
      () =>
        window.navigationSidebar === document.querySelector(".admin-sidebar") &&
        Math.abs(
          document.querySelector(".admin-sidebar nav").scrollTop -
            window.navigationScroll,
        ) <= 1,
    ),
    "Workspace sidebar remains mounted and preserves menu scroll",
  );
  await sidebar
    .getByRole("link", { name: "Nhật ký hoạt động", exact: true })
    .click();
  await page.waitForURL(base + root + "/audit");
  await expect(
    sidebar.getByRole("link", { name: "Nhật ký hoạt động", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".admin-table-panel")).toBeVisible();
  check(
    documentLoads === 1 &&
      (await page.evaluate(() => !window.navigationShellRemoved)),
    "Menu navigation never reloads the document or removes the management shell",
  );
  await page.goBack();
  await page.waitForURL(base + root + "/crm");
  await expect(page.locator(".crm-summary")).toBeVisible();
  await page.goForward();
  await page.waitForURL(base + root + "/audit");
  await expect(page.locator(".admin-table-panel")).toBeVisible();
  check(
    await page.evaluate(
      () =>
        window.navigationSidebar === document.querySelector(".admin-sidebar"),
    ),
    "Back and Forward retain the shared workspace sidebar",
  );

  let release;
  let started;
  const startedRequest = new Promise((resolve) => {
    started = resolve;
  });
  const delayedResponse = new Promise((resolve) => {
    release = resolve;
  });
  let fulfilled;
  const finished = new Promise((resolve) => {
    fulfilled = resolve;
  });
  await page.route("**/api/admin/crm", async (route) => {
    const response = await route.fetch();
    started();
    await delayedResponse;
    await route.fulfill({ response });
    fulfilled();
  });
  await sidebar
    .getByRole("link", { name: "Khách hàng & CRM", exact: true })
    .click();
  await startedRequest;
  await sidebar.getByRole("link", { name: "Sản phẩm", exact: true }).click();
  await page.waitForURL(base + root + "/products");
  await expect(page.locator(".admin-table-panel")).toBeVisible();
  release();
  await finished;
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve(!!document.querySelector(".admin-table-panel")),
              ),
            ),
          ),
      ),
    )
    .toBe(true);
  check(
    (await sidebar
      .getByRole("link", { name: "Sản phẩm", exact: true })
      .getAttribute("aria-current")) === "page",
    "A slow response from the previous menu cannot replace the current page",
  );
  await page.unroute("**/api/admin/crm");
  await page.reload();
  await expect(page.locator(".admin-table-panel")).toBeVisible();
  check(
    new URL(page.url()).pathname === root + "/products",
    "Direct URLs and reloads render the selected workspace page",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Mở menu quản trị", exact: true })
    .click();
  await sidebar
    .getByRole("link", { name: "Khách hàng & CRM", exact: true })
    .click();
  await page.waitForURL(base + root + "/crm");
  await expect(page.locator(".admin-sidebar")).not.toHaveClass(/mobile-open/);
  await expect(page.locator(".crm-summary")).toBeVisible();
  await page.evaluate(() => {
    window.mobileShell = document.querySelector(".admin-shell");
  });
  await page
    .getByRole("navigation", { name: "Điều hướng quản lý store" })
    .getByRole("link", { name: "Lịch", exact: true })
    .click();
  await page.waitForURL(base + root + "/calendar");
  await expect(
    page.getByRole("heading", { name: "Lịch giao & ghi chú", exact: true }),
  ).toBeVisible();
  check(
    await page.evaluate(
      () =>
        window.mobileShell === document.querySelector(".admin-shell") &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile drawer and bottom navigation retain the shell without horizontal overflow",
  );

  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto(base + "/admin/products");
  await page.locator(".admin-shell").waitFor();
  await page.evaluate(() => {
    window.legacySidebar = document.querySelector(".admin-sidebar");
  });
  await sidebar
    .getByRole("link", { name: "Khách hàng & CRM", exact: true })
    .click();
  await page.waitForURL(base + "/admin/crm");
  await expect(page.locator(".crm-summary")).toBeVisible();
  check(
    await page.evaluate(
      () => window.legacySidebar === document.querySelector(".admin-sidebar"),
    ),
    "Legacy /admin menu also preserves the sidebar",
  );

  if (identity.user?.platformRole === "platform_admin") {
    await page.goto(base + "/platform/stores");
    await page
      .getByRole("heading", { name: "Cửa hàng & Merchant CRM", exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.platformSidebar = document.querySelector(".admin-sidebar");
    });
    await sidebar.getByRole("link", { name: "Tổng quan", exact: true }).click();
    await page.waitForURL(base + "/platform/overview");
    await expect(page.locator(".stat-grid")).toBeVisible();
    await sidebar.getByRole("link", { name: "Tài khoản", exact: true }).click();
    await page.waitForURL(base + "/platform/users");
    await expect(
      sidebar.getByRole("link", { name: "Tài khoản", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    check(
      await page.evaluate(
        () =>
          window.platformSidebar === document.querySelector(".admin-sidebar"),
      ),
      "Platform menu retains its sidebar and shows the selected page",
    );
  }
  check(
    errors.length === 0,
    "No browser JavaScript errors across menu transitions",
  );
  for (const path of [root + "/orders/new", "/admin/orders/new"]) {
    const response = await context.request.get(base + path);
    check(response.ok(), "Manual order route remains available: " + path);
  }
  for (const path of [root + "/orders/invalid", "/platform/unknown"]) {
    const response = await context.request.get(base + path);
    check(
      response.status() === 404,
      "Invalid management route returns 404: " + path,
    );
  }
  console.log(`${checks} management navigation checks passed.`);
} finally {
  await browser.close();
}
