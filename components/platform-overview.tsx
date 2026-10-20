"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Store,
  Users,
  Wallet,
  TrendingUp,
  Package,
  UserCheck,
  Activity,
  Eye,
  ArrowUpRight,
} from "lucide-react";
import { api } from "./context";
import DateInput from "./date-input";
import Select from "./ui-select";
import { TableAction, TableActions } from "./table-actions";
import { money } from "./home";
import { formatDate, formatDateTime, hanoiDateKey } from "@/lib/date-time";
import { analyticsPeriod } from "@/lib/store-analytics";
import { displayLabel } from "@/lib/display-labels";

const labels: Record<string, string> = {
  products: "Sản phẩm",
  staff: "Nhân sự",
  storage_mb: "Dung lượng",
  email_sends: "Email/tháng",
  ai_messages: "AI/tháng",
};
const num = (n: number) =>
  Number(n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
const windowDays = (n: number) => ({
  from: hanoiDateKey(Date.now() - (n - 1) * 86400000),
  to: hanoiDateKey(),
});
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
  return (
    <section className="dashboard-panel">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{caption}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Table({
  headers,
  children,
  empty,
  stickyIdentity = false,
}: {
  headers: string[];
  children: ReactNode;
  empty?: boolean;
  stickyIdentity?: boolean;
}) {
  return (
    <div
      className={
        "table-scroll" + (stickyIdentity ? " platform-sticky-table" : "")
      }
    >
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
          {empty ? (
            <tr>
              <td colSpan={headers.length} className="analytics-empty">
                Chưa có dữ liệu phù hợp.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}
function Pager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="platform-report-pagination">
      <span>
        {num(total)} kết quả · Trang {page}/{Math.max(1, Math.ceil(total / 10))}
      </span>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Trước
        </button>
        <button
          className="button secondary"
          disabled={page * 10 >= total}
          onClick={() => onChange(page + 1)}
        >
          Sau
        </button>
      </div>
    </div>
  );
}
export default function PlatformOverview({
  refreshKey,
  onOpenStore,
}: {
  refreshKey: number;
  onOpenStore: (id: number) => void;
}) {
  const [filters, setFilters] = useState(() => ({
    ...windowDays(30),
    q: "",
    plan: "0",
    usage: "all",
    page: 1,
    user_q: "",
    user_page: 1,
  }));
  const [draft, setDraft] = useState(filters),
    [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [metric, setMetric] = useState("collected"),
    [selected, setSelected] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    const q = new URLSearchParams(
      Object.entries(filters).map(([k, v]) => [k, String(v)]),
    );
    api("platform/overview?" + q)
      .then((r) => {
        if (active) setData(r);
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
  }, [filters, refreshKey]);
  const choose = (days: number) => {
    const next = { ...filters, ...windowDays(days), page: 1 };
    setFilters(next);
    setDraft(next);
  };
  const stats = data?.stats || {},
    max = Math.max(
      1,
      ...(data?.daily?.map((d: any) => Number(d[metric])) || []),
    );
  const chartNames: Record<string, string> = {
    collected: "Phí SaaS thực thu",
    gmv: "GMV đơn đã giao",
    orders_count: "Đơn tạo trong kỳ",
    stores: "Cửa hàng đăng ký",
  };
  const activeDay = data?.daily?.find((d: any) => d.day === selected);
  return (
    <div className="platform-overview store-analytics">
      <div className="dashboard-panel analytics-toolbar">
        <div className="analytics-presets">
          {[7, 30, 90].map((n) => (
            <button
              key={n}
              className="analytics-preset"
              aria-pressed={
                filters.from === windowDays(n).from &&
                filters.to === windowDays(n).to
              }
              onClick={() => choose(n)}
            >
              {n} ngày
            </button>
          ))}
        </div>
        <form
          className="analytics-date-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              analyticsPeriod(draft.from, draft.to);
              setFilters({
                ...filters,
                from: draft.from,
                to: draft.to,
                page: 1,
              });
            } catch (err) {
              setError((err as Error).message);
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
      </div>
      <p className="analytics-context" role="status">
        {busy
          ? "Đang cập nhật số liệu…"
          : data
            ? `${formatDate(data.period.from)} – ${formatDate(data.period.to)} · Giờ Hà Nội · Cập nhật ${formatDateTime(data.generated_at)}`
            : "Chưa tải được số liệu"}
      </p>
      {error && (
        <p className="analytics-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <div className="dashboard-panel analytics-empty">
          {error
            ? "Vui lòng thử làm mới báo cáo."
            : "Đang tổng hợp hoạt động nền tảng…"}
        </div>
      ) : (
        <div className="analytics-results" aria-busy={busy}>
          <div className="stat-grid">
            {[
              [
                Store,
                "Cửa hàng",
                num(stats.stores),
                `${num(stats.approved)} đã duyệt · ${num(stats.pending)} chờ duyệt`,
              ],
              [
                Users,
                "Tài khoản",
                num(stats.users),
                `${num(stats.new_users)} đăng ký trong kỳ`,
              ],
              [
                Wallet,
                "Phí SaaS thực thu",
                money(stats.collected),
                "Tiền nhận trong kỳ từ sổ thanh toán",
              ],
              [
                TrendingUp,
                "MRR hiện tại",
                money(stats.mrr),
                `${num(stats.paid)} cửa hàng trả phí đang hoạt động`,
              ],
              [
                Package,
                "Đơn tạo trong kỳ",
                num(stats.orders),
                "Tất cả cửa hàng, bao gồm đơn hủy",
              ],
              [
                Wallet,
                "GMV đơn đã giao",
                money(stats.gmv),
                "Đơn tạo trong kỳ hiện đã giao",
              ],
              [
                UserCheck,
                "Tài khoản hoạt động",
                num(stats.active_users_30d),
                "Có tương tác được ghi nhận trong 30 ngày",
              ],
              [
                Activity,
                "Cửa hàng chạm hạn mức",
                num(stats.near_limit),
                "Ít nhất một hạn mức sử dụng từ 80%",
              ],
            ].map(([Icon, title, value, caption]: any) => (
              <div className="stat-card" key={title}>
                <div>
                  <span>{title}</span>
                  <Icon size={18} />
                </div>
                <strong>{value}</strong>
                <small>{caption}</small>
              </div>
            ))}
          </div>
          <div className="dashboard-grid">
            <Panel
              title="Nhịp hoạt động nền tảng"
              caption="Biểu đồ theo ngày trong khoảng đã chọn"
              action={
                <Select
                  aria-label="Chỉ số biểu đồ"
                  value={metric}
                  onChange={(e) => {
                    setMetric(e.target.value);
                    setSelected("");
                  }}
                >
                  {Object.entries(chartNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              }
            >
              <div className="platform-chart-scroll">
                <div
                  className="platform-chart-plot"
                  style={{ minWidth: Math.max(260, data.daily.length * 12) }}
                >
                  {data.daily.map((d: any, i: number) => (
                    <button
                      key={d.day}
                      className="platform-chart-bar"
                      aria-label={`${formatDate(d.day)}: ${metric === "gmv" || metric === "collected" ? money(d[metric]) : num(d[metric])}`}
                      aria-pressed={selected === d.day}
                      onClick={() => setSelected(d.day)}
                      title={`${formatDate(d.day)} · ${num(d[metric])}`}
                    >
                      <span
                        style={{
                          height:
                            Math.max(1, (Number(d[metric]) / max) * 100) + "%",
                        }}
                      />
                      <small>
                        {i % Math.max(1, Math.ceil(data.daily.length / 15)) ===
                        0
                          ? d.day.slice(8)
                          : ""}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
              <p className="platform-chart-caption">
                {activeDay
                  ? `${formatDate(activeDay.day)} · ${chartNames[metric]}: ${metric === "gmv" || metric === "collected" ? money(activeDay[metric]) : num(activeDay[metric])}`
                  : `${chartNames[metric]} · Chọn cột để xem số liệu từng ngày`}
              </p>
            </Panel>
            <Panel
              title="Cơ cấu gói dịch vụ"
              caption="Ảnh chụp hiện tại · Free và trial không tính vào MRR"
            >
              <Table
                headers={["Gói", "Cửa hàng", "Trả phí", "MRR"]}
                empty={!data.plans.length}
              >
                {data.plans.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>{num(p.stores)}</td>
                    <td>{num(p.paid)}</td>
                    <td>{money(p.mrr)}</td>
                  </tr>
                ))}
              </Table>
              <p className="platform-chart-caption">
                {num(stats.free)} đang Free · {num(stats.trialing)} đang thử ·{" "}
                {num(stats.needs_sync)} quyền đã hết hạn chờ đồng bộ. MRR dùng
                giá phiên bản đã cấp, không phải tiền thực thu.
              </p>
            </Panel>
          </div>
          <Panel
            title="Cần theo dõi"
            caption="Tình trạng hiện tại, độc lập với bộ lọc ngày"
          >
            <div className="platform-alert-grid">
              {[
                ["Chờ duyệt cửa hàng", stats.pending, "/platform/stores"],
                [
                  "Gói hết hạn trong 5 ngày",
                  stats.expiring,
                  "/platform/stores",
                ],
                [
                  "Cửa hàng có hóa đơn quá hạn",
                  stats.overdue,
                  "/platform/invoices",
                ],
                ["Đóng băng thủ công", stats.suspended, "/platform/stores"],
                [
                  "Cửa hàng vắng hoạt động 14 ngày",
                  stats.inactive,
                  "/platform/stores",
                ],
                [
                  "Email lỗi / chưa rõ kết quả",
                  data.health.email_issues,
                  "/platform/emails",
                ],
                [
                  "Giao dịch cần đối soát",
                  data.health.payment_issues,
                  "/platform/config",
                ],
                [
                  "Lỗi AI trong 24 giờ",
                  data.health.ai_failures,
                  "/platform/config",
                ],
                [
                  "Báo lỗi đang xử lý",
                  data.health.open_issues,
                  "/platform/config",
                ],
              ].map(([title, count, href]: any) => (
                <Link
                  className={
                    "platform-alert" + (Number(count) > 0 ? " has-alert" : "")
                  }
                  href={href}
                  key={title}
                >
                  <div>
                    <span>{title}</span>
                    <strong>{num(count)}</strong>
                  </div>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          </Panel>
          <Panel
            title="Hạn mức sử dụng của cửa hàng"
            caption="Dùng hạn mức phiên bản đã cấp. Email/AI theo tháng lịch Hà Nội; các mục khác là số lượng hiện tại."
          >
            <form
              className="platform-report-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setFilters({
                  ...filters,
                  q: draft.q,
                  plan: draft.plan,
                  usage: draft.usage,
                  page: 1,
                });
              }}
            >
              <label>
                Tìm cửa hàng
                <input
                  value={draft.q}
                  onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                  placeholder="Tên cửa hàng hoặc email chủ cửa hàng"
                />
              </label>
              <label>
                Gói dịch vụ
                <Select
                  value={draft.plan}
                  onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
                >
                  <option value="0">Tất cả gói</option>
                  {data.plans.map((p: any) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Mức sử dụng
                <Select
                  value={draft.usage}
                  onChange={(e) =>
                    setDraft({ ...draft, usage: e.target.value })
                  }
                >
                  <option value="all">Tất cả mức sử dụng</option>
                  <option value="near">Từ 80% hạn mức</option>
                </Select>
              </label>
              <button className="button" disabled={busy}>
                Lọc cửa hàng
              </button>
            </form>
            <Table
              headers={[
                "Cửa hàng / Gói",
                ...Object.values(labels),
                "Hoạt động gần nhất",
                "Thao tác",
              ]}
              empty={!data.usage.rows.length}
              stickyIdentity
            >
              {data.usage.rows.map((s: any) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <small>
                      {s.plan_name || "Chưa có gói"} ·{" "}
                      {displayLabel("store", s.status)}
                    </small>
                    {s.expired && (
                      <small className="platform-usage-warning">
                        Quyền gói đã hết hạn, chờ đồng bộ
                      </small>
                    )}
                  </td>
                  {Object.keys(labels).map((k) => {
                    const u = s.usage[k];
                    return (
                      <td key={k}>
                        <div className={"platform-quota " + u.level}>
                          <strong>
                            {num(u.used)} / {num(u.limit)}
                            {k === "storage_mb" ? " MB" : ""}
                          </strong>
                          <div className="usage-track">
                            <span
                              style={{ width: Math.min(100, u.percent) + "%" }}
                            />
                          </div>
                          <small>
                            {num(u.percent)}%
                            {u.level === "over"
                              ? " · Vượt hạn mức"
                              : u.level === "full"
                                ? " · Đã hết hạn mức"
                                : u.level === "near"
                                  ? " · Sắp chạm hạn mức"
                                  : ""}
                          </small>
                        </div>
                      </td>
                    );
                  })}
                  <td>
                    {s.last_activity_at
                      ? formatDateTime(s.last_activity_at)
                      : "Chưa ghi nhận"}
                    <small>
                      {s.last_seen_at
                        ? "Workspace: " + formatDateTime(s.last_seen_at, "utc")
                        : "Chưa ghi nhận truy cập workspace"}
                    </small>
                  </td>
                  <td>
                    <TableActions>
                      <TableAction
                        aria-label={"Xem cửa hàng " + s.name}
                        title={"Xem cửa hàng " + s.name}
                        icon={Eye}
                        onClick={() => onOpenStore(s.id)}
                      />
                    </TableActions>
                  </td>
                </tr>
              ))}
            </Table>
            <Pager
              page={data.usage.page}
              total={data.usage.total}
              onChange={(page) => setFilters({ ...filters, page })}
            />
          </Panel>
          <div className="dashboard-grid">
            <Panel
              title="Cửa hàng nổi bật trong kỳ"
              caption="Xếp theo GMV đơn tạo trong kỳ đã giao · không phải doanh thu nền tảng"
            >
              <Table
                headers={[
                  "Cửa hàng",
                  "Đơn",
                  "GMV",
                  "Phí SaaS đã thu",
                  "Thao tác",
                ]}
                empty={!data.top_stores.length}
              >
                {data.top_stores.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      <small>
                        {s.last_activity_at
                          ? formatDateTime(s.last_activity_at)
                          : "Chưa ghi nhận hoạt động"}
                      </small>
                    </td>
                    <td>{num(s.orders)}</td>
                    <td>{money(s.gmv)}</td>
                    <td>{money(s.collected)}</td>
                    <td>
                      <TableActions>
                        <TableAction
                          aria-label={"Xem cửa hàng " + s.name}
                          title={"Xem cửa hàng " + s.name}
                          icon={Eye}
                          onClick={() => onOpenStore(s.id)}
                        />
                      </TableActions>
                    </td>
                  </tr>
                ))}
              </Table>
            </Panel>
            <Panel
              title="Cách đọc số liệu"
              caption="Phân biệt dòng tiền, gói hiện tại và mức sử dụng"
            >
              <ul className="platform-metric-notes">
                <li>
                  Phí SaaS thực thu lấy từ các lần nhận tiền, kể cả thanh toán
                  một phần. Không cộng giá trị đơn hoa.
                </li>
                <li>
                  MRR là tổng giá tháng của gói trả phí có hiệu lực ở cửa hàng
                  đã duyệt, loại Free, dùng thử và quyền đã hết hạn.
                </li>
                <li>
                  GMV dựa trên ngày tạo đơn, chỉ cộng các đơn hiện đã giao. Đơn
                  hủy không tính vào GMV.
                </li>
                <li>
                  Hoạt động cửa hàng là lần gần nhất có tương tác workspace,
                  thao tác được lưu hoặc đơn mới. Không xem cập nhật billing tự
                  động là hoạt động của cửa hàng.
                </li>
                <li>
                  Không suy đoán dữ liệu trước lúc bật theo dõi; giữ nguyên dữ
                  liệu khi vượt hạn mức.
                </li>
              </ul>
            </Panel>
          </div>
          <Panel
            title="Hoạt động tài khoản"
            caption="Lần tương tác được ghi nhận gần nhất · không đồng nghĩa đang online"
          >
            <form
              className="platform-report-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setFilters({ ...filters, user_q: draft.user_q, user_page: 1 });
              }}
            >
              <label>
                Tìm tài khoản
                <input
                  value={draft.user_q}
                  onChange={(e) =>
                    setDraft({ ...draft, user_q: e.target.value })
                  }
                  placeholder="Tên hoặc email"
                />
              </label>
              <button className="button" disabled={busy}>
                Lọc tài khoản
              </button>
            </form>
            <Table
              headers={[
                "Tài khoản",
                "Vai trò / Cửa hàng",
                "Đăng ký",
                "Hoạt động gần nhất",
                "Trạng thái",
              ]}
              empty={!data.users.rows.length}
              stickyIdentity
            >
              {data.users.rows.map((u: any) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                  </td>
                  <td>
                    {Boolean(u.platform_admin) && (
                      <span className="tag">Quản trị nền tảng</span>
                    )}
                    {u.memberships.map((m: any) => (
                      <small key={m.store_id}>
                        {m.role === "owner"
                          ? "Quản trị cửa hàng"
                          : displayLabel("role", m.role)}{" "}
                        · {m.store_name}
                      </small>
                    ))}
                    {!u.platform_admin && !u.memberships.length && "Khách hàng"}
                  </td>
                  <td>{formatDateTime(u.created_at)}</td>
                  <td>
                    {u.last_seen_at
                      ? formatDateTime(u.last_seen_at, "utc")
                      : "Chưa ghi nhận"}
                  </td>
                  <td>
                    <span className={"tag " + (u.active ? "success" : "")}>
                      {u.active ? "Hoạt động" : "Đã khóa"}
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
            <Pager
              page={data.users.page}
              total={data.users.total}
              onChange={(user_page) => setFilters({ ...filters, user_page })}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
