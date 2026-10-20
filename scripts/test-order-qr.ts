import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool, query, mutate } from "../lib/db";
import { withSystem, withStore } from "../lib/tenant";
import { createIntent } from "../lib/sepay";
import {
  reconcileOrderSession,
  expireAllOrderSessions,
} from "../lib/order-payment-sessions";
import { findBank } from "../lib/bank-catalog";

assert(
  process.env.MYSQL_DATABASE === "fleur_saas_test" &&
    process.env.MYSQL_PORT === "3310",
);
const stamp = randomBytes(5).toString("hex"),
  ownerToken = randomBytes(32).toString("hex"),
  guestToken = randomBytes(32).toString("hex");
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const one = async (sql: string, args: any[] = []) =>
  (await query<any[]>(sql, args))[0];
const origin = process.env.TEST_ORIGIN!;
let uid = 0,
  sid = 0,
  pid = 0,
  count = 0;
const check = (value: unknown, text: string) => {
  assert(value, text);
  count++;
  console.log("PASS", text);
};
async function main() {
  return withSystem(async () => {
    try {
      uid = (
        await mutate(
          "INSERT INTO users(name,email,password_hash) VALUES('QR QA',?,'not-a-login')",
          [`qr-${stamp}@example.test`],
        )
      ).insertId;
      await mutate(
        "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))",
        [uid, hash(ownerToken)],
      );
      sid = (
        await mutate(
          "INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,'QR QA',?,'approved',?,'{}')",
          [
            `qr-${stamp}`,
            uid,
            JSON.stringify({
              timezone: "Asia/Ho_Chi_Minh",
              open: true,
              shipping: 0,
              free_shipping: 0,
              slots: ["09:00–12:00"],
              advance_days: 30,
              lead_minutes: 0,
              closed_dates: [],
              capacity: 1000,
            }),
          ],
        )
      ).insertId;
      await mutate(
        "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')",
        [sid, uid],
      );
      await mutate(
        "INSERT INTO subscriptions(store_id,plan_id,status,billing_policy,access_started_at,access_ends_at) VALUES(?,3,'active',1,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))",
        [sid],
      );
      await mutate(
        "INSERT INTO store_bank_accounts(store_id,bank_code,bank_name,account_number,account_holder,enabled) VALUES(?,'970423','TPBank','123456789','QA',1)",
        [sid],
      );
      await mutate(
        "INSERT INTO email_templates(store_id,template_key,name,kind,subject,body,active) VALUES(?,'order_status','QR status QA','transactional','Đơn {{order_reference}}','{{order_status}}',1)",
        [sid],
      );
      const cat = (
        await mutate(
          "INSERT INTO categories(store_id,name,slug) VALUES(?,'QR QA',?)",
          [sid, stamp],
        )
      ).insertId;
      pid = (
        await mutate(
          "INSERT INTO products(store_id,category_id,name,slug,price,stock,image,description,flowers,care) VALUES(?,?,'QR QA',?,100000,100,'/images/roses.jpg','QA','QA','QA')",
          [sid, cat, stamp],
        )
      ).insertId;
      const promo = (
        await mutate(
          "INSERT INTO promotions(store_id,code,name,type,value,min_order,starts_at,ends_at,usage_limit,used,active) VALUES(?,?,'QR QA','percent',10,0,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY),100,0,1)",
          [sid, `QR${stamp}`],
        )
      ).insertId;
      async function api(
        path: string,
        method = "GET",
        data?: any,
        cookie = "fleur_checkout=" + guestToken,
        expected = 200,
        store = sid,
      ) {
        const r = await fetch(origin + "/api/" + path, {
          method,
          headers: {
            origin,
            cookie,
            "x-fleur-store": String(store),
            "content-type": "application/json",
          },
          ...(data ? { body: JSON.stringify(data) } : {}),
        });
        const value = await r.json();
        assert.equal(r.status, expected, JSON.stringify(value));
        return value;
      }
      let n = 0;
      async function make(
        extra: {
          expired?: boolean;
          paid?: boolean;
          partial?: boolean;
          cod?: boolean;
          pickup?: boolean;
          manual?: boolean;
        } = {},
      ) {
        const id = (
          await mutate(
            "INSERT INTO orders(store_id,reference,customer_name,email,phone,address,recipient_name,recipient_phone,delivery_date,delivery_slot,payment_method,subtotal,total,idempotency_key,checkout_owner,creation_source,fulfillment_method,promotion_id,status) VALUES(?,?,'QA','','0901234567','10 Phố Hoa','QA','0901234567',CURDATE(),'09:00–12:00',?,100000,100000,?,?,?,?,?,?)",
            [
              sid,
              `QR-${stamp}-${++n}`,
              extra.cod ? "cod" : "bank",
              randomUUID(),
              hash(guestToken),
              extra.manual ? "manual" : "web",
              extra.pickup ? "pickup" : "delivery",
              promo,
              extra.pickup ? "delivered" : "pending",
            ],
          )
        ).insertId;
        await mutate(
          "INSERT INTO order_items(store_id,order_id,product_id,product_name,image,size,quantity,price,line_type) VALUES(?,?,?,'QA','','S',1,100000,'catalog')",
          [sid, id, pid],
        );
        await mutate("UPDATE products SET stock=stock-1 WHERE id=?", [pid]);
        await mutate("UPDATE promotions SET used=used+1 WHERE id=?", [promo]);
        const c = await pool.getConnection();
        let payment: any;
        try {
          payment = await withStore(sid, () =>
            createIntent(c, sid, "order", uid, 100000, id, null, {
              bank_code: "970423",
              bank_name: "TPBank",
              account_number: "123456789",
              account_holder: "QA",
              enabled: true,
              sepay_enabled: false,
              auto_confirm_status: "confirmed",
            }),
          );
        } finally {
          c.release();
        }
        if (extra.expired)
          await mutate(
            "UPDATE payment_intents SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",
            [payment.id],
          );
        if (extra.paid || extra.partial) {
          await mutate(
            "INSERT INTO order_payments(store_id,order_id,amount,kind,method,reference,actor_id) VALUES(?,?,?,'collect','bank',?,?)",
            [sid, id, extra.paid ? 100000 : 10000, randomUUID(), uid],
          );
          // Deliberately leave cached status unpaid: the actual ledger must guard cancellation.
        }
        return { id, payment };
      }
      check(
        findBank("MB")?.bin === "970422" &&
          findBank("970423")?.name === "TPBank",
        "Official catalog distinguishes MB from TPBank",
      );
      const a = await make();
      check(
        Math.abs(Date.parse(a.payment.expiresAt) - Date.now() - 300000) <
          3000 && a.payment.qrUrl.includes("/970423-"),
        "New order QR targets TPBank with an immutable five-minute deadline",
      );
      const view = await api("payment-intents?code=" + a.payment.code);
      check(
        view.bank.bank_name === "TPBank" &&
          Date.parse(view.expiresAt) === Date.parse(a.payment.expiresAt) &&
          view.serverNow,
        "Guest session restores its original bank and deadline",
      );
      await api(
        "payment-intents?code=" + a.payment.code,
        "GET",
        undefined,
        "",
        401,
      );
      await api(
        "payment-intents/cancel",
        "POST",
        { code: a.payment.code },
        "fleur_checkout=wrong",
        403,
      );
      await api(
        "payment-intents?code=" + a.payment.code,
        "GET",
        undefined,
        "fleur_session=" + ownerToken,
        404,
        sid + 1000000,
      );
      check(
        true,
        "Anonymous, wrong guest and cross-store requests cannot control a payment session",
      );
      const before = await one("SELECT stock FROM products WHERE id=?", [pid]);
      const cancelled = await api("payment-intents/cancel", "POST", {
        code: a.payment.code,
      });
      await api("payment-intents/cancel", "POST", { code: a.payment.code });
      check(
        cancelled.orderStatus === "cancelled" &&
          !cancelled.qrUrl &&
          (await one("SELECT stock FROM products WHERE id=?", [pid])).stock ===
            before.stock + 1,
        "Manual cancellation closes QR and restores inventory exactly once",
      );
      check(
        (
          await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=?", [
            a.id,
          ])
        ).n === 0,
        "Cancelling an unpaid order creates neither receipt nor refund",
      );
      const refunds = await api(
        "workspace/refunds",
        "GET",
        undefined,
        "fleur_session=" + ownerToken,
      );
      check(
        !JSON.stringify(refunds).includes(`QR-${stamp}-1`),
        "Cancelled unpaid order is absent from the actual refunds API",
      );
      const b = await make({ expired: true });
      await Promise.all([
        withStore(sid, () => reconcileOrderSession(b.payment.code)),
        withStore(sid, () => reconcileOrderSession(b.payment.code)),
      ]);
      check(
        (await one("SELECT status FROM orders WHERE id=?", [b.id])).status ===
          "cancelled" &&
          (
            await one(
              "SELECT COUNT(*) n FROM order_status_events WHERE order_id=? AND status='cancelled'",
              [b.id],
            )
          ).n === 1,
        "Concurrent expiry cancels exactly once",
      );
      const c = await make({ expired: true, partial: true });
      await withStore(sid, () => reconcileOrderSession(c.payment.code));
      check(
        (await one("SELECT status FROM orders WHERE id=?", [c.id])).status ===
          "pending",
        "A real deposit protects an order even with an incorrect unpaid cache",
      );
      await api(
        "payment-intents/cancel",
        "POST",
        { code: c.payment.code },
        undefined,
        409,
      );
      const d = await make({ expired: true, paid: true });
      await withStore(sid, () => reconcileOrderSession(d.payment.code));
      check(
        (await one("SELECT status FROM orders WHERE id=?", [d.id])).status ===
          "pending",
        "A full receipt cannot be erased by an expiry race",
      );
      const e = await make({ expired: true, cod: true }),
        f = await make({ expired: true, pickup: true });
      await expireAllOrderSessions();
      check(
        (await one("SELECT status FROM orders WHERE id=?", [e.id])).status ===
          "pending" &&
          (await one("SELECT status FROM orders WHERE id=?", [f.id])).status ===
            "delivered",
        "Expiry preserves COD orders and completed counter pickups",
      );
      const g = await make();
      await mutate(
        "UPDATE store_bank_accounts SET bank_code='970422',bank_name='MB' WHERE store_id=?",
        [sid],
      );
      const changed = await api("payment-intents?code=" + g.payment.code);
      check(
        changed.orderStatus === "cancelled" &&
          changed.bank.bank_name === "TPBank" &&
          !changed.qrUrl,
        "Changing the receiving bank closes old QR without retargeting its historical snapshot",
      );
      await mutate(
        "UPDATE store_bank_accounts SET bank_code='970423',bank_name='TPBank' WHERE store_id=?",
        [sid],
      );
      const h = await make({ expired: true, manual: true });
      await expireAllOrderSessions();
      check(
        (await one("SELECT status FROM orders WHERE id=?", [h.id])).status ===
          "cancelled",
        "Unpaid manual bank orders also expire safely",
      );
      const outstanding = await make({ manual: true });
      await api(
        "payment-intents/cancel",
        "POST",
        { code: outstanding.payment.code },
        "fleur_session=" + ownerToken,
      );
      check(
        (await one("SELECT status FROM orders WHERE id=?", [outstanding.id]))
          .status === "cancelled",
        "Authorized store staff can cancel an unpaid manual-order QR",
      );
      const inventory = await one("SELECT stock FROM products WHERE id=?", [
        pid,
      ]);
      check(
        inventory.stock === 96 &&
          (await one("SELECT used FROM promotions WHERE id=?", [promo]))
            .used === 4,
        "Stock and promotion counters match the remaining protected orders",
      );
      for (let race = 0; race < 3; race++) {
        const racing = await make({ manual: true });
        const results = await Promise.all([
          fetch(origin + "/api/payment-intents/cancel", {
            method: "POST",
            headers: {
              origin,
              cookie: "fleur_session=" + ownerToken,
              "x-fleur-store": String(sid),
              "content-type": "application/json",
            },
            body: JSON.stringify({ code: racing.payment.code }),
          }),
          fetch(origin + `/api/workspace/orders/${racing.id}/payment`, {
            method: "POST",
            headers: {
              origin,
              cookie: "fleur_session=" + ownerToken,
              "x-fleur-store": String(sid),
              "content-type": "application/json",
            },
            body: JSON.stringify({
              kind: "collect",
              amount: 100000,
              method: "bank",
              reference: randomUUID(),
            }),
          }),
        ]);
        const state = await one(
          "SELECT status,(SELECT COALESCE(SUM(amount),0) FROM order_payments WHERE order_id=orders.id) balance FROM orders WHERE id=?",
          [racing.id],
        );
        check(
          results.some((r) => r.status === 200) &&
            results.every((r) => [200, 409].includes(r.status)) &&
            ((state.status === "cancelled" && Number(state.balance) === 0) ||
              (state.status !== "cancelled" &&
                Number(state.balance) === 100000)),
          `Receipt racing cancellation ${race + 1} cannot cancel a paid order or lose money`,
        );
      }
      const checkout = {
        items: [{ productId: pid, quantity: 1, size: "S" }],
        code: "",
        customerName: "QR Guest",
        email: `qr-guest-${stamp}@example.test`,
        phone: "0901234567",
        address: "10 Phố Hoa, Hà Nội",
        recipientName: "QR Guest",
        recipientPhone: "0901234567",
        deliveryDate: new Date(Date.now() + 86400000)
          .toISOString()
          .slice(0, 10),
        deliverySlot: "09:00–12:00",
        deliveryMode: "self",
        paymentMethod: "bank",
        idempotencyKey: randomUUID(),
        expectedTotal: 100000,
      };
      const first = await api("checkout", "POST", checkout);
      const retry = await api("checkout", "POST", checkout);
      check(
        first.reference === retry.reference &&
          first.payment.code === retry.payment.code &&
          Date.parse(first.payment.expiresAt) ===
            Date.parse(retry.payment.expiresAt),
        "Real checkout retries preserve exactly one order, QR and deadline",
      );
      await mutate(
        "UPDATE payment_intents SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE reference_code=?",
        [first.payment.code],
      );
      const retryExpired = await api("checkout", "POST", checkout);
      check(
        retryExpired.payment.orderStatus === "cancelled" &&
          !retryExpired.payment.qrUrl,
        "Retrying an expired checkout never creates or reopens a payment session",
      );
      const expiryMail = await one(
        "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='order_status' AND recipient=?",
        [sid, checkout.email],
      );
      check(
        Number(expiryMail.n) === 1,
        "Checkout expiry enqueues exactly one customer status email without sending real mail",
      );
      const config = await api(
        "workspace/settings",
        "GET",
        undefined,
        "fleur_session=" + ownerToken,
      );
      await api(
        "workspace/settings",
        "PATCH",
        {
          ...config,
          address: "10 Phố Hoa, Hà Nội",
          bank: {
            ...config.bank,
            bank_code: "MB",
            bank_name: "TPBank",
            enabled: true,
            sepay_enabled: false,
          },
        },
        "fleur_session=" + ownerToken,
      );
      const canonical = await one(
        "SELECT bank_code,bank_name FROM store_bank_accounts WHERE store_id=?",
        [sid],
      );
      check(
        canonical.bank_code === "970422" &&
          canonical.bank_name === findBank("MB")?.name,
        "Settings save derives bank name from canonical BIN even if the client sends a mismatched label",
      );
      const updatedConfig = await api(
        "workspace/settings",
        "GET",
        undefined,
        "fleur_session=" + ownerToken,
      );
      await api(
        "workspace/settings",
        "PATCH",
        {
          ...updatedConfig,
          bank: {
            ...updatedConfig.bank,
            bank_code: "invalid",
            enabled: true,
            sepay_enabled: false,
          },
        },
        "fleur_session=" + ownerToken,
        400,
      );
      check(
        (await one("SELECT version FROM stores WHERE id=?", [sid])).version ===
          updatedConfig.version,
        "Invalid bank selection cannot partially save store settings",
      );
      const { GET: worker } = await import("../app/api/payments/worker/route");
      const { NextRequest } = await import("next/server");
      const savedSecret = process.env.CRON_SECRET;
      try {
        process.env.CRON_SECRET = "QA_" + randomBytes(32).toString("hex");
        check(
          (await worker(new NextRequest(origin + "/api/payments/worker")))
            .status === 401,
          "Background expiry worker rejects unauthenticated requests",
        );
        check(
          (
            await worker(
              new NextRequest(origin + "/api/payments/worker", {
                headers: { authorization: "Bearer " + process.env.CRON_SECRET },
              }),
            )
          ).status === 200,
          "Authenticated background expiry worker executes successfully",
        );
      } finally {
        if (savedSecret === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = savedSecret;
      }
      console.log(`PASS ${count} order QR integration checks`);
    } finally {
      if (sid) {
        for (const table of [
          "email_outbox",
          "domain_outbox",
          "order_payments",
          "order_status_events",
          "order_items",
          "payment_intents",
          "orders",
          "customers",
          "products",
          "categories",
          "promotions",
          "store_bank_accounts",
          "audit_logs",
          "store_memberships",
          "subscriptions",
        ])
          await mutate(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
        await mutate("DELETE FROM stores WHERE id=?", [sid]);
      }
      if (uid) {
        await mutate("DELETE FROM sessions WHERE user_id=?", [uid]);
        await mutate("DELETE FROM users WHERE id=?", [uid]);
      }
    }
  });
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
