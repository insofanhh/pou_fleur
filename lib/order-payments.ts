import { z } from "zod";
import type { PoolConnection } from "mysql2/promise";
import { HttpError } from "./auth";
export const paymentSchema = z.object({
  kind: z.enum(["collect", "refund"]),
  amount: z.number().int().positive().max(2000000000),
  reference: z.string().trim().min(5).max(100),
  method: z.enum(["cash", "bank"]).default("cash"),
  receivedAt: z.string().datetime({ offset: true }).optional(),
});
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
      paid === o.total
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
