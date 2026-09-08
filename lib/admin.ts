import { z } from "zod";
import { query, mutate } from "./db";
import { HttpError, requirePermission } from "./auth";
const text = z.string().trim().min(1).max(200);
const long = z.string().trim().max(15000);
const flag = z.coerce.number().int().min(0).max(1);
const amount = z.coerce.number().int().min(0).max(100000000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}/);
const image = z
  .string()
  .max(2000)
  .refine(
    (v) =>
      /^https:\/\//.test(v) || /^\/(images|uploads)\/[a-zA-Z0-9._-]+$/.test(v),
    "Ảnh cần dùng URL HTTPS hoặc ảnh đã tải lên.",
  );
export const schemas: Record<string, z.ZodType> = {
  products: z.object({
    name: text,
    slug: text.regex(/^[a-z0-9-]+$/),
    category_id: z.coerce.number().int().positive(),
    price: amount.min(1000),
    compare_price: amount.nullable().optional(),
    stock: amount.max(100000),
    image,
    description: long.min(10),
    flowers: text,
    care: long,
    badge: z.string().max(60),
    active: flag,
  }),
  categories: z.object({
    name: text,
    slug: text.regex(/^[a-z0-9-]+$/),
    description: long,
  }),
  promotions: z
    .object({
      name: text,
      code: text.max(40).transform((x) => x.toUpperCase()),
      type: z.enum(["percent", "fixed"]),
      value: amount.min(1),
      min_order: amount,
      starts_at: date,
      ends_at: date,
      usage_limit: amount.min(1),
      active: flag,
    })
    .refine(
      (v) => v.ends_at > v.starts_at,
      "Ngày kết thúc phải sau ngày bắt đầu",
    )
    .refine(
      (v) => v.type !== "percent" || v.value <= 100,
      "Phần trăm tối đa là 100",
    ),
  events: z
    .object({
      name: text,
      description: long,
      starts_at: date,
      ends_at: date,
      active: flag,
    })
    .refine((v) => v.ends_at >= v.starts_at, "Ngày kết thúc không hợp lệ"),
  posts: z.object({
    title: text,
    slug: text.regex(/^[a-z0-9-]+$/),
    excerpt: long,
    content: long.min(20),
    image,
    published: flag,
  }),
  users: z.object({
    name: text,
    email: z.email().toLowerCase(),
    phone: z.string().max(30),
    role: z.enum(["admin", "manager", "editor", "support", "customer"]),
    active: flag,
  }),
  inquiries: z.object({ status: z.enum(["new", "resolved"]) }),
};
export async function adminRead(area: string) {
  await requirePermission(area);
  if (area === "overview") {
    const [stats, revenue, recent, top] = await Promise.all([
      query(
        "SELECT (SELECT COALESCE(SUM(total),0) FROM orders WHERE status='delivered') revenue,(SELECT COUNT(*) FROM orders WHERE status NOT IN ('cancelled')) orders_count,(SELECT COUNT(*) FROM customers) customers_count,(SELECT COUNT(*) FROM products WHERE active=1) products_count,(SELECT COUNT(*) FROM orders WHERE status='pending') pending_count",
      ),
      query(
        "SELECT DATE(created_at) day,SUM(total) total FROM orders WHERE status<>'cancelled' AND created_at>=DATE_SUB(CURDATE(),INTERVAL 14 DAY) GROUP BY DATE(created_at) ORDER BY day",
      ),
      query(
        "SELECT id,reference,customer_name,total,status,created_at FROM orders ORDER BY id DESC LIMIT 8",
      ),
      query(
        "SELECT p.name,COALESCE(SUM(CASE WHEN o.status<>'cancelled' THEN i.quantity ELSE 0 END),0) sold FROM products p LEFT JOIN order_items i ON i.product_id=p.id LEFT JOIN orders o ON o.id=i.order_id GROUP BY p.id ORDER BY sold DESC LIMIT 5",
      ),
    ]);
    return { stats: (stats as any[])[0], revenue, recent, top };
  }
  if (area === "crm") {
    const [customers, notes, tasks, orders] = await Promise.all([
      query(
        "SELECT c.*,(SELECT COUNT(*) FROM orders o WHERE o.email=c.email AND o.status<>'cancelled') order_count,(SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.email=c.email AND o.status='delivered') total_spent,(SELECT MAX(created_at) FROM orders o WHERE o.email=c.email) last_order FROM customers c ORDER BY c.id DESC",
      ),
      query(
        "SELECT n.*,u.name author FROM crm_notes n JOIN users u ON u.id=n.author_id ORDER BY n.id DESC",
      ),
      query("SELECT * FROM crm_tasks ORDER BY due_date"),
      query(
        "SELECT id,reference,email,total,status,payment_status,delivery_date,created_at FROM orders ORDER BY id DESC LIMIT 500",
      ),
    ]);
    return { customers, notes, tasks, orders };
  }
  if (area === "orders") {
    return query(
      "SELECT o.*,(SELECT JSON_ARRAYAGG(JSON_OBJECT('name',product_name,'quantity',quantity,'size',size,'price',price)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o ORDER BY id DESC LIMIT 500",
    );
  }
  if (area === "users")
    return query(
      "SELECT id,name,email,phone,role,active,created_at FROM users ORDER BY id DESC",
    );
  if (area === "audit")
    return query(
      "SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200",
    );
  if (!schemas[area]) throw new HttpError(404, "Không tìm thấy mục quản trị.");
  return query("SELECT * FROM " + area + " ORDER BY id DESC LIMIT 500");
}
export async function adminWrite(
  area: string,
  id: number | null,
  body: unknown,
  remove = false,
) {
  const actor = await requirePermission(area);
  if (!schemas[area]) throw new HttpError(404, "Không tìm thấy chức năng.");
  if (remove) {
    if (area === "users" && id === actor.id)
      throw new HttpError(400, "Bạn không thể khoá tài khoản đang sử dụng.");
    if (["products", "users", "events", "promotions"].includes(area)) {
      await mutate("UPDATE " + area + " SET active=0 WHERE id=?", [id]);
    } else if (area === "posts") {
      await mutate("UPDATE posts SET published=0 WHERE id=?", [id]);
    } else if (area === "categories") {
      const [r] = await query<{ n: number }[]>(
        "SELECT COUNT(*) n FROM products WHERE category_id=?",
        [id],
      );
      if (r.n)
        throw new HttpError(
          409,
          "Danh mục đang có sản phẩm. Hãy chuyển sản phẩm trước.",
        );
      await mutate("DELETE FROM categories WHERE id=?", [id]);
    } else throw new HttpError(400, "Mục này không hỗ trợ xoá.");
  } else {
    const value = schemas[area].parse(body) as Record<string, unknown>;
    if (area === "users") {
      if (!id)
        throw new HttpError(400, "Tài khoản được tạo qua trang đăng ký.");
      if (actor.id === id && (value.role !== "admin" || value.active !== 1))
        throw new HttpError(
          400,
          "Không thể tự thu hồi quyền hoặc khoá tài khoản đang sử dụng.",
        );
    }
    const keys = Object.keys(value);
    if (id) {
      const result = await mutate(
        "UPDATE " +
          area +
          " SET " +
          keys.map((k) => k + "=?").join(",") +
          " WHERE id=?",
        [...Object.values(value), id],
      );
      if (!result.affectedRows)
        throw new HttpError(404, "Không tìm thấy bản ghi.");
    } else {
      const result = await mutate(
        "INSERT INTO " +
          area +
          " (" +
          keys.join(",") +
          ") VALUES(" +
          keys.map(() => "?").join(",") +
          ")",
        Object.values(value),
      );
      id = result.insertId;
    }
  }
  await mutate(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
    [actor.id, remove ? "archive" : id ? "save" : "create", area, String(id)],
  );
  return { ok: true, id };
}
