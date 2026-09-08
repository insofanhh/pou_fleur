"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { sectionSelector, excludedSelector } from "@/lib/section-motion";

type Motion = {
  state: "waiting" | "visible";
  animation?: Animation;
};

export default function SectionReveal() {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);

  useLayoutEffect(() => {
    const newPage =
      previousPath.current !== null && previousPath.current !== pathname;
    previousPath.current = pathname;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (
      !("IntersectionObserver" in window) ||
      !("animate" in Element.prototype)
    )
      return;

    const tracked = new Map<HTMLElement, Motion>();
    const setState = (element: HTMLElement, state: Motion["state"]) => {
      const motion = tracked.get(element);
      if (!motion || motion.state === state) return;
      motion.animation?.cancel();
      motion.state = state;
      // Streaming boundaries can hydrate after this layout effect. WAAPI keeps
      // motion outside React's HTML attributes, even for not-yet-hydrated nodes.
      motion.animation =
        state === "waiting"
          ? element.animate([{ opacity: 0 }, { opacity: 0 }], {
              duration: 0,
              fill: "both",
            })
          : element.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 650,
              easing: "cubic-bezier(.25,.1,.25,1)",
            });
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
            setState(element, "waiting");
          }
        }
      },
      { threshold: 0, rootMargin: "64px 0px" },
    );
    const register = (element: HTMLElement, routeEntry = false) => {
      if (tracked.has(element) || element.closest(excludedSelector)) return;
      if (element.parentElement?.closest(sectionSelector)) return;
      tracked.set(element, { state: "visible" });
      if (preference.matches) return;
      const rect = element.getBoundingClientRect();
      const outside = rect.bottom <= 0 || rect.top >= window.innerHeight;
      if (!element.matches(":focus-within")) {
        if (outside) setState(element, "waiting");
        else if (routeEntry) {
          tracked.get(element)!.state = "waiting";
          setState(element, "visible");
        }
      }
      // Initial visible content keeps the server CSS animation's timeline.
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
      for (const [element, motion] of tracked)
        if (!element.isConnected) {
          observer.unobserve(element);
          motion.animation?.cancel();
          tracked.delete(element);
        }
    });
    const onPreferenceChange = () => {
      observer.disconnect();
      for (const [element, motion] of tracked) {
        motion.animation?.cancel();
        motion.animation = undefined;
        motion.state = "visible";
        if (!preference.matches) observer.observe(element);
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      let element: Element | null = event.target;
      while (element) {
        if (element instanceof HTMLElement && tracked.has(element)) {
          const motion = tracked.get(element)!;
          // Keyboard focus must reveal content immediately, without a fade.
          motion.animation?.cancel();
          motion.animation = undefined;
          motion.state = "visible";
          break;
        }
        element = element.parentElement;
      }
    };

    scan(document.body, newPage);
    changes.observe(document.body, { childList: true, subtree: true });
    preference.addEventListener("change", onPreferenceChange);
    document.addEventListener("focusin", onFocus);

    return () => {
      observer.disconnect();
      changes.disconnect();
      preference.removeEventListener("change", onPreferenceChange);
      document.removeEventListener("focusin", onFocus);
      for (const motion of tracked.values()) motion.animation?.cancel();
    };
  }, [pathname]);

  return null;
}
