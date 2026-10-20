"use client";
import { useRef, useState } from "react";
import { Banknote, Truck, Store } from "lucide-react";
import Select from "./ui-select";
import { api, useShop } from "./context";
import { money } from "./home";
import { codOutstanding, collectionOutstanding, codPayerLabel, isPaidCOD } from "@/lib/cod-policy";
import { isPickup, orderMethodLabel } from "@/lib/order-fulfillment";

export function PickupTag({ order }: { order: any }) {
  return isPickup(order) ? <span className="tag order-pickup-tag"><Store size={12} aria-hidden="true" />Khách lấy tại cửa hàng</span> : null;
}

export function CODMonitor({ stats }: { stats?: {
  awaiting_count: number | string;
  outstanding: number | string;
  delivered_count: number | string;
  delivered_due: number | string;
} }) {
  if (!stats || !(Number(stats.outstanding) > 0 || Number(stats.delivered_due) > 0))
    return null;

  return (
    <section className="cod-monitor" aria-label="Theo dõi COD">
      <div className="cod-monitor-metric">
        <span className="cod-monitor-icon"><Banknote size={18} aria-hidden="true" /></span>
        <div>
          <div className="cod-monitor-label">COD còn phải thu <span>{Number(stats.awaiting_count)} đơn</span></div>
          <strong>{money(Number(stats.outstanding))}</strong>
        </div>
      </div>
      <div className="cod-monitor-metric cod-monitor-delivered" title="Các đơn đã giao nằm trong tổng COD còn phải thu.">
        <span className="cod-monitor-icon"><Truck size={18} aria-hidden="true" /></span>
        <div>
          <div className="cod-monitor-label">Đã giao chưa thu đủ <span>{Number(stats.delivered_count)} đơn</span></div>
          <strong>{money(Number(stats.delivered_due))}</strong>
        </div>
      </div>
      <small className="cod-monitor-scope">Toàn bộ đơn của cửa hàng</small>
    </section>
  );
}

export function OrderMethodTag({ order }: { order: any }) {
  if (isPaidCOD(order)) return null;
  return (
    <span className={"tag order-method-" + order.payment_method}>
      {orderMethodLabel(order)}
    </span>
  );
}
export function OrderPaymentSummary({ order }: { order: any }) {
  if (isPaidCOD(order)) return null;
  return (
    <div className="order-method-summary">
      <OrderMethodTag order={order} />
      {isPickup(order) && collectionOutstanding(order) > 0
        ? <small className="cod-outstanding">Còn phải thu tại quầy: {money(collectionOutstanding(order))}</small>
        : <CODSummary order={order} />}
    </div>
  );
}
export function CODSummary({ order }: { order: any }) {
  const due = codOutstanding(order);
  return due > 0 ? (
    <small
      className={
        "cod-outstanding" + (order.status === "delivered" ? " cod-overdue" : "")
      }
    >
      {order.status === "delivered"
        ? "Đã giao · chưa thu đủ"
        : "COD còn phải thu"}
      : {money(due)}
    </small>
  ) : null;
}
export function CODReceiptFields({
  due,
  full = false,
  partial = false,
  pickup = false,
}: {
  due: number;
  full?: boolean;
  partial?: boolean;
  pickup?: boolean;
}) {
  return (
    <fieldset className="manual-fieldset cod-receipt-fields">
      <div className="order-form-grid">
        <label className="field">
          Số tiền vừa nhận (VNĐ)
          <input
            name="codAmount"
            type="number"
            min="1"
            max={partial ? due - 1 : due}
            step="1"
            defaultValue={full ? due : undefined}
            readOnly={full}
            required
          />
        </label>
        <label className="field">
          Hình thức thu thực tế
          <Select name="codMethod" defaultValue="cash">
            <option value="cash">Tiền mặt</option>
            <option value="bank">Chuyển khoản</option>
          </Select>
        </label>
      </div>
      <label className="field">
        Mã tham chiếu (nếu có)
        <input
          name="codReference"
          minLength={5}
          maxLength={100}
          placeholder="Mã giao dịch ngân hàng / phiếu thu"
        />
      </label>
      <label className="field">
        Ghi chú thu tiền
        <input name="codNote" maxLength={500} />
      </label>
      <label className="check-field">
        <input name="codConfirmed" type="checkbox" required />
        Tôi xác nhận cửa hàng đã thực nhận số tiền này.
      </label>
      <p className="small">
        {pickup ? "Chỉ ghi nhận số tiền cửa hàng đã thực nhận từ khách mua tại quầy." : "Chỉ ghi nhận tiền đã vào cửa hàng. Nếu đơn vị giao hàng đang giữ tiền, chờ đối soát trước khi xác nhận."}
      </p>
    </fieldset>
  );
}
export function codReceiptPayload(form: FormData, order: any, key: string) {
  return {
    amount: Number(form.get("codAmount")),
    method: form.get("codMethod"),
    reference: String(form.get("codReference") || ""),
    note: String(form.get("codNote") || ""),
    confirmed: form.get("codConfirmed") === "on",
    version: order.version,
    requestKey: key,
  };
}
export default function OrderCODReceipt({
  order,
  disabled,
  onBusy,
  onSaved,
}: any) {
  const { toast } = useShop(),
    key = useRef("");
  const [error, setError] = useState(""),
    lock = useRef(false);
  const due = collectionOutstanding(order);
  if (due <= 0) return null;
  return (
    <details className="order-secondary cod-receipt">
      <summary>{isPickup(order) ? "Xác nhận đã thu tại quầy" : "Xác nhận đã thu COD"}</summary>
      <p className="small">
        {codPayerLabel(order)} · Còn phải thu {money(due)}. Giữ nguyên phương
        thức đặt hàng đã chọn.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          onBusy(true);
          setError("");
          if (!key.current) key.current = crypto.randomUUID();
          try {
            await api(
              `workspace/orders/${order.id}/cod`,
              "POST",
              codReceiptPayload(
                new FormData(e.currentTarget),
                order,
                key.current,
              ),
            );
            await onSaved();
            toast(isPickup(order) ? "Đã ghi nhận thu tại quầy." : "Đã ghi nhận thu COD.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            lock.current = false;
            onBusy(false);
          }
        }}
      >
        <fieldset className="manual-fieldset" disabled={disabled}>
          <CODReceiptFields due={due} pickup={isPickup(order)} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button secondary" disabled={disabled}>
            {isPickup(order) ? "Xác nhận đã thu tại quầy" : "Xác nhận đã thu COD"}
          </button>
        </fieldset>
      </form>
    </details>
  );
}
