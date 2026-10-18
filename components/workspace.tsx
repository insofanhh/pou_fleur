"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { api, useShop } from "./context";
import { Status, statusNames } from "./pages";
import { money } from "./home";
import Link from "./routing";
import { displayLabel } from "@/lib/display-labels";
import ManualOrderEditor from "./manual-order-editor";
const statuses = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "shipping",
  "delivered",
  "cancelled",
];
const nextState: Record<string, string> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "shipping",
  shipping: "delivered",
};
export const workspaceAreas = [
  "new-order",
  "board",
  "orders",
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
  if (area === "new-order") return <ManualOrderEditor />;
  if (area === "board") return <OrderBoard />;
  if (area === "orders") return <OrderBoard table />;
  if (area === "calendar") return <Calendar />;
  if (area === "automations") return <Automations />;
  if (area === "analytics") return <Analytics />;
  if (area === "settings") return <StoreSettings />;
  if (area === "theme") return <ThemeEditor />;
  if (area === "billing") return <Billing />;
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
      {order.creation_source === "manual" && (
        <span className="tag">Thủ công</span>
      )}
      <strong>{order.customer_name}</strong>
      <p>
        {order.delivery_date} · {order.delivery_slot}
      </p>
      <small>
        {order.recipient_name} · {order.recipient_phone}
      </small>
      <div className="flex-between">
        <strong>{money(order.total)}</strong>
        <Status value={order.payment_status} />
      </div>
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
    [statusFilter, setStatusFilter] = useState(""),
    [pages, setPages] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false);
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
  async function move(o: any, status: string) {
    if (status === o.status) return;
    setBusy(true);
    try {
      await api("workspace/orders/" + o.id + "/status", "PATCH", {
        status,
        version: o.version,
      });
      setSelected(null);
      await refresh();
      toast("Đã cập nhật đơn hàng.");
    } catch (e) {
      toast((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-no-fade-in>
      <div className="board-toolbar">
        <Link href="/admin/orders/new?drafts=1" className="text-link">
          Đơn nháp
        </Link>
        <input
          aria-label="Tìm đơn hàng"
          placeholder="Mã đơn, tên khách, số điện thoại…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          aria-label="Ngày giao"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPages({});
          }}
        />
        <select
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
        </select>
        <select
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
        </select>
        {table && (
          <select
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
          </select>
        )}
        <button className="button secondary" onClick={() => void refresh()}>
          Làm mới
        </button>
      </div>
      <p className="small">
        {table
          ? "Mở mã đơn để xem chi tiết và cập nhật."
          : "Kéo thẻ sang bước kế tiếp hoặc mở đơn để cập nhật. Trên điện thoại, dùng nút chuyển trạng thái trong đơn."}{" "}
        Tự làm mới mỗi 30 giây khi cửa sổ đang mở.
      </p>
      {error && data && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      {!data ? (
        <Loading error={error} />
      ) : table ? (
        <div className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Khách hàng</th>
                  <th>Ngày giao</th>
                  <th>Trạng thái</th>
                  <th>Thanh toán</th>
                  <th>Tổng</th>
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
                      <Status value={o.payment_status} />
                    </td>
                    <td>{money(o.total)}</td>
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
          order={selected}
          close={() => setSelected(null)}
          move={move}
          refresh={refresh}
        />
      )}
    </div>
  );
}
function OrderPanel({
  order: o,
  close,
  move,
  refresh,
}: {
  order: any;
  close: () => void;
  move: (o: any, s: string) => void;
  refresh: () => Promise<void>;
}) {
  const { data } = useLoad("workspace/orders/" + o.id + "/timeline"),
    { user, toast } = useShop();
  const {
    data: assignment,
    error: assignmentError,
    refresh: reloadAssignment,
  } = useLoad("workspace/orders/" + o.id + "/assignment");
  const [paymentError, setPaymentError] = useState(""),
    [busy, setBusy] = useState(false);
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
        <Status value={o.status} />
        {o.creation_source === "manual" && (
          <p className="small">
            Thủ công ·{" "}
            {(
              {
                phone: "Điện thoại",
                zalo: "Zalo",
                social: "Mạng xã hội",
                in_person: "Tại cửa hàng",
                other: "Khác",
              } as Record<string, string>
            )[o.sales_channel] || o.sales_channel}{" "}
            · Người tạo: {o.creator_name || "#" + o.created_by}
          </p>
        )}
        <p>
          {o.customer_name} · {o.phone}
        </p>
        <p>
          Người nhận: {o.recipient_name} · {o.recipient_phone}
          <br />
          {o.address}
        </p>
        <p>
          {o.delivery_date} · {o.delivery_slot}
        </p>
        <blockquote>{o.message || "Không có lời nhắn"}</blockquote>
        {o.notes && <p>Ghi chú giao hàng: {o.notes}</p>}
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
            <div className="panel" key={n}>
              <p>
                {i.name} ·{" "}
                {i.line_type === "custom" ? "Thiết kế riêng" : i.size} ×{" "}
                {i.quantity} · {money(i.price)}
              </p>
              {i.line_type === "custom" && i.image && (
                <img
                  className="manual-reference"
                  src={i.image}
                  alt="Ảnh tham khảo thiết kế"
                />
              )}
              {detail.text && <p>Yêu cầu thiết kế: {detail.text}</p>}
              {detail.priceReason && (
                <p className="small">
                  Lý do điều chỉnh giá: {detail.priceReason}
                </p>
              )}
            </div>
          );
        })}
        <h3>{money(o.total)}</h3>
        <Status value={o.payment_status} />
        <p>
          Đã thu: {money(Number(o.collected || 0))} · Còn phải thu:{" "}
          {money(Math.max(0, o.total - Number(o.collected || 0)))}
        </p>
        {o.status === "cancelled" && Number(o.collected) > 0 && (
          <p className="error">
            Đơn đã hủy còn {money(Number(o.collected))} cần xử lý hoàn tiền.
          </p>
        )}
        {!o.email && (
          <p className="small">Không gửi email: khách chưa cung cấp email.</p>
        )}
        {o.internal_notes && (
          <div className="panel">
            <strong>Ghi chú nội bộ</strong>
            <p>{o.internal_notes}</p>
          </div>
        )}
        <p className="small">
          Trạng thái giao và thu tiền được cập nhật riêng.
        </p>
        <div className="button-row">
          {nextState[o.status] && (
            <button
              className="button"
              onClick={() => move(o, nextState[o.status])}
            >
              {statusNames[nextState[o.status]]}
            </button>
          )}
          {["pending", "confirmed"].includes(o.status) && (
            <button
              className="button secondary"
              onClick={() => move(o, "cancelled")}
            >
              Huỷ đơn
            </button>
          )}
        </div>
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
          <h3>Phân công & nhãn</h3>
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
              <select
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
                      {assignment.assigned_name || "Nhân sự đã ngừng hoạt động"}{" "}
                      (không còn hoạt động)
                    </option>
                  )}
                {assignment?.staff.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
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
        {user?.role === "owner" && (
          <form
            className="panel"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const f = Object.fromEntries(new FormData(e.currentTarget));
                await api("workspace/orders/" + o.id + "/payment", "POST", {
                  ...f,
                  amount: Number(f.amount),
                });
                await refresh();
                close();
                toast("Đã ghi nhận thanh toán.");
              } catch (e) {
                setPaymentError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>Ghi nhận thu / hoàn tiền</h3>
            <label className="field">
              Phương thức
              <select name="method">
                <option value="cash">Tiền mặt</option>
                <option value="bank">Chuyển khoản</option>
              </select>
            </label>
            <label className="field">
              Loại
              <select name="kind">
                <option value="collect">Thu tiền</option>
                <option value="refund">Hoàn tiền</option>
              </select>
            </label>
            <label className="field">
              Số tiền
              <input
                name="amount"
                type="number"
                min="1"
                max={o.total}
                required
              />
            </label>
            <label className="field">
              Mã giao dịch duy nhất
              <input name="reference" minLength={5} required />
            </label>
            <button className="button secondary" disabled={busy}>
              Ghi nhận
            </button>
          </form>
        )}
        {paymentError && <p className="error">{paymentError}</p>}
        {["pending", "confirmed", "preparing", "ready"].includes(o.status) && (
          <form
            className="panel"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("workspace/orders/" + o.id + "/reschedule", "PATCH", {
                  ...Object.fromEntries(new FormData(e.currentTarget)),
                  version: o.version,
                });
                await refresh();
                close();
                toast("Đã đổi lịch và tạo thông báo.");
              } catch (e) {
                setPaymentError((e as Error).message);
              }
            }}
          >
            <h3>Đổi lịch giao</h3>
            <label className="field">
              Ngày mới
              <input type="date" name="date" required />
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
        )}
        <h3>Lịch sử đơn</h3>
        {data?.events?.map((e: any) => (
          <p key={e.id} className="timeline-entry">
            {e.created_at} · {statusNames[e.status]}
          </p>
        ))}
        {data?.payments?.map((e: any) => (
          <p key={e.id}>
            {e.kind === "collect" ? "Thu" : "Hoàn"} {money(e.amount)} ·{" "}
            {e.method === "bank" ? "Chuyển khoản" : "Tiền mặt"} · {e.reference}{" "}
            · {e.received_at || e.created_at}
          </p>
        ))}
      </div>
    </dialog>
  );
}
function Calendar() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [month, setMonth] = useState(today.slice(0, 7)),
    [selected, setSelected] = useState(today),
    [view, setView] = useState("month"),
    [order, setOrder] = useState<any>(null),
    { toast } = useShop();
  const end = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5)),
      0,
    ).getDate(),
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
  async function move(o: any, status: string) {
    try {
      await api("workspace/orders/" + o.id + "/status", "PATCH", {
        status,
        version: o.version,
      });
      setOrder(null);
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div data-no-fade-in>
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
          <input
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
          <input
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
        <p>Ngày giao hoa · Asia/Ho_Chi_Minh</p>
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
                      : (new Date(from + "T12:00:00").getDay() + 6) % 7,
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
            <h3>Ngày {selected}</h3>
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
                  <button
                    className="text-button"
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
                  </button>
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
                <select name="color">
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
                </select>
              </label>
              <button className="button">Thêm ghi chú</button>
            </form>
          </aside>
        </div>
      )}
      {order && (
        <OrderPanel
          order={order}
          close={() => setOrder(null)}
          move={move}
          refresh={refresh}
        />
      )}
    </div>
  );
}
function Analytics() {
  const [from, setFrom] = useState(
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useLoad(
    "workspace/analytics?from=" + from + "&to=" + to,
  );
  return (
    <div>
      <div className="board-toolbar">
        <label>
          Từ{" "}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Đến{" "}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="stat-grid">
            {[
              [
                "Doanh thu đơn đã giao",
                money(
                  data.daily.reduce(
                    (n: number, d: any) => n + Number(d.revenue),
                    0,
                  ),
                ),
              ],
              [
                "Tiền đã thu",
                money(
                  data.daily.reduce(
                    (n: number, d: any) => n + Number(d.collected),
                    0,
                  ),
                ),
              ],
              [
                "Đơn tạo trong kỳ",
                data.daily.reduce(
                  (n: number, d: any) => n + Number(d.orders_count),
                  0,
                ),
              ],
              [
                "Đơn hủy",
                data.daily.reduce(
                  (n: number, d: any) => n + Number(d.cancellations),
                  0,
                ),
              ],
            ].map(([k, v]) => (
              <div className="stat-card" key={k}>
                <small>{k}</small>
                <h2>{v}</h2>
              </div>
            ))}
          </div>
          <div className="panel">
            <h3>Nguồn đơn hàng</h3>
            {data.sources?.map((s: any) => (
              <p key={s.creation_source + ":" + s.sales_channel}>
                {s.creation_source === "manual" ? "Thủ công" : "Website"} ·{" "}
                {(
                  {
                    phone: "Điện thoại",
                    zalo: "Zalo",
                    social: "Mạng xã hội",
                    in_person: "Tại cửa hàng",
                    other: "Khác",
                    website: "Website",
                  } as Record<string, string>
                )[s.sales_channel] || s.sales_channel}
                : {s.orders_count} đơn · {money(Number(s.revenue))}
              </p>
            ))}
          </div>
          <div className="panel">
            <h3>Doanh thu theo ngày tạo đơn</h3>
            <div className="analytics-chart">
              {data.daily.map((d: any) => (
                <div key={d.day}>
                  <span>{d.day}</span>
                  <div
                    style={{
                      width:
                        Math.max(
                          1,
                          (100 * d.revenue) /
                            Math.max(
                              1,
                              ...data.daily.map((x: any) => x.revenue),
                            ),
                        ) + "%",
                    }}
                  />
                  <strong>{money(d.revenue)}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="dashboard-grid">
            <div className="panel">
              <h3>Phân nhóm khách hàng</h3>
              {data.segments.map((s: any) => (
                <p key={s.segment}>
                  {displayLabel("segment", s.segment)}:{" "}
                  <strong>{s.count}</strong>
                </p>
              ))}
            </div>
            <div className="panel">
              <h3>Tương tác cửa hàng</h3>
              {data.funnel.map((s: any) => (
                <p key={s.name}>
                  {displayLabel("interaction", s.name)}:{" "}
                  <strong>{s.count}</strong>
                </p>
              ))}
              <p className="small">
                Số sự kiện, không phải số người dùng duy nhất.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
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
                shipping: Number(f.shipping),
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
            ["address", "Địa chỉ", data.address, "text"],
            ["lat", "Vĩ độ", data.lat, "number"],
            ["lng", "Kinh độ", data.lng, "number"],
            ["radius_km", "Bán kính giao (km)", data.radius_km, "number"],
            ["shipping", "Phí giao (₫)", data.settings.shipping, "number"],
            [
              "free_shipping",
              "Miễn phí giao từ (₫)",
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
          ].map(([name, label, value, type]) => (
            <label className="field" key={String(name)}>
              {label}
              <input
                name={String(name)}
                type={String(type)}
                step={["lat", "lng"].includes(String(name)) ? "any" : undefined}
                defaultValue={value ?? ""}
              />
            </label>
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
        <button className="button" disabled={busy}>
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
              <span>fleur®</span>
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
            <select
              value={draft.font}
              onChange={(e) => setDraft({ ...draft, font: e.target.value })}
            >
              <option value="system">SF Pro / hệ thống</option>
              <option value="serif">Serif</option>
              <option value="sans">Sans serif</option>
              <option value="mono">Monospace</option>
            </select>
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
            Khôi phục bản {v.created_at} vào bản nháp
          </button>
        ))}
      </div>
    </div>
  );
}
function Billing() {
  const { data, error, refresh } = useLoad("workspace/billing"),
    { toast } = useShop();
  if (!data) return <Loading error={error} />;
  return (
    <div>
      <div className="panel">
        <h2>Gói {data.subscription.name}</h2>
        <p>
          {money(data.subscription.monthly_price)} / tháng ·{" "}
          {displayLabel("subscription", data.subscription.status)}
        </p>
        <p>
          Kết thúc kỳ:{" "}
          {data.subscription.period_end || "Không giới hạn với gói miễn phí"}
        </p>
        <div>
          <h3>Hạn mức gói</h3>
          {Object.entries(
            typeof data.subscription.limits === "string"
              ? JSON.parse(data.subscription.limits)
              : data.subscription.limits || {},
          ).map(([key, value]) => (
            <p key={key}>
              {displayLabel("limit", key)}: <strong>{String(value)}</strong>
            </p>
          ))}
        </div>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await api("workspace/billing/cancel", "POST", {
                cancel: !data.subscription.cancel_at_period_end,
              });
              await refresh();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          {data.subscription.cancel_at_period_end
            ? "Tiếp tục gia hạn"
            : "Ngừng gia hạn cuối kỳ"}
        </button>
        <p className="small">
          Thay đổi gói và hướng dẫn thanh toán: liên hệ quản trị nền tảng. Giá
          gói được cấu hình bởi nền tảng.
        </p>
      </div>
      <div className="panel table-scroll">
        <h3>Hóa đơn dịch vụ</h3>
        <table>
          <thead>
            <tr>
              <th>Kỳ</th>
              <th>Gói</th>
              <th>Tổng</th>
              <th>Đã thu</th>
              <th>Hạn</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((i: any) => (
              <tr key={i.id}>
                <td>{i.period_key}</td>
                <td>{i.plan_name}</td>
                <td>{money(i.amount)}</td>
                <td>{money(i.paid)}</td>
                <td>{i.due_date}</td>
                <td>{displayLabel("invoice", i.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function Team() {
  const { data, error, refresh } = useLoad("workspace/team"),
    { user, toast } = useShop(),
    [invite, setInvite] = useState("");
  if (!data) return <Loading error={error} />;
  return (
    <div>
      <div className="panel">
        <h3>Nhân sự cửa hàng</h3>
        <p className="small">
          Vai trò chỉ áp dụng tại cửa hàng này. Hồ sơ đăng nhập thuộc tài khoản
          cá nhân.
        </p>
        {data.members.map((m: any) => (
          <div className="team-row" key={m.id}>
            <div>
              <strong>{m.name}</strong>
              <small>
                {m.email} · ID {m.id}
              </small>
            </div>
            <span>{displayLabel("member", m.status)}</span>
            {m.role === "owner" || user?.role !== "owner" ? (
              <span>{displayLabel("role", m.role)}</span>
            ) : (
              <>
                <select
                  aria-label={"Vai trò của " + m.name}
                  value={m.role}
                  onChange={async (e) => {
                    try {
                      await api("workspace/team/" + m.id, "PATCH", {
                        role: e.target.value,
                        status: m.status,
                      });
                      await refresh();
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  {["admin", "manager", "editor", "support"].map((r) => (
                    <option key={r} value={r}>
                      {displayLabel("role", r)}
                    </option>
                  ))}
                </select>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api("workspace/team/" + m.id, "PATCH", {
                        role: m.role,
                        status: m.status === "active" ? "revoked" : "active",
                      });
                      await refresh();
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  {m.status === "active" ? "Thu hồi" : "Kích hoạt"}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {user?.role === "owner" && (
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api(
                "workspace/team/invite",
                "POST",
                Object.fromEntries(new FormData(e.currentTarget)),
              );
              setInvite(window.location.origin + r.url);
              await refresh();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          <h3>Mời nhân sự</h3>
          <label className="field">
            Email
            <input type="email" name="email" required />
          </label>
          <label className="field">
            Vai trò
            <select name="role">
              {["admin", "manager", "editor", "support"].map((r) => (
                <option key={r} value={r}>
                  {displayLabel("role", r)}
                </option>
              ))}
            </select>
          </label>
          <button className="button">Tạo lời mời</button>
          {invite && (
            <p className="notice">
              Gửi liên kết này đến đúng người được mời:{" "}
              <a href={invite}>{invite}</a>
            </p>
          )}
        </form>
      )}
      <div className="panel">
        <h3>Lời mời</h3>
        {data.invitations.map((i: any) => (
          <p key={i.id}>
            {i.email} · {displayLabel("role", i.role)} ·{" "}
            {displayLabel(
              "invitation",
              i.status === "pending" && Date.parse(i.expires_at) < Date.now()
                ? "expired"
                : i.status,
            )}{" "}
            · hết hạn {i.expires_at}
          </p>
        ))}
      </div>
    </div>
  );
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
            <button
              className="text-button"
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
            </button>
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
          <select name="trigger_name">
            <option value="aftercare">Sau khi giao hoa</option>
            <option value="birthday">Đúng ngày sinh nhật</option>
            <option value="winback">Lâu chưa quay lại</option>
          </select>
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
          <select name="template_id">
            {data.templates.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
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
