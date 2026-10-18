import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { cookies } from "next/headers";
import { query, mutate } from "./db";
import { activeStoreId } from "./tenant";
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
export async function ghostContext() {
  const jar = await cookies();
  const token = jar.get("fleur_session")?.value;
  const ghost = jar.get("fleur_ghost")?.value;
  if (!token || !ghost) return null;
  const [context] = await query<any[]>(
    "SELECT g.actor_id actorId,a.name actorName,g.target_id targetId,t.name targetName,TIMESTAMPDIFF(SECOND,NOW(),g.expires_at) remainingSeconds,(g.ended_at IS NULL AND g.expires_at>NOW() AND t.active=1 AND NOT EXISTS(SELECT 1 FROM platform_memberships p WHERE p.user_id=t.id)) valid FROM ghost_sessions g JOIN sessions s ON s.token_hash=g.admin_session_hash AND s.user_id=g.actor_id JOIN users a ON a.id=g.actor_id JOIN users t ON t.id=g.target_id JOIN platform_memberships p ON p.user_id=a.id WHERE g.token_hash=? AND g.admin_session_hash=? AND s.expires_at>NOW() AND a.active=1 AND p.role='platform_admin'",
    [digest(ghost), digest(token)],
  );
  return context ? { ...context, valid: !!context.valid } : null;
}
export async function guardGhostAction(path: string, method: string) {
  if (method === "GET" || !(await cookies()).get("fleur_ghost")?.value) return;
  if (["auth/ghost/stop", "auth/logout"].includes(path)) return;
  const ghost = await ghostContext();
  if (!ghost?.valid)
    throw new HttpError(
      403,
      "Phiên Ghost đã hết hạn hoặc bị thu hồi. Hãy quay lại admin.",
    );
  await mutate(
    "INSERT INTO platform_audit_logs(actor_id,target_id,action,metadata) VALUES(?,?,?,?)",
    [
      ghost.actorId,
      ghost.targetId,
      "ghost:request",
      JSON.stringify({ method, path: path.slice(0, 200) }),
    ],
  );
  if (
    /^(auth\/|account(?:\/|$)|platform\/|workspace\/team|admin\/users|invitations\/|push$|notification-preferences$|stores$)/.test(
      path,
    )
  )
    throw new HttpError(
      403,
      "Không thể thay đổi tài khoản, phân quyền hoặc đăng ký thông báo trong phiên Ghost.",
    );
}
export async function currentUser() {
  const token = (await cookies()).get("fleur_session")?.value;
  if (!token) return null;
  const rows = await query<User[]>(
    "SELECT u.id,u.name,u.email,u.phone,u.role,u.birthday,u.address,u.marketing_consent FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.active=1",
    [digest(token)],
  );
  let u = rows[0];
  if (!u) return null;
  const isGhost = !!(await cookies()).get("fleur_ghost")?.value;
  if (isGhost) {
    const ghost = await ghostContext();
    if (!ghost?.valid) return null;
    [u] = await query<User[]>(
      "SELECT id,name,email,phone,role,birthday,address,marketing_consent FROM users WHERE id=? AND active=1",
      [ghost.targetId],
    );
    if (!u) return null;
  }
  const memberships = await query<any[]>(
    "SELECT m.store_id,m.role,s.slug,s.name FROM store_memberships m JOIN stores s ON s.id=m.store_id WHERE m.user_id=? AND m.status='active'",
    [u.id],
  );
  const platform = await query<any[]>(
    "SELECT role FROM platform_memberships WHERE user_id=?",
    [u.id],
  );
  return {
    ...u,
    role:
      memberships.find((m) => m.store_id === activeStoreId())?.role ||
      "customer",
    memberships,
    platformRole: isGhost ? null : platform[0]?.role || null,
  };
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
  if (token) {
    await mutate(
      "UPDATE ghost_sessions SET ended_at=NOW() WHERE admin_session_hash=? AND ended_at IS NULL",
      [digest(token)],
    );
    await mutate("DELETE FROM sessions WHERE token_hash=?", [digest(token)]);
  }
  jar.delete("fleur_session");
  jar.delete("fleur_ghost");
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
permissions.owner = permissions.admin;
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
