"use client";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps } from "react";
export function storeRef(path: string) {
  return path.match(/^\/(?:s|workspace)\/([^/]+)/)?.[1] || "fleur";
}
export function localPath(path: string) {
  return path.startsWith("/s/")
    ? path.replace(/^\/s\/[^/]+/, "") || "/"
    : path.startsWith("/workspace/")
      ? path.replace(/^\/workspace\/[^/]+/, "/admin")
      : path;
}
export function scopedHref(href: string, path: string, slug?: string) {
  const store = path.match(/^\/s\/([^/]+)/)?.[1];
  const workspace = path.match(/^\/workspace\/([^/]+)/)?.[1];
  if ((store || workspace) && /^\/(login|register)\?/.test(href)) {
    const target = new URL(href, "https://fleur.invalid");
    const next = target.searchParams.get("next");
    if (next && /^\/(checkout|cart|shop|product|admin)(?:[/?]|$)/.test(next)) {
      target.searchParams.set("next", scopedHref(next, path, slug));
      return target.pathname + target.search;
    }
  }
  if (href.startsWith("/admin") && workspace)
    return "/workspace/" + workspace + href.slice(6);
  if (workspace && href === "/") return "/s/" + (slug || "fleur");
  const global = [
    "/account",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/platform",
    "/workspace",
    "/start",
    "/inbox",
    "/join",
  ];
  if (
    store &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !global.some(
      (p) => href === p || href.startsWith(p + "/") || href.startsWith(p + "?"),
    ) &&
    !href.startsWith("/s/")
  )
    return "/s/" + store + (href === "/" ? "" : href);
  return href;
}
export function useLocalPath() {
  return localPath(usePathname());
}
export function useScopedRouter() {
  const router = useRouter(),
    path = usePathname();
  return {
    ...router,
    push: (href: string) => router.push(scopedHref(href, path)),
    replace: (href: string) => router.replace(scopedHref(href, path)),
  };
}
export default function Link(props: ComponentProps<typeof NextLink>) {
  const path = usePathname();
  return (
    <NextLink
      {...props}
      href={
        typeof props.href === "string"
          ? scopedHref(props.href, path)
          : props.href
      }
    />
  );
}
