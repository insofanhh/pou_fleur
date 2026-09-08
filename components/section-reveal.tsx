"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Content blocks only: navigation, individual fields and table rows stay steady.
const sectionSelector = [
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
const excludedSelector = "dialog, [role='dialog'], [data-no-fade-in]";
const revealClass = "section-fade-in";

export default function SectionReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!("IntersectionObserver" in window)) return;

    const seen = new WeakSet<Element>();
    const tracked = new Set<HTMLElement>();
    const reveal = (element: HTMLElement) => {
      observer.unobserve(element);
      if (!element.isConnected || preference.matches) return;
      element.classList.add(revealClass);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) reveal(entry.target as HTMLElement);
      },
      { threshold: 0 },
    );
    const register = (element: HTMLElement) => {
      if (seen.has(element) || element.closest(excludedSelector)) return;
      // Avoid fading a section and its child blocks at the same time.
      if (element.parentElement?.closest(sectionSelector)) return;
      seen.add(element);
      tracked.add(element);
      if (!preference.matches) observer.observe(element);
    };
    const scan = (root: Element) => {
      if (root instanceof HTMLElement && root.matches(sectionSelector))
        register(root);
      root.querySelectorAll<HTMLElement>(sectionSelector).forEach(register);
    };
    const changes = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes)
          if (added instanceof Element) scan(added);
      }
      // Release removed admin panels and route content instead of retaining them.
      for (const element of tracked)
        if (!element.isConnected) {
          observer.unobserve(element);
          tracked.delete(element);
        }
    });
    const onPreferenceChange = () => {
      if (preference.matches) {
        observer.disconnect();
        for (const element of tracked) element.classList.remove(revealClass);
      }
      // Do not replay content already seen when the preference changes back.
    };
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      event.target.closest("." + revealClass)?.classList.remove(revealClass);
    };

    scan(document.body);
    changes.observe(document.body, { childList: true, subtree: true });
    preference.addEventListener("change", onPreferenceChange);
    document.addEventListener("focusin", onFocus);

    return () => {
      observer.disconnect();
      changes.disconnect();
      preference.removeEventListener("change", onPreferenceChange);
      document.removeEventListener("focusin", onFocus);
      for (const element of tracked) element.classList.remove(revealClass);
    };
  }, [pathname]);

  return null;
}
