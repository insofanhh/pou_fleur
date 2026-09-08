"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { sectionSelector, excludedSelector } from "@/lib/section-motion";

export default function SectionReveal() {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);

  useLayoutEffect(() => {
    const newPage =
      previousPath.current !== null && previousPath.current !== pathname;
    previousPath.current = pathname;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!("IntersectionObserver" in window)) return;

    const tracked = new Set<HTMLElement>();
    const setState = (element: HTMLElement, state: "waiting" | "visible") => {
      if (element.dataset.fadeState !== state)
        element.dataset.fadeState = state;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          if (!element.isConnected || preference.matches) continue;
          if (entry.isIntersecting) {
            setState(element, "visible");
          } else if (!element.matches(":focus-within")) {
            // Re-arm only completely outside the viewport + buffer.
            // Hovering near the screen edge never resets a visible section.
            setState(element, "waiting");
          }
        }
      },
      { threshold: 0, rootMargin: "64px 0px" },
    );
    const register = (element: HTMLElement, routeEntry = false) => {
      if (tracked.has(element) || element.closest(excludedSelector)) return;
      if (element.parentElement?.closest(sectionSelector)) return;
      tracked.add(element);
      if (preference.matches) return;
      const rect = element.getBoundingClientRect();
      const outside = rect.bottom <= 0 || rect.top >= window.innerHeight;
      if (outside || routeEntry) setState(element, "waiting");
      // For initial, already-visible content, retain the CSS animation's
      // existing timeline. Never restart it after hydration.
      else setState(element, "visible");
      observer.observe(element);
    };
    const scan = (root: Element, routeEntry = false) => {
      if (root instanceof HTMLElement && root.matches(sectionSelector))
        register(root, routeEntry);
      root
        .querySelectorAll<HTMLElement>(sectionSelector)
        .forEach((el) => register(el, routeEntry));
    };
    const changes = new MutationObserver((records) => {
      for (const record of records)
        for (const added of record.addedNodes)
          if (added instanceof Element) scan(added);
      for (const element of tracked)
        if (!element.isConnected) {
          observer.unobserve(element);
          tracked.delete(element);
        }
    });
    const onPreferenceChange = () => {
      observer.disconnect();
      for (const element of tracked) {
        delete element.dataset.fadeState;
        if (!preference.matches) observer.observe(element);
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target.closest<HTMLElement>("[data-fade-state]");
      if (element) setState(element, "visible");
    };

    // Layout effect prepares new routes before paint. The first page is
    // already animated by server-rendered CSS, not an effect-added class.
    scan(document.body, newPage);
    changes.observe(document.body, { childList: true, subtree: true });
    preference.addEventListener("change", onPreferenceChange);
    document.addEventListener("focusin", onFocus);

    return () => {
      observer.disconnect();
      changes.disconnect();
      preference.removeEventListener("change", onPreferenceChange);
      document.removeEventListener("focusin", onFocus);
      for (const element of tracked) delete element.dataset.fadeState;
    };
  }, [pathname]);

  return null;
}
