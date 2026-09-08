"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Search,
  UserRound,
  ShoppingBag,
  ArrowUpRight,
  Menu,
  X,
} from "lucide-react";
import { useShop } from "./context";
import { Footer } from "./home";
import { WebTools } from "./web-tools";
export default function StoreShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const { cart } = useShop();
  const navigate = () => setMenu(false);
  if (path.startsWith("/admin")) return <>{children}</>;
  return (
    <>
      <WebTools />
      <div className="announcement" aria-label="Thông báo cửa hàng">
        <div className="announcement-track">
          <span className="announcement-message">
            Một chút hoa. Một ngày thật khác.
          </span>
          <span className="announcement-message">
            Miễn phí giao hàng cho đơn từ 1.000.000 ₫ <ArrowUpRight size={12} />
          </span>
          <span className="announcement-message" aria-hidden="true">
            Một chút hoa. Một ngày thật khác.
          </span>
        </div>
      </div>
      <header className="header">
        <Link className="logo" href="/" onClick={navigate}>
          fleur<span>®</span>
        </Link>
        <nav
          id="store-navigation"
          className={menu ? "nav open" : "nav"}
          onClick={navigate}
          aria-label="Điều hướng chính"
        >
          <Link className={path === "/shop" ? "selected" : ""} href="/shop">
            Khám phá hoa
          </Link>
          <Link href="/shop?occasion=sinh-nhat">Dịp đặc biệt</Link>
          <Link href="/events">Bộ sưu tập</Link>
          <Link href="/journal">Chuyện về hoa</Link>
          <Link href="/about">Về Fleur</Link>
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
      <Footer />
    </>
  );
}
