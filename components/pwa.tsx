"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  House,
  Store,
  Heart,
  UserRound,
  Bell,
  ShoppingBag,
} from "lucide-react";
import { api, useShop } from "./context";
export default function AppNavigation() {
  const path = usePathname(),
    { user } = useShop();
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
  }, []);
  if (path.startsWith("/workspace") || path.startsWith("/admin")) {
    const sid = path.match(/^\/workspace\/(\d+)/)?.[1] || "1";
    const role = user?.memberships?.find(
      (m) => m.store_id === Number(sid),
    )?.role;
    const links =
      role === "editor"
        ? [
            ["posts", "Tin tức"],
            ["events", "Sự kiện"],
          ]
        : [
            ["overview", "Tổng quan"],
            ["board", "Đơn hàng"],
            ["calendar", "Lịch"],
          ];
    return (
      <nav className="app-bottom-nav" aria-label="Điều hướng quản lý store">
        {links
          .filter(([k]) => k !== "overview" || role !== "support")
          .map(([k, t]) => (
            <Link key={k} href={"/workspace/" + sid + "/" + k} scroll={false}>
              {k === "calendar" ? <Bell size={20} /> : <Store size={20} />}
              <span>{t}</span>
            </Link>
          ))}
        <Link href="/inbox">
          <Bell size={20} />
          <span>Thông báo</span>
        </Link>
        <Link href="/account">
          <UserRound size={20} />
          <span>Tài khoản</span>
        </Link>
      </nav>
    );
  }
  if (path.startsWith("/platform"))
    return (
      <nav className="app-bottom-nav" aria-label="Điều hướng nền tảng">
        {[
          ["overview", "Tổng quan"],
          ["stores", "Stores"],
          ["invoices", "Hóa đơn"],
          ["health", "Hệ thống"],
        ].map(([k, t]) => (
          <Link key={k} href={"/platform/" + k} scroll={false}>
            <Store size={20} />
            <span>{t}</span>
          </Link>
        ))}
      </nav>
    );
  const store = path.match(/^\/s\/([^/]+)/)?.[1];
  const items = store
    ? [
        ["/", "Khám phá", House],
        ["/s/" + store + "/shop", "Hoa", Store],
        ["/s/" + store + "/cart", "Giỏ hàng", ShoppingBag],
        ["/inbox", "Thông báo", Bell],
        ["/account", "Tài khoản", UserRound],
      ]
    : [
        ["/", "Khám phá", House],
        ["/inbox", "Thông báo", Bell],
        ["/account/orders", "Đơn hàng", ShoppingBag],
        ["/account", "Tài khoản", UserRound],
      ];
  return (
    <nav className="app-bottom-nav" aria-label="Điều hướng ứng dụng">
      {items.map(([href, label, Icon]: any) => (
        <Link key={href} href={href} className={path === href ? "active" : ""}>
          <Icon size={20} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
export function Inbox() {
  const { user, ready, toast } = useShop(),
    [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [preferences, setPreferences] = useState<any>({
      marketing: false,
      push: false,
    }),
    [store, setStore] = useState("");
  const storeIds = [
    ...new Set([
      ...items.map((i) => i.store_id).filter(Boolean),
      ...(user?.memberships || []).map((m) => m.store_id),
    ]),
  ].filter((id) => Number(id) !== 1);
  async function load() {
    try {
      setItems(await api("inbox"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (user) void load();
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [user]);
  useEffect(() => {
    if (!user || !store) return;
    fetch("/api/notification-preferences", {
      headers: { "x-fleur-store": store },
    })
      .then((r) => r.json())
      .then(setPreferences)
      .catch(() => {});
  }, [user, store]);
  useEffect(() => {
    if (storeIds.length && !storeIds.includes(Number(store)))
      setStore(String(storeIds[0]));
    else if (!storeIds.length && store) setStore("");
  }, [storeIds.join(","), store]);
  async function savePreferences(push: boolean, marketing: boolean) {
    const r = await fetch("/api/notification-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-fleur-store": store },
      body: JSON.stringify({ push, marketing }),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setPreferences({ push, marketing });
  }
  async function enablePush() {
    try {
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
        throw Error("Thông báo đẩy chưa được cấu hình.");
      if (!("PushManager" in window))
        throw Error(
          "Trình duyệt chưa hỗ trợ. Trên iPhone, hãy thêm Fleurious vào màn hình chính.",
        );
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw Error("Bạn chưa cho phép thông báo.");
      const registration = await navigator.serviceWorker.ready,
        key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const padded = key.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await api("push", "POST", subscription.toJSON());
      await savePreferences(true, !!preferences.marketing);
      toast("Đã bật thông báo cho cửa hàng đã chọn.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!ready) return <main className="page">Đang tải…</main>;
  if (!user)
    return (
      <main className="page">
        <h1>Thông báo của bạn.</h1>
        <Link className="button" href="/login?next=/inbox">
          Đăng nhập
        </Link>
      </main>
    );
  return (
    <main className="page narrow">
      <span className="eyebrow">STAY IN THE LOOP</span>
      <h1>Những điều mới.</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="panel">
        <h3>Cài đặt nhận tin theo cửa hàng</h3>
        <label className="field">
          Cửa hàng
          <select
            value={store}
            disabled={!storeIds.length}
            onChange={(e) => setStore(e.target.value)}
          >
            {storeIds.map((id) => (
              <option value={id} key={id}>
                {user.memberships?.find((m) => m.store_id === id)?.name ||
                  "Store #" + id}
              </option>
            ))}
          </select>
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            disabled={!store}
            checked={!!preferences.marketing}
            onChange={async (e) => {
              try {
                await savePreferences(!!preferences.push, e.target.checked);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
          Nhận chương trình và ưu đãi từ cửa hàng này
        </label>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={!store}
            onClick={() => void enablePush()}
          >
            Bật thông báo đẩy
          </button>
          {!!preferences.push && (
            <button
              className="text-button"
              disabled={!store}
              onClick={() =>
                void savePreferences(false, !!preferences.marketing)
              }
            >
              Tắt thông báo store này
            </button>
          )}
        </div>
        <p className="small">
          Thông báo đơn hàng vẫn xuất hiện trong hộp thư. Cài đặt marketing tách
          riêng theo từng cửa hàng.
        </p>
      </div>
      {!items.length && <p className="empty">Bạn chưa có thông báo.</p>}
      {items.map((i) => (
        <article
          className={"inbox-item " + (!i.read_at ? "unread" : "")}
          key={i.id}
        >
          <span className="eyebrow">{i.created_at}</span>
          <h3>{i.title}</h3>
          <p>{i.body}</p>
          <Link
            href={i.href}
            onClick={() =>
              void api("inbox/read", "POST", { id: i.id }).then(load)
            }
          >
            Xem chi tiết ↗
          </Link>
        </article>
      ))}
    </main>
  );
}
export function Join() {
  const { user, ready } = useShop(),
    [error, setError] = useState("");
  return (
    <main className="page narrow">
      <h1>Tham gia cửa hàng.</h1>
      <p>Lời mời chỉ có hiệu lực với đúng email đã được chủ cửa hàng mời.</p>
      {ready && !user ? (
        <Link
          className="button"
          href={
            "/login?next=" +
            encodeURIComponent(
              typeof location === "undefined"
                ? "/join"
                : location.pathname + location.search,
            )
          }
        >
          Đăng nhập để tham gia
        </Link>
      ) : (
        <button
          className="button"
          onClick={async () => {
            try {
              const d = await api("invitations/accept", "POST", {
                token: new URLSearchParams(location.search).get("token"),
              });
              location.href = "/workspace/" + d.storeId;
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Chấp nhận lời mời
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
