import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import mysql from "mysql2/promise";
import { chromium, webkit, expect } from "@playwright/test";
import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
import defaults from "../lib/email-defaults.json" with { type: "json" };

const origin = process.env.TEST_ORIGIN || "http://localhost:3005";
assert(
  ["http://localhost:3005", "http://127.0.0.1:3005"].includes(origin),
  "Isolated QA app only",
);
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
  decimalNumbers: true,
  dateStrings: true,
});
const one = async (sql, values = []) => (await db.execute(sql, values))[0][0];
const key = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url"),
  salt = randomBytes(16).toString("hex");
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
}).format(new Date());
const users = [],
  stores = [];
let checks = 0,
  serial = 0;
function check(v, label) {
  assert(v, label);
  checks++;
  console.log("PASS", label);
}
await mkdir(".local/pickup-e2e", { recursive: true });
try {
  for (const role of ["owner", "support"]) {
    const [r] = await db.execute(
      "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
      [
        "Pickup QA " + role,
        `pickup-${role}-${key}@example.test`,
        salt + ":" + scryptSync(password, salt, 64).toString("hex"),
      ],
    );
    users.push(r.insertId);
  }
  for (const name of ["Pickup QA", "Other pickup QA"]) {
    const [r] = await db.execute(
      "INSERT INTO stores(slug,name,owner_id,status,address,lat,lng,radius_km,settings,theme) VALUES(?,?,?,'approved','10 Phố Hoa, Hà Nội',21.0278,105.8342,1,?,'{}')",
      [
        key + stores.length,
        name,
        users[0],
        JSON.stringify({
          open: true,
          shipping: 50000,
          free_shipping: 0,
          slots: [],
          advance_days: 0,
          lead_minutes: 9999,
          closed_dates: [today],
          capacity: 1,
        }),
      ],
    );
    stores.push(r.insertId);
  }
  const [sid, otherSid] = stores;
  await db.execute(
    "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner'),(?,?,'support')",
    [sid, users[0], sid, users[1]],
  );
  const plan = await one("SELECT id FROM plans WHERE name='Studio'");
  assert(plan);
  await db.execute(
    "INSERT INTO subscriptions(store_id,plan_id,status,billing_policy,access_started_at,access_ends_at) VALUES(?,?,'active',1,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))",
    [sid, plan.id],
  );
  for (const t of defaults.filter((t) => t.key.startsWith("order_")))
    await db.execute(
      "INSERT INTO email_templates(store_id,template_key,name,kind,subject,body,active) VALUES(?,?,?,?,?,?,1)",
      [sid, t.key, t.name, t.kind, t.subject, t.body],
    );
  const [cat] = await db.execute(
    "INSERT INTO categories(store_id,name,slug) VALUES(?,'Hoa tại quầy',?)",
    [sid, key],
  );
  const [product] = await db.execute(
    "INSERT INTO products(store_id,category_id,name,slug,price,stock,image,description,flowers,care) VALUES(?,?,'Hoa pickup QA',?,1000000,100,'/images/roses.jpg','Hoa QA','Hồng','Nước')",
    [sid, cat.insertId, key],
  );
  const pid = product.insertId;
  await db.execute(
    "INSERT INTO store_bank_accounts(store_id,bank_code,bank_name,account_number,account_holder,enabled) VALUES(?,'TPB','QA','0000000','QA',1)",
    [sid],
  );
  check(
    (
      await one(
        "SELECT COUNT(*) n FROM orders WHERE fulfillment_method IS NULL",
      )
    ).n === 0,
    "Migration backfills existing orders with delivery and is repeatable",
  );
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
      const support = await browser.newContext();
      for (const [ctx, role] of [
        [context, "owner"],
        [support, "support"],
      ]) {
        const r = await ctx.request.post(origin + "/api/auth/login", {
          headers: { origin, "x-fleur-store": String(sid) },
          data: { email: `pickup-${role}-${key}@example.test`, password },
        });
        assert(r.ok(), await r.text());
      }
      const call = async (
        path,
        method = "GET",
        data,
        status = 200,
        ctx = context,
        scope = sid,
      ) => {
        const r = await ctx.request.fetch(origin + "/api/" + path, {
          method,
          headers: { origin, "x-fleur-store": String(scope) },
          ...(data === undefined ? {} : { data }),
        });
        const b = await r.json();
        assert.equal(r.status(), status, JSON.stringify(b));
        return b;
      };
      const base = (extra = {}) => ({
        fulfillmentMethod: "pickup",
        pickupConfirmed: true,
        customerName: "Khách tại quầy " + ++serial,
        phone: "090" + String(serial).padStart(7, "0"),
        salesChannel: "in_person",
        collectMethod: "cash",
        collectAmount: 1000000,
        shipping: 90000,
        items: [{ type: "catalog", productId: pid, quantity: 1, size: "S" }],
        ...extra,
      });
      const request = async (input, ctx = context) => ({
        ...input,
        quoteToken: (
          await call("workspace/manual-orders/quote", "POST", input, 200, ctx)
        ).token,
        idempotencyKey: randomUUID(),
      });
      const create = async (extra = {}) =>
        call("workspace/manual-orders", "POST", await request(base(extra)));
      const load = (id) => call("workspace/manual-orders/" + id);
      const count = () =>
        one("SELECT COUNT(*) n FROM orders WHERE store_id=?", [sid]);
      const balance = (id) =>
        one(
          "SELECT COUNT(*) n,COALESCE(SUM(IF(kind IN ('collect','correction'),amount,-amount)),0) balance FROM order_payments WHERE order_id=? AND store_id=?",
          [id, sid],
        );
      const stockBefore = (
        await one("SELECT stock FROM products WHERE id=?", [pid])
      ).stock;
      const before = (await count()).n;
      await call(
        "workspace/manual-orders",
        "POST",
        await request(base({ pickupConfirmed: false })),
        400,
      );
      await call(
        "workspace/manual-orders",
        "POST",
        await request(
          base({
            walkInGuest: true,
            customerName: "",
            phone: "",
            collectAmount: 0,
          }),
        ),
        400,
      );
      await call(
        "workspace/manual-orders",
        "POST",
        await request(base({ collectAmount: 0 })),
        400,
      );
      await call(
        "workspace/manual-orders",
        "POST",
        await request(base({ collectAmount: 0, pickupDebtReason: "ghi" })),
        400,
      );
      await call(
        "workspace/manual-orders",
        "POST",
        await request(
          base({
            collectAmount: 0,
            pickupDebtReason: "Khách ghi nợ",
            initialStatus: "pending",
          }),
          support,
        ),
        403,
        support,
      );
      check(
        (await count()).n === before &&
          (await one("SELECT stock FROM products WHERE id=?", [pid])).stock ===
            stockBefore,
        engine.name() +
          ": missing handoff, anonymous debt and unauthorized pickup roll back without stock or order writes",
      );

      const guestInput = base({
        walkInGuest: true,
        customerName: "",
        phone: "",
        email: "",
      });
      const guestReq = await request(guestInput),
        customersBefore = (
          await one("SELECT COUNT(*) n FROM customers WHERE store_id=?", [sid])
        ).n;
      const [a, b] = await Promise.all([
        call("workspace/manual-orders", "POST", guestReq),
        call("workspace/manual-orders", "POST", guestReq),
      ]);
      let guest = await load(a.id);
      check(
        a.id === b.id &&
          (await count()).n === before + 1 &&
          (await balance(a.id)).n === 1,
        engine.name() +
          ": concurrent retries create exactly one completed order and one receipt",
      );
      check(
        guest.status === "delivered" &&
          guest.payment_status === "paid" &&
          guest.picked_up_at &&
          guest.completed_at &&
          !guest.shipped_at &&
          guest.confirmed_at,
        engine.name() +
          ": immediate handoff completes order with pickup timestamp and no shipping timestamp",
      );
      check(
        guest.fulfillment_method === "pickup" &&
          guest.total === 1000000 &&
          guest.shipping === 0 &&
          guest.delivery_date === today &&
          guest.delivery_slot === "Nhận ngay" &&
          guest.delivery_lat === null,
        engine.name() +
          ": server ignores injected shipping and bypasses unavailable slots, lead time, closure and radius for pickup",
      );
      check(
        !guest.customer_id &&
          guest.customer_name === "Khách lẻ" &&
          !guest.phone &&
          !guest.email &&
          (
            await one("SELECT COUNT(*) n FROM customers WHERE store_id=?", [
              sid,
            ])
          ).n === customersBefore,
        engine.name() +
          ": anonymous paid guest creates no fake contact or CRM record",
      );
      check(
        (await one("SELECT stock FROM products WHERE id=?", [pid])).stock ===
          stockBefore - 1,
        engine.name() + ": pickup consumes stock once",
      );
      await call(
        "workspace/manual-orders",
        "POST",
        { ...guestReq, message: "Changed" },
        409,
      );
      check(
        (
          await one(
            "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND order_id=?",
            [sid, guest.id],
          )
        ).n === 0,
        engine.name() +
          ": anonymous guest queues no email and changed idempotency payload is rejected",
      );

      const knownInput = base({
        email: `pickup-customer-${engine.name()}-${key}@example.test`,
        collectAmount: 250000,
        pickupDebtReason: "Khách quen thanh toán phần còn lại sau",
      });
      const knownCreated = await call(
        "workspace/manual-orders",
        "POST",
        await request(knownInput),
      );
      let known = await load(knownCreated.id);
      check(
        known.status === "delivered" &&
          known.payment_status === "partially_paid" &&
          known.collected === 250000 &&
          known.customer_id,
        engine.name() +
          ": owner can hand over partial-paid order with contact and recorded debt reason",
      );
      let email = await one(
        "SELECT template_key,body,status FROM email_outbox WHERE store_id=? AND order_id=?",
        [sid, known.id],
      );
      check(
        email.template_key === "order_pickup_confirmation" &&
          email.body.includes("Đã nhận tại cửa hàng") &&
          email.body.includes("750.000 VNĐ") &&
          !email.body.includes("COD") &&
          !email.body.includes("Lịch giao:"),
        engine.name() +
          ": pickup email uses correct template, counter balance and handoff wording",
      );
      await db.execute("UPDATE stores SET address='Địa chỉ mới' WHERE id=?", [
        sid,
      ]);
      const snapshot =
        typeof known.pickup_location_snapshot === "string"
          ? JSON.parse(known.pickup_location_snapshot)
          : known.pickup_location_snapshot;
      check(
        snapshot.address === "10 Phố Hoa, Hà Nội",
        engine.name() +
          ": order retains the store location snapshot after settings change",
      );
      await db.execute(
        "UPDATE stores SET address='10 Phố Hoa, Hà Nội' WHERE id=?",
        [sid],
      );

      const stats = await call(`workspace/analytics?from=${today}&to=${today}`);
      check(
        Number(stats.cod.outstanding) === 0 &&
          stats.deliveries.length === 0 &&
          stats.pickup.outstanding >= 750000 &&
          stats.summary.revenue >= 2000000,
        engine.name() +
          ": pickup revenue and debt are tracked without inflating delivery workload or COD",
      );
      const filtered = await call(
        "workspace/order-list?mode=table&fulfillment=pickup",
      );
      check(
        filtered.items.some((o) => o.id === known.id) &&
          filtered.items.every((o) => o.fulfillment_method === "pickup"),
        engine.name() + ": pickup filter returns only counter orders",
      );
      const codList = await call(
        "workspace/order-list?mode=table&method=cod_due",
      );
      check(
        !codList.items.some((o) => o.id === known.id) &&
          Number(codList.codStats.outstanding) === 0,
        engine.name() +
          ": outstanding COD filter and monitor exclude counter debt",
      );
      const tracked = await call("orders/track", "POST", {
        reference: known.reference,
        email: knownInput.email,
      });
      check(
        tracked.fulfillment_method === "pickup" && tracked.picked_up_at,
        engine.name() + ": public tracking exposes actual pickup state",
      );

      const receipt = {
        amount: 750000,
        version: known.version,
        requestKey: randomUUID(),
        method: "bank",
        confirmed: true,
        reference: "PICKUP-QA-" + randomUUID(),
      };
      await call(
        `workspace/orders/${known.id}/cod`,
        "POST",
        { ...receipt, amount: 750001 },
        409,
      );
      await call(
        `workspace/orders/${known.id}/cod`,
        "POST",
        receipt,
        403,
        support,
      );
      await call(`workspace/orders/${known.id}/cod`, "POST", receipt);
      check(
        (await call(`workspace/orders/${known.id}/cod`, "POST", receipt))
          .duplicate,
        engine.name() +
          ": counter collection enforces owner, balance limit and idempotent receipt",
      );
      known = await load(known.id);
      check(
        known.payment_status === "paid" &&
          known.collected === 1000000 &&
          (await balance(known.id)).n === 2,
        engine.name() +
          ": subsequent counter collection synchronizes ledger and payment state",
      );
      await call(
        `workspace/orders/${guest.id}/status`,
        "PATCH",
        { status: "shipping", version: guest.version },
        400,
      );
      await call(
        `workspace/orders/${guest.id}/reschedule`,
        "PATCH",
        {
          date: today,
          slot: "Nhận ngay",
          version: guest.version,
          reason: "Không có lịch hẹn",
        },
        409,
      );
      check(
        (await load(guest.id)).status === "delivered",
        engine.name() +
          ": immediate pickup cannot enter shipping or a delivery appointment",
      );

      const bankCreated = await create({
        collectAmount: 0,
        collectMethod: "bank",
        pickupDebtReason: "Khách thanh toán ngân hàng sau khi nhận",
      });
      let bank = await load(bankCreated.id);
      check(
        bankCreated.payment && bank.payment_method === "bank",
        engine.name() + ": known customer bank debt retains payment intent",
      );
      await call(`workspace/orders/${bank.id}/cod`, "POST", {
        amount: 1000000,
        version: bank.version,
        requestKey: randomUUID(),
        method: "cash",
        confirmed: true,
      });
      bank = await load(bank.id);
      check(
        bank.payment_method === "bank" &&
          bank.payment_status === "paid" &&
          (
            await one(
              "SELECT COUNT(*) n FROM payment_intents WHERE store_id=? AND order_id=? AND status='pending'",
              [sid, bank.id],
            )
          ).n === 0,
        engine.name() +
          ": cash receipt for bank pickup pays once and cancels stale pending QR",
      );

      guest = await load(guest.id);
      await call(`workspace/orders/${guest.id}/status`, "PATCH", {
        status: "cancelled",
        version: guest.version,
        reason: "Khách trả lại bó hoa ngay tại quầy",
      });
      guest = await load(guest.id);
      const refunds = await call("workspace/refunds");
      check(
        refunds.items.some(
          (o) => o.id === guest.id && Number(o.outstanding) === 1000000,
        ),
        engine.name() + ": canceled paid pickup enters the refund queue",
      );
      await call(`workspace/orders/${guest.id}/status`, "PATCH", {
        status: "delivered",
        version: guest.version,
        reason: "Khách quyết định nhận lại hoa tại quầy",
      });
      guest = await load(guest.id);
      check(
        guest.picked_up_at &&
          !guest.shipped_at &&
          guest.delivery_slot === "Nhận ngay",
        engine.name() +
          ": restore pickup rechecks stock without requiring a delivery slot",
      );
      await call(`workspace/orders/${guest.id}/status`, "PATCH", {
        status: "cancelled",
        version: guest.version,
        reason: "Khách trả lại hoa và nhận hoàn tiền",
      });
      guest = await load(guest.id);
      const refund = {
        amount: 1000000,
        version: guest.version,
        requestKey: randomUUID(),
        method: "cash",
        confirmed: true,
      };
      await call(`workspace/orders/${guest.id}/refund`, "POST", refund);
      check(
        (await load(guest.id)).payment_status === "refunded" &&
          (await balance(guest.id)).balance === 0,
        engine.name() +
          ": pickup refund uses existing audited ledger without extra collection",
      );
      await call(`workspace/orders/${known.id}/status`, "PATCH", {
        status: "cancelled",
        version: known.version,
        reason: "Đổi trả đơn nhận tại cửa hàng",
      });
      email = await one(
        "SELECT template_key,body FROM email_outbox WHERE store_id=? AND order_id=? ORDER BY id DESC LIMIT 1",
        [sid, known.id],
      );
      check(
        email.template_key === "order_pickup_status" &&
          email.body.includes("Đã hủy") &&
          !email.body.includes("COD"),
        engine.name() + ": canceled pickup queues the matching status template",
      );
      await call(
        `workspace/manual-orders/${known.id}`,
        "GET",
        undefined,
        403,
        context,
        otherSid,
      );
      check(
        true,
        engine.name() + ": another store cannot access pickup order data",
      );

      const saved = await call(
        "workspace/order-drafts",
        "POST",
        base({
          collectAmount: 0,
          pickupConfirmed: true,
          walkInGuest: true,
          phone: "",
          customerName: "",
        }),
      );
      const draft = await call("workspace/order-drafts/" + saved.id);
      check(
        draft.payload.fulfillmentMethod === "pickup" &&
          !draft.payload.pickupConfirmed,
        engine.name() +
          ": saving a pickup draft does not preserve handoff consent",
      );
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
      await page.goto(
        `${origin}/workspace/${sid}/orders/new?draft=${saved.id}`,
      );
      await expect(
        page.getByRole("heading", { name: "1. Khách hàng", exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByLabel("Xác nhận khách đã nhận hoa tại cửa hàng.", {
          exact: true,
        }),
      ).not.toBeChecked();
      await expect(
        page.getByLabel("Ngày giao hoa", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel("Địa chỉ giao hoa", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel("Tên người đặt", { exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("Giao cho khách", { exact: true }).check();
      await expect(
        page.getByLabel("Ngày giao hoa", { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("Khách nhận ngay tại cửa hàng", { exact: true })
        .check();
      await page.getByLabel("Khách lẻ", { exact: false }).check();
      await chooseSelect(nativeSelect(page, "Trạng thái thanh toán"), "paid");
      await expect(
        page.getByLabel("Số tiền thực tế đã nhận (VNĐ)", { exact: true }),
      ).toHaveValue("1000000");
      await page
        .getByLabel("Xác nhận khách đã nhận hoa tại cửa hàng.", {
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "Tính giá & rà soát", exact: true })
        .click();
      const submit = page.getByRole("button", {
        name: "Tạo đơn & xác nhận đã nhận hoa",
        exact: true,
      });
      await expect(submit).toBeVisible();
      check(
        true,
        engine.name() +
          ": pickup form hides delivery fields and restores them on switching back",
      );
      for (const w of width === 1440 ? [1440, 1024, 768] : [390, 320]) {
        await page.setViewportSize({ width: w, height: 1000 });
        check(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          engine.name() + `: pickup editor fits ${w}px`,
        );
      }
      await page.screenshot({
        path: `.local/pickup-e2e/${engine.name()}-review.png`,
        fullPage: true,
      });
      const sent = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/workspace/manual-orders") &&
          r.request().method() === "POST",
      );
      await submit.click();
      const response = await sent;
      assert(response.ok(), await response.text());
      const uiOrder = await response.json();
      await expect(
        page.getByRole("dialog", {
          name: "Đơn " + uiOrder.reference,
          exact: true,
        }),
      ).toBeVisible();
      const panel = page.getByRole("dialog", {
        name: "Đơn " + uiOrder.reference,
        exact: true,
      });
      await expect(
        panel.getByText("Đã nhận tại cửa hàng", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        panel.getByText("Khách lấy tại cửa hàng", { exact: true }).first(),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      check(
        (await load(uiOrder.id)).status === "delivered",
        engine.name() +
          ": real editor converts anonymous paid draft to completed pickup and shows matching detail state",
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/workspace/${sid}/board`);
      await expect(page.locator(".board-filter-toolbar")).toBeVisible();
      const toolbar = page.locator(".board-filter-toolbar");
      await chooseSelect(nativeSelect(toolbar, "Nhận hoa"), "pickup");
      await expect(page.locator(".order-pickup-tag").first()).toBeVisible();
      if (width === 1440) {
        const boxes = await toolbar
          .locator(":scope > *")
          .evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect().bottom),
          );
        check(
          Math.max(...boxes) - Math.min(...boxes) < 2,
          "Desktop: refresh icon and compact filters remain in one row",
        );
      }
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        engine.name() + ": toolbar pickup filter fits viewport",
      );
      await page.waitForLoadState("networkidle");
      await page.goto(`${origin}/workspace/${sid}/calendar`);
      await expect(page.locator(".order-pickup-tag").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      check(
        errors.length === 0,
        engine.name() + ": no browser runtime errors: " + errors.join("; "),
      );
      await context.close();
      await support.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    `${checks} pickup browser/API/SQL checks passed; isolated QA only, no real email or bank transfer`,
  );
} finally {
  for (const sid of stores) {
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
      "email_templates",
      "products",
      "categories",
      "store_bank_accounts",
      "subscriptions",
      "store_memberships",
    ])
      await db.execute(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
    await db.execute("DELETE FROM stores WHERE id=?", [sid]);
  }
  for (const uid of users) {
    for (const table of ["account_activity", "sessions"])
      await db.execute(`DELETE FROM ${table} WHERE user_id=?`, [uid]);
    await db.execute("DELETE FROM users WHERE id=?", [uid]);
  }
  await db.end();
}
