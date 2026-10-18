import { tenantId } from "./tenant";
import { orderLabels } from "./display-labels";
import { validateFulfillment } from "./fulfillment";
import { assertStoreOpen } from "./stores";
import { emit } from "./domain-events";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "./db";
import { enqueueOrderEmail } from "./email";
import { HttpError } from "./auth";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { Product, Promotion } from "./types";
export const itemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(30),
  size: z.enum(["S", "M", "L"]),
});
export const quoteSchema = z.object({
  items: z.array(itemSchema).min(1).max(30),
  code: z.string().max(40).default(""),
});
const phone = z
  .string()
  .regex(/^[+0-9 ()-]{9,20}$/, "Số điện thoại không hợp lệ");
export const checkoutSchema = quoteSchema.extend({
  customerName: z.string().trim().min(2).max(100),
  email: z.email().toLowerCase(),
  phone,
  address: z.string().trim().min(10).max(500),
  recipientName: z.string().trim().min(2).max(100),
  recipientPhone: phone,
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliverySlot: z.string().min(5).max(30),
  deliveryMode: z.enum(["self", "gift"]).default("gift"),
  message: z.string().max(500).default(""),
  notes: z.string().max(1000).default(""),
  paymentMethod: z.enum(["cod"]),
  consent: z.boolean().default(false),
  idempotencyKey: z.string().uuid(),
  expectedTotal: z.number().int().nonnegative().optional(),
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
});
export async function calculate(
  c: PoolConnection,
  body: z.infer<typeof quoteSchema>,
  lock = false,
) {
  const merged = new Map<string, z.infer<typeof itemSchema>>();
  for (const i of body.items) {
    const key = i.productId + ":" + i.size;
    const existing = merged.get(key);
    if (existing) existing.quantity += i.quantity;
    else merged.set(key, { ...i });
  }
  const ids = [...new Set(body.items.map((i) => i.productId))].sort(
    (a, b) => a - b,
  );
  const [rows] = await c.query(
    "SELECT * FROM products WHERE id IN (" +
      ids.map(() => "?").join(",") +
      ") ORDER BY id" +
      (lock ? " FOR UPDATE" : ""),
    ids,
  );
  const products = rows as Product[];
  const totals = new Map<number, number>();
  for (const i of merged.values())
    totals.set(i.productId, (totals.get(i.productId) || 0) + i.quantity);
  for (const [id, qty] of totals) {
    const p = products.find((x) => x.id === id);
    if (!p || !p.active)
      throw new HttpError(400, "Một sản phẩm hiện không còn được bán.");
    if (qty > p.stock || qty > 30)
      throw new HttpError(409, p.name + " không đủ số lượng trong kho.");
  }
  const items = [...merged.values()].map((i) => {
    const p = products.find((p) => p.id === i.productId)!;
    return {
      ...i,
      name: p.name,
      image: p.image,
      price: Math.round(p.price * { S: 1, M: 1.3, L: 1.6 }[i.size]),
    };
  });
  return calculateTotals(c, items, body.code, lock);
}
export async function calculateTotals<
  T extends { price: number; quantity: number },
