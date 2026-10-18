"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useShop, api } from "./context";
import { money } from "./home";
import PlatformUsers from "./platform-users";
import {
  Menu,
  Store,
  BarChart3,
  Receipt,
  Users,
  Activity,
  ArrowUpRight,
} from "lucide-react";
const statusLabels: Record<
  "store" | "subscription" | "invoice" | "task" | "notification" | "email",
  Record<string, string>
> = {
  store: {
    draft: "Bản nháp",
    pending: "Chờ duyệt",
    approved: "Đã duyệt",
    rejected: "Đã từ chối",
    suspended: "Tạm đình chỉ",
    closed: "Đã đóng",
  },
  subscription: {
    free: "Miễn phí",
    active: "Đang hoạt động",
    past_due: "Quá hạn thanh toán",
    restricted: "Bị hạn chế",
    cancelled: "Đã hủy",
  },
  invoice: {
    open: "Chờ thanh toán",
    paid: "Đã thanh toán",
    void: "Đã hủy",
  },
  task: { open: "Chưa hoàn tất", done: "Đã hoàn tất" },
  notification: {
    pending: "Chờ xử lý",
    working: "Đang xử lý",
    done: "Đã xử lý",
  },
  email: {
    pending: "Chờ gửi",
    sending: "Đang gửi",
    sent: "Đã gửi",
    failed: "Gửi thất bại",
    uncertain: "Chưa xác định kết quả gửi",
    cancelled: "Đã hủy",
  },
};
function statusText(kind: keyof typeof statusLabels, value: string) {
  return statusLabels[kind][value] || "Không xác định";
}
export default function Platform({ area = "overview" }: { area?: string }) {
  const { user, ready, toast } = useShop(),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [detail, setDetail] = useState<any>(null),
    [mobile, setMobile] = useState(false);
  const [usersRefresh, setUsersRefresh] = useState(0);
  const merchantDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = merchantDialog.current;
    if (!detail || !dialog) return;
    const { overflow, paddingRight } = document.body.style;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0)
      document.body.style.paddingRight =
        parseFloat(getComputedStyle(document.body).paddingRight) +
        scrollbar +
        "px";
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [detail?.store.id]);
  async function refresh() {
    if (area === "users") {
      setUsersRefresh((v) => v + 1);
      return;
    }
    try {
      setData(await api("platform/" + area));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setData(null);
    setDetail(null);
    if (user?.platformRole === "platform_admin") void refresh();
  }, [area, user]);
  async function loadStore(id: number) {
    try {
      setDetail(await api("platform/stores/" + id));
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function action(path: string, method: string, body: any) {
    try {
      await api("platform/" + path, method, body);
      toast("Đã cập nhật.");
      await refresh();
      if (detail) await loadStore(detail.store.id);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  if (!ready) return <main className="page">Đang xác thực…</main>;
  if (user?.platformRole !== "platform_admin")
    return (
      <main className="page">
        <h1>Quản trị nền tảng</h1>
        <p>Bạn cần quyền admin@platform để truy cập.</p>
        <Link className="button" href="/login?next=/platform">
          Đăng nhập
        </Link>
      </main>
    );
  const nav = [
    ["overview", "Tổng quan", BarChart3],
    ["stores", "Cửa hàng & Merchant CRM", Store],
    ["invoices", "Hóa đơn dịch vụ", Receipt],
    ["users", "Tài khoản", Users],
    ["health", "Tích hợp & hàng đợi", Activity],
  ] as const;
  return (
    <div className="admin-shell platform-shell">
      <aside className={"admin-sidebar " + (mobile ? "mobile-open" : "")}>
        <Link className="logo" href="/">
          fleur<span>®</span>
        </Link>
        <div className="workspace-label">PLATFORM CONSOLE</div>
        <nav>
          {nav.map(([k, t, I]) => (
            <Link
              className={area === k ? "active" : ""}
              href={"/platform/" + k}
              key={k}
              onClick={() => setMobile(false)}
            >
              <I size={18} />
              {t}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>
            {user.name}
            <br />
            <small>admin@platform</small>
          </p>
          <Link href="/account">Tài khoản của tôi</Link>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <button
            className="icon-button admin-menu"
            aria-label="Mở menu"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <strong>Fleur Platform</strong>
          <Link href="/">
            Xem marketplace <ArrowUpRight size={17} />
          </Link>
        </header>
        <main className="admin-content">
          <div className="admin-heading">
            <div>
              <span className="eyebrow">THE BIGGER PICTURE</span>
              <h1>{nav.find((n) => n[0] === area)?.[1] || "Tổng quan"}</h1>
              <p>Vận hành nền tảng và đồng hành cùng những tiệm hoa.</p>
            </div>
            <button className="button secondary" onClick={() => void refresh()}>
              Làm mới
            </button>
          </div>
          {area === "users" ? (
            <PlatformUsers refreshKey={usersRefresh} />
          ) : error ? (
            <p className="error">{error}</p>
          ) : !data ? (
            <p>Đang tải dữ liệu…</p>
          ) : area === "overview" ? (
            <>
              <div className="stat-grid">
                {[
                  ["Cửa hàng", data.stats.stores],
                  ["Chờ duyệt", data.stats.pending],
                  ["Tài khoản", data.stats.users],
                  ["Đơn hàng", data.stats.orders_count],
                  ["GMV đơn đã giao", money(data.stats.gmv)],
                  ["Phí SaaS đã thu", money(data.stats.collected)],
                ].map(([k, v]) => (
                  <div className="stat-card" key={k}>
                    <small>{k}</small>
                    <h2>{v}</h2>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h3>Giao dịch trên nền tảng</h3>
                <div className="analytics-chart">
                  {data.revenue.map((d: any) => (
                    <div key={d.day}>
                      <span>{d.day}</span>
                      <div
                        style={{
                          width:
                            Math.max(
                              1,
                              (100 * d.gmv) /
                                Math.max(
                                  1,
                                  ...data.revenue.map((x: any) => x.gmv),
                                ),
                            ) + "%",
                        }}
                      />
                      <strong>
                        {money(d.gmv)} · {d.orders_count} đơn
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="small">
                  GMV tính trên đơn đã giao. Phí SaaS chỉ tính từ giao dịch thu
                  phí dịch vụ đã ghi nhận.
                </p>
              </div>
              <div className="panel">
                <h3>Danh mục gói dịch vụ</h3>
                {data.plans.map((p: any) => (
                  <p key={p.id}>
                    {p.name} · {money(p.monthly_price)} / tháng
                  </p>
                ))}
              </div>
            </>
          ) : area === "stores" ? (
            <>
              <div className="board-toolbar">
                <input
                  aria-label="Tìm store"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tên store, email chủ store…"
                />
                <select
                  aria-label="Trạng thái store"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">Tất cả trạng thái</option>
                  {[
                    "draft",
                    "pending",
                    "approved",
                    "rejected",
                    "suspended",
                    "closed",
                  ].map((v) => (
                    <option key={v} value={v}>
                      {statusText("store", v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Cửa hàng</th>
                      <th>Trạng thái</th>
                      <th>Gói</th>
                      <th>Đơn</th>
                      <th>GMV</th>
                      <th>Khách hàng</th>
                      <th>Đơn gần nhất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data
                      .filter(
                        (s: any) =>
                          (!filter || s.status === filter) &&
                          JSON.stringify(s)
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((s: any) => (
                        <tr
                          key={s.id}
                          onClick={() => void loadStore(s.id)}
                          className="clickable"
                        >
                          <td>
                            <button className="text-button">{s.name}</button>
                            <small>{s.owner_email}</small>
                          </td>
                          <td>
                            <span className="tag">
                              {statusText("store", s.status)}
                            </span>
                          </td>
                          <td>
                            {s.plan} ·{" "}
                            {statusText("subscription", s.subscription_status)}
                          </td>
                          <td>{s.orders_count}</td>
                          <td>{money(s.gmv)}</td>
                          <td>{s.customers}</td>
                          <td>{s.last_order || "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : area === "invoices" ? (
            <>
              <form
                className="panel board-toolbar"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(
                    "invoices/generate",
                    "POST",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                }}
              >
                <label>
                  Kỳ{" "}
                  <input
                    type="month"
                    name="period"
                    defaultValue={new Date().toISOString().slice(0, 7)}
                    required
                  />
                </label>
                <label>
                  Hạn thanh toán <input type="date" name="due_date" required />
                </label>
                <button className="button">Tạo hóa đơn tháng</button>
              </form>
              <div className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Store</th>
                      <th>Kỳ</th>
                      <th>Gói</th>
                      <th>Tiền</th>
                      <th>Đã thu</th>
                      <th>Trạng thái</th>
                      <th>Ghi nhận thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((i: any) => (
                      <tr key={i.id}>
                        <td>{i.store_name}</td>
                        <td>{i.period_key}</td>
                        <td>{i.plan_name}</td>
                        <td>{money(i.amount)}</td>
                        <td>{money(i.paid)}</td>
                        <td>{statusText("invoice", i.status)}</td>
                        <td>
                          {i.status === "open" && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const f = Object.fromEntries(
                                  new FormData(e.currentTarget),
                                );
                                void action(
                                  "invoices/" + i.id + "/payment",
                                  "POST",
                                  { ...f, amount: Number(f.amount) },
                                );
                              }}
                            >
                              <input
                                aria-label="Số tiền"
                                type="number"
                                name="amount"
                                min="1"
                                max={i.amount - i.paid}
                                required
                                placeholder="Số tiền"
                              />
                              <input
                                aria-label="Mã giao dịch"
                                name="reference"
                                minLength={5}
                                required
                                placeholder="Mã giao dịch"
                              />
                              <button className="button secondary">
                                Ghi nhận
                              </button>
                            </form>
                          )}
                          {i.status === "open" && i.paid === 0 && (
                            <details>
                              <summary>Hủy hóa đơn</summary>
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = Object.fromEntries(
                                    new FormData(e.currentTarget),
                                  );
                                  void action(
                                    "invoices/" + i.id + "/void",
                                    "POST",
                                    f,
                                  );
                                }}
                              >
                                <input
                                  name="reason"
                                  aria-label="Lý do hủy hóa đơn"
                                  minLength={5}
                                  maxLength={500}
                                  placeholder="Lý do hủy"
                                  required
                                />
                                <button className="button secondary">
                                  Xác nhận hủy
                                </button>
                              </form>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="dashboard-grid">
              {["google", "goong", "push", "smtp"].map((k) => (
                <div className="panel" key={k}>
                  <h3>{k.toUpperCase()}</h3>
                  <p>{data[k] ? "Đã có cấu hình" : "Chưa có cấu hình"}</p>
                </div>
              ))}
              <div className="panel">
                <h3>Hàng đợi thông báo</h3>
                {data.jobs?.map((r: any) => (
                  <p key={r.status}>
                    {statusText("notification", r.status)}: {r.count}
                  </p>
                ))}
              </div>
              <div className="panel">
                <h3>Hàng đợi email</h3>
                {data.emails?.map((r: any) => (
                  <p key={r.status}>
                    {statusText("email", r.status)}: {r.count}
                  </p>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
      {detail && (
        <dialog
          ref={merchantDialog}
          className="modal merchant-detail"
          aria-label="Hồ sơ cửa hàng"
          onCancel={(e) => {
            e.preventDefault();
            setDetail(null);
          }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              setDetail(null);
          }}
        >
          <div className="flex-between">
            <h2>{detail.store.name}</h2>
            <button
              className="icon-button"
              aria-label="Đóng"
              onClick={() => setDetail(null)}
            >
              ✕
            </button>
          </div>
          <p>
            {detail.store.address} · {detail.store.phone}
          </p>
          <p>Trạng thái: {statusText("store", detail.store.status)}</p>
          <Link href={"/s/" + detail.store.slug} target="_blank">
            Xem storefront ↗
          </Link>
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              void action("stores/" + detail.store.id + "/status", "PATCH", {
                ...f,
                version: detail.store.version,
              });
            }}
          >
            <h3>Vận hành store</h3>
            <label className="field">
              Chuyển trạng thái
              <select name="status">
                {["approved", "rejected", "suspended", "closed"].map((s) => (
                  <option key={s} value={s}>
                    {statusText("store", s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Lý do
              <textarea name="reason" minLength={5} required />
            </label>
            <button className="button">Cập nhật trạng thái</button>
          </form>
          <form
            className="panel"
            key={detail.subscription?.version}
            onSubmit={(e) => {
              e.preventDefault();
              const f: any = Object.fromEntries(new FormData(e.currentTarget));
              void action(
                "stores/" + detail.store.id + "/subscription",
                "PATCH",
                {
                  ...f,
                  plan_id: Number(f.plan_id),
                  period_end: f.period_end || null,
                  version: detail.subscription.version,
                },
              );
            }}
          >
            <h3>Gói dịch vụ</h3>
            <label className="field">
              Gói
              <select
                name="plan_id"
                defaultValue={detail.subscription?.plan_id}
              >
                <option value="1">Khởi đầu</option>
                <option value="2">Studio</option>
                <option value="3">Atelier</option>
              </select>
            </label>
            <label className="field">
              Trạng thái
              <select name="status" defaultValue={detail.subscription?.status}>
                {["free", "active", "past_due", "restricted", "cancelled"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {statusText("subscription", s)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              Cuối kỳ
              <input
                type="date"
                name="period_end"
                defaultValue={detail.subscription?.period_end || ""}
              />
            </label>
            <button className="button secondary">Lưu gói</button>
          </form>
          <div className="panel">
            <h3>Merchant CRM · Việc chăm sóc</h3>
            {detail.tasks.map((t: any) => (
              <div key={t.id}>
                <strong>{t.title}</strong>
                <p>{t.note}</p>
                <small>
                  {t.due_date} · {statusText("task", t.status)}
                </small>
                <button
                  className="text-button"
                  onClick={() =>
                    void action(
                      "stores/" + detail.store.id + "/tasks/" + t.id,
                      "PATCH",
                      { status: t.status === "open" ? "done" : "open" },
                    )
                  }
                >
                  {t.status === "open" ? "Hoàn tất" : "Mở lại"}
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget));
                void action("stores/" + detail.store.id + "/tasks", "POST", {
                  ...f,
                  due_date: f.due_date || null,
                });
              }}
            >
              <label className="field">
                Việc cần làm
                <input name="title" required />
              </label>
              <label className="field">
                Ghi chú
                <textarea name="note" />
              </label>
              <label className="field">
                Hạn
                <input name="due_date" type="date" />
              </label>
              <button className="button secondary">Thêm công việc</button>
            </form>
          </div>
          <div className="panel">
            <h3>Nhật ký</h3>
            {detail.audit.map((a: any) => (
              <p key={a.id}>
                {a.created_at} · {a.action} · {a.entity}
              </p>
            ))}
          </div>
        </dialog>
      )}
    </div>
  );
}
