import { z } from "zod";
import { query } from "./db";
import { requirePermission } from "./auth";
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
    filters.push("o.payment_status=?");
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
        "SELECT o.*,(SELECT JSON_ARRAYAGG(JSON_OBJECT('name',product_name,'quantity',quantity,'size',size,'price',price)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o WHERE " +
          where +
          " ORDER BY o.delivery_date,o.delivery_slot,o.id LIMIT ? OFFSET ?",
        [...params, limit, (page - 1) * limit],
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
  return url.searchParams.get("mode") === "table"
    ? column()
    : { columns: await Promise.all(orderStatuses.map((s) => column(s))) };
}
