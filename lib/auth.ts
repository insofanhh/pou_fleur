import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { cookies } from "next/headers";
import { query, mutate } from "./db";
import type { User } from "./types";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function passwordHash(p: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(p, salt, 64).toString("hex");
}
export function checkPassword(p: string, h: string) {
  const [salt, hash] = h.split(":");
  if (!salt || !hash) return false;
  const computed = scryptSync(p, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    expected.length === computed.length && timingSafeEqual(computed, expected)
  );
}
export async function currentUser() {
  const token = (await cookies()).get("fleur_session")?.value;
  if (!token) return null;
  const rows = await query<User[]>(
    "SELECT u.id,u.name,u.email,u.phone,u.role,u.birthday,u.address,u.marketing_consent FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.active=1",
    [digest(token)],
  );
  return rows[0] || null;
}
export async function setSession(id: number) {
  const token = randomBytes(32).toString("hex");
  await mutate(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))",
    [digest(token), id],
  );
  (await cookies()).set("fleur_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_ORIGIN || "").startsWith("https://"),
    path: "/",
    maxAge: 604800,
  });
}
export async function clearSession() {
  const jar = await cookies();
  const token = jar.get("fleur_session")?.value;
  if (token)
    await mutate("DELETE FROM sessions WHERE token_hash=?", [digest(token)]);
  jar.delete("fleur_session");
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const permissions: Record<string, string[]> = {
  admin: [
    "overview",
    "products",
    "categories",
    "orders",
    "promotions",
    "events",
    "posts",
    "users",
    "crm",
    "inquiries",
    "audit",
    "emails",
    "email_templates",
  ],
  manager: [
    "overview",
    "products",
    "categories",
    "orders",
    "promotions",
    "events",
    "crm",
    "inquiries",
    "emails",
    "email_templates",
  ],
  editor: ["posts", "events"],
  support: ["orders", "crm", "inquiries", "emails"],
};
export async function requirePermission(area: string) {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
  if (!permissions[user.role]?.includes(area))
    throw new HttpError(403, "Bạn không có quyền thực hiện thao tác này.");
  return user;
}
export async function throttle(key: string, limit = 8) {
  const k = digest(key);
  await mutate(
    "INSERT INTO login_attempts(attempt_key,attempts,expires_at) VALUES(?,1,DATE_ADD(NOW(),INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<NOW(),1,attempts+1),expires_at=IF(expires_at<NOW(),DATE_ADD(NOW(),INTERVAL 15 MINUTE),expires_at)",
    [k],
  );
  const [r] = await query<{ attempts: number }[]>(
    "SELECT attempts FROM login_attempts WHERE attempt_key=?",
    [k],
  );
  if (r.attempts > limit)
    throw new HttpError(
      429,
      "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.",
    );
}
