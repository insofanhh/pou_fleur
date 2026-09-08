"use client";
import { useRef, useState } from "react";
import {
  ImagePlus,
  Upload,
  X,
  ChevronLeft,
  ChevronRight,
  Star,
} from "lucide-react";
import {
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  productImages,
} from "@/lib/product-images";

type Props = {
  image: string;
  gallery?: unknown;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
};
export default function ProductMediaEditor({
  image,
  gallery,
  disabled,
  onBusy,
}: Props) {
  const [images, setImages] = useState(() => productImages({ image, gallery }));
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const uploading = useRef(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const albumInput = useRef<HTMLInputElement>(null);
  const remaining = MAX_PRODUCT_IMAGES - images.length;
  function move(index: number, to: number) {
    setImages((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item);
      return next;
    });
  }
  async function upload(files: File[], replace = false) {
    if (disabled || uploading.current || !files.length) return;
    setError("");
    const capacity = replace ? 1 : remaining;
    if (files.length > capacity) {
      setError(
        `Chọn tối đa ${capacity} ảnh nữa. Mỗi sản phẩm có tối đa ${MAX_PRODUCT_IMAGES} ảnh.`,
      );
      return;
    }
    const invalid = files.find(
      (f) =>
        !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
        f.size > MAX_IMAGE_BYTES,
    );
    if (invalid) {
      setError(
        `${invalid.name}: cần dùng JPG, PNG hoặc WebP, tối đa 4 MB mỗi ảnh.`,
      );
      return;
    }
    uploading.current = true;
    onBusy(true);
    const failures: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setPending(`Đang tải ${i + 1}/${files.length}: ${file.name}`);
        try {
          const body = new FormData();
          body.set("file", file);
          const response = await fetch("/api/upload", { method: "POST", body });
          const result = await response
            .json()
            .catch(() => ({
              error: "Máy chủ không nhận được ảnh. Vui lòng thử lại.",
            }));
          if (!response.ok || !result.url)
            throw Error(result.error || "Không thể tải ảnh lên.");
          setImages((current) => [
            ...new Set(
              replace
                ? [result.url, ...current.slice(1)]
                : [...current, result.url],
            ),
          ]);
        } catch (e) {
          failures.push(`${file.name}: ${(e as Error).message}`);
        }
      }
      setError(failures.join("\n"));
    } finally {
      uploading.current = false;
      setPending("");
      onBusy(false);
    }
  }
  return (
    <div className="product-media-editor span-2">
      <input type="hidden" name="image" value={images[0] || ""} />
      <input
        type="hidden"
        name="gallery"
        value={JSON.stringify(images.slice(1))}
      />
      <div className="media-heading">
        <div>
          <strong>Hình ảnh thiết kế</strong>
          <p>1 ảnh đại diện và album · JPG, PNG, WebP · tối đa 4 MB/ảnh</p>
        </div>
        <span>
          {images.length}/{MAX_PRODUCT_IMAGES}
        </span>
      </div>
      <div className="media-cover-row">
        <div className="media-cover-preview">
          {images[0] ? (
            <img src={images[0]} alt="Ảnh đại diện sản phẩm" />
          ) : (
            <ImagePlus size={32} />
          )}
        </div>
        <div>
          <strong>Ảnh đại diện</strong>
          <p>
            Hiển thị trên danh sách sản phẩm và là ảnh đầu tiên trong album.
          </p>
          <button
            type="button"
            className="button outline compact"
            disabled={disabled}
            onClick={() => coverInput.current?.click()}
          >
            <Upload size={15} />
            {images[0] ? "Thay ảnh đại diện" : "Chọn ảnh đại diện"}
          </button>
          {images[0] && (
            <button
              type="button"
              className="media-text-button"
              disabled={disabled}
              onClick={() => setImages((current) => current.slice(1))}
            >
              Xóa ảnh đại diện
            </button>
          )}
        </div>
      </div>
      <input
        ref={coverInput}
        className="media-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Tải ảnh đại diện"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void upload(files, true);
        }}
      />
      <input
        ref={albumInput}
        className="media-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        aria-label="Tải nhiều ảnh album"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void upload(files);
        }}
      />
      <button
        type="button"
        className={`media-dropzone${dragging ? " dragging" : ""}`}
        disabled={disabled || remaining === 0}
        onClick={() => albumInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <ImagePlus size={24} />
        <strong>Thêm ảnh vào album</strong>
        <span>Chọn nhiều ảnh cùng lúc hoặc kéo thả vào đây</span>
      </button>
      {!!images.length && (
        <div className="media-image-list">
          {images.map((src, i) => (
            <div className="media-image-card" key={src}>
              <img
                src={src}
                alt={i === 0 ? "Ảnh đại diện" : `Ảnh album ${i}`}
              />
              <span className="media-image-label">
                {i === 0 ? "Đại diện" : `Ảnh ${i + 1}`}
              </span>
              <div className="media-image-actions">
                <button
                  type="button"
                  disabled={disabled || i === 0}
                  aria-label={`Đặt ảnh ${i + 1} làm đại diện`}
                  title="Đặt làm đại diện"
                  onClick={() => move(i, 0)}
                >
                  <Star size={14} fill={i === 0 ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  disabled={disabled || i === 0}
                  aria-label={`Chuyển ảnh ${i + 1} sang trái`}
                  onClick={() => move(i, i - 1)}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  disabled={disabled || i === images.length - 1}
                  aria-label={`Chuyển ảnh ${i + 1} sang phải`}
                  onClick={() => move(i, i + 1)}
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Xóa ảnh ${i + 1}`}
                  onClick={() =>
                    setImages((current) => current.filter((_, n) => n !== i))
                  }
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <details className="media-url">
        <summary>Hoặc thêm ảnh bằng đường dẫn</summary>
        <div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-label="Đường dẫn ảnh album"
            disabled={disabled}
          />
          <button
            type="button"
            className="button outline compact"
            disabled={disabled || !remaining}
            onClick={() => {
              if (!/^https:\/\/[^\s]+$/.test(url.trim())) {
                setError("Nhập đường dẫn ảnh HTTPS hợp lệ.");
                return;
              }
              setImages((current) => [...new Set([...current, url.trim()])]);
              setUrl("");
              setError("");
            }}
          >
            Thêm ảnh
          </button>
        </div>
      </details>
      {pending && (
        <p className="media-progress" role="status">
          {pending}
        </p>
      )}
      {error && (
        <p className="error media-errors" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
