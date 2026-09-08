"use client";
import Link from "next/link";
import FlowerImage from "./flower-image";
import ProductGallery from "./product-gallery";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Heart,
  Minus,
  Plus,
  Trash2,
  Search,
  SlidersHorizontal,
  Check,
  Truck,
  Gift,
  Flower2,
  ShoppingBag,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import type { Catalog, Product } from "@/lib/types";
import { api, useShop } from "./context";
import { ProductCard, money } from "./home";
export function Breadcrumb({ title }: { title: string }) {
  return (
    <div className="breadcrumb">
      <Link href="/">Trang chủ</Link>
      <ChevronRight size={13} />
      <span>{title}</span>
    </div>
  );
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty">
      <Flower2 size={50} />
      <h2>{title}</h2>
      <p>{description}</p>
      <Link href="/shop" className="button">
        Khám phá hoa <ArrowUpRight size={18} />
      </Link>
    </div>
  );
}
export function Shop({ data }: { data: Catalog }) {
  const params = useSearchParams();
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(params.get("category") || ""),
    [sort, setSort] = useState("featured"),
    [budget, setBudget] = useState(""),
    [occasion, setOccasion] = useState(params.get("occasion") || "");
  useEffect(() => {
    setCategory(params.get("category") || "");
    setOccasion(params.get("occasion") || "");
  }, [params]);
  let products = data.products.filter(
    (p) =>
      (!category || p.category_id === Number(category)) &&
      (!search ||
        (p.name + " " + p.flowers + " " + p.category)
          .toLocaleLowerCase("vi")
          .includes(search.toLocaleLowerCase("vi"))) &&
      (!budget ||
        (budget === "low"
          ? p.price < 600000
          : budget === "mid"
            ? p.price >= 600000 && p.price <= 1000000
            : p.price > 1000000)) &&
      (!occasion ||
        (occasion === "sinh-nhat"
          ? [1, 3].includes(p.category_id)
          : occasion === "ky-niem"
            ? p.category_id === 1
            : p.category_id === 4)),
  );
  products = [...products].sort((a, b) =>
    sort === "price-up"
      ? a.price - b.price
      : sort === "price-down"
        ? b.price - a.price
        : sort === "new"
          ? b.id - a.id
          : a.id - b.id,
  );
  return (
    <main className="page">
      <Breadcrumb title="Khám phá hoa" />
      <div className="page-heading">
        <span className="eyebrow">FLOWERS, FOR YOU</span>
        <h1>Mỗi bó hoa. Một lời thương.</h1>
        <p>Tìm một chút đẹp đẽ cho người bạn yêu quý. Kể cả chính mình.</p>
      </div>
      <div className="shop-tools">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Tìm tên hoa"
            placeholder="Tìm tên hoa, loài hoa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus={params.has("search")}
          />
        </label>
        <div className="filters">
          <select
            aria-label="Dịp tặng hoa"
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
          >
            <option value="">Mọi dịp</option>
            <option value="sinh-nhat">Sinh nhật</option>
            <option value="ky-niem">Kỷ niệm</option>
            <option value="su-kien">Sự kiện</option>
          </select>
          <select
            aria-label="Khoảng giá"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          >
            <option value="">Mọi mức giá</option>
            <option value="low">Dưới 600.000 ₫</option>
            <option value="mid">600.000–1.000.000 ₫</option>
            <option value="high">Trên 1.000.000 ₫</option>
          </select>
          <select
            aria-label="Sắp xếp"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="featured">Được yêu thích</option>
            <option value="new">Mới nhất</option>
            <option value="price-up">Giá tăng dần</option>
            <option value="price-down">Giá giảm dần</option>
          </select>
        </div>
      </div>
      <div className="category-pills">
        <button
          className={!category ? "active" : ""}
          onClick={() => setCategory("")}
        >
          Tất cả
        </button>
        {data.categories.map((c) => (
          <button
            className={category === String(c.id) ? "active" : ""}
            onClick={() => setCategory(String(c.id))}
            key={c.id}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="result-count">
        {products.length} thiết kế hoa{" "}
        <button
          className="text-button"
          onClick={() => {
            setSearch("");
            setCategory("");
            setBudget("");
            setOccasion("");
            setSort("featured");
          }}
        >
          Xoá bộ lọc
        </button>
      </div>
      {products.length ? (
        <div className="product-grid">
          {products.map((p) => (
            <ProductCard p={p} key={p.id} />
          ))}
        </div>
      ) : (
        <Empty
          title="Chưa tìm thấy bó hoa phù hợp."
          description="Thử tìm loài hoa khác hoặc thay đổi bộ lọc của bạn."
        />
      )}
    </main>
  );
}
export function ProductDetail({ data, slug }: { data: Catalog; slug: string }) {
  const { add, wishlist, toggleWish, cart } = useShop();
  const [size, setSize] = useState("S"),
    [quantity, setQuantity] = useState(1);
  const p = data.products.find((x) => x.slug === slug);
  if (!p)
    return (
      <Empty
        title="Bó hoa chưa được tìm thấy."
        description="Khám phá những thiết kế khác đang có tại Fleur."
      />
    );
  const price = Math.round(p.price * ({ S: 1, M: 1.3, L: 1.6 }[size] || 1));
  const canAdd =
    p.stock >=
    quantity +
      cart
        .filter((i) => i.productId === p.id)
        .reduce((s, i) => s + i.quantity, 0);
  return (
    <main className="page">
      <Breadcrumb title={p.name} />
      <div className="detail-layout">
        <ProductGallery key={p.id} product={p} />
        <div className="detail-info">
          <span className="eyebrow">{p.category} / FLEUR SIGNATURE</span>
          <h1>{p.name}</h1>
          <p className="detail-flowers">{p.flowers}</p>
          <div className="detail-price">
            {money(price)}
            {p.compare_price && p.compare_price > price ? (
              <del>{money(p.compare_price)}</del>
            ) : null}
          </div>
          <p>{p.description}</p>
          <div className="option-header">
            Kích thước <span>Mỗi thiết kế đều được làm thủ công</span>
          </div>
          <div className="size-options">
            {[
              ["S", "Tinh tế", "Tiêu chuẩn"],
              ["M", "Đầy đặn", "+30% hoa"],
              ["L", "Ấn tượng", "+60% hoa"],
            ].map(([s, label, caption]) => (
              <button
                key={s}
                className={size === s ? "active" : ""}
                onClick={() => setSize(s)}
              >
                <strong>
                  {s} · {label}
                </strong>
                <small>{caption}</small>
              </button>
            ))}
          </div>
          <div className="stock">
            {p.stock > 0 ? (
              <>
                <span />
                Có sẵn · {p.stock} thiết kế có thể đặt
              </>
            ) : (
              "Tạm hết hoa — vui lòng quay lại sau"
            )}
          </div>
          <div className="purchase-row">
            <div className="quantity">
              <button
                aria-label="Giảm số lượng"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >
                <Minus size={16} />
              </button>
              <span>{quantity}</span>
              <button
                aria-label="Tăng số lượng"
                disabled={quantity >= p.stock || quantity >= 30}
                onClick={() => setQuantity(quantity + 1)}
              >
                <Plus size={16} />
              </button>
            </div>
            <button
              className="button"
              disabled={!canAdd}
              onClick={() => add(p.id, quantity, size)}
            >
              Thêm vào giỏ <ShoppingBag size={18} />
            </button>
            <button
              className={
                "wish-button " + (wishlist.includes(p.id) ? "active" : "")
              }
              aria-label="Lưu hoa yêu thích"
              onClick={() => toggleWish(p.id)}
            >
              <Heart
                fill={wishlist.includes(p.id) ? "currentColor" : "none"}
                size={20}
              />
            </button>
          </div>
          <div className="detail-perks">
            <span>
              <Truck />
              Giao theo khung giờ bạn chọn
            </span>
            <span>
              <Gift />
              Thiệp viết tay & gói quà miễn phí
            </span>
          </div>
          <details open>
            <summary>Chăm sóc hoa</summary>
            <p>{p.care}</p>
          </details>
          <details>
            <summary>Giao hàng & cam kết</summary>
            <p>
              Giao hàng trong khu vực TP. Hà Nội, phí 35.000 ₫; miễn phí từ
              1.000.000 ₫. Chọn ngày và khung giờ tại bước thanh toán. Nếu hoa
              hư hỏng khi nhận, gửi yêu cầu trong 24 giờ để Fleur hỗ trợ.
            </p>
          </details>
        </div>
      </div>
      <section className="related">
        <div className="section-heading">
          <h2>Có thể bạn cũng yêu.</h2>
          <Link className="text-link" href="/shop">
            Xem tất cả <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="product-grid">
          {data.products
            .filter((x) => x.id !== p.id)
            .slice(0, 4)
            .map((p) => (
              <ProductCard p={p} key={p.id} />
            ))}
        </div>
      </section>
    </main>
  );
}
export function Wishlist({ data }: { data: Catalog }) {
  const { wishlist } = useShop();
  const products = data.products.filter((p) => wishlist.includes(p.id));
  return (
    <main className="page">
      <Breadcrumb title="Hoa yêu thích" />
      <div className="page-heading">
        <span className="eyebrow">SAVED WITH LOVE</span>
        <h1>Những bó hoa bạn yêu.</h1>
        <p>Lưu một chút đẹp đẽ cho lần gửi trao tiếp theo.</p>
      </div>
      {products.length ? (
        <div className="product-grid">
          {products.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <Empty
          title="Một chỗ dành cho hoa bạn yêu."
          description="Chạm vào trái tim ở trang sản phẩm để lưu thiết kế yêu thích."
        />
      )}
    </main>
  );
}
function Totals({ quote }: { quote: any }) {
  return (
    <>
      <div className="total-row">
        <span>Tạm tính</span>
        <span>{money(quote.subtotal)}</span>
      </div>
      <div className="total-row">
        <span>Giao hàng</span>
        <span>{quote.shipping ? money(quote.shipping) : "Miễn phí"}</span>
      </div>
      {quote.discount > 0 && (
        <div className="total-row">
          <span>Ưu đãi</span>
          <span>−{money(quote.discount)}</span>
        </div>
      )}
      <div className="total-row grand-total">
        <span>Tổng cộng</span>
        <strong>{money(quote.total)}</strong>
      </div>
    </>
  );
}
export function Cart({ data }: { data: Catalog }) {
  const { cart, setCart, ready } = useShop();
  const [code, setCode] = useState(""),
    [quote, setQuote] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const items = cart.map((i) => ({
    ...i,
    p: data.products.find((p) => p.id === i.productId),
  }));
  const refresh = async (promo = "") => {
    if (!cart.length) {
      setQuote(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setQuote(
        await api("checkout/quote", "POST", { items: cart, code: promo }),
      );
      sessionStorage.setItem("fleur.promo", promo);
    } catch (e) {
      setQuote(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh("");
  }, [cart]);
  if (!ready)
    return (
      <main className="page">
        <p>Đang mở giỏ hoa...</p>
      </main>
    );
  return (
    <main className="page">
      <Breadcrumb title="Giỏ hàng" />
      <div className="page-heading">
        <span className="eyebrow">YOUR LITTLE HAPPINESS</span>
        <h1>Giỏ hoa của bạn.</h1>
        <p>
          {cart.reduce((s, i) => s + i.quantity, 0)} món quà đang đợi được gửi
          trao.
        </p>
      </div>
      {cart.length ? (
        <div className="checkout-layout">
          <div>
            <div className="cart-table-head">
              <span>Sản phẩm</span>
              <span>Số lượng & giá</span>
            </div>
            {items.map((i, idx) => (
              <div className="cart-item" key={i.productId + i.size}>
                {i.p ? (
                  <>
                    <Link href={"/product/" + i.p.slug}>
                      <FlowerImage
                        src={i.p.image}
                        alt={i.p.name}
                        sizes="80px"
                      />
                    </Link>
                    <div className="cart-item-info">
                      <p>{i.p.category}</p>
                      <Link href={"/product/" + i.p.slug}>
                        <h3>{i.p.name}</h3>
                      </Link>
                      <small>Kích thước {i.size}</small>
                      <button
                        className="text-button"
                        onClick={() =>
                          setCart(cart.filter((_, n) => n !== idx))
                        }
                      >
                        <Trash2 size={13} /> Xoá
                      </button>
                    </div>
                    <div className="cart-item-end">
                      <strong>
                        {money(
                          Math.round(
                            i.p.price * ({ S: 1, M: 1.3, L: 1.6 }[i.size] || 1),
                          ) * i.quantity,
                        )}
                      </strong>
                      <div className="quantity">
                        <button
                          aria-label="Giảm số lượng"
                          onClick={() =>
                            setCart(
                              cart.map((c, n) =>
                                n === idx
                                  ? {
                                      ...c,
                                      quantity: Math.max(1, c.quantity - 1),
                                    }
                                  : c,
                              ),
                            )
                          }
                        >
                          <Minus size={15} />
                        </button>
                        <span>{i.quantity}</span>
                        <button
                          aria-label="Tăng số lượng"
                          disabled={i.quantity >= Math.min(i.p.stock, 30)}
                          onClick={() =>
                            setCart(
                              cart.map((c, n) =>
                                n === idx
                                  ? { ...c, quantity: c.quantity + 1 }
                                  : c,
                              ),
                            )
                          }
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p>Sản phẩm không còn được bán.</p>
                    <button
                      className="text-button"
                      onClick={() => setCart(cart.filter((_, n) => n !== idx))}
                    >
                      Xoá
                    </button>
                  </>
                )}
              </div>
            ))}
            <Link className="text-link" href="/shop">
              Tiếp tục chọn hoa <ArrowUpRight size={16} />
            </Link>
          </div>
          <aside className="order-summary">
            <h3>Tóm tắt đơn hàng</h3>
            <p className="small">
              Ưu đãi chào bạn mới: HELLOFLEUR giảm 10% cho đơn từ 400.000 ₫.
            </p>
            <form
              className="coupon"
              onSubmit={(e) => {
                e.preventDefault();
                void refresh(code);
              }}
            >
              <input
                aria-label="Mã ưu đãi"
                placeholder="Mã ưu đãi"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button disabled={busy}>Áp dụng</button>
            </form>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {quote && <Totals quote={quote} />}
            <Link
              className={"button full " + (!quote || busy ? "disabled" : "")}
              aria-disabled={!quote || busy}
              href={quote && !busy ? "/checkout" : "#"}
            >
              Tiến hành đặt hoa <ArrowRight size={18} />
            </Link>
            <div className="secure-note">
              <Truck size={16} /> Giao miễn phí từ 1.000.000 ₫
            </div>
          </aside>
        </div>
      ) : (
        <Empty
          title="Giỏ hoa đang chờ bạn."
          description="Chọn một bó hoa để bắt đầu gửi lời thương."
        />
      )}
    </main>
  );
}
export function Checkout({ data }: { data: Catalog }) {
  const { cart, setCart, user, ready } = useShop();
  const [quote, setQuote] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState<any>(null);
  const [deliveryMode, setDeliveryMode] = useState<"self" | "gift">("self");
  const [buyerName, setBuyerName] = useState<string | null>(null);
  const [buyerPhone, setBuyerPhone] = useState<string | null>(null);
  const [selfAddress, setSelfAddress] = useState<string | null>(null);
  const [giftName, setGiftName] = useState("");
  const [giftPhone, setGiftPhone] = useState("");
  const [giftAddress, setGiftAddress] = useState("");
  const customerName = buyerName ?? user?.name ?? "";
  const customerPhone = buyerPhone ?? user?.phone ?? "";
  const receivingSelf = deliveryMode === "self";
  const key = useRef("");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  useEffect(() => {
    if (!key.current) key.current = crypto.randomUUID();
    if (cart.length)
      api("checkout/quote", "POST", {
        items: cart,
        code: sessionStorage.getItem("fleur.promo") || "",
      })
        .then(setQuote)
        .catch((e) => setError(e.message));
  }, [cart]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (receivingSelf) {
      f.recipientName = f.customerName;
      f.recipientPhone = f.phone;
    }
    try {
      const result = await api("checkout", "POST", {
        ...f,
        items: cart,
        code: sessionStorage.getItem("fleur.promo") || "",
        consent: f.consent === "on",
        idempotencyKey: key.current,
        paymentMethod: "cod",
      });
      setSuccess({ ...result, email: f.email });
      setCart([]);
      sessionStorage.removeItem("fleur.promo");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (success)
    return (
      <main className="page">
        <div className="success-card">
          <span className="success-icon">
            <Check size={32} />
          </span>
          <span className="eyebrow">THANK YOU, WITH LOVE</span>
          <h1>Lời thương đã được gửi.</h1>
          <p>
            Fleur đã nhận đơn <strong>{success.reference}</strong>.<br />
            Đơn đang chờ cửa hàng xác nhận và sẽ được chuẩn bị theo lịch bạn
            chọn.
          </p>
          <div className="notice">
            Thanh toán khi nhận hoa ·{" "}
            {money(success.total || quote?.total || 0)}
            <br />
            Vui lòng lưu mã đơn để tra cứu. Thông báo email chưa được cấu hình.
          </div>
          <Link
            className="button"
            href={
              "/track-order?reference=" +
              success.reference +
              "&email=" +
              encodeURIComponent(success.email)
            }
          >
            Theo dõi đơn hàng <ArrowRight size={18} />
          </Link>
        </div>
      </main>
    );
  if (!ready) return <main className="page">Đang tải thông tin...</main>;
  if (!cart.length)
    return (
      <main className="page">
        <Empty
          title="Bạn chưa chọn hoa."
          description="Thêm một thiết kế vào giỏ trước khi đặt hàng."
        />
      </main>
    );
  return (
    <main className="page">
      <Breadcrumb title="Thanh toán" />
      <div className="page-heading">
        <span className="eyebrow">ONE STEP CLOSER</span>
        <h1>Gửi hoa. Gửi cả tấm lòng.</h1>
      </div>
      <form className="checkout-layout" onSubmit={submit}>
        <div className="checkout-form">
          {!user && (
            <div className="notice">
              Bạn đã có tài khoản?{" "}
              <Link href="/login?next=/checkout">Đăng nhập</Link> để theo dõi
              đơn dễ dàng hơn.
            </div>
          )}
          <section className="form-section">
            <h3>
              <span>01</span> Thông tin người đặt
            </h3>
            <div className="form-grid">
              <Field
                label="Họ và tên"
                name="customerName"
                required
                value={customerName}
                onChange={(e) => setBuyerName(e.target.value)}
              />
              <Field
                label="Số điện thoại"
                name="phone"
                type="tel"
                required
                pattern="[+0-9 ()-]{9,20}"
                value={customerPhone}
                onChange={(e) => setBuyerPhone(e.target.value)}
              />
              <Field
                label="Email"
                name="email"
                type="email"
                required
                defaultValue={user?.email}
                readOnly={!!user}
              />
            </div>
          </section>
          <section className="form-section">
            <h3>
              <span>02</span> Thông tin giao hoa
            </h3>
            <fieldset
              className="recipient-options"
              aria-label="Chọn người nhận hoa"
            >
              <label
                className={
                  "recipient-option" + (receivingSelf ? " selected" : "")
                }
              >
                <input
                  type="radio"
                  name="deliveryMode"
                  value="self"
                  checked={receivingSelf}
                  onChange={() => setDeliveryMode("self")}
                />
                <span>
                  <strong>Giao cho tôi</strong>
                  <span>Một chút hoa dành cho chính mình.</span>
                </span>
              </label>
              <label
                className={
                  "recipient-option" + (!receivingSelf ? " selected" : "")
                }
              >
                <input
                  type="radio"
                  name="deliveryMode"
                  value="gift"
                  checked={!receivingSelf}
                  onChange={() => setDeliveryMode("gift")}
                />
                <span>
                  <strong>Gửi đến người bạn thương</strong>
                  <span>Gửi hoa cùng những lời nhắn yêu thương.</span>
                </span>
              </label>
            </fieldset>
            {receivingSelf && (
              <p className="recipient-help">
                Tên và số điện thoại người nhận được lấy từ bước 1. Bạn có thể
                thay đổi địa chỉ giao bên dưới.
              </p>
            )}
            <div className="form-grid">
              {!receivingSelf && (
                <>
                  <Field
                    label="Tên người nhận"
                    name="recipientName"
                    required
                    value={giftName}
                    onChange={(e) => setGiftName(e.target.value)}
                  />
                  <Field
                    label="Số điện thoại người nhận"
                    type="tel"
                    name="recipientPhone"
                    value={giftPhone}
                    onChange={(e) => setGiftPhone(e.target.value)}
                    required
                    pattern="[+0-9 ()-]{9,20}"
                  />
                </>
              )}
              <label className="field span-2">
                Địa chỉ tại TP. Hà Nội
                <input
                  name="address"
                  required
                  minLength={10}
                  maxLength={500}
                  placeholder="Số nhà, đường, phường, quận"
                  value={
                    receivingSelf
                      ? (selfAddress ?? user?.address ?? "")
                      : giftAddress
                  }
                  onChange={(e) =>
                    receivingSelf
                      ? setSelfAddress(e.target.value)
                      : setGiftAddress(e.target.value)
                  }
                />
              </label>
              <div className="delivery-schedule span-2">
                <Field
                  label="Ngày giao hoa"
                  name="deliveryDate"
                  type="date"
                  min={today}
                  max={new Date(Date.now() + 89 * 86400000)
                    .toISOString()
                    .slice(0, 10)}
                  defaultValue={today}
                  required
                />
                <label className="field">
                  Khung giờ
                  <select name="deliverySlot">
                    <option>09:00–12:00</option>
                    <option>12:00–15:00</option>
                    <option>15:00–18:00</option>
                    <option>18:00–20:00</option>
                  </select>
                </label>
              </div>
            </div>
          </section>
          <section className="form-section">
            <h3>
              <span>03</span> Một lời nhắn riêng
            </h3>
            <label className="field">
              Lời nhắn trên thiệp
              <textarea
                name="message"
                maxLength={500}
                rows={3}
                placeholder="Viết điều bạn muốn gửi gắm. Fleur sẽ viết tay giúp bạn."
              />
            </label>
            <label className="field">
              Ghi chú cho Fleur
              <textarea
                name="notes"
                maxLength={1000}
                rows={2}
                placeholder="Hướng dẫn giao hoa hoặc yêu cầu đặc biệt..."
              />
            </label>
          </section>
          <section className="form-section">
            <h3>
              <span>04</span> Thanh toán
            </h3>
            <label className="payment-option">
              <input type="radio" name="payment" defaultChecked />
              Thanh toán khi nhận hoa (COD)<span>Tiền mặt khi giao hàng</span>
            </label>
            <p className="small">
              Bạn chỉ thanh toán khi nhận hoa. Các phương thức thanh toán trực
              tuyến sẽ xuất hiện khi cửa hàng kết nối nhà cung cấp.
            </p>
            <label className="check-field">
              <input name="consent" type="checkbox" />
              Tôi muốn nhận gợi ý hoa và ưu đãi cho những dịp đặc biệt.
            </label>
            <label className="check-field">
              <input type="checkbox" required />
              Tôi đồng ý với{" "}
              <Link href="/policies" target="_blank">
                chính sách đặt hàng
              </Link>{" "}
              và{" "}
              <Link href="/privacy" target="_blank">
                quyền riêng tư
              </Link>
              .
            </label>
          </section>
        </div>
        <aside className="order-summary">
          <h3>Bó hoa sắp được gửi</h3>
          {cart.map((i) => {
            const p = data.products.find((p) => p.id === i.productId);
            return p ? (
              <div className="mini-product" key={i.productId + i.size}>
                <FlowerImage src={p.image} alt={p.name} />
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    Kích thước {i.size} · Số lượng {i.quantity}
                  </small>
                </div>
              </div>
            ) : null;
          })}
          {quote && <Totals quote={quote} />}
          <p className="small">
            Phí giao hàng đã được tính. Đơn chỉ được tạo khi bạn nhấn nút bên
            dưới.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button full" disabled={busy || !quote}>
            {busy ? "Đang gửi đơn..." : "Đặt hoa"}{" "}
            {!busy && <ArrowRight size={18} />}
          </button>
          <Link className="text-link" href="/cart">
            Quay lại giỏ hàng
          </Link>
        </aside>
      </form>
    </main>
  );
}
export function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="field">
      {label}
      <input {...props} />
    </label>
  );
}
