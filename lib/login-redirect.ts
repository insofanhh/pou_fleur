export function loginDestination(user: any, next: string | null) {
  if (
    next &&
    /^\/(?!\/)/.test(next) &&
    !next.includes("\\") &&
    !/[\r\n]/.test(next)
  ) {
    if (next.startsWith("/platform"))
      return user.platformRole === "platform_admin" ? next : "/";
    const match = next.match(/^\/workspace\/(\d+)(?:\/|$)/);
    if (match)
      return user.memberships?.some((m: any) => m.store_id === Number(match[1]))
        ? next
        : "/";
    if (!next.startsWith("/admin")) return next;
  }
  if (user.platformRole === "platform_admin") return "/platform";
  const m = user.memberships?.[0];
  return m
    ? `/workspace/${m.store_id}` +
        (m.role === "editor" ? "/posts" : m.role === "support" ? "/board" : "")
    : "/";
}
