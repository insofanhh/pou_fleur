import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import mysql from "mysql2/promise";
import { chromium, webkit, expect } from "@playwright/test";
import { nativeSelect, chooseSelect } from "./ui-controls.mjs";

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
});
const key = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url"),
  salt = randomBytes(16).toString("hex");
let sid,
  otherSid,
  pid,
  checks = 0,
  serial = 0;
const users = [];
const one = async (sql, values = []) => (await db.execute(sql, values))[0][0];
const check = (v, label) => {
  assert(v, label);
  checks++;
  console.log("PASS", label);
};
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
}).format(new Date());
const tomorrow = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
}).format(new Date(Date.now() + 86400000));
const settings = {
  open: true,
  shipping: 0,
  free_shipping: 0,
  slots: ["09:00–12:00"],
  advance_days: 30,
  lead_minutes: 0,
  closed_dates: [],
  capacity: 1000,
};
await mkdir(".local/cod-e2e", { recursive: true });
try {
  for (const role of ["owner", "support"]) {
    const [r] = await db.execute(
      "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
      [
        "COD " + role + " QA",
        `cod-${role}-${key}@example.test`,
        salt + ":" + scryptSync(password, salt, 64).toString("hex"),
      ],
    );
    users.push(r.insertId);
  }
  for (const [slug, name] of [
    ["cod-" + key, "COD QA"],
    ["cod-other-" + key, "COD other QA"],
  ]) {
    const [r] = await db.execute(
      "INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,?,?,'approved',?,'{}')",
      [slug, name, users[0], JSON.stringify(settings)],
    );
    if (!sid) sid = r.insertId;
    else otherSid = r.insertId;
  }
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
  for (const template of ["order_confirmation", "order_status"])
    await db.execute(
      "INSERT INTO email_templates(store_id,template_key,name,kind,subject,body,active) VALUES(?,?,?,'transactional','Đơn {{order_reference}}','Cảm ơn {{customer_name}}',1)",
      [sid, template, template],
    );
  const [category] = await db.execute(
    "INSERT INTO categories(store_id,name,slug) VALUES(?,'Hoa COD QA',?)",
    [sid, key],
  );
  const [product] = await db.execute(
    "INSERT INTO products(store_id,category_id,name,slug,price,stock,image,description,flowers,care) VALUES(?,?,'Hoa COD QA',?,1000000,100,'/images/roses.jpg','Hoa QA','Hồng','Nước')",
    [sid, category.insertId, key],
  );
  pid = product.insertId;
  await db.execute(
    "INSERT INTO store_bank_accounts(store_id,bank_code,bank_name,account_number,account_holder,enabled) VALUES(?,'TPB','QA','0000000','QA',1)",
    [sid],
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
      const login = await context.request.post(origin + "/api/auth/login", {
        headers: { origin, "x-fleur-store": String(sid) },
        data: { email: `cod-owner-${key}@example.test`, password },
      });
      assert(login.ok(), await login.text());
      const call = async (
        path,
        method = "GET",
        data,
        status = 200,
        scope = sid,
        ctx = context,
      ) => {
        const response = await ctx.request.fetch(origin + "/api/" + path, {
          method,
          headers: { origin, "x-fleur-store": String(scope) },
          ...(data === undefined ? {} : { data }),
        });
        const body = await response.json();
        assert.equal(response.status(), status, JSON.stringify(body));
        return body;
      };
      const create = async (extra = {}) => {
        const input = {
          customerName: "COD QA " + ++serial,
          phone: "090" + String(serial).padStart(7, "0"),
          email: "",
          deliveryMode: "self",
          address: "100 Đường Láng, Hà Nội",
          deliveryDate: tomorrow,
          deliverySlot: settings.slots[0],
          shipping: 0,
          initialStatus: "confirmed",
          collectAmount: 0,
          collectMethod: "cash",
          items: [
            { type: "custom", name: "Bó hoa QA", quantity: 1, price: 1000000 },
          ],
          ...extra,
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
      const load = (id) => call("workspace/manual-orders/" + id);
      const payload = (o, amount, extra = {}) => ({
        amount,
        version: o.version,
        requestKey: randomUUID(),
        method: "cash",
        confirmed: true,
        ...extra,
      });
      const collect = (o, amount, extra = {}, status = 200) =>
        call(
          `workspace/orders/${o.id}/cod`,
          "POST",
          payload(o, amount, extra),
          status,
        );
      const transition = (o, status, extra = {}, expected = 200) =>
        call(
          `workspace/orders/${o.id}/status`,
          "PATCH",
          { status, version: o.version, ...extra },
          expected,
        );
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const created = await create(),
        id = created.id;
      await page.goto(`${origin}/workspace/${sid}/orders?order=${id}`);
      let detail = page.getByRole("dialog", {
        name: "Đơn " + created.reference,
        exact: true,
      });
      await expect(detail).toBeVisible({ timeout: 15000 });
      await page.waitForLoadState("networkidle");
      check(
        (await detail
          .getByText("Ghi nhận thu / hoàn tiền", { exact: true })
          .count()) === 0,
        `${engine.name()}: no generic receipt/refund selector in detail`,
      );
      await detail
        .locator("summary")
        .filter({ hasText: "Xác nhận đã thu COD" })
        .click();
      const receipt = detail.locator(".cod-receipt");
      for (const size of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({width:size,height:1000});
        await expect.poll(()=>receipt.evaluate(el=>{
          const fields=el.querySelector(".cod-receipt-fields"),
            amount=el.querySelector('[name="codAmount"]'),
            reference=el.querySelector('[name="codReference"]'),
            note=el.querySelector('[name="codNote"]');
          if(!fields||!amount||!reference||!note)return false;
          const box=fields.getBoundingClientRect(), a=amount.getBoundingClientRect(), r=reference.getBoundingClientRect(), n=note.getBoundingClientRect();
          // Fieldset may expose an unresolved minmax() in computed CSS; verify rendered geometry.
          return { fullWidth:a.width>=box.width-2, referenceWidth:Math.abs(r.width-a.width)<=2, noteWidth:Math.abs(n.width-a.width)<=2, stacked:r.top>a.bottom && n.top>r.bottom, fits:el.scrollWidth<=el.clientWidth+1 };
        })).toMatchObject({fullWidth:true,referenceWidth:true,noteWidth:true,stacked:true,fits:true});
        check(true,`${engine.name()}: COD receipt fields retain full-width single-column layout at ${size}px`);
        await receipt.scrollIntoViewIfNeeded();
        await page.screenshot({path:`.local/cod-e2e/${engine.name()}-receipt-${size}.png`});
      }
      await page.setViewportSize({width,height:1000});
      await receipt
        .getByLabel("Số tiền vừa nhận (VNĐ)", { exact: true })
        .fill("200000");
      await chooseSelect(
        nativeSelect(receipt, "Hình thức thu thực tế"),
        "bank",
      );
      await receipt
        .getByLabel("Mã tham chiếu (nếu có)", { exact: true })
        .fill("COD-QA-" + id);
      await receipt.getByRole("checkbox").check();
      const receiptResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/orders/${id}/cod`) &&
          r.request().method() === "POST",
      );
      await receipt
        .getByRole("button", { name: "Xác nhận đã thu COD", exact: true })
        .click();
      const saved = await receiptResponse;
      assert(saved.ok(), await saved.text());
      const sent = saved.request().postDataJSON();
      await expect(detail.locator(".cod-detail-summary")).toContainText(
        "800.000",
      );
      let o = await load(id);
      check(
        o.payment_status === "partially_paid" &&
          o.collected === 200000 &&
          o.payment_method === "cod",
        `${engine.name()}: bank receipt reduces COD due without changing original method`,
      );
      check(
        (await call(`workspace/orders/${id}/cod`, "POST", sent)).duplicate,
        `${engine.name()}: replay does not add a second receipt`,
      );
      await call(
        `workspace/orders/${id}/cod`,
        "POST",
        { ...sent, amount: 100000 },
        409,
      );
      await collect(o, 800001, {}, 409);
      await collect(o, 0, {}, 400);
      await collect(o, 100000, { confirmed: false }, 400);
      await collect(o, 100000, { receivedAt: new Date(Date.now()+3600000).toISOString() }, 400);
      await collect({ ...o, version: o.version - 1 }, 100000, {}, 409);
      check(
        (await load(id)).collected === 200000,
        `${engine.name()}: edited retry, overpayment and stale version leave balance intact`,
      );
      const partialDelivery=await create(), partialOrder=await load(partialDelivery.id);
      await transition(partialOrder,"delivered",{codOutcome:"partial",codPayment:payload(partialOrder,300000)});
      const partialResult=await load(partialOrder.id);
      check(partialResult.status==="delivered"&&partialResult.payment_status==="partially_paid"&&partialResult.collected===300000,`${engine.name()}: partial receipt and delivery commit together without clearing remaining liability`);
      await chooseSelect(nativeSelect(detail, "Trạng thái mới"), "delivered");
      await detail
        .getByRole("button", { name: "Cập nhật trạng thái", exact: true })
        .click();
      let confirmation = page.getByRole("dialog", {
        name: "Xác nhận chuyển trạng thái",
        exact: true,
      });
      await chooseSelect(
        nativeSelect(confirmation, "Kết quả thu COD"),
        "unpaid",
      );
      await confirmation
        .getByRole("button", {
          name: "Xác nhận chuyển trạng thái",
          exact: true,
        })
        .click();
      await expect(confirmation).toHaveCount(0);
      o = await load(id);
      check(
        o.status === "delivered" &&
          o.payment_status === "partially_paid" &&
          o.collected === 200000,
        `${engine.name()}: delivery without receipt retains outstanding amount`,
      );
      const filtered = await call(
        "workspace/order-list?mode=table&method=cod_delivered_due",
      );
      check(
        filtered.items.some((x) => x.id === id) &&
          filtered.codStats.delivered_count >= 1,
        `${engine.name()}: delivered COD filter and monitoring include unpaid delivery`,
      );
      const second = await create();
      let full = await load(second.id);
      await transition(full, "delivered", {}, 400);
      await transition(
        full,
        "delivered",
        { codOutcome: "paid", codPayment: payload(full, 500000) },
        400,
      );
      check(
        (await load(full.id)).status === "confirmed" &&
          (await load(full.id)).collected === 0,
        `${engine.name()}: invalid delivery receipt rolls back status and money atomically`,
      );
      await page.goto(`${origin}/workspace/${sid}/orders?order=${full.id}`);
      detail = page.getByRole("dialog", {
        name: "Đơn " + second.reference,
        exact: true,
      });
      await expect(detail).toBeVisible();
      await page.waitForLoadState("networkidle");
      await chooseSelect(nativeSelect(detail, "Trạng thái mới"), "delivered");
      await detail
        .getByRole("button", { name: "Cập nhật trạng thái", exact: true })
        .click();
      confirmation = page.getByRole("dialog", {
        name: "Xác nhận chuyển trạng thái",
        exact: true,
      });
      await chooseSelect(nativeSelect(confirmation, "Kết quả thu COD"), "paid");
      await expect(
        confirmation.getByLabel("Số tiền vừa nhận (VNĐ)", { exact: true }),
      ).toHaveValue("1000000");
      await confirmation.getByRole("checkbox").check();
      check(
        await confirmation.evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1,
        ),
        `${engine.name()}: COD confirmation fits ${width}px`,
      );
      await page.screenshot({
        path: `.local/cod-e2e/${engine.name()}-delivery.png`,
      });
      await confirmation
        .getByRole("button", {
          name: "Xác nhận chuyển trạng thái",
          exact: true,
        })
        .click();
      await expect(confirmation).toHaveCount(0);
      full = await load(full.id);
      check(
        full.status === "delivered" &&
          full.payment_status === "paid" &&
          full.collected === 1000000,
        `${engine.name()}: complete delivery and real COD receipt commit together`,
      );
      await collect(full, 1, {}, 409);
      await page.goto(`${origin}/workspace/${sid}/orders?order=${full.id}`);
      detail=page.getByRole("dialog",{name:"Đơn "+second.reference,exact:true});
      await expect(detail).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(detail.locator(".order-overview")).toContainText("Đã thanh toán");
      await expect(detail.locator(".order-method-cod,.cod-detail-summary,.cod-receipt")).toHaveCount(0);
      check((await load(full.id)).payment_method==="cod",`${engine.name()}: paid detail hides COD collection UI while preserving original method`);
      await page.screenshot({path:`.local/cod-e2e/${engine.name()}-paid-detail.png`});
      await detail.getByRole("button",{name:"Đóng",exact:true}).click();
      const paidRow=page.getByRole("row").filter({hasText:second.reference});
      await expect(paidRow).toContainText("Đã thanh toán");
      await expect(paidRow.locator(".order-method-cod,.cod-outstanding,.order-method-summary")).toHaveCount(0);
      check(true,`${engine.name()}: paid list row shows paid state without COD tag or due notice`);
      const race = await create(),
        raceOrder = await load(race.id),
        body = payload(raceOrder, 1000000);
      const responses = await Promise.all(
        [1, 2].map(() =>
          context.request.post(
            `${origin}/api/workspace/orders/${race.id}/cod`,
            { headers: { origin, "x-fleur-store": String(sid) }, data: body },
          ),
        ),
      );
      check(
        responses.every((r) => r.ok()) &&
          (
            await one(
              "SELECT COUNT(*) n FROM order_payments WHERE store_id=? AND order_id=?",
              [sid, race.id],
            )
          ).n === 1,
        `${engine.name()}: concurrent same-key confirmations create one receipt`,
      );
      const competing = await create(),
        co = await load(competing.id);
      const competition = await Promise.all([
        context.request.post(`${origin}/api/workspace/orders/${co.id}/cod`, {
          headers: { origin, "x-fleur-store": String(sid) },
          data: payload(co, 1000000),
        }),
        context.request.post(
          `${origin}/api/workspace/orders/${co.id}/payment`,
          {
            headers: { origin, "x-fleur-store": String(sid) },
            data: {
              kind: "collect",
              amount: 1000000,
              method: "bank",
              reference: "BANK-QA-" + co.id,
            },
          },
        ),
      ]);
      check(
        competition.filter((r) => r.ok()).length === 1 &&
          (await load(co.id)).collected === 1000000,
        `${engine.name()}: competing bank and COD receipt cannot double collect`,
      );
      await collect(await load(id), 800000, { reference: "COD-QA-" + id }, 409);
      await transition(await load(id), "cancelled", {
        reason: "Khách hủy đơn, cần hoàn khoản đã thu",
      });
      await collect(await load(id), 1, {}, 409);
      check(
        (await call("workspace/refunds")).items.some(
          (x) => x.id === id && x.outstanding === 200000,
        ),
        `${engine.name()}: canceled partially paid COD enters refund queue`,
      );
      const unpaid = await create();
      await transition(await load(unpaid.id), "cancelled", {
        reason: "Khách hủy đơn chưa thanh toán",
      });
      check(
        !(await call("workspace/refunds")).items.some(
          (x) => x.id === unpaid.id,
        ),
        `${engine.name()}: canceled unpaid COD does not require refund`,
      );
      const bank = await create({ collectMethod: "bank" });
      await collect(await load(bank.id), 1000, {}, 409);
      await transition(await load(bank.id), "delivered");
      check(
        (await load(bank.id)).payment_status === "unpaid",
        `${engine.name()}: bank delivery is unaffected and never implicitly paid`,
      );
      const legacy = await create();
      await db.execute(
        "UPDATE orders SET payment_status='paid' WHERE store_id=? AND id=?",
        [sid, legacy.id],
      );
      await collect(await load(legacy.id), 1000, {}, 409);
      check(
        (
          await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=?", [
            legacy.id,
          ])
        ).n === 0,
        `${engine.name()}: legacy paid badge without ledger requires reconciliation`,
      );
      const unauthorized = await browser.newContext({
        serviceWorkers: "block",
      });
      await unauthorized.request.post(origin + "/api/auth/login", {
        headers: { origin, "x-fleur-store": String(sid) },
        data: { email: `cod-support-${key}@example.test`, password },
      });
      const staffOrder = await create(),
        so = await load(staffOrder.id);
      await call(
        `workspace/orders/${so.id}/cod`,
        "POST",
        payload(so, 1000000),
        403,
        sid,
        unauthorized,
      );
      await call(
        `workspace/orders/${so.id}/status`,
        "PATCH",
        {
          status: "delivered",
          version: so.version,
          codOutcome: "paid",
          codPayment: payload(so, 1000000),
        },
        403,
        sid,
        unauthorized,
      );
      await call(
        `workspace/orders/${so.id}/status`,
        "PATCH",
        { status: "delivered", version: so.version, codOutcome: "unpaid" },
        200,
        sid,
        unauthorized,
      );
      check(
        (await load(so.id)).status === "delivered" &&
          (await load(so.id)).collected === 0,
        `${engine.name()}: support can deliver without money but cannot confirm receipts`,
      );
      await unauthorized.close();
      const [foreign] = await db.execute(
        "INSERT INTO orders(store_id,reference,customer_name,phone,address,recipient_name,recipient_phone,delivery_date,delivery_slot,payment_method,subtotal,discount,shipping,total,payment_status,status,idempotency_key) VALUES(?,?,'Other','0900000000','Hà Nội','Other','0900000000',?,'09:00–12:00','cod',1000000,0,0,1000000,'unpaid','pending',?)",
        [
          otherSid,
          "QA-" + randomBytes(6).toString("hex"),
          tomorrow,
          randomUUID(),
        ],
      );
      await call(
        `workspace/orders/${foreign.insertId}/cod`,
        "POST",
        { ...payload(so, 1000), version: 1 },
        404,
      );
      check(
        (
          await one("SELECT payment_status FROM orders WHERE id=?", [
            foreign.insertId,
          ])
        ).payment_status === "unpaid",
        `${engine.name()}: tenant isolation rejects another store order`,
      );
      // Use real checkout APIs and verify persisted payer, notifications and queued mail.
      const checkout = {
        items: [{ productId: pid, quantity: 1, size: "S" }],
        customerName: "Khách COD",
        email: `cod-owner-${key}@example.test`,
        phone: "0901234567",
        address: "100 Đường Láng, Hà Nội",
        recipientName: "Người nhận hoa",
        recipientPhone: "0901234568",
        deliveryDate: tomorrow,
        deliverySlot: settings.slots[0],
        deliveryMode: "gift",
        message: "Quà tặng",
        notes: "",
        paymentMethod: "cod",
        consent: false,
        idempotencyKey: randomUUID(),
      };
      await call("checkout", "POST", checkout, 400);
      await call(
        "checkout",
        "POST",
        { ...checkout, codPayer: "recipient" },
        400,
      );
      const placed = await call("checkout", "POST", {
        ...checkout,
        codPayer: "recipient",
        codRecipientConsent: true,
      });
      const webOrder = await one(
        "SELECT * FROM orders WHERE store_id=? AND reference=?",
        [sid, placed.reference],
      );
      check(
        webOrder.cod_payer === "recipient" &&
          webOrder.cod_recipient_consent_at &&
          webOrder.payment_status === "unpaid" &&
          webOrder.creation_source === "web",
        `${engine.name()}: gift COD requires explicit payer and recipient consent`,
      );
      const mail = await one(
        "SELECT body FROM email_outbox WHERE store_id=? AND order_id=? AND template_key='order_confirmation'",
        [sid, webOrder.id],
      );
      check(
        mail?.body.includes("Người nhận hoa trả tiền") &&
          mail.body.includes("1.000.000"),
        `${engine.name()}: even old custom email template identifies COD payer and amount`,
      );
      await collect(await load(webOrder.id), 1000000);
      const paidMail = await one(
        "SELECT body FROM email_outbox WHERE store_id=? AND order_id=? AND template_key='order_status' ORDER BY id DESC LIMIT 1",
        [sid, webOrder.id],
      );
      check(
        paidMail?.body.includes("Đã thanh toán đủ") &&
          paidMail.body.includes("Còn phải thu: 0 VNĐ"),
        `${engine.name()}: receipt queues accurate paid COD notice`,
      );
      const [events] = await db.execute(
        "SELECT payload FROM domain_outbox WHERE store_id=?",
        [sid],
      );
      check(
        events.some(
          (e) =>
            JSON.stringify(e.payload).includes("Đơn COD mới") &&
            JSON.stringify(e.payload).includes(placed.reference),
        ),
        `${engine.name()}: new COD order notifies store with amount and payer`,
      );
      const buyer = await call("checkout", "POST", {
        ...checkout,
        codPayer: "buyer",
        idempotencyKey: randomUUID(),
      });
      check(
        (
          await one(
            "SELECT cod_payer FROM orders WHERE store_id=? AND reference=?",
            [sid, buyer.reference],
          )
        ).cod_payer === "buyer",
        `${engine.name()}: gift buyer can retain payment responsibility`,
      );
      const self = await call("checkout", "POST", {
        ...checkout,
        deliveryMode: "self",
        idempotencyKey: randomUUID(),
      });
      check(
        (
          await one(
            "SELECT cod_payer FROM orders WHERE store_id=? AND reference=?",
            [sid, self.reference],
          )
        ).cod_payer === "buyer",
        `${engine.name()}: self delivery automatically identifies buyer as payer`,
      );
      const transfer = await call("checkout", "POST", {
        ...checkout,
        paymentMethod: "bank",
        idempotencyKey: randomUUID(),
      });
      check(
        transfer.payment &&
          (
            await one(
              "SELECT cod_payer FROM orders WHERE store_id=? AND reference=?",
              [sid, transfer.reference],
            )
          ).cod_payer === null,
        `${engine.name()}: bank checkout still creates QR without COD payer requirement`,
      );
      const analytics = await call(
        `workspace/analytics?from=${today}&to=${today}`,
      );
      const receipts = await one(
        "SELECT COALESCE(SUM(p.amount),0) n FROM order_payments p JOIN orders o ON o.id=p.order_id WHERE o.store_id=? AND o.payment_method='cod' AND p.kind='collect' AND p.received_at>=CONVERT_TZ(?,'+07:00','+00:00') AND p.received_at<CONVERT_TZ(DATE_ADD(?,INTERVAL 1 DAY),'+07:00','+00:00')",
        [sid, today, today],
      );
      check(
        analytics.cod.collected === receipts.n &&
          analytics.cod.delivered_count > 0,
        `${engine.name()}: actual receipt-date analytics and delivered COD liability match ledger`,
      );
      const backdated = await create(),
        outside = await create(),
        corrected = await create();
      await db.execute(
        "UPDATE orders SET created_at=DATE_SUB(?,INTERVAL 30 DAY) WHERE store_id=? AND id IN (?,?,?)",
        [today, sid, backdated.id, outside.id, corrected.id],
      );
      const yesterday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(Date.now() - 86400000));
      await collect(await load(backdated.id), 100000, {
        receivedAt: today + "T00:15:00+07:00",
      });
      await collect(await load(outside.id), 100000, {
        receivedAt: yesterday + "T23:59:59+07:00",
      });
      const correctedOrder = await load(corrected.id);
      await call(`workspace/orders/${corrected.id}/payment-status`, "PATCH", {
        totalCollected: 500000,
        method: "cash",
        operation: "correction",
        version: correctedOrder.version,
        requestKey: randomUUID(),
      });
      const boundary = await call(
        `workspace/analytics?from=${today}&to=${today}`,
      );
      check(
        boundary.cod.collected === analytics.cod.collected + 100000 &&
          boundary.summary.orders_count === analytics.summary.orders_count,
        `${engine.name()}: Hanoi midnight bounds include old-order receipts, exclude prior-day money and corrections`,
      );
      await page.goto(`${origin}/workspace/${sid}/board`);
      await expect(
        page.getByRole("group", { name: "Bộ lọc đơn hàng" }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      const paidCard=page.locator(".kanban-card").filter({hasText:second.reference});
      await expect(paidCard).toBeAttached();
      await expect(paidCard.locator(".order-method-cod,.cod-outstanding,.order-method-summary")).toHaveCount(0);
      check(true,`${engine.name()}: paid Kanban card hides COD tag and collection reminder`);
      await chooseSelect(
        nativeSelect(page, "Phương thức"),
        "cod_delivered_due",
      );
      await expect(
        page.locator(".kanban-card").filter({ hasText: staffOrder.reference }),
      ).toBeVisible();
      check(
        await page
          .locator(".board-filter-toolbar")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        `${engine.name()}: board method filter fits ${width}px`,
      );
      const monitor = page.getByRole("region", { name: "Theo dõi COD" });
      await expect(monitor).toBeVisible();
      for (const size of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width: size, height: 1000 });
        await expect.poll(() => monitor.evaluate(el => {
          const box = el.getBoundingClientRect();
          return el.scrollWidth <= el.clientWidth + 1 &&
            [...el.children].every(child => {
              const rect = child.getBoundingClientRect();
              return rect.left >= box.left && rect.right <= box.right + 1;
            });
        })).toBe(true);
        await monitor.scrollIntoViewIfNeeded();
        await page.screenshot({path: `.local/cod-e2e/${engine.name()}-monitor-${size}.png`});
      }
      check(true, `${engine.name()}: compact COD monitor fits desktop and mobile`);
      await page.setViewportSize({ width, height: 1000 });

      // UI-only response variations leave the real receipt ledger untouched.
      let monitorStats = { awaiting_count: 0, outstanding: 0, delivered_count: 0, delivered_due: 0 };
      const statsRoute = async route => {
        const response = await route.fetch();
        const json = await response.json();
        await route.fulfill({ response, json: { ...json, codStats: monitorStats } });
      };
      await page.route("**/api/workspace/order-list?*", statsRoute);
      for (const area of ["board", "orders"]) {
        await page.goto(`${origin}/workspace/${sid}/${area}`);
        await expect(page.locator(area === "board" ? ".kanban" : ".table-wrap")).toBeVisible();
        await expect(monitor).toHaveCount(0);
        await page.waitForLoadState("networkidle");
      }
      check(true, `${engine.name()}: both zero amounts hide COD monitor in board and order list`);
      monitorStats = { awaiting_count: 1, outstanding: 500000, delivered_count: 0, delivered_due: 0 };
      await page.reload();
      await expect(monitor).toBeVisible();
      await expect(monitor.locator(".cod-monitor-metric").first()).toContainText("500.000 VNĐ");
      await expect(monitor.locator(".cod-monitor-metric").last()).toContainText("0 VNĐ");
      check(true, `${engine.name()}: outstanding COD remains visible when delivered amount is zero`);
      await page.waitForLoadState("networkidle");
      await page.unroute("**/api/workspace/order-list?*", statsRoute);
      await page.goto(`${origin}/workspace/${sid}/calendar`);
      await expect(page.locator(".calendar-cod-tag").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      check(
        errors.length === 0,
        `${engine.name()}: no browser runtime errors: ${errors.join("; ")}`,
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    `${checks} COD real browser/API/SQL checks passed; local QA only, no real email or bank transfer`,
  );
} finally {
  for (const storeId of [sid, otherSid].filter(Boolean)) {
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
      await db.execute(`DELETE FROM ${table} WHERE store_id=?`, [storeId]);
    await db.execute("DELETE FROM stores WHERE id=?", [storeId]);
  }
  for (const uid of users) {
    for (const table of ["account_activity", "sessions"])
      await db.execute(`DELETE FROM ${table} WHERE user_id=?`, [uid]);
    await db.execute("DELETE FROM users WHERE id=?", [uid]);
  }
  await db.end();
}
