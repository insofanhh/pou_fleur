"use client";
import Brand from "@/components/brand";

import { formatDate, formatDateTime, parseDateTime } from "@/lib/date-time";
import Select from "./ui-select";
import { TableAction, TableActions } from "./table-actions";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useShop, api } from "./context";
import { money } from "./home";
import PlatformUsers from "./platform-users";
import EmailWorkspace from "./email-admin";
import PlatformDialog from "./platform-dialog";
import {
  Menu,
  Store,
  BarChart3,
  Receipt,
  Users,
  Package,
  Settings,
  ArrowUpRight,
  Ghost,
  Check,
  Snowflake,
  LogOut,
  Mail,
  Search,
  Ban,
} from "lucide-react";
import { displayLabel as statusText, auditAction } from "@/lib/display-labels";

function PlatformPlans({ plans, toast, refresh }: { plans: any[]; toast: (message: string) => void; refresh: () => Promise<void> }) {
  const [busy,setBusy] = useState(false);
  return <form className="panel" onSubmit={async e => {
    e.preventDefault(); if(busy) return; const f = new FormData(e.currentTarget); setBusy(true);
    try {
      for (const p of plans) await api("platform/plans/"+p.id,"PATCH",{name:String(f.get(p.id+"-name")).trim(),monthly_price:Number(f.get(p.id+"-price")),trial_days:Number(f.get(p.id+"-trial")),limits:{products:Number(f.get(p.id+"-products")),staff:Number(f.get(p.id+"-staff")),storage_mb:Number(f.get(p.id+"-storage_mb")),email_sends:Number(f.get(p.id+"-email_sends"))}});
      toast("Đã lưu cấu hình. Cửa hàng đã đăng ký giữ ưu đãi được cấp."); await refresh();
    } catch(err) { toast((err as Error).message); } finally { setBusy(false); }
  }}>
    <div className="section-heading"><div><h3>Danh mục gói dịch vụ</h3><p className="small">Gói Khởi đầu tự động cấp số ngày dùng thử đang cấu hình cho cửa hàng đầu tiên của tài khoản. Các gói khác dùng chung một lượt trải nghiệm. Cấu hình mới chỉ áp dụng cho đăng ký mới.</p></div><button className="button" disabled={busy}>{busy ? "Đang lưu…" : "Lưu tất cả thay đổi"}</button></div>
    <div className="platform-plan-list">{plans.map((p: any) => { const limits = typeof p.limits === "string" ? JSON.parse(p.limits) : p.limits || {}; return <article className="platform-plan-card" key={p.id}>
      <div className="platform-plan-card-header"><div><h4>{p.name}</h4><p className="small">{p.pending_offers || 0} cửa hàng chờ duyệt · {p.trialing_stores || 0} đang dùng thử</p></div><span className="plan-price">{money(Number(p.monthly_price))}<small>/tháng</small></span></div>
      <div className="platform-plan-fields"><label className="field">Tên gói<input required name={p.id+"-name"} defaultValue={p.name}/></label><label className="field">Giá / tháng<input required name={p.id+"-price"} type="number" min="0" max="100000000" defaultValue={p.monthly_price}/></label><label className="field">Dùng thử (ngày)<input required name={p.id+"-trial"} type="number" min="0" max="90" defaultValue={p.trial_days}/><small>{Number(p.id)===1 ? "Tự động áp dụng cho cửa hàng đầu tiên" : "Lượt trải nghiệm dùng chung"}</small></label></div>
      <div className="platform-limit-box"><strong>Hạn mức sử dụng</strong><div className="platform-limit-grid">{[["products","Sản phẩm đang bán",100000],["staff","Nhân sự hoạt động",10000],["storage_mb","Dung lượng (MB)",1000000],["email_sends","Email cửa hàng / tháng",1000000]].map(([key,label,max]) => <label className="field" key={key}>{label}<input required type="number" min="1" max={Number(max)} name={p.id+"-"+key} defaultValue={limits[key] || 1}/></label>)}</div></div>
      <p className="small">Giá và quyền lợi đã cam kết được giữ theo phiên bản; cấu hình mới áp dụng khi đăng ký hoặc chọn gói cho kỳ tiếp theo. 0 ngày: không dùng thử. Giá 0 VNĐ: vẫn miễn phí sau thử.</p>
    </article>; })}</div>
  </form>;
}

