"use client";
import { useEffect, useRef, useState } from "react";
import {
  Ban,
  Check,
  Clock,
  Eye,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
import { api, useShop } from "./context";
import { money } from "./home";
import DateInput from "./date-input";
import Select from "./ui-select";
import PlatformDialog from "./platform-dialog";
import { TableAction, TableActions } from "./table-actions";
import { formatDate, formatDateTime } from "@/lib/date-time";
import { analyticsPeriod } from "@/lib/store-analytics";
import { isExperiencePlan } from "@/lib/plan-policy";

const initial = {
  q: "",
  status: "all",
  plan: "0",
  from: "",
  to: "",
  sort: "newest",
  page: 1,
};
const states: Record<string, string> = {
  open: "Chờ thanh toán",
  partially_paid: "Thu một phần",
  overdue: "Quá hạn",
  paid: "Đã thanh toán",
  free: "Miễn phí",
  void: "Đã hủy",
  payment_timeout: "Hết hạn thanh toán",
};
const code = (id: number) => "HD-" + String(id).padStart(6, "0");
const count = (n: number) => Number(n || 0).toLocaleString("vi-VN");
function statusOf(i: any) {
  return (
    i.display_status ||
    (i.void_reason === "payment_timeout"
      ? "payment_timeout"
      : isExperiencePlan(i.plan_id) && i.status === "paid"
        ? "free"
        : i.status)
  );
}
function PlanTag({ invoice: i }: { invoice: any }) {
  return (
    <span
      className={
        "tag invoice-plan invoice-plan-" +
        ([1, 2, 3, 4].includes(Number(i.plan_id)) ? i.plan_id : "other")
      }
    >
      {i.plan_name || "Gói đã lưu"}
    </span>
  );
}
function StatusTag({ invoice: i }: { invoice: any }) {
  const s = statusOf(i);
  return (
    <span
      className={
        "tag invoice-status invoice-status-" + (s in states ? s : "unknown")
      }
    >
      {states[s] || "Chưa xác định"}
    </span>
  );
}
function Period({ invoice: i }: { invoice: any }) {
  return (
    <>
      {i.effective_start_at ? (
        <>
          {formatDate(i.effective_start_at, "utc")} →{" "}
          {isExperiencePlan(i.plan_id)
            ? "Không giới hạn ngày"
            : formatDate(i.effective_end_at, "utc")}
          <small>Kỳ đã xác nhận</small>
        </>
      ) : i.period_start && i.period_end ? (
        <>
          {formatDate(i.period_start)} → {formatDate(i.period_end)}
          <small>Kỳ dự kiến, chưa áp dụng</small>
        </>
      ) : (
        <>{i.period_key || "Chưa bắt đầu kỳ"}</>
      )}
      {!isExperiencePlan(i.plan_id) && (
        <small>
          Hạn thanh toán:{" "}
          {i.due_at ? formatDateTime(i.due_at, "utc") : formatDate(i.due_date)}
        </small>
      )}
      {i.status === "open" &&
        Number(i.paid) === 0 &&
        (i.session_expires_at || i.payment_deadline_at) && (
          <small>
            Hạn phiên:{" "}
            {formatDateTime(
              i.session_expires_at || i.payment_deadline_at,
              "utc",
            )}
          </small>
        )}
    </>
  );
}
export default function PlatformInvoices({
  refreshKey,
}: {
  refreshKey: number;
}) {
  const { toast } = useShop();
  const [filters, setFilters] = useState(initial),
    [draft, setDraft] = useState(initial),
    [data, setData] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState<any>(null),
    [dialogError, setDialogError] = useState("");
  const dialogRequest = useRef(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      view: "list",
      ...Object.fromEntries(
        Object.entries(filters).map(([k, v]) => [k, String(v)]),
      ),
    });
    api("platform/invoices?" + params)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, refreshKey, revision]);
  async function open(i: any, mode = "view") {
    const request = ++dialogRequest.current;
    setDialog({ id: i.id, mode, loading: true });
    setDialogError("");
    try {
      const r = await api("platform/invoices/" + i.id);
      if (request === dialogRequest.current)
        setDialog({ id: i.id, mode, ...r });
    } catch (e) {
      if (request === dialogRequest.current) {
        setDialog({ id: i.id, mode });
        setDialogError((e as Error).message);
      }
    }
  }
  function close() {
    if (busy) return;
    dialogRequest.current++;
    setDialog(null);
    setDialogError("");
  }
  async function mutateInvoice(
    e: React.FormEvent<HTMLFormElement>,
    kind: "payment" | "void",
  ) {
    e.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(kind);
    setDialogError("");
    try {
      await api(
        `platform/invoices/${dialog.id}/${kind}`,
        "POST",
        kind === "payment"
          ? { ...values, amount: Number(values.amount) }
          : values,
      );
      toast(kind === "payment" ? "Đã ghi nhận thanh toán." : "Đã hủy hóa đơn.");
      setDialog(null);
      setRevision((v) => v + 1);
    } catch (e) {
      setDialogError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const invoice = dialog?.invoice;
  return (
    <div className="platform-invoices store-analytics">
      <section className="dashboard-panel invoice-sync">
        <div>
          <h3>Đối soát hóa đơn dịch vụ</h3>
          <p>
            Gia hạn theo kỳ sử dụng đã cấp; hóa đơn được chuẩn bị trước hạn 5
            ngày. Thời gian hiển thị theo giờ Hà Nội.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!!busy}
          onClick={async () => {
            if (busy) return;
            setBusy("sync");
            try {
              await api("platform/invoices/generate", "POST", {});
              setRevision((v) => v + 1);
              toast("Đã đồng bộ hóa đơn & trạng thái.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy("");
            }
          }}
        >
          <RefreshCw size={15} className={busy === "sync" ? "spin" : ""} />
          {busy === "sync" ? "Đang đồng bộ…" : "Đồng bộ hóa đơn & trạng thái"}
        </button>
      </section>
      <section className="dashboard-panel invoice-filters">
        <div className="panel-heading">
          <div>
            <h3>Tra cứu hóa đơn</h3>
            <p>
              Tìm theo mã hóa đơn, tên cửa hàng, email chủ cửa hàng, gói, kỳ
              hoặc mã giao dịch.
            </p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              if (draft.from || draft.to) analyticsPeriod(draft.from, draft.to);
              setFilters({ ...draft, page: 1 });
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label className="invoice-search">
            Tìm kiếm
            <input
              type="search"
              maxLength={190}
              placeholder="Mã hóa đơn, cửa hàng, email, mã giao dịch…"
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
          <label>
            Trạng thái
            <Select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(states).map(([key, label]) => (
                <option key={key} value={key}>
                  {key === "open"
                    ? "Đang chờ (gồm thu một phần, quá hạn)"
                    : label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Gói dịch vụ
            <Select
              value={draft.plan}
              onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
            >
              <option value="0">Tất cả gói</option>
              {data?.plans.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Tạo từ ngày
            <DateInput
              type="date"
              required={!!draft.to}
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </label>
          <label>
            Đến ngày
            <DateInput
              type="date"
              required={!!draft.from}
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </label>
          <label>
            Sắp xếp
            <Select
              value={draft.sort}
              onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
            >
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
              <option value="due">Hạn thanh toán gần nhất</option>
              <option value="balance">Còn phải thu cao nhất</option>
            </Select>
          </label>
          <div className="button-row">
            <button className="button" disabled={loading}>
              <Search size={15} />
              Tìm & lọc
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setDraft(initial);
                setFilters(initial);
                setError("");
              }}
            >
              Xóa bộ lọc
            </button>
          </div>
        </form>
      </section>
      {error && (
        <p className="analytics-error" role="alert">
          {error}
        </p>
      )}
      <p className="analytics-context" role="status">
        {loading
          ? "Đang cập nhật hóa đơn…"
          : data
            ? `${count(data.total)} hóa đơn phù hợp · Tổng hợp theo bộ lọc, không chỉ trang đang xem`
            : "Chưa tải được hóa đơn"}
      </p>
      {data ? (
        <div className="analytics-results" aria-busy={loading}>
          <div className="stat-grid">
            {[
              [
                Receipt,
                "Hóa đơn",
                count(data.total),
                "Tất cả trạng thái theo bộ lọc",
              ],
              [
                Wallet,
                "Đã thu",
                money(data.summary.paid),
                "Tổng đã nhận của các hóa đơn phù hợp",
              ],
              [
                Wallet,
                "Còn phải thu",
                money(data.summary.outstanding),
                "Chỉ hóa đơn đang chờ, loại hóa đơn đã hủy",
              ],
              [
                Clock,
                "Hóa đơn quá hạn",
                count(data.summary.overdue),
                "Còn công nợ và đã qua hạn thanh toán",
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
          <section className="dashboard-panel">
            <div className="table-scroll invoice-table">
              <table>
                <thead>
                  <tr>
                    {[
                      "Hóa đơn / Cửa hàng",
                      "Kỳ sử dụng",
                      "Gói",
                      "Thành tiền",
                      "Đã thu",
                      "Còn phải thu",
                      "Trạng thái",
                      "Thao tác",
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!data.rows.length ? (
                    <tr>
                      <td colSpan={8} className="analytics-empty">
                        Không có hóa đơn phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((i: any) => (
                      <tr key={i.id}>
                        <td>
                          <strong>{code(i.id)}</strong>
                          <small>{i.store_name}</small>
                          <small>{i.owner_email}</small>
                          <small>Tạo: {formatDateTime(i.created_at)}</small>
                        </td>
                        <td>
                          <Period invoice={i} />
                        </td>
                        <td>
                          <PlanTag invoice={i} />
                        </td>
                        <td>{money(i.amount)}</td>
                        <td>{money(i.paid)}</td>
                        <td>
                          <strong
                            className={
                              i.status === "open" && Number(i.balance) > 0
                                ? "invoice-balance"
                                : ""
                            }
                          >
                            {money(i.status === "open" ? i.balance : 0)}
                          </strong>
                        </td>
                        <td>
                          <StatusTag invoice={i} />
                          {Number(i.paid) > 0 &&
                            i.status === "open" &&
                            statusOf(i) !== "partially_paid" && (
                              <small>Đã thu một phần</small>
                            )}
                        </td>
                        <td>
                          <TableActions>
                            <TableAction
                              icon={Eye}
                              aria-label={"Xem " + code(i.id)}
                              title="Xem chi tiết"
                              disabled={!!busy}
                              onClick={() => void open(i)}
                            />
                            {i.can_pay && (
                              <TableAction
                                icon={Check}
                                aria-label={"Ghi nhận thanh toán " + code(i.id)}
                                title="Ghi nhận thanh toán"
                                disabled={!!busy}
                                onClick={() => void open(i, "payment")}
                              />
                            )}{" "}
                            {i.can_void && (
                              <TableAction
                                icon={Ban}
                                aria-label={"Hủy " + code(i.id)}
                                title="Hủy hóa đơn"
                                disabled={!!busy}
                                onClick={() => void open(i, "void")}
                              />
                            )}
                          </TableActions>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="platform-report-pagination">
              <span>
                {count(data.total)} kết quả · Trang {data.page}/
                {Math.max(1, Math.ceil(data.total / data.page_size))}
              </span>
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={loading || data.page <= 1}
                  onClick={() =>
                    setFilters({ ...filters, page: data.page - 1 })
                  }
                >
                  Trước
                </button>
                <button
                  className="button secondary"
                  disabled={loading || data.page * data.page_size >= data.total}
                  onClick={() =>
                    setFilters({ ...filters, page: data.page + 1 })
                  }
                >
                  Sau
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="dashboard-panel analytics-empty">
          {error ? "Vui lòng thử làm mới." : "Đang tải danh sách hóa đơn…"}
        </div>
      )}
      {dialog && (
        <PlatformDialog title={"Hóa đơn " + code(dialog.id)} onClose={close}>
          <div className="invoice-detail">
            {dialogError && (
              <p className="analytics-error" role="alert">
                {dialogError}
              </p>
            )}
            {dialog.loading ? (
              <p role="status">Đang tải chi tiết…</p>
            ) : (
              invoice && (
                <>
                  <div className="invoice-detail-heading">
                    <div>
                      <h3>{invoice.store_name}</h3>
                      <p>{invoice.owner_email}</p>
                    </div>
                    <div className="button-row">
                      <PlanTag invoice={invoice} />
                      <StatusTag invoice={invoice} />
                    </div>
                  </div>
                  <div className="invoice-detail-totals">
                    <div>
                      <small>Thành tiền</small>
                      <strong>{money(invoice.amount)}</strong>
                    </div>
                    <div>
                      <small>Đã thu</small>
                      <strong>{money(invoice.paid)}</strong>
                    </div>
                    <div>
                      <small>Còn phải thu</small>
                      <strong>
                        {money(invoice.status === "open" ? invoice.balance : 0)}
                      </strong>
                    </div>
                  </div>
                  <section>
                    <h3>Kỳ sử dụng & thời hạn</h3>
                    <p>
                      <Period invoice={invoice} />
                    </p>
                    <p className="small">
                      Tạo: {formatDateTime(invoice.created_at)} ·{" "}
                      {invoice.purpose === "plan_change"
                        ? "Đổi gói dịch vụ"
                        : "Đăng ký / gia hạn dịch vụ"}
                    </p>
                    {invoice.activated_at && (
                      <p className="small">
                        Áp dụng: {formatDateTime(invoice.activated_at, "utc")}
                      </p>
                    )}
                    {invoice.status === "paid" &&
                      !invoice.activated_at &&
                      !isExperiencePlan(invoice.plan_id) && (
                        <p className="small">
                          Đã xác nhận thanh toán; thời điểm áp dụng phụ thuộc kỳ
                          sử dụng và quy tắc đổi gói.
                        </p>
                      )}
                    {invoice.void_reason && (
                      <p className="small">
                        Lý do:{" "}
                        {(
                          {
                            payment_timeout: "Phiên thanh toán hết hạn",
                            owner_cancelled: "Chủ cửa hàng hủy thanh toán",
                            plan_replaced: "Thay thế bằng lựa chọn gói khác",
                            trial_selected: "Chuyển sang dùng thử",
                          } as Record<string, string>
                        )[invoice.void_reason] ||
                          "Hóa đơn đã được hủy bởi hệ thống hoặc quản trị viên"}
                      </p>
                    )}
                  </section>
                  <section>
                    <h3>Lịch sử thu tiền</h3>
                    {!dialog.payments.length ? (
                      <p className="small">
                        Chưa có giao dịch thu tiền được ghi nhận.
                      </p>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Thời gian nhận</th>
                              <th>Mã giao dịch</th>
                              <th>Số tiền</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dialog.payments.map((p: any) => (
                              <tr key={p.id}>
                                <td>
                                  {p.received_at
                                    ? formatDateTime(p.received_at, "utc")
                                    : formatDateTime(p.created_at)}
                                </td>
                                <td>
                                  <strong>{p.reference}</strong>
                                  <small>
                                    {p.actor_name || "Hệ thống / SePay"}
                                  </small>
                                </td>
                                <td>{money(p.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                  <div className="button-row invoice-dialog-modes">
                    <button
                      className={
                        "button " + (dialog.mode === "view" ? "" : "secondary")
                      }
                      onClick={() => setDialog({ ...dialog, mode: "view" })}
                    >
                      Chi tiết
                    </button>
                    {invoice.can_pay && (
                      <button
                        className={
                          "button " +
                          (dialog.mode === "payment" ? "" : "secondary")
                        }
                        onClick={() =>
                          setDialog({ ...dialog, mode: "payment" })
                        }
                      >
                        Ghi nhận thanh toán
                      </button>
                    )}
                    {invoice.can_void && (
                      <button
                        className={
                          "button " +
                          (dialog.mode === "void" ? "" : "secondary")
                        }
                        onClick={() => setDialog({ ...dialog, mode: "void" })}
                      >
                        Hủy hóa đơn
                      </button>
                    )}
                  </div>
                  {dialog.mode === "payment" && invoice.can_pay && (
                    <form
                      className="invoice-action-form"
                      onSubmit={(e) => void mutateInvoice(e, "payment")}
                    >
                      <p className="small">
                        Chỉ ghi nhận tiền thực tế đã nhận. Giao dịch SePay đã
                        đồng bộ không cần nhập lại.
                      </p>
                      <label>
                        Số tiền nhận (VNĐ)
                        <input
                          name="amount"
                          type="number"
                          required
                          min="1"
                          max={invoice.balance}
                          step="1"
                          defaultValue={invoice.balance}
                        />
                      </label>
                      <label>
                        Mã giao dịch
                        <input
                          name="reference"
                          required
                          minLength={5}
                          maxLength={100}
                          placeholder="Mã giao dịch ngân hàng để chống ghi nhận trùng"
                        />
                      </label>
                      <button className="button" disabled={!!busy}>
                        {busy === "payment"
                          ? "Đang ghi nhận…"
                          : "Xác nhận đã nhận tiền"}
                      </button>
                    </form>
                  )}
                  {dialog.mode === "void" && invoice.can_void && (
                    <form
                      className="invoice-action-form"
                      onSubmit={(e) => void mutateInvoice(e, "void")}
                    >
                      <p className="small">
                        Hủy hóa đơn sẽ đóng phiên QR còn chờ. Hóa đơn đã nhận
                        tiền không thể hủy bằng thao tác này.
                      </p>
                      <label>
                        Lý do hủy hóa đơn
                        <textarea
                          name="reason"
                          required
                          minLength={5}
                          maxLength={500}
                        />
                      </label>
                      <button className="button" disabled={!!busy}>
                        {busy === "void" ? "Đang hủy…" : "Xác nhận hủy hóa đơn"}
                      </button>
                    </form>
                  )}
                </>
              )
            )}
          </div>
        </PlatformDialog>
      )}
    </div>
  );
}
