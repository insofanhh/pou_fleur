import type { StoreAnalytics } from "./store-analytics";

export const aiReportLabels: Record<string, string> = {
  days: "Số ngày",
  previousFrom: "Kỳ trước từ ngày",
  previousTo: "Kỳ trước đến ngày",
  orders_count: "Tổng số đơn",
  gross_value: "Tổng giá trị đơn (gồm đơn hủy)",
  order_value: "Giá trị đơn (không tính đơn hủy)",
  revenue: "Doanh thu đã giao",
  collected: "Tiền đã thu ròng",
  outstanding: "Còn phải thu",
  refund_due: "Cần hoàn tiền",
  unpaid_count: "Đơn chưa thanh toán",
  partial_count: "Đơn thanh toán một phần",
  paid_count: "Đơn đã thanh toán",
  delivered: "Đơn đã giao",
  cancellations: "Đơn đã hủy",
  item_value: "Giá trị sản phẩm",
  remaining: "Đơn còn phải giao",
  creation_source: "Nguồn tạo đơn",
  sales_channel: "Kênh tiếp nhận",
  salesChannel: "Kênh tiếp nhận",
  method: "Phương thức thanh toán",
  payment_method: "Phương thức thanh toán",
  average_order_value: "Giá trị đơn trung bình",
  net_collected: "Tiền đã thu ròng",
  previousRevenue: "Doanh thu kỳ trước",
  amount: "Số tiền",
  balance: "Số dư",
};
export const aiMoneyKeys = new Set([
  "price",
  "total",
  "subtotal",
  "shipping",
  "discount",
  "revenue",
  "collected",
  "outstanding",
  "average_order_value",
  "amount",
  "net_collected",
  "balance",
  "previousRevenue",
  "gross_value",
  "order_value",
  "refund_due",
  "item_value",
]);
export function formatAIMetric(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("vi-VN") + (aiMoneyKeys.has(key) ? " VNĐ" : "");
}
export type AIAnalyticsReport = Pick<StoreAnalytics, "summary"> & {
  period: Pick<StoreAnalytics["period"], "from" | "to" | "days"> & Partial<Pick<StoreAnalytics["period"], "previousFrom" | "previousTo">>;
  comparePrevious?: boolean;
} &
  Partial<
    Pick<StoreAnalytics, "previous" | "products" | "sources" | "deliveries">
  >;
export function isAIAnalyticsReport(value: any): value is AIAnalyticsReport {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.period?.from === "string" &&
    typeof value.period?.to === "string" &&
    !!value.summary &&
    typeof value.summary === "object" &&
    !Array.isArray(value.summary)
  );
}
