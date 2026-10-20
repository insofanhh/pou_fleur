import { z } from "zod";
import type { PoolConnection } from "mysql2/promise";
import { HttpError } from "./auth";
import { tenantId } from "./tenant";
import { recordOrderPayment } from "./order-payments";
import { isPickup } from "./order-fulfillment";

export const codReceiptSchema = z.object({
  amount: z.number().int().positive().max(2000000000),
  version: z.number().int().positive(),
  requestKey: z.uuid(),
  method: z.enum(["cash", "bank"]),
  reference: z
    .string()
    .trim()
    .max(100)
    .default("")
    .refine(
      (value) => !value || value.length >= 5,
      "Mã tham chiếu cần ít nhất 5 ký tự.",
    ),
  note: z.string().trim().max(500).default(""),
  receivedAt: z.iso.datetime({ offset: true }).optional(),
  confirmed: z.literal(true),
});

// Caller owns transaction + owner authorization. Same store→order lock as SePay.
export async function collectCOD(
  c: PoolConnection,
  orderId: number,
  actor: number,
  input: unknown,
) {
  const b = codReceiptSchema.parse(input);
  await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [tenantId()]);
  const [rows]: any = await c.execute(
    "SELECT * FROM orders WHERE id=? FOR UPDATE",
    [orderId],
  );
  const o = rows[0];
  if (!o) throw new HttpError(404, "Không tìm thấy đơn hàng.");
  const [audits]: any = await c.execute(
    "SELECT detail FROM audit_logs WHERE action='cod_collected' AND entity='orders' AND entity_id=?",
    [String(orderId)],
  );
  const previous = audits
    .map((a: any) =>
      typeof a.detail === "string" ? JSON.parse(a.detail) : a.detail,
    )
    .find((a: any) => a?.requestKey === b.requestKey);
  if (previous) {
    if (
      ["amount", "method", "reference", "note", "receivedAt"].some(
        (k) => previous[k] !== b[k as keyof typeof b],
      )
    )
      throw new HttpError(
        409,
        "Yêu cầu thu COD đã được dùng cho nội dung khác.",
      );
    return { ok: true, duplicate: true };
  }
  if (o.version !== b.version)
    throw new HttpError(
      409,
      "Đơn vừa thay đổi. Hãy làm mới và kiểm tra số tiền còn phải thu.",
    );
  if ((o.payment_method !== "cod" && !isPickup(o)) || o.status === "cancelled")
    throw new HttpError(409, "Chỉ thu tiền cho đơn COD hoặc nhận tại quầy chưa hủy.");
  const [sums]: any = await c.execute(
    "SELECT COUNT(*) n,COALESCE(SUM(IF(kind IN ('collect','correction'),amount,-amount)),0) balance FROM order_payments WHERE order_id=?",
    [orderId],
  );
  if (
    !Number(sums[0].n) &&
    ["paid", "partially_paid", "partially_refunded", "refunded"].includes(
      o.payment_status,
    )
  )
    throw new HttpError(
      409,
      "Đơn cũ thiếu sổ giao dịch. Hãy đối soát và sửa số tiền ghi nhận trước khi thu COD.",
    );
  const due = Number(o.total) - Number(sums[0].balance);
  if (b.amount > due)
    throw new HttpError(
      409,
      "Số tiền thu vượt khoản còn phải thu. Hãy làm mới đơn.",
    );
  if (b.reference) {
    const [refs]: any = await c.execute(
      "SELECT id FROM audit_logs WHERE action='cod_collected' AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.reference'))=? LIMIT 1",
      [b.reference],
    );
    const [payments]: any = await c.execute(
      "SELECT id FROM order_payments WHERE reference=? LIMIT 1",
      [b.reference],
    );
    if (refs.length || payments.length)
      throw new HttpError(
        409,
        "Mã giao dịch đã được ghi nhận. Kiểm tra lịch sử trước khi thu COD.",
      );
  }
  await recordOrderPayment(c, orderId, actor, {
    kind: "collect",
    amount: b.amount,
    method: b.method,
    // Preserve a bank reference in the shared ledger so SePay also detects it.
    reference: b.reference || (isPickup(o) ? "COUNTER-" : "COD-") + b.requestKey,
    ...(b.receivedAt ? { receivedAt: b.receivedAt } : {}),
  });
  await c.execute(
    "UPDATE payment_intents SET status='cancelled' WHERE order_id=? AND status='pending'",
    [orderId],
  );
  await c.execute(
    "INSERT INTO order_status_events(order_id,actor_id,status,detail) VALUES(?,?,'cod_collected',?)",
    [
      orderId,
      actor,
      `Đã thu ${isPickup(o) ? "tại quầy" : "COD"} ${b.amount.toLocaleString("vi-VN")} VNĐ · ${b.method === "cash" ? "Tiền mặt" : "Chuyển khoản"}${b.reference ? " · " + b.reference : ""}${b.note ? " · " + b.note : ""}`,
    ],
  );
  await c.execute(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,'cod_collected','orders',?,?)",
    [
      actor,
      String(orderId),
      JSON.stringify({ ...b, previousDue: due, remaining: due - b.amount }),
    ],
  );
  return { ok: true, outstanding: due - b.amount };
}
