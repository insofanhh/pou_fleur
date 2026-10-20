"use client";

import { useId, useState, type ReactNode } from "react";
import {
  aiReportLabels,
  formatAIMetric,
  type AIAnalyticsReport,
} from "@/lib/ai-report";
import { formatDate } from "@/lib/date-time";
import { orderChannel } from "@/lib/order-workflow";

const mainMetrics = [
  "orders_count",
  "delivered",
  "cancellations",
  "revenue",
  "collected",
  "outstanding",
];
const otherMetrics = [
  "order_value",
  "gross_value",
  "refund_due",
  "paid_count",
  "partial_count",
  "unpaid_count",
];
const tabs = [
  ["summary", "Tổng quan"],
  ["details", "Chỉ số khác"],
  ["products", "Sản phẩm"],
  ["sources", "Kênh tiếp nhận"],
  ["deliveries", "Lịch giao"],
];
function ReportTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div
      className="ai-report-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={headers.join(", ")}
    >
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th scope="col" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((cells, i) => (
              <tr key={i}>
                {cells.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="ai-report-empty">
                Chưa có dữ liệu trong kỳ này.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export default function AIAnalyticsReport({
  data,
}: {
  data: AIAnalyticsReport;
}) {
  const [tab, setTab] = useState("summary");
  const [compare, setCompare] = useState(data.comparePrevious === true);
  const id = useId();
  const current = data.summary as Record<string, number>;
  const previous = data.previous as Record<string, number> | undefined;
  const period = data.period;
  return (
    <section className="ai-report" aria-label="Báo cáo phân tích hoạt động">
      <div className="ai-report-period">
        <strong>
          {formatDate(period.from)} – {formatDate(period.to)}
          {period.days ? ` · ${period.days} ngày` : ""}
        </strong>
        {compare && previous && <span>
          Kỳ trước: {formatDate(period.previousFrom)} –{" "}
          {formatDate(period.previousTo)}
        </span>}
        {previous && <button type="button" className="ai-report-compare" aria-pressed={compare} onClick={() => setCompare(v => !v)}>So sánh kỳ trước</button>}
      </div>
      <div
        className="ai-report-tabs"
        role="group"
        aria-label="Nội dung báo cáo"
      >
        {tabs.map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={tab === key}
            aria-controls={id}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id={id}
        className="ai-report-body"
        role="region"
        aria-label={tabs.find(([key]) => key === tab)?.[1]}
      >
        {tab === "summary" && (
          <dl className="ai-report-metrics">
            {mainMetrics.map((key) => (
              <div key={key}>
                <dt>{aiReportLabels[key]}</dt>
                <dd>
                  <strong>{formatAIMetric(key, current[key])}</strong>
                  {compare && <small>
                    Kỳ trước: {formatAIMetric(key, previous?.[key])}
                  </small>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {tab === "details" && (
          <ReportTable
            headers={["Chỉ số", "Kỳ này", ...(compare ? ["Kỳ trước"] : [])]}
            rows={otherMetrics.map((key) => [
              aiReportLabels[key],
              formatAIMetric(key, current[key]),
              ...(compare ? [formatAIMetric(key, previous?.[key])] : []),
            ])}
          />
        )}
        {tab === "products" && (
          <ReportTable
            headers={["Sản phẩm", "Số lượng", "Giá trị sản phẩm", "Số đơn"]}
            rows={(data.products || []).map((p) => [
              p.name,
              formatAIMetric("quantity", p.quantity),
              formatAIMetric("item_value", p.item_value),
              formatAIMetric("orders_count", p.orders_count),
            ])}
          />
        )}
        {tab === "sources" && (
          <ReportTable
            headers={[
              "Kênh tiếp nhận",
              "Số đơn",
              "Giá trị đơn",
              "Doanh thu hoàn tất",
              "Còn phải thu",
            ]}
            rows={(data.sources || []).map((s) => [
              orderChannel(s).label,
              formatAIMetric("orders_count", s.orders_count),
              formatAIMetric("order_value", s.order_value),
              formatAIMetric("revenue", s.revenue),
              formatAIMetric("outstanding", s.outstanding),
            ])}
          />
        )}
        {tab === "deliveries" && (
          <ReportTable
            headers={["Ngày giao", "Tổng số đơn", "Đã giao", "Còn phải giao"]}
            rows={(data.deliveries || []).map((d) => [
              formatDate(d.day),
              formatAIMetric("orders_count", d.orders_count),
              formatAIMetric("delivered", d.delivered),
              formatAIMetric("remaining", d.remaining),
            ])}
          />
        )}
      </div>
      <details className="ai-report-definition">
        <summary>Cách tính số liệu</summary>
        <p>
          Thống kê theo đơn được tạo trong kỳ và trạng thái hiện tại. Doanh thu
          chỉ tính đơn đã hoàn tất (giao tận nơi hoặc nhận tại cửa hàng), gồm phí giao và giảm giá. Tiền đã thu ròng là số
          thu trừ số hoàn của nhóm đơn này; không phải dòng tiền theo ngày thu.
          Chưa bao gồm lợi nhuận. Lịch giao được tính theo ngày giao và không bao gồm đơn nhận tại cửa hàng.
        </p>
      </details>
    </section>
  );
}
