"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, useShop } from "./context";
import type { CartItem } from "@/lib/types";
export default function MultiCart() {
  const [carts, setCarts] = useState<
    { slug: string; items: CartItem[]; name: string; available: boolean }[]
  >([]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const { setCart } = useShop();
  useEffect(() => {
    let active = true;
    async function load() {
      const entries: { slug: string; items: CartItem[] }[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (!key.startsWith("fleur.cart.")) continue;
        const slug = key.slice(11);
        if (!/^[a-z0-9-]+$/.test(slug) || /^\d+$/.test(slug)) continue;
        try {
          const items = JSON.parse(localStorage.getItem(key) || "[]");
          if (Array.isArray(items) && items.length)
            entries.push({ slug, items });
        } catch {}
      }
      if (!entries.some((c) => c.slug === "fleur")) {
        try {
          const items = JSON.parse(localStorage.getItem("fleur.cart") || "[]");
          if (Array.isArray(items) && items.length)
            entries.push({ slug: "fleur", items });
        } catch {}
      }
      try {
        const stores = entries.length
          ? await api(
              "stores/cart-info?slugs=" +
                encodeURIComponent(entries.map((c) => c.slug).join(",")),
            )
          : [];
        if (active) {
          setCarts(
            entries.map((c) => ({
              ...c,
              name: stores.find((s: any) => s.slug === c.slug)?.name || c.slug,
              available: stores.some((s: any) => s.slug === c.slug),
            })),
          );
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setReady(true);
      }
    }
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("storage", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("storage", load);
    };
  }, []);
  return (
    <main className="page multi-cart">
      <div className="page-heading">
        <span className="eyebrow">YOUR FLORAL BAGS</span>
        <h1>Giỏ hoa của bạn.</h1>
        <p>Mỗi cửa hàng có giỏ và lịch giao riêng.</p>
      </div>
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      {!ready ? (
        <p className="empty">Đang tải giỏ hoa…</p>
      ) : !carts.length ? (
        <div className="empty">
          <p>Bạn chưa chọn hoa.</p>
          <Link className="button" href="/">
            Khám phá cửa hàng
          </Link>
        </div>
      ) : (
        carts.map((c) => (
          <section className="panel" key={c.slug}>
            <div>
              <h2>{c.name}</h2>
              <p>
                {c.items.reduce((n, i) => n + (Number(i.quantity) || 0), 0)} sản
                phẩm
              </p>
              {!c.available && (
                <p className="small">
                  Cửa hàng đang tạm ngưng hoặc chưa được công bố.
                </p>
              )}
            </div>
            <div className="multi-cart-actions">
              {c.available && (
                <>
                  <Link
                    className="button secondary"
                    href={"/s/" + c.slug + "/cart"}
                  >
                    Xem giỏ
                  </Link>
                  <Link className="button" href={"/s/" + c.slug + "/checkout"}>
                    Thanh toán
                  </Link>
                </>
              )}
              <button
                className="text-button"
                onClick={() => {
                  if (confirm("Xóa giỏ hoa của " + c.name + "?")) {
                    localStorage.removeItem("fleur.cart." + c.slug);
                    if (c.slug === "fleur") {
                      localStorage.removeItem("fleur.cart");
                      setCart([]);
                    }
                    setCarts((old) => old.filter((x) => x.slug !== c.slug));
                  }
                }}
              >
                Xóa giỏ
              </button>
            </div>
          </section>
        ))
      )}
    </main>
  );
}
