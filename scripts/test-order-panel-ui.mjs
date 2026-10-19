import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { mkdir } from "node:fs/promises";
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
  dateStrings: true,
});
const [[order]] = await db.query(
  "SELECT o.id,o.store_id,o.delivery_date FROM orders o JOIN stores s ON s.id=o.store_id JOIN users u ON u.id=s.owner_id JOIN store_memberships m ON m.store_id=s.id AND m.user_id=u.id WHERE u.active=1 AND m.role='owner' AND m.status='active' AND NOT EXISTS(SELECT 1 FROM platform_memberships p WHERE p.user_id=u.id) ORDER BY o.id LIMIT 1",
);
assert(order, "A QA store order owned by a non-platform account is required");
await db.execute("DELETE FROM login_attempts");
await db.end();
const browser = await chromium.launch();
let passed = 0;
const check = (ok, label) => {
  assert(ok, label);
  passed++;
  console.log("PASS", label);
};
try {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { origin: base },
    data: { email: "owner@example.test", password: "SaaS-Testing-2026-Only" },
  });
  assert(login.ok());
  const ghost = await context.request.post(
    `${base}/api/platform/stores/${order.store_id}/ghost`,
    {
      headers: { origin: base },
      data: { reason: "Kiểm thử bố cục chi tiết Kanban" },
    },
  );
  assert(ghost.ok(), await ghost.text());
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir(".local/order-panel-ui", { recursive: true });
  // Exercise wrapping with long content without changing the stored order.
  await page.route(
    `**/api/workspace/manual-orders/${order.id}`,
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.reference = "FL20261018".repeat(5);
      data.address = "Địa chỉ giao hoa chi tiết ".repeat(10);
      data.message =
        "Lời nhắn trên thiệp\n" + "LờiNhắnDàiKhôngCóKhoảngTrắng".repeat(10);
      await route.fulfill({ response, json: data });
    },
  );
  for (const [width, height] of [
    [1440, 1000],
    [1280, 720],
    [390, 844],
    [360, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(
      `${base}/workspace/${order.store_id}/board?order=${order.id}`,
    );
    const dialog = page.locator("dialog.order-panel");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty("open", true);
    check(
      await dialog.evaluate((e) => e.matches(":modal")),
      "Order details use modal top layer at " + width,
    );
    const rect = await dialog.boundingBox();
    check(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= width + 1 &&
        rect.y + rect.height <= height + 1 &&
        Math.abs(rect.x + rect.width / 2 - width / 2) < 2,
      "Dialog stays centered inside viewport at " + width,
    );
    await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
    check(
      await page.evaluate(() => document.body.style.overflow === "hidden"),
      "Background page is locked at " + width,
    );
    check(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Long order data does not overflow at " + width,
    );
    const header = dialog.locator(".modal-heading");
    const top = await header.boundingBox();
    const scrollBefore = await page.evaluate(() => scrollY);
    await dialog.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    const bottom = await header.boundingBox();
    check(
      Math.abs(top.y - bottom.y) < 2 &&
        (await page.evaluate(() => scrollY)) === scrollBefore,
      "Header stays visible while only modal scrolls at " + width,
    );
    const close = dialog.getByRole("button", { name: "Đóng", exact: true });
    check(
      await close.evaluate((e) => {
        const b = e.getBoundingClientRect();
        return e.contains(
          document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
        );
      }),
      "Close control is above Ghost banner at " + width,
    );
    await page.screenshot({
      path: `.local/order-panel-ui/after-${width}.png`,
      fullPage: true,
    });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    check(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
      "Keyboard focus stays in modal at " + width,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    check(
      await page.evaluate(() => document.body.style.overflow !== "hidden"),
      "Escape restores page scrolling at " + width,
    );
    const card = page.locator(".kanban-card").first();
    await card.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(card).toBeFocused();
    check(true, "Closing restores focus to Kanban card at " + width);
    await card.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
    check(true, "Backdrop dismisses details at " + width);
  }
  for (const area of ["orders", "calendar"]) {
    await page.goto(`${base}/workspace/${order.store_id}/${area}`);
    if (area === "calendar") {
      await page
        .getByLabel("Tháng", { exact: true })
        .fill(order.delivery_date.slice(0, 7));
      await page
        .getByRole("button", { name: "Lịch trình", exact: true })
        .click();
      await page.locator(".calendar-agenda .kanban-card").first().click();
    } else {
      await page.locator("tbody .text-button").first().click();
    }
    const dialog = page.locator("dialog.order-panel");
    await expect(dialog).toBeVisible();
    check(
      await dialog.evaluate((e) => e.matches(":modal")),
      "Shared order details open as modal from " + area,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  check(errors.length === 0, "No browser errors: " + errors.join("; "));
  const exit = await context.request.post(base + "/api/auth/ghost/stop", {
    headers: { origin: base },
    data: {},
  });
  assert(exit.ok());
  console.log(`Order panel UI: ${passed} checks passed`);
} finally {
  await browser.close();
}
