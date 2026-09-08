"use client";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FlowerImage from "./flower-image";
import { productImages, imageSwipeStep } from "@/lib/product-images";
import type { Product } from "@/lib/types";

export default function ProductGallery({ product }: { product: Product }) {
  const images = productImages(product);
  const [index, setIndex] = useState(0);
  const current = Math.min(index, images.length - 1);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  function select(next: number) {
    const target = (next + images.length) % images.length;
    setIndex(target);
    const item = thumbs.current?.children[target] as HTMLElement | undefined;
    if (item && thumbs.current) {
      thumbs.current.scrollTo({
        left:
          item.offsetLeft -
          thumbs.current.offsetLeft -
          thumbs.current.clientWidth / 2 +
          item.clientWidth / 2,
        behavior: "auto",
      });
    }
  }
  return (
    <div
      className="product-gallery"
      data-fade-in
      role="region"
      aria-label={`Ảnh ${product.name}`}
    >
      <div
        className="detail-photo gallery-main"
        tabIndex={images.length > 1 ? 0 : undefined}
        aria-label={
          images.length > 1
            ? "Dùng mũi tên trái/phải hoặc vuốt để xem ảnh"
            : undefined
        }
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            select(current + (e.key === "ArrowLeft" ? -1 : 1));
          }
        }}
        onTouchStart={(e) => {
          touch.current =
            e.touches.length === 1
              ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
              : null;
        }}
        onTouchCancel={() => {
          touch.current = null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start || images.length < 2 || !e.changedTouches[0]) return;
          const dx = e.changedTouches[0].clientX - start.x,
            dy = e.changedTouches[0].clientY - start.y;
          const step = imageSwipeStep(dx, dy);
          if (step) select(current + step);
        }}
      >
        <FlowerImage
          src={images[current]}
          alt={`${product.name} — ảnh ${current + 1}`}
          sizes="(max-width: 700px) 90vw, 44vw"
          eager
        />
        <span className="badge">{product.badge || "Thiết kế bởi Fleur"}</span>
        {images.length > 1 && (
          <>
            <button
              type="button"
              className="gallery-arrow previous"
              aria-label="Ảnh trước"
              onClick={() => select(current - 1)}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="gallery-arrow next"
              aria-label="Ảnh sau"
              onClick={() => select(current + 1)}
            >
              <ChevronRight size={22} />
            </button>
            <span
              className="gallery-counter"
              aria-live="polite"
              aria-atomic="true"
            >
              {current + 1} / {images.length}
            </span>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div
          className="gallery-thumbnails"
          ref={thumbs}
          aria-label="Chọn ảnh sản phẩm"
        >
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              aria-label={`Xem ảnh ${i + 1}`}
              aria-pressed={current === i}
              className={current === i ? "selected" : ""}
              onClick={() => select(i)}
            >
              <FlowerImage
                src={src}
                alt={`${product.name} — ảnh thu nhỏ ${i + 1}`}
                sizes="80px"
                width={120}
                height={150}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
