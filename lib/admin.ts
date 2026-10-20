import { expireStoreOrderSessions } from "./order-payment-sessions";
import { tenantId } from "./tenant";
import { storeOwner, quota } from "./stores";
import { z } from "zod";
import { MAX_PRODUCT_IMAGES } from "./product-images";
import { pool, query, mutate } from "./db";
import { HttpError, requirePermission } from "./auth";
import { orderPaymentStatusSQL } from "./order-payment-state";
import { flowerComposition } from "./product-taxonomy";
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
    gallery: z
      .array(image)
      .max(MAX_PRODUCT_IMAGES - 1)
      .optional()
      .transform((v) =>
        v === undefined ? undefined : JSON.stringify([...new Set(v)]),
      ),
    description: long.min(10),
    flowers: z.string().trim().max(255),
    flower_component_ids: z
      .array(z.number().int().positive())
      .max(30)
      .optional(),
    flower_other: z.string().trim().max(255).optional(),
    care: long,
    badge: z.string().max(60),
    active: flag,
  }),
  categories: z.object({
    name: text.max(120),
    slug: text.max(160).regex(/^[a-z0-9-]+$/),
    description: long,
  }),
  flower_components: z.object({
    name: text.max(120),
    slug: text.max(160).regex(/^[a-z0-9-]+$/),
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
  await requirePermission(
    area === "flower_components"
      ? "categories"
      : area === "product-taxonomy"
        ? "products"
        : area,
  );
  if (["orders", "overview", "board"].includes(area)) await expireStoreOrderSessions();
  if (area === "product-taxonomy") {
    const [categories, components] = await Promise.all([
      query("SELECT * FROM categories ORDER BY name"),
      query("SELECT * FROM flower_components ORDER BY name"),
    ]);
    return { categories, components };
  }
  if (area === "products") {
    const [products, links] = await Promise.all([
      query<any[]>(
        "SELECT p.*,c.name category FROM products p JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC LIMIT 500",
      ),
      query<any[]>(
        "SELECT product_id,component_id FROM product_flower_components ORDER BY component_id",
      ),
    ]);
    return products.map((p) => ({
      ...p,
      flower_other: p.flower_other ?? p.flowers,
      flower_component_ids: links
        .filter((l) => l.product_id === p.id)
        .map((l) => l.component_id),
    }));
  }
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
        "SELECT c.*,(SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status<>'cancelled') order_count,(SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.customer_id=c.id AND o.status='delivered') total_spent,(SELECT MAX(created_at) FROM orders o WHERE o.customer_id=c.id) last_order FROM customers c ORDER BY c.id DESC",
      ),
      query(
        "SELECT n.*,u.name author FROM crm_notes n JOIN users u ON u.id=n.author_id ORDER BY n.id DESC",
      ),
      query("SELECT * FROM crm_tasks ORDER BY due_date"),
      query(
        "SELECT o.id,o.reference,o.customer_id,o.email,o.total,o.status," +
          orderPaymentStatusSQL() +
          " payment_status,o.delivery_date,o.created_at FROM orders o ORDER BY o.id DESC LIMIT 500",
      ),
    ]);
    return { customers, notes, tasks, orders };
  }
  if (area === "orders") {
    return query(
      "SELECT o.*," +
        orderPaymentStatusSQL() +
        " payment_status,(SELECT JSON_ARRAYAGG(JSON_OBJECT('name',product_name,'quantity',quantity,'size',size,'price',price)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o ORDER BY o.id DESC LIMIT 500",
    );
  }
  if (area === "users")
    return query(
      "SELECT u.id,u.name,u.email,u.phone,m.role,IF(m.status='active',1,0) active,u.created_at FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=? ORDER BY u.id DESC",
      [tenantId()],
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
  const actor = await requirePermission(
    area === "flower_components" ? "categories" : area,
  );
  const c = await pool.getConnection();
  const query = async <T = any>(
    sql: string,
    values: any[] = [],
  ): Promise<T> => {
    const [r] = await c.execute(sql, values);
    return r as T;
  };
  const mutate = async (sql: string, values: any[] = []) => {
    const [r]: any = await c.execute(sql, values);
    return r;
  };
  try {
    await c.beginTransaction();
    // Serialize taxonomy changes and product associations within this store.
    if (["categories", "flower_components"].includes(area))
      await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [
        tenantId(),
      ]);
    if (area === "products") {
      await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [
        tenantId(),
      ]);
      if (!remove && (body as any).active === 1) {
        const existing = id
          ? (
              await query<any[]>("SELECT active FROM products WHERE id=?", [id])
            )[0]
          : null;
        if (!existing?.active) {
          const [p] = await query<any[]>(
            "SELECT COALESCE(v.limits,p.limits) limits FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id LEFT JOIN plan_versions v ON v.id=sub.plan_version_id WHERE sub.store_id=?",
            [tenantId()],
          );
          const [count] = await query<any[]>(
            "SELECT COUNT(*) n FROM products WHERE active=1",
          );
          const limits =
            typeof p?.limits === "string" ? JSON.parse(p.limits) : p?.limits;
          if (!limits || count.n >= limits.products)
            throw new HttpError(
              409,
              "Đã đạt giới hạn sản phẩm của gói dịch vụ.",
            );
        }
      }
    }
    if (!schemas[area]) throw new HttpError(404, "Không tìm thấy chức năng.");
    if (area === "users")
      throw new HttpError(
        403,
        "Quản lý vai trò trong mục Nhân sự của cửa hàng.",
      );

    if (area === "products" && !remove) {
      const [category] = await query<any[]>(
        "SELECT id FROM categories WHERE id=?",
        [(body as any).category_id],
      );
      if (!category) throw new HttpError(400, "Danh mục không thuộc cửa hàng.");
    }
    if (remove) {
      if (area === "users" && id === actor.id)
        throw new HttpError(400, "Bạn không thể khoá tài khoản đang sử dụng.");
      if (["products", "users", "events", "promotions"].includes(area)) {
        await mutate("UPDATE " + area + " SET active=0 WHERE id=?", [id]);
      } else if (area === "posts") {
        await mutate("UPDATE posts SET published=0 WHERE id=?", [id]);
      } else if (area === "flower_components") {
        const [used] = await query<any[]>(
          "SELECT COUNT(*) n FROM product_flower_components WHERE component_id=?",
          [id],
        );
        if (used.n)
          throw new HttpError(
            409,
            "Thành phần hoa đang có sản phẩm sử dụng. Hãy bỏ chọn thành phần trong sản phẩm trước.",
          );
        const result = await mutate(
          "DELETE FROM flower_components WHERE id=?",
          [id],
        );
        if (!result.affectedRows)
          throw new HttpError(404, "Không tìm thấy thành phần hoa.");
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
        const result = await mutate("DELETE FROM categories WHERE id=?", [id]);
        if (!result.affectedRows)
          throw new HttpError(404, "Không tìm thấy danh mục.");
      } else throw new HttpError(400, "Mục này không hỗ trợ xoá.");
    } else {
      const value = schemas[area].parse(body) as Record<string, unknown>;
      const componentIds =
        area === "products" && value.flower_component_ids !== undefined
          ? [...new Set(value.flower_component_ids as number[])]
          : undefined;
      if (area === "products") {
        if (componentIds) {
          value.flower_other = (value.flower_other as string | undefined) || "";
          value.flowers = await flowerComposition(
            query,
            componentIds,
            value.flower_other as string,
          );
        } else {
          if (!value.flowers)
            throw new HttpError(400, "Vui lòng nhập thành phần hoa.");
          value.flower_other = value.flowers;
        }
        delete value.flower_component_ids;
      }
      if (["categories", "flower_components"].includes(area)) {
        const [duplicate] = await query<any[]>(
          "SELECT id FROM " + area + " WHERE (slug=? OR name=?) AND id<>?",
          [value.slug, value.name, id || 0],
        );
        if (duplicate)
          throw new HttpError(
            409,
            "Tên hoặc đường dẫn đã tồn tại. Vui lòng chọn mục đã có hoặc dùng tên khác.",
          );
      }
      if (area === "users") {
        if (!id)
          throw new HttpError(400, "Tài khoản được tạo qua trang đăng ký.");
        if (actor.id === id && (value.role !== "admin" || value.active !== 1))
          throw new HttpError(
            400,
            "Không thể tự thu hồi quyền hoặc khoá tài khoản đang sử dụng.",
          );
      }
      for (const key of Object.keys(value))
        if (value[key] === undefined) delete value[key];
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
      if (area === "products") {
        await mutate(
          "DELETE FROM product_flower_components WHERE product_id=?",
          [id],
        );
        for (const componentId of componentIds || [])
          await mutate(
            "INSERT INTO product_flower_components(product_id,component_id) VALUES(?,?)",
            [id, componentId],
          );
      }
      if (area === "flower_components" && id) {
        const products = await query<any[]>(
          "SELECT p.id,p.flower_other FROM products p JOIN product_flower_components l ON l.product_id=p.id WHERE l.component_id=?",
          [id],
        );
        for (const product of products) {
          const links = await query<any[]>(
            "SELECT component_id FROM product_flower_components WHERE product_id=? ORDER BY component_id",
            [product.id],
          );
          const flowers = await flowerComposition(
            query,
            links.map((l) => l.component_id),
            product.flower_other || "",
          );
          await mutate("UPDATE products SET flowers=? WHERE id=?", [
            flowers,
            product.id,
          ]);
        }
      }
    }
    await mutate(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
      [actor.id, remove ? "archive" : id ? "save" : "create", area, String(id)],
    );
    await c.commit();
    return { ok: true, id };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
