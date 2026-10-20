import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use isolated QA DB on port 3310");
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
const { sid, pid, supportEmail } = JSON.parse(
  readFileSync(".local/manual-test-fixture.json", "utf8"),
);
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
  dateStrings: true,
  decimalNumbers: true,
});
let checks = 0;
function check(ok, label) {
  assert(ok, label);
  checks++;
  console.log("PASS", label);
}
function client() {
  const jar = new Map();
  return async (path, method = "GET", body, store = sid, expected = 200) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: {
        origin: base,
        "content-type": "application/json",
        "x-fleur-store": String(store),
        cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const h of r.headers.getSetCookie()) {
      const p = h.split(";")[0],
        at = p.indexOf("=");
      jar.set(p.slice(0, at), p.slice(at + 1));
    }
    const data = await r.json();
    assert(
      (Array.isArray(expected) ? expected : [expected]).includes(r.status),
      path + ": " + r.status + " " + JSON.stringify(data),
    );
    return { data, status: r.status };
  };
}
const owner = client(),
  support = client(),
  anon = client(),
  buyer = client();
const one = async (sql, args = []) => (await db.execute(sql, args))[0][0];
const load = async (id) => (await owner("workspace/manual-orders/" + id)).data;
const stock = async () =>
  Number((await one("SELECT stock FROM products WHERE id=?", [pid])).stock);
const events = async (id) =>
  Number(
    (
      await one("SELECT COUNT(*) n FROM order_status_events WHERE order_id=?", [
        id,
      ])
    ).n,
  );
