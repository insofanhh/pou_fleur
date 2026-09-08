import Link from "next/link";
export default function NotFound() {
  return (
    <main className="admin-gate">
      <Link className="logo" href="/">
        fleur<span>®</span>
      </Link>
      <span className="eyebrow">404 — A LITTLE DETOUR</span>
      <h1>Hoa ở một lối khác.</h1>
      <p>Trang bạn tìm không tồn tại hoặc đã được chuyển đi.</p>
      <Link href="/shop" className="button">
        Trở lại cửa hàng →
      </Link>
    </main>
  );
}
