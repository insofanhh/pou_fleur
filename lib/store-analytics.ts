import { hanoiDateKey, parseDateTime } from "./date-time";

const DAY = 86400000;
export function analyticsPeriod(from: string, to: string) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(from) || !valid(to) || to < from)
    throw new RangeError("Khoảng ngày không hợp lệ.");
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  if (days > 366) throw new RangeError("Chọn tối đa 366 ngày để xem báo cáo.");
  return {
    from,
    to,
    days,
    previousFrom: hanoiDateKey(parseDateTime(from).getTime() - days * DAY),
    previousTo: hanoiDateKey(parseDateTime(from).getTime() - DAY),
  };
}

// Aggregate the receipt ledger once before joining orders: neither multiple
// receipts nor multiple line items may multiply an order's value. A legacy paid
// order without receipts retains its recorded balance; ledger zero wins otherwise.
const balance =
  "COALESCE(receipts.balance,CASE WHEN o.payment_status='paid' THEN o.total ELSE 0 END)";
export const analyticsQueries = {
  orders: `SELECT DATE(o.created_at) day,o.creation_source,o.sales_channel,o.status,o.payment_method,
    COUNT(*) orders_count,SUM(o.total) gross_value,
    SUM(CASE WHEN o.status<>'cancelled' THEN o.total ELSE 0 END) order_value,
    SUM(CASE WHEN o.status='delivered' THEN o.total ELSE 0 END) revenue,
    SUM(${balance}) collected,
    SUM(CASE WHEN o.status<>'cancelled' THEN GREATEST(o.total-${balance},0) ELSE 0 END) outstanding,
    SUM(CASE WHEN o.status='cancelled' THEN GREATEST(${balance},0) ELSE GREATEST(${balance}-o.total,0) END) refund_due,
    SUM(CASE WHEN o.status<>'cancelled' AND o.total>0 AND ${balance}<=0 THEN 1 ELSE 0 END) unpaid_count,
    SUM(CASE WHEN o.status<>'cancelled' AND ${balance}>0 AND ${balance}<o.total THEN 1 ELSE 0 END) partial_count,
    SUM(CASE WHEN o.status<>'cancelled' AND ${balance}>=o.total THEN 1 ELSE 0 END) paid_count
    FROM orders o LEFT JOIN (
      SELECT order_id,SUM(IF(kind='collect',amount,-amount)) balance FROM order_payments GROUP BY order_id
    ) receipts ON receipts.order_id=o.id
    WHERE o.created_at>=? AND o.created_at<DATE_ADD(?,INTERVAL 1 DAY)
    GROUP BY DATE(o.created_at),o.creation_source,o.sales_channel,o.status,o.payment_method
    ORDER BY day`,
  products: `SELECT i.product_id,i.product_name name,i.line_type,SUM(i.quantity) quantity,
    SUM(i.quantity*i.price) item_value,COUNT(DISTINCT o.id) orders_count
    FROM order_items i JOIN orders o ON o.id=i.order_id
    WHERE o.created_at>=? AND o.created_at<DATE_ADD(?,INTERVAL 1 DAY) AND o.status<>'cancelled'
    GROUP BY i.product_id,i.product_name,i.line_type ORDER BY quantity DESC,item_value DESC,name LIMIT 6`,
  categories: `SELECT c.id,c.name,SUM(i.quantity) quantity,SUM(i.quantity*i.price) item_value
    FROM order_items i JOIN orders o ON o.id=i.order_id
    LEFT JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE o.created_at>=? AND o.created_at<DATE_ADD(?,INTERVAL 1 DAY) AND o.status<>'cancelled'
    GROUP BY c.id,c.name ORDER BY item_value DESC,quantity DESC LIMIT 6`,
  deliveries: `SELECT o.delivery_date day,COUNT(*) orders_count,
    SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) delivered,
    SUM(CASE WHEN o.status<>'delivered' THEN 1 ELSE 0 END) remaining
    FROM orders o WHERE o.delivery_date BETWEEN ? AND ? AND o.status<>'cancelled'
    GROUP BY o.delivery_date ORDER BY orders_count DESC,day LIMIT 7`,
  segments: "SELECT segment,COUNT(*) count FROM customers GROUP BY segment",
  funnel:
    "SELECT name,COUNT(*) count FROM analytics_events WHERE store_id=? AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY) GROUP BY name",
};

