"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="admin-gate">
      <span className="logo">fleur®</span>
      <h1>Fleur cần một chút thời gian.</h1>
      <p>Không thể tải dữ liệu cửa hàng. Vui lòng thử lại sau ít phút.</p>
      <button className="button" onClick={reset}>
        Thử lại
      </button>
    </main>
  );
}
