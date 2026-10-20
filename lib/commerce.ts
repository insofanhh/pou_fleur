import { orderSessionView, expireStoreOrderSessions } from "./order-payment-sessions";
import { hanoiDateKey } from "./date-time";
import { isPickup, orderStateLabel } from "./order-fulfillment";
import { tenantId } from "./tenant";
import { needsTransitionReason, orderStates } from "./order-workflow";
import { orderPaymentStatusSQL } from "./order-payment-state";
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
import { activeBank, createIntent } from "./sepay";
import { collectCOD } from "./order-cod";
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
export const checkoutSchema = quoteSchema
  .extend({
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
    paymentMethod: z.enum(["cod", "bank"]),
    consent: z.boolean().default(false),
    idempotencyKey: z.string().uuid(),
    expectedTotal: z.number().int().nonnegative().optional(),
    deliveryLat: z.number().min(-90).max(90).optional(),
    deliveryLng: z.number().min(-180).max(180).optional(),
    codPayer: z.enum(["buyer", "recipient"]).optional(),
    codRecipientConsent: z.boolean().default(false),
  })
  .superRefine((b, ctx) => {
    if (b.paymentMethod !== "cod" || b.deliveryMode !== "gift") return;
    if (!b.codPayer)
      ctx.addIssue({
        code: "custom",
        path: ["codPayer"],
        message: "Chọn người thanh toán COD cho đơn quà tặng.",
      });
    if (b.codPayer === "recipient" && !b.codRecipientConsent)
      ctx.addIssue({
        code: "custom",
        path: ["codRecipientConsent"],
        message: "Vui lòng xác nhận người nhận sẽ thanh toán COD.",
      });
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
  await expireStoreOrderSessions();
  const store = await assertStoreOpen();
  const today = hanoiDateKey();
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
      "SELECT * FROM orders WHERE idempotency_key=?",
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
      const [sessions]: any = await c.execute("SELECT * FROM payment_intents WHERE order_id=? AND kind='order' ORDER BY id DESC LIMIT 1", [previous.id]);
      return { reference: previous.reference, total: previous.total, payment: sessions[0] ? orderSessionView(sessions[0], previous) : null };
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
      hanoiDateKey().replaceAll("-", "") +
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
    let payment: any = null;
    if (body.paymentMethod === "bank") {
      const bank = await activeBank(tenantId(), c);
      if (!bank)
        throw new HttpError(409, "Cửa hàng chưa cấu hình nhận chuyển khoản.");
      payment = await createIntent(
        c,
        tenantId(),
        "order",
        store.owner_id,
        quote.total,
        id,
        null,
        bank,
      );
    }
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
      "UPDATE orders SET store_name=?,delivery_mode=?,checkout_owner=?,delivery_lat=?,delivery_lng=?,cod_payer=?,cod_recipient_consent_at=IF(?,UTC_TIMESTAMP(),NULL),customer_id=(SELECT id FROM customers WHERE email=?) WHERE id=?",
      [
        store.name,
        body.deliveryMode,
        checkoutOwner || null,
        body.deliveryLat ?? null,
        body.deliveryLng ?? null,
        body.paymentMethod === "cod"
          ? body.deliveryMode === "self"
            ? "buyer"
            : (body.codPayer ?? null)
          : null,
        body.paymentMethod === "cod" &&
        body.deliveryMode === "gift" &&
        body.codPayer === "recipient" &&
        body.codRecipientConsent
          ? 1
          : 0,
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
      title: body.paymentMethod === "cod" ? "Đơn COD mới" : "Đơn hàng mới",
      body:
        reference +
        " · " +
        body.customerName +
        (body.paymentMethod === "cod"
          ? ` · Cần thu ${quote.total.toLocaleString("vi-VN")} VNĐ · ${body.deliveryMode === "self" || body.codPayer === "buyer" ? "Người đặt trả tiền" : "Người nhận trả tiền"}`
          : ""),
    });
    await enqueueOrderEmail(c, id, "order_confirmation");
    await c.commit();
    return { reference, total: quote.total, payment };
  } catch (e) {
    await c.rollback();
    if (
      (e as { code?: string }).code === "ER_DUP_ENTRY" ||
      (e instanceof HttpError && e.status === 409)
    ) {
      const [rows] = await c.execute(
        "SELECT * FROM orders WHERE idempotency_key=?",
        [body.idempotencyKey],
      );
      const previous = (rows as any[])[0];
      if (
        previous &&
        previous.email === body.email &&
        (userId
          ? previous.user_id === userId
          : checkoutOwner && previous.checkout_owner === checkoutOwner)
      ) {
        const [sessions]: any = await c.execute("SELECT * FROM payment_intents WHERE order_id=? AND kind='order' ORDER BY id DESC LIMIT 1", [previous.id]);
        return { reference: previous.reference, total: previous.total, payment: sessions[0] ? orderSessionView(sessions[0], previous) : null };
      }
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
  options: {
    reason?: string;
    date?: string;
    slot?: string;
    codOutcome?: "paid" | "partial" | "unpaid";
    codPayment?: unknown;
  } = {},
) {
  await expireStoreOrderSessions();
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    // Use the same lock order as checkout/rescheduling to serialize capacity checks.
    await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [
      tenantId(),
    ]);
    const [rows] = await c.execute(
      "SELECT o.*," +
        orderPaymentStatusSQL() +
        " payment_status FROM orders o WHERE o.id=? FOR UPDATE",
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
        "Không thể huỷ đơn này. Vui lòng liên hệ Fleurious.",
      );
    if (
      !orderStates.includes(status as any) ||
      (owner && !["pending", "confirmed"].includes(o.status))
    )
      throw new HttpError(
        400,
        "Trạng thái đơn hàng không thể chuyển theo cách này.",
      );
    if (status === o.status) return await c.commit().then(() => ({ ok: true }));
    if (isPickup(o) && !["delivered", "cancelled"].includes(status))
      throw new HttpError(400, "Đơn nhận ngay chỉ có thể xác nhận đã nhận tại cửa hàng hoặc hủy.");
    if ((o.payment_method === "cod" || isPickup(o)) && status === "delivered") {
      const [sums]: any = await c.execute(
        "SELECT COUNT(*) n,COALESCE(SUM(IF(kind IN ('collect','correction'),amount,-amount)),0) balance FROM order_payments WHERE order_id=?",
        [id],
      );
      const balance = Number(sums[0].balance);
      if (o.payment_status !== "paid" && Number(o.total) > balance) {
        if (!options.codOutcome)
          throw new HttpError(
            400,
            "Chọn kết quả thu COD khi hoàn tất giao hoa.",
          );
        if (options.codOutcome !== "unpaid") {
          if (o.status === "cancelled")
            throw new HttpError(
              409,
              "Khôi phục đơn trước khi xác nhận thu COD.",
            );
          if (!options.codPayment)
            throw new HttpError(400, "Xác nhận số tiền COD thực tế đã nhận.");
          await collectCOD(c, id, actor, options.codPayment);
          const [after]: any = await c.execute(
            "SELECT COALESCE(SUM(IF(kind IN ('collect','correction'),amount,-amount)),0) balance FROM order_payments WHERE order_id=?",
            [id],
          );
          const paid = Number(after[0].balance);
          if (
            (options.codOutcome === "paid" && paid !== Number(o.total)) ||
            (options.codOutcome === "partial" && paid >= Number(o.total))
          )
            throw new HttpError(
              400,
              "Số tiền không khớp kết quả thu COD đã chọn.",
            );
        } else if (options.codPayment)
          throw new HttpError(
            400,
            "Không gửi giao dịch khi chọn chưa nhận tiền.",
          );
      } else if (options.codPayment || options.codOutcome)
        throw new HttpError(
          409,
          "Đơn không còn khoản COD cần thu. Hãy làm mới.",
        );
    } else if (options.codPayment || options.codOutcome)
      throw new HttpError(
        400,
        "Chỉ ghi kết quả COD cùng thao tác hoàn tất giao hoa.",
      );
    const reason = options.reason?.trim() || "";
    if (isPickup(o) && status === "delivered" && o.payment_status !== "paid") {
      const [balanceRows]: any = await c.execute("SELECT COALESCE(SUM(IF(kind IN ('collect','correction'),amount,-amount)),0) balance FROM order_payments WHERE order_id=?", [id]);
      if (Number(balanceRows[0].balance) < Number(o.total)) {
        const [members]: any = await c.execute("SELECT role FROM store_memberships WHERE store_id=? AND user_id=? AND status='active'", [tenantId(), actor]);
        if (members[0]?.role !== "owner" || reason.length < 5)
          throw new HttpError(403, "Chỉ chủ cửa hàng được bàn giao chưa thu đủ; cần nhập lý do.");
      }
    }
    if (!owner && needsTransitionReason(o.status, status) && reason.length < 5)
      throw new HttpError(400, "Vui lòng nhập lý do ít nhất 5 ký tự.");
    let deliveryDate = o.delivery_date,
      deliverySlot = o.delivery_slot;
    if (isPickup(o) && status === "delivered") {
      const [members]: any = await c.execute("SELECT role FROM store_memberships WHERE store_id=? AND user_id=? AND status='active'",[tenantId(),actor]);
      if (!["owner","admin","manager"].includes(members[0]?.role))
        throw new HttpError(403,"Bạn chưa có quyền xác nhận bàn giao tại cửa hàng.");
    }
    if (o.status === "cancelled") {
      const store = await assertStoreOpen(c);
      deliveryDate = options.date || o.delivery_date;
      deliverySlot = options.slot || o.delivery_slot;
      if (isPickup(o)) { deliveryDate = hanoiDateKey(); deliverySlot = "Nhận ngay"; }
      else await validateFulfillment(
        c,
        store,
        {
          deliveryDate,
          deliverySlot,
          ...(o.delivery_lat != null && o.delivery_lng != null
            ? {
                deliveryLat: Number(o.delivery_lat),
                deliveryLng: Number(o.delivery_lng),
              }
            : {}),
        },
        id,
      );
      const [items]: any = await c.execute(
        "SELECT product_id,SUM(quantity) quantity FROM order_items WHERE order_id=? AND line_type='catalog' GROUP BY product_id ORDER BY product_id",
        [id],
      );
      for (const i of items) {
        if (!i.product_id)
          throw new HttpError(409, "Sản phẩm đã bị xóa. Hãy tạo đơn mới.");
        const [r]: any = await c.execute(
          "UPDATE products SET stock=stock-? WHERE id=? AND stock>=? AND active=1",
          [i.quantity, i.product_id, i.quantity],
        );
        if (!r.affectedRows)
          throw new HttpError(
            409,
            "Không đủ tồn kho hoặc sản phẩm đã ngừng bán để khôi phục đơn.",
          );
      }
      if (o.promotion_id) {
        const [r]: any = await c.execute(
          "UPDATE promotions SET used=used+1 WHERE id=? AND used<usage_limit",
          [o.promotion_id],
        );
        if (!r.affectedRows)
          throw new HttpError(
            409,
            "Chương trình giảm giá đã hết lượt. Hãy tạo đơn mới.",
          );
      }
    }
    if (status === "cancelled") {
      await c.execute("UPDATE payment_intents SET status='cancelled' WHERE order_id=? AND kind='order' AND status='pending'", [id]);
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
      "UPDATE orders SET status=?,version=version+1,delivery_date=?,delivery_slot=?,completed_at=IF(?='delivered',COALESCE(completed_at,NOW()),NULL),confirmed_at=IF(? IN ('confirmed','preparing','ready','shipping','delivered'),COALESCE(confirmed_at,NOW()),NULL),shipped_at=IF(fulfillment_method='pickup',NULL,IF(? IN ('shipping','delivered'),COALESCE(shipped_at,NOW()),NULL)),picked_up_at=IF(fulfillment_method='pickup' AND ?='delivered',COALESCE(picked_up_at,NOW()),NULL) WHERE id=?",
      [status, deliveryDate, deliverySlot, status, status, status, status, id],
    );
    await c.execute(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
      [actor, status, "orders", String(id)],
    );
    await c.execute(
      "INSERT INTO order_status_events(order_id,actor_id,status,detail) VALUES(?,?,?,?)",
      [
        id,
        actor,
        status,
        `${orderStateLabel(o)} → ${orderStateLabel(o, status)}${reason ? ": " + reason : ""}${o.status === "cancelled" ? ` · ${isPickup(o) ? "Nhận tại cửa hàng" : "Lịch giao"}: ${deliveryDate} ${deliverySlot}` : ""}${options.codOutcome === "unpaid" ? " · Chưa nhận thêm tiền, cần theo dõi khoản còn thiếu" : ""}`,
      ],
    );
    await emit(c, "order:" + id + ":" + (o.version + 1), {
      userId: o.user_id,
      title: "Đơn " + o.reference + " · " + orderStateLabel(o, status),
      body: "Cửa hàng đã cập nhật trạng thái đơn hoa của bạn.",
    });
    if (options.codOutcome === "unpaid")
      await emit(c, "order:" + id + ":cod-due:" + (o.version + 1), {
        audience: "staff",
        title: isPickup(o) ? "Đơn nhận tại quầy còn công nợ" : "Đơn COD đã giao chưa thu đủ",
        body: o.reference + (isPickup(o) ? " · Theo dõi khoản còn phải thu tại quầy." : " · Kiểm tra và đối soát tiền COD còn phải thu."),
        href: "/workspace/" + tenantId() + "/orders?order=" + id,
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
