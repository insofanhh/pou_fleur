export default function Brand() {
  return (
    <>
      fleurious<span>®</span>
    </>
  );
}

export function DashboardBrand() {
  return (
    <>
      <b className="dashboard-wordmark">
        <Brand />
      </b>
      <img
        className="dashboard-brand-mark"
        src="/brand/fleurious-mark.svg"
        width="40"
        height="40"
        alt=""
        aria-hidden="true"
      />
    </>
  );
}
