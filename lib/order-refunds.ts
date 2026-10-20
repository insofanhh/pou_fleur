import { z } from "zod";
import type { PoolConnection } from "mysql2/promise";
import { query } from "./db";
import { HttpError } from "./auth";
import { tenantId } from "./tenant";
import { recordOrderPayment } from "./order-payments";

// Corrections are signed balance adjustments, never money returned to a customer.
const balanceSQL =
  "(SELECT COALESCE(SUM(IF(p.kind IN ('collect','correction'),p.amount,-p.amount)),0) FROM order_payments p WHERE p.order_id=o.id AND p.store_id=o.store_id)";
const refundedSQL =
  "(SELECT COALESCE(SUM(p.amount),0) FROM order_payments p WHERE p.order_id=o.id AND p.store_id=o.store_id AND p.kind='refund')";
const receiptsSQL =
  "(SELECT COUNT(*) FROM order_payments p WHERE p.order_id=o.id AND p.store_id=o.store_id)";
const reviewSQL = `(${receiptsSQL}=0 AND o.payment_status IN ('paid','partially_paid','partially_refunded'))`;

// The caller authorizes orders access; all queries retain the current tenant scope.
export async function loadOrderRefunds(url: URL, run: typeof query = query) {
  const q = z
    .string()
    .trim()
    .max(100)
    .parse(url.searchParams.get("q") || "");
  const state = z
    .enum(["pending", "completed", "review", "all"])
    .parse(url.searchParams.get("state") || "pending");
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(url.searchParams.get("page") || 1);
  const limit = 20;
  const where =
    "o.status='cancelled'" +
    (q
      ? " AND (o.reference LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ?)"
      : "");
  const values = q ? Array(3).fill("%" + q + "%") : [];
  const condition =
    state === "pending"
      ? `${balanceSQL}>0`
      : state === "completed"
        ? `(${balanceSQL}=0 AND ${refundedSQL}>0)`
        : state === "review"
          ? reviewSQL
          : `(${balanceSQL}>0 OR ${refundedSQL}>0 OR ${reviewSQL})`;
  const [summary, counts, items] = await Promise.all([
    run<any[]>(
      `SELECT COALESCE(SUM(IF(${balanceSQL}>0,1,0)),0) pending_count,COALESCE(SUM(GREATEST(${balanceSQL},0)),0) outstanding,COALESCE(SUM(IF(${balanceSQL}=0 AND ${refundedSQL}>0,1,0)),0) completed_count,COALESCE(SUM(IF(${reviewSQL},1,0)),0) review_count FROM orders o WHERE ${where}`,
      values,
    ),
    run<any[]>(
      `SELECT COUNT(*) total FROM orders o WHERE ${where} AND ${condition}`,
      values,
    ),
    run<any[]>(
      `SELECT o.id,o.reference,o.customer_name,o.phone,o.total,o.version,${balanceSQL} outstanding,${refundedSQL} refunded,${reviewSQL} needs_review,(SELECT MAX(e.created_at) FROM order_status_events e WHERE e.order_id=o.id AND e.store_id=o.store_id AND e.status='cancelled') cancelled_at,(SELECT MAX(p.received_at) FROM order_payments p WHERE p.order_id=o.id AND p.store_id=o.store_id AND p.kind='refund') refunded_at FROM orders o WHERE ${where} AND ${condition} ORDER BY cancelled_at IS NULL,cancelled_at,o.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      values,
    ),
  ]);
  return {
    items,
    summary: summary[0],
    total: Number(counts[0].total),
    page,
    limit,
  };
}

const refundSchema = z.object({
  amount: z.number().int().positive().max(2000000000),
  version: z.number().int().positive(),
  requestKey: z.string().uuid(),
  method: z.enum(["bank", "cash"]),
  reference: z.string().trim().max(100).default(""),
  note: z.string().trim().max(500).default(""),
  confirmed: z.literal(true),
});

// Caller owns the transaction and owner-only authorization. Never sends money.
export async function markOrderRefund(
  c: PoolConnection,
  orderId: number,
  actor: number,
  input: unknown,
) {
  const b = refundSchema.parse(input);
  await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [tenantId()]);
  const [orders]: any = await c.execute(
    "SELECT * FROM orders WHERE id=? FOR UPDATE",
    [orderId],
  );
  const order = orders[0];
  if (!order) throw new HttpError(404, "Không tìm thấy đơn hàng.");
  const [audits]: any = await c.execute(
    "SELECT detail FROM audit_logs WHERE entity='orders' AND entity_id=? AND action='order_refund'",
    [String(orderId)],
  );
  const previous = audits
    .map((a: any) =>
      typeof a.detail === "string" ? JSON.parse(a.detail) : a.detail,
    )
    .find((a: any) => a?.requestKey === b.requestKey);
  if (previous) {
    if (
      ["amount", "method", "reference", "note"].some(
        (key) => previous[key] !== b[key as keyof typeof b],
      )
    )
      throw new HttpError(
        409,
        "Yêu cầu hoàn tiền đã được dùng cho nội dung khác.",
      );
    return { ok: true, duplicate: true };
  }
  if (order.version !== b.version)
    throw new HttpError(
      409,
      "Đơn vừa thay đổi. Hãy làm mới và kiểm tra số tiền trước khi ghi nhận.",
    );
  if (order.status !== "cancelled")
    throw new HttpError(409, "Chỉ ghi nhận tại đây cho đơn đã hủy.");
  if (b.reference) {
    const [references]: any = await c.execute(
      "SELECT entity_id FROM audit_logs WHERE action='order_refund' AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.reference'))=? LIMIT 1",
      [b.reference],
    );
    if (references.length)
      throw new HttpError(
        409,
        "Mã giao dịch hoàn đã được ghi nhận. Hãy kiểm tra lịch sử trước khi xác nhận.",
      );
  }
  const [sums]: any = await c.execute(
    "SELECT COALESCE(SUM(IF(kind IN ('collect','correction'),amount,-amount)),0) paid FROM order_payments WHERE order_id=?",
    [orderId],
  );
  const outstanding = Number(sums[0].paid);
  if (b.amount > outstanding)
    throw new HttpError(
      409,
      "Số tiền hoàn vượt khoản còn cần hoàn. Hãy làm mới danh sách.",
    );
  await recordOrderPayment(c, orderId, actor, {
    kind: "refund",
    amount: b.amount,
    method: b.method,
    reference: "REFUND-" + b.requestKey,
  });
  await c.execute(
    "UPDATE payment_intents SET status='cancelled' WHERE order_id=? AND status='pending'",
    [orderId],
  );
  await c.execute(
    "INSERT INTO order_status_events(order_id,actor_id,status,detail) VALUES(?,?,'payment_refunded',?)",
    [
      orderId,
      actor,
      `Đã hoàn ${b.amount.toLocaleString("vi-VN")} VNĐ · ${b.method === "bank" ? "Chuyển khoản" : "Tiền mặt"}${b.reference ? " · Mã giao dịch: " + b.reference : ""}${b.note ? " · " + b.note : ""}`,
    ],
  );
  await c.execute(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,'order_refund','orders',?,?)",
    [
      actor,
      String(orderId),
      JSON.stringify({
        ...b,
        previousOutstanding: outstanding,
        remaining: outstanding - b.amount,
      }),
    ],
  );
  return { ok: true, outstanding: outstanding - b.amount };
}
