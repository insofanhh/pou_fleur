"use client";
import Link from "./routing";
import FlowerImage from "./flower-image";
import { ProductCard } from "./home";
import { api, useShop } from "./context";
import type { Catalog } from "@/lib/types";
import { ArrowUpRight, Flower2, Clock, MapPin } from "lucide-react";
export default function TemplateHome({ data }: { data: Catalog }) {
  const s = data.store,
    t = s.theme,
    { toast } = useShop(),
    products = data.products.slice(0, t.template === "modern" ? 8 : 6);
  const photo = (
    <div className="template-home-photo">
      <FlowerImage
        src={s.cover || "/images/hero.jpg"}
        alt={s.name}
        eager
        sizes="(max-width:700px) 100vw,60vw"
      />
    </div>
  );
  const intro = (
    <div className="template-home-intro">
      <span className="eyebrow">{s.name} · FLORAL STUDIO</span>
      <h1>{t.hero}</h1>
      <p>{t.story}</p>
      <Link
        className={"button" + (t.template === "modern" ? " light" : "")}
        href="/shop"
      >
        Khám phá hoa <ArrowUpRight size={18} />
      </Link>
    </div>
  );
  return (
    <main className={"template-home template-home-" + t.template}>
      {t.template === "editorial" ? (
        <>
          <header className="editorial-title">
            <span className="eyebrow">THE JOURNAL OF {s.name}</span>
            <h1>{t.hero}</h1>
          </header>
          <section className="template-home-hero">
            {photo}
            <div className="template-editorial-caption">
              <span>01 / THE EVERYDAY COLLECTION</span>
              <p>{t.story}</p>
              <Link href="/shop" className="text-link">
                Xem bộ sưu tập ↗
              </Link>
            </div>
          </section>
        </>
      ) : (
        <section className="template-home-hero">
          {t.template === "garden" ? (
            <>
              {photo}
              {intro}
            </>
          ) : (
            <>
              {intro}
              {photo}
            </>
          )}
        </section>
      )}
      {t.template === "modern" && (
        <nav className="template-categories" aria-label="Danh mục sản phẩm">
          {data.categories.map((c) => (
            <Link key={c.id} href={"/shop?category=" + c.id}>
              {c.name} ↗
            </Link>
          ))}
        </nav>
      )}
      {t.template === "atelier" && (
        <section className="atelier-statement">
          <span className="eyebrow">A PERSONAL APPROACH</span>
          <h2>
            Được làm riêng.
            <br />
            Được trao bằng cả sự tận tâm.
          </h2>
          <p>
            {s.description ||
              "Mỗi thiết kế bắt đầu từ câu chuyện của bạn, được florist hoàn thiện thủ công bằng những cành hoa theo mùa."}
          </p>
        </section>
      )}
      <section className="section template-products">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SELECTED FOR YOU</span>
            <h2>
              {t.template === "garden"
                ? "Một khu vườn nhỏ."
                : t.template === "atelier"
                  ? "Những thiết kế riêng."
                  : t.template === "modern"
                    ? "Chọn hoa. Gửi ngay."
                    : "The floral edit."}
            </h2>
          </div>
          <Link className="text-link" href="/shop">
            Tất cả thiết kế ↗
          </Link>
        </div>
        <div className="product-grid">
          {products.map((p) => (
            <ProductCard p={p} key={p.id} />
          ))}
        </div>
        {!products.length && (
          <p className="empty">
            Cửa hàng đang chuẩn bị những thiết kế mới. Hãy quay lại sớm nhé.
          </p>
        )}
      </section>
      {t.template === "garden" && (
        <section className="garden-care">
          <Flower2 size={42} />
          <h2>Giữ một chút đẹp đẽ, lâu hơn.</h2>
          <p>
            Thay nước mỗi ngày, cắt chéo gốc và giữ hoa ở nơi thoáng mát. Những
            chăm chút nhỏ làm nên nhiều ngày thật đẹp.
          </p>
          <Link className="text-link" href="/journal">
            Chuyện chăm hoa ↗
          </Link>
        </section>
      )}
      {t.template === "atelier" && (
        <section className="atelier-consultation">
          <div>
            <span className="eyebrow">FLOWERS FOR YOUR MOMENTS</span>
            <h2>
              Một dịp đặc biệt.
              <br />
              Một ý tưởng của riêng bạn.
            </h2>
            <p>
              Trao đổi với studio về hoa cưới, không gian sự kiện hoặc một món
              quà được thiết kế riêng.
            </p>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              try {
                await api(
                  "contact",
                  "POST",
                  Object.fromEntries(new FormData(form)),
                );
                form.reset();
                toast("Studio đã nhận yêu cầu tư vấn của bạn.");
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <label className="field">
              Tên của bạn
              <input name="name" minLength={2} required />
            </label>
            <label className="field">
              Email
              <input name="email" type="email" required />
            </label>
            <label className="field">
              Ý tưởng của bạn
              <textarea
                name="message"
                minLength={10}
                maxLength={3000}
                required
              />
            </label>
            <button className="button">Gửi lời hẹn</button>
          </form>
        </section>
      )}
      {t.template === "editorial" && (
        <section className="editorial-story">
          {photo}
          <div>
            <span className="eyebrow">BEHIND THE STEMS</span>
            <h2>Câu chuyện của {s.name}.</h2>
            <p>{s.description || t.story}</p>
            <Link href="/about" className="text-link">
              Ghé thăm studio ↗
            </Link>
          </div>
        </section>
      )}
      <section className="template-contact">
        <div>
          <MapPin size={23} />
          <h3>{s.name}</h3>
          <p>{s.address || "Thiết kế hoa theo yêu cầu"}</p>
        </div>
        <div>
          <Clock size={23} />
          <h3>Giao hoa theo lịch hẹn</h3>
          <p>
            {s.settings.lead_minutes} phút chuẩn bị · Nhận lịch trước{" "}
            {s.settings.advance_days} ngày
          </p>
        </div>
        <Link className="button secondary" href="/contact">
          Liên hệ studio ↗
        </Link>
      </section>
    </main>
  );
}