const measures = [
  "orders_count",
  "gross_value",
  "order_value",
  "revenue",
  "collected",
  "outstanding",
  "refund_due",
  "unpaid_count",
  "partial_count",
  "paid_count",
] as const;
type Measures = Record<(typeof measures)[number], number>;
const zero = (): Measures =>
  Object.fromEntries(measures.map((k) => [k, 0])) as Measures;
function add(target: Measures, source: any) {
  for (const key of measures) target[key] += Number(source[key] || 0);
}
export type AnalyticsReader = (
  sql: string,
  values?: unknown[],
) => Promise<any[]>;
export async function loadStoreAnalytics(
  from: string,
  to: string,
  storeId: number,
  read: AnalyticsReader,
  options: { comparePrevious?: boolean } = {},
) {
  const period = analyticsPeriod(from, to);
  const [rows, products, categories, deliveries, segments, funnel] =
    await Promise.all([
      read(analyticsQueries.orders, [options.comparePrevious === false ? from : period.previousFrom, to]),
      read(analyticsQueries.products, [from, to]),
      read(analyticsQueries.categories, [from, to]),
      read(analyticsQueries.deliveries, [from, to]),
      read(analyticsQueries.segments),
      read(analyticsQueries.funnel, [storeId, from, to]),
    ]);
  const summary = { ...zero(), delivered: 0, cancellations: 0 },
    previous = { ...zero(), delivered: 0, cancellations: 0 };
  const daily = Array.from({ length: period.days }, (_, i) => ({
    day: hanoiDateKey(parseDateTime(from).getTime() + i * DAY),
    ...zero(),
    cancellations: 0,
  }));
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const sources = new Map<
    string,
    Measures & { creation_source: string; sales_channel: string }
  >();
  const statuses = new Map<
    string,
    { status: string; count: number; value: number }
  >();
  const payments = new Map<string, Measures & { method: string }>();
  for (const row of rows) {
    // mysql dateStrings is enabled; normalize Date too for test/read adapters.
    const key = hanoiDateKey(row.day);
    const current = key >= from && key <= to;
    if (!current && (key < period.previousFrom || key > period.previousTo))
      continue;
    const target = current ? summary : previous;
    add(target, row);
    if (row.status === "delivered")
      target.delivered += Number(row.orders_count);
    if (row.status === "cancelled")
      target.cancellations += Number(row.orders_count);
    if (!current) continue;
    const d = byDay.get(key)!;
    add(d, row);
    if (row.status === "cancelled") d.cancellations += Number(row.orders_count);
    const channelKey = row.creation_source + ":" + row.sales_channel;
    if (!sources.has(channelKey))
      sources.set(channelKey, {
        ...zero(),
        creation_source: row.creation_source,
        sales_channel: row.sales_channel,
      });
    add(sources.get(channelKey)!, row);
    if (!statuses.has(row.status))
      statuses.set(row.status, { status: row.status, count: 0, value: 0 });
    const status = statuses.get(row.status)!;
    status.count += Number(row.orders_count);
    status.value += Number(row.gross_value);
    if (!payments.has(row.payment_method))
      payments.set(row.payment_method, {
        ...zero(),
        method: row.payment_method,
      });
    add(payments.get(row.payment_method)!, row);
  }
  return {
    period,
    summary,
    previous,
    daily,
    sources: [...sources.values()].sort(
      (a, b) => b.orders_count - a.orders_count,
    ),
    statuses: [...statuses.values()],
    payments: [...payments.values()],
    products: products.map((r) => ({
      product_id: r.product_id as number | null,
      name: String(r.name),
      line_type: String(r.line_type),
      quantity: Number(r.quantity),
      item_value: Number(r.item_value),
      orders_count: Number(r.orders_count),
    })),
    categories: categories.map((r) => ({
      id: r.id as number | null,
      name: String(r.name || "Thiết kế riêng / Chưa phân loại"),
      quantity: Number(r.quantity),
      item_value: Number(r.item_value),
    })),
    deliveries: deliveries.map((r) => ({
      day: hanoiDateKey(r.day),
      orders_count: Number(r.orders_count),
      delivered: Number(r.delivered),
      remaining: Number(r.remaining),
    })),
    segments: segments.map((r) => ({
      segment: r.segment,
      count: Number(r.count),
    })),
    funnel: funnel.map((r) => ({ name: r.name, count: Number(r.count) })),
  };
}

export type StoreAnalytics = Awaited<ReturnType<typeof loadStoreAnalytics>>;