function TrialExtension({ detail, action }: { detail:any; action:(path:string, method:string, body:any)=>Promise<void> }) {
  const [days,setDays] = useState(7), [busy,setBusy] = useState(false);
  const sub = detail.subscription;
  const end = sub?.trial_ends_at || sub?.access_ends_at;
  const format = (value:string) => formatDateTime(value, "utc");
  return <section className="panel merchant-detail-section"><h3>Gói dịch vụ</h3><p><strong>{sub?.plan_name || "Gói #"+sub?.plan_id}</strong> · {statusText("subscription",sub?.status)}</p>
    <p className="small">{end ? "Hết kỳ: "+format(end) : "Chưa bắt đầu kỳ sử dụng"}</p>
    {sub?.trial_days_granted !== null && <p className="small">Đã cấp {sub?.trial_days_granted} ngày thử · Phiên bản ưu đãi #{sub?.registration_plan_version_id}</p>}
    {detail.account_trials && <div className="notice"><strong>Lượt trải nghiệm gói khác: còn {detail.account_trials.available}/1</strong><p className="small">Gói Khởi đầu tự động dùng số ngày do admin platform cấu hình cho cửa hàng đầu tiên; đây không phải lượt chọn thêm trong workspace.</p>{detail.account_trials.claims.map((t:any)=><p className="small" key={t.bucket}>{t.bucket==='starter'?'Khởi đầu tự động':'Trải nghiệm gói khác'} · {t.plan_name} · {t.trial_days} ngày · {t.starts_at ? `${format(t.starts_at)} → ${format(t.ends_at)}` : 'Đang giữ lượt, chờ duyệt'} · {Number(t.store_id)===Number(detail.store.id)?'Cửa hàng này':'Cửa hàng khác của tài khoản'}</p>)}</div>}
    <p className="small">Kỳ tháng được cập nhật qua thanh toán hóa đơn. Cập nhật danh mục gói không thay đổi hạn dùng thử này.</p>
    {sub?.status === "trialing" && <form onSubmit={async e=>{e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget);setBusy(true);try{await action("stores/"+detail.store.id+"/trial-extension","POST",{days,reason:String(f.get("reason")),version:sub.version});}finally{setBusy(false);}}}>
      <label className="field">Số ngày cộng thêm<input type="number" required min="1" max="90" value={days} onChange={e=>setDays(Number(e.target.value))}/></label>
      <p className="small">Hạn mới: {end && Number.isInteger(days) && days>0 && days<=90 ? format(new Date(parseDateTime(end, "utc").getTime()+days*86400000).toISOString().slice(0,19)) : "Chọn số ngày hợp lệ"}</p>
      <label className="field">Lý do gia hạn<textarea name="reason" minLength={5} maxLength={500} required/></label>
      <p className="small">Hóa đơn kỳ tới chưa thu và QR cũ sẽ được hủy. Đã nhận tiền thì cần đối soát trước khi gia hạn thử.</p>
      <button className="button secondary" disabled={busy}>{busy ? "Đang cập nhật…" : "Xác nhận gia hạn dùng thử"}</button>
    </form>}
  </section>;
}

