import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync(".local", { recursive: true });
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3006";
if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use isolated test DB on port 3310");
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
  dateStrings: true,
});
let checks = 0;
function check(value, label) {
  assert(value, label);
  checks++;
  console.log("PASS", label);
}
function client() {
  let jar = new Map();
  const call = async (
    path,
    method = "GET",
    body,
    store = "1",
    expected = 200,
  ) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: {
        origin: base,
        "content-type": "application/json",
        "x-fleur-store": String(store),
        cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    for (const h of r.headers.getSetCookie()) {
      const [k, v] = h.split(";")[0].split("=");
      jar.set(k, v);
    }
    const d = await r.json();
    assert(
      (Array.isArray(expected) ? expected : [expected]).includes(r.status),
      path + ": " + r.status + " " + JSON.stringify(d),
    );
    return { ...(Array.isArray(d) ? { items: d } : d), httpStatus: r.status };
  };
  call.jar = jar;
  return call;
}
try {
  await db.execute("DELETE FROM login_attempts");
  const owner = client(),
    support = client(),
    outsider = client();
  await owner("auth/login", "POST", {
    email: "owner@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  const me = await owner("auth/me"),
    stamp = Date.now();
  const store = await owner("stores", "POST", {
    name: "Manual QA " + stamp,
    slug: "manual-qa-" + stamp,
    address: "123 Đường Hoa, TP Hồ Chí Minh",
    phone: "0901234567",
  });
  const sid = store.id;
  const [[stored]] = await db.query("SELECT settings FROM stores WHERE id=?", [
    sid,
  ]);
  const settings =
    typeof stored.settings === "string"
      ? JSON.parse(stored.settings)
      : stored.settings;
  settings.lead_minutes = 0;
  settings.capacity = 100;
  await db.execute(
    "UPDATE stores SET status='approved',settings=? WHERE id=?",
    [JSON.stringify(settings), sid],
  );
  const [cat] = await db.execute(
    "INSERT INTO categories(store_id,name,slug) VALUES(?,'Hoa QA',?)",
    [sid, "manual-cat-" + stamp],
  );
  const [prod] = await db.execute(
    "INSERT INTO products(store_id,category_id,name,slug,price,stock,image,description,flowers,care) VALUES(?,?,?, ?,200000,100,'/images/roses.jpg','Hoa kiểm thử','Hồng','Nước sạch')",
    [sid, cat.insertId, "Bó hoa QA", "manual-product-" + stamp],
  );
  const pid = prod.insertId;
  const supportEmail = "manual-support-" + stamp + "@example.test";
  await support("auth/register", "POST", {
    name: "Support QA",
    email: supportEmail,
    password: "SaaS-Testing-2026-Only",
  });
  const sm = await support("auth/me");
  await db.execute(
    "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'support')",
    [sid, sm.user.id],
  );
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const input = (extra = {}) => ({
    customerName: "Khách thử nghiệm",
    email: "",
    phone: "09" + String(Date.now()).slice(-8),
    deliveryMode: "gift",
    recipientName: "Người nhận",
    recipientPhone: "0901112222",
    address: "123 Đường Hoa, Quận 1",
    deliveryDate: tomorrow,
    deliverySlot: settings.slots[0],
    salesChannel: "zalo",
    items: [{ type: "catalog", productId: pid, quantity: 1, size: "S" }],
    ...extra,
  });
  const quote = async (b, who = owner) =>
    who("workspace/manual-orders/quote", "POST", b, sid);
  const create = async (b, who = owner, extra = {}, expected = 200) => {
    const q = await quote(b, who);
    return who(
      "workspace/manual-orders",
      "POST",
      { ...b, idempotencyKey: randomUUID(), quoteToken: q.token, ...extra },
      sid,
      expected,
    );
  };
  const opts = await owner(
    "workspace/manual-orders/options",
    "GET",
    undefined,
    sid,
  );
  check(
    opts.capabilities.collect &&
      opts.staff.length === 2 &&
      opts.currentUserId === me.user.id,
    "Owner capabilities and staff scoped to store",
  );
  await outsider("workspace/manual-orders/options", "GET", undefined, sid, 401);
  await owner("workspace/manual-orders/options", "GET", undefined, 999999, 404);
  const ds = await owner(
    "workspace/order-drafts",
    "POST",
    { customerName: "Nháp chưa đủ" },
    sid,
  );
  const [[stock0]] = await db.query("SELECT stock FROM products WHERE id=?", [
    pid,
  ]);
  const [[draftOrderCount]] = await db.query(
    "SELECT COUNT(*) n FROM orders WHERE store_id=?",
    [sid],
  );
  check(
    stock0.stock === 100 && draftOrderCount.n === 0,
    "Incomplete draft does not affect stock or orders",
  );
  await owner(
    "workspace/order-drafts",
    "POST",
    { collectAmount: 1000 },
    sid,
    400,
  );
  check(true, "Draft cannot hold received money outside the payment ledger");
  await owner(
    "workspace/order-drafts/" + ds.id,
    "PATCH",
    { version: 99 },
    sid,
    409,
  );
  const updated = await owner(
    "workspace/order-drafts/" + ds.id,
    "PATCH",
    { version: ds.version, customerName: "Nháp cập nhật" },
    sid,
  );
  check(updated.version === 2, "Draft version prevents lost updates");
  await outsider("workspace/order-drafts/" + ds.id, "GET", undefined, sid, 401);
  const mixed = input({
    items: [
      { type: "catalog", productId: pid, quantity: 2, size: "M" },
      {
        type: "custom",
        name: "Bó hoa theo yêu cầu",
        quantity: 1,
        size: "S",
        price: 300000,
        description: "Tông trắng",
      },
    ],
    collectAmount: 300000,
    internalNotes: "NỘI BỘ KHÔNG CÔNG KHAI",
    initialStatus: "confirmed",
  });
  const q = await quote(mixed);
  check(
    q.subtotal === 820000 && q.total === 820000 && q.shipping === 0,
    "Manual order has no fixed delivery fee when shipping is omitted",
  );
  const key = randomUUID(),
    payload = { ...mixed, idempotencyKey: key, quoteToken: q.token };
  const order = await owner("workspace/manual-orders", "POST", payload, sid);
  const retry = await owner("workspace/manual-orders", "POST", payload, sid);
  check(order.id === retry.id, "Retry returns same order");
  await owner(
    "workspace/manual-orders",
    "POST",
    { ...payload, message: "Khác" },
    sid,
    409,
  );
  const details = await owner(
    "workspace/manual-orders/" + order.id,
    "GET",
    undefined,
    sid,
  );
  check(
    details.user_id === null && details.customer_id && details.email === null,
    "Phone-only customer is linked to CRM without claiming a user account",
  );
  check(
    details.assigned_to === me.user.id,
    "Manual order defaults assignee to the signed-in store member",
  );
  check(
    details.payment_status === "partially_paid" &&
      Number(details.collected) === 300000 &&
      details.status === "confirmed",
    "Deposit and fulfillment status stay independent",
  );
  const [[stock1]] = await db.query("SELECT stock FROM products WHERE id=?", [
    pid,
  ]);
  check(
    stock1.stock === 98,
    "Catalog stock deducted once, custom stock untracked",
  );
  const [[mails]] = await db.query(
    "SELECT COUNT(*) n FROM email_outbox WHERE order_id=?",
    [order.id],
  );
  check(
    mails.n === 0 && details.email_skip_reason,
    "Missing email is skipped with visible reason",
  );
  const crm = await owner("admin/crm", "GET", undefined, sid);
  check(
    crm.customers.find((c) => c.id === details.customer_id)?.order_count === 1,
    "CRM order counts use customer ID",
  );
  const board = await owner(
    "workspace/order-list?source=manual",
    "GET",
    undefined,
    sid,
  );
  check(
    board.columns
      .flatMap((c) => c.items)
      .some((o) => o.id === order.id && Number(o.collected) === 300000),
    "Board supports manual source and balance",
  );
  await owner(
    "workspace/orders/" + order.id + "/status",
    "PATCH",
    {
      status: "cancelled",
      version: details.version,
      reason: "Khách yêu cầu hủy đơn",
    },
    sid,
  );
  const [[stock2]] = await db.query("SELECT stock FROM products WHERE id=?", [
    pid,
  ]);
  check(stock2.stock === 100, "Cancellation restocks catalog only");
  await owner(
    "workspace/orders/" + order.id + "/payment",
    "POST",
    { kind: "collect", amount: 1, reference: "BAD-" + randomUUID() },
    sid,
    409,
  );
  await owner(
    "workspace/orders/" + order.id + "/payment",
    "POST",
    { kind: "refund", amount: 300001, reference: "OVER-" + randomUUID() },
    sid,
    409,
  );
  const refundRef = "REF-" + randomUUID();
  await owner(
    "workspace/orders/" + order.id + "/payment",
    "POST",
    { kind: "refund", amount: 300000, reference: refundRef },
    sid,
  );
  await owner(
    "workspace/orders/" + order.id + "/payment",
    "POST",
    { kind: "refund", amount: 300000, reference: refundRef },
    sid,
  );
  check(
    (await owner("workspace/manual-orders/" + order.id, "GET", undefined, sid))
      .payment_status === "refunded",
    "Refund uses shared idempotent ledger",
  );
  const supportInput = input();
  await support(
    "workspace/manual-orders/quote",
    "POST",
    { ...supportInput, shipping: 0 },
    sid,
    403,
  );
  await support(
    "workspace/manual-orders/quote",
    "POST",
    { ...supportInput, collectAmount: 100 },
    sid,
    403,
  );
  await support(
    "workspace/manual-orders/quote",
    "POST",
    { ...supportInput, initialStatus: "confirmed" },
    sid,
    403,
  );
  await support(
    "workspace/manual-orders/quote",
    "POST",
    {
      ...supportInput,
      items: [
        {
          type: "custom",
          name: "Miễn phí",
          price: 0,
          reason: "Không thu tiền",
          quantity: 1,
          size: "S",
        },
      ],
    },
    sid,
    403,
  );
  await create(supportInput, support);
  check(
    true,
    "Support creates unpaid pending order but cannot override, collect, confirm or give away items",
  );
  const another = await owner("workspace/order-drafts", "POST", input(), sid);
  await owner("workspace/order-drafts/" + another.id, "GET", undefined, 1, 404);
  await owner(
    "workspace/manual-orders/quote",
    "POST",
    {
      ...input(),
      items: [{ type: "catalog", productId: pid, quantity: 1, size: "S" }],
    },
    1,
    400,
  );
  await create(input({ customerId: details.customer_id }), owner, {}, 200);
  await create(input({ customerId: details.customer_id }), owner, {
    draftId: another.id,
    draftVersion: 1,
  });
  const converted = await owner(
    "workspace/order-drafts/" + another.id,
    "GET",
    undefined,
    sid,
  );
  check(
    converted.status === "converted" && converted.converted_order_id,
    "Draft converts exactly once",
  );
  await create(
    input({ customerId: details.customer_id }),
    owner,
    { draftId: another.id, draftVersion: 1 },
    409,
  );
  await create(
    input({ customerId: details.customer_id }),
    owner,
    { draftId: ds.id, draftVersion: 1 },
    409,
  );
  const reused = input({ phone: mixed.phone });
  await create(reused, owner, {}, 409);
  reused.separateContact = true;
  await create(reused);
  check(true, "Shared phone requires explicit choice; no automatic merge");
  const stale = input({ customerId: details.customer_id });
  const staleQuote = await quote(stale);
  await db.execute("UPDATE products SET price=price+1000 WHERE id=?", [pid]);
  await owner(
    "workspace/manual-orders",
    "POST",
    { ...stale, idempotencyKey: randomUUID(), quoteToken: staleQuote.token },
    sid,
    409,
  );
  check(true, "Server rejects stale quote after price changes");
  await quote(
    input({
      discountType: "percent",
      discountValue: 10,
      adjustmentReason: "Ưu đãi khách quen",
    }),
  );
  const optionalReason = input({
    customerId: details.customer_id,
    discountType: "amount",
    discountValue: 10000,
    shipping: 20000,
    adjustmentReason: "   ",
    collectMethod: "bank",
    paymentReference: "   ",
  });
  const optionalQuote = await quote(optionalReason);
  const optionalPayload = {
    ...optionalReason,
    collectAmount: optionalQuote.total,
    quoteToken: optionalQuote.token,
    idempotencyKey: randomUUID(),
  };
  const automaticBank = await owner(
    "workspace/manual-orders",
    "POST",
    optionalPayload,
    sid,
  );
  const sameBank = await owner(
    "workspace/manual-orders",
    "POST",
    optionalPayload,
    sid,
  );
  const [[automaticReceipt]] = await db.query(
    "SELECT o.reference,o.adjustment,o.payment_status,p.reference receipt,p.method,p.amount FROM orders o JOIN order_payments p ON p.order_id=o.id WHERE o.id=?",
    [automaticBank.id],
  );
  const optionalAdjustment =
    typeof automaticReceipt.adjustment === "string"
      ? JSON.parse(automaticReceipt.adjustment)
      : automaticReceipt.adjustment;
  check(
    optionalQuote.total === optionalQuote.subtotal - 10000 + 20000 &&
      optionalAdjustment.reason === "",
    "Discount and shipping override can be quoted and saved with an empty reason",
  );
  check(
    automaticReceipt.receipt === "BANK-" + automaticReceipt.reference &&
      automaticReceipt.method === "bank" &&
      Number(automaticReceipt.amount) === optionalQuote.total &&
      automaticReceipt.payment_status === "paid" &&
      sameBank.id === automaticBank.id,
    "Blank bank reference generates an internal receipt and retries reuse the order",
  );
  const shortReason = await quote(
    input({
      discountType: "percent",
      discountValue: 10,
      adjustmentReason: "VIP",
    }),
  );
  check(
    shortReason.discount === Math.round(shortReason.subtotal * 0.1),
    "Optional reason accepts short notes",
  );
  const suppliedReference = "BANK-EXTERNAL-" + randomUUID();
  const suppliedBank = await create(
    input({
      customerId: details.customer_id,
      collectAmount: 1000,
      collectMethod: "bank",
      paymentReference: suppliedReference,
    }),
  );
  const [[suppliedReceipt]] = await db.query(
    "SELECT reference FROM order_payments WHERE order_id=?",
    [suppliedBank.id],
  );
  check(
    suppliedReceipt.reference === suppliedReference,
    "A supplied bank reference is preserved",
  );
  const explicitZero = await quote(input({ shipping: 0 }));
  check(
    explicitZero.shipping === 0 && explicitZero.total === explicitZero.subtotal,
    "Explicit zero delivery fee stays zero",
  );
  const highSubtotal = await quote(
    input({
      shipping: 50000,
      items: [
        {
          type: "custom",
          name: "Hoa sự kiện",
          quantity: 1,
          size: "S",
          price: 2000000,
        },
      ],
    }),
  );
  check(
    highSubtotal.shipping === 50000 && highSubtotal.total === 2050000,
    "Entered fee applies even above the storefront free-shipping threshold",
  );
  const unassigned = await create(
    input({ customerId: details.customer_id, assignedTo: null }),
  );
  const reassigned = await create(
    input({ customerId: details.customer_id, assignedTo: sm.user.id }),
  );
  const [[unassignedRow]] = await db.query(
    "SELECT assigned_to FROM orders WHERE id=?",
    [unassigned.id],
  );
  const [[reassignedRow]] = await db.query(
    "SELECT assigned_to FROM orders WHERE id=?",
    [reassigned.id],
  );
  check(
    unassignedRow.assigned_to === null &&
      reassignedRow.assigned_to === sm.user.id,
    "Explicit unassigned and another store member are preserved",
  );
  await create(
    input({ customerId: details.customer_id, assignedTo: 999999 }),
    owner,
    {},
    400,
  );
  check(true, "Invalid assignee cannot be attached to the store order");
  const assignmentPath = "workspace/orders/" + reassigned.id + "/assignment";
  const assignmentInfo = await owner(assignmentPath, "GET", undefined, sid);
  check(
    assignmentInfo.assigned_to === sm.user.id &&
      assignmentInfo.assigned_name &&
      assignmentInfo.staff.length === 2 &&
      assignmentInfo.staff.every((s) =>
        [me.user.id, sm.user.id].includes(s.id),
      ),
    "Assignment details resolve the saved member name and list only current-store staff",
  );
  await owner(assignmentPath, "GET", undefined, 1, 404);
  check(true, "Assignment details cannot be read through a different store");
  await owner(
    assignmentPath,
    "PATCH",
    { assigned_to: 999999, tags: [], version: assignmentInfo.version },
    sid,
    400,
  );
  await owner(
    assignmentPath,
    "PATCH",
    {
      assigned_to: sm.user.id,
      tags: ["x".repeat(31)],
      version: assignmentInfo.version,
    },
    sid,
    400,
  );
  await owner(
    assignmentPath,
    "PATCH",
    {
      assigned_to: sm.user.id,
      tags: Array(7).fill("Nhãn"),
      version: assignmentInfo.version,
    },
    sid,
    400,
  );
  check(true, "Assignment edits validate staff membership and label limits");
  await owner(
    assignmentPath,
    "PATCH",
    {
      assigned_to: me.user.id,
      tags: [" Khách VIP ", "Giao gấp"],
      version: assignmentInfo.version,
    },
    sid,
  );
  const changedAssignment = await owner(assignmentPath, "GET", undefined, sid);
  check(
    changedAssignment.assigned_to === me.user.id &&
      (typeof changedAssignment.tags === "string"
        ? JSON.parse(changedAssignment.tags)
        : changedAssignment.tags
      ).join(",") === "Khách VIP,Giao gấp",
    "Assignment edit saves the selected member and normalized labels on the order",
  );
  await owner(
    assignmentPath,
    "PATCH",
    { assigned_to: null, tags: [], version: assignmentInfo.version },
    sid,
    409,
  );
  await owner(
    assignmentPath,
    "PATCH",
    { assigned_to: sm.user.id, tags: [], version: changedAssignment.version },
    sid,
  );
  await db.execute(
    "UPDATE store_memberships SET status='inactive' WHERE store_id=? AND user_id=?",
    [sid, sm.user.id],
  );
  try {
    const inactive = await owner(assignmentPath, "GET", undefined, sid);
    check(
      inactive.assigned_name &&
        inactive.assigned_to === sm.user.id &&
        !inactive.staff.some((s) => s.id === sm.user.id),
      "Inactive saved assignee retains a name but is excluded from active choices",
    );
    await owner(
      assignmentPath,
      "PATCH",
      {
        assigned_to: sm.user.id,
        tags: ["Theo dõi"],
        version: inactive.version,
      },
      sid,
    );
    const unassignedInfo = await owner(
      "workspace/orders/" + unassigned.id + "/assignment",
      "GET",
      undefined,
      sid,
    );
    await owner(
      "workspace/orders/" + unassigned.id + "/assignment",
      "PATCH",
      {
        assigned_to: sm.user.id,
        tags: [],
        version: unassignedInfo.version,
      },
      sid,
      400,
    );
    check(
      true,
      "Labels may retain an inactive assignee while new inactive assignments are rejected",
    );
  } finally {
    await db.execute(
      "UPDATE store_memberships SET status='active' WHERE store_id=? AND user_id=?",
      [sid, sm.user.id],
    );
  }
  await owner(
    "workspace/manual-orders/quote",
    "POST",
    input({
      discountType: "percent",
      discountValue: 101,
      adjustmentReason: "Sai phần trăm",
    }),
    sid,
    400,
  );
  await owner(
    "workspace/manual-orders/quote",
    "POST",
    input({ code: "PROMO", discountType: "amount", discountValue: 10 }),
    sid,
    400,
  );
  await create(input({ deliveryDate: "2026-02-30" }), owner, {}, 400);
  await create(input({ deliveryDate: "2020-01-01" }), owner, {}, 400);
  await create(input({ deliverySlot: "01:00–02:00" }), owner, {}, 409);
  check(true, "Discount and fulfillment rules validated on server");
  const lastDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + settings.advance_days * 86400000));
  await create(
    input({ customerId: details.customer_id, deliveryDate: lastDay }),
  );
  check(
    true,
    "Last allowed delivery date remains bookable regardless of time of day",
  );
  await db.execute(
    "UPDATE stores SET lat=10.77,lng=106.7,radius_km=5 WHERE id=?",
    [sid],
  );
  await create(input(), owner, {}, 400);
  await create(input({ deliveryLat: 0, deliveryLng: 0 }), owner, {}, 409);
  await create(input({ deliveryLat: 10.77, deliveryLng: 106.7 }));
  check(true, "Delivery radius requires coordinates and rejects outside area");
  await db.execute("UPDATE stores SET lat=NULL,lng=NULL WHERE id=?", [sid]);
  // Race for the last item. Independent clients hit the same locked store/products.
  await db.execute("UPDATE products SET stock=1 WHERE id=?", [pid]);
  const race1 = input({ customerId: details.customer_id }),
    race2 = input({ customerId: details.customer_id });
  const [rq1, rq2] = await Promise.all([quote(race1), quote(race2)]);
  const rr = await Promise.all([
    owner(
      "workspace/manual-orders",
      "POST",
      { ...race1, idempotencyKey: randomUUID(), quoteToken: rq1.token },
      sid,
      [200, 409],
    ),
    owner(
      "workspace/manual-orders",
      "POST",
      { ...race2, idempotencyKey: randomUUID(), quoteToken: rq2.token },
      sid,
      [200, 409],
    ),
  ]);
  check(
    rr.filter((r) => r.httpStatus === 200).length === 1,
    "Concurrent orders cannot oversell last product",
  );
  await db.execute("UPDATE products SET stock=50 WHERE id=?", [pid]);
  const differentDay = new Date(Date.now() + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  settings.capacity = 1;
  await db.execute("UPDATE stores SET settings=? WHERE id=?", [
    JSON.stringify(settings),
    sid,
  ]);
  const slots = [
    input({ customerId: details.customer_id, deliveryDate: differentDay }),
    input({ customerId: details.customer_id, deliveryDate: differentDay }),
  ];
  const sq = await Promise.all(slots.map((b) => quote(b)));
  const sr = await Promise.all(
    slots.map((b, n) =>
      owner(
        "workspace/manual-orders",
        "POST",
        { ...b, idempotencyKey: randomUUID(), quoteToken: sq[n].token },
        sid,
        [200, 409],
      ),
    ),
  );
  check(
    sr.filter((r) => r.httpStatus === 200).length === 1,
    "Concurrent orders cannot overbook last delivery slot",
  );
  settings.capacity = 100;
  await db.execute("UPDATE stores SET settings=? WHERE id=?", [
    JSON.stringify(settings),
    sid,
  ]);
  const mailInput = input({
    email: "manual-" + stamp + "@example.test",
    deliveryMode: "self",
    message: "Lời nhắn cho tôi",
  });
  const mailOrder = await create(mailInput);
  const md = await owner(
    "workspace/manual-orders/" + mailOrder.id,
    "GET",
    undefined,
    sid,
  );
  check(
    md.recipient_name === mailInput.customerName &&
      md.recipient_phone === mailInput.phone,
    "Self delivery uses buyer details",
  );
  const [[confirmation]] = await db.query(
    "SELECT COUNT(*) n FROM email_outbox WHERE order_id=? AND template_key='order_confirmation'",
    [mailOrder.id],
  );
  check(confirmation.n === 1, "One confirmation queued after finalization");
  const [[consent]] = await db.query(
    "SELECT marketing_consent FROM customers WHERE id=?",
    [md.customer_id],
  );
  check(
    consent.marketing_consent === 0,
    "Manual order never grants marketing consent",
  );
  // An invalid supplied reference still fails after inserts and rolls everything back.
  const before = await db.query(
    "SELECT COUNT(*) n FROM orders WHERE store_id=?",
    [sid],
  );
  await create(
    input({
      collectAmount: 1000,
      collectMethod: "bank",
      paymentReference: "abc",
    }),
    owner,
    {},
    400,
  );
  const after = await db.query(
    "SELECT COUNT(*) n FROM orders WHERE store_id=?",
    [sid],
  );
  check(
    before[0][0].n === after[0][0].n,
    "Failed initial collection rolls back order transaction",
  );
  const analytics = await owner("workspace/analytics", "GET", undefined, sid);
  check(
    analytics.sources.some((s) => s.creation_source === "manual"),
    "Analytics breaks down manual orders by channel",
  );
  const batch = Array.from({ length: 6 }, (_, n) =>
    input({
      customerId: details.customer_id,
      email: `parallel-${stamp}-${n}@example.test`,
    }),
  );
  const batchQuotes = await Promise.all(batch.map((b) => quote(b)));
  const batchOrders = await Promise.all(
    batch.map((b, n) =>
      owner(
        "workspace/manual-orders",
        "POST",
        {
          ...b,
          idempotencyKey: randomUUID(),
          quoteToken: batchQuotes[n].token,
        },
        sid,
      ),
    ),
  );
  check(
    new Set(batchOrders.map((o) => o.id)).size === 6,
    "Concurrent emailed orders complete beyond the DB connection pool size",
  );
  // A typed email never claims an account or creates a marketing preference.
  const typed = await create(input({ email: supportEmail }));
  check(
    (await owner("workspace/manual-orders/" + typed.id, "GET", undefined, sid))
      .user_id === null,
    "Typed user email cannot claim that user's history",
  );
  const customOnly = input({
    customerId: details.customer_id,
    items: [
      {
        type: "custom",
        name: "Cross-store test",
        price: 100000,
        quantity: 1,
        size: "S",
      },
    ],
  });
  const foreignQuote = await owner(
    "workspace/manual-orders/quote",
    "POST",
    customOnly,
    1,
  );
  await owner(
    "workspace/manual-orders",
    "POST",
    {
      ...customOnly,
      idempotencyKey: randomUUID(),
      quoteToken: foreignQuote.token,
    },
    1,
    404,
  );
  check(true, "Foreign customer ID cannot attach to another store order");
  // Ghost uses the support member's capabilities while retaining actual actor audit.
  await db.execute(
    "INSERT IGNORE INTO platform_memberships(user_id) VALUES(?)",
    [me.user.id],
  );
  await owner("platform/users/" + sm.user.id + "/ghost", "POST", {
    reason: "Kiểm thử tạo đơn thủ công trong store",
  });
  const ghostOptions = await owner(
    "workspace/manual-orders/options",
    "GET",
    undefined,
    sid,
  );
  check(
    ghostOptions.currentUserId === sm.user.id,
    "Ghost default assignee resolves to the supported store member",
  );
  const ghostInput = input({ customerId: details.customer_id });
  const ghostOrder = await create(ghostInput, owner);
  const [[ghostRow]] = await db.query(
    "SELECT created_by,assigned_to,adjustment FROM orders WHERE id=?",
    [ghostOrder.id],
  );
  const adjustment =
    typeof ghostRow.adjustment === "string"
      ? JSON.parse(ghostRow.adjustment)
      : ghostRow.adjustment;
  check(
    ghostRow.created_by === sm.user.id &&
      ghostRow.assigned_to === sm.user.id &&
      adjustment.ghost.actorId === me.user.id &&
      adjustment.ghost.targetId === sm.user.id &&
      adjustment.ghost.sessionHash,
    "Ghost preserves both identities on committed order",
  );
  await owner(
    "workspace/manual-orders/quote",
    "POST",
    { ...ghostInput, collectAmount: 1 },
    sid,
    403,
  );
  const ghostQuote = await quote(ghostInput);
  await db.execute(
    "UPDATE ghost_sessions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE actor_id=? AND target_id=? AND ended_at IS NULL",
    [me.user.id, sm.user.id],
  );
  await owner(
    "workspace/manual-orders",
    "POST",
    {
      ...ghostInput,
      idempotencyKey: randomUUID(),
      quoteToken: ghostQuote.token,
    },
    sid,
    403,
  );
  await owner("auth/ghost/stop", "POST", {});
  check(true, "Expired Ghost cannot finalize or regain platform privileges");
  const archive = await owner("workspace/order-drafts", "POST", {}, sid);
  await owner(
    "workspace/order-drafts/" + archive.id + "/archive",
    "POST",
    { version: 1 },
    sid,
  );
  check(
    !(await owner("workspace/order-drafts", "GET", undefined, sid)).items.some(
      (d) => d.id === archive.id,
    ),
    "Archived drafts leave active list",
  );
  writeFileSync(
    ".local/manual-test-fixture.json",
    JSON.stringify({
      sid,
      pid,
      supportEmail,
      tomorrow,
      slot: settings.slots[0],
      orderId: mailOrder.id,
      draftId: ds.id,
    }),
  );
  console.log(`Manual order API checks passed: ${checks}`);
} finally {
  await db.end();
}
