import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import mysql from "mysql2/promise";
import { chromium, webkit, expect } from "@playwright/test";
import { nativeSelect, chooseSelect } from "./ui-controls.mjs";

// Real browser + API + SQL, limited to a dedicated local QA app and database.
const origin = process.env.TEST_ORIGIN || "http://localhost:3005";
assert(["http://localhost:3005", "http://127.0.0.1:3005"].includes(origin));
const db = await mysql.createConnection({ host: "127.0.0.1", port: 3310, user: "root", database: "fleur_saas_test", decimalNumbers: true });
const key = randomBytes(6).toString("hex"), password = randomBytes(24).toString("base64url"), salt = randomBytes(16).toString("hex");
let uid, sid, checks = 0;
const one = async (sql, values = []) => (await db.execute(sql, values))[0][0];
const check = (value, label) => { assert(value, label); checks++; console.log("PASS", label); };
await mkdir(".local/payment-corrections-e2e", { recursive: true });
try {
  const [user] = await db.execute("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)", ["Payment correction QA", `payment-correction-${key}@example.test`, salt + ":" + scryptSync(password, salt, 64).toString("hex")]);
  uid = user.insertId;
  const settings = { open: true, shipping: 0, free_shipping: 0, slots: ["09:00–12:00"], advance_days: 30, lead_minutes: 0, closed_dates: [], capacity: 100 };
  const [store] = await db.execute("INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,?,?,'approved',?,'{}')", [`payment-correction-${key}`, "Payment correction QA", uid, JSON.stringify(settings)]);
  sid = store.insertId;
  await db.execute("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')", [sid, uid]);
  const plan = await one("SELECT id FROM plans WHERE name='Studio'");
  assert(plan, "Studio QA plan must exist");
  await db.execute("INSERT INTO subscriptions(store_id,plan_id,status,billing_policy,access_started_at,access_ends_at) VALUES(?,?,'active',1,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))", [sid, plan.id]);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() + 86400000));
  for (const [engine, width] of [[chromium, 1440], [webkit, 390]]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block", ...(engine === webkit ? { isMobile: true, hasTouch: true } : {}) });
      const login = await context.request.post(origin + "/api/auth/login", { headers: { origin, "x-fleur-store": String(sid) }, data: { email: `payment-correction-${key}@example.test`, password } });
      assert(login.ok(), "QA owner login");
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      // No application API is mocked; the order is created through the form.
      await page.goto(`${origin}/workspace/${sid}/orders/new`);
      await expect(page.getByLabel("Tên người đặt", { exact: true })).toBeVisible({ timeout: 15000 });
      await page.getByLabel("Tên người đặt", { exact: true }).fill("Khách kiểm thử " + engine.name());
      await page.getByLabel("Số điện thoại người đặt", { exact: true }).fill("09" + String(Date.now()).slice(-8));
      await page.getByRole("button", { name: "Thêm thiết kế riêng", exact: false }).click();
      await page.getByLabel("Tên thiết kế riêng", { exact: true }).fill("Bó hoa kiểm thử điều chỉnh");
      await page.getByLabel("Đơn giá (VNĐ)", { exact: true }).fill("1320000");
      await page.getByLabel("Giao cho khách", { exact: true }).check();
      await page.getByLabel("Ngày giao hoa", { exact: true }).fill(tomorrow);
      await page.getByLabel("Địa chỉ giao hoa", { exact: true }).fill("1002 Đường Láng, Hà Nội");
      await chooseSelect(nativeSelect(page, "Trạng thái thanh toán"), "paid");
      await expect(page.getByLabel("Số tiền thực tế đã nhận (VNĐ)", { exact: true })).toHaveValue("1320000");
      await chooseSelect(nativeSelect(page, "Phương thức đã nhận"), "bank");
      await chooseSelect(nativeSelect(page, "Trạng thái ban đầu"), "confirmed");
      await page.getByRole("button", { name: "Tính giá & rà soát", exact: true }).click();
      const create = page.getByRole("button", { name: "Tạo và xác nhận", exact: true });
      await expect(create).toBeEnabled();
      await page.waitForLoadState("networkidle");
      const createdResponse = page.waitForResponse(r => r.url().endsWith("/api/workspace/manual-orders") && r.request().method() === "POST");
      await create.click();
      const created = await createdResponse, data = await created.json();
      assert(created.ok(), JSON.stringify(data));
      const id = data.id;
      // Wait for the application's own redirect before navigating again;
      // cancelling its RSC request produces a WebKit access-control error.
      await page.waitForURL(new RegExp(`/workspace/${sid}/board\\?order=${id}`));
      await page.waitForLoadState("networkidle");
      const original = await one("SELECT * FROM orders WHERE id=? AND store_id=?", [id, sid]);
      check(original.status === "confirmed" && original.payment_status === "paid" && original.total === 1320000, `${engine.name()}: real manual form creates confirmed, fully bank-paid order`);
      // Close and reopen from the order list to reproduce the reported workflow.
      await page.goto(`${origin}/workspace/${sid}/orders?order=${id}`);
      const dialog = page.locator("dialog.order-panel"), editor = dialog.locator(".order-payment-editor");
      await expect(editor).toBeVisible({ timeout: 15000 });
      await page.waitForLoadState("networkidle");
      const save = editor.getByRole("button", { name: "Lưu thanh toán", exact: true });
      await expect(save).toBeDisabled();
      await chooseSelect(nativeSelect(editor, "Trạng thái thanh toán"), "unpaid");
      await expect(editor.getByLabel("Số tiền thực tế đã nhận (VNĐ)", { exact: true })).toHaveValue("0");
      await expect(editor.getByLabel("Lý do điều chỉnh", { exact: true })).toHaveValue("");
      await expect(editor.getByRole("checkbox")).toHaveCount(0);
      await expect(save).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Lưu phương thức", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("combobox", { name: "Phương thức thanh toán", exact: true })).toHaveCount(0);
      await expect(dialog.locator(".order-price-list")).toContainText("Chuyển khoản ngân hàng");
      await page.screenshot({ path: `.local/payment-corrections-e2e/${engine.name()}-before-save.png` });
      const savedResponse = page.waitForResponse(r => r.url().endsWith(`/orders/${id}/payment-status`) && r.request().method() === "PATCH");
      await save.click();
      const saved = await savedResponse;
      assert(saved.ok(), await saved.text());
      await expect(dialog.locator(".order-overview")).toContainText("Chưa thanh toán");
      await expect(save).toBeDisabled();
      const row = await one("SELECT payment_status,status,payment_method FROM orders WHERE id=? AND store_id=?", [id, sid]);
      const ledger = await one("SELECT SUM(IF(kind IN ('collect','correction'),amount,-amount)) balance,SUM(kind='refund') refunds,SUM(kind='correction') corrections FROM order_payments WHERE store_id=? AND order_id=?", [sid, id]);
      const audit = await one("SELECT detail FROM audit_logs WHERE store_id=? AND entity_id=? AND action='payment_balance' ORDER BY id DESC LIMIT 1", [sid, String(id)]);
      const detail = typeof audit.detail === "string" ? JSON.parse(audit.detail) : audit.detail;
      check(row.status === "confirmed" && row.payment_status === "unpaid" && Number(ledger.balance) === 0 && Number(ledger.refunds) === 0 && Number(ledger.corrections) === 1, `${engine.name()}: saving without reason persists unpaid with one correction and no refund`);
      check(row.payment_method === original.payment_method && detail.paymentMethod === undefined && detail.updateBalance === true, `${engine.name()}: correcting the balance preserves the original payment method`);
      check(detail.reason === "Điều chỉnh trạng thái thanh toán ghi nhầm", `${engine.name()}: real API auto-fills audit reason`);
      await page.waitForLoadState("networkidle");
      await page.reload();
      await expect(dialog.locator(".order-overview")).toContainText("Chưa thanh toán");
      await expect(nativeSelect(editor, "Trạng thái thanh toán")).toHaveValue("unpaid");
      await expect(save).toBeDisabled();
      await expect(dialog.getByRole("combobox", { name: "Phương thức thanh toán", exact: true })).toHaveCount(0);
      await expect(dialog.locator(".order-price-list")).toContainText("Chuyển khoản ngân hàng");
      const receiptsAfter = await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=? AND store_id=?", [id, sid]);
      check(Number(receiptsAfter.n) === 2, `${engine.name()}: reloading retains read-only method and creates no extra money movements`);
      const list = await context.request.get(`${origin}/api/workspace/order-list?mode=table&payment=unpaid`, { headers: { "x-fleur-store": String(sid) } });
      check((await list.json()).items.some(o => o.id === id && o.payment_status === "unpaid" && Number(o.collected) === 0), `${engine.name()}: reload and unpaid list filter retain corrected state`);
      await expect(dialog).toHaveJSProperty("open", true);
      check(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${engine.name()}: real detail layout fits ${width}px`);
      check(errors.length === 0, `${engine.name()}: no runtime errors: ${errors.join("; ")}`);
    } finally { await browser.close(); }
  }
  console.log(`${checks} real manual order correction E2E checks passed; no production data or real mail`);
} finally {
  if (sid) {
    // All deletions target the fixture store created above in fleur_saas_test.
    for (const table of ["workspace_activity", "order_status_events", "order_payments", "order_items", "payment_intents", "order_drafts", "orders", "customers", "notifications", "domain_outbox", "email_outbox", "audit_logs", "subscriptions", "store_memberships"]) await db.execute(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
    await db.execute("DELETE FROM stores WHERE id=?", [sid]);
  }
  if (uid) {
    for (const table of ["account_activity", "sessions"]) await db.execute(`DELETE FROM ${table} WHERE user_id=?`, [uid]);
    await db.execute("DELETE FROM users WHERE id=?", [uid]);
  }
  await db.end();
}
