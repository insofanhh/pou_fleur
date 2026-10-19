import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";

// Called only by the disposable database harness; no real orders or emails.
export async function testOrderPaymentStatus({
  owner,
  admin,
  untouched,
  buyer,
  first,
  second,
  db,
  one,
  check,
  pageFor,
  origin,
}) {
  const sid = first.id;
  const options = await owner.call(
    "workspace/manual-orders/options",
    "GET",
    undefined,
    200,
    sid,
  );
  const input = {
    customerName: "Khách thanh toán QA",
    phone: "0909988776",
    email: "",
    deliveryMode: "self",
    address: "123 Đường Hoa, Quận 1",
    deliveryDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    deliverySlot: options.settings.slots[0],
    shipping: 0,
    items: [
      {
        type: "custom",
        name: "Bó hoa thanh toán QA",
        price: 1000000,
        quantity: 1,
      },
    ],
  };
  const quote = await owner.call(
    "workspace/manual-orders/quote",
    "POST",
    input,
    200,
    sid,
  );
  const order = await owner.call(
    "workspace/manual-orders",
    "POST",
    { ...input, quoteToken: quote.token, idempotencyKey: randomUUID() },
    200,
    sid,
  );
  const endpoint = `workspace/orders/${order.id}/payment-status`;
  const row = () => one("SELECT * FROM orders WHERE id=?", [order.id]);
  const ledger = () =>
    one(
      "SELECT COUNT(*) n,COALESCE(SUM(IF(kind='collect',amount,-amount)),0) balance FROM order_payments WHERE order_id=?",
      [order.id],
    );
  const update = async (amount, expected = 200, extra = {}) =>
    owner.call(
      endpoint,
      "PATCH",
      {
        totalCollected: amount,
        method: "cash",
        version: (await row()).version,
        requestKey: randomUUID(),
        ...extra,
      },
      expected,
      sid,
    );
  check(
    (await row()).payment_status === "unpaid" &&
      Number((await ledger()).balance) === 0,
    "Manual order starts unpaid with zero received",
  );
  await buyer.call(endpoint, "PATCH", {}, 403, sid);
  await untouched.call(
    endpoint,
    "PATCH",
    { totalCollected: 1, method: "cash", version: 1, requestKey: randomUUID() },
    404,
    second.id,
  );
  const buyerId = (
    await one("SELECT id FROM users WHERE email='buyer@example.test'")
  ).id;
  await db.execute(
    "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'manager')",
    [sid, buyerId],
  );
  await buyer.call(endpoint, "PATCH", {}, 403, sid);
  check(
    true,
    "Payment editing rejects customers, non-owner staff and orders from another store",
  );

  const page = await pageFor(owner);
  await page.goto(`${origin}/workspace/${sid}/board?order=${order.id}`);
  const dialog = page.getByRole("dialog");
  const editor = dialog.locator(".order-payment-editor");
  const amount = editor.getByLabel("Số tiền thực tế đã nhận (VNĐ)", {
    exact: true,
  });
  const status = nativeSelect(editor, "Trạng thái thanh toán");
  const save = editor.getByRole("button", {
    name: "Lưu thanh toán",
    exact: true,
  });
  await expect(amount).toHaveValue("0");
  await chooseSelect(status, "partially_paid");
  await expect(amount).toHaveValue("");
  await expect(save).toBeDisabled();
  await amount.fill("250000");
  await expect(status).toHaveValue("partially_paid");
  await save.click();
  await expect.poll(async () => Number((await ledger()).balance)).toBe(250000);
  await expect(save).toBeDisabled();
  await expect(dialog).toBeVisible();
  check(
    (await row()).payment_status === "partially_paid",
    "Detail UI requires a partial amount, saves it and keeps the modal open",
  );
  await chooseSelect(status, "paid");
  await expect(amount).toHaveValue("1000000");
  await save.click();
  await expect.poll(async () => (await row()).payment_status).toBe("paid");
  await expect(save).toBeDisabled();
  const full = await ledger();
  check(
    full.n === 2 && Number(full.balance) === 1000000,
    "Selecting paid fills the total and records only the remaining balance",
  );
  // Reproduce the reported order: a full receipt with an outdated unpaid cache.
  await db.execute(
    "UPDATE orders SET payment_status='unpaid',user_id=? WHERE id=?",
    [buyerId, order.id],
  );
  const detail = await owner.call(
    `workspace/manual-orders/${order.id}`,
    "GET",
    undefined,
    200,
    sid,
  );
  const paidList = await owner.call(
    "workspace/order-list?mode=table&payment=paid",
    "GET",
    undefined,
    200,
    sid,
  );
  const unpaidList = await owner.call(
    "workspace/order-list?mode=table&payment=unpaid",
    "GET",
    undefined,
    200,
    sid,
  );
  const calendar = await owner.call(
    `workspace/calendar?from=${input.deliveryDate}&to=${input.deliveryDate}`,
    "GET",
    undefined,
    200,
    sid,
  );
  const crm = await owner.call("admin/crm", "GET", undefined, 200, sid);
  const history = await buyer.call("orders", "GET", undefined, 200, sid);
  check(
    detail.payment_status === "paid" &&
      paidList.items.some(
        (o) => o.id === order.id && o.payment_status === "paid",
      ) &&
      !unpaidList.items.some((o) => o.id === order.id) &&
      [calendar.orders, crm.orders, history].every(
        (list) =>
          list.find((o) => o.id === order.id)?.payment_status === "paid",
      ),
    "A stale unpaid cache cannot contradict the ledger in detail, filters, calendar, CRM or customer history",
  );
  await page.reload();
  await expect(dialog.locator(".order-overview")).toContainText(
    "Đã thanh toán",
  );
  await expect(status).toHaveValue("paid");
  check(
    true,
    "The summary badge and payment selector both show paid for an existing full receipt",
  );
  await update(1000000);
  check(
    (await row()).payment_status === "paid" && (await ledger()).n === full.n,
    "Reconciling an unchanged balance repairs the stored status without collecting the money again",
  );
  // The API repair deliberately advanced the version outside this open editor.
  await page.reload();
  await expect(amount).toHaveValue("1000000");
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.scrollIntoViewIfNeeded();
  check(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    "Payment editor fits the mobile order dialog",
  );
  await page.screenshot({
    path: ".local/screenshots/order-payment-status-mobile.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await chooseSelect(status, "unpaid");
  await expect(amount).toHaveValue("0");
  await expect(save).toBeDisabled();
  await editor.getByRole("checkbox").check();
  await save.click();
  await expect.poll(async () => (await row()).payment_status).toBe("refunded");
  await expect(save).toBeDisabled();
  check(
    Number((await ledger()).balance) === 0 && (await ledger()).n === 3,
    "Returning paid money to zero requires confirmation and preserves a full refund receipt",
  );
  await chooseSelect(status, "paid");
  await expect(amount).toHaveValue("1000000");
  await amount.fill("400000");
  await expect(status).toHaveValue("partially_paid");
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".local/screenshots/order-payment-status-desktop.png",
  });
  check(
    true,
    "Typing a received amount automatically derives the payment status",
  );
  await page.close();

  const version = (await row()).version;
  const key = randomUUID();
  await update(400000, 200, { version, requestKey: key });
  const receiptCount = (await ledger()).n;
  await update(400000, 200, { version, requestKey: key });
  check(
    (await ledger()).n === receiptCount,
    "Retrying the same adjustment is idempotent after the order version changes",
  );
  await update(500000, 409, { version, requestKey: key });
  await update(500000, 409, { version });
  await update(1000001, 400);
  await update(-1, 400);
  check(
    Number((await ledger()).balance) === 400000,
    "Changed retry payloads, stale versions and invalid amounts cannot alter receipts",
  );
  await update(200000);
  check(
    (await row()).payment_status === "partially_refunded",
    "Reducing the received balance creates a partial refund",
  );
  await db.execute("UPDATE orders SET payment_status='paid' WHERE id=?", [
    order.id,
  ]);
  const refundDetail = await owner.call(
    `workspace/manual-orders/${order.id}`,
    "GET",
    undefined,
    200,
    sid,
  );
  check(
    refundDetail.payment_status === "partially_refunded",
    "Partial refunds remain distinguishable from partial payments even with a stale cache",
  );
  await update(200000);
  const raceVersion = (await row()).version;
  const rawUpdate = async (value, version) =>
    (
      await fetch(`${origin}/api/${endpoint}`, {
        method: "PATCH",
        headers: {
          origin,
          "content-type": "application/json",
          "x-fleur-store": String(sid),
          cookie: [...owner.jar].map(([k, v]) => k + "=" + v).join("; "),
        },
        body: JSON.stringify({
          totalCollected: value,
          method: "cash",
          version,
          requestKey: randomUUID(),
        }),
      })
    ).status;
  const outcomes = await Promise.all([
    rawUpdate(300000, raceVersion),
    rawUpdate(500000, raceVersion),
  ]);
  check(
    outcomes.sort().join() === "200,409" &&
      [300000, 500000].includes(Number((await ledger()).balance)),
    "Concurrent adjustments cannot overwrite a newer received balance",
  );

  const addIntent = async (suffix, amount = 700000) => {
    const code = `FLR-ORD-${order.id}-${suffix}`;
    await db.execute(
      "INSERT INTO payment_intents(store_id,order_id,kind,reference_code,amount,expires_at,qr_payload) VALUES(?,?,'order',?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE),?)",
      [
        sid,
        order.id,
        code,
        amount,
        JSON.stringify({ accountNumber: "12345678" }),
      ],
    );
    return code;
  };
  const obsolete = await addIntent("AAA111");
  await update(600000);
  check(
    (
      await one("SELECT status FROM payment_intents WHERE reference_code=?", [
        obsolete,
      ])
    ).status === "cancelled",
    "A partial manual receipt cancels QR requests with a stale amount",
  );
  const complete = await addIntent("BBB222");
  await update(1000000);
  check(
    (
      await one("SELECT status FROM payment_intents WHERE reference_code=?", [
        complete,
      ])
    ).status === "paid",
    "A full manual receipt closes pending QR payment requests",
  );
  const credentials = await admin.call(
    "platform/sepay/credentials",
    "POST",
    {},
  );
  const webhook = async (code, amount, event = randomUUID()) => {
    const response = await fetch(origin + "/api/sepay/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": credentials.apiKey,
      },
      body: JSON.stringify({
        id: event,
        transferType: "in",
        transferAmount: amount,
        content: code,
        accountNumber: "12345678",
      }),
    });
    return response.status;
  };
  const beforeWebhook = (await ledger()).n;
  check(
    (await webhook(complete, 700000)) === 200 &&
      (await webhook(obsolete, 700000)) === 409 &&
      (await ledger()).n === beforeWebhook,
    "SePay acknowledges a manually settled QR without collecting twice and rejects an obsolete QR",
  );
  await update(0);
  const concurrentCode = await addIntent("CCC333", 1000000);
  const concurrentVersion = (await row()).version;
  const concurrent = await Promise.all([
    rawUpdate(400000, concurrentVersion),
    webhook(concurrentCode, 1000000),
  ]);
  check(
    concurrent.sort().join() === "200,409" &&
      [400000, 1000000].includes(Number((await ledger()).balance)),
    "A simultaneous SePay transfer and manual adjustment serialize without duplicate collection or deadlocks",
  );
  await update(0);
  const liveCode = await addIntent("DDD444", 1000000);
  const event = randomUUID();
  const firstWebhook = await webhook(liveCode, 1000000, event);
  const countAfterWebhook = (await ledger()).n;
  check(
    firstWebhook === 200 &&
      (await webhook(liveCode, 1000000, event)) === 200 &&
      (await ledger()).n === countAfterWebhook &&
      (await row()).payment_status === "paid",
    "A real webhook updates the same payment ledger and duplicate delivery cannot add a second receipt",
  );
  await db.execute(
    "UPDATE orders SET status='cancelled',version=version+1 WHERE id=?",
    [order.id],
  );
  await update(200000);
  await update(300000, 409);
  await update(0);
  check(
    (await row()).payment_status === "refunded" &&
      Number((await ledger()).balance) === 0,
    "Cancelled orders allow refunds and reject additional collection",
  );
  const legacyInput = { ...input, phone: "0909988775" };
  const legacyQuote = await owner.call(
    "workspace/manual-orders/quote",
    "POST",
    legacyInput,
    200,
    sid,
  );
  const legacy = await owner.call(
    "workspace/manual-orders",
    "POST",
    {
      ...legacyInput,
      quoteToken: legacyQuote.token,
      idempotencyKey: randomUUID(),
    },
    200,
    sid,
  );
  await db.execute("UPDATE orders SET payment_status='paid' WHERE id=?", [
    legacy.id,
  ]);
  const legacyDetail = await owner.call(
    `workspace/manual-orders/${legacy.id}`,
    "GET",
    undefined,
    200,
    sid,
  );
  check(
    legacyDetail.payment_status === "paid",
    "Historic paid orders without a receipt ledger keep their original state",
  );
}
