"use client";
import Brand from "@/components/brand";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="admin-gate">
      <span className="logo"><Brand /></span>
      <h1>Fleurious cần một chút thời gian.</h1>
      <p>Không thể tải dữ liệu cửa hàng. Vui lòng thử lại sau ít phút.</p>
      <button className="button" onClick={reset}>
        Thử lại
      </button>
    </main>
  );
}
