"use client";
import Select from "./ui-select";
import { useEffect, useRef, useState } from "react";
import { api, useShop } from "./context";
import { needsTransitionReason } from "@/lib/order-workflow";
import { orderLabels } from "@/lib/display-labels";
import { money } from "./home";

export function useOrderTransition(
  refresh: () => Promise<void>,
  done: () => void,
) {
  const { toast } = useShop();
  const [pending, setPending] = useState<{ order: any; status: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function commit(order: any, status: string, options = {}) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await api(`workspace/orders/${order.id}/status`, "PATCH", {
        status,
        version: order.version,
        ...options,
      });
      setPending(null);
      done();
      await refresh();
      toast("Đã cập nhật đơn hàng.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function move(order: any, status: string) {
    if (busy || pending || status === order.status) return;
    if (needsTransitionReason(order.status, status))
      setPending({ order, status });
    else
      void commit(order, status).catch(async (e) => {
        toast(e.message);
        await refresh();
      });
  }
  const confirmation = pending && (
    <TransitionConfirmation
      {...pending}
      busy={busy}
      close={() => {
        if (!busy) setPending(null);
      }}
      save={(options: any) => commit(pending.order, pending.status, options)}
    />
  );
  return { move, busy, confirmation };
}

function TransitionConfirmation({ order, status, busy, close, save }: any) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const restore = order.status === "cancelled";
  useEffect(() => {
    const focused = document.activeElement,
      overflow = document.body.style.overflow,
      paddingRight = document.body.style.paddingRight,
      ownsScrollLock = !document.querySelector("dialog:modal");
    if (ownsScrollLock) {
      const scrollbar = innerWidth - document.documentElement.clientWidth;
      if (scrollbar > 0)
        document.body.style.paddingRight =
          parseFloat(getComputedStyle(document.body).paddingRight) +
          scrollbar +
          "px";
      document.body.style.overflow = "hidden";
    }
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (ownsScrollLock) {
        document.body.style.overflow = overflow;
        document.body.style.paddingRight = paddingRight;
      }
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!restore) return;
    let active = true;
    api("workspace/manual-orders/options")
      .then((d) => {
        if (active) setSlots(d.settings.slots);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [restore]);
  return (
    <dialog
      ref={ref}
      className="modal order-panel order-transition"
      aria-label="Xác nhận chuyển trạng thái"
      data-no-fade-in
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="modal-heading">
        <h2>
          {restore
            ? "Khôi phục đơn hàng"
            : status === "cancelled"
              ? "Hủy đơn hàng"
              : "Chuyển về bước trước"}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Đóng xác nhận"
          disabled={busy}
          onClick={close}
        >
          ✕
        </button>
      </header>
      <form
        className="modal-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await save(Object.fromEntries(new FormData(e.currentTarget)));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <p>
          <strong>{order.reference}</strong> · {orderLabels[order.status]} →{" "}
          {orderLabels[status]}
        </p>
        <p className="small">
          {restore
            ? "Hệ thống sẽ giữ lại tồn kho và kiểm tra lượt khuyến mãi, lịch giao trước khi khôi phục."
            : status === "cancelled"
              ? "Hệ thống sẽ trả tồn kho và lượt khuyến mãi. Tiền đã thu không tự động hoàn; ghi nhận hoàn tiền riêng sau khi xử lý."
              : "Lịch sử thay đổi được lưu lại. Số tiền đã thu không thay đổi."}
        </p>
        {status === "cancelled" && Number(order.collected) > 0 && (
          <p className="order-alert">
            Đã thu {money(Number(order.collected))} — cần xử lý hoàn tiền.
          </p>
        )}
        {restore && (
          <div className="order-form-grid">
            <label className="field">
              Ngày giao khi khôi phục
              <input
                type="date"
                name="date"
                defaultValue={order.delivery_date}
                required
              />
            </label>
            <label className="field">
              Khung giờ khi khôi phục
              <Select
                name="slot"
                defaultValue={order.delivery_slot}
                required
                disabled={!slots}
                key={slots?.join() || "loading"}
              >
                {!slots?.includes(order.delivery_slot) && (
                  <option value="">Chọn khung giờ</option>
                )}
                {slots?.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </label>
          </div>
        )}
        <label className="field">
          Lý do chuyển trạng thái
          <textarea
            name="reason"
            minLength={5}
            maxLength={500}
            required
            placeholder="Nhập lý do để lưu vào lịch sử đơn…"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button className="button" disabled={busy || (restore && !slots)}>
            {busy ? "Đang cập nhật…" : "Xác nhận chuyển trạng thái"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            Quay lại
          </button>
        </div>
      </form>
    </dialog>
  );
}
