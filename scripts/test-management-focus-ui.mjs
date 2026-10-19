import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

// UI regression only: intercept every API request; never send mail or mutate data.
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
const browser = await chromium.launch();
const customer = { id: 999998, name: "Focus Customer", email: "customer@example.test", phone: "0900000000", segment: "new", order_count: 0, total_spent: 0 };
const emailData = {
  configuration: { enabled: false, ready: false },
  templates: [{ id: 999998, name: "Focus template", subject: "Order {{order_reference}}", body: "Hello {{customer_name}}, {{order_reference}}", active: 1, kind: "transactional", variables: [] }],
  stats: [], campaigns: [], messages: [], customers: [],
};
let identity = { id: 999999, name: "Focus QA", email: "focus@example.test", role: "owner", platformRole: "platform_admin", memberships: [] };
let authReads = 0;
const reads = new Map();
const writes = [];
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes.push(path);
      await route.fulfill({ status: 400, json: { error: "Focus regression must not mutate data" } });
      return;
    }
    reads.set(path, (reads.get(path) || 0) + 1);
    let data = [];
    if (path === "/api/auth/me") {
      authReads++;
      data = { user: identity && { ...identity, name: `Focus QA ${authReads}` }, ghost: null };
    } else if (path.endsWith("/notifications")) {
      data = { userId: identity?.id, items: [] };
    } else if (path.endsWith("/emails")) {
      data = emailData;
    } else if (path === "/api/admin/crm") {
      data = { customers: [customer], notes: [], tasks: [], orders: [] };
    } else if (path === "/api/admin/overview") {
      data = { stats: {}, revenue: [], recent: [], top: [] };
    } else if (path === "/api/admin/product-taxonomy") {
      data = { categories: [], components: [] };
    }
    // Make an unwanted page fetch long enough to expose even a transient loader.
    if (/^\/api\/(admin|platform)\/(emails|crm|posts|events|promotions|categories|products|overview|inquiries|audit)$/.test(path))
      await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ status: 200, json: data });
  });
  const page = await context.newPage();
  const otherWindow = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
  });

  async function watch(selector) {
    await page.evaluate((selector) => {
      window.focusWatch?.observer.disconnect();
      const element = document.querySelector(selector);
      if (!element) throw Error("Missing focus sentinel: " + selector);
      const watch = window.focusWatch = { element, removed: false, loading: false };
      watch.observer = new MutationObserver((records) => {
        if (!element.isConnected) watch.removed = true;
        for (const record of records) for (const node of record.addedNodes)
          if (node instanceof Element && (node.matches(".loading-state,.admin-loading") || node.querySelector(".loading-state,.admin-loading"))) watch.loading = true;
      });
      watch.observer.observe(document.body, { childList: true, subtree: true });
    }, selector);
  }
  async function returnToWindow(endpoint, selector) {
    await watch(selector);
    const beforeReads = reads.get(endpoint);
    const beforeAuth = authReads;
    const beforeDocuments = documents;
    const account = page.locator(".admin-sidebar .admin-user strong");
    const beforeName = await account.textContent();
    await otherWindow.bringToFront();
    await page.bringToFront();
    // Deterministic also on headless hosts that do not emit native window focus.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => authReads).toBeGreaterThan(beforeAuth);
    await expect(account).not.toHaveText(beforeName);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(reads.get(endpoint), beforeReads, endpoint + " must not refetch for an unchanged identity");
    assert.equal(documents, beforeDocuments, "Window focus must not reload the document");
    assert.deepEqual(await page.evaluate((selector) => ({ removed: window.focusWatch.removed, loading: window.focusWatch.loading, same: window.focusWatch.element === document.querySelector(selector) }), selector), { removed: false, loading: false, same: true });
  }

  const editors = {
    posts: ["Thêm bài viết", "Tiêu đề"], events: ["Thêm sự kiện", "Tên sự kiện"],
    promotions: ["Thêm ưu đãi", "Tên chương trình"], categories: ["Thêm danh mục", "Tên danh mục"],
    products: ["Thêm sản phẩm", "Tên thiết kế"],
  };
  for (const area of ["emails", "crm", "posts", "events", "promotions", "categories", "products", "overview", "inquiries", "audit"]) {
    await page.goto(`${base}/admin/${area}`);
    const selector = area === "emails" ? ".email-workspace" : area === "crm" ? ".crm-summary" : area === "overview" ? ".stat-grid" : ".admin-table-panel";
    await expect(page.locator(selector)).toBeVisible();
    const search = page.getByRole("textbox", { name: area === "crm" ? "Tìm khách hàng" : "Tìm trong danh sách", exact: true });
    if (await search.count()) await search.fill(area === "crm" ? "Focus" : "Keep filter");
    let draft;
    if (editors[area]) {
      const host = page.locator(area === "categories" ? ".taxonomy-manager" : ".admin-heading");
      await host.getByRole("button", { name: editors[area][0], exact: true }).click();
      draft = (area === "categories" ? page.locator(".taxonomy-editor") : page.getByRole("dialog")).getByLabel(editors[area][1], { exact: true });
    } else if (area === "emails") {
      await page.locator(".email-template-list button").first().click();
      draft = page.getByLabel("Tiêu đề email", { exact: true });
    } else if (area === "crm") {
      await page.getByRole("button", { name: "Mở hồ sơ khách hàng", exact: true }).click();
      draft = page.getByLabel("Ghi chú mới", { exact: true });
    }
    if (draft) await draft.fill("Unsaved draft must survive window focus");
    for (let cycle = 0; cycle < 2; cycle++) {
      await returnToWindow(`/api/admin/${area}`, selector);
      if (draft) await expect(draft).toHaveValue("Unsaved draft must survive window focus");
      if (await search.count()) await expect(search).toHaveValue(area === "crm" ? "Focus" : "Keep filter");
    }
    console.log(`PASS /admin/${area}: 2 window returns preserve content, filters and drafts; auth still revalidates`);
  }

  await page.goto(base + "/platform/emails");
  await expect(page.locator(".email-workspace")).toBeVisible();
  await page.locator(".email-template-list button").first().click();
  await page.getByLabel("Tiêu đề email", { exact: true }).fill("Platform draft");
  await returnToWindow("/api/platform/emails", ".email-workspace");
  await expect(page.getByLabel("Tiêu đề email", { exact: true })).toHaveValue("Platform draft");
  console.log("PASS platform email editor also survives identity revalidation");

  await page.goto(base + "/admin/products");
  await expect(page.locator(".admin-table-panel")).toBeVisible();
  await page.locator(".admin-heading").getByRole("button", { name: "Thêm sản phẩm", exact: true }).click();
  identity = { ...identity, role: "support" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Bạn chưa có quyền vào mục này.", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  identity = null;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".admin-gate")).toBeVisible();
  await expect(page.locator(".admin-table-panel")).toHaveCount(0);
  console.log("PASS permission revocation and logout still remove restricted content");
  assert.deepEqual(writes, [], "No mutating API calls during regression");
  assert.deepEqual(errors, [], "No client runtime errors");
} finally {
  await browser.close();
}
