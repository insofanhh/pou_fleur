import { z } from "zod";
import type { PoolConnection } from "mysql2/promise";
import { HttpError } from "./auth";
import { paymentMethods } from "./order-workflow";
import { tenantId } from "./tenant";
import { orderPaymentStatusSQL } from "./order-payment-state";

// Repair only the cached status; never fabricate another receipt to fix a badge.
export async function reconcileOrderPaymentState(
  c: PoolConnection,
  orderId: number,
  actor: number | null = null,
) {
  await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [tenantId()]);
  const [rows]: any = await c.execute(
    "SELECT o.payment_status stored_status," +
      orderPaymentStatusSQL() +
      " ledger_status FROM orders o WHERE o.id=? FOR UPDATE",
    [orderId],
  );
  const order = rows[0];
  if (!order) throw new HttpError(404, "Không tìm thấy đơn hàng.");
  if (order.stored_status === order.ledger_status) return false;
  await c.execute(
    "UPDATE orders SET payment_status=?,version=version+1 WHERE id=?",
    [order.ledger_status, orderId],
  );
  if (order.ledger_status === "paid")
    await c.execute(
      "UPDATE payment_intents SET status='paid',paid_amount=amount,paid_at=NOW() WHERE order_id=? AND status='pending'",
      [orderId],
    );
  else
    await c.execute(
      "UPDATE payment_intents SET status='cancelled' WHERE order_id=? AND status='pending'",
      [orderId],
    );
  await c.execute(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,'payment_reconciled','orders',?,?)",
    [
      actor,
      String(orderId),
      JSON.stringify({
        from: order.stored_status,
        to: order.ledger_status,
        source: "order_payments",
      }),
    ],
  );
  return true;
}
export async function changePaymentMethod(
  c: PoolConnection,
  orderId: number,
  actor: number,
  input: unknown,
) {
  const b = z
    .object({
      method: z.enum(["cod", "bank"]),
      version: z.number().int().positive(),
    })
    .parse(input);
  const [rows]: any = await c.execute(
    "SELECT payment_method,version FROM orders WHERE id=? FOR UPDATE",
    [orderId],
  );
  const o = rows[0];
  if (!o) throw new HttpError(404, "Không tìm thấy đơn hàng.");
  if (o.version !== b.version)
    throw new HttpError(409, "Đơn vừa thay đổi. Hãy tải lại trước khi lưu.");
  if (o.payment_method === b.method) return;
  await c.execute(
    "UPDATE orders SET payment_method=?,version=version+1 WHERE id=?",
    [b.method, orderId],
  );
  await c.execute(
    "INSERT INTO order_status_events(order_id,actor_id,status,detail) VALUES(?,?,?,?)",
    [
      orderId,
      actor,
      "payment_method_changed",
      `${paymentMethods[o.payment_method] || o.payment_method} → ${paymentMethods[b.method]}`,
    ],
  );
  await c.execute(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
    [actor, "payment_method_changed", "orders", String(orderId)],
  );
}
export const paymentSchema = z.object({
  kind: z.enum(["collect", "refund"]),
  amount: z.number().int().positive().max(2000000000),
  reference: z.string().trim().min(5).max(100),
  method: z.enum(["cash", "bank"]).default("cash"),
  receivedAt: z.string().datetime({ offset: true }).optional(),
});
// A target balance is reconciled against the ledger under the same lock used by
// webhook payments. Never change a badge without recording the money movement.
export async function setOrderPaymentBalance(
  c: PoolConnection,
  orderId: number,
  actor: number,
  input: unknown,
) {
  const b = z
    .object({
      totalCollected: z.number().int().min(0).max(2000000000),
      method: z.enum(["cash", "bank"]),
      version: z.number().int().positive(),
      requestKey: z.string().uuid(),
      reference: z
        .string()
        .trim()
        .max(100)
        .default("")
        .refine(
          (v) => !v || v.length >= 5,
          "Mã tham chiếu cần ít nhất 5 ký tự.",
        ),
    })
    .parse(input);
  // Match the store-first lock order used by SePay before touching its intents.
  await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [tenantId()]);
  const [rows]: any = await c.execute(
    "SELECT * FROM orders WHERE id=? FOR UPDATE",
    [orderId],
  );
  const o = rows[0];
  if (!o) throw new HttpError(404, "Không tìm thấy đơn hàng.");
  const [audits]: any = await c.execute(
    "SELECT detail FROM audit_logs WHERE entity='orders' AND entity_id=? AND action='payment_balance'",
    [String(orderId)],
  );
  const previousRequest = audits
    .map((a: any) =>
      typeof a.detail === "string" ? JSON.parse(a.detail) : a.detail,
    )
    .find((a: any) => a?.requestKey === b.requestKey);
  if (previousRequest) {
    if (
      previousRequest.totalCollected !== b.totalCollected ||
      previousRequest.method !== b.method ||
      previousRequest.reference !== b.reference
    )
      throw new HttpError(
        409,
        "Yêu cầu thanh toán đã được dùng cho nội dung khác.",
      );
    return { ok: true, duplicate: true };
  }
  if (o.version !== b.version)
    throw new HttpError(
      409,
      "Đơn vừa thay đổi. Hãy tải lại trước khi cập nhật thanh toán.",
    );
  if (b.totalCollected > Number(o.total))
    throw new HttpError(400, "Số tiền đã nhận không được vượt tổng đơn.");
  const [sums]: any = await c.execute(
    "SELECT COALESCE(SUM(IF(kind='collect',amount,-amount)),0) paid FROM order_payments WHERE order_id=?",
    [orderId],
  );
  const current = Number(sums[0].paid);
  const delta = b.totalCollected - current;
  if (delta) {
    const reference = b.reference || "BAL-" + b.requestKey;
    // A new adjustment cannot reuse an older receipt and silently skip a delta.
    const [receipts]: any = await c.execute(
      "SELECT id FROM order_payments WHERE reference=?",
      [reference],
    );
    if (receipts.length)
      throw new HttpError(
        409,
        "Mã tham chiếu đã được sử dụng. Vui lòng dùng mã khác hoặc để trống.",
      );
    await recordOrderPayment(c, orderId, actor, {
      kind: delta > 0 ? "collect" : "refund",
      amount: Math.abs(delta),
      method: b.method,
      reference,
    });
    if (b.totalCollected === Number(o.total))
      await c.execute(
        "UPDATE payment_intents SET status='paid',paid_amount=amount,paid_at=NOW() WHERE order_id=? AND status='pending'",
        [orderId],
      );
    else
      await c.execute(
        "UPDATE payment_intents SET status='cancelled' WHERE order_id=? AND status='pending'",
        [orderId],
      );
  } else await reconcileOrderPaymentState(c, orderId, actor);
  await c.execute(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,'payment_balance','orders',?,?)",
    [
      actor,
      String(orderId),
      JSON.stringify({ ...b, previousCollected: current, delta }),
    ],
  );
  return { ok: true };
}
// Caller owns transaction and authorization. Order lock serializes balance changes.
export async function recordOrderPayment(
  c: PoolConnection,
  orderId: number,
  actor: number,
  input: unknown,
) {
  const b = paymentSchema.parse(input);
  const [rows]: any = await c.execute(
    "SELECT * FROM orders WHERE id=? FOR UPDATE",
    [orderId],
  );
  const o = rows[0];
  if (!o) throw new HttpError(404, "Không có đơn hàng.");
  const [existing]: any = await c.execute(
    "SELECT order_id,amount,kind,method FROM order_payments WHERE reference=?",
    [b.reference],
  );
  if (existing.length) {
    const p = existing[0];
    if (
      p.order_id !== orderId ||
      p.amount !== b.amount ||
      p.kind !== b.kind ||
      p.method !== b.method
    )
      throw new HttpError(409, "Mã giao dịch đã được dùng cho nội dung khác.");
    return;
  }
  const [sums]: any = await c.execute(
    "SELECT COALESCE(SUM(IF(kind='collect',amount,-amount)),0) paid FROM order_payments WHERE order_id=?",
    [orderId],
  );
  const paid =
    Number(sums[0].paid) + (b.kind === "collect" ? b.amount : -b.amount);
  if (
    paid < 0 ||
    paid > o.total ||
    (b.kind === "collect" && o.status === "cancelled")
  )
    throw new HttpError(409, "Số tiền không hợp lệ cho đơn hàng.");
  if (b.receivedAt && Date.parse(b.receivedAt) > Date.now() + 60000)
    throw new HttpError(400, "Thời điểm thu tiền không được ở tương lai.");
  await c.execute(
    "INSERT INTO order_payments(order_id,amount,kind,reference,actor_id,method,received_at) VALUES(?,?,?,?,?,?,?)",
    [
      orderId,
      b.amount,
      b.kind,
      b.reference,
      actor,
      b.method,
      b.receivedAt
        ? new Date(b.receivedAt).toISOString().slice(0, 19).replace("T", " ")
        : new Date().toISOString().slice(0, 19).replace("T", " "),
    ],
  );
  await c.execute(
    "UPDATE orders SET payment_status=?,version=version+1 WHERE id=?",
    [
      paid === Number(o.total)
        ? "paid"
        : paid === 0 && b.kind === "refund"
          ? "refunded"
          : b.kind === "refund"
            ? "partially_refunded"
            : paid > 0
              ? "partially_paid"
              : "unpaid",
      orderId,
    ],
  );
  await c.execute(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
    [actor, "payment:" + b.kind, "orders", String(orderId)],
  );
}
