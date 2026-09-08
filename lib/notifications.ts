import { currentUser, HttpError, permissions } from "./auth";
import { query } from "./db";
import type { AdminNotification } from "./notification-types";

export async function adminNotifications() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
  const allowed = permissions[user.role];
  if (!allowed) throw new HttpError(403, "Bạn không có quyền xem thông báo.");
  // Read existing event records. No migration or duplicate event writes needed.
  // Permission checks happen before each source is queried.
  const sources = [
    {
      area: "orders",
      title: "Đơn hàng mới",
      sql: "SELECT id, CONCAT(reference, ' · ', customer_name) AS detail, UNIX_TIMESTAMP(created_at)*1000 AS createdAt FROM orders ORDER BY id DESC LIMIT 30",
    },
    {
      area: "inquiries",
      title: "Yêu cầu hỗ trợ mới",
      sql: "SELECT id, name AS detail, UNIX_TIMESTAMP(created_at)*1000 AS createdAt FROM inquiries ORDER BY id DESC LIMIT 30",
    },
    {
      area: "users",
      title: "Người dùng mới",
      sql: "SELECT id, name AS detail, UNIX_TIMESTAMP(created_at)*1000 AS createdAt FROM users ORDER BY id DESC LIMIT 30",
    },
  ] as const;
  const batches = await Promise.all(
    sources
      .filter((s) => allowed.includes(s.area))
      .map(async (source) => {
        const rows = await query<
          { id: number; detail: string; createdAt: number }[]
        >(source.sql);
        return rows.map(
          (row) =>
            ({
              key: `${source.area}:${row.id}`,
              type: source.area,
              title: source.title,
              detail: row.detail,
              createdAt: Number(row.createdAt),
              href: `/admin/${source.area}`,
            }) satisfies AdminNotification,
        );
      }),
  );
  return {
    userId: user.id,
    items: batches
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt || b.key.localeCompare(a.key)),
  };
}
