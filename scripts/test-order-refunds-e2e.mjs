import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import mysql from "mysql2/promise";
import { chromium, webkit, expect } from "@playwright/test";
import { nativeSelect, chooseSelect } from "./ui-controls.mjs";

const origin = process.env.TEST_ORIGIN || "http://localhost:3005";
assert(
  ["http://localhost:3005", "http://127.0.0.1:3005"].includes(origin),
  "Dedicated local QA app only",
);
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
  decimalNumbers: true,
});
const key = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url"),
  salt = randomBytes(16).toString("hex");
const uids = [];
let sid,
  checks = 0,
  customerNumber = 0;
const one = async (sql, values = []) => (await db.execute(sql, values))[0][0];
const check = (ok, label) => {
  assert(ok, label);
  checks++;
  console.log("PASS", label);
};
const out = ".local/refunds-e2e";
await mkdir(out, { recursive: true });
try {
  for (const role of ["owner", "support"]) {
    const [user] = await db.execute(
      "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
      [
        "Refund " + role + " QA",
        `refund-${role}-${key}@example.test`,
        salt + ":" + scryptSync(password, salt, 64).toString("hex"),
      ],
    );
    uids.push(user.insertId);
  }
  const settings = {
    open: true,
    shipping: 0,
    free_shipping: 0,
    slots: ["09:00–12:00"],
    advance_days: 30,
    lead_minutes: 0,
    closed_dates: [],
    capacity: 100,
  };
  const [store] = await db.execute(
    "INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,?,?,'approved',?,'{}')",
    [`refund-${key}`, "Refund QA", uids[0], JSON.stringify(settings)],
  );
  sid = store.insertId;
  await db.execute(
    "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner'),(?,?,'support')",
    [sid, uids[0], sid, uids[1]],
  );
  const plan = await one("SELECT id FROM plans WHERE name='Studio'");
  assert(plan);
  await db.execute(
    "INSERT INTO subscriptions(store_id,plan_id,status,billing_policy,access_started_at,access_ends_at) VALUES(?,?,'active',1,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))",
    [sid, plan.id],
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const tomorrow = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(Date.now() + 86400000));
  for (const [engine, width] of [
    [chromium, 1440],
    [webkit, 390],
  ]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
        ...(engine === webkit ? { isMobile: true, hasTouch: true } : {}),
      });
      const login = await context.request.post(origin + "/api/auth/login", {
        headers: { origin, "x-fleur-store": String(sid) },
        data: { email: `refund-owner-${key}@example.test`, password },
      });
      assert(login.ok());
      const call = async (path, method = "GET", data, status = 200) => {
        const response = await context.request.fetch(origin + "/api/" + path, {
          method,
          headers: { origin, "x-fleur-store": String(sid) },
          ...(data === undefined ? {} : { data }),
        });
        const result = await response.json();
        assert.equal(response.status(), status, JSON.stringify(result));
        return result;
      };
      const create = async (name, received = 1000000) => {
        const input = {
          customerName: name,
          phone: "090000000" + ++customerNumber,
          email: "",
          deliveryMode: "self",
          address: "100 Đường Láng, Hà Nội",
          deliveryDate: tomorrow,
          deliverySlot: settings.slots[0],
          shipping: 0,
          initialStatus: "confirmed",
          collectAmount: received,
          collectMethod: "cash",
          items: [
            { type: "custom", name: "Bó hoa QA", quantity: 1, price: 1000000 },
          ],
        };
        const quote = await call(
          "workspace/manual-orders/quote",
          "POST",
          input,
        );
        return call("workspace/manual-orders", "POST", {
          ...input,
          quoteToken: quote.token,
          idempotencyKey: randomUUID(),
        });
      };
      const created = await create("Khách hoàn " + engine.name());
      const id = created.id,
        row = () =>
          one("SELECT * FROM orders WHERE store_id=? AND id=?", [sid, id]);
      const active = await row();
      await call(`workspace/orders/${id}/payment`, "POST", {
        kind: "refund", amount: 100000, method: "cash", reference: "QA-ACTIVE-" + id,
      }, 409);
      await call(`workspace/orders/${id}/payment-status`, "PATCH", {
        totalCollected: 900000, method: "cash", operation: "movement", paymentMethod: "bank",
        version: active.version, requestKey: randomUUID(),
      }, 409);
      const rejected = await row();
      check(rejected.version === active.version && rejected.payment_method === active.payment_method && rejected.payment_status === "paid", `${engine.name()}: legacy APIs reject refunds before cancellation and roll back any method change`);
      await call(`workspace/orders/${id}/status`, "PATCH", {
        status: "cancelled",
        version: rejected.version,
        reason: "Khách đổi kế hoạch, hoàn lại tiền",
      });
      const before = await call(
        `workspace/analytics?from=${today}&to=${today}`,
      );
      check(
        before.summary.refund_due === 1000000,
        `${engine.name()}: canceling a paid order updates refund liability in analytics`,
      );
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/workspace/${sid}/refunds`);
      const list = page.getByRole("region", {
        name: "Danh sách hoàn tiền",
        exact: true,
      });
      const item = list.getByRole("row").filter({ hasText: created.reference });
      await expect(item).toBeVisible({ timeout: 15000 });
      await page.waitForLoadState("networkidle");
      if (width > 700)
        await expect(
          page
            .getByRole("navigation", { name: "Điều hướng workspace" })
            .getByRole("link", { name: "Hoàn tiền", exact: true }),
        ).toHaveAttribute("aria-current", "page");
      check(
        (await call("workspace/refunds")).items.some(
          (o) => o.id === id && Number(o.outstanding) === 1000000,
        ),
        `${engine.name()}: real canceled order appears in the queue`,
      );
      await page
        .getByPlaceholder("Mã đơn, tên khách, số điện thoại")
        .fill(created.reference);
      await expect(list.getByRole("status")).toHaveText("1 đơn");
      await item
        .getByRole("button", { name: "Đánh dấu đã hoàn", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Ghi nhận đã hoàn tiền",
        exact: true,
      });
      const confirm = dialog.getByRole("button", {
        name: "Xác nhận đã hoàn",
        exact: true,
      });
      await expect(confirm).toBeDisabled();
      await dialog
        .getByLabel("Số tiền đã hoàn (VNĐ)", { exact: true })
        .fill("250000");
      await chooseSelect(nativeSelect(dialog, "Hình thức hoàn"), "cash");
      await dialog
        .getByLabel("Mã giao dịch hoàn (tùy chọn)", { exact: true })
        .fill("QA-RETURN-" + id);
      await dialog
        .getByLabel("Ghi chú (tùy chọn)", { exact: true })
        .fill("Đã trả một phần cho khách");
      await dialog.getByRole("checkbox").check();
      await expect(confirm).toBeEnabled();
      check(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        `${engine.name()}: refund form fits ${width}px`,
      );
      await page.screenshot({
        path: `${out}/${engine.name()}-confirmation.png`,
      });
      const responseWait = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/orders/${id}/refund`) &&
          r.request().method() === "POST",
      );
      await confirm.click();
      const response = await responseWait,
        sent = response.request().postDataJSON();
      assert(response.ok(), await response.text());
      await expect(dialog).toHaveCount(0);
      await expect(item).toContainText("Hoàn một phần");
      check(
        (await row()).payment_status === "partially_refunded" &&
          Number(
            (await call("workspace/refunds")).items.find((o) => o.id === id)
              .outstanding,
          ) === 750000,
        `${engine.name()}: partial refund persists ledger balance and payment status`,
      );
      check(
        (await call(`workspace/orders/${id}/refund`, "POST", sent)).duplicate,
        `${engine.name()}: API retry is idempotent`,
      );
      await call(
        `workspace/orders/${id}/refund`,
        "POST",
        { ...sent, requestKey: randomUUID() },
        409,
      );
      await call(
        `workspace/orders/${id}/refund`,
        "POST",
        { ...sent, requestKey: randomUUID(), version: (await row()).version },
        409,
      );
      check(
        (
          await one(
            "SELECT COUNT(*) n FROM order_payments WHERE store_id=? AND order_id=? AND kind='refund'",
            [sid, id],
          )
        ).n === 1,
        `${engine.name()}: stale and duplicate-transfer submissions create no second refund`,
      );
      await item
        .getByRole("button", { name: "Đánh dấu đã hoàn", exact: true })
        .click();
      await expect(
        dialog.getByLabel("Số tiền đã hoàn (VNĐ)", { exact: true }),
      ).toHaveValue("750000");
      await dialog.getByRole("checkbox").check();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(item).toHaveCount(0);
      await chooseSelect(
        nativeSelect(list, "Trạng thái hoàn tiền"),
        "completed",
      );
      await expect(item).toContainText("Đã hoàn đủ");
      await expect(
        item.getByRole("button", { name: "Đánh dấu đã hoàn", exact: true }),
      ).toHaveCount(0);
      const record = await row(),
        after = await call(`workspace/analytics?from=${today}&to=${today}`);
      check(
        record.status === "cancelled" &&
          record.payment_status === "refunded" &&
          after.summary.refund_due === 0 &&
          after.summary.collected === 0,
        `${engine.name()}: full refund updates completed queue and analytics without restoring the order`,
      );
      for (const size of [width, 768, 320]) {
        await page.setViewportSize({ width: size, height: 900 });
        // WebKit applies responsive layout asynchronously after viewport resize.
        await expect.poll(
          () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
          { message: `${engine.name()}: responsive layout settles at ${size}px` },
        ).toBeLessThanOrEqual(1);
        check(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${engine.name()}: no page overflow at ${size}px`,
        );
      }
      await page.screenshot({
        path: `${out}/${engine.name()}-completed-mobile.png`,
      });
      // Background identity refresh keeps filters and content mounted.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(nativeSelect(list, "Trạng thái hoàn tiền")).toHaveValue(
        "completed",
      );
      await expect(item).toBeVisible();
      await page.waitForLoadState("networkidle");
      await item.getByRole("link", { name: "Xem đơn", exact: true }).click();
      const details = page.locator("dialog.order-panel");
      await expect(details).toBeVisible({ timeout: 15000 });
      await expect(details.locator(".order-overview")).toContainText(
        "Đã hoàn tiền",
      );
      await expect(details.getByRole("combobox", { name: "Mục đích cập nhật", exact: true })).toHaveCount(0);
      await expect(details.getByText("Ghi nhận thu / hoàn tiền thực tế", { exact: true })).toHaveCount(0);
      await expect(details).toContainText("Đã ghi nhận hoàn tiền");
      check(
        true,
        `${engine.name()}: detail, timeline and shared payment status remain synchronized`,
      );
      check(
        !errors.length,
        `${engine.name()}: no browser runtime errors: ${errors.join("; ")}`,
      );
      // Another staff member can follow up, but cannot assert a money movement.
      const staffContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: "block",
      });
      const staffLogin = await staffContext.request.post(
        origin + "/api/auth/login",
        {
          headers: { origin, "x-fleur-store": String(sid) },
          data: { email: `refund-support-${key}@example.test`, password },
        },
      );
      assert(staffLogin.ok());
      const another = await create(
        "Khách cần hoàn quyền " + engine.name(),
        200000,
      );
      const anotherRow = await one(
        "SELECT version FROM orders WHERE id=? AND store_id=?",
        [another.id, sid],
      );
      await call(`workspace/orders/${another.id}/status`, "PATCH", {
        status: "cancelled",
        version: anotherRow.version,
        reason: "Kiểm thử quyền ghi nhận hoàn",
      });
      const staffPage = await staffContext.newPage();
      await staffPage.goto(`${origin}/workspace/${sid}/refunds`);
      await expect(
        staffPage.getByRole("row").filter({ hasText: another.reference }),
      ).toBeVisible();
      await expect(
        staffPage.getByRole("button", {
          name: "Đánh dấu đã hoàn",
          exact: true,
        }),
      ).toHaveCount(0);
      const forbidden = await staffContext.request.post(
        `${origin}/api/workspace/orders/${another.id}/refund`,
        {
          headers: { origin, "x-fleur-store": String(sid) },
          data: { ...sent, requestKey: randomUUID() },
        },
      );
      check(
        forbidden.status() === 403,
        `${engine.name()}: support can view refunds but UI and server deny mutation`,
      );
      await db.execute(
        "UPDATE store_memberships SET role='editor' WHERE store_id=? AND user_id=?",
        [sid, uids[1]],
      );
      const forbiddenRead = await staffContext.request.get(
        `${origin}/api/workspace/refunds`,
        { headers: { "x-fleur-store": String(sid) } },
      );
      check(
        forbiddenRead.status() === 403,
        `${engine.name()}: role without order access cannot read refund data`,
      );
      await db.execute(
        "UPDATE store_memberships SET role='support' WHERE store_id=? AND user_id=?",
        [sid, uids[1]],
      );
      // Complete the extra fixture so the next engine starts with zero liability.
      await call(`workspace/orders/${another.id}/refund`, "POST", {
        amount: 200000,
        version: (
          await one("SELECT version FROM orders WHERE id=?", [another.id])
        ).version,
        method: "cash",
        requestKey: randomUUID(),
        confirmed: true,
      });
      await staffContext.close();
      await context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    `${checks} real refund browser/API/SQL checks passed; no production data or real mail`,
  );
} finally {
  if (sid) {
    for (const table of [
      "workspace_activity",
      "order_status_events",
      "order_payments",
      "order_items",
      "payment_intents",
      "order_drafts",
      "orders",
      "customers",
      "notifications",
      "domain_outbox",
      "email_outbox",
      "audit_logs",
      "subscriptions",
      "store_memberships",
    ])
      await db.execute(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
    await db.execute("DELETE FROM stores WHERE id=?", [sid]);
  }
  for (const uid of uids) {
    for (const table of ["account_activity", "sessions"])
      await db.execute(`DELETE FROM ${table} WHERE user_id=?`, [uid]);
    await db.execute("DELETE FROM users WHERE id=?", [uid]);
  }
  await db.end();
}
