// Shared by server-rendered CSS and the viewport observer.
export const sectionSelector = [
  "section",
  "[data-fade-in]",
  ".section",
  ".benefits",
  ".page-heading",
  ".shop-tools",
  ".product-grid",
  ".detail-photo",
  ".detail-info",
  ".auth-art",
  ".auth-panel",
  ".account-nav",
  ".journal-grid",
  ".event-list",
  ".contact-layout > div",
  ".contact-layout > form",
  ".panel",
  ".order-card",
  ".order-summary",
  ".checkout-layout > div:not(.checkout-form)",
  ".success-card",
  ".empty",
  ".article",
  ".admin-gate",
  ".admin-heading",
  ".stat-grid",
  ".admin-table-panel",
  ".role-explainer",
  ".crm-summary",
  ".email-stats",
  ".email-tabs",
  ".faq-item",
  "footer",
].join(", ");
export const excludedSelector = "dialog, [role='dialog'], [data-no-fade-in]";
const target = `:where(${sectionSelector})`;

// The initial animation is available in the HTML head, before hydration.
// Without JavaScript, it simply finishes with all content visible.
export const sectionMotionStyles = `
  ${target} {
    animation: section-fade-in 650ms cubic-bezier(.25,.1,.25,1);
  }
  ${target} ${target},
  :where(${excludedSelector}) ${target},
  ${target}:where(${excludedSelector}) {
    animation: none;
  }
  /* Keep the animation timeline intact so blur cannot restart the fade. */
  ${target}:focus-within {
    opacity: 1 !important;
  }
  @media (prefers-reduced-motion: reduce), print {
    ${target} {
      opacity: 1 !important;
      animation: none !important;
    }
  }
`;
