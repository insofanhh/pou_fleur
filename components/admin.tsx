"use client";
import Link from "next/link";
import AdminNotifications from "./admin-notifications";
import EmailWorkspace from "./email-admin";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  LayoutDashboard,
  Flower2,
  Layers,
  Package,
  Tag,
  CalendarDays,
  Newspaper,
  Users,
  ContactRound,
  ShieldCheck,
  ArrowUpRight,
  ArrowRight,
  Search,
  Plus,
  Download,
  ChevronRight,
  Pencil,
  Trash2,
  X,
  Check,
  LogOut,
  MessageSquare,
  History,
  Menu,
  TrendingUp,
  Wallet,
  ClipboardList,
  Mail,
} from "lucide-react";
import type { Catalog } from "@/lib/types";
import { api, useShop } from "./context";
import { money } from "./home";
import { Status, statusNames } from "./pages";
const nav = [
  ["overview", "Tổng quan", LayoutDashboard],
  ["products", "Sản phẩm", Flower2],
  ["categories", "Danh mục", Layers],
  ["orders", "Đơn hàng", Package],
  ["promotions", "Khuyến mãi", Tag],
  ["events", "Sự kiện", CalendarDays],
  ["posts", "Tin tức", Newspaper],
  ["crm", "Khách hàng & CRM", ContactRound],
  ["emails", "Email & chương trình", Mail],
  ["inquiries", "Yêu cầu hỗ trợ", MessageSquare],
  ["users", "Người dùng & quyền", Users],
  ["audit", "Nhật ký hoạt động", History],
] as const;
const rights: Record<string, string[]> = {
  admin: nav.map((n) => n[0]),
  manager: [
    "overview",
    "products",
    "categories",
    "orders",
    "promotions",
    "events",
    "crm",
    "inquiries",
    "emails",
  ],
  editor: ["posts", "events"],
  support: ["orders", "crm", "inquiries", "emails"],
};
const roleNames: Record<string, string> = {
  admin: "Quản trị viên",
  manager: "Quản lý cửa hàng",
  editor: "Biên tập viên",
  support: "Chăm sóc khách hàng",
  customer: "Khách hàng",
};
type FieldDef = {
  key: string;
  label: string;
  type?: string;
  options?: [string, string][];
  required?: boolean;
};
const flag: [string, string][] = [
  ["1", "Đang hiển thị"],
  ["0", "Đã ẩn"],
];
const fields: Record<string, FieldDef[]> = {
  products: [
    { key: "name", label: "Tên thiết kế" },
    { key: "slug", label: "Đường dẫn (không dấu)" },
    { key: "category_id", label: "Danh mục", type: "category" },
    { key: "price", label: "Giá tiêu chuẩn (₫)", type: "number" },
    {
      key: "compare_price",
      label: "Giá gốc (tuỳ chọn)",
      type: "number",
      required: false,
    },
    { key: "stock", label: "Tồn kho", type: "number" },
    {
      key: "image",
      label: "Đường dẫn ảnh HTTPS hoặc ảnh tải lên",
      type: "text",
    },
    { key: "flowers", label: "Thành phần hoa" },
    { key: "description", label: "Mô tả", type: "textarea" },
    { key: "care", label: "Hướng dẫn chăm sóc", type: "textarea" },
    { key: "badge", label: "Nhãn sản phẩm", required: false },
    { key: "active", label: "Trạng thái", options: flag },
  ],
  categories: [
    { key: "name", label: "Tên danh mục" },
    { key: "slug", label: "Đường dẫn (không dấu)" },
    { key: "description", label: "Mô tả", type: "textarea" },
  ],
  promotions: [
    { key: "name", label: "Tên chương trình" },
    { key: "code", label: "Mã ưu đãi" },
    {
      key: "type",
      label: "Hình thức",
      options: [
        ["percent", "Phần trăm"],
        ["fixed", "Số tiền cố định"],
      ],
    },
    { key: "value", label: "Giá trị giảm", type: "number" },
    { key: "min_order", label: "Đơn tối thiểu (₫)", type: "number" },
    { key: "usage_limit", label: "Giới hạn lượt dùng", type: "number" },
    { key: "starts_at", label: "Bắt đầu", type: "datetime-local" },
    { key: "ends_at", label: "Kết thúc", type: "datetime-local" },
    { key: "active", label: "Trạng thái", options: flag },
  ],
  events: [
    { key: "name", label: "Tên sự kiện" },
    { key: "description", label: "Nội dung", type: "textarea" },
    { key: "starts_at", label: "Ngày bắt đầu", type: "date" },
    { key: "ends_at", label: "Ngày kết thúc", type: "date" },
    { key: "active", label: "Trạng thái", options: flag },
  ],
  posts: [
    { key: "title", label: "Tiêu đề" },
    { key: "slug", label: "Đường dẫn (không dấu)" },
    {
      key: "image",
      label: "Đường dẫn ảnh HTTPS hoặc ảnh tải lên",
      type: "text",
    },
    { key: "excerpt", label: "Tóm tắt", type: "textarea" },
    {
      key: "content",
      label: "Nội dung (xuống dòng để chia đoạn)",
      type: "textarea",
    },
    {
      key: "published",
      label: "Xuất bản",
      options: [
        ["0", "Bản nháp"],
        ["1", "Đã xuất bản"],
      ],
    },
  ],
  users: [
    { key: "name", label: "Họ tên" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Điện thoại", required: false },
    { key: "role", label: "Vai trò", options: Object.entries(roleNames) },
    {
      key: "active",
      label: "Trạng thái",
      options: [
        ["1", "Hoạt động"],
        ["0", "Đã khoá"],
      ],
    },
  ],
};
export default function Admin({ data }: { data: Catalog }) {
  const path = usePathname();
  const requested = path.split("/")[2] || "overview";
  const { user, setUser, ready, toast } = useShop();
  const area = requested;
  const [payload, setPayload] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<any>(null),
    [selected, setSelected] = useState<any>(null),
    [mobile, setMobile] = useState(false),
    [statusFilter, setStatusFilter] = useState("");
  const router = useRouter();
  const allowed = user ? rights[user.role] || [] : [];
  async function refresh() {
    setError("");
    if (!payload) setLoading(true);
    try {
      setPayload(await api("admin/" + area));
    } catch (e) {
      setError((e as Error).message);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setEditing(null);
    setSelected(null);
    setSearch("");
    setStatusFilter("");
    setLoading(true);
    if (user && allowed.includes(area)) void refresh();
  }, [area, user]);
  if (!ready)
    return <div className="admin-loading">Đang mở Fleur Workspace...</div>;
  if (!user || user.role === "customer")
    return (
      <div className="admin-gate">
        <Link className="logo" href="/">
          fleur<span>®</span>
        </Link>
        <ShieldCheck size={48} />
        <h1>Fleur Workspace.</h1>
        <p>
          Khu vực dành cho đội ngũ Fleur.
          <br />
          Vui lòng đăng nhập tài khoản được cấp quyền.
        </p>
        <Link className="button" href="/login?next=/admin">
          Đăng nhập <ArrowRight size={18} />
        </Link>
        <Link href="/" className="text-link">
          Trở về cửa hàng
        </Link>
      </div>
    );
  const currentNav = nav.find((n) => n[0] === area);
  const list = Array.isArray(payload) ? payload : [];
  const filtered = list.filter(
    (r) =>
      JSON.stringify(r).toLowerCase().includes(search.toLowerCase()) &&
      (!statusFilter || r.status === statusFilter),
  );
  async function archive(r: any) {
    if (
      !confirm(
        (area === "categories" ? "Xoá" : "Ẩn hoặc vô hiệu hoá") +
          " " +
          (r.name || r.title) +
          "?",
      )
    )
      return;
    try {
      await api("admin/" + area + "/" + r.id, "DELETE", {});
      toast("Đã cập nhật bản ghi.");
      void refresh();
      router.refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function transition(o: any, status: string) {
    try {
      await api("admin/orders/" + o.id, "PATCH", { status });
      toast("Đã cập nhật đơn hàng.");
      setSelected(null);
      void refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="admin-shell">
      <aside className={"admin-sidebar " + (mobile ? "mobile-open" : "")}>
        <Link href="/admin" className="logo">
          fleur<span>®</span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {nav
            .filter((n) => allowed.includes(n[0]))
            .map(([key, label, Icon], i) => (
              <Link
                href={"/admin/" + key}
                onClick={() => setMobile(false)}
                className={area === key ? "active" : ""}
                key={key}
              >
                <Icon size={18} />
                {label}
                {key === "orders" && payload?.stats?.pending_count > 0 && (
                  <span className="nav-badge">
                    {payload.stats.pending_count}
                  </span>
                )}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="admin-user">
            <span className="avatar">{user.name.charAt(0)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{roleNames[user.role]}</small>
            </div>
            <button
              aria-label="Đăng xuất"
              className="icon-button"
              onClick={async () => {
                await api("auth/logout", "POST", {});
                setUser(null);
                router.push("/login");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <button
            className="icon-button admin-menu"
            aria-label="Mở menu quản trị"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <span>
            Workspace <ChevronRight size={13} />{" "}
            <strong>{currentNav?.[1] || "Không tìm thấy"}</strong>
          </span>
          <div>
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-store-link"
            >
              <ArrowUpRight size={17} /> Xem cửa hàng
            </Link>
            <AdminNotifications
              key={`${user.id}:${user.role}`}
              userId={user.id}
            />
          </div>
        </header>
        <main className="admin-content">
          <div className="admin-heading">
            <div>
              <div className="eyebrow">FLEUR FLORAL STUDIO</div>
              <h1>
                {area === "overview"
                  ? "Mỗi ngày, một điều tốt đẹp."
                  : currentNav?.[1]}
              </h1>
              <p>
                {area === "overview"
                  ? "Chào " + user.name + ". Đây là hoạt động cửa hàng của bạn."
                  : area === "crm"
                    ? "Hiểu khách hàng hơn. Chăm sóc từ những điều nhỏ."
                    : "Quản lý và cập nhật thông tin cửa hàng."}
              </p>
            </div>
            <div>
              {area === "overview" ? (
                <span className="date-pill">
                  <CalendarDays size={16} />
                  {new Date().toLocaleDateString("vi-VN")}
                </span>
              ) : fields[area] && area !== "users" ? (
                <button className="button" onClick={() => setEditing({})}>
                  <Plus size={17} />
                  Thêm{" "}
                  {area === "products"
                    ? "sản phẩm"
                    : area === "categories"
                      ? "danh mục"
                      : area === "events"
                        ? "sự kiện"
                        : area === "posts"
                          ? "bài viết"
                          : "ưu đãi"}
                </button>
              ) : null}
            </div>
          </div>
          {!allowed.includes(area) ? (
            <div className="panel">
              <h2>Bạn chưa có quyền vào mục này.</h2>
              <p>Chọn một mục được cấp quyền từ menu.</p>
              <Link href={"/admin/" + allowed[0]} className="button">
                Mở workspace của bạn
              </Link>
            </div>
          ) : loading ? (
            <div className="panel loading-state">
              Đang tải dữ liệu cửa hàng...
            </div>
          ) : error ? (
            <div className="panel">
              <p className="error">{error}</p>
              <button className="button" onClick={() => void refresh()}>
                Thử lại
              </button>
            </div>
          ) : area === "overview" ? (
            <Overview payload={payload} />
          ) : area === "emails" ? (
            <EmailWorkspace
              payload={payload}
              refresh={refresh}
              canEdit={["admin", "manager"].includes(user.role)}
            />
          ) : area === "crm" ? (
            <CRM payload={payload} refresh={refresh} />
          ) : (
            <>
              {area === "users" && (
                <div className="role-explainer">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>Phân quyền theo vai trò</strong>
                    <p>
                      Quản trị viên: toàn bộ · Quản lý: vận hành & CRM · Biên
                      tập viên: tin tức & sự kiện · CSKH: đơn hàng & CRM. Tài
                      khoản mới đăng ký mặc định là khách hàng.
                    </p>
                  </div>
                </div>
              )}
              <div className="admin-table-panel">
                <div className="table-toolbar">
                  <label className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="Tìm trong danh sách"
                      placeholder="Tìm kiếm..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <span className="small">{filtered.length} bản ghi</span>
                  {area === "orders" && (
                    <select
                      aria-label="Trạng thái đơn"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="">Tất cả trạng thái</option>
                      {Object.entries(statusNames)
                        .slice(0, 6)
                        .map(([k, v]) => (
                          <option value={k} key={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {area === "products" ? (
                          <>
                            <th>Sản phẩm</th>
                            <th>Danh mục</th>
                            <th>Giá bán</th>
                            <th>Tồn kho</th>
                            <th>Trạng thái</th>
                          </>
                        ) : area === "orders" ? (
                          <>
                            <th>Mã đơn</th>
                            <th>Khách hàng</th>
                            <th>Ngày giao</th>
                            <th>Tổng tiền</th>
                            <th>Trạng thái</th>
                          </>
                        ) : area === "users" ? (
                          <>
                            <th>Người dùng</th>
                            <th>Email</th>
                            <th>Vai trò</th>
                            <th>Ngày tạo</th>
                            <th>Trạng thái</th>
                          </>
                        ) : area === "promotions" ? (
                          <>
                            <th>Chương trình</th>
                            <th>Mã ưu đãi</th>
                            <th>Giá trị</th>
                            <th>Lượt dùng</th>
                            <th>Trạng thái</th>
                          </>
                        ) : area === "events" ? (
                          <>
                            <th>Sự kiện</th>
                            <th>Bắt đầu</th>
                            <th>Kết thúc</th>
                            <th>Trạng thái</th>
                          </>
                        ) : area === "posts" ? (
                          <>
                            <th>Bài viết</th>
                            <th>Đường dẫn</th>
                            <th>Ngày tạo</th>
                            <th>Trạng thái</th>
                          </>
                        ) : area === "inquiries" ? (
                          <>
                            <th>Khách hàng</th>
                            <th>Email</th>
                            <th>Lời nhắn</th>
                            <th>Trạng thái</th>
                          </>
                        ) : area === "audit" ? (
                          <>
                            <th>Người thực hiện</th>
                            <th>Thao tác</th>
                            <th>Đối tượng</th>
                            <th>Thời gian</th>
                          </>
                        ) : (
                          <>
                            <th>Danh mục</th>
                            <th>Đường dẫn</th>
                            <th>Mô tả</th>
                          </>
                        )}
                        {area !== "audit" && <th aria-label="Thao tác" />}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id}>
                          {area === "products" ? (
                            <>
                              <td>
                                <div className="table-product">
                                  <img src={r.image} alt="" />
                                  <div>
                                    <strong>{r.name}</strong>
                                    <small>
                                      FL-{String(r.id).padStart(4, "0")}
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                {
                                  data.categories.find(
                                    (c) => c.id === r.category_id,
                                  )?.name
                                }
                              </td>
                              <td>{money(r.price)}</td>
                              <td>
                                <span
                                  className={r.stock < 5 ? "low-stock" : ""}
                                >
                                  {r.stock}
                                </span>
                              </td>
                              <td>
                                <Flag active={r.active} />
                              </td>
                            </>
                          ) : area === "orders" ? (
                            <>
                              <td>
                                <button
                                  className="text-button emphasis"
                                  onClick={() => setSelected(r)}
                                >
                                  {r.reference}
                                </button>
                              </td>
                              <td>
                                {r.customer_name}
                                <small className="block">{r.email}</small>
                              </td>
                              <td>
                                {r.delivery_date}
                                <small className="block">
                                  {r.delivery_slot}
                                </small>
                              </td>
                              <td>{money(r.total)}</td>
                              <td>
                                <Status value={r.status} />
                              </td>
                            </>
                          ) : area === "users" ? (
                            <>
                              <td>
                                <div className="table-product">
                                  <span className="avatar">
                                    {r.name.charAt(0)}
                                  </span>
                                  <strong>{r.name}</strong>
                                </div>
                              </td>
                              <td>{r.email}</td>
                              <td>
                                <span className="role-tag">
                                  {roleNames[r.role]}
                                </span>
                              </td>
                              <td>{r.created_at?.slice(0, 10)}</td>
                              <td>
                                <Flag active={r.active} />
                              </td>
                            </>
                          ) : area === "promotions" ? (
                            <>
                              <td>
                                <strong>{r.name}</strong>
                                <small className="block">
                                  Từ {money(r.min_order)}
                                </small>
                              </td>
                              <td>
                                <code>{r.code}</code>
                              </td>
                              <td>
                                {r.type === "percent"
                                  ? r.value + "%"
                                  : money(r.value)}
                              </td>
                              <td>
                                {r.used} / {r.usage_limit}
                              </td>
                              <td>
                                <Flag active={r.active} />
                              </td>
                            </>
                          ) : area === "events" ? (
                            <>
                              <td>
                                <strong>{r.name}</strong>
                              </td>
                              <td>{r.starts_at}</td>
                              <td>{r.ends_at}</td>
                              <td>
                                <Flag active={r.active} />
                              </td>
                            </>
                          ) : area === "posts" ? (
                            <>
                              <td>
                                <div className="table-product">
                                  <img src={r.image} alt="" />
                                  <strong>{r.title}</strong>
                                </div>
                              </td>
                              <td>{r.slug}</td>
                              <td>{r.created_at?.slice(0, 10)}</td>
                              <td>
                                <Flag active={r.published} />
                              </td>
                            </>
                          ) : area === "inquiries" ? (
                            <>
                              <td>{r.name}</td>
                              <td>{r.email}</td>
                              <td className="message-cell">{r.message}</td>
                              <td>
                                <span className="status">
                                  {r.status === "new"
                                    ? "Chờ xử lý"
                                    : "Đã xử lý"}
                                </span>
                              </td>
                            </>
                          ) : area === "audit" ? (
                            <>
                              <td>{r.user_name || "Hệ thống"}</td>
                              <td>{r.action}</td>
                              <td>
                                {r.entity} #{r.entity_id}
                              </td>
                              <td>{r.created_at}</td>
                            </>
                          ) : (
                            <>
                              <td>
                                <strong>{r.name}</strong>
                              </td>
                              <td>{r.slug}</td>
                              <td>{r.description}</td>
                            </>
                          )}
                          {area !== "audit" && (
                            <td>
                              <div className="row-actions">
                                {area === "orders" ? (
                                  <button
                                    className="icon-button"
                                    aria-label="Chi tiết đơn hàng"
                                    onClick={() => setSelected(r)}
                                  >
                                    <ChevronRight size={17} />
                                  </button>
                                ) : area === "inquiries" ? (
                                  <button
                                    className="icon-button"
                                    aria-label="Đổi trạng thái hỗ trợ"
                                    onClick={async () => {
                                      try {
                                        await api(
                                          "admin/inquiries/" + r.id,
                                          "PATCH",
                                          {
                                            status:
                                              r.status === "new"
                                                ? "resolved"
                                                : "new",
                                          },
                                        );
                                        void refresh();
                                      } catch (e) {
                                        toast((e as Error).message);
                                      }
                                    }}
                                  >
                                    <Check size={17} />
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      className="icon-button"
                                      aria-label="Chỉnh sửa"
                                      onClick={() => setEditing(r)}
                                    >
                                      <Pencil size={16} />
                                    </button>
                                    <button
                                      className="icon-button"
                                      aria-label="Ẩn hoặc xoá"
                                      onClick={() => void archive(r)}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filtered.length && (
                    <div className="table-empty">
                      <ClipboardList size={35} />
                      <h3>Chưa có dữ liệu phù hợp</h3>
                      <p>
                        {search
                          ? "Thử từ khoá khác."
                          : "Dữ liệu sẽ xuất hiện khi cửa hàng bắt đầu hoạt động."}
                      </p>
                    </div>
                  )}
                </div>
                <div className="table-footer">
                  Hiển thị {filtered.length} bản ghi
                  {list.length >= 500 ? " mới nhất (giới hạn 500)" : ""}
                </div>
              </div>
            </>
          )}
          {editing && (
            <Editor
              area={area}
              record={editing}
              data={data}
              close={() => setEditing(null)}
              saved={() => {
                setEditing(null);
                void refresh();
                router.refresh();
              }}
            />
          )}
          {selected && area === "orders" && (
            <Modal
              title={"Đơn hàng " + selected.reference}
              close={() => setSelected(null)}
            >
              <div className="order-detail">
                <div className="flex-between">
                  <Status value={selected.status} />
                  <Status value={selected.payment_status} />
                </div>
                <h3>Thông tin giao hoa</h3>
                <p>
                  <strong>{selected.recipient_name}</strong> ·{" "}
                  {selected.recipient_phone}
                  <br />
                  {selected.address}
                  <br />
                  {selected.delivery_date} · {selected.delivery_slot}
                </p>
                <p className="small">
                  Người đặt: {selected.customer_name}
                  <br />
                  {selected.email} · {selected.phone}
                </p>
                <div className="notice">
                  Lời nhắn: {selected.message || "Không có"}
                  <br />
                  Ghi chú: {selected.notes || "Không có"}
                </div>
                {(typeof selected.items === "string"
                  ? JSON.parse(selected.items)
                  : selected.items
                )?.map((i: any, n: number) => (
                  <div className="total-row" key={n}>
                    <span>
                      {i.name} · {i.size} × {i.quantity}
                    </span>
                    <strong>{money(i.price * i.quantity)}</strong>
                  </div>
                ))}
                <div className="total-row">
                  <span>Phí giao / Giảm giá</span>
                  <span>
                    {money(selected.shipping)} / −{money(selected.discount)}
                  </span>
                </div>
                <div className="total-row grand-total">
                  <span>Tổng cộng</span>
                  <strong>{money(selected.total)}</strong>
                </div>
                <div className="button-row">
                  {(
                    {
                      pending: ["confirmed", "cancelled"],
                      confirmed: ["preparing", "cancelled"],
                      preparing: ["shipping"],
                      shipping: ["delivered"],
                      delivered: [],
                      cancelled: [],
                    } as Record<string, string[]>
                  )[selected.status].map((s) => (
                    <button
                      className={
                        "button " + (s === "cancelled" ? "outline" : "")
                      }
                      key={s}
                      onClick={() => {
                        if (
                          s !== "cancelled" ||
                          confirm("Huỷ đơn và hoàn lại tồn kho?")
                        )
                          void transition(selected, s);
                      }}
                    >
                      {statusNames[s]}
                    </button>
                  ))}
                </div>
              </div>
            </Modal>
          )}
        </main>
        <div className="admin-footer">
          Fleur Workspace <span>Chăm chút từng chi tiết, mỗi ngày.</span>
        </div>
      </div>
    </div>
  );
}
function Flag({ active }: { active: number }) {
  return (
    <span
      className={"status " + (active ? "status-delivered" : "status-cancelled")}
    >
      {active ? "Hoạt động" : "Đã ẩn / khoá"}
    </span>
  );
}
function Overview({ payload }: { payload: any }) {
  const stats = payload?.stats || {};
  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 13 + i);
    const key = d.toISOString().slice(0, 10);
    return {
      day: key,
      value: Number(
        payload?.revenue?.find((r: any) => r.day === key)?.total || 0,
      ),
    };
  });
  const max = Math.max(...dates.map((d) => d.value), 1);
  return (
    <>
      <div className="stat-grid">
        {[
          [
            Wallet,
            "Doanh thu đã giao",
            money(stats.revenue || 0),
            "Đơn đã hoàn thành",
          ],
          [
            Package,
            "Đơn hàng",
            stats.orders_count || 0,
            (stats.pending_count || 0) + " đơn chờ xác nhận",
          ],
          [
            Users,
            "Khách hàng",
            stats.customers_count || 0,
            "Hồ sơ được lưu trong CRM",
          ],
          [
            Flower2,
            "Thiết kế đang bán",
            stats.products_count || 0,
            "Sản phẩm đang hiển thị",
          ],
        ].map(([Icon, label, value, caption]: any) => (
          <div className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{value}</strong>
            <small>{caption}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <h3>Nhịp mua sắm</h3>
              <p>
                Giá trị đơn hàng trong 14 ngày gần nhất · Không tính đơn huỷ
              </p>
            </div>
            <span className="chart-legend">
              <i />
              Giá trị đơn
            </span>
          </div>
          <div className="revenue-chart">
            <div className="chart-y">
              <span>{money(max === 1 ? 1000000 : max)}</span>
              <span>{money(max === 1 ? 500000 : Math.round(max / 2))}</span>
              <span>0 ₫</span>
            </div>
            <div className="chart-bars">
              {dates.map((d) => (
                <div
                  className="bar-group"
                  key={d.day}
                  title={d.day + ": " + money(d.value)}
                >
                  <div
                    style={{
                      height: d.value
                        ? Math.max(3, (d.value / max) * 100) + "%"
                        : "2px",
                    }}
                  />
                  <small>{d.day.slice(8)}</small>
                </div>
              ))}
            </div>
          </div>
          {!dates.some((d) => d.value) && (
            <p className="chart-empty-caption">
              Biểu đồ sẽ cập nhật khi có đơn hàng đầu tiên.
            </p>
          )}
        </section>
        <section className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <h3>Những thiết kế được chọn</h3>
              <p>Theo số lượng trong đơn hàng</p>
            </div>
          </div>
          <div className="top-products">
            {payload?.top?.map((p: any, i: number) => (
              <div key={p.name}>
                <span>0{i + 1}</span>
                <div>
                  <strong>{p.name}</strong>
                  <div className="small-progress">
                    <i
                      style={{
                        width: p.sold
                          ? Math.max(
                              5,
                              (p.sold /
                                Math.max(
                                  ...payload.top.map((v: any) => v.sold),
                                  1,
                                )) *
                                100,
                            ) + "%"
                          : "0%",
                      }}
                    />
                  </div>
                </div>
                <small>{p.sold} bó</small>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="dashboard-panel">
        <div className="panel-heading">
          <div>
            <h3>Đơn hàng gần đây</h3>
            <p>Mỗi đơn hàng là một lời thương đang được gửi.</p>
          </div>
          <Link className="text-link" href="/admin/orders">
            Xem tất cả <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã đơn hàng</th>
                <th>Khách hàng</th>
                <th>Ngày đặt</th>
                <th>Tổng tiền</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {payload?.recent?.map((o: any) => (
                <tr key={o.id}>
                  <td>
                    <Link href="/admin/orders">{o.reference}</Link>
                  </td>
                  <td>{o.customer_name}</td>
                  <td>{o.created_at?.slice(0, 10)}</td>
                  <td>{money(o.total)}</td>
                  <td>
                    <Status value={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!payload?.recent?.length && (
            <div className="table-empty">
              <Package size={30} />
              <h3>Sẵn sàng cho đơn hoa đầu tiên.</h3>
              <p>Đơn hàng mới sẽ được hiển thị tại đây.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Đóng" onClick={close}>
          <X />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
function Editor({
  area,
  record,
  data,
  close,
  saved,
}: {
  area: string;
  record: any;
  data: Catalog;
  close: () => void;
  saved: () => void;
}) {
  const { toast } = useShop();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [resetUrl, setResetUrl] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f: any = Object.fromEntries(new FormData(e.currentTarget));
    for (const d of fields[area]) {
      if (d.type === "number")
        f[d.key] =
          f[d.key] === "" && d.required === false ? null : Number(f[d.key]);
      if (d.type === "datetime-local")
        f[d.key] = f[d.key].replace("T", " ") + ":00";
    }
    try {
      await api(
        "admin/" + area + (record.id ? "/" + record.id : ""),
        record.id ? "PATCH" : "POST",
        f,
      );
      toast("Đã lưu thay đổi.");
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={record.id ? "Chỉnh sửa thông tin" : "Thêm mới"} close={close}>
      <form onSubmit={submit} className="editor-form">
        {area === "products" && (
          <label className="field span-2">
            Tải ảnh sản phẩm (JPG, PNG, WebP · tối đa 5 MB)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                const form = e.currentTarget.form;
                if (!file || !form) return;
                setBusy(true);
                setError("");
                try {
                  const f = new FormData();
                  f.set("file", file);
                  const response = await fetch("/api/upload", {
                    method: "POST",
                    body: f,
                  });
                  const result = await response.json();
                  if (!response.ok) throw Error(result.error);
                  (form.elements.namedItem("image") as HTMLInputElement).value =
                    result.url;
                  toast("Đã tải ảnh lên.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        )}
        {fields[area].map((f) => {
          let value =
            record[f.key] ??
            (["active", "published"].includes(f.key)
              ? "1"
              : f.key === "stock"
                ? 30
                : f.key === "usage_limit"
                  ? 100
                  : f.type === "number"
                    ? 0
                    : "");
          if (f.type === "datetime-local")
            value = String(value).replace(" ", "T").slice(0, 16);
          if (f.type === "date") value = String(value).slice(0, 10);
          return (
            <label
              className={"field " + (f.type === "textarea" ? "span-2" : "")}
              key={f.key}
            >
              {f.label}
              {f.options ? (
                <select name={f.key} defaultValue={value || f.options[0][0]}>
                  {f.options.map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : f.type === "category" ? (
                <select
                  name={f.key}
                  defaultValue={value || data.categories[0]?.id}
                >
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.key}
                  rows={f.key === "content" ? 9 : 3}
                  defaultValue={value}
                  required={f.required !== false}
                />
              ) : (
                <input
                  name={f.key}
                  type={f.type || "text"}
                  defaultValue={value}
                  required={f.required !== false}
                  min={f.type === "number" ? 0 : undefined}
                  maxLength={f.type === "text" || !f.type ? 200 : undefined}
                />
              )}
            </label>
          );
        })}
        {area === "users" && record.id && (
          <div className="span-2">
            <button
              className="button outline compact"
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    "Chỉ cấp liên kết sau khi đã xác minh người yêu cầu là chủ sở hữu email. Tiếp tục?",
                  )
                )
                  return;
                setBusy(true);
                setError("");
                try {
                  const result = await api(
                    "admin/users/" + record.id + "/reset-password",
                    "POST",
                    {},
                  );
                  setResetUrl(result.url);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cấp liên kết đặt lại mật khẩu
            </button>
            {resetUrl && (
              <label className="field" style={{ marginTop: 15 }}>
                Liên kết riêng, hết hạn sau 30 phút
                <input
                  readOnly
                  value={resetUrl}
                  onFocus={(e) => e.target.select()}
                />
              </label>
            )}
          </div>
        )}
        {error && <p className="error span-2">{error}</p>}
        <div className="button-row span-2">
          <button className="button outline" type="button" onClick={close}>
            Huỷ
          </button>
          <button className="button" disabled={busy}>
            {busy ? "Đang lưu..." : "Lưu thay đổi"}
            <Check size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CRM({
  payload,
  refresh,
}: {
  payload: any;
  refresh: () => Promise<void>;
}) {
  const { toast } = useShop();
  const [search, setSearch] = useState(""),
    [segment, setSegment] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const customers = payload?.customers || [];
  const visible = customers.filter(
    (c: any) =>
      (!segment || c.segment === segment) &&
      (c.name + " " + c.email + " " + c.phone)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const names: Record<string, string> = {
    new: "Khách hàng mới",
    loyal: "Thân thiết",
    vip: "VIP",
    inactive: "Cần kết nối lại",
  };
  const customer = customers.find((c: any) => c.id === selected?.id);
  async function action(endpoint: string, body: any, method = "POST") {
    setBusy(true);
    try {
      await api("admin/crm/" + selected.id + endpoint, method, body);
      await refresh();
      toast("Đã cập nhật hồ sơ khách hàng.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const cell = (v: any) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const lines = [
      [
        "Tên",
        "Email",
        "Điện thoại",
        "Phân nhóm",
        "Số đơn",
        "Tổng chi tiêu",
        "Đồng ý nhận tiếp thị",
      ],
      ...visible.map((c: any) => [
        c.name,
        c.email,
        c.phone,
        names[c.segment],
        c.order_count,
        c.total_spent,
        c.marketing_consent ? "Có" : "Không",
      ]),
    ];
    const blob = new Blob(
      ["\uFEFF" + lines.map((r) => r.map(cell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fleur-khach-hang.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="crm-summary">
        {Object.entries(names).map(([k, v]) => (
          <button
            key={k}
            className={segment === k ? "active" : ""}
            onClick={() => setSegment(segment === k ? "" : k)}
          >
            <span>{v}</span>
            <strong>
              {customers.filter((c: any) => c.segment === k).length}
            </strong>
          </button>
        ))}
      </div>
      <div className="admin-table-panel">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Tìm khách hàng, email, số điện thoại..."
              aria-label="Tìm khách hàng"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button className="button outline compact" onClick={download}>
            <Download size={16} />
            Xuất CSV
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Khách hàng</th>
                <th>Phân nhóm</th>
                <th>Đơn hàng</th>
                <th>Đã chi tiêu</th>
                <th>Tiếp thị</th>
                <th>Sinh nhật</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((c: any) => (
                <tr key={c.id}>
                  <td>
                    <div className="table-product">
                      <span className="avatar">{c.name.charAt(0)}</span>
                      <div>
                        <strong>{c.name}</strong>
                        <small>{c.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="role-tag">{names[c.segment]}</span>
                  </td>
                  <td>{c.order_count}</td>
                  <td>{money(c.total_spent)}</td>
                  <td>{c.marketing_consent ? "Đã đồng ý" : "Chưa đồng ý"}</td>
                  <td>{c.birthday || "—"}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label="Mở hồ sơ khách hàng"
                      onClick={() => setSelected(c)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <div className="table-empty">
              <ContactRound size={35} />
              <h3>Khởi đầu những mối quan hệ đẹp.</h3>
              <p>Hồ sơ tự động được tạo khi khách đăng ký hoặc đặt hoa.</p>
            </div>
          )}
        </div>
      </div>
      <section className="dashboard-panel crm-tasks">
        <div className="panel-heading">
          <div>
            <h3>Lịch chăm sóc sắp tới</h3>
            <p>Nhắc sinh nhật, hậu mãi và những dịp quan trọng.</p>
          </div>
        </div>
        {payload?.tasks?.filter((t: any) => t.status === "open").length ? (
          payload.tasks
            .filter((t: any) => t.status === "open")
            .map((t: any) => (
              <button
                className="task-row"
                key={t.id}
                onClick={() =>
                  setSelected(
                    customers.find((c: any) => c.id === t.customer_id),
                  )
                }
              >
                <CalendarDays size={19} />
                <div>
                  <strong>{t.title}</strong>
                  <small>
                    {customers.find((c: any) => c.id === t.customer_id)?.name}
                  </small>
                </div>
                <span>{t.due_date}</span>
                <ChevronRight size={17} />
              </button>
            ))
        ) : (
          <p className="small pad">
            Chưa có lịch hẹn. Mở hồ sơ khách hàng để tạo nhắc chăm sóc.
          </p>
        )}
      </section>
      {selected && customer && (
        <Modal title={customer.name} close={() => setSelected(null)}>
          <div className="customer-contact">
            <span className="avatar large">{customer.name.charAt(0)}</span>
            <div>
              <strong>{customer.email}</strong>
              <p>
                {customer.phone || "Chưa có số điện thoại"} ·{" "}
                {customer.order_count} đơn · {money(customer.total_spent)}
              </p>
            </div>
          </div>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              void action("", { ...f, birthday: f.birthday || null }, "PATCH");
            }}
          >
            <label className="field">
              Phân nhóm
              <select name="segment" defaultValue={customer.segment}>
                {Object.entries(names).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Ngày sinh
              <input
                type="date"
                name="birthday"
                defaultValue={customer.birthday || ""}
              />
            </label>
            <button className="button outline compact" disabled={busy}>
              Lưu hồ sơ
            </button>
          </form>
          <div className="crm-section">
            <h3>Lịch sử mua hàng</h3>
            {payload.orders?.filter((o: any) => o.email === customer.email)
              .length ? (
              payload.orders
                .filter((o: any) => o.email === customer.email)
                .map((o: any) => (
                  <div className="crm-note" key={o.id}>
                    <div className="flex-between">
                      <strong>{o.reference}</strong>
                      <Status value={o.status} />
                    </div>
                    <p>
                      {money(o.total)} · Giao {o.delivery_date}
                    </p>
                    <small>{o.created_at}</small>
                  </div>
                ))
            ) : (
              <p className="small">Chưa có đơn hàng.</p>
            )}
          </div>
          <div className="crm-section">
            <h3>Lịch sử chăm sóc</h3>
            {payload.notes
              .filter((n: any) => n.customer_id === customer.id)
              .map((n: any) => (
                <div className="crm-note" key={n.id}>
                  <p>{n.content}</p>
                  <small>
                    {n.author} · {n.created_at}
                  </small>
                </div>
              ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = Object.fromEntries(new FormData(form));
                void action("/notes", f).then(() => form.reset());
              }}
            >
              <label className="field">
                Ghi chú mới
                <textarea
                  name="content"
                  rows={3}
                  required
                  minLength={2}
                  placeholder="Sở thích về hoa, phản hồi, nội dung cuộc gọi..."
                />
              </label>
              <button className="button compact" disabled={busy}>
                <Plus size={16} />
                Thêm ghi chú
              </button>
            </form>
          </div>
          <div className="crm-section">
            <h3>Lịch chăm sóc</h3>
            {payload.tasks
              .filter((t: any) => t.customer_id === customer.id)
              .map((t: any) => (
                <label className="task-check" key={t.id}>
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    disabled={busy}
                    onChange={() =>
                      void action(
                        "/tasks",
                        {
                          id: t.id,
                          status: t.status === "done" ? "open" : "done",
                        },
                        "PATCH",
                      )
                    }
                  />
                  <span
                    style={{
                      textDecoration:
                        t.status === "done" ? "line-through" : "none",
                    }}
                  >
                    {t.title}
                    <small>{t.due_date}</small>
                  </span>
                </label>
              ))}
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void action(
                  "/tasks",
                  Object.fromEntries(new FormData(form)),
                ).then(() => form.reset());
              }}
            >
              <label className="field">
                Nội dung chăm sóc
                <input
                  name="title"
                  required
                  minLength={2}
                  placeholder="Gọi hỏi thăm sau khi nhận hoa"
                />
              </label>
              <label className="field">
                Ngày hẹn
                <input name="due_date" type="date" required />
              </label>
              <button className="button compact" disabled={busy}>
                <CalendarDays size={16} />
                Tạo lịch hẹn
              </button>
            </form>
          </div>
          <div className="notice">
            Đồng ý nhận tiếp thị:{" "}
            <strong>{customer.marketing_consent ? "Có" : "Chưa đồng ý"}</strong>
            . Chỉ dùng thông tin đúng mục đích khách đã cho phép.
          </div>
        </Modal>
      )}
    </>
  );
}
