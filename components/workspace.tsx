"use client";
import { isExperiencePlan, planRank } from "@/lib/plan-policy";
import DateInput from "./date-input";
import { hanoiDateKey, formatDateTime, formatDate, parseDateTime } from "@/lib/date-time";
import { APP_TIME_ZONE_LABEL } from "@/lib/regional";
import Select from "./ui-select";
import StoreTeam from "./store-team";
import StoreAnalyticsReport from "./store-analytics";
import { Eye, Trash2, Pause, Play, QrCode, X } from "lucide-react";
import { TableAction, TableActions } from "./table-actions";
import { Fragment, useEffect, useState, useRef, useCallback } from "react";
import { api, useShop } from "./context";
import { Status, statusNames } from "./pages";
import { money } from "./home";
import Link from "./routing";
import { displayLabel } from "@/lib/display-labels";
import ManualOrderEditor from "./manual-order-editor";
import DeliveryAddress from "./delivery-address";
import { useOrderTransition } from "./order-transition";
import { orderChannel } from "@/lib/order-workflow";
import { orderCapabilities } from "@/lib/order-capabilities";
import OrderPaymentEditor from "./order-payment-editor";
import OrderCODReceipt, { OrderMethodTag, CODSummary, OrderPaymentSummary, CODMonitor } from "./order-cod";
import { codPayerLabel, codOutstanding, isPaidCOD } from "@/lib/cod-policy";
import BoardToolbar, { OrderDraftsLink } from "./board-toolbar";
import WorkspaceAI from "./workspace-ai";
import WorkspaceRefunds from "./workspace-refunds";
import { aiAllowance } from "@/lib/ai-policy";
const statuses = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "shipping",
  "delivered",
  "cancelled",
];
export const workspaceAreas = [
  "ai",
  "new-order",
  "board",
  "orders",
  "refunds",
  "calendar",
  "automations",
  "analytics",
  "settings",
  "theme",
  "billing",
  "team",
  "users",
];
export default function WorkspaceView({ area }: { area: string }) {
  if (area === "ai") return <WorkspaceAI />;
  if (area === "new-order") return <ManualOrderEditor />;
  if (area === "board") return <OrderBoard />;
  if (area === "orders") return <OrderBoard table />;
  if (area === "refunds") return <WorkspaceRefunds />;
  if (area === "calendar") return <Calendar />;
  if (area === "automations") return <Automations />;
  if (area === "analytics") return <StoreAnalyticsReport />;
  if (area === "settings") return <StoreSettings />;
  if (area === "theme") return <ThemeEditor />;
  if (area === "billing") return <BillingCards />;
  return <Team />;
}
function useLoad(path: string, live = false) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const result = await api(path);
      if (request !== sequence.current) return;
      setData(result);
      setError("");
    } catch (e) {
      if (request === sequence.current) setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void refresh();
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = live ? setInterval(update, 30000) : undefined;
    if (live) window.addEventListener("focus", update);
    return () => {
      sequence.current++;
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [refresh, live]);
  return { data, error, refresh };
}
function Loading({ error }: { error: string }) {
  return (
    <p role="status" className={error ? "error" : "empty"}>
      {error || "Đang tải…"}
    </p>
  );
}
function OrderChannelTag({ order }: { order: any }) {
  const channel = orderChannel(order);
  return (
    <span className={"tag order-channel-tag order-channel-" + channel.key} title={"Kênh tiếp nhận: " + channel.label}>
      {channel.label}
    </span>
  );
}
function OrderCard({
  order,
  onOpen,
}: {
  order: any;
  onOpen: (o: any) => void;
}) {
  return (
    <button
      className="kanban-card"
      onClick={() => onOpen(order)}
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("application/fleur-order", String(order.id))
      }
    >
      <span className="eyebrow">{order.reference}</span>
      <div className="kanban-card-heading">
        <strong>{order.customer_name}</strong>
        <OrderChannelTag order={order} />
      </div>
      <p>
        {order.delivery_date} · {order.delivery_slot}
      </p>
      <small>
        {order.recipient_name} · {order.recipient_phone}
      </small>
      <div className="flex-between">
        <strong className="kanban-card-price">{money(order.total)}</strong>
        <Status value={order.payment_status} />
      </div>
      <OrderPaymentSummary order={order} />
      {(typeof order.tags === "string"
        ? JSON.parse(order.tags)
        : order.tags || []
      ).map((t: string) => (
        <span className="tag" key={t}>
          {t}
        </span>
      ))}
    </button>
  );
}
export function OrderBoard({ table = false }: { table?: boolean }) {
  const { toast } = useShop();
  const [search, setSearch] = useState(""),
    [queryText, setQueryText] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [date, setDate] = useState(""),
    [payment, setPayment] = useState(""),
    [source, setSource] = useState(""),
    [method, setMethod] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [pages, setPages] = useState<Record<string, number>>({});
  useEffect(() => {
    const timer = setTimeout(() => {
      setQueryText(search);
      setPages({});
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({
    q: queryText,
    date,
    payment,
    mode: table ? "table" : "board",
    status: statusFilter,
    source,
    method,
  });
  Object.entries(pages).forEach(([s, p]) =>
    params.set(s === "all" ? "page" : "page_" + s, String(p)),
  );
  const { data, error, refresh } = useLoad(
    "workspace/order-list?" + params,
    true,
  );
  const allOrders = table
    ? data?.items || []
    : data?.columns?.flatMap((c: any) => c.items) || [];
  useEffect(() => {
    const orderId = new URLSearchParams(location.search).get("order");
    if (!orderId || !/^\d+$/.test(orderId)) return;
    let active = true;
    api("workspace/manual-orders/" + orderId)
      .then((o) => {
        if (active) setSelected(o);
      })
      .catch((e) => toast(e.message));
    return () => {
      active = false;
    };
  }, [toast]);
  const pagination = (c: any, key: string) => (
    <div className="order-pagination">
      <button
        type="button"
        disabled={c.page <= 1}
        onClick={() => setPages((p) => ({ ...p, [key]: c.page - 1 }))}
        aria-label={"Trang trước " + (statusNames[key] || "đơn hàng")}
      >
        ←
      </button>
      <span>
        Trang {c.page} / {Math.max(1, Math.ceil(c.total / c.limit))}
      </span>
      <button
        type="button"
        disabled={c.page * c.limit >= c.total}
        onClick={() => setPages((p) => ({ ...p, [key]: c.page + 1 }))}
        aria-label={"Trang sau " + (statusNames[key] || "đơn hàng")}
      >
        →
      </button>
    </div>
  );
  const { move, busy, confirmation } = useOrderTransition(refresh, () =>
    setSelected(null),
  );
  return (
    <div data-no-fade-in>
      {!table ? <BoardToolbar
        search={search} date={date} payment={payment} source={source} method={method}
        onMethod={value => {setMethod(value);setPages({});}}
        onSearch={setSearch}
        onDate={value => { setDate(value); setPages({}); }}
        onPayment={value => { setPayment(value); setPages({}); }}
        onSource={value => { setSource(value); setPages({}); }}
        onRefresh={() => void refresh()}
      /> : <div className="board-toolbar">
        <OrderDraftsLink />
        <input
          aria-label="Tìm đơn hàng"
          placeholder="Mã đơn, tên khách, số điện thoại…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <DateInput
          aria-label="Ngày giao"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPages({});
          }}
        />
        <Select
          aria-label="Lọc thanh toán"
          value={payment}
          onChange={(e) => {
            setPayment(e.target.value);
            setPages({});
          }}
        >
          <option value="">Tất cả thanh toán</option>
          {[
            "unpaid",
            "partially_paid",
            "paid",
            "partially_refunded",
            "refunded",
          ].map((s) => (
            <option key={s} value={s}>
              {statusNames[s] || s}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Nguồn tạo đơn"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPages({});
          }}
        >
          <option value="">Tất cả nguồn</option>
          <option value="web">Website</option>
          <option value="manual">Thủ công</option>
        </Select>
        <Select aria-label="Phương thức thanh toán" value={method} onChange={e=>{setMethod(e.target.value);setPages({});}}>
          <option value="">Tất cả phương thức</option><option value="cod">COD</option><option value="bank">Chuyển khoản</option><option value="cod_due">COD còn phải thu</option><option value="cod_delivered_due">COD đã giao chưa thu đủ</option>
        </Select>
        {table && (
          <Select
            aria-label="Lọc trạng thái"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPages({});
            }}
          >
            <option value="">Tất cả trạng thái</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusNames[s]}
              </option>
            ))}
          </Select>
        )}
        <button className="button secondary" onClick={() => void refresh()}>
          Làm mới
        </button>
      </div>}
      <p className="small">
        {table
          ? "Mở mã đơn để xem chi tiết và cập nhật."
          : "Kéo thẻ sang trạng thái cần chuyển, bao gồm hủy và khôi phục đơn. Trên điện thoại, mở chi tiết để chọn trạng thái."}{" "}
        Tự làm mới mỗi 30 giây khi cửa sổ đang mở.
      </p>
      <CODMonitor stats={data?.codStats} />
      {error && data && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      {!data ? (
        <Loading error={error} />
      ) : table ? (
        <div className="panel">
          <div className="table-wrap table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Khách hàng</th>
                  <th>Ngày giao</th>
                  <th>Trạng thái</th>
                  <th>Thanh toán</th>
                  <th>Tổng</th>
                  <th className="table-actions-heading" scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o: any) => (
                  <tr key={o.id}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setSelected(o)}
                      >
                        {o.reference}
                      </button>
                    </td>
                    <td>
                      {o.customer_name}
                      <br />
                      <small>{o.phone}</small>
                      <br />
                      <OrderChannelTag order={o} />
                    </td>
                    <td>
                      {o.delivery_date}
                      <br />
                      <small>{o.delivery_slot}</small>
                    </td>
                    <td>
                      <Status value={o.status} />
                    </td>
                    <td>
                      <Status value={o.payment_status} /><OrderPaymentSummary order={o} />
                    </td>
                    <td>{money(o.total)}</td>
                    <td><TableActions><TableAction icon={Eye} onClick={() => setSelected(o)}>Chi tiết</TableAction></TableActions></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.total && <p className="empty">Không có đơn phù hợp.</p>}
          {pagination(data, "all")}
        </div>
      ) : (
        <div className="kanban" aria-busy={busy}>
          {data.columns.map((column: any) => {
            const s = column.status;
            return (
              <div
                className="kanban-column"
                key={s}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (busy) return;
                  const o = allOrders.find(
                    (o: any) =>
                      o.id ===
                      Number(e.dataTransfer.getData("application/fleur-order")),
                  );
                  if (o) void move(o, s);
                }}
              >
                <h3>
                  {statusNames[s]} <span>{column.total}</span>
                </h3>
                {column.items.map((o: any) => (
                  <OrderCard key={o.id} order={o} onOpen={setSelected} />
                ))}
                {!column.total && <p className="small">Chưa có đơn</p>}
                {pagination(column, s)}
              </div>
            );
          })}
        </div>
      )}
      {selected && (
        <OrderPanel
          key={selected.id}
          order={selected}
          close={() => setSelected(null)}
          move={move}
          refresh={refresh}
        />
      )}
      {confirmation}
    </div>
  );
}
function OrderPanel({
  order,
  close,
  move,
  refresh,
}: {
  order: any;
  close: () => void;
  move: (o: any, s: string) => void;
  refresh: () => Promise<void>;
}) {
  const [o, setOrder] = useState(order);
  const { data, refresh: reloadTimeline } = useLoad("workspace/orders/" + o.id + "/timeline"),
    { user, toast } = useShop();
  const {
    data: assignment,
    error: assignmentError,
    refresh: reloadAssignment,
  } = useLoad("workspace/orders/" + o.id + "/assignment");
  const [paymentError, setPaymentError] = useState(""),
    [busy, setBusy] = useState(false),
    [targetStatus, setTargetStatus] = useState(o.status);
  const canAdjustPayment = user?.role === "owner";
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const focused = document.activeElement;
    const { overflow, paddingRight } = document.body.style;
    const scrollbar = innerWidth - document.documentElement.clientWidth;
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
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  const items = typeof o.items === "string" ? JSON.parse(o.items) : o.items;
  return (
    <dialog
      ref={dialogRef}
      className="modal order-panel"
      aria-modal="true"
      aria-label={"Đơn " + o.reference}
      data-no-fade-in
      onCancel={(e) => {
        e.preventDefault();
        close();
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
          close();
      }}
    >
      <header className="modal-heading">
        <h2>Đơn {o.reference}</h2>
        <button className="icon-button" aria-label="Đóng" onClick={close}>
          ✕
        </button>
      </header>
      <div className="modal-body order-panel-body">
        <div className="order-overview">
          <div>
            <span className="order-caption">Tiến trình đơn</span>
            <Status value={o.status} />
          </div>
          <div>
            <span className="order-caption">Thanh toán</span>
            <Status value={o.payment_status} />
          </div>
          <div>
            <span className="order-caption">Tổng đơn hàng</span>
            <strong className="order-total">{money(o.total)}</strong>
          </div>
        </div>
        <form
          className="order-status-control"
          onSubmit={(e) => {
            e.preventDefault();
            move(o, targetStatus);
          }}
        >
          <label className="field">
            Chuyển trạng thái đơn
            <Select
              value={targetStatus}
              onChange={(e) => setTargetStatus(e.target.value)}
              aria-label="Trạng thái mới"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusNames[s]}
                </option>
              ))}
            </Select>
          </label>
          <button
            className="button"
            disabled={busy || targetStatus === o.status}
          >
            Cập nhật trạng thái
          </button>
        </form>
        <div className="order-detail-grid">
          <section className="order-section">
            <h3>Giao hoa</h3>
            <p className="order-delivery-time">
              <strong>
                {String(o.delivery_date).split("-").reverse().join("/")}
              </strong>
              <span>{o.delivery_slot}</span>
            </p>
            <dl className="order-facts">
              <div>
                <dt>Người nhận</dt>
                <dd>{o.recipient_name || o.customer_name}</dd>
              </div>
              <div>
                <dt>Điện thoại</dt>
                <dd>{o.recipient_phone || o.phone}</dd>
              </div>
              <div>
                <dt>Địa chỉ</dt>
                <dd>{o.address}</dd>
              </div>
            </dl>
            {o.notes && (
              <p className="order-note">
                <strong>Ghi chú giao hàng</strong>
                <br />
                {o.notes}
              </p>
            )}
          </section>
          <section className="order-section">
            <h3>Khách đặt hoa</h3>
            <dl className="order-facts">
              <div>
                <dt>Họ tên</dt>
                <dd>{o.customer_name}</dd>
              </div>
              <div>
                <dt>Điện thoại</dt>
                <dd>{o.phone}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{o.email || "Chưa cung cấp"}</dd>
              </div>
              <div>
                <dt>Kênh tiếp nhận</dt>
                <dd><OrderChannelTag order={o} /></dd>
              </div>
              {o.creation_source === "manual" && (
                <div>
                  <dt>Người tạo</dt>
                  <dd>{o.creator_name || "#" + o.created_by}</dd>
                </div>
              )}
            </dl>
            {!o.email && (
              <p className="small">
                Không gửi email: khách chưa cung cấp email.
              </p>
            )}
          </section>
          <section className="order-section order-products">
            <h3>
              Sản phẩm{" "}
              <span className="muted">
                (
                {items?.reduce(
                  (sum: number, i: any) => sum + Number(i.quantity),
                  0,
                ) || 0}
                )
              </span>
            </h3>
            {items?.map((i: any, n: number) => {
              let detail: any = {};
              try {
                detail =
                  typeof i.description === "string"
                    ? JSON.parse(i.description)
                    : i.description || {};
              } catch {
                detail = { text: i.description };
              }
              return (
                <div className="order-product" key={n}>
                  {i.image && (
                    <img
                      src={i.image}
                      alt={
                        i.line_type === "custom"
                          ? "Ảnh tham khảo thiết kế"
                          : i.name
                      }
                    />
                  )}
                  <div className="order-product-content">
                    <strong>{i.name || i.product_name}</strong>
                    <p className="small">
                      {i.line_type === "custom"
                        ? "Thiết kế riêng"
                        : "Cỡ " + i.size}{" "}
                      · SL: {i.quantity} × {money(i.price)}
                    </p>
                    {detail.text && <p>Yêu cầu thiết kế: {detail.text}</p>}
                    {detail.priceReason && (
                      <p className="small">
                        Lý do điều chỉnh giá: {detail.priceReason}
                      </p>
                    )}
                  </div>
                  <strong className="order-line-total">
                    {money(Number(i.price) * Number(i.quantity))}
                  </strong>
                </div>
              );
            })}
          </section>
          <section className="order-section order-finance">
            <h3>Giá & thanh toán</h3>
            <dl className="order-price-list">
              {!isPaidCOD(o) && <div>
                <dt>Phương thức thanh toán</dt>
                <dd><OrderMethodTag order={o} /></dd>
              </div>}
              <div>
                <dt>Tiền sản phẩm</dt>
                <dd>{money(Number(o.subtotal || 0))}</dd>
              </div>
              <div>
                <dt>Giảm giá</dt>
                <dd>−{money(Number(o.discount || 0))}</dd>
              </div>
              <div>
                <dt>Phí giao hoa</dt>
                <dd>{money(Number(o.shipping || 0))}</dd>
              </div>
              <div className="order-price-total">
                <dt>Tổng thanh toán</dt>
                <dd>{money(o.total)}</dd>
              </div>
              <div>
                <dt>Đã thu (sau hoàn)</dt>
                <dd>{money(Number(o.collected || 0))}</dd>
              </div>
              <div>
                <dt>
                  {o.status === "cancelled" ? "Còn cần hoàn" : "Còn phải thu"}
                </dt>
                <dd>
                  {money(
                    o.status === "cancelled"
                      ? Number(o.collected || 0)
                      : Math.max(0, o.total - Number(o.collected || 0)),
                  )}
                </dd>
              </div>
            </dl>
            {codOutstanding(o)>0 && <div className="cod-detail-summary"><p className="small">{codPayerLabel(o)}</p><CODSummary order={o} /></div>}
            {canAdjustPayment && <OrderCODReceipt key={"cod:"+o.version} order={o} disabled={busy} onBusy={setBusy} onSaved={async()=>{setOrder(await api("workspace/manual-orders/"+o.id));await Promise.all([refresh(),reloadTimeline(),reloadAssignment()]);}} />}
            {canAdjustPayment && (
              <OrderPaymentEditor
                key={o.id + ":" + o.version}
                order={o}
                disabled={busy}
                onBusy={setBusy}
                onSaved={async () => {
                  const updated = await api("workspace/manual-orders/" + o.id);
                  setOrder(updated);
                  await Promise.all([refresh(), reloadTimeline(), reloadAssignment()]);
                }}
              />
            )}
          </section>
          <section className="order-section order-message">
            <h3>Lời nhắn trên thiệp</h3>
            <blockquote>{o.message || "Không có lời nhắn"}</blockquote>
          </section>
        </div>
        {o.status === "cancelled" && Number(o.collected) > 0 && (
          <p className="order-alert">
            Đơn đã hủy còn {money(Number(o.collected))} cần xử lý hoàn tiền.
            {" "}<Link href="/admin/refunds" className="text-link">Mở danh sách hoàn tiền</Link>
          </p>
        )}
        {o.internal_notes && (
          <div className="order-section">
            <strong>Ghi chú nội bộ</strong>
            <p>{o.internal_notes}</p>
          </div>
        )}
        <p className="small">
          Trạng thái giao và thu tiền được cập nhật riêng.
        </p>
        {paymentError && (
          <p className="error" role="alert">
            {paymentError}
          </p>
        )}
        <details className="order-secondary" open>
          <summary>
            Phân công & nhãn{" "}
            <span>{assignment?.assigned_name || "Chưa phân công"}</span>
          </summary>
          <form
            className="panel"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!assignment || busy) return;
              setBusy(true);
              setPaymentError("");
              try {
                const f = Object.fromEntries(new FormData(e.currentTarget));
                await api("workspace/orders/" + o.id + "/assignment", "PATCH", {
                  assigned_to: f.assigned_to ? Number(f.assigned_to) : null,
                  tags: String(f.tags)
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                  version: assignment.version,
                });
                await refresh();
                close();
                toast("Đã lưu người phụ trách và nhãn.");
              } catch (e) {
                setPaymentError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {!assignment && !assignmentError && (
              <p className="small" role="status">
                Đang tải phân công…
              </p>
            )}
            {assignmentError && (
              <p className="error" role="alert">
                {assignmentError}{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void reloadAssignment()}
                >
                  Thử lại
                </button>
              </p>
            )}
            <fieldset
              className="manual-fieldset"
              disabled={!assignment || busy}
              key={assignment?.version ?? "loading"}
            >
              <label className="field">
                Người phụ trách
                <Select
                  name="assigned_to"
                  aria-label="Người phụ trách"
                  defaultValue={assignment?.assigned_to || ""}
                >
                  <option value="">Chưa phân công</option>
                  {assignment?.assigned_to &&
                    !assignment.staff.some(
                      (s: any) => s.id === assignment.assigned_to,
                    ) && (
                      <option value={assignment.assigned_to}>
                        {assignment.assigned_name ||
                          "Nhân sự đã ngừng hoạt động"}{" "}
                        (không còn hoạt động)
                      </option>
                    )}
                  {assignment?.staff.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                Nhãn (phân cách bằng dấu phẩy, tối đa 6)
                <input
                  name="tags"
                  defaultValue={(typeof assignment?.tags === "string"
                    ? JSON.parse(assignment.tags)
                    : assignment?.tags || []
                  ).join(", ")}
                />
              </label>
              <p className="small">Mỗi nhãn tối đa 30 ký tự.</p>
              <button className="button secondary">
                {busy ? "Đang lưu…" : "Lưu phân công"}
              </button>
            </fieldset>
          </form>
        </details>
        {["pending", "confirmed", "preparing", "ready"].includes(o.status) && (
          <details className="order-secondary">
            <summary>Đổi lịch giao</summary>
            <form
              className="panel"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api(
                    "workspace/orders/" + o.id + "/reschedule",
                    "PATCH",
                    {
                      ...Object.fromEntries(new FormData(e.currentTarget)),
                      version: o.version,
                    },
                  );
                  await refresh();
                  close();
                  toast("Đã đổi lịch và tạo thông báo.");
                } catch (e) {
                  setPaymentError((e as Error).message);
                }
              }}
            >
              <label className="field">
                Ngày mới
                <DateInput type="date" name="date" required />
              </label>
              <label className="field">
                Khung giờ
                <input name="slot" defaultValue={o.delivery_slot} required />
              </label>
              <label className="field">
                Lý do
                <input name="reason" minLength={5} required />
              </label>
              <button className="button secondary">Xác nhận đổi lịch</button>
            </form>
          </details>
        )}
        <details className="order-secondary">
          <summary>Lịch sử đơn & giao dịch</summary>
          <div className="order-history">
            {data?.events?.map((e: any) => (
              <p key={e.id} className="timeline-entry">
                <strong>{statusNames[e.status] || e.status}</strong> ·{" "}
                {formatDateTime(e.created_at)}
                {e.detail && (
                  <span className="order-event-detail">{e.detail}</span>
                )}
              </p>
            ))}
            {data?.payments?.map((e: any) => (
              <p key={e.id}>
                {e.kind === "correction" ? "Điều chỉnh ghi nhầm" : e.kind === "collect" ? "Thu" : "Hoàn"} {money(e.amount)} ·{" "}
                {e.method === "bank" ? "Chuyển khoản" : "Tiền mặt"} ·{" "}
                {e.reference} · {e.received_at ? formatDateTime(e.received_at, "utc") : formatDateTime(e.created_at)}
              </p>
            ))}
          </div>
        </details>
      </div>
    </dialog>
  );
}
function Calendar() {
  const today = hanoiDateKey();
  const [month, setMonth] = useState(today.slice(0, 7)),
    [selected, setSelected] = useState(today),
    [view, setView] = useState("month"),
    [order, setOrder] = useState<any>(null),
    { toast } = useShop();
  const end = new Date(Date.UTC(
      Number(month.slice(0, 4)),
      Number(month.slice(5)),
      0,
    )).getUTCDate(),
    weekStart = new Date(selected + "T12:00:00Z");
  weekStart.setUTCDate(
    weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7),
  );
  const from =
      view === "week" ? weekStart.toISOString().slice(0, 10) : month + "-01",
    to =
      view === "week"
        ? new Date(weekStart.getTime() + 6 * 86400000)
            .toISOString()
            .slice(0, 10)
        : month + "-" + String(end).padStart(2, "0");
  const { data, error, refresh } = useLoad(
    "workspace/calendar?from=" + from + "&to=" + to,
    true,
  );
  const { move, confirmation } = useOrderTransition(refresh, () =>
    setOrder(null),
  );
  return (
    <div className="calendar-workspace" data-no-fade-in>
      <div className="board-toolbar">
        <div className="segmented" aria-label="Chế độ lịch">
          {[
            ["month", "Tháng"],
            ["week", "Tuần"],
            ["agenda", "Lịch trình"],
          ].map(([v, label]) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <Link
          className="button secondary"
          href={"/admin/orders/new?date=" + selected}
        >
          Tạo đơn ngày này
        </Link>
        {view === "week" ? (
          <DateInput
            type="date"
            aria-label="Tuần của ngày"
            value={selected}
            onChange={(e) => {
              if (e.target.value) {
                setSelected(e.target.value);
                setMonth(e.target.value.slice(0, 7));
              }
            }}
          />
        ) : (
          <DateInput
            aria-label="Tháng"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setSelected(e.target.value + "-01");
              }
            }}
          />
        )}
        <p>Ngày giao hoa · {APP_TIME_ZONE_LABEL}</p>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="calendar-layout">
          {view === "agenda" ? (
            <div className="calendar-agenda">
              {Array.from(
                new Set<string>([
                  ...data.orders.map((o: any) => o.delivery_date),
                  ...data.notes.map((n: any) => n.day),
                ]),
              )
                .sort()
                .map((day) => (
                  <section className="panel" key={day}>
                    <button
                      className="text-button"
                      onClick={() => setSelected(day)}
                    >
                      <h3>
                        {day} ·{" "}
                        {
                          data.orders.filter(
                            (o: any) => o.delivery_date === day,
                          ).length
                        }{" "}
                        đơn
                      </h3>
                    </button>
                    {data.orders
                      .filter((o: any) => o.delivery_date === day)
                      .map((o: any) => (
                        <OrderCard key={o.id} order={o} onOpen={setOrder} />
                      ))}
                    {data.notes
                      .filter((n: any) => n.day === day)
                      .map((n: any) => (
                        <p
                          key={n.id}
                          className="calendar-note"
                          style={{ borderColor: n.color }}
                        >
                          {n.title}
                        </p>
                      ))}
                  </section>
                ))}
              {!data.orders.length && !data.notes.length && (
                <p className="empty">
                  Chưa có đơn hoặc ghi chú trong tháng này.
                </p>
              )}
            </div>
          ) : (
            <div className="calendar-grid">
              {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
                <strong key={d}>{d}</strong>
              ))}
              {Array.from(
                {
                  length:
                    view === "week"
                      ? 0
                      : (new Date(from + "T12:00:00Z").getUTCDay() + 6) % 7,
                },
                (_, i) => (
                  <div key={"blank" + i} />
                ),
              )}
              {Array.from({ length: view === "week" ? 7 : end }, (_, i) => {
                const day =
                    view === "week"
                      ? new Date(weekStart.getTime() + i * 86400000)
                          .toISOString()
                          .slice(0, 10)
                      : month + "-" + String(i + 1).padStart(2, "0"),
                  orders = data.orders.filter(
                    (o: any) => o.delivery_date === day,
                  ),
                  notes = data.notes.filter((n: any) => n.day === day);
                return (
                  <button
                    key={day}
                    className={
                      "calendar-day " + (day === selected ? "active" : "")
                    }
                    onClick={() => setSelected(day)}
                  >
                    <strong>{view === "week" ? day.slice(8) : i + 1}</strong>
                    {orders.length > 0 && (
                      <span className="calendar-order-tag">
                        {orders.length} đơn ·{" "}
                        {
                          orders.filter((o: any) => o.status === "pending")
                            .length
                        }{" "}
                        chờ
                      </span>
                    )}
                    {orders.some((o:any)=>codOutstanding(o)>0) && <span className="calendar-cod-tag">COD: {orders.filter((o:any)=>codOutstanding(o)>0).length} đơn</span>}
                    {notes.slice(0, 2).map((n: any) => (
                      <span
                        className="calendar-note-tag"
                        key={n.id}
                        style={{ background: n.color }}
                      >
                        {n.title}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
          )}
          <aside className="calendar-detail panel">
            <h3>Ngày {formatDate(selected)}</h3>
            {data.orders
              .filter((o: any) => o.delivery_date === selected)
              .map((o: any) => (
                <OrderCard order={o} key={o.id} onOpen={setOrder} />
              ))}
            {!data.orders.some((o: any) => o.delivery_date === selected) && (
              <p className="small">Chưa có đơn giao ngày này.</p>
            )}
            {data.notes
              .filter((n: any) => n.day === selected)
              .map((n: any) => (
                <div
                  className="calendar-note"
                  key={n.id}
                  style={{ borderColor: n.color }}
                >
                  <strong>{n.title}</strong>
                  <p>{n.content}</p>
                  <TableActions><TableAction icon={Trash2}
                    onClick={async () => {
                      try {
                        await api(
                          "workspace/calendar/notes/" + n.id,
                          "DELETE",
                          {},
                        );
                        void refresh();
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  >
                    Xóa ghi chú
                  </TableAction></TableActions>
                </div>
              ))}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                try {
                  await api("workspace/calendar/notes", "POST", {
                    ...Object.fromEntries(new FormData(form)),
                    day: selected,
                  });
                  form.reset();
                  await refresh();
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              <h3>Ghi chú cho ngày này</h3>
              <label className="field">
                Tiêu đề
                <input name="title" required maxLength={160} />
              </label>
              <label className="field">
                Nội dung
                <textarea name="content" maxLength={3000} />
              </label>
              <label className="field">
                Màu
                <Select name="color">
                  {[
                    ["#555555", "Xám"],
                    ["#a34b40", "Đỏ"],
                    ["#96731b", "Vàng"],
                    ["#3c7665", "Xanh lá"],
                    ["#4f6395", "Xanh dương"],
                  ].map(([v, t]) => (
                    <option value={v} key={v}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
              <button className="button">Thêm ghi chú</button>
            </form>
          </aside>
        </div>
      )}
      {order && (
        <OrderPanel
          key={order.id}
          order={order}
          close={() => setOrder(null)}
          move={move}
          refresh={refresh}
        />
      )}
      {confirmation}
    </div>
  );
}
function StoreAddressFields({ store }: { store: any }) {
  const [address, setAddress] = useState<string>(store.address || "");
  const [lat, setLat] = useState<string>(
    store.lat == null ? "" : String(store.lat),
  );
  const [lng, setLng] = useState<string>(
    store.lng == null ? "" : String(store.lng),
  );
  return (
    <>
      <DeliveryAddress
        label="Địa chỉ"
        selectionHint="Đã chọn vị trí cửa hàng."
        enabled={!!store.features?.goong}
        value={address}
        onChange={setAddress}
        location={
          lat !== "" && lng !== ""
            ? { lat: Number(lat), lng: Number(lng) }
            : null
        }
        onLocation={(point) => {
          setLat(point ? String(point.lat) : "");
          setLng(point ? String(point.lng) : "");
        }}
      />
      <input name="lat" type="hidden" value={lat} />
      <input name="lng" type="hidden" value={lng} />
    </>
  );
}
function StoreSettings() {
  const { data, error, refresh } = useLoad("workspace/settings"),
    { toast } = useShop();
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading error={error} />;
  return (
    <div className="panel">
      <div className="flex-between">
        <h2>{data.name}</h2>
        <span className="tag">{displayLabel("store", data.status)}</span>
      </div>
      <form
        key={data.version}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f: any = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await api("workspace/settings", "PATCH", {
              name: f.name,
              description: f.description,
              address: f.address,
              phone: f.phone,
              lat: f.lat ? Number(f.lat) : null,
              lng: f.lng ? Number(f.lng) : null,
              radius_km: Number(f.radius_km),
              version: data.version,
              settings: {
                ...data.settings,
                free_shipping: Number(f.free_shipping),
                lead_minutes: Number(f.lead_minutes),
                advance_days: Number(f.advance_days),
                capacity: Number(f.capacity),
                open: f.open === "on",
                closed_dates: String(f.closed_dates)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                slots: String(f.slots)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
              bank: String(f.bank_code || "").trim() ? {
                bank_code: String(f.bank_code || "").trim(),
                bank_name: String(f.bank_name || "").trim(),
                account_number: String(f.account_number || "").trim(),
                account_holder: String(f.account_holder || "").trim(),
                enabled: f.bank_enabled === "on",
                sepay_enabled: f.sepay_enabled === "on",
                auto_confirm_status: String(f.auto_confirm_status || "confirmed"),
              } : null,
            });
            await refresh();
            toast("Đã lưu cấu hình cửa hàng.");
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {[
            ["name", "Tên cửa hàng", data.name, "text"],
            ["phone", "Điện thoại", data.phone, "text"],
            ["radius_km", "Bán kính giao (km)", data.radius_km, "number"],
            [
              "free_shipping",
              "Miễn phí giao từ (VNĐ)",
              data.settings.free_shipping,
              "number",
            ],
            [
              "lead_minutes",
              "Chuẩn bị tối thiểu (phút)",
              data.settings.lead_minutes,
              "number",
            ],
            [
              "advance_days",
              "Đặt trước tối đa (ngày)",
              data.settings.advance_days,
              "number",
            ],
            [
              "capacity",
              "Số đơn tối đa / khung giờ",
              data.settings.capacity,
              "number",
            ],
          ].map(([name, label, value, type], index) => (
            <Fragment key={String(name)}>
              <label className="field">
                {label}
                <input
                  name={String(name)}
                  type={String(type)}
                  step={
                    ["lat", "lng"].includes(String(name)) ? "any" : undefined
                  }
                  defaultValue={value ?? ""}
                />
              </label>
              {index === 1 && <StoreAddressFields store={data} />}
            </Fragment>
          ))}
        </div>
        <label className="field">
          Giới thiệu
          <textarea name="description" defaultValue={data.description || ""} />
        </label>
        <label className="field">
          Khung giờ, cách nhau bằng dấu phẩy
          <input name="slots" defaultValue={data.settings.slots.join(", ")} />
        </label>
        <label className="field">
          Ngày nghỉ (YYYY-MM-DD), cách nhau bằng dấu phẩy
          <input
            name="closed_dates"
            defaultValue={data.settings.closed_dates.join(", ")}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            name="open"
            defaultChecked={data.settings.open}
          />
          Nhận đơn mới
        </label>
        <div className="panel"><h3>Nhận chuyển khoản & mã QR</h3><p className="small">Thông tin này được dùng để tạo VietQR cho checkout và đơn thủ công.</p><div className="form-grid">{[["bank_code","Mã ngân hàng / BIN",data.bank?.bank_code||""],["bank_name","Tên ngân hàng",data.bank?.bank_name||""],["account_number","Số tài khoản",data.bank?.account_number||""],["account_holder","Chủ tài khoản",data.bank?.account_holder||""]].map(([name,label,value])=><label className="field" key={name}>{label}<input name={name} defaultValue={value}/></label>)}</div><label className="check-field"><input type="checkbox" name="bank_enabled" defaultChecked={!!data.bank?.enabled}/> Cho phép khách chuyển khoản</label><label className="check-field"><input type="checkbox" name="sepay_enabled" defaultChecked={!!data.bank?.sepay_enabled}/> Tự động đối soát qua SePay</label><label className="field">Trạng thái đơn sau khi nhận tiền<Select name="auto_confirm_status" defaultValue={data.bank?.auto_confirm_status||"confirmed"}><option value="confirmed">Đã xác nhận</option><option value="preparing">Đang chuẩn bị</option><option value="ready">Sẵn sàng giao</option></Select></label></div>
        <button className="button store-settings-save" disabled={busy}>
          Lưu cấu hình
        </button>
      </form>
      {["draft", "rejected"].includes(data.status) && (
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await api("workspace/submit", "POST", {});
              await refresh();
              toast("Đã gửi cửa hàng chờ duyệt.");
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          Gửi cửa hàng để duyệt
        </button>
      )}
      <p className="small">
        Các đơn đã nhận vẫn được xử lý khi store ngừng nhận đơn mới.
      </p>
    </div>
  );
}
const templates = [
  ["minimal", "Minimal", "Tinh giản · khoảng trắng rộng"],
  ["editorial", "Editorial", "Chữ lớn · bố cục tạp chí"],
  ["garden", "Garden", "Mềm mại · thẻ bo tròn"],
  ["atelier", "Atelier", "Cổ điển · nội dung cân giữa"],
  ["modern", "Modern", "Đậm nét · lưới hình học"],
];
function ThemeEditor() {
  const { data, error, refresh } = useLoad("workspace/theme"),
    { data: store, refresh: reloadStore } = useLoad("workspace/settings"),
    { toast } = useShop();
  const [draft, setDraft] = useState<any>(null);
  useEffect(() => {
    if (data) setDraft(data.draft);
  }, [data]);
  if (!draft) return <Loading error={error} />;
  async function save(publish: boolean) {
    try {
      await api("workspace/theme" + (publish ? "/publish" : ""), "POST", {
        theme: draft,
        version: store.version,
      });
      await refresh();
      await reloadStore();
      toast(publish ? "Đã xuất bản giao diện." : "Đã lưu bản nháp.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div>
      <div className="template-grid">
        {templates.map(([id, name, desc]) => (
          <button
            key={id}
            className={
              "template-choice theme-" +
              id +
              (draft.template === id ? " active" : "")
            }
            onClick={() => setDraft({ ...draft, template: id })}
          >
            <div className="template-mini">
              <span>fleurious®</span>
              <i />
              <b>
                A little flower.
                <br />A lot of love.
              </b>
              <div>
                <i />
                <i />
                <i />
              </div>
            </div>
            <strong>{name}</strong>
            <small>{desc}</small>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <h3>Tùy chỉnh thương hiệu</h3>
          <label className="field">
            Màu chủ đạo
            <input
              type="color"
              value={draft.accent}
              onChange={(e) => setDraft({ ...draft, accent: e.target.value })}
            />
          </label>
          <label className="field">
            Màu nền
            <input
              type="color"
              value={draft.background}
              onChange={(e) =>
                setDraft({ ...draft, background: e.target.value })
              }
            />
          </label>
          <label className="field">
            Font
            <Select
              value={draft.font}
              onChange={(e) => setDraft({ ...draft, font: e.target.value })}
            >
              <option value="system">SF Pro / hệ thống</option>
              <option value="serif">Serif</option>
              <option value="sans">Sans serif</option>
              <option value="mono">Monospace</option>
            </Select>
          </label>
          <label className="field">
            Tiêu đề
            <input
              value={draft.hero}
              onChange={(e) => setDraft({ ...draft, hero: e.target.value })}
              maxLength={160}
            />
          </label>
          <label className="field">
            Câu chuyện
            <textarea
              value={draft.story}
              onChange={(e) => setDraft({ ...draft, story: e.target.value })}
            />
          </label>
          <div className="button-row">
            <button className="button secondary">Lưu nháp</button>
            <button
              type="button"
              className="button"
              disabled={!store}
              onClick={() => void save(true)}
            >
              Xuất bản
            </button>
          </div>
        </form>
        <div
          className={"theme-preview panel theme-" + draft.template}
          style={{
            background: draft.background,
            color: draft.accent,
            fontFamily: (
              {
                serif: "Georgia,serif",
                mono: "monospace",
                sans: "Arial,sans-serif",
                system: "inherit",
              } as any
            )[draft.font],
          }}
        >
          <span className="eyebrow">{store?.name || "CỬA HÀNG CỦA BẠN"}</span>
          <h1>{draft.hero}</h1>
          <p>{draft.story}</p>
          <span
            className="button"
            style={{ background: draft.accent, color: draft.background }}
          >
            Khám phá hoa
          </span>
          <p className="small">Xem trước bản nháp</p>
        </div>
      </div>
      <div className="panel">
        <h3>Phiên bản trước</h3>
        {data.versions.map((v: any) => (
          <button
            className="text-button"
            key={v.id}
            onClick={() =>
              setDraft(
                typeof v.theme === "string" ? JSON.parse(v.theme) : v.theme,
              )
            }
          >
            Khôi phục bản {formatDateTime(v.created_at)} vào bản nháp
          </button>
        ))}
      </div>
    </div>
  );
}
const billingLimitMeta: Record<string, { label: string; unit: string; description: string }> = {
  ai_messages: { label: "Trợ lý AI", unit: "lượt/tháng", description: "Dùng chung cho đội ngũ cửa hàng; làm mới đầu tháng (giờ Hà Nội)" },
  products: { label: "Sản phẩm đang bán", unit: "sản phẩm", description: "Sản phẩm active trong cửa hàng" },
  staff: { label: "Nhân sự hoạt động", unit: "người", description: "Bao gồm chủ store và nhân sự active" },
  storage_mb: { label: "Dung lượng lưu trữ", unit: "MB", description: "Ảnh và file đã upload" },
  email_sends: { label: "Email cửa hàng", unit: "email/tháng", description: "Email đơn hàng, chương trình và chăm sóc; làm mới đầu tháng (giờ Việt Nam)" },
};
function billingLimits(value: any, planId?: number) {
  const limits = typeof value === "string" ? JSON.parse(value) : value || {};
  return { ...limits, ai_messages: aiAllowance(Number(planId), limits) };
}
function billingTime(value: string) {
  return formatDateTime(value, "utc");
}
function billingRemainingLabel(subscription: any) {
  if (isExperiencePlan(subscription.plan_id) && subscription.status === "free") return "Miễn phí không giới hạn ngày";
  if (!subscription.expires_at) return subscription.status === "awaiting_payment" ? "Kỳ tháng bắt đầu khi nhận đủ tiền" : "Chưa bắt đầu kỳ sử dụng";
  const seconds = Number(subscription.seconds_remaining || 0);
  return seconds <= 0 ? "Đã hết hạn" : seconds < 86400 ? `Còn ${Math.ceil(seconds / 3600)} giờ` : `Còn ${subscription.days_remaining} ngày sử dụng`;
}
function BillingCards() {
  const { data, error, refresh } = useLoad("workspace/billing", true),
    { toast } = useShop();
  const [payment, setPayment] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [cancelInvoice, setCancelInvoice] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const requestPending = useRef(false);
  const waitingChange = data?.pending_plan?.purpose === "plan_change" && Number(data?.pending_plan?.paid) === 0;
  const waitingPayment = Boolean(data?.pending_plan && (waitingChange || Number(data.pending_plan.payment_started)));
  useEffect(() => {
    if (!payment && !waitingPayment) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [payment, waitingPayment, refresh]);
  useEffect(() => {
    if (payment && data?.invoices?.find((i: any) => Number(i.id) === Number(payment.invoiceId))?.status === "paid") {
      const invoice = data.invoices.find((i: any) => Number(i.id) === Number(payment.invoiceId));
      setPayment(null); toast(invoice.activated_at ? "Đã nhận đủ thanh toán. Gói dịch vụ đã có hiệu lực." : "Đã nhận đủ thanh toán. Gói dịch vụ đã được xếp lịch áp dụng.");
    }
  }, [data, payment, toast]);
  if (!data) return <Loading error={error} />;
  const expiredSelection = data.invoices?.[0]?.void_reason === "payment_timeout" ? data.invoices[0] : null;
  const currentLimits = billingLimits(data.subscription.limits, Number(data.subscription.plan_id));
  const usage = data.usage || {};
  const usageRows = Object.keys(billingLimitMeta).map((key) => {
    const limit = Number(currentLimits[key] || 0);
    const used = Number(usage[key] || 0);
    return { key, limit, used, percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0 };
  });
  async function start(planId: number, trial: boolean, invoiceId?: number, quote?: any) {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    try {
      const result = await api("workspace/billing/start", "POST", { plan_id: planId, trial, invoice_id: invoiceId, quote_token: quote?.token, quote_expires_at: quote?.expires_at });
      setPreview(null);
      if (result.payment) setPayment({ ...result.payment, invoiceId: result.invoiceId, planId, clockOffset: result.server_now ? Date.parse(result.server_now) - Date.now() : 0 });
      toast(result.trial ? result.activated ? "Đã chuyển gói và bắt đầu dùng thử." : "Đã đặt lịch dùng thử sau các kỳ đã trả tiền." : result.payment ? "Đã tạo mã QR. Gói được xác nhận khi nhận đủ tiền." : "Đã xác nhận gói theo lịch áp dụng.");
      await refresh();
    } catch (e) { setPreview(null); toast((e as Error).message); await refresh(); }
    finally { requestPending.current = false; setBusy(false); }
  }
  async function selectPlan(planId: number, trial = false) {
    if (requestPending.current) return;
    if (!trial && Number(data.pending_plan?.plan_id) === planId) {
      await start(planId, false, Number(data.pending_plan.id));
      return;
    }
    requestPending.current = true;
    setBusy(true);
    try { setPreview(await api("workspace/billing/preview", "POST", { plan_id: planId, trial })); }
    catch (e) { toast((e as Error).message); }
    finally { requestPending.current = false; setBusy(false); }
  }
  async function cancelPayment() {
    if (requestPending.current || !cancelInvoice) return;
    requestPending.current = true;
    setBusy(true);
    try {
      await api("workspace/billing/cancel-payment", "POST", { invoice_id: Number(cancelInvoice.id) });
      setCancelInvoice(null);
      setPayment(null);
      toast("Đã hủy yêu cầu thanh toán. Quyền sử dụng đã cấp được giữ nguyên.");
    } catch (e) { toast((e as Error).message); }
    finally { await refresh(); requestPending.current = false; setBusy(false); }
  }
  return <div className="billing-page">
    {data.store?.status === "suspended" && (
      <section className="panel store-suspension-notice" role="alert">
        <div className="store-suspension-copy">
          <h3>Cửa hàng đang tạm đóng băng</h3>
          <p>{data.store.suspension_reason}</p>
          <p className="small">{data.store.billing_suspended ? "Thanh toán đủ công nợ để hệ thống tự khôi phục cửa hàng." : "Cửa hàng bị đóng băng bởi admin platform. Vui lòng liên hệ để được mở lại."}</p>
        </div>
        {Boolean(data.store.billing_suspended) && (
          <button className="button store-suspension-action" disabled={busy}
            onClick={() => void selectPlan(Number(data.pending_plan?.plan_id || expiredSelection?.plan_id || (isExperiencePlan(data.subscription.plan_id) ? 1 : data.subscription.plan_id)))}>
            {busy ? "Đang xử lý…" : !data.pending_plan && expiredSelection ? "Tiếp tục tạo phiên mới" : "Tiếp tục thanh toán"}
          </button>
        )}
      </section>
    )}
    <section className="billing-current panel">
      <div className="billing-current-heading"><div><span className="eyebrow">GÓI ĐANG SỬ DỤNG</span><h2>{data.subscription.name}</h2><p>{isExperiencePlan(data.subscription.plan_id) ? "0 VNĐ · Gói miễn phí" : `${money(Number(data.subscription.monthly_price))} / tháng · ${displayLabel("subscription", data.subscription.status)}`}</p></div><span className="tag">{data.store?.status === "suspended" ? "Đóng băng" : data.subscription.cancel_at_period_end ? "Sắp dừng gia hạn" : displayLabel("subscription", data.subscription.status)}</span></div>
      <p className="small billing-period">{data.subscription.expires_at ? <>{data.subscription.trial_ends_at ? "Hết dùng thử" : "Kết thúc kỳ"}: {billingTime(data.subscription.expires_at)} · <strong>{billingRemainingLabel(data.subscription)}</strong></> : billingRemainingLabel(data.subscription)}</p>
      {data.subscription.status === "trialing" && <p className="small">Đã cấp {data.subscription.trial_days_granted} ngày dùng thử. Giá tháng đầu sau thử: {money(Number(data.subscription.monthly_price))}. Gia hạn cùng gói giữ ngày thử còn lại; nâng gói trả phí kết thúc dùng thử khi nhận đủ tiền.</p>}
      {(data.reservations || []).map((i: any) => <p className="notice" key={i.id}>{Number(i.amount) === 0 ? "Đã chọn kỳ miễn phí" : "Đã thanh toán kỳ tiếp theo"} · {i.plan_name} · {billingTime(i.effective_start_at)} → {isExperiencePlan(i.plan_id) ? "Không giới hạn ngày" : billingTime(i.effective_end_at)}</p>)}
      {(data.store_trials || []).filter((t: any) => !t.activated_at).map((t: any) => <p className="notice" key={t.bucket}>Đã đặt lịch dùng thử {t.plan_name} · {billingTime(t.starts_at)} → {billingTime(t.ends_at)}. Gói hiện tại được giữ để bảo toàn thời gian đã trả tiền hoặc yêu cầu thanh toán đang chờ.</p>)}
      {data.pending_plan && <div className="notice">Chờ thanh toán · {data.pending_plan.plan_name} · Dự kiến từ {billingTime(data.pending_plan.starts_at || data.pending_plan.period_start)}. {planRank(data.pending_plan.plan_id) > planRank(data.subscription.plan_id) ? "Gói cao hơn có hiệu lực ngay khi nhận đủ tiền. Thời gian đã trả phí còn lại được bảo toàn." : "Gói hiện tại được giữ đến hết kỳ đã cấp."}{waitingChange && <><p><BillingDeadline until={data.pending_plan.payment_deadline_at} serverNow={data.server_now} onExpired={refresh} /></p><p className="small">Chưa nhận tiền sau 10 phút: tự hủy yêu cầu đổi gói, giữ lựa chọn trước đó. Mở lại QR không kéo dài thời hạn.</p></>}{Number(data.pending_plan.paid) > 0 && <p className="small">Đã nhận {money(data.pending_plan.paid)}. Hóa đơn được giữ để thanh toán phần còn lại, không tự hủy.</p>}</div>}
      <div className="billing-usage-grid">{usageRows.map((row) => { const meta = billingLimitMeta[row.key]; return <div className="billing-usage-card" key={row.key}><div className="flex-between"><strong>{meta.label}</strong><span>{row.used.toLocaleString("vi-VN")} / {row.limit.toLocaleString("vi-VN")} {meta.unit}</span></div><div className="usage-track"><span style={{ width: row.percent + "%" }} /></div><small>{meta.description} · đã dùng {row.percent}%</small></div>; })}</div>
      {!isExperiencePlan(data.subscription.plan_id) && <div className="button-row"><button className="button secondary" onClick={async () => { try { await api("workspace/billing/cancel", "POST", { cancel: !data.subscription.cancel_at_period_end }); await refresh(); } catch (e) { toast((e as Error).message); } }}>{data.subscription.cancel_at_period_end ? "Tiếp tục gia hạn" : "Ngừng gia hạn cuối kỳ"}</button></div>}
    </section>
    <section className="billing-plans-section"><div className="section-heading"><div><span className="eyebrow">LỰA CHỌN CỦA BẠN</span><h2>Các gói dịch vụ</h2><p className="small">Khi hết quyền sử dụng gói trả phí mà chưa thanh toán hoặc đã ngừng gia hạn, cửa hàng tự chuyển về gói Trải nghiệm miễn phí với hạn mức riêng. Mỗi tài khoản có 1 lượt dùng thử chung cho Khởi đầu, Studio hoặc Atelier.</p></div></div><div className="billing-plan-grid">{data.plans.filter((plan: any) => !isExperiencePlan(plan.id)).map((plan: any) => { const limits = billingLimits(plan.limits, Number(plan.id)); const isCurrent = Number(plan.id) === Number(data.subscription.plan_id); const reserved = (data.reservations || []).find((i: any) => Number(i.plan_id) === Number(plan.id)); const pending = Number(data.pending_plan?.plan_id) === Number(plan.id); const paymentLocked = Boolean(Number(data.pending_plan?.payment_started)); const lastInvoice = data.invoices.find((i: any) => Number(i.plan_id) === Number(plan.id)); const timedOut = lastInvoice?.void_reason === "payment_timeout"; const trialClaim = data.account_trials?.claims?.[0]; const canTrial = data.account_trials?.available > 0 && !trialClaim && Number(plan.trial_days) > 0 && !(data.store.status === "suspended" && !data.store.billing_suspended); return <article className={"billing-plan-card" + (isCurrent ? " is-current" : "")} key={plan.id}><div className="billing-plan-header"><div><span className="eyebrow">GÓI {plan.id}</span><h3>{plan.name}</h3></div>{isCurrent && <span className="tag">Đang dùng</span>}</div><div className="billing-plan-price">{money(Number(plan.monthly_price))}<small>/ tháng</small></div><p className="small">{canTrial ? `Còn 1 lượt dùng thử ${plan.trial_days} ngày dùng chung` : trialClaim ? "Tài khoản đã dùng hoặc đang giữ lượt dùng thử" : "Gói hiện không mở dùng thử"}</p><div className="billing-plan-limits">{Object.keys(billingLimitMeta).map((key) => { const meta = billingLimitMeta[key]; return <div key={key}><span>{meta.label}</span><strong>{Number(limits[key] || 0).toLocaleString("vi-VN")} {meta.unit}</strong></div>; })}</div>{reserved && <p className="small">{Number(reserved.amount) === 0 ? "Đã chọn miễn phí" : "Đã thanh toán"} · Từ {billingTime(reserved.effective_start_at)}</p>}{pending && <p className="small">Đã chọn · Chờ thanh toán</p>}<div className="button-row">{canTrial && <button className="button secondary" disabled={busy || paymentLocked} onClick={() => void selectPlan(Number(plan.id), true)}>Dùng thử {plan.trial_days} ngày</button>}<button className="button" disabled={busy || (paymentLocked && !pending)} title={paymentLocked && !pending ? "Thanh toán hoặc hủy yêu cầu hiện tại trước khi đổi gói" : undefined} onClick={() => void selectPlan(Number(plan.id))}>{reserved ? "Xem lịch áp dụng" : pending ? "Tiếp tục thanh toán" : timedOut ? "Tiếp tục tạo phiên mới" : isCurrent ? "Gia hạn / Thanh toán" : "Đổi sang gói này"}</button></div></article>; })}</div></section>
    {preview && <BillingChangeDialog quote={preview} busy={busy} close={() => setPreview(null)} confirm={() => void start(preview.plan_id, Boolean(preview.trial), undefined, preview)} />}
    {payment && !cancelInvoice && <SubscriptionPaymentDialog payment={payment} invoice={data.invoices.find((i: any) => Number(i.id) === Number(payment.invoiceId))} refresh={refresh} close={() => setPayment(null)} restart={() => { const invoice = data.invoices.find((i: any) => Number(i.id) === Number(payment.invoiceId)); setPayment(null); void selectPlan(Number(invoice?.plan_id || payment.planId)); }} cancel={() => setCancelInvoice(data.invoices.find((i: any) => Number(i.id) === Number(payment.invoiceId)))} busy={busy} />}
    {cancelInvoice && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="billing-cancel-title"><div className="modal-card billing-change-dialog">
      <h2 id="billing-cancel-title">Hủy thanh toán?</h2>
      <p>Hóa đơn INV-{cancelInvoice.id} và mã chuyển khoản sẽ bị hủy. Quyền sử dụng đã cấp được giữ nguyên.</p>
      <p className="small">Chỉ xác nhận nếu bạn chưa chuyển tiền. Nếu đã chuyển tiền, hãy chờ ghi nhận hoặc liên hệ platform để đối soát.</p>
      <div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setCancelInvoice(null)}>Quay lại</button><button className="button" disabled={busy} onClick={() => void cancelPayment()}>{busy ? "Đang hủy…" : "Xác nhận hủy thanh toán"}</button></div>
    </div></div>}
    <section className="panel table-scroll"><h3>Hóa đơn dịch vụ</h3><table><thead><tr><th>Mã / Kỳ sử dụng</th><th>Gói</th><th>Tổng</th><th>Đã thu</th><th>Hạn</th><th>Trạng thái</th><th className="table-actions-heading" scope="col">Thao tác</th></tr></thead><tbody>{data.invoices.map((invoice: any) => <tr key={invoice.id}><td><strong>INV-{invoice.id}</strong><small>{invoice.effective_start_at ? `${billingTime(invoice.effective_start_at)} → ${isExperiencePlan(invoice.plan_id) ? "Không giới hạn ngày" : billingTime(invoice.effective_end_at)}` : invoice.starts_at ? `Dự kiến: ${billingTime(invoice.starts_at)} → ${billingTime(invoice.ends_at)}` : invoice.period_key}</small></td><td>{invoice.plan_name}</td><td>{money(invoice.amount)}</td><td>{money(invoice.paid)}</td><td>{isExperiencePlan(invoice.plan_id) ? "—" : invoice.purpose === "plan_change" && invoice.status === "open" && Number(invoice.paid) === 0 ? <>Chờ đổi gói đến {billingTime(invoice.payment_deadline_at)}</> : invoice.due_at ? billingTime(invoice.due_at) : formatDate(invoice.due_date)}</td><td>{isExperiencePlan(invoice.plan_id) && invoice.status === "paid" ? "Miễn phí" : displayLabel("invoice", invoice.void_reason === "payment_timeout" ? "payment_timeout" : invoice.status)}</td><td><TableActions>{invoice.status === "open" && <TableAction icon={QrCode} disabled={busy} onClick={() => void start(Number(data.subscription.plan_id), false, Number(invoice.id))}>Thanh toán</TableAction>}{invoice.status === "open" && Number(invoice.paid) === 0 && <TableAction icon={X} disabled={busy} onClick={() => setCancelInvoice(invoice)}>Hủy thanh toán</TableAction>}{invoice.status === "void" && invoice.void_reason === "payment_timeout" && !data.pending_plan && data.invoices.find((i: any) => Number(i.plan_id) === Number(invoice.plan_id))?.id === invoice.id && <TableAction icon={QrCode} disabled={busy} onClick={() => void selectPlan(Number(invoice.plan_id))}>Tiếp tục tạo phiên mới</TableAction>}</TableActions></td></tr>)}</tbody></table></section>
  </div>;
}
function useBillingDeadline(until: string, serverNow?: string, onExpired?: () => unknown, clockOffset?: number) {
  const deadline = parseDateTime(until, "utc").getTime();
  const [now, setNow] = useState(Date.now());
  const offset = useRef(clockOffset ?? 0), expired = useRef("");
  const callback = useRef(onExpired); callback.current = onExpired;
  useEffect(() => { offset.current = clockOffset ?? (serverNow ? Date.parse(serverNow) - Date.now() : 0); setNow(Date.now()); }, [serverNow, clockOffset]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((deadline - now - offset.current) / 1000));
  useEffect(() => { if (seconds === 0 && expired.current !== until) { expired.current = until; void callback.current?.(); } }, [seconds, until]);
  return seconds;
}
function BillingDeadline({ until, serverNow, onExpired }: { until: string; serverNow?: string; onExpired: () => unknown }) {
  const seconds = useBillingDeadline(until,serverNow,onExpired);
  return <strong className="billing-countdown" role="timer">{seconds > 0 ? `Còn ${Math.floor(seconds / 60).toString().padStart(2,"0")}:${(seconds % 60).toString().padStart(2,"0")} để thanh toán` : "Đã hết thời gian chờ thanh toán"}</strong>;
}
function SubscriptionPaymentDialog({ payment, invoice, refresh, close, cancel, restart, busy }: { payment: any; invoice: any; refresh: () => unknown; close: () => void; cancel: () => void; restart: () => void; busy: boolean }) {
  const seconds = useBillingDeadline(payment.expiresAt, undefined, refresh, payment.clockOffset);
  const closed = invoice?.status === "void";
  const expired = closed || seconds === 0;
  const timedOut = closed && invoice?.void_reason === "payment_timeout";
  const partial = Number(invoice?.paid) > 0;
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="subscription-payment-title"><div className="modal-card billing-change-dialog">
    <button className="modal-close" onClick={close} aria-label="Đóng thanh toán">×</button>
    <h2 id="subscription-payment-title">Thanh toán gói dịch vụ</h2>
    <p>INV-{payment.invoiceId} · {money(payment.amount)}</p>
    {!expired ? <>
      <strong className="billing-countdown" role="timer">{Math.floor(seconds / 60).toString().padStart(2, "0")}:{(seconds % 60).toString().padStart(2, "0")}</strong>
      <img src={payment.qrUrl} alt="Mã QR thanh toán" style={{ width: 280, maxWidth: "100%" }} />
      <p>Nội dung: <strong>{payment.code}</strong></p>
      <a className="button secondary" href={payment.qrUrl} download="fleurious-subscription-qr.png">Tải mã QR</a>
      <p className="small">{partial ? "Hóa đơn đã nhận một phần tiền, không tự hủy khi phiên hết hạn." : "Phiên tự hủy khi hết hạn nếu chưa nhận tiền. Đóng hoặc mở lại giữ nguyên hóa đơn, nội dung và thời hạn thanh toán."}</p>
    </> : <div className="notice" role="status">
      <strong>{timedOut ? "Phiên thanh toán đã hết hạn" : closed ? "Yêu cầu thanh toán đã đóng" : "QR của phiên này đã hết hạn"}</strong>
      <p>{timedOut ? "Yêu cầu thanh toán cũ đã tự hủy và mã chuyển khoản cũ không còn hiệu lực. Chọn Tiếp tục tạo phiên mới để xác nhận lại và nhận mã thanh toán mới." : partial ? "Hóa đơn đã nhận một phần tiền nên được giữ để đối soát. Vui lòng liên hệ platform để xử lý số tiền còn lại." : closed ? "Yêu cầu thanh toán đã đóng. Quyền sử dụng đã cấp được giữ nguyên." : "Đang cập nhật trạng thái tự hủy của phiên thanh toán…"}</p>
      <p className="small">Nếu đã chuyển tiền nhưng chưa được ghi nhận, vui lòng liên hệ platform để đối soát trước khi thanh toán tiếp.</p>
    </div>}
    <div className="button-row">
      <button className="button secondary" onClick={close}>Đóng</button>
      {timedOut && <button className="button" disabled={busy} onClick={restart}>Tiếp tục tạo phiên mới</button>}
      {!expired && invoice?.status === "open" && !partial && <button className="button" disabled={busy} onClick={cancel}>Hủy thanh toán</button>}
    </div>
  </div></div>;
}
function BillingChangeDialog({ quote, busy, close, confirm }: { quote: any; busy: boolean; close: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) closeRef.current();
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      const first = buttons[0], last = buttons.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  const exceeded = Object.keys(billingLimitMeta).filter(key => Number(quote.usage[key] || 0) > Number(quote.limits[key] || 0));
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="billing-change-title"><div ref={dialog} className="modal-card billing-change-dialog" aria-busy={busy}>
    <button className="modal-close" disabled={busy} onClick={close} aria-label="Đóng xem trước">×</button>
    <span className="eyebrow">XEM TRƯỚC GÓI DỊCH VỤ</span><h2 id="billing-change-title">{quote.plan_name}</h2>
    <dl className="billing-change-summary"><div><dt>Gói đang dùng</dt><dd>{quote.current_plan}</dd></div><div><dt>Gói đã chọn</dt><dd>{quote.trial ? `${quote.plan_name} · Dùng thử` : quote.plan_name}</dd></div><div><dt>Bắt đầu áp dụng</dt><dd>{quote.trial && quote.starts_immediately ? "Ngay khi xác nhận dùng thử" : quote.change_type === "upgrade" ? "Ngay khi nhận đủ thanh toán" : billingTime(quote.starts_at)}</dd></div><div><dt>{quote.change_type === "upgrade" || (quote.trial && quote.starts_immediately) ? "Dự kiến kết thúc kỳ mới" : "Kết thúc kỳ mới"}</dt><dd>{isExperiencePlan(quote.plan_id) ? "Không giới hạn ngày" : billingTime(quote.ends_at)}</dd></div><div><dt>Giá kỳ mới</dt><dd>{money(quote.amount)}</dd></div>{quote.paid > 0 && <div><dt>Đã thanh toán</dt><dd>{money(quote.paid)}</dd></div>}<div><dt>Cần thanh toán</dt><dd>{money(quote.amount_due)}</dd></div></dl>
    {quote.retained.length > 0 && <p className="notice">Giữ nguyên các kỳ đã trả tiền{quote.retained.map((i: any) => ` · ${i.plan_name} (INV-${i.id})`)}. {quote.trial ? "Lượt dùng thử bắt đầu sau các kỳ này." : quote.change_type === "upgrade" ? "Thời gian đã trả phí được nâng theo gói mới ngay khi thanh toán đủ." : "Gói thấp hơn sẽ bắt đầu sau các kỳ này."}</p>}
    {quote.change_type === "upgrade" && <p className="notice">Nâng gói có hiệu lực ngay khi thanh toán đủ giá một tháng. Thời gian trả phí còn lại được nâng theo gói mới, cộng thêm một tháng đã mua. {quote.trial_ends_at && "Thời gian dùng thử kết thúc khi gói trả phí bắt đầu và lượt đã dùng không được cấp lại."}</p>}
    {quote.trial && <p className="notice">Dùng thử {quote.trial_days} ngày, miễn phí. Giá tháng sau thử: {money(quote.monthly_price)}. Lượt thử dùng chung trên mọi cửa hàng của tài khoản và không được cấp lại khi đổi gói. Không tự trích tiền; thanh toán đủ mới cấp kỳ trả phí.</p>}
    {quote.trial && quote.replaces_current_trial && <p className="notice">Xác nhận sẽ chuyển sang gói đã chọn theo lịch hiển thị. Lượt dùng thử không được cấp lại khi đổi gói.</p>}
    {quote.trial_ends_at && quote.change_type !== "upgrade" && <p className="small">Giữ nguyên ngày dùng thử đến {billingTime(quote.trial_ends_at)}. Đổi gói không cấp thêm ngày thử.</p>}
    {quote.purpose === "plan_change" && quote.paid === 0 && quote.amount_due > 0 && <p className="notice">Bạn có 10 phút thanh toán từ khi xác nhận. Nếu chưa nhận tiền, yêu cầu đổi gói tự hủy và lựa chọn trước đó được giữ lại.</p>}
    <div className="billing-plan-limits">{Object.keys(billingLimitMeta).map(key => <div key={key}><span>{billingLimitMeta[key].label}</span><strong>{Number(quote.limits[key] || 0).toLocaleString("vi-VN")} {billingLimitMeta[key].unit}</strong></div>)}</div>
    {exceeded.length > 0 && <div className="notice" role="alert"><strong>Đang vượt hạn mức gói đã chọn</strong>{exceeded.map(key => <p key={key}>{billingLimitMeta[key].label}: {Number(quote.usage[key]).toLocaleString("vi-VN")} / {Number(quote.limits[key]).toLocaleString("vi-VN")} {billingLimitMeta[key].unit}.</p>)}<p>Dữ liệu hiện có được giữ lại. Khi gói có hiệu lực, bạn cần giảm mức sử dụng hoặc nâng gói để thêm dữ liệu vượt hạn mức.</p></div>}
    <p className="small">{quote.trial ? `${quote.starts_immediately ? "Gói và hạn mức mới có hiệu lực ngay khi xác nhận; ngày kết thúc tính từ lúc xác nhận." : "Lượt thử được giữ ngay khi xác nhận và bắt đầu sau thời gian đã trả tiền."} Cấu hình ngày thử thay đổi sau đó không sửa quyền lợi đã giữ. Hóa đơn chưa thu và lựa chọn miễn phí chưa bắt đầu được thay bằng lượt thử này.` : quote.already_reserved ? "Kỳ này đã thanh toán. Bạn có thể xem lịch áp dụng hoặc chọn gói khác cho kỳ chưa thanh toán tiếp theo." : quote.amount_due > 0 ? "Xác nhận để tạo mã QR. Gói mới chỉ được cấp khi nhận đủ tiền; chưa thanh toán không làm mất quyền sử dụng hiện tại. Nếu trả sau ngày dự kiến, kỳ mới bắt đầu khi nhận đủ tiền." : "Kỳ miễn phí được xác nhận theo lịch trên. Bạn vẫn có thể thay đổi trước ngày bắt đầu."}</p>
    <div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Quay lại</button><button className="button" disabled={busy} onClick={confirm}>{busy ? "Đang xử lý…" : quote.trial ? "Xác nhận dùng thử" : quote.already_reserved ? "Xác nhận giữ gói" : quote.amount_due > 0 ? "Xác nhận & thanh toán" : "Xác nhận chọn gói"}</button></div>
  </div></div>;
}
function Team() {
  const { data, error, refresh } = useLoad("workspace/team");
  if (!data) return <Loading error={error} />;
  return <StoreTeam data={data} error={error} refresh={refresh} />;
}

function Automations() {
  const { data, error, refresh } = useLoad("workspace/automations"),
    { toast } = useShop();
  const broadcastKey = useRef(""),
    [sending, setSending] = useState(false);
  if (!data) return <Loading error={error} />;
  return (
    <div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          if (!broadcastKey.current) broadcastKey.current = crypto.randomUUID();
          setSending(true);
          try {
            const r = await api("workspace/broadcasts", "POST", {
              ...Object.fromEntries(new FormData(form)),
              key: broadcastKey.current,
            });
            form.reset();
            broadcastKey.current = "";
            toast(`Đã lên hàng đợi cho ${r.queued} khách phù hợp.`);
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setSending(false);
          }
        }}
      >
        <h3>Thông báo chương trình của store</h3>
        <p>
          Gửi vào hộp thư và Web Push cho khách đã mua thành công, đã đồng ý
          nhận chương trình. Web Push cần khách bật nhận thông báo. Mỗi khách
          tối đa một thông báo chương trình trong 7 ngày, tối đa 1.000 khách mỗi
          lần.
        </p>
        <label className="field">
          Tiêu đề
          <input name="title" minLength={3} maxLength={100} required />
        </label>
        <label className="field">
          Nội dung
          <textarea name="message" minLength={5} maxLength={500} required />
        </label>
        <button className="button" disabled={sending}>
          {sending ? "Đang lên lịch…" : "Gửi chương trình"}
        </button>
      </form>
      <div className="panel">
        <h3>Chăm sóc tự động</h3>
        <p>
          Mỗi khách tối đa một email marketing trong 7 ngày. Chỉ gửi khi có
          consent tại store này; gửi trùng và email bị hủy đăng ký được loại ở
          cả lúc lên lịch và lúc gửi.
        </p>
        {data.rules.map((r: any) => (
          <div className="team-row" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <small>
                {displayLabel("automation", r.trigger_name)} · {r.delay_days}{" "}
                ngày · {r.active ? "Đang bật" : "Tạm dừng"}
              </small>
            </div>
            <TableActions><TableAction icon={r.active ? Pause : Play}
              onClick={async () => {
                try {
                  await api("workspace/automations", "PATCH", {
                    ...r,
                    active: !r.active,
                  });
                  await refresh();
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              {r.active ? "Tạm dừng" : "Bật quy tắc"}
            </TableAction></TableActions>
          </div>
        ))}
      </div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = Object.fromEntries(new FormData(form));
          try {
            await api("workspace/automations", "POST", {
              ...f,
              template_id: Number(f.template_id),
              delay_days: Number(f.delay_days),
              active: false,
            });
            form.reset();
            await refresh();
            toast("Đã lưu rule ở trạng thái tạm dừng. Kiểm tra trước khi bật.");
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      >
        <h3>Thêm quy tắc</h3>
        <label className="field">
          Tên
          <input name="name" required />
        </label>
        <label className="field">
          Khi nào
          <Select name="trigger_name">
            <option value="aftercare">Sau khi giao hoa</option>
            <option value="birthday">Đúng ngày sinh nhật</option>
            <option value="winback">Lâu chưa quay lại</option>
          </Select>
        </label>
        <label className="field">
          Sau / cách lần mua cuối (ngày)
          <input
            name="delay_days"
            type="number"
            min="1"
            max="365"
            defaultValue="2"
            required
          />
        </label>
        <label className="field">
          Template
          <Select name="template_id">
            {data.templates.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          Nội dung chương trình
          <textarea name="message" minLength={2} maxLength={6000} required />
        </label>
        <button className="button">Lưu quy tắc</button>
      </form>
    </div>
  );
}