>(c: PoolConnection, items: T[], code: string, lock = false) {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  let discount = 0,
    promotionId: null | number = null;
  if (code) {
    const [rs] = await c.execute(
      "SELECT * FROM promotions WHERE code=? AND active=1 AND starts_at<=NOW() AND ends_at>=NOW()" +
        (lock ? " FOR UPDATE" : ""),
      [code.trim().toUpperCase()],
    );
    const p = (rs as Promotion[])[0];
    if (!p || p.used >= p.usage_limit)
      throw new HttpError(
        400,
        "Mã ưu đãi không hợp lệ, hết hạn hoặc đã hết lượt sử dụng.",
      );
    if (subtotal < p.min_order)
      throw new HttpError(
        400,
        "Đơn hàng chưa đạt giá trị tối thiểu của mã ưu đãi.",
      );
    discount = Math.min(
      subtotal,
      p.type === "percent" ? Math.round((subtotal * p.value) / 100) : p.value,
    );
    promotionId = p.id;
  }
  const store = await assertStoreOpen(c);
  const shipping =
    subtotal >= store.settings.free_shipping ? 0 : store.settings.shipping;
  return {
    items,
    subtotal,
    discount,
    shipping,
    total: subtotal - discount + shipping,
    promotionId,
  };
}
export async function createOrder(
  body: z.infer<typeof checkoutSchema>,
  userId: number | null,
  checkoutOwner?: string,
) {
  const store = await assertStoreOpen();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(body.deliveryDate + "T00:00:00+07:00");
  if (
    Number.isNaN(date.getTime()) ||
    new Date(body.deliveryDate + "T12:00:00Z").toISOString().slice(0, 10) !==
      body.deliveryDate ||
    body.deliveryDate < today ||
    date.getTime() > Date.now() + store.settings.advance_days * 86400000
  )
    throw new HttpError(
      400,
      `Vui lòng chọn ngày giao từ hôm nay đến ${store.settings.advance_days} ngày tới.`,
    );
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    // Lock before the first consistent read so waiting transactions see committed reservations.
    const [lockedStores]: any = await c.execute(
      "SELECT * FROM stores WHERE id=? FOR UPDATE",
      [tenantId()],
    );
    const locked = lockedStores[0];
    if (!locked || locked.status !== "approved")
      throw new HttpError(409, "Cửa hàng hiện chưa nhận đơn.");
    store.settings =
      typeof locked.settings === "string"
        ? JSON.parse(locked.settings)
        : locked.settings;
    if (!store.settings.open)
      throw new HttpError(409, "Cửa hàng đang tạm nghỉ.");
    const [existing] = await c.execute(
      "SELECT reference,email,user_id,checkout_owner FROM orders WHERE idempotency_key=?",
      [body.idempotencyKey],
    );
    const previous = (existing as any[])[0];
    if (previous) {
      if (
        previous.email !== body.email ||
        (userId
          ? previous.user_id !== userId
          : !checkoutOwner || previous.checkout_owner !== checkoutOwner)
      )
        throw new HttpError(409, "Yêu cầu không hợp lệ.");
      await c.commit();
      return { reference: previous.reference };
    }
    await validateFulfillment(c, store, body);
    const quote = await calculate(c, body, true);
    if (body.expectedTotal !== undefined && body.expectedTotal !== quote.total)
      throw new HttpError(
        409,
        "Giá đã thay đổi. Vui lòng kiểm tra lại giỏ hàng trước khi đặt.",
      );
    const reference =
      "FL" +
      new Date().toISOString().slice(0, 10).replaceAll("-", "") +
      randomBytes(4).toString("hex").toUpperCase();
    const [result] = await c.execute(
      "INSERT INTO orders(reference,user_id,customer_name,email,phone,address,recipient_name,recipient_phone,delivery_date,delivery_slot,message,notes,payment_method,subtotal,discount,shipping,total,promotion_id,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        reference,
        userId,
        body.customerName,
        body.email,
        body.phone,
        body.address,
        body.recipientName,
        body.recipientPhone,
        body.deliveryDate,
        body.deliverySlot,
        body.message,
        body.notes,
        body.paymentMethod,
        quote.subtotal,
        quote.discount,
        quote.shipping,
        quote.total,
        quote.promotionId,
        body.idempotencyKey,
      ],
    );
    const id = (result as { insertId: number }).insertId;
    for (const i of quote.items) {
      await c.execute(
        "INSERT INTO order_items(order_id,product_id,product_name,image,size,quantity,price) VALUES(?,?,?,?,?,?,?)",
        [id, i.productId, i.name, i.image, i.size, i.quantity, i.price],
      );
      await c.execute("UPDATE products SET stock=stock-? WHERE id=?", [
        i.quantity,
        i.productId,
      ]);
    }
    if (quote.promotionId)
      await c.execute("UPDATE promotions SET used=used+1 WHERE id=?", [
        quote.promotionId,
      ]);
    const [existingCustomer]: any = await c.execute(
      "SELECT id FROM customers WHERE email=?",
      [body.email],
    );
    if (!existingCustomer.length)
      await emit(c, "customer:" + tenantId() + ":" + body.email, {
        audience: "staff",
        title: "Khách hàng mới",
        body: body.customerName,
        href: "/workspace/" + tenantId() + "/crm",
      });
    await c.execute(
      "INSERT INTO customers(email,name,phone,marketing_consent) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),phone=VALUES(phone),marketing_consent=GREATEST(marketing_consent,VALUES(marketing_consent))",
      [body.email, body.customerName, body.phone, body.consent ? 1 : 0],
    );

    await c.execute(
      "UPDATE orders SET store_name=?,delivery_mode=?,checkout_owner=?,delivery_lat=?,delivery_lng=?,customer_id=(SELECT id FROM customers WHERE email=?) WHERE id=?",
      [
        store.name,
        body.deliveryMode,
        checkoutOwner || null,
        body.deliveryLat ?? null,
        body.deliveryLng ?? null,
        body.email,
        id,
      ],
    );
    if (userId)
      await c.execute(
        "INSERT INTO notification_preferences(user_id,store_id,marketing,push) VALUES(?,?,?,0) ON DUPLICATE KEY UPDATE marketing=VALUES(marketing)",
        [userId, tenantId(), body.consent ? 1 : 0],
      );
    await c.execute(
      "INSERT INTO order_status_events(order_id,actor_id,status) VALUES(?,?,?)",
      [id, userId, "pending"],
    );
    await emit(c, "order:" + id + ":new", {
      audience: "staff",
      title: "Đơn hàng mới",
      body: reference + " · " + body.customerName,
    });
    await enqueueOrderEmail(c, id, "order_confirmation");
    await c.commit();
    return { reference, total: quote.total };
  } catch (e) {
    await c.rollback();
    if (
      (e as { code?: string }).code === "ER_DUP_ENTRY" ||
      (e instanceof HttpError && e.status === 409)
    ) {
      const [rows] = await c.execute(
        "SELECT reference,total,email,user_id,checkout_owner FROM orders WHERE idempotency_key=?",
        [body.idempotencyKey],
      );
      const previous = (rows as any[])[0];
      if (
        previous &&
        previous.email === body.email &&
        (userId
          ? previous.user_id === userId
          : checkoutOwner && previous.checkout_owner === checkoutOwner)
      )
        return { reference: previous.reference, total: previous.total };
    }
    throw e;
  } finally {
    c.release();
  }
}
export async function changeOrder(
  id: number,
  status: string,
  actor: number,
  owner = false,
  version?: number,
) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.execute(
      "SELECT * FROM orders WHERE id=? FOR UPDATE",
      [id],
    );
    const o = (rows as any[])[0];
    if (!o) throw new HttpError(404, "Không tìm thấy đơn hàng.");
    if (version !== undefined && o.version !== version)
      throw new HttpError(409, "Đơn hàng vừa được cập nhật. Hãy tải lại.");
    if (
      owner &&
      (o.user_id !== actor ||
        status !== "cancelled" ||
        ["paid", "partially_paid", "partially_refunded"].includes(
          o.payment_status,
        ))
    )
      throw new HttpError(
        403,
        "Không thể huỷ đơn này. Vui lòng liên hệ Fleur.",
      );
    const next: Record<string, string[]> = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["preparing", "cancelled"],
      preparing: ["ready"],
      ready: ["shipping"],
      shipping: ["delivered"],
      delivered: [],
      cancelled: [],
    };
    if (!next[o.status]?.includes(status))
      throw new HttpError(
        400,
        "Trạng thái đơn hàng không thể chuyển theo cách này.",
      );
    if (status === "cancelled") {
      const [items] = await c.execute(
        "SELECT product_id,quantity FROM order_items WHERE order_id=? AND product_id IS NOT NULL AND line_type='catalog' ORDER BY product_id",
        [id],
      );
      for (const i of items as any[])
        await c.execute("UPDATE products SET stock=stock+? WHERE id=?", [
          i.quantity,
          i.product_id,
        ]);
      if (o.promotion_id)
        await c.execute(
          "UPDATE promotions SET used=GREATEST(0,used-1) WHERE id=?",
          [o.promotion_id],
        );
    }
    await c.execute(
      "UPDATE orders SET status=?,version=version+1,completed_at=IF(?='delivered',NOW(),completed_at),confirmed_at=IF(?='confirmed',NOW(),confirmed_at),shipped_at=IF(?='shipping',NOW(),shipped_at) WHERE id=?",
      [status, status, status, status, id],
    );
    await c.execute(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
      [actor, status, "orders", String(id)],
    );
    await c.execute(
      "INSERT INTO order_status_events(order_id,actor_id,status) VALUES(?,?,?)",
      [id, actor, status],
    );
    await emit(c, "order:" + id + ":" + (o.version + 1), {
      userId: o.user_id,
      title: "Đơn " + o.reference + " · " + orderLabels[status],
      body: "Cửa hàng đã cập nhật trạng thái đơn hoa của bạn.",
    });
    await enqueueOrderEmail(c, id, "order_status", o.status);
    await c.commit();
    return { ok: true };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
