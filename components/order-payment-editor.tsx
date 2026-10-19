"use client";
import Select from "./ui-select";
import { useRef, useState } from "react";
import { api, useShop } from "./context";
import { money } from "./home";

export default function OrderPaymentEditor({
  order,
  disabled,
  onBusy,
  onSaved,
}: {
  order: any;
  disabled: boolean;
  onBusy: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useShop();
  const total = Number(order.total),
    current = Number(order.collected || 0);
  const [amount, setAmount] = useState<number | "">(current);
  const [mode, setMode] = useState("auto");
  const [method, setMethod] = useState(
    order.payment_method === "bank" ? "bank" : "cash",
  );
  const [reference, setReference] = useState("");
  const [confirmedRefund, setConfirmedRefund] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ signature: string; key: string } | null>(null);
  const status =
    mode === "auto" &&
    amount === current &&
    ["refunded", "partially_refunded"].includes(order.payment_status)
      ? order.payment_status
      : mode === "partially_paid" && amount === ""
        ? mode
        : !Number(amount)
          ? "unpaid"
          : Number(amount) === total
            ? "paid"
            : "partially_paid";
  const delta = Number(amount) - current;
  const invalid =
    amount === "" ||
    !Number.isInteger(amount) ||
    Number(amount) < 0 ||
    Number(amount) > (order.status === "cancelled" ? current : total);
  function selectStatus(value: string) {
    setMode(value);
    setError("");
    setConfirmedRefund(false);
    setAmount(
      value === "paid"
        ? total
        : value === "unpaid"
          ? 0
          : Number(amount) > 0 && Number(amount) < total
            ? amount
            : "",
    );
  }
  return (
    <form
      className="order-payment-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled || invalid || !delta || (delta < 0 && !confirmedRefund))
          return;
        onBusy(true);
        setError("");
        const payload = {
          totalCollected: Number(amount),
          method,
          reference,
          version: order.version,
        };
        const signature = JSON.stringify(payload);
        if (request.current?.signature !== signature)
          request.current = { signature, key: crypto.randomUUID() };
        try {
          await api(`workspace/orders/${order.id}/payment-status`, "PATCH", {
            ...payload,
            requestKey: request.current.key,
          });
          await onSaved();
          toast(
            delta < 0
              ? "Đã ghi nhận hoàn tiền và cập nhật thanh toán."
              : "Đã cập nhật thanh toán.",
          );
        } catch (err) {
          setError((err as Error).message);
        } finally {
          onBusy(false);
        }
      }}
    >
      <fieldset disabled={disabled}>
        <label className="field">
          Trạng thái thanh toán
          <Select
            aria-label="Trạng thái thanh toán"
            value={status}
            onChange={(e) => selectStatus(e.target.value)}
          >
            <option value="unpaid">Chưa thanh toán</option>
            <option
              value="partially_paid"
              disabled={
                total <= 1 || (order.status === "cancelled" && current <= 0)
              }
            >
              Thanh toán một phần
            </option>
            <option
              value="paid"
              disabled={order.status === "cancelled" && current < total}
            >
              Đã thanh toán
            </option>
            {order.payment_status === "partially_refunded" && (
              <option value="partially_refunded" disabled>
                Đã hoàn tiền một phần
              </option>
            )}
            {order.payment_status === "refunded" && (
              <option value="refunded" disabled>
                Đã hoàn tiền
              </option>
            )}
          </Select>
        </label>
        <p className="small">
          Chọn trạng thái để điền số tiền, hoặc nhập số tiền đã nhận để tự cập
          nhật trạng thái. Thay đổi có hiệu lực sau khi bấm Lưu thanh toán.
        </p>
        <label className="field">
          Số tiền thực tế đã nhận (VNĐ)
          <input
            aria-label="Số tiền thực tế đã nhận (VNĐ)"
            type="number"
            step="1"
            min={mode === "partially_paid" && amount === "" ? 1 : 0}
            max={order.status === "cancelled" ? current : total}
            required
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value === "" ? "" : Number(e.target.value));
              setMode("auto");
              setConfirmedRefund(false);
              setError("");
            }}
          />
        </label>
        <p className="small">
          Tổng khách cần thanh toán: {money(total)}. Đã nhận sau hoàn tiền:{" "}
          {money(current)}.
        </p>
        <label className="field">
          Phương thức đã nhận / hoàn
          <Select
            aria-label="Phương thức đã nhận / hoàn"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="cash">Tiền mặt</option>
            <option value="bank">Chuyển khoản</option>
          </Select>
        </label>
        <label className="field">
          Mã tham chiếu / biên nhận
          <input
            aria-label="Mã tham chiếu / biên nhận"
            minLength={5}
            maxLength={100}
            placeholder="Để trống để tự tạo khi lưu"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        {!invalid && !!delta && (
          <p className="small" role="status">
            {delta > 0 ? "Sẽ ghi nhận thu thêm: " : "Sẽ ghi nhận hoàn tiền: "}
            {money(Math.abs(delta))}.
          </p>
        )}
        {delta < 0 && (
          <label className="check-field">
            <input
              type="checkbox"
              required
              checked={confirmedRefund}
              onChange={(e) => setConfirmedRefund(e.target.checked)}
            />
            Tôi xác nhận đã hoàn lại khoản chênh lệch cho khách. Trạng thái sẽ
            là hoàn tiền một phần hoặc đã hoàn tiền.
          </label>
        )}
        {order.status === "cancelled" && (
          <p className="small">
            Đơn đã hủy chỉ được hoàn tiền, không thu thêm.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button secondary"
          disabled={
            disabled || invalid || !delta || (delta < 0 && !confirmedRefund)
          }
        >
          {disabled ? "Đang lưu…" : "Lưu thanh toán"}
        </button>
      </fieldset>
    </form>
  );
}
