"use client";
import DateInput from "./date-input";

import { Suspense, useEffect, useId, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  Wallet,
  Banknote,
  Package,
  CircleDollarSign,
  Download,
  RefreshCw,
  BarChart3,
  Truck,
} from "lucide-react";
import { api } from "./context";
import { money } from "./home";
import { Status } from "./pages";
import Select from "./ui-select";
import { analyticsPeriod, type StoreAnalytics } from "@/lib/store-analytics";
import { formatDate, hanoiDateKey } from "@/lib/date-time";
import { displayLabel } from "@/lib/display-labels";
import { orderChannel, orderStates } from "@/lib/order-workflow";

function Panel({
  title,
  caption,
  action,
  children,
}: {
  title: string;
  caption: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="dashboard-panel" aria-labelledby={id}>
      <div className="panel-heading">
        <div>
          <h3 id={id}>{title}</h3>
          <p>{caption}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function DataTable({
  headers,
  rows,
  empty = "Chưa có dữ liệu trong khoảng ngày đã chọn.",
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
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
              <td colSpan={headers.length} className="analytics-empty">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
const percent = (n: number, total: number) =>
  total
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
        (n / total) * 100,
      ) + "%"
    : "0%";
const progressWidth = (n: number, total: number) =>
  (total ? Math.min(100, Math.max(0, (n / total) * 100)) : 0) + "%";
function comparison(value: number, previous: number) {
  if (!previous)
    return value
      ? "Kỳ trước chưa có số liệu đối chiếu"
      : "Chưa thay đổi so với kỳ trước";
  const delta = ((value - previous) / Math.abs(previous)) * 100;
  return `${delta > 0 ? "+" : ""}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(delta)}% so với kỳ trước`;
}
function dateWindow(days: number) {
  return {
    from: hanoiDateKey(Date.now() - (days - 1) * 86400000),
    to: hanoiDateKey(),
  };
}
type ChartMetric = "order_value" | "revenue" | "collected";
const chartNames: Record<ChartMetric, string> = {
  order_value: "Giá trị đơn",
  revenue: "Doanh thu hoàn tất",
  collected: "Tiền đã thu ròng",
};

export default function StoreAnalyticsReport() {
  return <Suspense fallback={<p role="status">Đang tải báo cáo…</p>}><AnalyticsFromURL /></Suspense>;
}
function AnalyticsFromURL() {
  const params = useSearchParams();
  const from = params.get("from"), to = params.get("to");
  let initial = dateWindow(30);
  if (from && to) {
    try { analyticsPeriod(from, to); initial = { from, to }; } catch { /* Ignore invalid links; the normal filter remains available. */ }
  }
  return <AnalyticsReport key={`${from}:${to}`} initial={initial} />;
}
function AnalyticsReport({ initial }: { initial: { from: string; to: string } }) {
  const [period, setPeriod] = useState(initial);
  const [draft, setDraft] = useState(period);
  const [data, setData] = useState<StoreAnalytics | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [metric, setMetric] = useState<ChartMetric>("order_value");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api(`workspace/analytics?from=${period.from}&to=${period.to}`)
      .then((result) => {
        if (active) {
          setData(result);
          setSelected("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [period, reload]);
  const choose = (next: typeof period) => {
    setDraft(next);
    setPeriod(next);
  };
  const summary = data?.summary;
  const max = Math.max(
    1,
    ...(data?.daily.map((d) => Math.abs(d[metric])) || []),
  );
  const activeDay = data?.daily.find((d) => d.day === selected);
  const activeOrders = summary
    ? summary.orders_count - summary.cancellations
    : 0;
  function download() {
    if (!data) return;
    const csv = [
      [
        "Ngày tạo đơn",
        "Số đơn",
        "Đơn hủy",
        "Giá trị đơn không hủy (VNĐ)",
        "Doanh thu hoàn tất (VNĐ)",
        "Đã thu ròng (VNĐ)",
        "Còn phải thu (VNĐ)",
      ],
      ...data.daily.map((d) => [
        d.day,
        d.orders_count,
        d.cancellations,
        d.order_value,
        d.revenue,
        d.collected,
        d.outstanding,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv.map((r) => r.join(";")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `fleurious-analytics-${data.period.from}-${data.period.to}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="store-analytics">
      <div className="analytics-toolbar dashboard-panel">
        <div
          className="analytics-presets"
          aria-label="Khoảng thời gian báo cáo"
        >
          {[7, 30].map((days) => (
            <button
              type="button"
              key={days}
              className="analytics-preset"
              aria-pressed={
                period.from === dateWindow(days).from &&
                period.to === dateWindow(days).to
              }
              onClick={() => choose(dateWindow(days))}
            >
              {days} ngày
            </button>
          ))}
          <button
            type="button"
            className="analytics-preset"
            aria-pressed={
              period.from === hanoiDateKey().slice(0, 8) + "01" &&
              period.to === hanoiDateKey()
            }
            onClick={() =>
              choose({
                from: hanoiDateKey().slice(0, 8) + "01",
                to: hanoiDateKey(),
              })
            }
          >
            Tháng này
          </button>
        </div>
        <form
          className="analytics-date-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              analyticsPeriod(draft.from, draft.to);
              choose({ ...draft });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            Từ ngày
            <DateInput
              type="date"
              required
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </label>
          <label>
            Đến ngày
            <DateInput
              type="date"
              required
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </label>
          <button className="button" disabled={busy}>
            Áp dụng
          </button>
        </form>
        <div className="analytics-toolbar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Làm mới báo cáo"
            disabled={busy}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw size={16} className={busy ? "analytics-spinning" : ""} />
          </button>
          <button
            type="button"
            className="button outline"
            disabled={!data || busy}
            onClick={download}
          >
            <Download size={15} />
            Xuất CSV
          </button>
        </div>
      </div>
      {error && (
        <div className="analytics-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Thử lại
          </button>
        </div>
      )}
      <p className="analytics-context" role="status">
        {busy
          ? "Đang cập nhật báo cáo…"
          : data
            ? `${formatDate(data.period.from)} – ${formatDate(data.period.to)} · Giờ Hà Nội (UTC+7)`
            : "Không thể tải báo cáo."}
      </p>
      {!data || !summary ? (
        <div className="dashboard-panel analytics-empty">
          <BarChart3 size={28} />
          <p>
            {error
              ? "Vui lòng thử tải lại báo cáo."
              : "Đang tổng hợp hoạt động cửa hàng…"}
          </p>
        </div>
      ) : (
        <div className="analytics-results" aria-busy={busy}>
          <div className="stat-grid">
            {[
              {
                icon: Wallet,
                title: "Doanh thu hoàn tất",
                value: money(summary.revenue),
                caption: `${summary.delivered} đơn đã hoàn tất`,
                current: summary.revenue,
                previous: data.previous.revenue,
              },
              {
                icon: Banknote,
                title: "Tiền đã thu ròng",
                value: money(summary.collected),
                caption: "Đã thu trừ tiền đã hoàn",
                current: summary.collected,
                previous: data.previous.collected,
              },
              {
                icon: Package,
                title: "Đơn tạo trong kỳ",
                value: summary.orders_count,
                caption: `${activeOrders} đơn không hủy`,
                current: summary.orders_count,
                previous: data.previous.orders_count,
              },
              {
                icon: CircleDollarSign,
                title: "Còn phải thu",
                value: money(summary.outstanding),
                caption: "Số dư của đơn không hủy",
                current: summary.outstanding,
                previous: data.previous.outstanding,
              },
            ].map(
              ({ icon: Icon, title, value, caption, current, previous }) => (
                <div className="stat-card" key={title}>
                  <div>
                    <span>{title}</span>
                    <Icon size={18} />
                  </div>
                  <strong>{value}</strong>
                  <small>{caption}</small>
                  <small className="analytics-comparison">
                    {comparison(current, previous)}
                  </small>
                </div>
              ),
            )}
          </div>
          <div className="analytics-highlights">
            {[
              [
                "Giá trị đơn trung bình",
                money(
                  activeOrders
                    ? Math.round(summary.order_value / activeOrders)
                    : 0,
                ),
              ],
              ["Tỷ lệ đã giao", percent(summary.delivered, activeOrders)],
              [
                "Đơn hủy",
                `${summary.cancellations} · ${percent(summary.cancellations, summary.orders_count)}`,
              ],
              ["Tiền cần hoàn / trả lại", money(summary.refund_due)],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="analytics-note">
            Số liệu theo đơn tạo trong kỳ, với trạng thái và số dư hiện tại.
            Doanh thu gồm phí giao, đã trừ giảm giá; tiền thu có thể thay đổi
            sau kỳ. Kỳ trước: {formatDate(data.period.previousFrom)} –{" "}
            {formatDate(data.period.previousTo)}.
          </p>
          <div className="dashboard-grid">
            <Panel
              title="Nhịp kinh doanh"
              caption="Theo ngày tạo đơn · Chọn cột để xem chi tiết"
              action={
                <div className="analytics-chart-selector">
                  <Select
                    aria-label="Chỉ số biểu đồ"
                    value={metric}
                    onChange={(e) => setMetric(e.target.value as ChartMetric)}
                  >
                    {Object.entries(chartNames).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            >
              <div className="analytics-chart-scroll">
                <div
                  className="revenue-chart"
                  style={{
                    minWidth: Math.max(320, data.daily.length * 25 + 120),
                  }}
                >
                  <div className="chart-y">
                    <span>{money(max === 1 ? 1000000 : max)}</span>
                    <span>
                      {money(max === 1 ? 500000 : Math.round(max / 2))}
                    </span>
                    <span>0 VNĐ</span>
                  </div>
                  <div className="chart-bars">
                    {data.daily.map((d) => (
                      <button
                        type="button"
                        className={
                          "bar-group analytics-bar" +
                          (selected === d.day ? " is-selected" : "")
                        }
                        key={d.day}
                        aria-pressed={selected === d.day}
                        aria-label={`${formatDate(d.day)}: ${chartNames[metric]} ${money(d[metric])}, ${d.orders_count} đơn`}
                        title={`${formatDate(d.day)} · ${money(d[metric])}`}
                        onClick={() => setSelected(d.day)}
                      >
                        <div
                          className={d[metric] < 0 ? "is-negative" : ""}
                          style={{
                            height: d[metric]
                              ? Math.max(2, (Math.abs(d[metric]) / max) * 100) +
                                "%"
                              : "2px",
                          }}
                        />
                        <small>{d.day.slice(8)}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="analytics-chart-detail" aria-live="polite">
                {activeDay ? (
                  <>
                    <strong>{formatDate(activeDay.day)}</strong>
                    <span>
                      {activeDay.orders_count} đơn · {chartNames[metric]}:{" "}
                      {money(activeDay[metric])}
                    </span>
                  </>
                ) : (
                  <span>
                    {data.daily.some((d) => d[metric])
                      ? "Giá trị âm (nếu có) là tiền hoàn vượt tiền thu của nhóm đơn."
                      : "Chưa phát sinh giá trị cho chỉ số này trong kỳ."}
                  </span>
                )}
              </div>
            </Panel>
            <Panel
              title="Tiến trình đơn hàng"
              caption="Trạng thái hiện tại của đơn tạo trong kỳ"
            >
              <div className="analytics-breakdown">
                {orderStates.map((status) => {
                  const row = data.statuses.find((s) => s.status === status),
                    count = row?.count || 0;
                  return (
                    <div key={status}>
                      <div>
                        <Status value={status} />
                        <strong>
                          {count}
                          <small>
                            {" "}
                            · {percent(count, summary.orders_count)}
                          </small>
                        </strong>
                      </div>
                      <div className="small-progress">
                        <i
                          style={{
                            width: progressWidth(count, summary.orders_count),
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
          <Panel
            title="Hiệu quả kênh tiếp nhận"
            caption="Giá trị đơn và công nợ không tính đơn hủy; doanh thu chỉ tính đơn đã hoàn tất"
          >
            <DataTable
              headers={[
                "Kênh tiếp nhận",
                "Số đơn",
                "Tỷ trọng",
                "Giá trị đơn",
                "Đã hoàn tất",
                "Còn phải thu",
              ]}
              rows={data.sources.map((s) => {
                const channel = orderChannel(s);
                return [
                  <span
                    className={
                      "tag order-channel-tag order-channel-" + channel.key
                    }
                  >
                    {channel.label}
                  </span>,
                  s.orders_count,
                  percent(s.orders_count, summary.orders_count),
                  money(s.order_value),
                  money(s.revenue),
                  money(s.outstanding),
                ];
              })}
            />
          </Panel>
          <div className="dashboard-grid analytics-equal-grid">
            <Panel
              title="Thiết kế được chọn nhiều"
              caption="6 thiết kế dẫn đầu theo số lượng · Không tính đơn hủy"
            >
              <DataTable
                headers={["Thiết kế", "Số lượng", "Giá trị sản phẩm"]}
                rows={data.products.map((p) => [
                  <span className="analytics-product-name">
                    {String(p.name)}
                    {p.line_type === "custom" && <small>Thiết kế riêng</small>}
                  </span>,
                  Number(p.quantity),
                  money(Number(p.item_value)),
                ])}
              />
            </Panel>
            <Panel
              title="Bán hàng theo danh mục"
              caption="Giá trị sản phẩm trước giảm giá cấp đơn, chưa gồm phí giao"
            >
              <DataTable
                headers={["Danh mục", "Số lượng", "Giá trị sản phẩm"]}
                rows={data.categories.map((c) => [
                  String(c.name),
                  Number(c.quantity),
                  money(Number(c.item_value)),
                ])}
              />
            </Panel>
          </div>
          <div className="dashboard-grid analytics-equal-grid">
            <Panel
              title="Thanh toán & công nợ"
              caption="Theo phương thức thanh toán của đơn · Số dư đã trừ tiền hoàn"
            >
              <div className="analytics-payment-table">
                <DataTable
                  headers={[
                    "Phương thức",
                    "Số đơn",
                    "Đã thu ròng",
                    "Còn phải thu",
                    "Cần hoàn",
                  ]}
                  rows={data.payments.map((p) => [
                    p.method === "bank"
                      ? "Chuyển khoản"
                      : p.method === "counter" ? "Tại quầy" : p.method === "cod"
                        ? "Khi nhận hoa (COD)"
                        : "Khác",
                    p.orders_count,
                    money(p.collected),
                    money(p.outstanding),
                    money(p.refund_due),
                  ])}
                />
              </div>
              <div className="analytics-payment-footer">
                <div className="analytics-payment-counts">
                  <span>
                    Chưa thanh toán <strong>{summary.unpaid_count}</strong>
                  </span>
                  <span>
                    Thu một phần <strong>{summary.partial_count}</strong>
                  </span>
                  <span>
                    Đã thanh toán <strong>{summary.paid_count}</strong>
                  </span>
                </div>
                <p className="analytics-footnote">
                  Bộ đếm không tính đơn hủy. Tiền cần hoàn gồm tiền còn giữ của
                  đơn hủy và tiền nhận vượt tổng đơn.
                </p>
                {data.pickup?.orders_count > 0 && <div className="pickup-location-card">
                  <h4>Khách lấy tại cửa hàng · Trong kỳ</h4>
                  <p>{data.pickup.orders_count} đơn · Doanh thu {money(data.pickup.revenue)}</p>
                  <p>Còn phải thu tại quầy: <strong>{money(data.pickup.outstanding)}</strong></p>
                </div>}
                <section className="analytics-cod" aria-label="Theo dõi COD">
                  <div className="analytics-cod-heading">
                    <h4><Truck size={16} aria-hidden="true" />Theo dõi COD</h4>
                    <span>Khi nhận hoa</span>
                  </div>
                  <dl className="analytics-cod-metrics">
                    <div>
                      <dt>COD còn phải thu</dt>
                      <dd>{money(data.cod?.outstanding || 0)}</dd>
                      <dd className="analytics-cod-detail">{data.cod?.awaiting_count || 0} đơn · Hiện tại</dd>
                    </div>
                    <div className="analytics-cod-overdue">
                      <dt>Đã giao chưa thu đủ</dt>
                      <dd>{money(data.cod?.delivered_due || 0)}</dd>
                      <dd className="analytics-cod-detail">{data.cod?.delivered_count || 0} đơn · Trong số còn phải thu</dd>
                    </div>
                    <div>
                      <dt>Thực thu trong kỳ</dt>
                      <dd>{money(data.cod?.collected || 0)}</dd>
                      <dd className="analytics-cod-detail">Theo ngày nhận tiền</dd>
                    </div>
                  </dl>
                  <p className="analytics-cod-note">Còn phải thu tính toàn bộ đơn COD hiện tại. Thực thu theo khoảng ngày báo cáo, gồm cả đơn tạo trước kỳ; không tính sửa ghi nhầm, chưa trừ tiền hoàn.</p>
                </section>
              </div>
            </Panel>
            <Panel
              title="Khối lượng giao hoa"
              caption="7 ngày nhiều đơn nhất theo ngày giao trong kỳ · Không tính đơn hủy hoặc nhận tại cửa hàng"
            >
              <DataTable
                headers={["Ngày giao", "Tổng đơn", "Đã giao", "Còn lại"]}
                rows={data.deliveries.map((d) => [
                  formatDate(d.day),
                  Number(d.orders_count),
                  Number(d.delivered),
                  Number(d.remaining),
                ])}
              />
              <p className="analytics-footnote">
                Bao gồm cả đơn được tạo trước khoảng ngày báo cáo.
              </p>
            </Panel>
          </div>
          <div className="dashboard-grid analytics-equal-grid">
            <Panel
              title="Tệp khách hàng"
              caption="Toàn bộ hồ sơ CRM hiện tại · Không lọc theo ngày tạo đơn"
            >
              <div className="analytics-breakdown">
                {["new", "loyal", "vip", "inactive"].map((key) => {
                  const count =
                    data.segments.find((s) => s.segment === key)?.count || 0;
                  const total = data.segments.reduce((n, s) => n + s.count, 0);
                  return (
                    <div key={key}>
                      <div>
                        <span>{displayLabel("segment", key)}</span>
                        <strong>
                          {count} <small>· {percent(count, total)}</small>
                        </strong>
                      </div>
                      <div className="small-progress">
                        <i style={{ width: progressWidth(count, total) }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
            <Panel
              title="Tương tác cửa hàng"
              caption="Sự kiện ghi nhận trong khoảng ngày đã chọn"
            >
              <DataTable
                headers={["Hoạt động", "Lượt ghi nhận"]}
                rows={[
                  "store_view",
                  "product_view",
                  "add_to_cart",
                  "checkout_start",
                ].map((key) => [
                  displayLabel("interaction", key),
                  data.funnel.find((f) => f.name === key)?.count || 0,
                ])}
              />
              <p className="analytics-footnote">
                Một người có thể tạo nhiều sự kiện. Đây không phải số khách duy
                nhất hoặc tỷ lệ chuyển đổi.
              </p>
            </Panel>
          </div>
          <details className="dashboard-panel analytics-daily">
            <summary>
              Bảng số liệu từng ngày <span>{data.daily.length} ngày</span>
            </summary>
            <DataTable
              headers={[
                "Ngày tạo đơn",
                "Số đơn",
                "Đơn hủy",
                "Giá trị đơn",
                "Doanh thu hoàn tất",
                "Đã thu ròng",
                "Còn phải thu",
              ]}
              rows={data.daily.map((d) => [
                formatDate(d.day),
                d.orders_count,
                d.cancellations,
                money(d.order_value),
                money(d.revenue),
                money(d.collected),
                money(d.outstanding),
              ])}
            />
          </details>
        </div>
      )}
    </div>
  );
}
