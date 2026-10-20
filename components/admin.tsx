"use client";
import DateInput from "./date-input";
import dynamic from "next/dynamic";
import Brand, { DashboardBrand } from "@/components/brand";
import { useDashboardSidebar, SidebarControls, SidebarMobileClose, SidebarBackdrop } from "./dashboard-sidebar";

import { hanoiDateKey, formatDate, formatDateTime } from "@/lib/date-time";
import Select from "./ui-select";
import { TableAction, TableActions } from "./table-actions";
import { displayLabel, auditAction } from "@/lib/display-labels";
import WorkspaceView, { workspaceAreas } from "./workspace";

import Link, { useLocalPath } from "./routing";
import AdminNotifications from "./admin-notifications";
import ProductMediaEditor from "./product-media-editor";
import ProductTaxonomyManager, {
  ProductTaxonomyFields,
} from "./product-taxonomy";
import { productSlug } from "@/lib/product-images";
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
  Eye,
  TrendingUp,
  Wallet,
  ClipboardList,
  Mail,
  RotateCcw,
  EyeOff,
  Bot,
} from "lucide-react";
import type { Catalog } from "@/lib/types";
import { api, useShop } from "./context";
import { money } from "./home";
import { Status, statusNames } from "./pages";
const WorkspaceAIWidget = dynamic(() => import("./workspace-ai-widget"), { ssr: false });
const nav = [
  ["overview", "Tổng quan", LayoutDashboard],
  ["analytics", "Phân tích dữ liệu", TrendingUp],
  ["ai", "Trợ lý AI", Bot],
  ["board", "Đơn hàng · Kanban", ClipboardList],
  ["calendar", "Lịch giao & ghi chú", CalendarDays],
  ["theme", "Giao diện cửa hàng", Layers],
  ["settings", "Cấu hình cửa hàng", ShieldCheck],
  ["billing", "Gói & hóa đơn", Wallet],
  ["products", "Sản phẩm", Flower2],
  ["categories", "Danh mục", Layers],
  ["orders", "Đơn hàng", Package],
  ["promotions", "Khuyến mãi", Tag],
  ["events", "Sự kiện", CalendarDays],
  ["posts", "Tin tức", Newspaper],
  ["crm", "Khách hàng & CRM", ContactRound],
  ["emails", "Email & chương trình", Mail],
  ["automations", "Chăm sóc tự động", ContactRound],
  ["inquiries", "Yêu cầu hỗ trợ", MessageSquare],
  ["users", "Người dùng & quyền", Users],
  ["audit", "Nhật ký hoạt động", History],
] as const;
const rights: Record<string, string[]> = {
  owner: nav.map((n) => n[0]),
  admin: nav
    .map((n) => n[0])
    .filter((k) => !["settings", "theme", "billing"].includes(k)),
  manager: [
    "ai",
    "overview",
    "analytics",
    "board",
    "calendar",
    "products",
    "categories",
    "orders",
    "promotions",
    "events",
    "inquiries",
    "crm",
    "emails",
    "automations",
  ],
  editor: ["posts", "events"],
  support: ["ai", "board", "calendar", "orders", "inquiries", "crm", "emails"],
};
const roleNames: Record<string, string> = {
  owner: "Chủ cửa hàng",
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
    { key: "price", label: "Giá tiêu chuẩn (VNĐ)", type: "number" },
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
    { key: "min_order", label: "Đơn tối thiểu (VNĐ)", type: "number" },
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
  const path = useLocalPath();
  const requested =
    path === "/admin/orders/new"
      ? "new-order"
      : path.split("/")[2] || "overview";
  const { user, setUser, ready, toast } = useShop();
  const area = requested;
  const [loaded, setLoaded] = useState<{ area: string; payload: any } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<any>(null),
    [selected, setSelected] = useState<any>(null),
    [statusFilter, setStatusFilter] = useState("");
  const sidebar = useDashboardSidebar();
  const { mobile, setMobile } = sidebar;
  const payload = loaded?.area === area ? loaded.payload : null;
  const requestId = useRef(0);
  const activeArea = useRef(area);
  activeArea.current = area;
  const router = useRouter();
  const baseAllowed = user ? rights[user.role] || [] : [];
  const allowed = baseAllowed.includes("orders")
    ? [...baseAllowed, "new-order"]
    : baseAllowed;
  async function refresh() {
    if (activeArea.current !== area) return;
    const request = ++requestId.current;
    setError("");
    if (!payload) setLoading(true);
    try {
      const result = await api("admin/" + area);
      if (request === requestId.current) setLoaded({ area, payload: result });
    } catch (e) {
      if (request === requestId.current) {
        setError((e as Error).message);
        setLoaded({ area, payload: null });
      }
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }
  useEffect(() => {
    setEditing(null);
    setSelected(null);
    setSearch("");
    setStatusFilter("");
    setLoading(true);
    if (workspaceAreas.includes(area)) {
      setLoading(false);
      setLoaded(null);
    } else if (user && allowed.includes(area)) void refresh();
    return () => {
      requestId.current++;
    };
    // Focus revalidates auth/me with a new object. Only an actual account or
    // permission change should reset the current editor, filters and content.
  }, [area, user?.id, user?.role]);
  if (!ready)
    return <div className="admin-loading">Đang mở Fleurious Workspace...</div>;
  if (!user || user.role === "customer")
    return (
      <div className="admin-gate">
        <Link className="logo" href="/">
          <Brand />
        </Link>
        <ShieldCheck size={48} />
        <h1>Fleurious Workspace.</h1>
        <p>
          Khu vực dành cho đội ngũ Fleurious.
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
  const currentNav =
    area === "new-order"
      ? (["new-order", "Tạo đơn hàng", ClipboardList] as const)
      : nav.find((n) => n[0] === area);
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
      await api("admin/orders/" + o.id, "PATCH", {
        status,
        version: o.version,
      });
      toast("Đã cập nhật đơn hàng.");
      setSelected(null);
      void refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className={"admin-shell" + (sidebar.collapsed ? " sidebar-collapsed" : "") + (sidebar.motion ? " sidebar-animate" : "")}>
      {allowed.includes("ai") && <WorkspaceAIWidget key={`${data.store?.id}:${user.id}:${user.role}`} />}
      <SidebarBackdrop open={mobile} close={() => setMobile(false)} />
      <aside id="dashboard-sidebar" aria-label="Menu workspace" inert={sidebar.narrow && !mobile} className={"admin-sidebar " + (mobile ? "mobile-open" : "")}>
        <SidebarMobileClose close={() => setMobile(false)} />
        <Link href="/admin" className="logo dashboard-logo" aria-label="Fleurious Workspace">
          <DashboardBrand />
        </Link>
        <div className="workspace-label store-workspace-label">
          {data.store?.name ? `${data.store.name}'s workspace` : "Workspace"}
        </div>
        <nav aria-label="Điều hướng workspace">
          {nav
            .filter((n) => allowed.includes(n[0]))
            .map(([key, label, Icon], i) => (
              <Link
                href={"/admin/" + key}
                scroll={false}
                prefetch={true}
                aria-current={area === key ? "page" : undefined}
                aria-label={label}
                title={sidebar.collapsed ? label : undefined}
                onClick={() => setMobile(false)}
                className={area === key ? "active" : ""}
                key={key}
              >
                <Icon size={18} />
                <span className="sidebar-nav-label">{label}</span>
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
          <SidebarControls state={sidebar} />
          <span>
            Workspace <ChevronRight size={13} />{" "}
            <strong>{currentNav?.[1] || "Không tìm thấy"}</strong>
          </span>
          <div>
            <Link
              href={"/s/" + (data.store?.slug || "fleur")}
              target="_blank"
              rel="noopener noreferrer"
              className="admin-store-link"
            >
              <ArrowUpRight size={17} /> Xem cửa hàng
            </Link>
            <AdminNotifications
              key={`${data.store?.id}:${user.id}:${user.role}`}
              userId={user.id}
            />
          </div>
        </header>
        <main className="admin-content">
          {data.store?.status === "suspended" && area !== "billing" && (
            <div className="panel store-suspension-notice" role="alert">
              <div className="store-suspension-copy">
                <h3>Cửa hàng đang tạm đóng băng</h3>
                <p>
                  {data.store.suspension_reason ||
                    "Vui lòng liên hệ admin platform để được hỗ trợ."}
                </p>
              </div>
              {user.role === "owner" && (
                <Link className="button store-suspension-action" href="/admin/billing">
                  Xem gói & hóa đơn
                </Link>
              )}
            </div>
          )}
          <div className="admin-heading" style={area === "ai" ? { display: "none" } : undefined}>
            <div>
              <div className="eyebrow">FLEURIOUS FLORAL STUDIO</div>
              <h1>
                {area === "overview"
                  ? "Mỗi ngày, một điều tốt đẹp."
                  : area === "new-order"
                    ? "Tạo đơn hàng"
                    : currentNav?.[1]}
              </h1>
              <p>
                {area === "overview"
                  ? "Chào " + user.name + ". Đây là hoạt động cửa hàng của bạn."
                  : area === "analytics"
                    ? "Theo dõi doanh thu, công nợ và hoạt động giao hoa của cửa hàng."
                  : "Quản lý và cập nhật thông tin cửa hàng."}
              </p>
            </div>
            <div>
              {["board", "orders", "calendar"].includes(area) &&
              allowed.includes("new-order") ? (
                <Link className="button" href="/admin/orders/new">
                  <Plus size={17} /> Tạo đơn hàng
                </Link>
              ) : area === "overview" ? (
                <span className="date-pill">
                  <CalendarDays size={16} />
                  {formatDate(new Date())}
                </span>
              ) : fields[area] && !["users", "categories"].includes(area) ? (
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
          ) : workspaceAreas.includes(area) ? (
            <WorkspaceView key={area} area={area} />
          ) : loading || loaded?.area !== area ? (
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
          ) : area === "crm" ? (
            <CRM payload={payload} refresh={refresh} />
          ) : area === "categories" ? (
            <ProductTaxonomyManager categories={list} refresh={refresh} />
          ) : area === "emails" ? (
            <EmailWorkspace
              payload={payload}
              refresh={refresh}
              storeName={data.store?.name}
              canEdit={["owner", "admin", "manager"].includes(user.role)}
            />
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
                    <Select
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
                    </Select>
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
                        {area !== "audit" && <th className="table-actions-heading" scope="col">Thao tác</th>}
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
                                {r.category ||
                                  data.categories.find(
                                    (c) => c.id === r.category_id,
                                  )?.name}
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
                              <td>{formatDate(r.created_at)}</td>
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
                              <td>{formatDate(r.starts_at)}</td>
                              <td>{formatDate(r.ends_at)}</td>
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
                              <td>{formatDate(r.created_at)}</td>
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
                              <td>{auditAction(r.action, r.entity)}</td>
                              <td>
                                {displayLabel("entity", r.entity)} #
                                {r.entity_id}
                              </td>
                              <td>{formatDateTime(r.created_at)}</td>
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
                              <TableActions className="row-actions">
                                {area === "orders" ? (
                                  <TableAction icon={Eye}
                                    aria-label="Chi tiết đơn hàng"
                                    onClick={() => setSelected(r)}
                                  >
                                    Chi tiết
                                  </TableAction>
                                ) : area === "inquiries" ? (
                                  <TableAction icon={r.status === "new" ? Check : RotateCcw}
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
                                    {r.status === "new" ? "Đã xử lý" : "Mở lại"}
                                  </TableAction>
                                ) : (
                                  <>
                                    <TableAction icon={Pencil}
                                      aria-label="Chỉnh sửa"
                                      onClick={() => setEditing(r)}
                                    >
                                      Sửa
                                    </TableAction>
                                    <TableAction icon={EyeOff}
                                      aria-label="Ẩn hoặc xoá"
                                      onClick={() => void archive(r)}
                                    >
                                      Ẩn
                                    </TableAction>
                                  </>
                                )}
                              </TableActions>
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
                      preparing: ["ready"],
                      ready: ["shipping"],
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
          Fleurious Workspace <span>Chăm chút từng chi tiết, mỗi ngày.</span>
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
    const key = hanoiDateKey(Date.now() + (-13 + i) * 86400000);
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
              <span>0 VNĐ</span>
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
                  <td>{formatDate(o.created_at)}</td>
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
  const [designName, setDesignName] = useState(record.name || "");
  const [designSlug, setDesignSlug] = useState(record.slug || "");
  const manualSlug = useRef(false);
  const [taxonomyReady, setTaxonomyReady] = useState(area !== "products");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !taxonomyReady) return;
    setBusy(true);
    setError("");
    const f: any = Object.fromEntries(new FormData(e.currentTarget));
    if (area === "products") {
      if (!f.image) {
        setError("Vui lòng chọn ảnh đại diện cho thiết kế.");
        setBusy(false);
        return;
      }
      f.gallery = JSON.parse(f.gallery || "[]");
      f.flower_component_ids = JSON.parse(f.flower_component_ids || "[]");
    }
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
          <ProductMediaEditor
            image={record.image || ""}
            gallery={record.gallery}
            disabled={busy}
            onBusy={setBusy}
          />
        )}
        {fields[area]
          .filter(
            (f) => area !== "products" || !["image", "flowers"].includes(f.key),
          )
          .map((f) => {
            if (area === "products" && f.key === "category_id")
              return (
                <ProductTaxonomyFields
                  key={f.key}
                  record={record}
                  disabled={busy}
                  onReady={setTaxonomyReady}
                />
              );
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
                {area === "products" && f.key === "name" ? (
                  <input
                    name="name"
                    value={designName}
                    maxLength={160}
                    required
                    onChange={(e) => {
                      setDesignName(e.target.value);
                      if (!manualSlug.current)
                        setDesignSlug(productSlug(e.target.value));
                    }}
                  />
                ) : area === "products" && f.key === "slug" ? (
                  <>
                    <input
                      name="slug"
                      value={designSlug}
                      maxLength={180}
                      pattern="[a-z0-9-]+"
                      required
                      onChange={(e) => {
                        manualSlug.current = true;
                        setDesignSlug(e.target.value);
                      }}
                    />
                    <small className="slug-preview">
                      /product/{designSlug || "ten-thiet-ke"}
                    </small>
                    <button
                      type="button"
                      className="media-text-button"
                      onClick={() => {
                        manualSlug.current = false;
                        setDesignSlug(productSlug(designName));
                      }}
                    >
                      Tạo lại từ tên thiết kế
                    </button>
                  </>
                ) : f.options ? (
                  <Select name={f.key} defaultValue={value || f.options[0][0]}>
                    {f.options.map(([v, l]) => (
                      <option value={v} key={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                ) : f.type === "category" ? (
                  <Select
                    name={f.key}
                    defaultValue={value || data.categories[0]?.id}
                  >
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                ) : f.type === "textarea" ? (
                  <textarea
                    name={f.key}
                    rows={f.key === "content" ? 9 : 3}
                    defaultValue={value}
                    required={f.required !== false}
                  />
                ) : f.type === "date" || f.type === "datetime-local" ? (
                  <DateInput name={f.key} type={f.type} defaultValue={value} required={f.required !== false} />
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
          <button className="button" disabled={busy || !taxonomyReady}>
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
    a.download = "fleurious-khach-hang.csv";
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
                <th className="table-actions-heading" scope="col">Thao tác</th>
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
                    <span className={"role-tag crm-tag crm-tag-" + c.segment}>
                      {names[c.segment]}
                    </span>
                  </td>
                  <td>{c.order_count}</td>
                  <td>{money(c.total_spent)}</td>
                  <td>
                    <span
                      className={
                        "role-tag crm-tag " +
                        (c.marketing_consent
                          ? "crm-tag-consented"
                          : "crm-tag-declined")
                      }
                    >
                      {c.marketing_consent ? "Đã đồng ý" : "Chưa đồng ý"}
                    </span>
                  </td>
                  <td>{c.birthday || "—"}</td>
                  <td>
                    <TableActions className="crm-actions">
                      <TableAction icon={Eye}
                        type="button"
                        aria-label="Mở hồ sơ khách hàng"
                        title={"Xem hồ sơ " + c.name}
                        onClick={() => setSelected(c)}
                      >
                        Xem hồ sơ
                      </TableAction>
                    </TableActions>
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
                <span>{formatDate(t.due_date)}</span>
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
              <strong>{customer.email || "Chưa có email"}</strong>
              <Link
                className="text-link"
                href={"/admin/orders/new?customer=" + customer.id}
              >
                Tạo đơn cho khách
              </Link>
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
              <Select name="segment" defaultValue={customer.segment}>
                {Object.entries(names).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              Ngày sinh
              <DateInput
                type="date"
                name="birthday"
                defaultValue={customer.birthday || ""}
              />
            </label>
            <button className="button outline compact" disabled={busy}>
              Lưu hồ sơ
            </button>
          </form>
          <CRMMarketingConsent
            key={customer.id + ":" + customer.marketing_consent}
            customer={customer}
            refresh={refresh}
            disabled={busy}
          />
          <div className="crm-section">
            <h3>Lịch sử mua hàng</h3>
            {payload.orders?.filter((o: any) => o.customer_id === customer.id)
              .length ? (
              payload.orders
                .filter((o: any) => o.customer_id === customer.id)
                .map((o: any) => (
                  <div className="crm-note" key={o.id}>
                    <div className="flex-between">
                      <strong>{o.reference}</strong>
                      <Status value={o.status} />
                    </div>
                    <p>
                      {money(o.total)} · Giao {o.delivery_date}
                    </p>
                    <small>{formatDateTime(o.created_at)}</small>
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
                    {n.author} · {formatDateTime(n.created_at)}
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
                    <small>{formatDate(t.due_date)}</small>
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
                <DateInput name="due_date" type="date" required />
              </label>
              <button className="button compact" disabled={busy}>
                <CalendarDays size={16} />
                Tạo lịch hẹn
              </button>
            </form>
          </div>
        </Modal>
      )}
    </>
  );
}
function CRMMarketingConsent({
  customer,
  refresh,
  disabled,
}: {
  customer: any;
  refresh: () => Promise<void>;
  disabled: boolean;
}) {
  const { toast } = useShop();
  const current = !!customer.marketing_consent;
  const [consent, setConsent] = useState(current);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = consent !== current;
  return (
    <section className="crm-section">
      <h3>Đồng ý nhận tiếp thị</h3>
      <p className="small">
        Hiện tại: <strong>{current ? "Đã đồng ý" : "Chưa đồng ý"}</strong>. Ghi
        nhận khi khách xác nhận trực tiếp với cửa hàng.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || disabled || !changed) return;
          const note = String(new FormData(e.currentTarget).get("note") || "");
          setBusy(true);
          setError("");
          try {
            await api(
              "admin/crm/" + customer.id + "/marketing-consent",
              "PATCH",
              { consent, previousConsent: current, confirmed, note },
            );
            await refresh();
            toast("Đã cập nhật lựa chọn nhận tiếp thị của khách hàng.");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Trạng thái tiếp thị
          <Select
            aria-label="Trạng thái tiếp thị"
            disabled={busy || disabled}
            value={consent ? "1" : "0"}
            onChange={(e) => {
              setConsent(e.target.value === "1");
              setConfirmed(false);
              setError("");
            }}
          >
            <option value="0">Chưa đồng ý</option>
            <option value="1" disabled={!customer.email}>
              Đã đồng ý
            </option>
          </Select>
        </label>
        {!customer.email && (
          <p className="small">Khách chưa có email để nhận tiếp thị.</p>
        )}
        {changed && (
          <>
            {consent && (
              <label className="check-field">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  disabled={busy || disabled}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Khách đã đồng ý nhận email tiếp thị từ cửa hàng; tôi xác nhận
                ghi nhận thay khách.
              </label>
            )}
            <label className="field">
              Ghi chú xác nhận (không bắt buộc)
              <textarea
                name="note"
                maxLength={500}
                rows={2}
                disabled={busy || disabled}
                placeholder="Ví dụ: khách xác nhận qua điện thoại hoặc tin nhắn."
              />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button outline compact"
          disabled={busy || disabled || !changed || (consent && !confirmed)}
        >
          {busy ? "Đang lưu…" : "Lưu lựa chọn tiếp thị"}
        </button>
      </form>
    </section>
  );
}