const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
let originalSettings, supportId;
try {
  await db.execute("DELETE FROM login_attempts");
  await owner("auth/login", "POST", {
    email: "owner@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  await support("auth/login", "POST", {
    email: supportEmail,
    password: "SaaS-Testing-2026-Only",
  });
  supportId = (await support("auth/me")).data.user.id;
  const settingsRow = await one("SELECT settings FROM stores WHERE id=?", [
    sid,
  ]);
  originalSettings =
    typeof settingsRow.settings === "string"
      ? JSON.parse(settingsRow.settings)
      : settingsRow.settings;
  const settings = {
    ...originalSettings,
    capacity: 1000,
    lead_minutes: 0,
    open: true,
  };
  await db.execute("UPDATE stores SET settings=? WHERE id=?", [
    JSON.stringify(settings),
    sid,
  ]);
  const initialStock = await stock();
  const payload = {
    customerName: "Khách kiểm thử luồng",
    phone: "09" + String(Date.now()).slice(-8),
    deliveryMode: "self",
    address: "123 Đường Hoa, Quận 1",
    deliveryDate: date,
    deliverySlot: settings.slots[0],
    items: [{ type: "catalog", productId: pid, quantity: 2, size: "S" }],
    collectAmount: 100000,
    collectMethod: "cash",
    shipping: 25000,
  };
  const quote = (await owner("workspace/manual-orders/quote", "POST", payload))
    .data;
  const created = (
    await owner("workspace/manual-orders", "POST", {
      ...payload,
      quoteToken: quote.token,
      idempotencyKey: randomUUID(),
    })
  ).data;
  const id = created.id,
    endpoint = `workspace/orders/${id}`;
  let o = await load(id);
  const change = async (status, extra = {}, expected = 200, who = owner) =>
    who(
      endpoint + "/status",
      "PATCH",
      { status, version: (await load(id)).version, ...extra },
      sid,
      expected,
    );
  check((await stock()) === initialStock - 2, "Creating order reserves stock");
  const ledgerBefore = (
    await db.execute(
      "SELECT kind,amount,method,reference FROM order_payments WHERE order_id=?",
      [id],
    )
  )[0];
  await owner(endpoint + "/payment-method", "PATCH", {
    method: "bank",
    version: o.version,
  });
  let changed = await load(id);
  const ledgerAfter = (
    await db.execute(
      "SELECT kind,amount,method,reference FROM order_payments WHERE order_id=?",
      [id],
    )
  )[0];
  check(
    changed.payment_method === "bank" &&
      changed.version === o.version + 1 &&
      changed.collected === o.collected &&
      changed.payment_status === o.payment_status &&
      JSON.stringify(ledgerBefore) === JSON.stringify(ledgerAfter),
    "Changing payment method preserves balance, status and ledger",
  );
  await owner(
    endpoint + "/payment-method",
    "PATCH",
    { method: "cod", version: o.version },
    sid,
    409,
  );
  await owner(
    endpoint + "/payment-method",
    "PATCH",
    { method: "card", version: changed.version },
    sid,
    400,
  );
  await support(
    endpoint + "/payment-method",
    "PATCH",
    { method: "cod", version: changed.version },
    sid,
    403,
  );
  await anon(
    endpoint + "/payment-method",
    "PATCH",
    { method: "cod", version: changed.version },
    sid,
    401,
  );
  check(
    true,
    "Payment method rejects stale versions, invalid enum, support and anonymous users",
  );
  for (const role of ["manager", "admin"]) {
    await db.execute(
      "UPDATE store_memberships SET role=? WHERE store_id=? AND user_id=?",
      [role, sid, supportId],
    );
    await support(endpoint + "/payment-method", "PATCH", {
      method: role === "manager" ? "cod" : "bank",
      version: (await load(id)).version,
    });
  }
  await db.execute(
    "UPDATE store_memberships SET role='support' WHERE store_id=? AND user_id=?",
    [sid, supportId],
  );
  check(
    (await load(id)).payment_method === "bank",
    "Manager and admin may change planned payment method",
  );
  await owner(
    endpoint + "/payment-method",
    "PATCH",
    { method: "bank", version: (await load(id)).version },
    1,
    404,
  );
  await owner(
    endpoint + "/status",
    "PATCH",
    { status: "delivered", version: (await load(id)).version },
    1,
    404,
  );
  check(true, "Other store cannot mutate order");
  const beforeSkip = await events(id);
  await change("shipping");
  o = await load(id);
  check(
    o.status === "shipping" &&
      o.confirmed_at &&
      o.shipped_at &&
      !o.completed_at &&
      (await events(id)) === beforeSkip + 1 &&
      (await stock()) === initialStock - 2,
    "Skipping to shipping stamps reached stages and emits exactly one transition",
  );
  await change("pending", {}, 400);
  await change("pending", { reason: "Sửa nhầm trạng thái" });
  o = await load(id);
  check(
    !o.confirmed_at && !o.shipped_at && !o.completed_at,
    "Backward transition requires reason and clears later timestamps",
  );
  await change("delivered");
  o = await load(id);
  check(
    o.completed_at &&
      o.confirmed_at &&
      o.shipped_at &&
      o.payment_status === "partially_paid",
    "Skip to delivered preserves payment truth",
  );
  const v = o.version;
  const results = await Promise.all([
    owner(
      endpoint + "/status",
      "PATCH",
      { status: "cancelled", version: v, reason: "Khách thay đổi kế hoạch" },
      sid,
      [200, 409],
    ),
    owner(
      endpoint + "/status",
      "PATCH",
      { status: "cancelled", version: v, reason: "Khách thay đổi kế hoạch" },
      sid,
      [200, 409],
    ),
  ]);
  o = await load(id);
  check(
    results.filter((r) => r.status === 200).length === 1 &&
      (await stock()) === initialStock &&
      o.collected === 100000 &&
      !o.completed_at,
    "Concurrent cancellation after delivery restocks once and retains refund balance",
  );
  const cancelEvents = await events(id);
  await change("cancelled");
  check(
    (await stock()) === initialStock && (await events(id)) === cancelEvents,
    "Repeated cancelled target is a no-op",
  );
  await owner(
    endpoint + "/payment",
    "POST",
    { kind: "collect", amount: 1, reference: randomUUID() },
    sid,
    409,
  );
  await owner(endpoint + "/payment", "POST", {
    kind: "refund",
    amount: 100000,
    method: "cash",
    reference: randomUUID(),
  });
  check(
    (await load(id)).collected === 0,
    "Cancelled order accepts refund but rejects collection",
  );
  await change(
    "confirmed",
    {
      reason: "Khách đặt hoa trở lại",
      date: "2020-01-01",
      slot: settings.slots[0],
    },
    400,
  );
  await db.execute("UPDATE stores SET settings=? WHERE id=?", [
    JSON.stringify({ ...settings, capacity: 0 }),
    sid,
  ]);
  await change(
    "confirmed",
    { reason: "Khách đặt hoa trở lại", date, slot: settings.slots[0] },
    409,
  );
  await db.execute("UPDATE stores SET settings=? WHERE id=?", [
    JSON.stringify(settings),
    sid,
  ]);
  check(
    (await load(id)).status === "cancelled" && (await stock()) === initialStock,
    "Invalid date/full slot cannot restore or reserve stock",
  );
  await db.execute("UPDATE products SET stock=0 WHERE id=?", [pid]);
  const cancelledVersion = (await load(id)).version;
  await change(
    "confirmed",
    { reason: "Khách đặt hoa trở lại", date, slot: settings.slots[0] },
    409,
  );
  check(
    (await load(id)).version === cancelledVersion && (await stock()) === 0,
    "Insufficient stock rolls back restoration",
  );
  await db.execute("UPDATE products SET stock=? WHERE id=?", [
    initialStock,
    pid,
  ]);
  const restoreV = (await load(id)).version;
  const restored = await Promise.all([
    owner(
      endpoint + "/status",
      "PATCH",
      {
        status: "preparing",
        version: restoreV,
        reason: "Khách yêu cầu khôi phục",
        date,
        slot: settings.slots[0],
      },
      sid,
      [200, 409],
    ),
    owner(
      endpoint + "/status",
      "PATCH",
      {
        status: "preparing",
        version: restoreV,
        reason: "Khách yêu cầu khôi phục",
        date,
        slot: settings.slots[0],
      },
      sid,
      [200, 409],
    ),
  ]);
  check(
    restored.filter((r) => r.status === 200).length === 1 &&
      (await stock()) === initialStock - 2 &&
      (await load(id)).collected === 0,
    "Concurrent restoration re-reserves once and preserves refunded balance",
  );
  await owner(endpoint + "/payment", "POST", {
    kind: "collect",
    amount: 1000,
    method: "bank",
    reference: randomUUID(),
  });
  check(
    (await load(id)).collected === 1000,
    "Restored order can collect again",
  );
  await change("cancelled", { reason: "Kiểm thử lượt khuyến mãi" });
  const [promo] = await db.execute(
    "INSERT INTO promotions(store_id,code,name,type,value,min_order,usage_limit,used,starts_at,ends_at) VALUES(?,?,'Workflow QA','fixed',10000,0,1,1,NOW(),DATE_ADD(NOW(),INTERVAL 30 DAY))",
    [sid, "WF" + Date.now()],
  );
  await db.execute("UPDATE orders SET promotion_id=? WHERE id=?", [
    promo.insertId,
    id,
  ]);
  await change(
    "confirmed",
    { reason: "Khôi phục có khuyến mãi", date, slot: settings.slots[0] },
    409,
  );
  check(
    (await stock()) === initialStock && (await load(id)).status === "cancelled",
    "Exhausted promotion rolls back stock reservation",
  );
  await db.execute("UPDATE promotions SET used=0 WHERE id=?", [promo.insertId]);
  await change("confirmed", {
    reason: "Khôi phục có khuyến mãi",
    date,
    slot: settings.slots[0],
  });
  check(
    Number(
      (await one("SELECT used FROM promotions WHERE id=?", [promo.insertId]))
        .used,
    ) === 1 && (await stock()) === initialStock - 2,
    "Restore reserves promotion quota with stock",
  );
  await change("cancelled", { reason: "Hủy để kiểm tra khuyến mãi" });
  check(
    Number(
      (await one("SELECT used FROM promotions WHERE id=?", [promo.insertId]))
        .used,
    ) === 0,
    "Cancel releases promotion quota again",
  );
  await buyer("auth/register", "POST", {
    name: "Workflow Buyer",
    email: "workflow-buyer-" + Date.now() + "@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  const buyerId = (await buyer("auth/me")).data.user.id;
  await db.execute("UPDATE orders SET user_id=? WHERE id=?", [buyerId, id]);
  await change("confirmed", {
    reason: "Kiểm thử quyền khách",
    date,
    slot: settings.slots[0],
  });
  await buyer("orders/" + id + "/cancel", "POST", {}, sid, 403);
  await owner(endpoint + "/payment", "POST", {
    kind: "refund",
    amount: 1000,
    method: "bank",
    reference: randomUUID(),
  }, sid, 409);
  await owner(endpoint + "/payment-status", "PATCH", {
    totalCollected: 0,
    method: "bank",
    operation: "correction",
    version: (await load(id)).version,
    requestKey: randomUUID(),
    reason: "Sửa thanh toán nhầm để kiểm tra quyền hủy của khách",
  });
  await change("shipping");
  await buyer("orders/" + id + "/cancel", "POST", {}, sid, 400);
  await change("pending", { reason: "Kiểm thử khách tự hủy" });
  await buyer("orders/" + id + "/cancel", "POST", {});
  await buyer(
    endpoint + "/status",
    "PATCH",
    {
      status: "confirmed",
      version: (await load(id)).version,
      reason: "Khách không được khôi phục",
    },
    sid,
    403,
  );
  check(
    (await load(id)).status === "cancelled",
    "Customer cannot cancel paid/shipping orders or restore; unpaid pending cancellation still works",
  );
  const history = (await owner(endpoint + "/timeline")).data.events;
  check(
    history.some(
      (e) => e.status === "payment_method_changed" && e.detail.includes("→"),
    ) &&
      history.some(
        (e) => e.status === "cancelled" && e.detail.includes("Khách"),
      ),
    "Timeline records payment changes and transition reasons",
  );
  writeFileSync(
    ".local/order-workflow-fixture.json",
    JSON.stringify({ sid, id, date, slot: settings.slots[0] }),
  );
  console.log(`Order workflow: ${checks} checks passed`);
} finally {
  if (originalSettings)
    await db.execute("UPDATE stores SET settings=? WHERE id=?", [
      JSON.stringify(originalSettings),
      sid,
    ]);
  if (supportId)
    await db.execute(
      "UPDATE store_memberships SET role='support' WHERE store_id=? AND user_id=?",
      [sid, supportId],
    );
  await db.end();
}
