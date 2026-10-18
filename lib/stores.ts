import { query, mutate } from "./db";
import { currentUser, HttpError, permissions } from "./auth";
import { tenantId, withStore } from "./tenant";
export type StoreRecord = {
  id: number;
  slug: string;
  name: string;
  owner_id: number;
  status: string;
  description: string;
  address: string;
  lat: number | null;
  lng: number | null;
  radius_km: number;
  logo: string;
  cover: string;
  phone: string;
  settings: any;
  theme: any;
  draft_theme: any;
  version: number;
};
export const jsonValue = (v: any) =>
  typeof v === "string" ? JSON.parse(v) : v;
export async function storeBy(ref: string | number): Promise<StoreRecord> {
  const [s] = await query<StoreRecord[]>(
    "SELECT * FROM stores WHERE " +
      (/^\d+$/.test(String(ref)) ? "id" : "slug") +
      "=?",
    [ref],
  );
  if (!s) throw new HttpError(404, "Không tìm thấy cửa hàng.");
  return {
    ...s,
    description: s.description || "",
    logo: s.logo || "",
    cover: s.cover || "",
    settings: jsonValue(s.settings),
    theme: jsonValue(s.theme),
    draft_theme: jsonValue(s.draft_theme),
  };
}
export async function requestStore(req: Request) {
  return storeBy(req.headers.get("x-fleur-store") || "1");
}
export async function membership(area?: string) {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
  if (
    !user.role ||
    user.role === "customer" ||
    (area && !permissions[user.role]?.includes(area))
  )
    throw new HttpError(403, "Bạn không có quyền tại cửa hàng này.");
  return user;
}
export async function platformActor() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
  const [m] = await query<any[]>(
    "SELECT role FROM platform_memberships WHERE user_id=?",
    [user.id],
  );
  if (m?.role !== "platform_admin")
    throw new HttpError(403, "Chỉ quản trị nền tảng được thực hiện.");
  return user;
}
export async function storeOwner() {
  const u = await membership();
  if (u.role !== "owner")
    throw new HttpError(403, "Chỉ chủ cửa hàng được thực hiện.");
  return u;
}
export async function storeAudit(
  actor: number,
  action: string,
  entity: string,
  id: string,
) {
  await mutate(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
    [actor, action, entity, id],
  );
}
export function publicStore(s: StoreRecord) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    status: s.status,
    description: s.description,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    radius_km: s.radius_km,
    logo: s.logo,
    cover: s.cover,
    phone: s.phone,
    settings: s.settings,
    theme: s.theme,
  };
}
export function distanceKm(a: number, b: number, c: number, d: number) {
  const r = Math.PI / 180;
  return (
    6371 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(((c - a) * r) / 2) ** 2 +
            Math.cos(a * r) *
              Math.cos(c * r) *
              Math.sin(((d - b) * r) / 2) ** 2,
        ),
      ),
    )
  );
}
export async function assertStoreOpen() {
  const s = await storeBy(tenantId());
  if (s.status !== "approved" || !s.settings.open)
    throw new HttpError(409, "Cửa hàng hiện chưa nhận đơn mới.");
  const [sub] = await query<any[]>(
    "SELECT status FROM subscriptions WHERE store_id=?",
    [s.id],
  );
  if (!sub || !["free", "active", "past_due"].includes(sub.status))
    throw new HttpError(409, "Cửa hàng đang tạm ngưng nhận đơn.");
  return s;
}
export async function quota(
  kind: "products" | "staff" | "storage_mb",
  extra = 1,
) {
  const id = tenantId();
  const [plan] = await query<any[]>(
    "SELECT p.limits FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.store_id=?",
    [id],
  );
  if (!plan) throw new HttpError(409, "Chưa có gói dịch vụ.");
  const max = jsonValue(plan.limits)[kind];
  const sql =
    kind === "products"
      ? "SELECT COUNT(*) n FROM products WHERE active=1"
      : kind === "staff"
        ? "SELECT COUNT(*) n FROM store_memberships WHERE store_id=? AND status='active'"
        : "SELECT COALESCE(SUM(size),0)/1048576 n FROM assets";
  const [count] = await query<any[]>(sql, kind === "staff" ? [id] : []);
  if (Number(count.n) + extra > max)
    throw new HttpError(409, "Đã đạt giới hạn gói dịch vụ.");
}