function PlatformSepay({ sepay, setSepay, sepayBusy, setSepayBusy, toast }: { sepay: any; setSepay: (value: any) => void; sepayBusy: boolean; setSepayBusy: (value: boolean) => void; toast: (message: string) => void }) {
  return <div className="panel"><div className="flex-between"><h3>SePay webhook</h3><button className="button secondary" disabled={sepayBusy} onClick={async()=>{setSepayBusy(true);try{const r=await api("platform/sepay/credentials");setSepay(r)}catch(e){toast((e as Error).message)}finally{setSepayBusy(false)}}}>Kiểm tra cấu hình</button></div>{sepay && <><p className="small">Webhook URL: <code>{sepay.webhookUrl}</code></p>{sepay.configured ? <p>Đã tạo credential · API key kết thúc bằng <strong>••••{sepay.api_last4}</strong> · secret kết thúc bằng <strong>••••{sepay.secret_last4}</strong></p> : <p>Chưa có credential. Hãy tạo mới để dán vào SePay.</p>}<button className="button" disabled={sepayBusy} onClick={async()=>{setSepayBusy(true);try{const r=await api("platform/sepay/credentials","POST",{});setSepay(r);toast("Đã tạo credential SePay. Hãy copy và lưu ngay.")}catch(e){toast((e as Error).message)}finally{setSepayBusy(false)}}}>{sepay?.configured ? "Tạo lại credential" : "Tạo credential"}</button>{sepay?.webhookSecret && <div className="notice"><p><strong>Webhook secret</strong></p><input readOnly value={sepay.webhookSecret} onFocus={e=>e.currentTarget.select()}/><button className="button secondary" onClick={()=>navigator.clipboard.writeText(sepay.webhookSecret)}>Copy secret</button><p><strong>API key</strong></p><input readOnly value={sepay.apiKey} onFocus={e=>e.currentTarget.select()}/><button className="button secondary" onClick={()=>navigator.clipboard.writeText(sepay.apiKey)}>Copy API key</button><p className="small">Credential chỉ hiển thị đầy đủ một lần. Nếu tạo lại, credential cũ sẽ bị vô hiệu hóa.</p></div>}</> }</div>;
}
export default function Platform({
  area: initialArea = "overview",
}: {
  area?: string;
}) {
  const area = usePathname().split("/")[2] || initialArea;
  const router = useRouter();
  const { user, setUser, ready, toast } = useShop(),
    [loaded, setLoaded] = useState<{ area: string; data: any } | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [detail, setDetail] = useState<any>(null),
    [mobile, setMobile] = useState(false),
    [sepay, setSepay] = useState<any>(null),
    [sepayBusy, setSepayBusy] = useState(false),
    [approvalBusy, setApprovalBusy] = useState(false),
    [approvalRequired, setApprovalRequired] = useState(false);
  const data = loaded?.area === area ? loaded.data : null;
  useEffect(() => {
    if (area === "config" && data?.storeApprovalRequired !== undefined)
      setApprovalRequired(!!data.storeApprovalRequired);
  }, [area, data?.storeApprovalRequired]);
  const dataCache = useRef<Record<string, any>>({});
  const requestId = useRef(0);
  const activeArea = useRef(area);
  activeArea.current = area;
  const [usersRefresh, setUsersRefresh] = useState(0);
  const [freezeStore, setFreezeStore] = useState<any>(null);
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [freezeError, setFreezeError] = useState("");
  const [ghostStore, setGhostStore] = useState<any>(null),
    [ghostBusy, setGhostBusy] = useState(false),
    [ghostError, setGhostError] = useState("");
  function openStoreGhost(store: any) {
    setDetail(null);
    setGhostError("");
    setGhostStore(store);
  }
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
    if (activeArea.current !== area) return;
    const request = ++requestId.current;
    if (area === "users") {
      setUsersRefresh((v) => v + 1);
      return;
    }
    try {
      const result = await api("platform/" + area);
      if (request !== requestId.current) return;
      setLoaded({ area, data: result });
      dataCache.current[area] = result;
      setError("");
    } catch (e) {
      if (request === requestId.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    setLoaded(dataCache.current[area] ? { area, data: dataCache.current[area] } : null);
    setError("");
    setDetail(null);
    setSearch("");
    setFilter("");
    if (user?.platformRole === "platform_admin") void refresh();
    return () => {
      requestId.current++;
    };
    // Identity checks on window focus must not reset filters or open dialogs.
  }, [area, user?.id, user?.platformRole]);
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
    ["plans", "Danh mục gói dịch vụ", Package],
    ["stores", "Cửa hàng & Merchant CRM", Store],
    ["emails", "Email & chương trình", Mail],
    ["invoices", "Hóa đơn dịch vụ", Receipt],
    ["users", "Tài khoản", Users],
    ["config", "Cấu hình", Settings],
  ] as const;
  return (
    <div className="admin-shell platform-shell">
      <aside className={"admin-sidebar " + (mobile ? "mobile-open" : "")}>
        <Link className="logo" href="/">
          <Brand />
        </Link>
        <div className="workspace-label">PLATFORM CONSOLE</div>
        <nav>
          {nav.map(([k, t, I]) => (
            <Link
              className={area === k ? "active" : ""}
              href={"/platform/" + k}
              scroll={false}
              prefetch={true}
              aria-current={area === k ? "page" : undefined}
              key={k}
              onClick={() => setMobile(false)}
            >
              <I size={18} />
              {t}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="admin-user">
            <span className="avatar">{user.name.charAt(0)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>Quản trị nền tảng</small>
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
            aria-label="Mở menu"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <strong>Fleurious Platform</strong>
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
            </>
          ) : area === "plans" ? (
            <PlatformPlans plans={data} toast={toast} refresh={refresh} />
          ) : area === "emails" ? (
            <EmailWorkspace payload={data} refresh={refresh} canEdit platform />
          ) : area === "config" ? (
            <div className="platform-config">
              <div className="panel">
                <h3>Duyệt mở store</h3>
                <p className="small">
                  Khi bật, store mới sẽ ở trạng thái chờ duyệt và chủ store chỉ
                  vào workspace sau khi admin platform chấp thuận.
                </p>
                <label className="platform-user-check">
                  <input
                    type="checkbox"
                    checked={approvalRequired}
                    disabled={approvalBusy}
                    onChange={async (event) => {
                      const required = event.currentTarget.checked;
                      setApprovalRequired(required);
                      setApprovalBusy(true);
                      try {
                        await api("platform/config", "PATCH", {
                          storeApprovalRequired: required,
                        });
                        toast(
                          required
                            ? "Đã bật duyệt mở store."
                            : "Đã tắt duyệt mở store.",
                        );
                        await refresh();
                      } catch (e) {
                        setApprovalRequired(!required);
                        toast((e as Error).message);
                      } finally {
                        setApprovalBusy(false);
                      }
                    }}
                  />
                  Yêu cầu admin platform duyệt store mới
                </label>
              </div>
              <div className="dashboard-grid">
                {["google", "goong", "push", "smtp"].map((k) => (
                  <div className="panel" key={k}>
                    <h3>{k.toUpperCase()}</h3>
                    <p>{data[k] ? "Đã có cấu hình" : "Chưa có cấu hình"}</p>
                  </div>
                ))}
              </div>
              {!!data.paymentIssues?.length && <section className="panel table-scroll"><h3>Giao dịch cần đối soát</h3><p className="small">Các giao dịch chưa áp dụng được không tự cộng kỳ sử dụng. Kiểm tra ngân hàng và hóa đơn trước khi xác nhận thủ công.</p><table><thead><tr><th>Mã giao dịch SePay</th><th>Lý do</th><th>Thời điểm</th></tr></thead><tbody>{data.paymentIssues.map((i:any)=><tr key={i.provider_event_id}><td>{i.provider_event_id}</td><td>{i.error_message}</td><td>{formatDateTime(i.received_at)}</td></tr>)}</tbody></table></section>}
              <PlatformSepay sepay={sepay} setSepay={setSepay} sepayBusy={sepayBusy} setSepayBusy={setSepayBusy} toast={toast} />
              <form className="panel" key={JSON.stringify(data.billingBank)} onSubmit={async (e) => {
                e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget));
                try { await api("platform/config", "PATCH", { billingBank: { ...values, enabled: values.enabled === "on" } }); toast("Đã lưu ngân hàng nhận phí dịch vụ."); await refresh(); } catch (error) { toast((error as Error).message); }
              }}>
                <h3>Ngân hàng nhận phí dịch vụ</h3><p className="small">QR gia hạn gói dùng tài khoản của nền tảng. Tài khoản ngân hàng của store chỉ nhận tiền đơn hoa.</p>
                <div className="form-grid">
                  <label className="field">Mã ngân hàng (VietQR)<input name="bank_code" required defaultValue={data.billingBank?.bank_code || ""} placeholder="VD: MB" /></label>
                  <label className="field">Tên ngân hàng<input name="bank_name" required defaultValue={data.billingBank?.bank_name || ""} /></label>
                  <label className="field">Số tài khoản<input name="account_number" required pattern="[0-9]{4,30}" defaultValue={data.billingBank?.account_number || ""} /></label>
                  <label className="field">Chủ tài khoản<input name="account_holder" required defaultValue={data.billingBank?.account_holder || ""} /></label>
                </div>
                <label className="platform-user-check"><input type="checkbox" name="enabled" defaultChecked={!!data.billingBank?.enabled} />Cho phép thanh toán gói bằng QR</label>
                <button className="button">Lưu ngân hàng</button>
              </form>
            </div>
          ) : area === "stores" ? (
            <>
              <div className="board-toolbar">
                <input
                  aria-label="Tìm store"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tên store, email chủ store…"
                />
                <Select
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
                </Select>
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
                      <th className="table-actions-heading" scope="col">Thao tác</th>
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
                          <td>
                            <TableActions className="platform-user-actions platform-store-actions">
                              {s.status === "pending" && (
                                <TableAction icon={Check}
                                  type="button"
                                  className="text-button platform-store-approve"
                                  title={"Duyệt cửa hàng " + s.name}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void action(
                                      "stores/" + s.id + "/status",
                                      "PATCH",
                                      {
                                        status: "approved",
                                        reason: "Được duyệt bởi admin platform.",
                                        version: s.version,
                                      },
                                    );
                                  }}
                                >
                                  Duyệt
                                </TableAction>
                              )}
                              {s.status === "approved" && (
                                <TableAction icon={Snowflake}
                                  type="button"
                                  className="text-button"
                                  title={"Đóng băng cửa hàng " + s.name}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFreezeError("");
                                    setFreezeStore(s);
                                  }}
                                >
                                  Đóng băng
                                </TableAction>
                              )}
                              <TableAction icon={Ghost}
                                type="button"
                                className="text-button platform-store-ghost"
                                title={"Ghost cửa hàng " + s.name}
                                aria-label={"Ghost cửa hàng " + s.name}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openStoreGhost(s);
                                }}
                              >
                                Ghost
                              </TableAction>
                            </TableActions>
                          </td>
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
                <p className="small">Hóa đơn gia hạn được tạo trước hạn 5 ngày, theo ngày đăng ký của từng cửa hàng.</p>
                <button className="button">Đồng bộ hóa đơn & trạng thái</button>
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
                      <th className="table-actions-heading" scope="col">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((i: any) => (
                      <tr key={i.id}>
                        <td>{i.store_name}</td>
                        <td>{i.effective_start_at ? `${formatDateTime(i.effective_start_at, "utc")} → ${formatDateTime(i.effective_end_at, "utc")}` : i.period_start && i.period_end ? `Dự kiến: ${formatDate(i.period_start)} → ${formatDate(i.period_end)}` : i.period_key}<small>Hạn thanh toán: {i.due_at ? formatDateTime(i.due_at, "utc") : formatDate(i.due_date)}</small></td>
                        <td>{i.plan_name}</td>
                        <td>{money(i.amount)}</td>
                        <td>{money(i.paid)}</td>
                        <td>{statusText("invoice", i.void_reason === "payment_timeout" ? "payment_timeout" : i.status)}{i.purpose === "plan_change" && i.status === "open" && Number(i.paid) === 0 && <small>Hạn đổi gói: {i.payment_deadline_at} UTC</small>}</td>
                        <td>
                          {i.status === "open" && (
                            <form className="table-action-form"
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
                              <TableAction icon={Check} type="submit">
                                Ghi nhận
                              </TableAction>
                            </form>
                          )}
                          {i.status === "open" && i.paid === 0 && (
                            <details className="table-action-disclosure">
                              <summary><Ban size={15} aria-hidden="true" />Hủy hóa đơn</summary>
                              <form className="table-action-form"
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
                                <TableAction icon={Ban} type="submit">
                                  Xác nhận hủy
                                </TableAction>
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
          ) : null}
        </main>
      </div>
      {freezeStore && (
        <PlatformDialog title={"Đóng băng " + freezeStore.name} onClose={() => { if (!freezeBusy) setFreezeStore(null); }}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setFreezeBusy(true); setFreezeError("");
            try {
              await api("platform/stores/" + freezeStore.id + "/status", "PATCH", { status: "suspended", reason: form.get("reason"), version: freezeStore.version });
              setFreezeStore(null); toast("Đã đóng băng cửa hàng và thông báo cho chủ store."); await refresh();
            } catch (error) { setFreezeError((error as Error).message); } finally { setFreezeBusy(false); }
          }}>
            <p>Cửa hàng sẽ ngừng nhận đơn và các thao tác vận hành. Chủ store vẫn có thể xem thông tin và hóa đơn. Chỉ admin platform có thể mở lại sau khi đóng băng thủ công.</p>
            <label className="field">Lý do đóng băng<textarea name="reason" required minLength={5} maxLength={1000} /></label>
            {freezeError && <p className="error" role="alert">{freezeError}</p>}
            <div className="button-row"><button className="button" disabled={freezeBusy}>{freezeBusy ? "Đang xử lý…" : "Đóng băng cửa hàng"}</button><button type="button" className="button secondary" disabled={freezeBusy} onClick={() => setFreezeStore(null)}>Hủy</button></div>
          </form>
        </PlatformDialog>
      )}
      {ghostStore && (
        <PlatformDialog
          title="Ghost tài khoản cửa hàng"
          onClose={() => {
            if (!ghostBusy) setGhostStore(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (ghostBusy) return;
              const reason = new FormData(e.currentTarget).get("reason");
              setGhostBusy(true);
              setGhostError("");
              try {
                const result = await api(
                  "platform/stores/" + ghostStore.id + "/ghost",
                  "POST",
                  { reason },
                );
                window.location.assign(result.redirect);
              } catch (e) {
                setGhostError((e as Error).message);
                setGhostBusy(false);
              }
            }}
          >
            <h3>{ghostStore.name}</h3>
            <p>Chủ cửa hàng: {ghostStore.owner_email}</p>
            <p>
              Bạn sẽ truy cập workspace bằng tài khoản chủ cửa hàng. Phiên hỗ
              trợ tối đa 20 phút và được ghi nhật ký. Các giới hạn của phiên
              Ghost vẫn áp dụng.
            </p>
            <label className="field">
              Lý do hỗ trợ
              <textarea
                name="reason"
                minLength={5}
                maxLength={500}
                required
                disabled={ghostBusy}
              />
            </label>
            {ghostError && (
              <p className="error" role="alert">
                {ghostError}
              </p>
            )}
            <div className="button-row">
              <button className="button" disabled={ghostBusy}>
                {ghostBusy ? "Đang mở workspace…" : "Bắt đầu Ghost"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={ghostBusy}
                onClick={() => setGhostStore(null)}
              >
                Hủy
              </button>
            </div>
          </form>
        </PlatformDialog>
      )}
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
          <div className="merchant-detail-header">
            <div>
              <span className="eyebrow">MERCHANT PROFILE</span>
              <h2>{detail.store.name}</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Đóng"
              onClick={() => setDetail(null)}
            >
              ✕
            </button>
          </div>
          <div className="merchant-detail-meta">
            <p>{detail.store.address || "Chưa có địa chỉ"}</p>
            <p>{detail.store.phone || "Chưa có số điện thoại"}</p>
            <span className="tag">
              {statusText("store", detail.store.status)}
            </span>
            <Link href={"/s/" + detail.store.slug} target="_blank">
              Xem storefront ↗
            </Link>
          </div>
          <div className="merchant-detail-grid">
          <form
            className="panel merchant-detail-section"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              const nextStatus = f.quickStatus || f.status;
              void action("stores/" + detail.store.id + "/status", "PATCH", {
                status: nextStatus,
                reason: f.reason,
                version: detail.store.version,
              });
            }}
          >
            <h3>Vận hành store</h3>
            <label className="field">
              Chuyển trạng thái
              <Select name="status" defaultValue={detail.store.status}>
                {[detail.store.status, ...(detail.store.status === "pending"
                  ? ["approved", "rejected"]
                  : ["approved", "rejected", "suspended", "closed"])]
                  .filter((s, i, all) => all.indexOf(s) === i)
                  .map((s) => (
                  <option key={s} value={s}>
                    {statusText("store", s)}
                  </option>
                  ))}
              </Select>
            </label>
            <label className="field">
              Lý do
              <textarea name="reason" minLength={5} required />
            </label>
            <div className="button-row">
              {detail.store.status === "pending" && (
                <>
                  <button className="button" name="quickStatus" value="approved">
                    Duyệt cửa hàng
                  </button>
                  <button
                    className="button secondary"
                    name="quickStatus"
                    value="rejected"
                  >
                    Từ chối
                  </button>
                </>
              )}
              <button className="button secondary">Cập nhật trạng thái</button>
            </div>
          </form>
          {detail.subscription?.billing_policy === 1 || detail.subscription?.trial_started_at ? <TrialExtension key={detail.subscription?.version} detail={detail} action={action}/> : <>
          <form
            className="panel merchant-detail-section"
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
              <Select
                name="plan_id"
                defaultValue={detail.subscription?.plan_id}
              >
                <option value="1">Khởi đầu</option>
                <option value="2">Studio</option>
                <option value="3">Atelier</option>
              </Select>
            </label>
            <label className="field">
              Trạng thái
              <Select name="status" defaultValue={detail.subscription?.status}>
                {["free", "active", "past_due", "restricted", "cancelled"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {statusText("subscription", s)}
                    </option>
                  ),
                )}
              </Select>
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
          </form></>}

          </div>
          <div className="panel merchant-detail-section merchant-detail-full">
            <h3>Merchant CRM · Việc chăm sóc</h3>
            {detail.tasks.map((t: any) => (
              <div key={t.id}>
                <strong>{t.title}</strong>
                <p>{t.note}</p>
                <small>
                  {formatDate(t.due_date)} · {statusText("task", t.status)}
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
          <div className="panel merchant-detail-section merchant-detail-full">
            <h3>Nhật ký</h3>
            {detail.audit.map((a: any) => (
              <p key={a.id}>
                {formatDateTime(a.created_at)} · {auditAction(a.action, a.entity)} ·{" "}
                {statusText("entity", a.entity)}
                {a.detail && <small>{(() => { const d=typeof a.detail === "string" ? JSON.parse(a.detail) : a.detail;return d.reason ? `+${d.days} ngày · ${d.previous_end} → ${d.new_end} UTC · ${d.reason}` : "";})()}</small>}
              </p>
            ))}
          </div>
        </dialog>
      )}
    </div>
  );
}
