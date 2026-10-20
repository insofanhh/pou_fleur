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
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const request = useRef<{ signature: string; key: string } | null>(null);
  const saving = useRef(false);
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
  const balanceChanged = !!delta || status !== order.payment_status;
  const canSave = !disabled && !invalid && balanceChanged;
  function selectStatus(value: string) {
    setMode(value);
    setError("");
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
        if (!canSave || saving.current) return;
        saving.current = true;
        onBusy(true);
        setError("");
        const payload = {
          totalCollected: Number(amount),
          method: order.payment_method === "bank" ? "bank" : "cash",
          reference,
          version: order.version,
          operation: "correction",
          reason: reason.trim(),
          updateBalance: balanceChanged,
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
          toast("Đã sửa thanh toán ghi nhầm.");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          saving.current = false;
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
        <p className="small">
          Sửa thanh toán ghi nhầm: nhập lại số tiền thực nhận. Điều chỉnh được
          lưu trong lịch sử, không ghi nhận thu hay hoàn tiền thực tế. Đơn đã
          hủy cần trả tiền cho khách được xử lý tại mục Hoàn tiền.
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
              setError("");
            }}
          />
        </label>
        <p className="small">
          Tổng khách cần thanh toán: {money(total)}. Đang ghi nhận:{" "}
          {money(current)}.
        </p>
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
            Sẽ điều chỉnh số tiền về: {money(Number(amount))}.
          </p>
        )}
        <label className="field">
          Lý do điều chỉnh (không bắt buộc)
          <input
            aria-label="Lý do điều chỉnh"
            maxLength={500}
            placeholder="Để trống để hệ thống tự ghi lý do"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {order.status === "cancelled" && (
          <p className="small">Đơn đã hủy không được tăng số tiền đã nhận.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button secondary" disabled={!canSave}>
          {disabled ? "Đang lưu…" : "Lưu thanh toán"}
        </button>
      </fieldset>
    </form>
  );
}
