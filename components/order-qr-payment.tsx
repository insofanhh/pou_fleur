"use client";
import { useEffect, useState } from "react";
import { api } from "./context";
import { money } from "./home";

export default function OrderQRPayment({ payment }: { payment: any }) {
  const [session, setSession] = useState({ status: "pending", ...payment });
  const [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(
      payment.serverNow ? Date.parse(payment.serverNow) - Date.now() : 0,
    );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const remaining =
    Math.max(
      0,
      Math.ceil((Date.parse(session.expiresAt) - now - offset) / 1000),
    ) || 0;
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = await api(
          "payment-intents?code=" + encodeURIComponent(payment.code),
        );
        if (disposed) return;
        setSession(current);
        setOffset(Date.parse(current.serverNow) - Date.now());
        setError("");
        if (current.status !== "pending") return;
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
      if (!disposed) timer = setTimeout(poll, 3000);
    }
    void poll();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [payment.code]);
  const paid = session.status === "paid" || session.paymentStatus === "paid";
  const closed =
    session.orderStatus === "cancelled" ||
    ["cancelled", "expired"].includes(session.status);
  return (
    <section className="order-qr-payment" aria-label="Thanh toán chuyển khoản">
      <h3>
        {paid
          ? "Thanh toán thành công"
          : closed
            ? "Phiên thanh toán đã đóng"
            : "Thanh toán chuyển khoản"}
      </h3>
      {paid ? (
        <p>Cửa hàng đã ghi nhận thanh toán cho đơn của bạn.</p>
      ) : closed ? (
        <p>
          {session.orderStatus === "cancelled"
            ? "Đơn đã hủy và chưa ghi nhận tiền thanh toán. Bạn có thể tạo đơn mới."
            : "Mã QR không còn hiệu lực. Vui lòng liên hệ cửa hàng."}
        </p>
      ) : (
        <>
          <strong>{money(session.amount)}</strong>
          <p className="small">
            {session.bank?.bank_name} · {session.bank?.account_number}
            <br />
            {session.bank?.account_holder}
          </p>
          <p role="status">
            {remaining > 0 ? (
              <>
                Còn{" "}
                <strong>
                  {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}
                </strong>{" "}
                để thanh toán
              </>
            ) : (
              "Mã QR đã hết hạn. Đang cập nhật trạng thái đơn…"
            )}
          </p>
          {remaining > 0 && session.qrUrl && (
            <img
              src={session.qrUrl}
              alt={`Mã QR chuyển khoản ${session.bank?.bank_name || ""}`}
              width={240}
              height={300}
              style={{ objectFit: "contain", maxWidth: "100%" }}
            />
          )}
          {remaining > 0 && (
            <p className="small">
              Nội dung:{" "}
              <strong className="order-qr-code">{session.code}</strong>
              <br />
              Chuyển đúng ngân hàng, số tiền và nội dung trên. Đóng hoặc tải lại
              trang không kéo dài thời hạn.
            </p>
          )}
          {!confirm ? (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Hủy thanh toán
            </button>
          ) : (
            <div>
              <p>Hủy thanh toán và hủy đơn chưa nhận tiền này?</p>
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Quay lại
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      setSession(
                        await api("payment-intents/cancel", "POST", {
                          code: payment.code,
                        }),
                      );
                      setConfirm(false);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Đang hủy…" : "Xác nhận hủy"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
