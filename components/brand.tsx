export default function Brand() {
  return (
    <span className="brand-logo" role="img" aria-label="Fleurious">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <g fill="currentColor">
          <path d="M25 33C29 27 37 24 44 25C45 25 45 26 44 27C39 33 33 37 26 35C24 35 24 34 25 33Z" />
          <path d="M23 45C16 46 11 42 9 36C9 35 10 35 11 35C17 36 21 40 23 45Z" />
          <ellipse cx="47" cy="7.8" rx="4.4" ry="6.2" transform="rotate(-10 47 15)" />
          <ellipse cx="54" cy="12.7" rx="6" ry="4.2" transform="rotate(-28 54 12.7)" />
          <ellipse cx="51.5" cy="21" rx="4.3" ry="6" transform="rotate(-28 51.5 21)" />
          <ellipse cx="42.5" cy="21" rx="4.3" ry="6" transform="rotate(28 42.5 21)" />
          <ellipse cx="40" cy="12.7" rx="6" ry="4.2" transform="rotate(28 40 12.7)" />
          <circle cx="47" cy="15" r="5.8" />
        </g>
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 57C26 45 22 33 21 23C19.5 10 31.5 8.5 43 15" strokeWidth="4.7" />
          <path d="M23 35C28 35 33 32 37 30" strokeWidth="2.8" />
        </g>
        <circle cx="47" cy="15" r="2.6" fill="var(--brand-cutout, #fff)" />
        <path d="M27 33Q33 31 39 28" fill="none" stroke="var(--brand-cutout, #fff)" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <b className="brand-wordmark" aria-hidden="true">
        fleurious
      </b>
    </span>
  );
}
