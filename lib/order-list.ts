import { z } from "zod";
import { query } from "./db";
import { requirePermission } from "./auth";
import { orderPaymentStatusSQL } from "./order-payment-state";
import { analyticsQueries } from "./store-analytics";
export const orderStatuses = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "shipping",
  "delivered",
  "cancelled",
] as const;
export async function orderList(url: URL) {
  await requirePermission("orders");
  const q = z
    .string()
    .max(100)
    .parse(url.searchParams.get("q") || "");
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .parse(url.searchParams.get("date") || undefined);
  const payment = z
    .enum([
      "unpaid",
      "partially_paid",
      "paid",
      "partially_refunded",
      "refunded",
    ])
    .optional()
    .parse(url.searchParams.get("payment") || undefined);
  const status = z
    .enum(orderStatuses)
    .optional()
    .parse(url.searchParams.get("status") || undefined);
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .parse(url.searchParams.get("limit") || 20);
  const filters = ["1=1"],
    values: any[] = [];
  const fulfillment = z.enum(["delivery", "pickup"]).optional().parse(url.searchParams.get("fulfillment") || undefined);
  if (fulfillment) { filters.push("o.fulfillment_method=?"); values.push(fulfillment); }
  const method = z
    .enum(["cod", "bank", "cod_due", "cod_delivered_due"])
    .optional()
    .parse(url.searchParams.get("method") || undefined);
  if (method) {
    filters.push("o.payment_method=?");
    if (method !== "bank") filters.push("o.fulfillment_method<>'pickup'");
    values.push(method === "bank" ? "bank" : "cod");
    if (method === "cod_due" || method === "cod_delivered_due") {
      filters.push(
        "o.status<>'cancelled' AND o.total>0 AND " +
          orderPaymentStatusSQL() +
          "<>'paid'",
      );
      if (method === "cod_delivered_due") filters.push("o.status='delivered'");
    }
  }
  const source = z
    .enum(["web", "manual"])
    .optional()
    .parse(url.searchParams.get("source") || undefined);
  if (source) {
    filters.push("o.creation_source=?");
    values.push(source);
  }
  if (q) {
    filters.push(
      "(o.reference LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ?)",
    );
    values.push(...Array(3).fill("%" + q + "%"));
  }
  if (date) {
    filters.push("o.delivery_date=?");
    values.push(date);
  }
  if (payment) {
    filters.push(orderPaymentStatusSQL() + "=?");
    values.push(payment);
  }
  const pageSchema = z.coerce.number().int().min(1).max(100000);
  async function column(state?: string) {
    const page = pageSchema.parse(
      url.searchParams.get(state ? "page_" + state : "page") || 1,
    );
    const where =
      filters.join(" AND ") + (state || status ? " AND o.status=?" : "");
    const params = [...values, ...(state || status ? [state || status] : [])];
    const [counts, rows] = await Promise.all([
      query<any[]>(
        "SELECT COUNT(*) total FROM orders o WHERE " + where,
        params,
      ),
      query<any[]>(
        "SELECT o.*," +
          orderPaymentStatusSQL() +
          " payment_status,(SELECT u.name FROM users u WHERE u.id=o.created_by) creator_name,(SELECT COALESCE(SUM(IF(p.kind IN ('collect','correction'),p.amount,-p.amount)),0) FROM order_payments p WHERE p.order_id=o.id) collected,(SELECT JSON_ARRAYAGG(JSON_OBJECT('name',product_name,'quantity',quantity,'size',size,'price',price,'line_type',line_type,'description',description,'image',image)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o WHERE " +
          where +
          // Both values are bounded integers validated above. TiDB rejects
          // mysql2's DOUBLE binding for LIMIT/OFFSET in prepared statements.
          ` ORDER BY o.delivery_date,o.delivery_slot,o.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        params,
      ),
    ]);
    return {
      status: state,
      items: rows,
      total: Number(counts[0].total),
      page,
      limit,
    };
  }
  const [codStats] = await query<any[]>(analyticsQueries.cod);
  const result = await (url.searchParams.get("mode") === "table"
    ? column()
    : { columns: await Promise.all(orderStatuses.map((s) => column(s))) });
  return { ...result, codStats };
}
