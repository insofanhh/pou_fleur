export default function Loading() {
  return (
    <main
      className="route-loading"
      role="status"
      aria-label="Đang tải trang"
      data-no-fade-in
    >
      <span>Đang mở trang…</span>
      <div className="loading-heading" aria-hidden="true" />
      <div className="loading-line" aria-hidden="true" />
      <div className="loading-grid" aria-hidden="true">
        <div />
        <div />
        <div />
      </div>
    </main>
  );
}
