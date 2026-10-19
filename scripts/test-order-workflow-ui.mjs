import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { readFileSync, mkdirSync } from "node:fs";
if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use isolated QA DB on port 3310");
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
const { sid, id, date, slot } = JSON.parse(
  readFileSync(".local/order-workflow-fixture.json", "utf8"),
);
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
  decimalNumbers: true,
});
await db.execute("DELETE FROM login_attempts");
const browser = await chromium.launch();
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
  console.log("PASS", label);
};
const one = async (sql, args = []) => (await db.execute(sql, args))[0][0];
const read = () => one("SELECT * FROM orders WHERE id=?", [id]);
mkdirSync(".local/order-workflow-ui", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { origin: base, "x-fleur-store": String(sid) },
    data: { email: "owner@example.test", password: "SaaS-Testing-2026-Only" },
  });
  assert(login.ok());
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  const open = async () => {
    await page.goto(`${base}/workspace/${sid}/board?order=${id}`);
    await expect(
      page.locator("dialog.order-panel:not(.order-transition)"),
    ).toBeVisible();
  };
  const details = page.locator("dialog.order-panel:not(.order-transition)"),
    confirmation = page.getByRole("dialog", {
      name: "Xác nhận chuyển trạng thái",
      exact: true,
    });
  for (const [width, height] of [
    [1440, 1100],
    [768, 1024],
    [390, 844],
    [360, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await open();
    for (const title of [
      "Giao hoa",
      "Khách đặt hoa",
      "Giá & thanh toán",
      "Lời nhắn trên thiệp",
    ])
      await expect(
        details.getByRole("heading", { name: title, exact: true }),
      ).toBeAttached();
    check(
      await details.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "Clear order sections fit width " + width,
    );
    await expect(details.locator(".order-overview .order-total")).toHaveText(
      /VNĐ/,
    );
    await expect(details.locator(".order-price-list")).toContainText(
      "Phí giao hoa",
    );
    await expect(details.locator(".order-products")).toContainText("SL: 2");
    check(true, "Summary and quantity/price breakdown shown at " + width);
    await page.screenshot({
      path: `.local/order-workflow-ui/details-${width}.png`,
      fullPage: false,
    });
    await page.keyboard.press("Escape");
    check(
      await page.evaluate(() => document.body.style.overflow !== "hidden"),
      "Closing details restores scroll at " + width,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open();
  const before = await read();
  const paymentSelect = nativeSelect(details, "Phương thức thanh toán");
  const method = before.payment_method === "bank" ? "cod" : "bank";
  await chooseSelect(paymentSelect, method);
  await details
    .getByRole("button", { name: "Lưu phương thức", exact: true })
    .click();
  await expect(details).toHaveCount(0);
  const after = await read();
  check(
    after.payment_method === method &&
      after.payment_status === before.payment_status,
    "Payment method can be edited in order details",
  );
  await open();
  await expect(paymentSelect).toHaveValue(method);
  await details
    .locator(".order-secondary")
    .filter({ has: page.locator("summary", { hasText: "Lịch sử đơn" }) })
    .locator("summary")
    .click();
  await expect(details.locator(".order-history")).toContainText(
    "Đã đổi phương thức thanh toán",
  );
  check(true, "Saved payment method and history survive reopening");
  await chooseSelect(nativeSelect(details, "Trạng thái mới"), "shipping");
  await details
    .getByRole("button", { name: "Cập nhật trạng thái", exact: true })
    .click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("heading")).toHaveText(
    "Khôi phục đơn hàng",
  );
  await confirmation
    .getByRole("button", { name: "Quay lại", exact: true })
    .click();
  check(
    (await read()).status === "cancelled" && (await details.isVisible()),
    "Cancelling confirmation leaves order unchanged and details open",
  );
  await details
    .getByRole("button", { name: "Cập nhật trạng thái", exact: true })
    .click();
  await confirmation
    .getByLabel("Lý do chuyển trạng thái")
    .fill("Khách yêu cầu giao hoa trở lại");
  await confirmation.getByLabel("Ngày giao khi khôi phục").fill(date);
  await chooseSelect(
    nativeSelect(confirmation, "Khung giờ khi khôi phục"),
    slot,
  );
  await confirmation
    .getByRole("button", { name: "Xác nhận chuyển trạng thái", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(details).toHaveCount(0);
  check(
    (await read()).status === "shipping",
    "Cancelled order restores directly to selected advanced stage",
  );
  check(
    await page.evaluate(() => document.body.style.overflow !== "hidden"),
    "Closing nested confirmation restores page scroll",
  );
  // Exercise actual drag/drop, including skipping several columns.
  const reset = await context.request.patch(
    `${base}/api/workspace/orders/${id}/status`,
    {
      headers: { origin: base, "x-fleur-store": String(sid) },
      data: {
        status: "pending",
        version: (await read()).version,
        reason: "Kiểm thử kéo thả vượt cấp",
      },
    },
  );
  assert(reset.ok(), await reset.text());
  const ref = (await read()).reference;
  await page.setViewportSize({ width: 2560, height: 1100 });
  await page.goto(`${base}/workspace/${sid}/board`);
  await page.getByLabel("Tìm đơn hàng", { exact: true }).fill(ref);
  const card = page.locator(".kanban-card").filter({ hasText: ref });
  const delivered = page
    .locator(".kanban-column")
    .filter({ has: page.getByRole("heading", { name: /^Đã giao / }) });
  await card.dragTo(delivered, { targetPosition: { x: 100, y: 100 } });
  await expect.poll(async () => (await read()).status).toBe("delivered");
  check(true, "Dragging from pending straight to delivered works");
  await open();
  await chooseSelect(nativeSelect(details, "Trạng thái mới"), "cancelled");
  await details
    .getByRole("button", { name: "Cập nhật trạng thái", exact: true })
    .click();
  await expect(confirmation.getByRole("heading")).toHaveText("Hủy đơn hàng");
  const version = (await read()).version;
  await confirmation
    .getByRole("button", { name: "Xác nhận chuyển trạng thái", exact: true })
    .click();
  check(
    (await read()).version === version,
    "Cancellation requires a reason before submission",
  );
  await confirmation
    .getByLabel("Lý do chuyển trạng thái")
    .fill("Khách hủy sau khi kiểm tra đơn");
  await confirmation
    .getByRole("button", { name: "Xác nhận chuyển trạng thái", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  check(
    (await read()).status === "cancelled",
    "Delivered order can be cancelled with confirmation and reason",
  );
  check(errors.length === 0, "No browser errors: " + errors.join("; "));
  console.log(`Order workflow UI: ${checks} checks passed`);
} finally {
  await browser.close();
  await db.end();
}
