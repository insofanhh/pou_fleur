import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { mkdir } from "node:fs/promises";
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3004";
if (process.env.MYSQL_DATABASE !== "fleur_saas_test")
  throw Error("Use isolated SaaS test database");
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
});
const [[store]] = await db.query(
  "SELECT s.*,u.email FROM stores s JOIN users u ON u.id=s.owner_id WHERE s.slug LIKE 'test-%' AND EXISTS(SELECT 1 FROM orders o WHERE o.store_id=s.id AND o.status='delivered') ORDER BY s.id DESC LIMIT 1",
);
await db.execute("DELETE FROM login_attempts");
await db.end();
assert(store);
await mkdir(".local/screenshots", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: chromium.executablePath(),
});
let checks = 0;
const check = (ok, label) => {
  assert(ok, label);
  checks++;
  console.log("PASS", label);
};
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("heading", { name: /Một tiệm hoa gần bạn/ }).waitFor();
  await page
    .getByRole("link", { name: store.name, exact: true })
    .first()
    .waitFor();
  check(
    (await page.locator(".store-card").count()) > 0,
    "Marketplace renders real stores",
  );
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page.getByText("Bản đồ chưa được bật.").waitFor();
  check(true, "Maps missing-key fallback keeps store list available");
  await page.screenshot({
    path: ".local/screenshots/marketplace-desktop.png",
    fullPage: true,
  });
  await page.goto(base + "/s/" + store.slug);
  await page
    .getByRole("heading", { name: "Hoa của riêng bạn", exact: true })
    .waitFor();
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Khám phá hoa" })
    .click();
  await page.waitForURL("**/s/" + store.slug + "/shop");
  check(true, "Store links preserve store scope");
  await page
    .getByRole("link", { name: "Hoa kiểm thử", exact: true })
    .first()
    .click();
  await page.waitForURL("**/product/hoa-test");
  await page.getByRole("button", { name: /Thêm vào giỏ/ }).click();
  await page.goto(base + "/s/" + store.slug + "/cart");
  await page.getByText("Hoa kiểm thử", { exact: true }).first().waitFor();
  check(true, "Product can be added to scoped cart");
  await page.goto(base + "/s/fleur/cart");
  check(
    !(await page.locator(".cart-item").count()),
    "Another store does not show previous cart",
  );
  await page.goto(base + "/s/" + store.slug + "/checkout");
  await page.locator(".checkout-form").waitFor();
  check(
    (
      await page.locator('.checkout-form a[href*="login"]').getAttribute("href")
    ).includes(encodeURIComponent("/s/" + store.slug + "/checkout")),
    "Checkout login retains original store destination",
  );
  check(
    await page.locator('input[name="deliveryMode"][value="gift"]').isChecked(),
    "Gift delivery remains default",
  );
  await page.locator('input[name="deliveryMode"][value="self"]').check();
  check(
    (await page.locator('input[name="recipientName"]').count()) === 0,
    "Self delivery does not repeat recipient name",
  );
  await page.goto(base + "/cart");
  await page.getByRole("heading", { name: "Giỏ hoa của bạn." }).waitFor();
  await page.getByRole("link", { name: "Xem giỏ", exact: true }).waitFor();
  check(
    (await page
      .getByRole("link", { name: "Xem giỏ", exact: true })
      .getAttribute("href")) ===
      "/s/" + store.slug + "/cart",
    "Global cart links to the right store cart",
  );
  await page.goto(base + "/login");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .first()
    .fill(store.email);
  await page.locator('input[name="password"]').fill("SaaS-Testing-2026-Only");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL("**/workspace/" + store.id);
  await page.locator(".admin-sidebar").waitFor();
  check(true, "Store owner login redirects to correct workspace");
  for (const area of [
    "products",
    "orders",
    "board",
    "calendar",
    "analytics",
    "settings",
    "theme",
    "billing",
    "users",
    "crm",
    "emails",
    "automations",
  ]) {
    await page.goto(base + "/workspace/" + store.id + "/" + area);
    await page.locator(".admin-content").waitFor();
    await page.waitForTimeout(350);
    await page
      .getByText("Đang tải…", { exact: true })
      .waitFor({ state: "hidden" })
      .catch(() => {});
    check(
      !(await page
        .getByText("Không thể hoàn tất yêu cầu. Vui lòng thử lại.", {
          exact: true,
        })
        .count()),
      "Workspace renders " + area,
    );
    if (["board", "calendar", "theme"].includes(area))
      await page.screenshot({
        path: ".local/screenshots/" + area + "-desktop.png",
        fullPage: true,
      });
  }
  await page.goto(base + "/workspace/" + store.id + "/board");
  await page.locator(".kanban-card").first().waitFor();
  await page.locator(".kanban-card").first().click();
  await page.getByRole("dialog").waitFor();
  check(true, "Kanban opens order details");
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.goto(base + "/workspace/" + store.id + "/calendar");
  await page.locator(".calendar-day").first().waitFor();
  await page.locator(".calendar-day").nth(19).click();
  check(
    (await page
      .getByRole("heading", { name: "Ghi chú cho ngày này" })
      .count()) === 1,
    "Calendar selects day with note editor",
  );
  await page.getByRole("button", { name: "Tuần", exact: true }).click();
  await expect(page.locator(".calendar-day")).toHaveCount(7);
  check(
    (await page.locator(".calendar-day").count()) === 7,
    "Calendar week view shows seven days",
  );
  await page.getByRole("button", { name: "Lịch trình", exact: true }).click();
  await page.locator(".calendar-agenda").waitFor();
  await page.locator(".calendar-agenda .kanban-card").first().waitFor();
  check(
    (await page.locator(".calendar-agenda .kanban-card").count()) > 0,
    "Agenda shows scheduled orders",
  );
  const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    }),
    m = await mobile.newPage();
  m.on("pageerror", (e) => errors.push(e.message));
  for (const path of [
    "/",
    "/s/" + store.slug,
    "/s/" + store.slug + "/shop",
    "/s/" + store.slug + "/product/hoa-test",
    "/s/" + store.slug + "/cart",
    "/account",
    "/inbox",
  ]) {
    await m.goto(base + path);
    await m.waitForTimeout(300);
    await m.locator(".app-bottom-nav").waitFor();
    check(
      await m.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "No mobile horizontal overflow " + path,
    );
  }
  await m.goto(base);
  await m.locator(".store-card").first().waitFor();
  await m.screenshot({
    path: ".local/screenshots/marketplace-mobile.png",
    fullPage: true,
  });
  for (const template of [
    "minimal",
    "editorial",
    "garden",
    "atelier",
    "modern",
  ]) {
    const sr = await page.request.get(base + "/api/workspace/settings", {
      headers: { "x-fleur-store": String(store.id) },
    });
    const current = await sr.json();
    const theme = { ...current.theme, template };
    const r = await page.request.post(base + "/api/workspace/theme/publish", {
      headers: { origin: base, "x-fleur-store": String(store.id) },
      data: { theme, version: current.version },
    });
    assert(r.ok());
    await m.goto(base + "/s/" + store.slug);
    await m.getByRole("heading", { name: theme.hero, exact: true }).waitFor();
    if (template === "modern") {
      const button = m.locator(".template-home-intro > .button");
      await expect(button).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(button).toHaveCSS("color", "rgb(23, 23, 23)");
      check(true, "Modern hero CTA retains readable contrast with store theme");
    }
    check(
      await m.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Template " + template + " renders on mobile",
    );
    await m.screenshot({
      path: ".local/screenshots/template-" + template + "-mobile.png",
      fullPage: true,
    });
    await page.goto(base + "/s/" + store.slug);
    await page
      .getByRole("heading", { name: theme.hero, exact: true })
      .waitFor();
    await page.screenshot({
      path: ".local/screenshots/template-" + template + "-desktop.png",
      fullPage: true,
    });
    await m.goto(base + "/s/" + store.slug + "/product/hoa-test");
    await m.getByRole("button", { name: /Thêm vào giỏ/ }).click();
    await m.goto(base + "/s/" + store.slug + "/checkout");
    await m.locator(".checkout-layout").waitFor();
    check(
      (await m.locator('textarea[name="message"]').count()) === 1 &&
        (await m
          .locator('input[name="deliveryMode"][value="gift"]')
          .isChecked()),
      "Template " + template + " keeps checkout and message",
    );
    const dateBox = await m.locator('input[name="deliveryDate"]').boundingBox(),
      slotBox = await m.locator('select[name="deliverySlot"]').boundingBox();
    check(
      dateBox &&
        slotBox &&
        (dateBox.y + dateBox.height <= slotBox.y ||
          dateBox.x + dateBox.width <= slotBox.x),
      "Template " + template + " separates mobile date and slot inputs",
    );
  }
  const sw = await m.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return !!navigator.serviceWorker.controller;
  });
  if (sw) {
    await mobile.setOffline(true);
    await m.goto(base + "/offline-check");
    await m.getByRole("heading", { name: "Một chút gián đoạn." }).waitFor();
    check(true, "PWA serves offline fallback without replaying checkout");
    await mobile.setOffline(false);
  }
  await page.request.post(base + "/api/auth/logout", {
    headers: { origin: base },
  });
  await page.goto(base + "/login");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .first()
    .fill("owner@example.test");
  await page.locator('input[name="password"]').fill("SaaS-Testing-2026-Only");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL("**/platform");
  check(true, "Platform admin login redirects to platform console");
  for (const area of ["overview", "stores", "invoices", "users", "health"]) {
    await page.goto(base + "/platform/" + area);
    await page.locator(".admin-content").waitFor();
    await page
      .getByText("Đang tải dữ liệu…", { exact: true })
      .waitFor({ state: "hidden" });
    check(
      (await page.locator(".admin-content .error").count()) === 0,
      "Platform console renders " + area,
    );
    if (area === "stores")
      await page.screenshot({
        path: ".local/screenshots/platform-stores.png",
        fullPage: true,
      });
  }
  check(errors.length === 0, "No browser runtime errors: " + errors.join("; "));
  console.log(`UI: ${checks} assertions passed`);
  await context.close();
  await mobile.close();
} finally {
  await browser.close();
}
