"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Flower2,
  LogOut,
  Package,
  UserRound,
  Heart,
  ShieldCheck,
  Mail,
  CalendarDays,
  MapPin,
} from "lucide-react";
import type { Catalog } from "@/lib/types";
import { api, useShop } from "./context";
import { Breadcrumb, Empty, Field } from "./shopping";
import { money, ProductCard } from "./home";
export const statusNames: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  preparing: "Đang chuẩn bị",
  shipping: "Đang giao",
  delivered: "Đã giao",
  cancelled: "Đã huỷ",
  unpaid: "Chưa thanh toán",
  paid: "Đã thanh toán",
  refunded: "Đã hoàn tiền",
};
export function Status({ value }: { value: string }) {
  return (
    <span className={"status status-" + value}>
      {statusNames[value] || value}
    </span>
  );
}
export function Auth({ mode }: { mode: string }) {
  const router = useRouter(),
    params = useSearchParams();
  const { setUser } = useShop();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false);
  const register = mode === "register",
    forgot = mode === "forgot-password";
  useEffect(() => {
    setError("");
    setSent(false);
  }, [mode]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (forgot) {
        await api("contact", "POST", {
          name: f.name,
          email: f.email,
          message:
            "Yêu cầu khôi phục tài khoản. Vui lòng xác minh quyền sở hữu email trước khi cấp đường dẫn đặt lại mật khẩu.",
        });
        setSent(true);
      } else {
        const d = await api(
          "auth/" + (register ? "register" : "login"),
          "POST",
          { ...f, consent: f.consent === "on" },
        );
        setUser(d.user);
        const next = params.get("next");
        router.push(
          next && next.startsWith("/") && !next.startsWith("//")
            ? next
            : d.user.role === "customer"
              ? "/account"
              : "/admin",
        );
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-art">
        <span className="eyebrow">A LITTLE FLOWER. A LOT OF LOVE.</span>
        <h2>
          Những điều đẹp đẽ,
          <br />
          bắt đầu từ đây.
        </h2>
        <Flower2 size={140} />
        <p>
          Một nơi để giữ lại những bó hoa bạn yêu,
          <br />
          và những người bạn muốn gửi trao.
        </p>
      </div>
      <div className="auth-panel">
        <span className="eyebrow">WELCOME TO FLEUR</span>
        <h1>
          {forgot
            ? "Tìm lại tài khoản."
            : register
              ? "Rất vui được biết bạn."
              : "Chào bạn trở lại."}
        </h1>
        <p>
          {forgot
            ? "Đội ngũ Fleur sẽ tiếp nhận yêu cầu và xác minh email của bạn."
            : register
              ? "Tạo tài khoản để lưu những điều bạn yêu."
              : "Đăng nhập để tiếp tục gửi những lời thương."}
        </p>
        {sent ? (
          <div className="notice">
            <Check />
            Đã lưu yêu cầu. Cửa hàng sẽ kiểm tra và hỗ trợ khôi phục tài khoản
            sau khi xác minh quyền sở hữu email.
          </div>
        ) : (
          <form onSubmit={submit}>
            {(register || forgot) && (
              <Field
                label="Họ và tên"
                name="name"
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
              />
            )}
            <Field
              label="Email"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
            {!forgot && (
              <Field
                label="Mật khẩu"
                name="password"
                type="password"
                required
                minLength={register ? 10 : 1}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
                placeholder={register ? "Tối thiểu 10 ký tự" : ""}
              />
            )}{" "}
            {!register && !forgot && (
              <Link className="forgot-link" href="/forgot-password">
                Quên mật khẩu?
              </Link>
            )}
            {register && (
              <>
                <label className="check-field">
                  <input type="checkbox" name="consent" />
                  Nhận gợi ý và ưu đãi từ Fleur.
                </label>
                <label className="check-field">
                  <input type="checkbox" required />
                  Tôi đồng ý với{" "}
                  <Link href="/privacy" target="_blank">
                    chính sách quyền riêng tư
                  </Link>
                  .
                </label>
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button full" disabled={busy}>
              {busy
                ? "Đang xử lý..."
                : forgot
                  ? "Gửi yêu cầu hỗ trợ"
                  : register
                    ? "Tạo tài khoản"
                    : "Đăng nhập"}
              <ArrowRight size={17} />
            </button>
          </form>
        )}
        <div className="auth-bottom">
          {register ? "Đã là một phần của Fleur?" : "Chưa có tài khoản?"}{" "}
          <Link href={register ? "/login" : "/register"}>
            {register ? "Đăng nhập" : "Đăng ký ngay"}
          </Link>
        </div>
      </div>
    </main>
  );
}
export function Account() {
  const { user, setUser, ready, toast } = useShop();
  const [tab, setTab] = useState("profile"),
    [orders, setOrders] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (user)
      api("orders")
        .then(setOrders)
        .catch((e) => setError(e.message));
  }, [user]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (tab === "security") {
        await api("account/password", "POST", f);
        toast("Đã đổi mật khẩu và đăng xuất các phiên khác.");
        e.currentTarget?.reset();
      } else {
        const d = await api("account", "PATCH", {
          ...f,
          birthday: f.birthday || null,
          marketing_consent: f.marketing_consent === "on",
        });
        setUser(d.user);
        toast("Đã lưu thông tin của bạn.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready) return <main className="page">Đang tải tài khoản...</main>;
  if (!user)
    return (
      <main className="page">
        <div className="empty">
          <UserRound size={45} />
          <h2>Một góc nhỏ của riêng bạn.</h2>
          <p>Đăng nhập để theo dõi đơn hàng và lưu thông tin nhận hoa.</p>
          <Link href="/login" className="button">
            Đăng nhập <ArrowRight size={18} />
          </Link>
          <Link href="/track-order" className="text-link">
            Hoặc tra cứu đơn không cần tài khoản
          </Link>
        </div>
      </main>
    );
  return (
    <main className="page">
      <Breadcrumb title="Tài khoản" />
      <div className="page-heading">
        <span className="eyebrow">YOUR FLEUR SPACE</span>
        <h1>Chào {user.name.split(" ").at(-1)}.</h1>
        <p>Một góc nhỏ cho những điều bạn yêu.</p>
      </div>
      <div className="account-layout">
        <aside className="account-nav">
          {[
            ["profile", "Thông tin cá nhân", UserRound],
            ["orders", "Đơn hàng của tôi", Package],
            ["security", "Đổi mật khẩu", ShieldCheck],
          ].map(([key, label, Icon]: any) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setError("");
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
          <Link href="/wishlist">
            <Heart size={18} />
            Hoa yêu thích
          </Link>
          {user.role !== "customer" && (
            <Link href="/admin">
              <ShieldCheck size={18} />
              Fleur Workspace
            </Link>
          )}
          <button
            onClick={async () => {
              try {
                await api("auth/logout", "POST", {});
                setUser(null);
                router.push("/");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={18} />
            Đăng xuất
          </button>
        </aside>
        <section className="account-content">
          {tab === "orders" ? (
            <>
              <h2>Đơn hàng của tôi</h2>
              {!orders.length ? (
                <Empty
                  title="Chưa có đơn hàng nào."
                  description="Bó hoa đầu tiên của bạn đang đợi ở cửa hàng."
                />
              ) : (
                orders.map((o) => (
                  <div className="order-card" key={o.id}>
                    <div className="flex-between">
                      <strong>{o.reference}</strong>
                      <Status value={o.status} />
                    </div>
                    <p className="small">
                      Giao ngày {o.delivery_date} · {o.delivery_slot}
                    </p>
                    {(typeof o.items === "string"
                      ? JSON.parse(o.items)
                      : o.items
                    )?.map((i: any, n: number) => (
                      <div className="mini-product" key={n}>
                        <img src={i.image} alt={i.name} />
                        <div>
                          <strong>{i.name}</strong>
                          <small>
                            {i.quantity} × {money(i.price)} · {i.size}
                          </small>
                        </div>
                      </div>
                    ))}
                    <div className="flex-between">
                      <span>
                        Tổng cộng <strong>{money(o.total)}</strong>
                      </span>
                      {["pending", "confirmed"].includes(o.status) && (
                        <button
                          className="text-button"
                          onClick={async () => {
                            if (
                              !confirm("Bạn muốn huỷ đơn " + o.reference + "?")
                            )
                              return;
                            try {
                              await api(
                                "orders/" + o.id + "/cancel",
                                "POST",
                                {},
                              );
                              setOrders(await api("orders"));
                              toast("Đã huỷ đơn hàng.");
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Huỷ đơn
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </>
          ) : (
            <form onSubmit={save}>
              <h2>
                {tab === "security" ? "Đổi mật khẩu" : "Thông tin cá nhân"}
              </h2>
              {tab === "security" ? (
                <>
                  <Field
                    label="Mật khẩu hiện tại"
                    name="currentPassword"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                  <Field
                    label="Mật khẩu mới"
                    name="password"
                    type="password"
                    minLength={10}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </>
              ) : (
                <>
                  <div className="form-grid">
                    <Field
                      label="Họ và tên"
                      name="name"
                      defaultValue={user.name}
                      required
                    />
                    <Field
                      label="Điện thoại"
                      name="phone"
                      defaultValue={user.phone}
                    />
                    <Field label="Email" value={user.email} readOnly />
                    <Field
                      label="Sinh nhật"
                      name="birthday"
                      type="date"
                      defaultValue={user.birthday?.slice(0, 10) || ""}
                    />
                  </div>
                  <label className="field">
                    Địa chỉ mặc định
                    <textarea
                      name="address"
                      rows={3}
                      defaultValue={user.address}
                    />
                  </label>
                  <label className="check-field">
                    <input
                      name="marketing_consent"
                      type="checkbox"
                      defaultChecked={!!user.marketing_consent}
                    />
                    Nhận thông tin ưu đãi và gợi ý cho các dịp đặc biệt.
                  </label>
                </>
              )}
              {error && <p className="error">{error}</p>}
              <button className="button" disabled={busy}>
                {busy ? "Đang lưu..." : "Lưu thay đổi"}
                <Check size={18} />
              </button>
            </form>
          )}
          {tab === "orders" && error && <p className="error">{error}</p>}
        </section>
      </div>
    </main>
  );
}
export function Journal({ data, slug }: { data: Catalog; slug?: string }) {
  const post = data.posts.find((p) => p.slug === slug);
  if (slug && !post)
    return (
      <Empty
        title="Chưa tìm thấy câu chuyện."
        description="Những câu chuyện khác vẫn đang đợi bạn."
      />
    );
  return (
    <main className="page">
      <Breadcrumb title={post?.title || "Chuyện về hoa"} />
      {post ? (
        <article className="article">
          <span className="eyebrow">THE FLEUR JOURNAL</span>
          <h1>{post.title}</h1>
          <p className="lead">{post.excerpt}</p>
          <img src={post.image} alt={post.title} />
          <div className="article-body">
            {post.content
              .split("\n")
              .filter(Boolean)
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </div>
          <Link className="text-link" href="/journal">
            Thêm những chuyện về hoa <ArrowUpRight size={16} />
          </Link>
        </article>
      ) : (
        <>
          <div className="page-heading">
            <span className="eyebrow">THE FLEUR JOURNAL</span>
            <h1>Chậm một chút. Yêu nhiều hơn.</h1>
            <p>Chuyện về hoa, về những người thương, và những điều nhỏ bé.</p>
          </div>
          <div className="journal-grid">
            {data.posts.map((p) => (
              <Link
                href={"/journal/" + p.slug}
                className="journal-card"
                key={p.id}
              >
                <img src={p.image} alt={p.title} />
                <span className="eyebrow">CHUYỆN VỀ HOA</span>
                <h2>{p.title}</h2>
                <p>{p.excerpt}</p>
                <span className="text-link">
                  Đọc câu chuyện <ArrowUpRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
export function Events({ data }: { data: Catalog }) {
  return (
    <main className="page">
      <Breadcrumb title="Bộ sưu tập & sự kiện" />
      <div className="page-heading">
        <span className="eyebrow">MOMENTS TO REMEMBER</span>
        <h1>Cho những ngày đáng nhớ.</h1>
        <p>Mỗi thời điểm trong năm, một cách gửi trao khác biệt.</p>
      </div>
      <div className="event-list">
        {data.events.map((e, i) => (
          <article className="event-card" key={e.id}>
            <div className="event-number">0{i + 1}</div>
            <div>
              <span className="eyebrow">
                <CalendarDays size={16} />
                {e.starts_at} — {e.ends_at}
              </span>
              <h2>{e.name}</h2>
              <p>{e.description}</p>
              <Link href="/shop" className="button outline">
                Khám phá thiết kế <ArrowUpRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
export function Contact() {
  const [sent, setSent] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="page">
      <Breadcrumb title="Liên hệ" />
      <div className="page-heading">
        <span className="eyebrow">WE ARE HERE FOR YOU</span>
        <h1>Kể Fleur nghe.</h1>
        <p>Một bó hoa riêng, một sự kiện, hay một điều bạn cần hỗ trợ.</p>
      </div>
      <div className="contact-layout">
        <div>
          <h2>Mọi lời nhắn đều được nâng niu.</h2>
          <p>
            Gửi yêu cầu tư vấn, chăm sóc hoa, hoặc hỗ trợ đơn hàng. Đội ngũ
            Fleur sẽ tiếp nhận thông tin trong khu vực quản trị.
          </p>
          <div className="contact-feature">
            <MapPin />
            Phục vụ tại TP. Hà Nội
          </div>
          <div className="contact-feature">
            <CalendarDays />
            Tiếp nhận yêu cầu mỗi ngày
          </div>
          <Link href="/track-order" className="text-link">
            Tra cứu đơn hàng <ArrowUpRight size={16} />
          </Link>
        </div>
        {sent ? (
          <div className="notice">
            <Check />
            Fleur đã nhận lời nhắn của bạn. Yêu cầu đã được lưu để cửa hàng hỗ
            trợ.
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await api("contact", "POST", f);
                setSent(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Tên của bạn" name="name" required minLength={2} />
            <Field label="Email" name="email" type="email" required />
            <label className="field">
              Fleur có thể giúp gì cho bạn?
              <textarea
                name="message"
                required
                minLength={10}
                maxLength={3000}
                rows={5}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="button" disabled={busy}>
              {busy ? "Đang gửi..." : "Gửi lời nhắn"}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
export function Track() {
  const params = useSearchParams();
  const [order, setOrder] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="page narrow">
      <Breadcrumb title="Tra cứu đơn hàng" />
      <div className="page-heading">
        <span className="eyebrow">FOLLOW THE FLOWERS</span>
        <h1>Hoa đang ở đâu?</h1>
        <p>Nhập mã đơn và email đã dùng khi đặt hoa.</p>
      </div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            setOrder(
              await api(
                "orders/track",
                "POST",
                Object.fromEntries(new FormData(e.currentTarget)),
              ),
            );
          } catch (e) {
            setOrder(null);
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Mã đơn hàng"
          name="reference"
          required
          defaultValue={params.get("reference") || ""}
          placeholder="FL..."
        />
        <Field
          label="Email đặt hàng"
          name="email"
          type="email"
          required
          defaultValue={params.get("email") || ""}
        />
        <button className="button" disabled={busy}>
          {busy ? "Đang tìm..." : "Tra cứu đơn"}
          <ArrowRight size={17} />
        </button>
        {error && <p className="error">{error}</p>}
      </form>
      {order && (
        <div className="order-card">
          <div className="flex-between">
            <h3>{order.reference}</h3>
            <Status value={order.status} />
          </div>
          <p>
            Ngày giao: {order.delivery_date}
            <br />
            Khung giờ: {order.delivery_slot}
            <br />
            Tổng tiền: {money(order.total)}
          </p>
          <div className="order-progress">
            {["pending", "confirmed", "preparing", "shipping", "delivered"].map(
              (s, i) => (
                <div
                  key={s}
                  className={
                    i <=
                    [
                      "pending",
                      "confirmed",
                      "preparing",
                      "shipping",
                      "delivered",
                    ].indexOf(order.status)
                      ? "active"
                      : ""
                  }
                >
                  <span>{i + 1}</span>
                  <small>{statusNames[s]}</small>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export function ResetPassword() {
  const params = useSearchParams();
  const { setUser } = useShop();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  return (
    <main className="page narrow">
      <div className="page-heading">
        <span className="eyebrow">A FRESH START</span>
        <h1>Đặt lại mật khẩu.</h1>
        <p>Liên kết chỉ dùng một lần và có hiệu lực 30 phút.</p>
      </div>
      {done ? (
        <div className="notice">
          Đã đặt lại mật khẩu.{" "}
          <Link href="/login">Đăng nhập với mật khẩu mới</Link>.
        </div>
      ) : (
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            if (f.get("password") !== f.get("confirm")) {
              setError("Hai mật khẩu chưa trùng nhau.");
              setBusy(false);
              return;
            }
            try {
              await api("auth/reset-password", "POST", {
                token: params.get("token") || "",
                password: f.get("password"),
              });
              setUser(null);
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Mật khẩu mới"
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
          />
          <Field
            label="Nhập lại mật khẩu"
            name="confirm"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
          />
          {error && <p className="error">{error}</p>}
          <button className="button" disabled={busy}>
            {busy ? "Đang lưu..." : "Đặt lại mật khẩu"}
            <Check size={17} />
          </button>
        </form>
      )}
    </main>
  );
}

const content: Record<
  string,
  { label: string; title: string; intro: string; sections: [string, string][] }
> = {
  about: {
    label: "THE FLEUR PHILOSOPHY",
    title: "Một chút hoa. Thật nhiều cảm xúc.",
    intro:
      "Fleur bắt đầu từ một điều giản dị: hoa có thể khiến một ngày bình thường trở nên đáng nhớ.",
    sections: [
      [
        "Đẹp từ những điều vừa đủ",
        "Chúng tôi yêu những thiết kế tự nhiên, màu sắc hài hòa và cách gói hoa tối giản. Mỗi cành hoa đều có khoảng thở, mỗi bó hoa đều giữ được nét riêng.",
      ],
      [
        "Chăm chút đến tận tay",
        "Từ khi chọn hoa đến lúc viết tấm thiệp cuối cùng, chúng tôi dành thời gian cho từng chi tiết. Bởi món quà này đang mang theo điều quan trọng của bạn.",
      ],
      [
        "Hoa cho mọi người",
        "Một lời cảm ơn, lời chúc mừng, hay món quà cho chính mình. Bạn không cần một lý do thật lớn để trao đi điều đẹp đẽ.",
      ],
    ],
  },
  policies: {
    label: "ORDER WITH CONFIDENCE",
    title: "Giao hoa bằng sự tận tâm.",
    intro: "Những thông tin bạn cần trước khi đặt hoa tại Fleur.",
    sections: [
      [
        "Phạm vi & phí giao hàng",
        "Giao trong khu vực TP. Hà Nội với phí 35.000 ₫. Miễn phí giao hàng cho đơn có giá trị sản phẩm từ 1.000.000 ₫ trước giảm giá. Chọn ngày và một trong bốn khung giờ tại bước đặt hàng.",
      ],
      [
        "Chuẩn bị & thay thế hoa",
        "Hoa là sản phẩm tự nhiên nên màu sắc, độ nở có thể khác nhẹ so với ảnh. Nếu loài hoa cần thay thế do mùa vụ, cửa hàng sẽ liên hệ và chỉ thay sau khi bạn đồng ý.",
      ],
      [
        "Thanh toán & huỷ đơn",
        "Bản hiện tại hỗ trợ thanh toán khi nhận hàng. Bạn có thể huỷ trong tài khoản khi đơn đang chờ xác nhận hoặc đã xác nhận nhưng chưa bắt đầu chuẩn bị. Các trường hợp khác vui lòng gửi yêu cầu hỗ trợ.",
      ],
      [
        "Đổi trả & hỗ trợ",
        "Nếu hoa bị hư hỏng khi giao, vui lòng gửi mã đơn và mô tả qua trang liên hệ trong 24 giờ. Cửa hàng sẽ kiểm tra để đổi hoa hoặc thống nhất phương án phù hợp. Chính sách này cần được chủ cửa hàng xác nhận trước khi mở bán chính thức.",
      ],
    ],
  },
  privacy: {
    label: "YOUR TRUST MATTERS",
    title: "Thông tin của bạn được trân trọng.",
    intro:
      "Fleur sử dụng dữ liệu để thực hiện đơn hàng và chăm sóc khách hàng.",
    sections: [
      [
        "Thông tin được lưu",
        "Tên, email, số điện thoại, địa chỉ giao hàng, người nhận, lời nhắn và lịch sử đặt hàng được lưu trong hệ thống. Ngày sinh là thông tin tự nguyện để hỗ trợ các dịp đặc biệt.",
      ],
      [
        "Mục đích sử dụng",
        "Dữ liệu phục vụ xác nhận, giao hoa, xử lý yêu cầu và chăm sóc sau mua. Bạn chỉ nhận nội dung tiếp thị khi chủ động đồng ý; có thể thay đổi lựa chọn trong trang cá nhân.",
      ],
      [
        "Quyền truy cập",
        "Nhân viên được phân quyền theo công việc. Mật khẩu được băm trước khi lưu; hệ thống không lưu thông tin thẻ ngân hàng. Bạn có thể yêu cầu xem, chỉnh sửa hoặc xoá dữ liệu qua trang liên hệ.",
      ],
      [
        "Triển khai chính thức",
        "Chủ cửa hàng cần điền thông tin pháp nhân, liên hệ, thời hạn lưu dữ liệu và quy trình xử lý yêu cầu quyền riêng tư trước khi đưa website vào kinh doanh.",
      ],
    ],
  },
  faq: {
    label: "A FEW LITTLE ANSWERS",
    title: "Bạn hỏi, Fleur trả lời.",
    intro: "Một vài điều nhỏ trước khi bạn chọn hoa.",
    sections: [
      [
        "Có thể viết lời nhắn trên thiệp không?",
        "Có. Bạn nhập lời nhắn tại bước đặt hàng. Thiệp viết tay và gói quà được tặng kèm.",
      ],
      [
        "Tôi có cần tài khoản để đặt hoa?",
        "Không bắt buộc. Bạn có thể đặt với email và số điện thoại. Hãy lưu mã đơn để tra cứu. Tạo tài khoản giúp bạn quản lý đơn hàng và địa chỉ thuận tiện hơn.",
      ],
      [
        "Tôi có thể chọn ngày giao không?",
        "Có. Bạn có thể chọn ngày trong 90 ngày tới và khung giờ giao phù hợp. Cửa hàng sẽ kiểm tra đơn trước khi xác nhận.",
      ],
      [
        "Làm sao áp dụng mã giảm giá?",
        "Nhập mã ở giỏ hàng. Hệ thống kiểm tra thời hạn, số lượt dùng và giá trị đơn tối thiểu. Mỗi đơn áp dụng một mã.",
      ],
      [
        "Fleur nhận hoa sự kiện hay hoa đặt riêng không?",
        "Có thể gửi yêu cầu qua trang liên hệ, kèm thời gian, số lượng và phong cách mong muốn để được tư vấn.",
      ],
    ],
  },
};
export function Content({ page }: { page: string }) {
  const c = content[page];
  if (!c)
    return (
      <main className="page">
        <Empty
          title="Trang này chưa được tìm thấy."
          description="Quay lại cửa hàng để tiếp tục chọn hoa."
        />
      </main>
    );
  return (
    <main className="page narrow">
      <Breadcrumb
        title={
          page === "about"
            ? "Về Fleur"
            : page === "faq"
              ? "Câu hỏi thường gặp"
              : page === "privacy"
                ? "Quyền riêng tư"
                : "Chính sách"
        }
      />
      <div className="page-heading">
        <span className="eyebrow">{c.label}</span>
        <h1>{c.title}</h1>
        <p>{c.intro}</p>
      </div>
      {c.sections.map(([title, text]) =>
        page === "faq" ? (
          <details className="faq-item" key={title}>
            <summary>{title}</summary>
            <p>{text}</p>
          </details>
        ) : (
          <section className="content-section" key={title}>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ),
      )}
      <Link href="/contact" className="text-link">
        Liên hệ với Fleur <ArrowUpRight size={16} />
      </Link>
    </main>
  );
}
