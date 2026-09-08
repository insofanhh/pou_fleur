"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  Flower2,
  Truck,
  Gift,
  ShieldCheck,
  Plus,
} from "lucide-react";
import type { Catalog, Product } from "@/lib/types";
export const money = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(n) + " ₫";
export default function Home({ data }: { data: Catalog }) {
  return (
    <main>
      <section className="hero">
        <div className="hero-content">
          <div className="eyebrow">
            <span className="little-line" />
            THIÊN NHIÊN. ĐƯỢC NÂNG NIU.
          </div>
          <h1>
            Có những điều,
            <br />
            để hoa nói thay.
          </h1>
          <p>
            Một bó hoa nhỏ. Một lời thương lớn.
            <br />
            Gửi trao những cảm xúc chân thành, theo cách của bạn.
          </p>
          <Link href="/shop" className="button">
            Tìm bó hoa của bạn <ArrowUpRight size={18} />
          </Link>
          <div className="hero-foot">
            <span>01 — 03</span>
            <span className="slide-line" />
            <span>BỘ SƯU TẬP EVERYDAY BEAUTY</span>
          </div>
        </div>
        <div
          className="hero-photo"
          style={{ backgroundImage: "url(/images/hero.jpg)" }}
        >
          <span className="photo-label">
            Được chọn bằng mắt.
            <br />
            Được trao bằng tim.
          </span>
          <span className="vertical-caption">
            FLEUR FLORAL STUDIO — EST. 2026
          </span>
        </div>
      </section>
      <div className="benefits">
        <span>
          <Flower2 />
          Hoa tươi mỗi ngày
        </span>
        <span>
          <Truck />
          Giao hoa tận tay
        </span>
        <span>
          <Gift />
          Thiệp viết tay miễn phí
        </span>
        <span>
          <ShieldCheck />
          Chăm chút từng chi tiết
        </span>
      </div>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE FLEUR EDIT</span>
            <h2>Những bó hoa được yêu.</h2>
          </div>
          <Link href="/shop" className="text-link">
            Khám phá tất cả <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="category-pills">
          <Link className="active" href="/shop">
            Tất cả
          </Link>
          {data.categories.map((c) => (
            <Link key={c.id} href={"/shop?category=" + c.id}>
              {c.name}
            </Link>
          ))}
        </div>
        <div className="product-grid">
          {data.products.slice(0, 4).map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      </section>
      <section className="story-band">
        <div>
          <span className="eyebrow">JUST BECAUSE</span>
          <h2>
            Không cần một dịp.
            <br />
            Chỉ cần một người.
          </h2>
          <p>
            Vì những điều đẹp đẽ nhất đôi khi đến từ
            <br />
            một ngày bình thường.
          </p>
          <Link className="button light" href="/shop">
            Gửi một chút yêu thương <ArrowUpRight size={18} />
          </Link>
        </div>
        <Flower2 size={160} strokeWidth={0.45} />
      </section>
    </main>
  );
}
export function ProductCard({ p }: { p: Product }) {
  return (
    <article className="product-card">
      <Link className="product-image" href={"/product/" + p.slug}>
        <img src={p.image} alt={p.name} />
        {p.badge && <span className="badge">{p.badge}</span>}
        <span className="product-add">
          <Plus size={19} />
        </span>
      </Link>
      <div className="product-meta">
        <div>
          <p>{p.category}</p>
          <Link href={"/product/" + p.slug}>
            <h3>{p.name}</h3>
          </Link>
        </div>
        <span>{money(p.price)}</span>
      </div>
      <p className="product-flowers">{p.flowers}</p>
    </article>
  );
}
export function Footer() {
  return (
    <footer>
      <div className="footer-main">
        <div>
          <Link className="logo" href="/">
            fleur<span>®</span>
          </Link>
          <p>Hoa cho những điều không thể nói.</p>
        </div>
        <div>
          <h4>Khám phá Fleur</h4>
          <Link href="/shop">Tất cả sản phẩm</Link>
          <Link href="/events">Sự kiện & bộ sưu tập</Link>
          <Link href="/journal">Chuyện về hoa</Link>
        </div>
        <div>
          <h4>Luôn ở bên bạn</h4>
          <Link href="/contact">Liên hệ & tư vấn</Link>
          <Link href="/policies">Giao hàng & đổi trả</Link>
          <Link href="/faq">Câu hỏi thường gặp</Link>
        </div>
        <div>
          <h4>Kết nối</h4>
          <Link href="/account">Tài khoản của bạn</Link>
          <Link href="/wishlist">Hoa yêu thích</Link>
          <Link href="/admin">
            Fleur Workspace <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Fleur Floral Studio.</span>
        <span>Một chút hoa. Thật nhiều yêu thương.</span>
        <Link href="/privacy">Quyền riêng tư</Link>
      </div>
    </footer>
  );
}
