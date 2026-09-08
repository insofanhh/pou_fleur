"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Search,
  UserRound,
  ShoppingBag,
  ArrowUpRight,
  Menu,
  X,
} from "lucide-react";
import type { Catalog } from "@/lib/types";
import { useShop } from "./context";
import Home, { Footer } from "./home";
import { Shop, ProductDetail, Cart, Checkout, Wishlist } from "./shopping";
import {
  Auth,
  Account,
  Content,
  Journal,
  Events,
  Contact,
  Track,
  ResetPassword,
} from "./pages";
import Admin from "./admin";
import { WebTools } from "./web-tools";
export default function Store({ data }: { data: Catalog }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const { cart } = useShop();
  const navigate = () => setMenu(false);
  if (path.startsWith("/admin")) return <Admin data={data} />;
  let content;
  if (path === "/") content = <Home data={data} />;
  else if (path === "/shop") content = <Shop data={data} />;
  else if (path.startsWith("/product/"))
    content = <ProductDetail data={data} slug={path.split("/")[2]} />;
  else if (path === "/cart") content = <Cart data={data} />;
  else if (path === "/checkout") content = <Checkout data={data} />;
  else if (path === "/wishlist") content = <Wishlist data={data} />;
  else if (["/login", "/register", "/forgot-password"].includes(path))
    content = <Auth mode={path.slice(1)} />;
  else if (path === "/account" || path === "/account/orders")
    content = <Account />;
  else if (path.startsWith("/journal"))
    content = <Journal data={data} slug={path.split("/")[2]} />;
  else if (path === "/events") content = <Events data={data} />;
  else if (path === "/contact") content = <Contact />;
  else if (path === "/reset-password") content = <ResetPassword />;
  else if (path === "/track-order") content = <Track />;
  else content = <Content page={path.slice(1)} />;
  return (
    <>
      <WebTools products={data.products} />
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
      {content}
      <Footer />
    </>
  );
}
