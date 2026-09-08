import { NextRequest, NextResponse, after } from "next/server";
import { emailAdminRead, emailAdminAction } from "@/lib/email-admin";
import { safelyProcessEmails } from "@/lib/email";
import { z } from "zod";
import { publicProducts, invalidateCatalog } from "@/lib/catalog";
import { randomBytes } from "node:crypto";
import { query, mutate, pool } from "@/lib/db";
import {
  currentUser,
  setSession,
  clearSession,
  passwordHash,
  checkPassword,
  HttpError,
  requirePermission,
  throttle,
  digest,
  permissions,
} from "@/lib/auth";
import {
  calculate,
  quoteSchema,
  checkoutSchema,
  createOrder,
  changeOrder,
} from "@/lib/commerce";
import { adminRead, adminWrite } from "@/lib/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    const key = path.join("/");
    const method = req.method;
    let body: any = {};
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      const allowed = process.env.APP_ORIGIN || req.nextUrl.origin;
      if (origin !== allowed)
        throw new HttpError(403, "Nguồn yêu cầu không hợp lệ.");
      if (Number(req.headers.get("content-length") || 0) > 100000)
        throw new HttpError(413, "Dữ liệu quá lớn.");
      try {
        body = await req.json();
      } catch {
        throw new HttpError(400, "Dữ liệu không hợp lệ.");
      }
    }
    let result: unknown;
    if (key === "catalog/products" && method === "GET")
      result = await publicProducts();
    else if (key === "auth/me" && method === "GET")
      result = { user: await currentUser(), permissions };
    else if (key === "auth/register" && method === "POST") {
      const b = z
        .object({
          name: z.string().trim().min(2).max(100),
          email: z.email().toLowerCase(),
          password: z.string().min(10).max(128),
          phone: z.string().max(30).default(""),
          consent: z.boolean().default(false),
        })
        .parse(body);
      await throttle("register:" + b.email);
      const r = await mutate(
        "INSERT INTO users(name,email,password_hash,phone,address,marketing_consent) VALUES(?,?,?,?,'',?)",
        [b.name, b.email, passwordHash(b.password), b.phone, b.consent ? 1 : 0],
      );
      await mutate(
        "INSERT IGNORE INTO customers(name,email,phone,marketing_consent) VALUES(?,?,?,?)",
        [b.name, b.email, b.phone, b.consent ? 1 : 0],
      );
      await setSession(r.insertId);
      result = { user: await currentUser() };
    } else if (key === "auth/login" && method === "POST") {
      const b = z
        .object({
          email: z.email().toLowerCase(),
          password: z.string().min(1).max(128),
        })
        .parse(body);
      await throttle("login:" + b.email);
      const [user] = await query<any[]>(
        "SELECT id,password_hash FROM users WHERE email=? AND active=1",
        [b.email],
      );
      const valid = checkPassword(
        b.password,
        user?.password_hash ||
          "00000000000000000000000000000000:" + "00".repeat(64),
      );
      if (!user || !valid)
        throw new HttpError(401, "Email hoặc mật khẩu không đúng.");
      await mutate("DELETE FROM login_attempts WHERE attempt_key=?", [
        digest("login:" + b.email),
      ]);
      await setSession(user.id);
      result = { user: await currentUser() };
    } else if (key === "auth/logout" && method === "POST") {
      await clearSession();
      result = { ok: true };
    } else if (key === "account" && method === "PATCH") {
      const user = await currentUser();
      if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
      const b = z
        .object({
          name: z.string().trim().min(2).max(100),
          phone: z.string().max(30),
          address: z.string().max(500),
          birthday: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          marketing_consent: z.boolean(),
        })
        .parse(body);
      await mutate(
        "UPDATE users SET name=?,phone=?,address=?,birthday=?,marketing_consent=? WHERE id=?",
        [
          b.name,
          b.phone,
          b.address,
          b.birthday,
          b.marketing_consent ? 1 : 0,
          user.id,
        ],
      );
      await mutate(
        "UPDATE customers SET name=?,phone=?,birthday=?,marketing_consent=? WHERE email=?",
        [b.name, b.phone, b.birthday, b.marketing_consent ? 1 : 0, user.email],
      );
      result = { user: await currentUser() };
    } else if (key === "account/password" && method === "POST") {
      const user = await currentUser();
      if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
      const b = z
        .object({
          currentPassword: z.string().max(128),
          password: z.string().min(10).max(128),
        })
        .parse(body);
      const [u] = await query<any[]>(
        "SELECT password_hash FROM users WHERE id=?",
        [user.id],
      );
      if (!checkPassword(b.currentPassword, u.password_hash))
        throw new HttpError(400, "Mật khẩu hiện tại không đúng.");
      await mutate("UPDATE users SET password_hash=? WHERE id=?", [
        passwordHash(b.password),
        user.id,
      ]);
      await mutate("DELETE FROM sessions WHERE user_id=?", [user.id]);
      await setSession(user.id);
      result = { ok: true };
    } else if (key === "orders" && method === "GET") {
      const user = await currentUser();
      if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
      result = await query(
        "SELECT o.*,(SELECT JSON_ARRAYAGG(JSON_OBJECT('name',product_name,'quantity',quantity,'size',size,'price',price,'image',image)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o WHERE user_id=? ORDER BY id DESC",
        [user.id],
      );
    } else if (key === "checkout/quote" && method === "POST") {
      const c = await pool.getConnection();
      try {
        result = await calculate(c, quoteSchema.parse(body));
      } finally {
        c.release();
      }
    } else if (key === "checkout" && method === "POST") {
      const user = await currentUser();
      const b = checkoutSchema.parse(body);
      if (user && b.email !== user.email)
        throw new HttpError(
          400,
          "Vui lòng dùng email của tài khoản đang đăng nhập.",
        );
      await throttle("checkout:" + b.email, 40);
      result = await createOrder(b, user?.id || null);
    } else if (key === "orders/track" && method === "POST") {
      const b = z
        .object({
          reference: z.string().min(5).max(30),
          email: z.email().toLowerCase(),
        })
        .parse(body);
      await throttle("track:" + b.email, 30);
      const [order] = await query<any[]>(
        "SELECT reference,status,total,delivery_date,delivery_slot,created_at FROM orders WHERE reference=? AND email=?",
        [b.reference.toUpperCase(), b.email],
      );
      if (!order)
        throw new HttpError(404, "Không tìm thấy đơn hàng với thông tin này.");
      result = order;
    } else if (
      path[0] === "orders" &&
      path[2] === "cancel" &&
      method === "POST"
    ) {
      const user = await currentUser();
      if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
      result = await changeOrder(
        z.coerce.number().int().positive().parse(path[1]),
        "cancelled",
        user.id,
        true,
      );
    } else if (key === "contact" && method === "POST") {
      const b = z
        .object({
          name: z.string().min(2).max(100),
          email: z.email().toLowerCase(),
          message: z.string().min(10).max(3000),
        })
        .parse(body);
      await throttle("contact:" + b.email, 5);
      await mutate("INSERT INTO inquiries(name,email,message) VALUES(?,?,?)", [
        b.name,
        b.email,
        b.message,
      ]);
      result = { ok: true };
    } else if (key === "auth/reset-password" && method === "POST") {
      const b = z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: z.string().min(10).max(128),
        })
        .parse(body);
      await throttle("reset:" + digest(b.token), 8);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows] = await c.execute(
          "SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>NOW() FOR UPDATE",
          [digest(b.token)],
        );
        const r = (rows as { user_id: number }[])[0];
        if (!r)
          throw new HttpError(400, "Liên kết đã hết hạn hoặc đã được sử dụng.");
        await c.execute("UPDATE users SET password_hash=? WHERE id=?", [
          passwordHash(b.password),
          r.user_id,
        ]);
        await c.execute("DELETE FROM sessions WHERE user_id=?", [r.user_id]);
        await c.execute("DELETE FROM password_resets WHERE user_id=?", [
          r.user_id,
        ]);
        await c.commit();
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
      await clearSession();
      result = { ok: true };
    } else if (
      path[0] === "admin" &&
      path[1] === "users" &&
      path[3] === "reset-password" &&
      method === "POST"
    ) {
      const actor = await requirePermission("users");
      const id = z.coerce.number().int().positive().parse(path[2]);
      const [u] = await query<any[]>(
        "SELECT id FROM users WHERE id=? AND active=1",
        [id],
      );
      if (!u)
        throw new HttpError(404, "Tài khoản không tồn tại hoặc đã bị khoá.");
      const token = randomBytes(32).toString("hex");
      await mutate("DELETE FROM password_resets WHERE user_id=?", [id]);
      await mutate(
        "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE))",
        [digest(token), id],
      );
      await mutate(
        "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,'issue_password_reset','users',?)",
        [actor.id, String(id)],
      );
      result = {
        url:
          (process.env.APP_ORIGIN || req.nextUrl.origin) +
          "/reset-password?token=" +
          token,
      };
    } else if (path[0] === "admin" && path[1] === "emails") {
      result =
        method === "GET"
          ? await emailAdminRead()
          : await emailAdminAction(path.slice(2), method, body);
    } else if (path[0] === "admin") {
      const area = path[1];
      if (method === "GET") result = await adminRead(area);
      else if (area === "orders") {
        const user = await requirePermission("orders");
        result = await changeOrder(
          z.coerce.number().int().positive().parse(path[2]),
          z
            .enum([
              "confirmed",
              "preparing",
              "shipping",
              "delivered",
              "cancelled",
            ])
            .parse(body.status),
          user.id,
        );
      } else if (area === "crm") {
        const user = await requirePermission("crm");
        const id = z.coerce.number().int().positive().parse(path[2]);
        if (path[3] === "notes") {
          const content = z
            .string()
            .trim()
            .min(2)
            .max(3000)
            .parse(body.content);
          await mutate(
            "INSERT INTO crm_notes(customer_id,author_id,content) VALUES(?,?,?)",
            [id, user.id, content],
          );
        } else if (path[3] === "tasks" && method === "POST") {
          const b = z
            .object({
              title: z.string().min(2).max(200),
              due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            })
            .parse(body);
          await mutate(
            "INSERT INTO crm_tasks(customer_id,title,due_date) VALUES(?,?,?)",
            [id, b.title, b.due_date],
          );
        } else if (path[3] === "tasks" && method === "PATCH") {
          await mutate(
            "UPDATE crm_tasks SET status=? WHERE id=? AND customer_id=?",
            [
              z.enum(["open", "done"]).parse(body.status),
              z.number().int().positive().parse(body.id),
              id,
            ],
          );
        } else {
          const b = z
            .object({
              segment: z.enum(["new", "loyal", "vip", "inactive"]),
              birthday: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable(),
            })
            .parse(body);
          await mutate("UPDATE customers SET segment=?,birthday=? WHERE id=?", [
            b.segment,
            b.birthday,
            id,
          ]);
        }
        await mutate(
          "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,'update','crm',?)",
          [user.id, String(id)],
        );
        result = { ok: true };
      } else
        result = await adminWrite(
          area,
          path[2] ? z.coerce.number().int().positive().parse(path[2]) : null,
          body,
          method === "DELETE",
        );
    } else throw new HttpError(404, "Không tìm thấy chức năng.");
    if (
      method !== "GET" &&
      (key === "checkout" ||
        path[0] === "orders" ||
        (path[0] === "admin" &&
          (path[1] === "orders" ||
            (path[1] === "emails" &&
              ["campaigns", "retry"].includes(path[2])))))
    )
      after(safelyProcessEmails);
    if (method !== "GET") {
      if (path[0] === "admin") invalidateCatalog(path[1]);
      else if (key === "checkout" || path[0] === "orders")
        invalidateCatalog(path[0]);
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: e.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .join("; "),
        },
        { status: 400 },
      );
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    const err = e as { code?: string };
    if (err.code === "ER_DUP_ENTRY")
      return NextResponse.json(
        { error: "Email, mã hoặc đường dẫn này đã tồn tại." },
        { status: 409 },
      );
    if (err.code === "ER_NO_REFERENCED_ROW_2")
      return NextResponse.json(
        { error: "Bản ghi liên quan không tồn tại." },
        { status: 400 },
      );
    console.error("API failure", e);
    return NextResponse.json(
      { error: "Không thể hoàn tất yêu cầu. Vui lòng thử lại." },
      { status: 500 },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
