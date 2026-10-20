"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, RotateCcw, RefreshCw, Search, X } from "lucide-react";
import { api, useShop } from "./context";
import { money } from "./home";
import { formatDateTime } from "@/lib/date-time";
import Select from "./ui-select";
import Link from "./routing";
import { TableAction, TableActions } from "./table-actions";

type RefundOrder = {
  id: number;
  reference: string;
  customer_name: string;
  phone: string;
  total: number;
  version: number;
  outstanding: number;
  refunded: number;
  needs_review: number;
  cancelled_at: string | null;
  refunded_at: string | null;
};
type RefundList = {
  items: RefundOrder[];
  total: number;
  page: number;
  limit: number;
  can_manage: boolean;
  summary: {
    pending_count: number;
    outstanding: number;
    completed_count: number;
    review_count: number;
  };
};

export default function WorkspaceRefunds() {
  const [q, setQ] = useState(""),
    [search, setSearch] = useState("");
  const [state, setState] = useState("pending"),
    [page, setPage] = useState(1);
  const [data, setData] = useState<RefundList | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<RefundOrder | null>(null);
  const sequence = useRef(0);
  const { toast } = useShop();
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const result = await api(
        "workspace/refunds?" +
          new URLSearchParams({ q: search, state, page: String(page) }),
      );
      if (request !== sequence.current) return;
      setData(result);
      setError("");
      if (page > 1 && !result.items.length)
        setPage(Math.max(1, Math.ceil(result.total / result.limit)));
    } catch (e) {
      if (request === sequence.current) setError((e as Error).message);
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [search, state, page]);
  useEffect(() => {
    void refresh();
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => {
      sequence.current++;
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [refresh]);
  const summary = data?.summary;
  return (
    <div className="refund-workspace">
      <div className="refund-summary" aria-label="Tổng hợp hoàn tiền">
        <div className="panel">
          <span>Còn cần hoàn</span>
          <strong>{money(Number(summary?.outstanding || 0))}</strong>
        </div>
        <div className="panel">
          <span>Đơn cần hoàn</span>
          <strong>{Number(summary?.pending_count || 0)}</strong>
        </div>
        <div className="panel">
          <span>Đơn đã hoàn đủ</span>
          <strong>{Number(summary?.completed_count || 0)}</strong>
        </div>
        <div className="panel">
          <span>Cần đối soát</span>
          <strong>{Number(summary?.review_count || 0)}</strong>
        </div>
      </div>
      <section className="panel refund-list" aria-label="Danh sách hoàn tiền">
        <div className="refund-heading">
          <div>
            <h2>Hoàn tiền đơn đã hủy</h2>
            <p>
              Chuyển tiền cho khách trước, sau đó ghi nhận tại đây. Thao tác này
              không tự chuyển tiền ngân hàng.
            </p>
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={15} /> Làm mới
          </button>
        </div>
        <div className="refund-toolbar">
          <label className="refund-search">
            <span className="sr-only">Tìm đơn hoàn tiền</span>
            <Search size={16} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Mã đơn, tên khách, số điện thoại"
              maxLength={100}
            />
          </label>
          <label>
            <span className="sr-only">Trạng thái hoàn tiền</span>
            <Select
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              <option value="pending">Cần hoàn</option>
              <option value="completed">Đã hoàn đủ</option>
              <option value="review">Cần đối soát</option>
              <option value="all">Tất cả</option>
            </Select>
          </label>
          <span className="muted" role="status">
            {loading ? "Đang cập nhật…" : `${data?.total || 0} đơn`}
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!data && !error ? (
          <p className="empty">Đang tải…</p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Đơn hàng / Khách hàng</th>
                    <th>Hủy lúc</th>
                    <th>Giá trị đơn</th>
                    <th>Đã hoàn</th>
                    <th>Còn cần hoàn</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.reference}</strong>
                        <div>{order.customer_name}</div>
                        <small className="muted">{order.phone}</small>
                      </td>
                      <td>
                        {order.cancelled_at
                          ? formatDateTime(order.cancelled_at)
                          : "Chưa có lịch sử"}
                      </td>
                      <td>{money(Number(order.total))}</td>
                      <td>
                        {money(Number(order.refunded))}
                        {order.refunded_at && (
                          <small className="refund-date">
                            {formatDateTime(order.refunded_at, "utc")}
                          </small>
                        )}
                      </td>
                      <td>
                        <strong>
                          {Number(order.needs_review)
                            ? "Cần đối soát"
                            : money(Number(order.outstanding))}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={
                            "tag refund-tag " +
                            (Number(order.needs_review)
                              ? "review"
                              : Number(order.outstanding) > 0
                                ? "pending"
                                : "completed")
                          }
                        >
                          {Number(order.needs_review)
                            ? "Cần đối soát"
                            : Number(order.outstanding) > 0
                              ? Number(order.refunded) > 0
                                ? "Hoàn một phần"
                                : "Cần hoàn"
                              : "Đã hoàn đủ"}
                        </span>
                      </td>
                      <td>
                        <TableActions>
                          <Link
                            className="text-button table-action"
                            href={`/admin/orders?order=${order.id}`}
                          >
                            <Eye size={15} aria-hidden="true" /> Xem đơn
                          </Link>
                          {data.can_manage && Number(order.outstanding) > 0 && (
                            <TableAction
                              icon={RotateCcw}
                              disabled={loading || !!error}
                              onClick={() => setSelected(order)}
                            >
                              Đánh dấu đã hoàn
                            </TableAction>
                          )}
                        </TableActions>
                      </td>
                    </tr>
                  ))}
                  {!data?.items.length && (
                    <tr>
                      <td colSpan={7} className="empty">
                        Không có đơn phù hợp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="order-pagination">
              <button
                type="button"
                disabled={loading || page <= 1}
                onClick={() => setPage(page - 1)}
                aria-label="Trang trước"
              >
                ←
              </button>
              <span>
                Trang {page} / {Math.max(1, Math.ceil((data?.total || 0) / 20))}
              </span>
              <button
                type="button"
                disabled={loading || page * 20 >= (data?.total || 0)}
                onClick={() => setPage(page + 1)}
                aria-label="Trang sau"
              >
                →
              </button>
            </div>
          </>
        )}
        <p className="muted refund-footnote">
          Bao gồm cả đơn mới thu một phần. Sửa thanh toán ghi nhầm không được
          tính là đã hoàn tiền.
          {!data?.can_manage && " Chỉ chủ cửa hàng được ghi nhận hoàn tiền."}{" "}
          {Number(summary?.review_count) > 0 &&
            "Đơn cũ có trạng thái đã thu nhưng thiếu sổ thu tiền cần được chủ cửa hàng đối soát trong chi tiết đơn trước khi ghi nhận hoàn."}
        </p>
      </section>
      {selected && (
        <RefundDialog
          order={selected}
          close={() => setSelected(null)}
          saved={() => {
            setSelected(null);
            toast("Đã ghi nhận hoàn tiền cho khách.");
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function RefundDialog({
  order,
  close,
  saved,
}: {
  order: RefundOrder;
  close: () => void;
  saved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const [amount, setAmount] = useState(String(order.outstanding)),
    [method, setMethod] = useState("bank");
  const [reference, setReference] = useState(""),
    [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const value = Number(amount),
    remaining = Number(order.outstanding) - value;
  const valid = Number.isInteger(value) && value > 0 && remaining >= 0;
  useEffect(() => {
    const el = dialog.current!,
      focused = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el.showModal();
    return () => {
      el.close();
      document.body.style.overflow = overflow;
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal refund-dialog"
      aria-labelledby="refund-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!lock.current) close();
      }}
    >
      <header className="modal-heading">
        <h2 id="refund-title">Ghi nhận đã hoàn tiền</h2>
        <button
          autoFocus
          type="button"
          className="icon-button"
          aria-label="Đóng"
          disabled={busy}
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || !confirmed || lock.current) return;
          lock.current = true;
          setBusy(true);
          setError("");
          const payload = {
            amount: value,
            method,
            reference: reference.trim(),
            note: note.trim(),
            version: order.version,
            confirmed: true,
          };
          const signature = JSON.stringify(payload);
          if (request.current?.signature !== signature)
            request.current = { signature, key: crypto.randomUUID() };
          try {
            await api(`workspace/orders/${order.id}/refund`, "POST", {
              ...payload,
              requestKey: request.current!.key,
            });
            saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <p>
            <strong>{order.reference}</strong> · {order.customer_name}
          </p>
          <p>
            Còn cần hoàn: <strong>{money(Number(order.outstanding))}</strong>
          </p>
          <p className="muted">
            Chỉ xác nhận sau khi đã chuyển tiền hoặc trả tiền mặt cho khách.
            Không dùng để sửa trạng thái nhập nhầm.
          </p>
          <fieldset disabled={busy}>
            <label>
              Số tiền đã hoàn (VNĐ)
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={Number(order.outstanding)}
                step={1}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setConfirmed(false);
                }}
                required
              />
            </label>
            <label>
              Hình thức hoàn
              <Select
                disabled={busy}
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="bank">Chuyển khoản</option>
                <option value="cash">Tiền mặt</option>
              </Select>
            </label>
            <label>
              Mã giao dịch hoàn (tùy chọn)
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              Ghi chú (tùy chọn)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
              />
            </label>
            {valid && (
              <p className="muted">
                Sau ghi nhận còn cần hoàn: {money(remaining)}
              </p>
            )}
            <label className="refund-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                required
              />
              <span>
                Tôi xác nhận đã hoàn {valid ? money(value) : "số tiền trên"} cho
                khách.
              </span>
            </label>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            Đóng
          </button>
          <button
            type="submit"
            className="button"
            disabled={busy || !confirmed || !valid}
          >
            {busy ? "Đang ghi nhận…" : "Xác nhận đã hoàn"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
