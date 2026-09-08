"use client";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import type { Catalog } from "@/lib/types";
import Home from "./home";
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
const Admin = dynamic(() => import("./admin"), {
  loading: () => (
    <p className="empty" role="status">
      Đang mở quản trị…
    </p>
  ),
});
export default function Store({ data }: { data: Catalog }) {
  const path = usePathname();
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
  return content;
}
