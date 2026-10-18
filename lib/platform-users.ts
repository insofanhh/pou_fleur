import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool, query, mutate } from "./db";
import { currentUser, digest, HttpError, passwordHash } from "./auth";
import { loginDestination } from "./login-redirect";

const fields = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().toLowerCase().max(190),
  phone: z.string().trim().max(30).default(""),
  address: z.string().trim().max(500).default(""),
  active: z.boolean(),
  platformAdmin: z.boolean(),
  password: z
    .string()
    .max(128)
    .refine((v) => !v || v.length >= 12, "Mật khẩu cần ít nhất 12 ký tự.")
    .default(""),
});
const reason = z.string().trim().min(5).max(500);
const profile =
  "u.id,u.name,u.email,u.phone,u.address,u.active,u.created_at,COALESCE(st.version,1) version,st.deleted_at,EXISTS(SELECT 1 FROM platform_memberships p WHERE p.user_id=u.id) platformAdmin";
async function audit(
  c: any,
  actor: number,
  target: number,
  action: string,
  metadata: object,
) {
  await c.execute(
    "INSERT INTO platform_audit_logs(actor_id,target_id,action,metadata) VALUES(?,?,?,?)",
    [actor, target, action, JSON.stringify(metadata)],
  );
}

export async function platformUsers(
  path: string[],
  method: string,
  body: any,
  url: URL,
  actor: { id: number },
) {
  if (!path.length && method === "GET") {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(url.searchParams.get("page") || "1");
    const search = z
      .string()
      .max(190)
      .parse(url.searchParams.get("q") || "");
    const state = z
      .enum(["current", "active", "locked", "deleted"])
      .parse(url.searchParams.get("state") || "current");
    const where = `WHERE (u.name LIKE ? OR u.email LIKE ?) AND ${state === "deleted" ? "st.deleted_at IS NOT NULL" : "st.deleted_at IS NULL"}${state === "active" ? " AND u.active=1" : state === "locked" ? " AND u.active=0" : ""}`;
    const args = ["%" + search + "%", "%" + search + "%"];
    const [count] = await query<any[]>(
      `SELECT COUNT(*) total FROM users u LEFT JOIN platform_user_states st ON st.user_id=u.id ${where}`,
      args,
    );
    return {
      users: await query(
        `SELECT ${profile} FROM users u LEFT JOIN platform_user_states st ON st.user_id=u.id ${where} ORDER BY u.id DESC LIMIT 20 OFFSET ${20 * (page - 1)}`,
        args,
      ),
      total: count.total,
      page,
      pages: Math.max(1, Math.ceil(count.total / 20)),
    };
  }
  const uid = path[0]
    ? z.coerce.number().int().positive().parse(path[0])
    : null;
  if (uid && path.length === 1 && method === "GET") {
    const [user] = await query<any[]>(
      `SELECT ${profile} FROM users u LEFT JOIN platform_user_states st ON st.user_id=u.id WHERE u.id=?`,
      [uid],
    );
    if (!user) throw new HttpError(404, "Không tìm thấy tài khoản.");
    return {
      user,
      memberships: await query(
        "SELECT m.role,m.status,s.id store_id,s.name store_name FROM store_memberships m JOIN stores s ON s.id=m.store_id WHERE m.user_id=?",
        [uid],
      ),
      audit: await query(
        "SELECT a.id,a.action,a.metadata,a.created_at,u.name actor_name FROM platform_audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.target_id=? ORDER BY a.id DESC LIMIT 30",
        [uid],
      ),
    };
  }
  if (uid && path[1] === "ghost" && path.length === 2 && method === "POST") {
    const why = reason.parse(body.reason);
    const jar = await cookies();
    if (jar.get("fleur_ghost")?.value)
      throw new HttpError(409, "Hãy kết thúc phiên Ghost hiện tại trước.");
    const session = jar.get("fleur_session")?.value;
    if (!session) throw new HttpError(401, "Vui lòng đăng nhập.");
    const token = randomBytes(32).toString("hex");
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [source]: any = await c.execute(
        "SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id JOIN platform_memberships p ON p.user_id=u.id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>NOW() AND u.active=1 AND p.role='platform_admin' FOR UPDATE",
        [digest(session), actor.id],
      );
      if (!source.length)
        throw new HttpError(403, "Quyền quản trị đã thay đổi.");
      const [users]: any = await c.execute(
        "SELECT u.id,u.active,st.deleted_at,EXISTS(SELECT 1 FROM platform_memberships p WHERE p.user_id=u.id) platformAdmin FROM users u LEFT JOIN platform_user_states st ON st.user_id=u.id WHERE u.id=? FOR UPDATE",
        [uid],
      );
      const target = users[0];
      if (!target) throw new HttpError(404, "Không tìm thấy tài khoản.");
      if (uid === actor.id || target.platformAdmin)
        throw new HttpError(
          403,
          "Không thể Ghost tài khoản quản trị nền tảng.",
        );
      if (!target.active || target.deleted_at)
        throw new HttpError(409, "Tài khoản đã khóa hoặc đã xóa.");
      await c.execute(
        "UPDATE ghost_sessions SET ended_at=NOW() WHERE admin_session_hash=? AND ended_at IS NULL",
        [digest(session)],
      );
      await c.execute(
        "INSERT INTO ghost_sessions(token_hash,admin_session_hash,actor_id,target_id,reason,expires_at) VALUES(?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 20 MINUTE))",
        [digest(token), digest(session), actor.id, uid, why],
      );
      await audit(c, actor.id, uid, "ghost:start", { reason: why });
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    jar.set("fleur_ghost", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.APP_ORIGIN || "").startsWith("https://"),
      path: "/",
      maxAge: 604800,
    });
    const targetUser = await currentUser();
    return {
      ok: true,
      redirect: targetUser ? loginDestination(targetUser, null) : "/",
    };
  }
  const create = !uid && !path.length && method === "POST";
  const edit = !!uid && path.length === 1 && method === "PATCH";
  const remove = !!uid && path.length === 1 && method === "DELETE";
  const restore =
    !!uid && path[1] === "restore" && path.length === 2 && method === "POST";
  if (!create && !edit && !remove && !restore)
    throw new HttpError(404, "Không tìm thấy thao tác tài khoản.");
  const why = reason.parse(body.reason);
  const value = create || edit ? fields.parse(body) : null;
  if (create && !value!.password)
    throw new HttpError(400, "Nhập mật khẩu ban đầu ít nhất 12 ký tự.");
  const version = !create
    ? z.number().int().positive().parse(body.version)
    : null;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    // Serialize membership changes and recheck the actor after acquiring the lock.
    const [admins]: any = await c.execute(
      "SELECT p.user_id,u.active FROM platform_memberships p JOIN users u ON u.id=p.user_id ORDER BY p.user_id FOR UPDATE",
    );
    if (!admins.some((u: any) => u.user_id === actor.id && u.active))
      throw new HttpError(403, "Quyền quản trị đã thay đổi.");
    let targetId = uid;
    if (create) {
      const [r]: any = await c.execute(
        "INSERT INTO users(name,email,phone,address,password_hash,active) VALUES(?,?,?,?,?,?)",
        [
          value!.name,
          value!.email,
          value!.phone,
          value!.address,
          passwordHash(value!.password),
          value!.active ? 1 : 0,
        ],
      );
      targetId = r.insertId;
      await c.execute("INSERT INTO platform_user_states(user_id) VALUES(?)", [
        targetId,
      ]);
      if (value!.platformAdmin)
        await c.execute("INSERT INTO platform_memberships(user_id) VALUES(?)", [
          targetId,
        ]);
    } else {
      const [rows]: any = await c.execute(
        "SELECT u.*,COALESCE(st.version,1) admin_version,st.deleted_at FROM users u LEFT JOIN platform_user_states st ON st.user_id=u.id WHERE u.id=? FOR UPDATE",
        [uid],
      );
      const old = rows[0];
      if (!old) throw new HttpError(404, "Không tìm thấy tài khoản.");
      if (old.admin_version !== version)
        throw new HttpError(409, "Tài khoản vừa thay đổi. Hãy mở lại hồ sơ.");
      if (edit && old.deleted_at)
        throw new HttpError(409, "Hãy khôi phục tài khoản trước khi sửa.");
      if (remove && old.deleted_at)
        throw new HttpError(409, "Tài khoản đã được xóa.");
      if (restore && !old.deleted_at)
        throw new HttpError(409, "Tài khoản chưa bị xóa.");
      if (
        uid === actor.id &&
        (remove || (edit && (!value!.active || !value!.platformAdmin)))
      )
        throw new HttpError(
          409,
          "Không thể tự khóa, xóa hoặc thu hồi quyền quản trị của mình.",
        );
      if (
        admins.some((a: any) => a.user_id === uid && a.active) &&
        (remove || (edit && (!value!.active || !value!.platformAdmin))) &&
        admins.filter((a: any) => a.active).length <= 1
      )
        throw new HttpError(
          409,
          "Cần giữ ít nhất một quản trị nền tảng hoạt động.",
        );
      if (remove) {
        const [owned]: any = await c.execute(
          "SELECT id FROM stores WHERE owner_id=? AND status<>'closed' FOR UPDATE",
          [uid],
        );
        if (owned.length)
          throw new HttpError(
            409,
            "Tài khoản còn sở hữu cửa hàng chưa đóng. Hãy xử lý cửa hàng trước khi xóa.",
          );
        await c.execute("UPDATE users SET active=0 WHERE id=?", [uid]);
      } else if (restore) {
        // Restore as locked, with no platform privileges; activation is explicit.
        await c.execute("UPDATE users SET active=0 WHERE id=?", [uid]);
      } else {
        await c.execute(
          "UPDATE users SET name=?,email=?,phone=?,address=?,active=? WHERE id=?",
          [
            value!.name,
            value!.email,
            value!.phone,
            value!.address,
            value!.active ? 1 : 0,
            uid,
          ],
        );
        if (value!.password)
          await c.execute("UPDATE users SET password_hash=? WHERE id=?", [
            passwordHash(value!.password),
            uid,
          ]);
      }
      if (edit && value!.platformAdmin)
        await c.execute(
          "INSERT IGNORE INTO platform_memberships(user_id) VALUES(?)",
          [uid],
        );
      else
        await c.execute("DELETE FROM platform_memberships WHERE user_id=?", [
          uid,
        ]);
      await c.execute(
        "INSERT INTO platform_user_states(user_id,version,deleted_at) VALUES(?,2,IF(?,NOW(),NULL)) ON DUPLICATE KEY UPDATE version=version+1,deleted_at=VALUES(deleted_at)",
        [uid, remove ? 1 : 0],
      );
      // Revoke all sessions on deletion, lock, password/email/privilege changes.
      const wasAdmin = admins.some((a: any) => a.user_id === uid);
      if (
        remove ||
        restore ||
        (edit &&
          (!value!.active ||
            !!value!.password ||
            old.email !== value!.email ||
            wasAdmin !== value!.platformAdmin))
      ) {
        await c.execute("DELETE FROM sessions WHERE user_id=?", [uid]);
        await c.execute("DELETE FROM password_resets WHERE user_id=?", [uid]);
        await c.execute("DELETE FROM oauth_requests WHERE link_user_id=?", [
          uid,
        ]);
        await c.execute("DELETE FROM push_subscriptions WHERE user_id=?", [
          uid,
        ]);
        await c.execute(
          "UPDATE ghost_sessions SET ended_at=NOW() WHERE (target_id=? OR actor_id=?) AND ended_at IS NULL",
          [uid, uid],
        );
      }
    }
    await audit(
      c,
      actor.id,
      targetId!,
      create
        ? "user:create"
        : edit
          ? "user:update"
          : remove
            ? "user:delete"
            : "user:restore",
      {
        reason: why,
        ...(value
          ? {
              fields: [
                "name",
                "email",
                "phone",
                "address",
                "active",
                "platformAdmin",
                ...(value.password ? ["password"] : []),
              ],
            }
          : {}),
      },
    );
    await c.commit();
    return { ok: true, id: targetId };
  } catch (e: any) {
    await c.rollback();
    if (e.code === "ER_DUP_ENTRY")
      throw new HttpError(
        409,
        "Email đã được sử dụng, kể cả tài khoản đã xóa.",
      );
    throw e;
  } finally {
    c.release();
  }
}

export async function stopGhost() {
  const jar = await cookies(),
    token = jar.get("fleur_ghost")?.value,
    session = jar.get("fleur_session")?.value;
  if (token && session) {
    const [g] = await query<any[]>(
      "SELECT actor_id,target_id FROM ghost_sessions WHERE token_hash=? AND admin_session_hash=?",
      [digest(token), digest(session)],
    );
    if (g) {
      await mutate(
        "UPDATE ghost_sessions SET ended_at=NOW() WHERE token_hash=?",
        [digest(token)],
      );
      await mutate(
        "INSERT INTO platform_audit_logs(actor_id,target_id,action,metadata) VALUES(?,?,'ghost:stop',JSON_OBJECT())",
        [g.actor_id, g.target_id],
      );
    }
  }
  jar.delete("fleur_ghost");
  const user = await currentUser();
  return {
    ok: true,
    redirect:
      user?.platformRole === "platform_admin"
        ? "/platform/users"
        : user
          ? "/"
          : "/login",
  };
}
