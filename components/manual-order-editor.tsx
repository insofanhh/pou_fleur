"use client";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import { useSearchParams } from "next/navigation";
import Link, { storeRef, useScopedRouter } from "./routing";
import { api, useShop } from "./context";
import { money } from "./home";
import { orderLabels } from "@/lib/display-labels";
import {
  Plus,
  Trash2,
  ArrowLeft,
  FileText,
  Check,
  ImagePlus,
} from "lucide-react";

const empty = {
  customerId: null as number | null,
  customerName: "",
  email: "",
  phone: "",
  separateContact: false,
  salesChannel: "phone",
  items: [] as any[],
  code: "",
  discountType: "none",
  discountValue: 0,
  adjustmentReason: "",
  deliveryMode: "gift",
  recipientName: "",
  recipientPhone: "",
  address: "",
  deliveryDate: "",
  deliverySlot: "",
  message: "",
  notes: "",
  internalNotes: "",
  assignedTo: null as number | null,
  tags: [] as string[],
  initialStatus: "pending",
  collectAmount: 0,
  collectMethod: "cash",
  paymentReference: "",
};
const channels: Record<string, string> = {
  phone: "Điện thoại",
  zalo: "Zalo",
  social: "Facebook / Instagram",
  in_person: "Tại cửa hàng",
  other: "Khác",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="manual-field">
      <span>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, {
            "aria-label": label,
          })
        : children}
    </label>
  );
}
export default function ManualOrderEditor() {
  const params = useSearchParams(),
    router = useScopedRouter(),
    { toast } = useShop();
  const [form, setForm] = useState<any>({ ...empty }),
    [options, setOptions] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [quote, setQuote] = useState<any>(null),
    [paymentMode, setPaymentMode] = useState("auto"),
    [priceEstimate, setPriceEstimate] = useState<any>(null),
    [priceError, setPriceError] = useState(""),
    [draft, setDraft] = useState<any>(null),
    [drafts, setDrafts] = useState<any>(null),
    [page, setPage] = useState(1),
    [customerSearch, setCustomerSearch] = useState(""),
    [customers, setCustomers] = useState<any[]>([]),
    [productSearch, setProductSearch] = useState(""),
    [products, setProducts] = useState<any[]>([]),
    [loading, setLoading] = useState(true);
  const key = useRef(""),
    leaving = useRef(false),
    priceRequest = useRef(0);
  const showDrafts = params.get("drafts") === "1",
    draftId = params.get("draft"),
    date = params.get("date"),
    customer = params.get("customer");
  const cap = options?.capabilities || {};
  // Quote only pricing inputs so editing contact/payment fields neither refetches
  // prices nor makes an otherwise current total unavailable.
  const pricingKey = JSON.stringify({
    items: form.items,
    code: form.code,
    discountType: form.discountType,
    discountValue: form.discountValue,
    adjustmentReason: form.adjustmentReason,
    shipping: form.shipping,
  });
  const currentTotal =
    priceEstimate?.key === pricingKey ? Number(priceEstimate.total) : undefined;
  const paymentStatus =
    paymentMode !== "auto"
      ? paymentMode
      : !Number(form.collectAmount)
        ? "unpaid"
        : currentTotal !== undefined &&
            Number(form.collectAmount) === currentTotal
          ? "paid"
          : "partially_paid";
  function change(patch: any) {
    leaving.current = false;
    setForm((f: any) => ({ ...f, ...patch }));
    if (Object.hasOwn(patch, "collectAmount")) {
      // Keep the explicit partial choice while its required input is empty.
      if (patch.collectAmount !== undefined || paymentMode !== "partially_paid")
        setPaymentMode("auto");
    }
    setDirty(true);
    setQuote(null);
    key.current = "";
    setError("");
  }
  function selectPayment(status: string) {
    const amount = Number(form.collectAmount);
    change({
      collectAmount:
        status === "paid"
          ? (currentTotal ?? 0)
          : status === "unpaid"
            ? 0
            : amount > 0 && currentTotal !== undefined && amount < currentTotal
              ? amount
              : undefined,
    });
    setPaymentMode(status);
  }
  function itemChange(index: number, patch: any) {
    change({
      items: form.items.map((i: any, n: number) =>
        n === index ? { ...i, ...patch } : i,
      ),
    });
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setDraft(null);
    setQuote(null);
    setPaymentMode("auto");
    setPriceEstimate(null);
    setPriceError("");
    setDirty(false);
    leaving.current = false;
    async function load() {
      const opts = await api("workspace/manual-orders/options");
      let data: any = {
        ...empty,
        items: [],
        tags: [],
        assignedTo: opts.currentUserId,
        deliveryDate: date || "",
        deliverySlot: opts.settings.slots[0] || "",
      };
      let saved: any = null;
      if (draftId) {
        saved = await api("workspace/order-drafts/" + draftId);
        if (saved.status !== "draft")
          throw Error("Nháp đã được chuyển thành đơn hoặc lưu trữ.");
        data = { ...data, ...saved.payload };
      }
      if (customer && !draftId) {
        const selected = await api(
          "workspace/order-customers?customer=" + encodeURIComponent(customer),
        );
        if (selected[0])
          data = {
            ...data,
            customerId: selected[0].id,
            customerName: selected[0].name,
            email: selected[0].email || "",
            phone: selected[0].phone || "",
          };
      }
      if (active) {
        setOptions(opts);
        setForm(data);
        setDraft(saved);
        key.current = "";
      }
    }
    void load()
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [draftId, date, customer, showDrafts]);
  useEffect(() => {
    const request = ++priceRequest.current;
    let active = true;
    setPriceError("");
    if (
      loading ||
      showDrafts ||
      !cap.collect ||
      !JSON.parse(pricingKey).items.length
    )
      return;
    const timer = setTimeout(async () => {
      try {
        const priced = await api("workspace/manual-orders/quote", "POST", {
          ...JSON.parse(pricingKey),
          collectAmount: 0,
        });
        if (active && request === priceRequest.current)
          setPriceEstimate({ key: pricingKey, total: priced.total });
      } catch (e) {
        if (active && request === priceRequest.current) {
          setPriceEstimate(null);
          setPriceError((e as Error).message);
        }
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pricingKey, loading, showDrafts, cap.collect, draftId, date, customer]);
  useEffect(() => {
    if (paymentMode !== "paid") return;
    // Never retain a stale full-payment amount while a new total is pending.
    setForm((f: any) => ({ ...f, collectAmount: currentTotal ?? 0 }));
  }, [paymentMode, currentTotal]);
  useEffect(() => {
    if (!error) return;
    const alert = document.querySelector<HTMLElement>(".manual-error");
    alert?.focus();
    alert?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [error]);
  useEffect(() => {
    if (!showDrafts) return;
    let active = true;
    api("workspace/order-drafts?page=" + page)
      .then((d) => active && setDrafts(d))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [showDrafts, page]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty && !leaving.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest?.("a[href]");
      if (
        dirty &&
        !leaving.current &&
        anchor &&
        !confirm("Bạn còn nội dung chưa lưu. Rời trang?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", guard);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api("workspace/order-customers?q=" + encodeURIComponent(customerSearch))
        .then((d) => active && setCustomers(d))
        .catch((e) => active && setError(e.message));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [customerSearch]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api("workspace/order-products?q=" + encodeURIComponent(productSearch))
        .then((d) => active && setProducts(d))
        .catch((e) => active && setError(e.message));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [productSearch]);
  async function saveDraft() {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "workspace/order-drafts" + (draft ? "/" + draft.id : ""),
        draft ? "PATCH" : "POST",
        { ...form, ...(draft ? { version: draft.version } : {}) },
      );
      setDraft(result);
      setDirty(false);
      toast("Đã lưu nháp. Chưa giữ tồn kho hoặc khung giờ.");
      leaving.current = true;
      router.replace("/admin/orders/new?draft=" + result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review() {
    setBusy(true);
    setError("");
    try {
      // Always reprice at review; a background estimate is not authorization
      // to record money, and prices may have changed since it was fetched.
      const priced = await api("workspace/manual-orders/quote", "POST", {
        ...form,
        collectAmount: 0,
      });
      priceRequest.current++;
      setPriceEstimate({ key: pricingKey, total: priced.total });
      setPriceError("");
      const amount =
        paymentMode === "paid" ? priced.total : Number(form.collectAmount || 0);
      if (paymentMode === "paid" && priced.total === 0)
        throw Error(
          "Tổng đơn là 0 đ, không có khoản tiền cần thu. Chọn Chưa thanh toán.",
        );
      if (
        paymentMode === "partially_paid" &&
        !(amount > 0 && amount < priced.total)
      )
        throw Error(
          "Thanh toán một phần cần số tiền lớn hơn 0 và nhỏ hơn tổng đơn.",
        );
      if (amount > priced.total)
        throw Error("Tiền thu không được vượt tổng đơn.");
      if (amount > 100000000)
        throw Error("Số tiền thu mỗi lần không được vượt 100.000.000 đ.");
      setForm((f: any) => ({ ...f, collectAmount: amount }));
      setQuote(priced);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!quote) return;
    setBusy(true);
    setError("");
    key.current ||= crypto.randomUUID();
    try {
      const result = await api("workspace/manual-orders", "POST", {
        ...form,
        idempotencyKey: key.current,
        quoteToken: quote.token,
        ...(draft ? { draftId: draft.id, draftVersion: draft.version } : {}),
      });
      leaving.current = true;
      setDirty(false);
      toast("Đã tạo đơn " + result.reference);
      router.replace("/admin/board?order=" + result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(index: number, file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 4 * 1024 * 1024
      )
        throw Error("Ảnh JPG, PNG hoặc WebP tối đa 4 MB.");
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/upload?purpose=order-reference", {
        method: "POST",
        headers: { "x-fleur-store": storeRef(location.pathname) },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      itemChange(index, { image: data.url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const textField = (name: string, label: string, attrs: any = {}) => (
    <Field label={label}>
      <input
        name={name}
        value={form[name] ?? ""}
        onChange={(e) =>
          change({
            [name]:
              attrs.type === "number"
                ? e.target.value === ""
                  ? undefined
                  : Number(e.target.value)
                : e.target.value,
          })
        }
        {...attrs}
      />
    </Field>
  );
  const block = (title: string, children: ReactNode) => (
    <section className="panel manual-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
  if (loading) return <p role="status">Đang mở trình tạo đơn…</p>;
  if (!options)
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  return (
    <div className="manual-orders" data-no-fade-in>
      <div className="manual-nav">
        <Link href="/admin/board" className="text-link">
          <ArrowLeft size={16} /> Đơn hàng
        </Link>
        <Link href="/admin/orders/new" className="text-link">
          <Plus size={16} /> Đơn mới
        </Link>
        <Link href="/admin/orders/new?drafts=1" className="text-link">
          <FileText size={16} /> Đơn nháp
        </Link>
      </div>
      {error && (
        <div className="error manual-error" role="alert" tabIndex={-1}>
          {error}
        </div>
      )}
      {showDrafts ? (
        <section className="panel">
          <h2>Đơn nháp</h2>
          <p className="small">
            Nháp chưa giữ tồn kho hoặc lịch giao và chưa gửi thông báo cho
            khách.
          </p>
          {!drafts ? (
            <p>Đang tải…</p>
          ) : !drafts.items.length ? (
            <p>Chưa có đơn nháp.</p>
          ) : (
            drafts.items.map((d: any) => {
              const p =
                typeof d.payload === "string"
                  ? JSON.parse(d.payload)
                  : d.payload;
              return (
                <div className="manual-draft" key={d.id}>
                  <div>
                    <strong>{p.customerName || "Chưa nhập khách"}</strong>
                    <p>
                      {p.phone || "Chưa có điện thoại"} · {p.items?.length || 0}{" "}
                      dòng hàng
                    </p>
                    <small>
                      Cập nhật {d.updated_at}
                      {Date.now() - Date.parse(d.updated_at) > 7 * 86400000
                        ? " · Nháp quá 7 ngày, cần rà soát"
                        : ""}
                    </small>
                  </div>
                  <div className="button-row">
                    <Link
                      className="button secondary"
                      href={"/admin/orders/new?draft=" + d.id}
                    >
                      Mở nháp
                    </Link>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm("Lưu trữ nháp này?")) return;
                        setBusy(true);
                        try {
                          await api(
                            "workspace/order-drafts/" + d.id + "/archive",
                            "POST",
                            { version: d.version },
                          );
                          setDrafts(
                            await api("workspace/order-drafts?page=" + page),
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Lưu trữ
                    </button>
                  </div>
                </div>
              );
            })
          )}
          <div className="button-row">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ←
            </button>
            <span>Trang {page}</span>
            <button
              disabled={!drafts || page * 20 >= drafts.total}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
          </div>
        </section>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void (quote ? create() : review());
          }}
        >
          <fieldset disabled={busy} className="manual-fieldset">
            <div className="manual-grid">
              <div className="manual-main">
                {draft && (
                  <p className="small">
                    Đang sửa nháp #{draft.id} · Phiên bản {draft.version}
                  </p>
                )}
                {block(
                  "1. Khách hàng",
                  <>
                    <Field label="Tìm khách trong CRM">
                      <input
                        placeholder="Tên, số điện thoại hoặc email"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                      />
                    </Field>
                    {customers.length > 0 && (
                      <div
                        className="manual-results"
                        aria-label="Khách hàng gợi ý"
                      >
                        {customers.map((c) => (
                          <button
                            type="button"
                            key={c.id}
                            onClick={() =>
                              change({
                                customerId: c.id,
                                customerName: c.name,
                                email: c.email || "",
                                phone: c.phone || "",
                                separateContact: false,
                              })
                            }
                          >
                            <strong>{c.name}</strong>
                            <small>
                              {c.phone} {c.email ? " · " + c.email : ""}
                            </small>
                          </button>
                        ))}
                      </div>
                    )}
                    {form.customerId && (
                      <p className="small">
                        Đã chọn hồ sơ CRM #{form.customerId}. Thay đổi bên dưới
                        chỉ áp dụng cho đơn này.{" "}
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => change({ customerId: null })}
                        >
                          Bỏ liên kết
                        </button>
                      </p>
                    )}
                    <div className="form-grid">
                      {textField("customerName", "Tên người đặt", {
                        required: true,
                        minLength: 2,
                        maxLength: 100,
                      })}
                      {textField("phone", "Số điện thoại người đặt", {
                        required: true,
                        type: "tel",
                        maxLength: 20,
                      })}
                      {textField("email", "Email (tùy chọn)", {
                        type: "email",
                        maxLength: 190,
                      })}
                      <Field label="Kênh tiếp nhận">
                        <select
                          value={form.salesChannel}
                          onChange={(e) =>
                            change({ salesChannel: e.target.value })
                          }
                        >
                          {Object.entries(channels).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    {!form.customerId && (
                      <label className="manual-check">
                        <input
                          type="checkbox"
                          checked={form.separateContact}
                          onChange={(e) =>
                            change({ separateContact: e.target.checked })
                          }
                        />
                        Số điện thoại dùng chung; tạo hồ sơ riêng nếu trùng số.
                      </label>
                    )}
                    <p className="small">
                      Không tự tạo tài khoản hoặc cấp đồng ý nhận marketing cho
                      khách.
                    </p>
                  </>,
                )}
                {block(
                  "2. Sản phẩm & thiết kế",
                  <>
                    <Field label="Tìm sản phẩm">
                      <input
                        placeholder="Tên thiết kế…"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                      />
                    </Field>
                    <div className="manual-results manual-product-results">
                      {products.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          disabled={p.stock < 1 || form.items.length >= 30}
                          onClick={() =>
                            change({
                              items: [
                                ...form.items,
                                {
                                  type: "catalog",
                                  productId: p.id,
                                  name: p.name,
                                  image: p.image,
                                  quantity: 1,
                                  size: "S",
                                },
                              ],
                            })
                          }
                        >
                          {p.image && <img src={p.image} alt="" />}
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {money(p.price)} · Tồn {p.stock}
                            </small>
                          </span>
                          <Plus size={16} />
                        </button>
                      ))}
                    </div>
                    {form.items.map((i: any, index: number) => (
                      <div className="manual-line" key={index}>
                        <div className="flex-between">
                          <strong>
                            {i.type === "catalog" ? i.name : "Thiết kế riêng"}
                          </strong>
                          <button
                            type="button"
                            aria-label={"Xóa dòng " + (index + 1)}
                            onClick={() =>
                              change({
                                items: form.items.filter(
                                  (_: any, n: number) => n !== index,
                                ),
                              })
                            }
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                        {i.type === "custom" && (
                          <>
                            <Field label="Tên thiết kế riêng">
                              <input
                                value={i.name}
                                required
                                maxLength={160}
                                onChange={(e) =>
                                  itemChange(index, { name: e.target.value })
                                }
                              />
                            </Field>
                            <Field label="Yêu cầu thiết kế">
                              <textarea
                                maxLength={1000}
                                value={i.description || ""}
                                onChange={(e) =>
                                  itemChange(index, {
                                    description: e.target.value,
                                  })
                                }
                              />
                            </Field>
                            <div className="manual-field">
                              <span>Ảnh tham khảo (tùy chọn)</span>
                              <label className="manual-upload">
                                <input
                                  type="file"
                                  aria-label="Ảnh tham khảo (tùy chọn)"
                                  accept="image/jpeg,image/png,image/webp"
                                  disabled={busy}
                                  onChange={(e) => {
                                    void upload(index, e.target.files?.[0]);
                                    e.target.value = "";
                                  }}
                                />
                                {i.image ? (
                                  <img
                                    className="manual-reference"
                                    src={i.image}
                                    alt="Ảnh tham khảo thiết kế"
                                  />
                                ) : (
                                  <span className="manual-upload-icon">
                                    <ImagePlus size={24} aria-hidden="true" />
                                  </span>
                                )}
                                <span className="manual-upload-copy">
                                  <strong>
                                    {i.image
                                      ? "Thay ảnh tham khảo"
                                      : "Chọn ảnh tham khảo"}
                                  </strong>
                                  <small>
                                    JPG, PNG hoặc WebP · Tối đa 4 MB
                                  </small>
                                </span>
                              </label>
                              {i.image && (
                                <button
                                  className="text-button manual-upload-remove"
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    itemChange(index, { image: "" })
                                  }
                                >
                                  <Trash2 size={14} aria-hidden="true" /> Xóa
                                  ảnh tham khảo
                                </button>
                              )}
                            </div>
                            <small>
                              Thiết kế riêng chưa theo dõi tồn nguyên liệu.
                            </small>
                          </>
                        )}
                        <div className="manual-line-fields">
                          <Field label="Số lượng">
                            <input
                              type="number"
                              min={1}
                              max={30}
                              required
                              value={i.quantity}
                              onChange={(e) =>
                                itemChange(index, {
                                  quantity: Number(e.target.value),
                                })
                              }
                            />
                          </Field>
                          <Field label="Kích cỡ">
                            <select
                              value={i.size}
                              onChange={(e) =>
                                itemChange(index, { size: e.target.value })
                              }
                            >
                              {["S", "M", "L"].map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </Field>
                          {(i.type === "custom" || cap.adjust) && (
                            <Field
                              label={
                                i.type === "custom"
                                  ? "Đơn giá (đ)"
                                  : "Giá riêng (đ, tùy chọn)"
                              }
                            >
                              <input
                                type="number"
                                min={0}
                                max={100000000}
                                required={i.type === "custom"}
                                value={i.price ?? ""}
                                onChange={(e) =>
                                  itemChange(index, {
                                    price:
                                      e.target.value === ""
                                        ? undefined
                                        : Number(e.target.value),
                                  })
                                }
                              />
                            </Field>
                          )}
                        </div>
                        {i.price !== undefined &&
                          (i.type === "catalog" || i.price === 0) && (
                            <Field label="Lý do điều chỉnh / miễn phí">
                              <input
                                value={i.reason || ""}
                                minLength={5}
                                required
                                onChange={(e) =>
                                  itemChange(index, { reason: e.target.value })
                                }
                              />
                            </Field>
                          )}
                      </div>
                    ))}
                    {!form.items.length && (
                      <p className="small">
                        Chọn sản phẩm bên trên hoặc thêm bó hoa thiết kế riêng.
                      </p>
                    )}
                    <button
                      className="button secondary"
                      type="button"
                      disabled={form.items.length >= 30}
                      onClick={() =>
                        change({
                          items: [
                            ...form.items,
                            {
                              type: "custom",
                              name: "",
                              description: "",
                              image: "",
                              quantity: 1,
                              size: "S",
                              price: 0,
                              reason: "",
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={16} /> Thêm thiết kế riêng
                    </button>
                  </>,
                )}
                {block(
                  "3. Giao hoa & lời nhắn",
                  <>
                    <div className="manual-mode">
                      {[
                        ["gift", "Gửi hoa tới người khách thương"],
                        ["self", "Giao cho khách"],
                      ].map(([value, label]) => (
                        <label key={value}>
                          <input
                            type="radio"
                            name="deliveryMode"
                            checked={form.deliveryMode === value}
                            onChange={() => change({ deliveryMode: value })}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="form-grid">
                      {form.deliveryMode === "gift" && (
                        <>
                          {textField("recipientName", "Tên người nhận", {
                            required: true,
                            minLength: 2,
                            maxLength: 100,
                          })}
                          {textField(
                            "recipientPhone",
                            "Điện thoại người nhận",
                            { required: true, type: "tel", maxLength: 20 },
                          )}
                        </>
                      )}
                      {textField("deliveryDate", "Ngày giao hoa", {
                        type: "date",
                        required: true,
                      })}
                      <Field label="Khung giờ">
                        <select
                          required
                          value={form.deliverySlot}
                          onChange={(e) =>
                            change({ deliverySlot: e.target.value })
                          }
                        >
                          <option value="">Chọn khung giờ</option>
                          {options.settings.slots.map((s: string) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    {textField("address", "Địa chỉ giao hoa", {
                      required: true,
                      minLength: 10,
                      maxLength: 500,
                    })}
                    {options.requiresCoordinates && (
                      <>
                        <p className="small">
                          Store có giới hạn vùng giao. Nhập tọa độ địa chỉ nhận
                          để kiểm tra bán kính.
                        </p>
                        <div className="form-grid">
                          {textField("deliveryLat", "Vĩ độ", {
                            type: "number",
                            step: "any",
                            min: -90,
                            max: 90,
                            required: true,
                          })}
                          {textField("deliveryLng", "Kinh độ", {
                            type: "number",
                            step: "any",
                            min: -180,
                            max: 180,
                            required: true,
                          })}
                        </div>
                      </>
                    )}
                    <Field label="Lời nhắn trên thiệp (tùy chọn)">
                      <textarea
                        maxLength={500}
                        value={form.message}
                        onChange={(e) => change({ message: e.target.value })}
                      />
                    </Field>
                    <Field label="Ghi chú giao hàng">
                      <textarea
                        maxLength={1000}
                        value={form.notes}
                        onChange={(e) => change({ notes: e.target.value })}
                      />
                    </Field>
                  </>,
                )}
                {block(
                  "4. Giá & thanh toán",
                  <>
                    <div className="form-grid">
                      {textField("code", "Mã khuyến mãi", { maxLength: 40 })}
                      {cap.adjust && (
                        <>
                          <Field label="Giảm giá thủ công">
                            <select
                              value={form.discountType}
                              onChange={(e) =>
                                change({
                                  discountType: e.target.value,
                                  discountValue: 0,
                                })
                              }
                            >
                              <option value="none">Không giảm thêm</option>
                              <option value="amount">Số tiền (đ)</option>
                              <option value="percent">Phần trăm (%)</option>
                            </select>
                          </Field>
                          {form.discountType !== "none" &&
                            textField("discountValue", "Giá trị giảm", {
                              type: "number",
                              min: 0,
                              max:
                                form.discountType === "percent"
                                  ? 100
                                  : 100000000,
                            })}
                          {textField("shipping", "Phí giao riêng (đ)", {
                            type: "number",
                            min: 0,
                            max: 100000000,
                            placeholder: "Để trống: 0 đ",
                          })}
                        </>
                      )}
                    </div>
                    {(form.discountType !== "none" ||
                      form.shipping !== undefined) &&
                      textField(
                        "adjustmentReason",
                        "Lý do giảm giá / sửa phí giao",
                        { maxLength: 500, placeholder: "Không bắt buộc" },
                      )}
                    <Field label="Trạng thái thanh toán">
                      <select
                        disabled={!cap.collect}
                        value={paymentStatus}
                        onChange={(e) => selectPayment(e.target.value)}
                        aria-describedby="manual-payment-status-help"
                      >
                        <option value="unpaid">{orderLabels.unpaid}</option>
                        <option value="partially_paid">
                          Thanh toán một phần
                        </option>
                        <option value="paid">{orderLabels.paid}</option>
                      </select>
                    </Field>
                    <p id="manual-payment-status-help" className="small">
                      Chọn trạng thái để điền số tiền, hoặc nhập số tiền đã nhận
                      để tự cập nhật trạng thái. Đã thanh toán dùng tổng đơn sau
                      giảm giá và phí giao.
                    </p>
                    {cap.collect && (
                      <p className="small" role="status" aria-live="polite">
                        {priceError
                          ? "Chưa tính được tổng đơn: " + priceError
                          : currentTotal !== undefined
                            ? "Tổng khách cần thanh toán: " +
                              money(currentTotal)
                            : form.items.length
                              ? "Đang tính tổng đơn…"
                              : "Thêm sản phẩm để tính tổng đơn."}
                      </p>
                    )}
                    {cap.collect ? (
                      <>
                        <div className="form-grid">
                          {textField(
                            "collectAmount",
                            "Số tiền thực tế đã nhận (đ)",
                            {
                              type: "number",
                              required: paymentMode === "partially_paid",
                              min: paymentMode === "partially_paid" ? 1 : 0,
                              max: Math.min(
                                currentTotal ?? 100000000,
                                100000000,
                              ),
                              step: 1,
                            },
                          )}
                          <Field label="Phương thức đã nhận">
                            <select
                              value={form.collectMethod}
                              onChange={(e) =>
                                change({ collectMethod: e.target.value })
                              }
                            >
                              <option value="cash">Tiền mặt</option>
                              <option value="bank">Chuyển khoản</option>
                            </select>
                          </Field>
                        </div>
                        {form.collectAmount > 0 && (
                          <>
                            {textField(
                              "paymentReference",
                              "Mã tham chiếu / biên nhận",
                              {
                                minLength: 5,
                                maxLength: 100,
                                placeholder: "Để trống để tự tạo khi lưu đơn",
                              },
                            )}
                            <Field label="Thời điểm nhận tiền (bỏ trống: hiện tại)">
                              <input
                                type="datetime-local"
                                value={
                                  form.receivedAt
                                    ? new Date(
                                        Date.parse(form.receivedAt) -
                                          new Date(
                                            form.receivedAt,
                                          ).getTimezoneOffset() *
                                            60000,
                                      )
                                        .toISOString()
                                        .slice(0, 16)
                                    : ""
                                }
                                onChange={(e) =>
                                  change({
                                    receivedAt: e.target.value
                                      ? new Date(e.target.value).toISOString()
                                      : undefined,
                                  })
                                }
                              />
                            </Field>
                            <p className="small">
                              Ghi nhận tiền store đã nhận. Hệ thống không tự xác
                              minh giao dịch ngân hàng. Mã biên nhận nội bộ sẽ
                              tự tạo nếu để trống, cho cả tiền mặt và chuyển
                              khoản.
                            </p>
                          </>
                        )}
                      </>
                    ) : (
                      <p className="small">
                        Đơn được tạo ở trạng thái chưa thu. Chủ store có thể ghi
                        nhận cọc/thu tiền sau.
                      </p>
                    )}
                  </>,
                )}
                {block(
                  "5. Nội bộ store",
                  <>
                    <div className="form-grid">
                      <Field label="Người phụ trách">
                        <select
                          value={form.assignedTo || ""}
                          onChange={(e) =>
                            change({
                              assignedTo: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        >
                          <option value="">Chưa phân công</option>
                          {options.staff.map((s: any) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Trạng thái ban đầu">
                        <select
                          value={form.initialStatus}
                          onChange={(e) =>
                            change({ initialStatus: e.target.value })
                          }
                        >
                          <option value="pending">Chờ xác nhận</option>
                          {cap.confirm && (
                            <option value="confirmed">Đã xác nhận</option>
                          )}
                        </select>
                      </Field>
                    </div>
                    <Field label="Nhãn (phân cách bằng dấu phẩy, tối đa 6)">
                      <input
                        value={form.tags.join(",")}
                        onChange={(e) =>
                          change({
                            tags: e.target.value.split(",").slice(0, 6),
                          })
                        }
                        onBlur={() =>
                          change({
                            tags: form.tags
                              .map((s: string) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                    <Field label="Ghi chú nội bộ — khách không nhìn thấy">
                      <textarea
                        maxLength={2000}
                        value={form.internalNotes}
                        onChange={(e) =>
                          change({ internalNotes: e.target.value })
                        }
                      />
                    </Field>
                  </>,
                )}
              </div>
              <aside className="manual-summary panel">
                <h2>{quote ? "Rà soát đơn hàng" : "Tổng kết đơn"}</h2>
                <p>
                  {form.items.length} dòng hàng · {channels[form.salesChannel]}
                </p>
                {quote ? (
                  <>
                    {quote.items.map((i: any, n: number) => (
                      <p className="flex-between" key={n}>
                        <span>
                          {i.name} × {i.quantity}
                        </span>
                        <strong>{money(i.price * i.quantity)}</strong>
                      </p>
                    ))}
                    <hr />
                    <p className="flex-between">
                      <span>Tiền hàng</span>
                      <strong>{money(quote.subtotal)}</strong>
                    </p>
                    <p className="flex-between">
                      <span>Giảm giá</span>
                      <strong>−{money(quote.discount)}</strong>
                    </p>
                    <p className="flex-between">
                      <span>Giao hoa</span>
                      <strong>{money(quote.shipping)}</strong>
                    </p>
                    <p className="flex-between manual-total">
                      <span>Tổng đơn</span>
                      <strong>{money(quote.total)}</strong>
                    </p>
                    <p className="flex-between">
                      <span>Đã nhận</span>
                      <strong>{money(form.collectAmount)}</strong>
                    </p>
                    <p className="flex-between">
                      <span>Còn phải thu</span>
                      <strong>{money(quote.total - form.collectAmount)}</strong>
                    </p>
                    <hr />
                    <p>
                      <strong>{form.customerName}</strong>
                      <br />
                      {form.phone}
                    </p>
                    <p>
                      {form.deliveryDate} · {form.deliverySlot}
                      <br />
                      {form.address}
                    </p>
                    <p className="small">
                      {form.email
                        ? "Gửi email xác nhận đến " + form.email
                        : "Không gửi email: khách chưa cung cấp email."}
                    </p>
                  </>
                ) : (
                  <p className="small">
                    Hoàn tất thông tin và tính giá để kiểm tra trước khi tạo.
                    Nháp chưa giữ kho hoặc lịch giao.
                  </p>
                )}
                <div className="manual-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void saveDraft()}
                  >
                    Lưu nháp
                  </button>
                  <button className="button" type="submit">
                    {busy ? (
                      "Đang xử lý…"
                    ) : quote ? (
                      <>
                        <Check size={16} />{" "}
                        {form.initialStatus === "confirmed"
                          ? "Tạo và xác nhận"
                          : "Tạo đơn hàng"}
                      </>
                    ) : (
                      "Tính giá & rà soát"
                    )}
                  </button>
                </div>
                {quote && (
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => setQuote(null)}
                  >
                    Quay lại chỉnh thông tin
                  </button>
                )}
              </aside>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
