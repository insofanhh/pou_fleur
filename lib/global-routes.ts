// These pages belong to the account/platform, not to a default flower store.
export function globalPageTitle(parts: string[]): string | null {
  const path = parts.join("/");
  const titles: Record<string, string> = {
    account: "Tài khoản",
    "account/orders": "Đơn hàng của tôi",
    login: "Đăng nhập",
    register: "Đăng ký",
    "forgot-password": "Quên mật khẩu",
    "reset-password": "Đặt lại mật khẩu",
    cart: "Giỏ hàng",
    start: "Mở cửa hàng",
    "start/pending": "Cửa hàng đang chờ duyệt",
    inbox: "Thông báo",
    join: "Tham gia cửa hàng",
  };
  return Object.hasOwn(titles, path) ? titles[path] : null;
}

export function isGlobalAPI(parts: string[], method: string): boolean {
  const path = parts.join("/");
  if (parts[0] === "platform") return true;
  const methods: Record<string, string[]> = {
    "auth/me": ["GET"],
    "auth/login": ["POST"],
    "auth/register": ["POST"],
    "auth/logout": ["POST"],
    "auth/forgot-password": ["POST"],
    "auth/reset-password": ["POST"],
    "auth/ghost/stop": ["POST"],
    account: ["PATCH"],
    "account/password": ["POST"],
    orders: ["GET"],
    "billing/plans": ["GET"],
    stores: ["GET", "POST"],
    "stores/mine": ["GET"],
    "stores/cart-info": ["GET"],
    "invitations/accept": ["POST"],
    inbox: ["GET"],
    "inbox/read": ["POST"],
    push: ["POST", "DELETE"],
    "goong/search": ["GET"],
    "goong/detail": ["GET"],
  };
  // Both handlers verify ownership before entering the order's actual store scope.
  if (method === "POST" && /^orders\/\d+\/(cancel|reorder)$/.test(path))
    return true;
  return Object.hasOwn(methods, path) && methods[path].includes(method);
}
