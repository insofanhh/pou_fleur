import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3004";
if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use the isolated SaaS test database on port 3310");
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
  dateStrings: true,
});
let passed = 0;
function check(ok, message) {
  assert(ok, message);
  passed++;
  console.log("PASS", message);
}
async function client() {
  let cookie = "";
  return async (path, method = "GET", body, store = "1", expected = 200) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: {
        origin: base,
        "content-type": "application/json",
        "x-fleur-store": String(store),
        cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie")) {
      const jar = new Map(
        cookie
          .split("; ")
          .filter(Boolean)
          .map((s) => s.split("=")),
      );
      for (const h of r.headers.getSetCookie()) {
        const [k, v] = h.split(";")[0].split("=");
        jar.set(k, v);
      }
      cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
    }
    const d = await r.json();
    assert(
      Array.isArray(expected)
        ? expected.includes(r.status)
        : r.status === expected,
      path + ": " + r.status + " " + JSON.stringify(d),
    );
    return (
      {
        ...(Array.isArray(d) ? { array: d } : d),
        ...(Array.isArray(expected) ? { httpStatus: r.status } : {}),
      }?.array || {
        ...d,
        ...(Array.isArray(expected) ? { httpStatus: r.status } : {}),
      }
    );
  };
}
try {
  await db.execute("DELETE FROM login_attempts");
  const admin = await client(),
    owner = await client(),
    buyer = await client(),
    anon = await client();
  await admin("auth/login", "POST", {
    email: "owner@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  const me = await admin("auth/me");
  check(me.user.role === "owner", "Legacy admin migrated to store owner");
  await db.execute(
    "INSERT IGNORE INTO platform_memberships(user_id) VALUES(?)",
    [me.user.id],
  );
  await owner("auth/register", "POST", {
    name: "Store Two Owner",
    email: "second-" + Date.now() + "@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  const store = await owner("stores", "POST", {
    name: "Tiệm Hai Test",
    slug: "test-" + Date.now(),
    address: "123 Đường Hoa, Quận 1, TP Hồ Chí Minh",
    phone: "0901234567",
  });
  const sid = store.id;
  let settings = await owner("workspace/settings", "GET", undefined, sid);
  check(settings.status === "draft", "New store starts draft");
  await anon("store", "GET", undefined, sid, 404);
  await owner("workspace/submit", "POST", {}, sid, 400);
  await owner(
    "workspace/settings",
    "PATCH",
    {
      ...settings,
      lat: 10.77,
      lng: 106.7,
      settings: { ...settings.settings, lead_minutes: 0, capacity: 2 },
    },
    sid,
  );
  await owner("workspace/submit", "POST", {}, sid);
  settings = await owner("workspace/settings", "GET", undefined, sid);
  await owner("platform/overview", "GET", undefined, sid, 403);
  await admin("platform/stores/" + sid + "/status", "PATCH", {
    status: "approved",
    reason: "Đủ điều kiện kiểm thử",
    version: settings.version,
  });
  check(
    (await anon("store", "GET", undefined, sid)).status === "approved",
    "Platform approval publishes store",
  );
  await owner("admin/overview", "GET", undefined, 1, 403);
  await admin("admin/orders", "GET", undefined, sid, 403);
  check(true, "Store owner cannot read another store admin data");
  const cat = await owner(
    "admin/categories",
    "POST",
    { name: "Danh mục hai", slug: "everyday", description: "Mô tả" },
    sid,
  );
  const productBody = {
    name: "Hoa kiểm thử",
    slug: "hoa-test",
    category_id: cat.id,
    price: 350000,
    compare_price: null,
    stock: 30,
    image: "/images/hero.jpg",
    gallery: [],
    description: "Thiết kế hoa dành riêng kiểm thử",
    flowers: "Hoa hồng",
    care: "Thay nước mỗi ngày.",
    badge: "",
    active: 1,
  };
  const prod = await owner("admin/products", "POST", productBody, sid);
  check(
    (await anon("catalog/products", "GET", undefined, sid)).some(
      (p) => p.id === prod.id,
    ),
    "Catalog scoped to requested store",
  );
  check(
    !(await anon("catalog/products")).some((p) => p.id === prod.id),
    "Catalog does not leak store two into legacy store",
  );
  await admin(
    "admin/products/" + prod.id,
    "PATCH",
    { ...productBody, name: "Cross store attempt" },
    1,
    400,
  );
  const items = [{ productId: prod.id, quantity: 1, size: "S" }];
  await anon("checkout/quote", "POST", { items }, 1, 400);
  await buyer("auth/register", "POST", {
    name: "Buyer Test",
    email: "buyer-" + Date.now() + "@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  const buyerMe = await buyer("auth/me");
  const tomorrow = new Date(Date.now() + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  const orderBody = {
    items,
    customerName: "Buyer Test",
    email: buyerMe.user.email,
    phone: "0901234567",
    address: "123 Đường Hoa, Quận 1, TP Hồ Chí Minh",
    recipientName: "Người nhận",
    recipientPhone: "0901234567",
    deliveryDate: tomorrow,
    deliverySlot: "09:00–12:00",
    message: "Chúc một ngày tốt lành",
    notes: "",
    paymentMethod: "cod",
    consent: false,
    idempotencyKey: randomUUID(),
  };
  const first = await buyer("checkout", "POST", orderBody, sid);
  const retry = await buyer("checkout", "POST", orderBody, sid);
  check(
    first.reference === retry.reference,
    "Checkout idempotency returns same order",
  );
  const parallel = await Promise.all([
    buyer(
      "checkout",
      "POST",
      { ...orderBody, idempotencyKey: randomUUID() },
      sid,
      [200, 409],
    ),
    buyer(
      "checkout",
      "POST",
      { ...orderBody, idempotencyKey: randomUUID() },
      sid,
      [200, 409],
    ),
  ]);
  check(
    parallel
      .map((r) => r.httpStatus)
      .sort()
      .join(",") === "200,409",
    "Concurrent slot booking cannot exceed capacity",
  );
  let orders = await owner("admin/orders", "GET", undefined, sid),
    o = orders.find((o) => o.reference === first.reference);
  const board = await owner(
    "workspace/order-list?limit=1",
    "GET",
    undefined,
    sid,
  );
  const firstPage = board.columns.find((c) => c.status === "pending");
  const nextPage = (
    await owner(
      "workspace/order-list?limit=1&page_pending=2",
      "GET",
      undefined,
      sid,
    )
  ).columns.find((c) => c.status === "pending");
  check(
    firstPage.total === 2 &&
      firstPage.items.length === 1 &&
      nextPage.items.length === 1 &&
      firstPage.items[0].id !== nextPage.items[0].id,
    "Kanban paginates each status without losing orders",
  );
  const table = await owner(
    "workspace/order-list?mode=table&limit=1&page=2",
    "GET",
    undefined,
    sid,
  );
  check(
    table.total === 2 && table.items.length === 1 && table.page === 2,
    "Order table uses server pagination",
  );
  await admin("workspace/order-list", "GET", undefined, sid, 403);
  const closeSettings = await owner(
    "workspace/settings",
    "GET",
    undefined,
    sid,
  );
  await admin(
    "platform/stores/" + sid + "/status",
    "PATCH",
    {
      status: "closed",
      reason: "Kiểm thử đóng cửa hàng",
      version: closeSettings.version,
    },
    1,
    409,
  );
  check(
    (await owner("workspace/settings", "GET", undefined, sid)).status ===
      "approved",
    "Closing a store with unfinished orders is rejected without changing its state",
  );
  const hiddenCart = await anon("stores/cart-info?slugs=" + store.slug);
  check(
    hiddenCart.length === 1 && hiddenCart[0].name === "Tiệm Hai Test",
    "Global cart resolves only published store profiles",
  );
  check(
    o && o.store_name === "Tiệm Hai Test",
    "Order stores merchant snapshot",
  );
  await owner(
    "workspace/orders/" + o.id + "/reschedule",
    "PATCH",
    {
      date: tomorrow,
      slot: "12:00–15:00",
      reason: "Khách yêu cầu đổi giờ",
      version: o.version,
    },
    sid,
  );
  o = (await owner("admin/orders", "GET", undefined, sid)).find(
    (x) => x.id === o.id,
  );
  check(
    o.delivery_slot === "12:00–15:00",
    "Reschedule validates and updates order version",
  );
  await owner(
    "workspace/orders/" + o.id + "/reschedule",
    "PATCH",
    {
      date: tomorrow,
      slot: "09:00–12:00",
      reason: "Khôi phục lịch để kiểm thử",
      version: o.version,
    },
    sid,
  );
  o = (await owner("admin/orders", "GET", undefined, sid)).find(
    (x) => x.id === o.id,
  );
  await owner(
    "workspace/orders/" + o.id + "/status",
    "PATCH",
    { status: "preparing", version: o.version },
    sid,
    400,
  );
  await owner(
    "workspace/orders/" + o.id + "/status",
    "PATCH",
    { status: "confirmed", version: o.version },
    sid,
  );
  await owner(
    "workspace/orders/" + o.id + "/status",
    "PATCH",
    { status: "preparing", version: o.version },
    sid,
    409,
  );
  for (const status of ["preparing", "ready", "shipping", "delivered"]) {
    o = (await owner("admin/orders", "GET", undefined, sid)).find(
      (x) => x.id === o.id,
    );
    await owner(
      "workspace/orders/" + o.id + "/status",
      "PATCH",
      { status, version: o.version },
      sid,
    );
  }
  o = (await owner("admin/orders", "GET", undefined, sid)).find(
    (x) => x.id === o.id,
  );
  check(
    o.payment_status === "unpaid",
    "Delivery does not silently mark payment paid",
  );
  check(
    (await buyer("orders")).some(
      (x) => x.id === o.id && x.store_slug === store.slug,
    ),
    "Buyer history includes orders across stores",
  );
  const reorder = await buyer("orders/" + o.id + "/reorder", "POST", {});
  check(
    reorder.store.id === sid && reorder.items[0].productId === prod.id,
    "Reorder uses original store and current quote",
  );
  await owner(
    "workspace/orders/" + o.id + "/payment",
    "POST",
    { amount: o.total, kind: "collect", reference: "pay-" + randomUUID() },
    sid,
  );
  check(
    (await owner("admin/orders", "GET", undefined, sid)).find(
      (x) => x.id === o.id,
    ).payment_status === "paid",
    "Explicit collection marks payment paid",
  );
  await owner(
    "workspace/calendar/notes",
    "POST",
    {
      title: "Chuẩn bị sự kiện",
      content: "Kiểm thử",
      day: tomorrow,
      color: "#555555",
    },
    sid,
  );
  const calendar = await owner(
    "workspace/calendar?from=" + tomorrow + "&to=" + tomorrow,
    "GET",
    undefined,
    sid,
  );
  check(
    calendar.orders.length === 2 && calendar.notes.length === 1,
    "Calendar returns scoped orders and notes",
  );
  const analytics = await owner("workspace/analytics", "GET", undefined, sid);
  check(analytics.daily.length > 0, "Store analytics calculate actual orders");
  const theme = {
    template: "garden",
    accent: "#292929",
    background: "#f5f5f5",
    font: "serif",
    hero: "Hoa của riêng bạn",
    story: "Câu chuyện cửa hàng hai",
  };
  const s = await owner("workspace/settings", "GET", undefined, sid);
  await owner(
    "workspace/theme/publish",
    "POST",
    { theme, version: s.version },
    sid,
  );
  check(
    (await anon("store", "GET", undefined, sid)).theme.template === "garden",
    "Publishing changes only store theme",
  );
  check(
    (await anon("store")).theme.template === "minimal",
    "Other store theme remains unchanged",
  );
  const inv = await owner(
    "workspace/team/invite",
    "POST",
    { email: buyerMe.user.email, role: "support" },
    sid,
  );
  await admin(
    "invitations/accept",
    "POST",
    { token: new URL("http://test" + inv.url).searchParams.get("token") },
    1,
    403,
  );
  await buyer("invitations/accept", "POST", {
    token: new URL("http://test" + inv.url).searchParams.get("token"),
  });
  check(
    (await buyer("auth/me", "GET", undefined, sid)).user.role === "support",
    "Accepted invitation creates per-store role",
  );
  await buyer("workspace/settings", "GET", undefined, sid, 403);
  await buyer(
    "admin/users/" + me.user.id + "/reset-password",
    "POST",
    {},
    sid,
    403,
  );
  check(
    true,
    "Support cannot edit store settings or reset global user password",
  );
  const sub = (await owner("workspace/billing", "GET", undefined, sid))
    .subscription;
  await admin("platform/stores/" + sid + "/subscription", "PATCH", {
    plan_id: 2,
    status: "active",
    period_end: tomorrow,
    version: sub.version,
  });
  const period = new Date().toISOString().slice(0, 7);
  await admin("platform/invoices/generate", "POST", {
    period,
    due_date: tomorrow,
  });
  await admin("platform/invoices/generate", "POST", {
    period,
    due_date: tomorrow,
  });
  const invoices = (await owner("workspace/billing", "GET", undefined, sid))
    .invoices;
  check(invoices.length === 1, "Monthly invoice generation is idempotent");
  await db.execute(
    "UPDATE subscriptions SET status='restricted' WHERE store_id=?",
    [sid],
  );
  const pay = {
    // The fixture simulates a subscription restricted by an overdue invoice.
    amount: invoices[0].amount,
    reference: "invoice-" + randomUUID(),
  };
  await db.execute(
    "UPDATE invoices SET due_date=DATE_SUB(CURDATE(),INTERVAL 1 DAY) WHERE id=?",
    [invoices[0].id],
  );
  await admin("platform/invoices/" + invoices[0].id + "/payment", "POST", pay);
  await admin("platform/invoices/" + invoices[0].id + "/payment", "POST", pay);
  check(
    (await owner("workspace/billing", "GET", undefined, sid)).invoices[0]
      .paid === pay.amount,
    "Invoice payment idempotency avoids double collection",
  );
  check(
    (await owner("workspace/billing", "GET", undefined, sid)).subscription
      .status === "active",
    "Settling overdue invoices restores store subscription",
  );
  await admin(
    "platform/invoices/" + invoices[0].id + "/void",
    "POST",
    { reason: "Không thể hủy hóa đơn đã thu" },
    1,
    409,
  );
  const [voidFixture] = await db.execute(
    "INSERT INTO invoices(store_id,period_key,plan_name,amount,due_date) VALUES(?,?,'Test void',100000,?)",
    [sid, "void-" + randomUUID().slice(0, 12), tomorrow],
  );
  await admin("platform/invoices/" + voidFixture.insertId + "/void", "POST", {
    reason: "Hủy bản hóa đơn kiểm thử",
  });
  await admin("platform/invoices/" + voidFixture.insertId + "/void", "POST", {
    reason: "Hủy bản hóa đơn kiểm thử",
  });
  check(
    (await owner("workspace/billing", "GET", undefined, sid)).invoices.find(
      (i) => i.id === voidFixture.insertId,
    ).status === "void",
    "Unpaid invoice can be voided idempotently",
  );
  await admin(
    "platform/invoices/" + voidFixture.insertId + "/payment",
    "POST",
    { amount: 100000, reference: "void-payment-" + randomUUID() },
    1,
    409,
  );
  const partialReference = "partial-" + randomUUID();
  await owner(
    "workspace/orders/" + o.id + "/payment",
    "POST",
    { kind: "refund", amount: 1000, reference: partialReference },
    sid,
  );
  check(
    (await owner("admin/orders", "GET", undefined, sid)).find(
      (x) => x.id === o.id,
    ).payment_status === "partially_refunded",
    "Partial refund is tracked separately from delivery",
  );
  await owner(
    "workspace/orders/" + o.id + "/payment",
    "POST",
    { kind: "refund", amount: 1000, reference: partialReference },
    sid,
  );
  await owner(
    "workspace/orders/" + o.id + "/payment",
    "POST",
    { kind: "refund", amount: 2000, reference: partialReference },
    sid,
    409,
  );
  check(true, "Payment references reject altered retry payload");
  const worker = await fetch(base + "/api/email/worker");
  check(
    worker.status === 401,
    "Background worker rejects unauthenticated calls",
  );
  const emails = await owner("admin/emails", "GET", undefined, sid);
  check(!!emails, "Scoped email workspace loads");
  await new Promise((r) => setTimeout(r, 1000));
  const inbox = await buyer("inbox");
  check(
    inbox.some((i) => i.title.includes(first.reference)),
    "Order status events reach buyer inbox",
  );
  await buyer(
    "notification-preferences",
    "PATCH",
    { marketing: false, push: false },
    sid,
  );
  check(
    !(await buyer("notification-preferences", "GET", undefined, sid)).marketing,
    "Per-store notification preferences persist",
  );
  const broadcastBody = {
    key: randomUUID(),
    title: "Bộ sưu tập mới",
    message: "Những thiết kế hoa mới dành cho bạn.",
  };
  check(
    (await owner("workspace/broadcasts", "POST", broadcastBody, sid)).queued ===
      0,
    "Store broadcast excludes customers without marketing consent",
  );
  await buyer(
    "notification-preferences",
    "PATCH",
    { marketing: true, push: false },
    sid,
  );
  const sentBroadcast = await owner(
    "workspace/broadcasts",
    "POST",
    { ...broadcastBody, key: randomUUID() },
    sid,
  );
  check(
    sentBroadcast.queued === 1,
    "Store broadcast targets consenting purchasers only",
  );
  check(
    (
      await owner(
        "workspace/broadcasts",
        "POST",
        { ...broadcastBody, key: randomUUID() },
        sid,
      )
    ).queued === 0,
    "Broadcast frequency cap prevents repeated marketing notifications",
  );
  await buyer(
    "workspace/broadcasts",
    "POST",
    { ...broadcastBody, key: randomUUID() },
    sid,
    403,
  );
  await buyer(
    "notification-preferences",
    "PATCH",
    { marketing: false, push: false },
    sid,
  );
  for (const page of [
    "/cart",
    "/",
    "/s/fleur",
    "/s/" + store.slug,
    "/s/" + store.slug + "/shop",
    "/s/" + store.slug + "/product/hoa-test",
    "/workspace/" + sid,
    "/workspace/" + sid + "/board",
    "/workspace/" + sid + "/calendar",
    "/platform",
    "/inbox",
    "/manifest.webmanifest",
    "/sw.js",
  ]) {
    const r = await fetch(base + page);
    check(r.status === 200, "Render " + page);
  }
  const staffEvent = "revocation-" + randomUUID();
  await db.execute(
    "INSERT INTO notifications(store_id,user_id,event_key,title,href) VALUES(?,?,?,?,?)",
    [
      sid,
      buyerMe.user.id,
      staffEvent,
      staffEvent,
      "/workspace/" + sid + "/board",
    ],
  );
  check(
    (await buyer("inbox")).some((n) => n.title === staffEvent),
    "Active member receives workspace inbox messages",
  );
  await db.execute(
    "UPDATE store_memberships SET status='revoked' WHERE store_id=? AND user_id=?",
    [sid, buyerMe.user.id],
  );
  check(
    !(await buyer("inbox")).some((n) => n.title === staffEvent),
    "Revoked membership immediately loses workspace inbox access",
  );
  await buyer("workspace/order-list", "GET", undefined, sid, 403);
  await db.execute(
    "UPDATE store_memberships SET status='active' WHERE store_id=? AND user_id=?",
    [sid, buyerMe.user.id],
  );
  const pending = (await buyer("orders")).find((x) => x.status === "pending");
  if (pending) {
    await buyer("orders/" + pending.id + "/cancel", "POST", {});
    check(
      (await buyer("orders")).find((x) => x.id === pending.id).status ===
        "cancelled",
      "Buyer cancels own order across store contexts",
    );
  }
  await buyer("auth/forgot-password", "POST", { email: buyerMe.user.email });
  const [[resetMail]] = await db.execute(
    "SELECT body FROM identity_mail WHERE recipient=? ORDER BY id DESC LIMIT 1",
    [buyerMe.user.email],
  );
  check(
    resetMail?.body.includes("reset-password?token="),
    "Recovery is queued in private identity mailbox",
  );
  const resetToken = resetMail.body.match(/token=([a-f0-9]{64})/)[1];
  await buyer("auth/reset-password", "POST", {
    token: resetToken,
    password: "SaaS-Testing-2026-Only",
  });
  await buyer(
    "auth/reset-password",
    "POST",
    { token: resetToken, password: "SaaS-Testing-2026-Only" },
    1,
    400,
  );
  check(
    (await buyer("auth/me")).user === null,
    "Password reset invalidates sessions and token is single use",
  );
  await owner("admin/emails/message/" + -1, "POST", {}, sid, 400);
  console.log(
    `SaaS integration: ${passed} assertions passed. Fixture store: ${sid} (${store.slug})`,
  );
} finally {
  await db.end();
}
