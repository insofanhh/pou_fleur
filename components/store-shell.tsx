"use client";
import Link, { useLocalPath } from "./routing";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Search,
  UserRound,
  ShoppingBag,
  ArrowUpRight,
  Menu,
  X,
} from "lucide-react";
import { api, useShop } from "./context";
import { Footer } from "./home";
import { WebTools } from "./web-tools";
export default function StoreShell({ children }: { children: ReactNode }) {
  const path = useLocalPath();
  const rawPath = usePathname();
  const [store, setStore] = useState<any>(null);
  useEffect(() => {
    let active = true;
    if (
      !rawPath.startsWith("/s/") &&
      !["/shop", "/cart", "/checkout"].includes(rawPath)
    ) {
      setStore(null);
      return;
    }
    api("store")
      .then((s) => active && setStore(s))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [rawPath]);
  const [menu, setMenu] = useState(false);
  const { cart } = useShop();
  const navigate = () => setMenu(false);
  if (path.startsWith("/admin") || rawPath.startsWith("/platform"))
    return <>{children}</>;
  const marketplace =
    !rawPath.startsWith("/s/") &&
    ![
      "/shop",
      "/product",
      "/cart",
      "/checkout",
      "/wishlist",
      "/journal",
      "/events",
      "/about",
    ].some((p) => rawPath.startsWith(p));
  const theme = store?.theme;
  return (
    <div
      className={"storefront theme-" + (theme?.template || "minimal")}
      style={
        theme
          ? ({
              "--store-accent": theme.accent,
              "--store-background": theme.background,
              fontFamily: (
                {
                  serif: "Georgia,serif",
                  sans: "Arial,sans-serif",
                  mono: "monospace",
                  system: "inherit",
                } as any
              )[theme.font],
            } as React.CSSProperties)
          : undefined
      }
    >
      <WebTools />
      {!marketplace && (
        <div className="announcement" aria-label="Thông báo cửa hàng">
          <div className="announcement-track">
            <span className="announcement-message">
              Một chút hoa. Một ngày thật khác.
            </span>
            <span className="announcement-message">
              Miễn phí giao hàng cho đơn từ{" "}
              {new Intl.NumberFormat("vi-VN").format(
                store?.settings?.free_shipping ?? 1000000,
              )}{" "}
              ₫ <ArrowUpRight size={12} />
            </span>
            <span className="announcement-message" aria-hidden="true">
              Một chút hoa. Một ngày thật khác.
            </span>
          </div>
        </div>
      )}
      <header className="header">
        <Link className="logo" href="/" onClick={navigate}>
          {store?.name || "fleurious"}
          <span>®</span>
        </Link>
        <nav
          id="store-navigation"
          className={menu ? "nav open" : "nav"}
          onClick={navigate}
          aria-label="Điều hướng chính"
        >
          {marketplace ? (
            <>
              <Link href="/">Khám phá cửa hàng</Link>
              <Link href="/start">Mở cửa hàng</Link>
              <Link href="/account/orders">Đơn hàng của tôi</Link>
              <Link href="/inbox">Thông báo</Link>
            </>
          ) : (
            <>
              <Link className={path === "/shop" ? "selected" : ""} href="/shop">
                Khám phá hoa
              </Link>
              <Link href="/shop?occasion=sinh-nhat">Dịp đặc biệt</Link>
              <Link href="/events">Bộ sưu tập</Link>
              <Link href="/journal">Chuyện về hoa</Link>
              <Link href="/about">Về cửa hàng</Link>
            </>
          )}
        </nav>
        <div className="header-actions">
          <Link href="/shop?search=1" aria-label="Tìm kiếm">
            <Search />
          </Link>
          <Link href="/account" aria-label="Tài khoản">
            <UserRound />
          </Link>
          <Link href="/cart" aria-label="Giỏ hàng">
            <ShoppingBag />
            <span className="cart-count">
              {cart.reduce((s, i) => s + i.quantity, 0)}
            </span>
          </Link>
          <button
            className="mobile-menu icon-button"
            onClick={() => setMenu(!menu)}
            aria-label="Menu"
            aria-expanded={menu}
            aria-controls="store-navigation"
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {children}
      {marketplace ? (
        <footer className="market-footer">
          <div className="market-footer-main">
            <div className="market-footer-brand">
              <Link className="logo" href="/">
                fleurious<span>®</span>
              </Link>
              <p>Kết nối những tiệm hoa và những điều đẹp đẽ.</p>
            </div>
            <nav className="market-footer-nav" aria-label="Liên kết cuối trang">
              <Link href="/start">Mở cửa hàng</Link>
              <Link href="/account/orders">Đơn hàng</Link>
              <Link href="/privacy">Quyền riêng tư</Link>
              <Link href="/inbox">Thông báo</Link>
            </nav>
          </div>
          <small>© {new Date().getFullYear()} Fleurious</small>
        </footer>
      ) : (
        <Footer name={store?.name || "Fleurious"} />
      )}
    </div>
  );
}
