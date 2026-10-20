import { orderPaymentStatusSQL } from "./order-payment-state";
import { pool } from "./db";
import { HttpError } from "./auth";
import { tenantId, withStore, withSystem } from "./tenant";
import { parseDateTime } from "./date-time";
import { activeBank, vietQrUrl } from "./sepay";
import { findBank } from "./bank-catalog";
import { emit } from "./domain-events";
import { enqueueOrderEmail } from "./email";

export function orderSessionView(intent: any, order: any) {
  const qr =
    typeof intent.qr_payload === "string"
      ? JSON.parse(intent.qr_payload)
      : intent.qr_payload;
  const bank = {
    bank_code: qr.bankCode,
    bank_name: findBank(qr.bankCode || "")?.name || qr.bankName || qr.bankCode,
    account_number: qr.accountNumber,
    account_holder: qr.accountHolder,
    enabled: true,
    sepay_enabled: false,
    auto_confirm_status: "confirmed",
  };
  return {
    id: intent.id,
    code: intent.reference_code,
    reference: order.reference,
    amount: Number(intent.amount),
    status: intent.status,
    orderStatus: order.status,
    paymentStatus: order.payment_status,
    expiresAt: parseDateTime(intent.expires_at, "utc").toISOString(),
    serverNow: new Date().toISOString(),
    expired: parseDateTime(intent.expires_at, "utc").getTime() <= Date.now(),
    qrUrl:
      intent.status === "pending"
        ? vietQrUrl(bank, intent.amount, intent.reference_code)
        : null,
    bank,
  };
}

// Same store -> order -> intent lock order as checkout and payment recording.
// Closing a QR never manufactures a receipt or a refund.
export async function reconcileOrderSession(code: string, cancel = false) {
  const sid = tenantId(),
    c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [sid]);
    const [lookups]: any = await c.execute(
      "SELECT order_id FROM payment_intents WHERE reference_code=? AND kind='order'",
      [code],
    );
    if (!lookups[0])
      throw new HttpError(404, "Không tìm thấy phiên thanh toán.");
    const [orders]: any = await c.execute(
      "SELECT o.*," +
        orderPaymentStatusSQL() +
        " payment_status FROM orders o WHERE o.id=? FOR UPDATE",
      [lookups[0].order_id],
    );
    const [intents]: any = await c.execute(
      "SELECT * FROM payment_intents WHERE reference_code=? AND kind='order' FOR UPDATE",
      [code],
    );
    const o = orders[0],
      p = intents[0];
    if (!o || !p) throw new HttpError(404, "Không tìm thấy phiên thanh toán.");
    const [receipts]: any = await c.execute(
      "SELECT COALESCE(SUM(ABS(amount)),0) movement FROM order_payments WHERE order_id=?",
      [o.id],
    );
    const hasMoney =
      Number(receipts[0].movement) > 0 ||
      Number(p.paid_amount) > 0 ||
      o.payment_status !== "unpaid";
    if (cancel && hasMoney)
      throw new HttpError(
        409,
        "Đơn đã ghi nhận thanh toán. Liên hệ cửa hàng để đối soát; không thể hủy thanh toán.",
      );
    const bank = await activeBank(sid, c, true);
    const qr =
      typeof p.qr_payload === "string"
        ? JSON.parse(p.qr_payload)
        : p.qr_payload;
    const canonical = (value: string) => findBank(value || "")?.bin || value;
    const changedBank =
      !bank ||
      (qr.bankCode &&
        (canonical(qr.bankCode) !== canonical(bank.bank_code) ||
          qr.accountNumber !== bank.account_number));
    const expired = parseDateTime(p.expires_at, "utc").getTime() <= Date.now();
    if (
      p.status === "pending" &&
      (cancel || expired || changedBank || o.status === "cancelled")
    ) {
      // Only unpaid orders awaiting confirmation can be automatically cancelled.
      // Deposits, handoffs and orders already being fulfilled need staff review.
      const cancelOrder =
        !hasMoney &&
        o.payment_method === "bank" &&
        o.fulfillment_method !== "pickup" &&
        ["pending", "confirmed"].includes(o.status);
      const reason = changedBank
        ? "Thông tin ngân hàng nhận tiền đã thay đổi"
        : cancel
          ? "Khách hủy thanh toán"
          : "Mã QR hết hạn sau 5 phút";
      if (cancel && !cancelOrder && o.status !== "cancelled")
        throw new HttpError(
          409,
          "Đơn đang được xử lý. Vui lòng liên hệ cửa hàng để hủy.",
        );
      await c.execute("UPDATE payment_intents SET status=? WHERE id=?", [
        expired ? "expired" : "cancelled",
        p.id,
      ]);
      p.status = expired ? "expired" : "cancelled";
      if (cancelOrder) {
        const [items]: any = await c.execute(
          "SELECT product_id,quantity FROM order_items WHERE order_id=? AND product_id IS NOT NULL AND line_type='catalog' ORDER BY product_id",
          [o.id],
        );
        for (const item of items)
          await c.execute("UPDATE products SET stock=stock+? WHERE id=?", [
            item.quantity,
            item.product_id,
          ]);
        if (o.promotion_id)
          await c.execute(
            "UPDATE promotions SET used=GREATEST(0,used-1) WHERE id=?",
            [o.promotion_id],
          );
        await c.execute(
          "UPDATE orders SET status='cancelled',version=version+1 WHERE id=?",
          [o.id],
        );
        await c.execute(
          "UPDATE payment_intents SET status='cancelled' WHERE order_id=? AND kind='order' AND status='pending'",
          [o.id],
        );
        await c.execute(
          "INSERT INTO order_status_events(order_id,actor_id,status,detail) VALUES(?,NULL,'cancelled',?)",
          [o.id, reason + " · Chưa nhận tiền"],
        );
        await c.execute(
          "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(NULL,?,'orders',?)",
          [expired ? "payment_expired" : "payment_cancelled", String(o.id)],
        );
        await emit(c, `order:${o.id}:payment-closed:${o.version + 1}`, {
          userId: o.user_id,
          audience: "staff",
          title: `Đơn ${o.reference} · Đã hủy`,
          body: reason,
          href: `/workspace/${sid}/orders?order=${o.id}`,
        });
        await enqueueOrderEmail(c, o.id, "order_status", o.status);
        o.status = "cancelled";
      }
    }
    const result = orderSessionView(p, o);
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

export async function expireStoreOrderSessions(limit = 100) {
  const [rows]: any = await pool.execute(
    "SELECT reference_code FROM payment_intents WHERE kind='order' AND status='pending' AND expires_at<=UTC_TIMESTAMP() ORDER BY expires_at LIMIT ?",
    [limit],
  );
  for (const row of rows) await reconcileOrderSession(row.reference_code);
  return rows.length;
}

export async function expireAllOrderSessions() {
  return withSystem(async () => {
    const [rows]: any = await pool.execute(
      "SELECT store_id,reference_code FROM payment_intents WHERE kind='order' AND status='pending' AND expires_at<=UTC_TIMESTAMP() ORDER BY expires_at LIMIT 200",
    );
    for (const row of rows)
      await withStore(Number(row.store_id), () =>
        reconcileOrderSession(row.reference_code),
      );
    return rows.length;
  });
}
