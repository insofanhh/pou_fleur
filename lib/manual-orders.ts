import { z } from "zod";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { pool, query, mutate } from "./db";
import { digest, ghostContext, HttpError, requirePermission } from "./auth";
import { tenantId } from "./tenant";
import { assertStoreOpen, jsonValue, storeBy } from "./stores";
import { calculate, calculateTotals } from "./commerce";
import { validateFulfillment } from "./fulfillment";
import { recordOrderPayment } from "./order-payments";
import { orderCapabilities } from "./order-capabilities";
import { enqueueOrderEmail } from "./email";
import { emit } from "./domain-events";
import type { PoolConnection } from "mysql2/promise";

const integer = z.number().int().min(0).max(100000000);
const positiveId = z.number().int().positive();
const lineSchema = z
  .object({
    type: z.enum(["catalog", "custom"]),
    productId: positiveId.optional(),
    name: z.string().trim().max(160).default(""),
    description: z.string().max(1000).default(""),
    image: z
      .string()
      .max(2000)
      .regex(/^(?:$|\/(?!\/)|https:\/\/)/)
      .default(""),
    quantity: z.number().int().min(1).max(30),
    size: z.enum(["S", "M", "L"]).default("S"),
    price: integer.optional(),
    reason: z.string().trim().max(500).default(""),
  })
  .refine((i) => i.type === "custom" || !!i.productId, "Cần chọn sản phẩm.");
export const manualInput = z.object({
  customerId: positiveId.nullable().default(null),
  customerName: z.string().trim().max(100).default(""),
  email: z
    .union([z.literal(""), z.email()])
    .transform((s) => s.toLowerCase())
    .default(""),
  phone: z.string().trim().max(30).default(""),
  separateContact: z.boolean().default(false),
  salesChannel: z
    .enum(["phone", "zalo", "social", "in_person", "other"])
    .default("phone"),
  items: z.array(lineSchema).max(30).default([]),
  code: z.string().trim().max(40).default(""),
  discountType: z.enum(["none", "amount", "percent"]).default("none"),
  discountValue: integer.default(0),
  adjustmentReason: z.string().trim().max(500).default(""),
  shipping: integer.optional(),
  deliveryMode: z.enum(["self", "gift"]).default("gift"),
  recipientName: z.string().trim().max(100).default(""),
  recipientPhone: z.string().trim().max(30).default(""),
  address: z.string().trim().max(500).default(""),
  deliveryDate: z.string().max(10).default(""),
  deliverySlot: z.string().max(30).default(""),
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  message: z.string().max(500).default(""),
  notes: z.string().max(1000).default(""),
  internalNotes: z.string().max(2000).default(""),
  assignedTo: positiveId.nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(30)).max(6).default([]),
  initialStatus: z.enum(["pending", "confirmed"]).default("pending"),
  collectAmount: integer.default(0),
  collectMethod: z.enum(["cash", "bank"]).default("cash"),
  paymentReference: z.string().trim().max(100).default(""),
  receivedAt: z.string().datetime({ offset: true }).optional(),
});
type Input = z.infer<typeof manualInput>;
type Actor = Awaited<ReturnType<typeof requirePermission>>;
export const normalizePhone = (s: string) => {
  const digits = s.replace(/\D/g, "");
  return digits.startsWith("0") ? "84" + digits.slice(1) : digits;
};
function requireInput(b: Input) {
  const validPhone = (s: string) =>
    /^[+0-9 ()-]{9,20}$/.test(s) && normalizePhone(s).length >= 9;
  if (b.customerName.length < 2 || !validPhone(b.phone))
    throw new HttpError(400, "Cần tên và số điện thoại hợp lệ của người đặt.");
  if (
    b.deliveryMode === "gift" &&
    (b.recipientName.length < 2 || !validPhone(b.recipientPhone))
  )
    throw new HttpError(400, "Cần tên và số điện thoại hợp lệ của người nhận.");
  if (b.address.length < 10 || !b.deliveryDate || !b.deliverySlot)
    throw new HttpError(400, "Cần địa chỉ, ngày và khung giờ giao hoa.");
}
function checkCapabilities(b: Input, actor: Actor) {
  const cap = orderCapabilities(actor.role);
  if (!cap.create) throw new HttpError(403, "Bạn chưa có quyền tạo đơn.");
  if (b.initialStatus === "confirmed" && !cap.confirm)
    throw new HttpError(403, "Bạn chưa có quyền xác nhận ngay.");
  if (b.collectAmount && !cap.collect)
    throw new HttpError(403, "Chỉ chủ cửa hàng được ghi nhận thu tiền.");
  if (
    (b.discountType !== "none" ||
      b.shipping !== undefined ||
      b.items.some((i) => i.type === "catalog" && i.price !== undefined)) &&
    !cap.adjust
  )
    throw new HttpError(403, "Bạn chưa có quyền điều chỉnh giá.");
}
async function quote(c: PoolConnection, b: Input, actor: Actor, lock = false) {
  checkCapabilities(b, actor);
  if (!b.items.length) throw new HttpError(400, "Thêm ít nhất một sản phẩm.");
  const catalog = b.items.filter((i) => i.type === "catalog");
  const priced = catalog.length
    ? (
        await calculate(
          c,
          {
            items: catalog.map((i) => ({
              productId: i.productId!,
              quantity: i.quantity,
              size: i.size,
            })),
            code: "",
          },
          lock,
        )
      ).items
    : [];
  // Keep individual rows for snapshots; calculate() above aggregates stock by product.
  const items = b.items.map((i) => {
    if (i.type === "custom") {
      if (!i.name || i.price === undefined || (!i.price && i.reason.length < 5))
        throw new HttpError(
          400,
          "Thiết kế riêng cần tên, giá; giá 0 cần lý do từ 5 ký tự.",
        );
      if (!i.price && !orderCapabilities(actor.role).adjust)
        throw new HttpError(403, "Bạn chưa có quyền miễn phí thiết kế riêng.");
      return { ...i, productId: null, originalPrice: i.price, price: i.price };
    }
    const p = priced.find(
      (p) => p.productId === i.productId && p.size === i.size,
    )!;
    if (i.price !== undefined && i.price !== p.price && i.reason.length < 5)
      throw new HttpError(400, "Sửa giá cần lý do từ 5 ký tự.");
    return {
      ...i,
      name: p.name,
      image: p.image,
      originalPrice: p.price,
      price: i.price ?? p.price,
    };
  });
  if (b.code && b.discountType !== "none")
    throw new HttpError(400, "Chỉ chọn mã ưu đãi hoặc giảm giá thủ công.");
  const totals = await calculateTotals(c, items, b.code, lock);
  if (b.discountType !== "none") {
    if (
      b.adjustmentReason.length < 5 ||
      (b.discountType === "percent" && b.discountValue > 100)
    )
      throw new HttpError(400, "Giảm giá cần lý do và giá trị hợp lệ.");
    totals.discount = Math.min(
      totals.subtotal,
      b.discountType === "percent"
        ? Math.round((totals.subtotal * b.discountValue) / 100)
        : b.discountValue,
    );
  }
  if (b.shipping !== undefined) {
    if (b.adjustmentReason.length < 5)
      throw new HttpError(400, "Sửa phí giao cần lý do từ 5 ký tự.");
    totals.shipping = b.shipping;
  }
  totals.total = totals.subtotal - totals.discount + totals.shipping;
  if (totals.total > 2000000000)
    throw new HttpError(400, "Giá trị đơn vượt giới hạn.");
  if (b.collectAmount > totals.total)
    throw new HttpError(400, "Tiền thu không được vượt tổng đơn.");
  return { ...totals, token: digest(JSON.stringify(totals)) };
}
async function audit(
  c: PoolConnection,
  actor: Actor,
  action: string,
  entity: string,
  id: number,
) {
  await c.execute(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
    [actor.id, action, entity, String(id)],
  );
}
async function contact(c: PoolConnection, b: Input) {
  if (b.customerId) {
    const [rows]: any = await c.execute(
      "SELECT id FROM customers WHERE id=? FOR UPDATE",
      [b.customerId],
    );
    if (!rows.length) throw new HttpError(404, "Khách không thuộc cửa hàng.");
    return b.customerId;
  }
  const [matches]: any = await c.execute(
    "SELECT id,email FROM customers WHERE (email IS NOT NULL AND email=?) OR phone_normalized=?",
    [b.email || null, normalizePhone(b.phone)],
  );
  if (
    matches.some((r: any) => b.email && r.email === b.email) ||
    (matches.length && !b.separateContact)
  )
    throw new HttpError(
      409,
      "Thông tin khớp khách đã có. Hãy tìm và chọn hồ sơ, hoặc xác nhận số điện thoại dùng chung.",
    );
  const [r]: any = await c.execute(
    "INSERT INTO customers(email,name,phone,phone_normalized,marketing_consent) VALUES(?,?,?,?,0)",
    [b.email || null, b.customerName, b.phone, normalizePhone(b.phone)],
  );
  await emit(c, "customer:" + tenantId() + ":id:" + r.insertId, {
    audience: "staff",
    title: "Khách hàng mới",
    body: b.customerName,
    href: "/workspace/" + tenantId() + "/crm",
  });
  return r.insertId as number;
}
async function finalize(raw: any, actor: Actor) {
  const request = manualInput
    .extend({
      idempotencyKey: z.string().uuid(),
      quoteToken: z.string().length(64),
      draftId: positiveId.optional(),
      draftVersion: positiveId.optional(),
    })
    .parse(raw);
  const b = manualInput.parse(request);
  checkCapabilities(b, actor);
  requireInput(b);
  const hash = digest(JSON.stringify(request));
  const ghost = await ghostContext();
  const jar = await cookies();
  const ghostCookie = jar.get("fleur_ghost")?.value;
  const sessionCookie = jar.get("fleur_session")?.value;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [stores]: any = await c.execute(
      "SELECT * FROM stores WHERE id=? FOR UPDATE",
      [tenantId()],
    );
    // Permission is re-read after acquiring the lock, rather than trusting the form.
    const [members]: any = await c.execute(
      "SELECT m.role FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=? AND m.user_id=? AND m.status='active' AND u.active=1 FOR UPDATE",
      [tenantId(), actor.id],
    );
    if (!members.length)
      throw new HttpError(403, "Quyền cửa hàng đã thay đổi.");
    const current = { ...actor, role: members[0].role };
    checkCapabilities(b, current);
    const [old]: any = await c.execute(
      "SELECT id,reference,total,manual_payload_hash,created_by FROM orders WHERE idempotency_key=?",
      [request.idempotencyKey],
    );
    if (old.length) {
      if (old[0].created_by !== actor.id || old[0].manual_payload_hash !== hash)
        throw new HttpError(409, "Khóa yêu cầu đã dùng cho nội dung khác.");
      await c.commit();
      return {
        id: old[0].id,
        reference: old[0].reference,
        total: old[0].total,
      };
    }
    const store = stores[0];
    if (
      !store ||
      store.status !== "approved" ||
      !jsonValue(store.settings).open
    )
      throw new HttpError(409, "Cửa hàng hiện chưa nhận đơn.");
    store.settings = jsonValue(store.settings);
    await assertStoreOpen(c);
    if (request.draftId) {
      const [ds]: any = await c.execute(
        "SELECT * FROM order_drafts WHERE id=? FOR UPDATE",
        [request.draftId],
      );
      if (!ds.length) throw new HttpError(404, "Không tìm thấy nháp.");
      if (ds[0].status !== "draft" || ds[0].version !== request.draftVersion)
        throw new HttpError(
          409,
          "Nháp đã thay đổi hoặc đã chuyển thành đơn. Hãy mở lại.",
        );
    }
    await validateFulfillment(c, store, b, undefined, true);
    const q = await quote(c, b, current, true);
    if (q.token !== request.quoteToken)
      throw new HttpError(
        409,
        "Giá đã thay đổi. Vui lòng tính lại và rà soát đơn.",
      );
    if (b.assignedTo) {
      const [ms]: any = await c.execute(
        "SELECT user_id FROM store_memberships WHERE store_id=? AND user_id=? AND status='active'",
        [tenantId(), b.assignedTo],
      );
      if (!ms.length) throw new HttpError(400, "Nhân sự không thuộc cửa hàng.");
    }
    const customerId = await contact(c, b);
    const reference =
      "FL" +
      new Date().toISOString().slice(0, 10).replaceAll("-", "") +
      randomBytes(4).toString("hex").toUpperCase();
    if (ghostCookie && !ghost?.valid)
      throw new HttpError(403, "Phiên Ghost đã hết hạn.");
    const adjustment = {
      discountType: b.discountType,
      discountValue: b.discountValue,
      reason: b.adjustmentReason,
      shippingOverride: b.shipping ?? null,
      ghost: ghost
        ? {
            actorId: ghost.actorId,
            targetId: ghost.targetId,
            sessionHash: digest(ghostCookie!),
          }
        : null,
    };
    const [result]: any = await c.execute(
      "INSERT INTO orders(reference,user_id,customer_id,customer_name,email,phone,address,recipient_name,recipient_phone,delivery_date,delivery_slot,delivery_mode,delivery_lat,delivery_lng,message,notes,internal_notes,payment_method,subtotal,discount,shipping,total,promotion_id,idempotency_key,status,creation_source,sales_channel,created_by,confirmed_by,store_name,assigned_to,tags,manual_payload_hash,adjustment) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        reference,
        null,
        customerId,
        b.customerName,
        b.email || null,
        b.phone,
        b.address,
        b.deliveryMode === "self" ? b.customerName : b.recipientName,
        b.deliveryMode === "self" ? b.phone : b.recipientPhone,
        b.deliveryDate,
        b.deliverySlot,
        b.deliveryMode,
        b.deliveryLat ?? null,
        b.deliveryLng ?? null,
        b.message,
        b.notes,
        b.internalNotes,
        b.collectMethod === "bank" ? "bank" : "cod",
        q.subtotal,
        q.discount,
        q.shipping,
        q.total,
        q.promotionId,
        request.idempotencyKey,
        b.initialStatus,
        "manual",
        b.salesChannel,
        actor.id,
        b.initialStatus === "confirmed" ? actor.id : null,
        store.name,
        b.assignedTo,
        JSON.stringify(b.tags),
        hash,
        JSON.stringify(adjustment),
      ],
    );
    const orderId = result.insertId;
    for (const i of q.items) {
      await c.execute(
        "INSERT INTO order_items(order_id,product_id,product_name,image,size,quantity,price,line_type,original_price,description) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          orderId,
          i.productId,
          i.name,
          i.image,
          i.size,
          i.quantity,
          i.price,
          i.type,
          i.originalPrice,
          JSON.stringify({ text: i.description, priceReason: i.reason }),
        ],
      );
      if (i.type === "catalog")
        await c.execute("UPDATE products SET stock=stock-? WHERE id=?", [
          i.quantity,
          i.productId!,
        ]);
    }
    if (q.promotionId)
      await c.execute("UPDATE promotions SET used=used+1 WHERE id=?", [
        q.promotionId,
      ]);
    if (b.initialStatus === "confirmed")
      await c.execute("UPDATE orders SET confirmed_at=NOW() WHERE id=?", [
        orderId,
      ]);
    if (b.collectAmount)
      await recordOrderPayment(c, orderId, actor.id, {
        kind: "collect",
        amount: b.collectAmount,
        method: b.collectMethod,
        reference: b.paymentReference || "CASH-" + reference,
        receivedAt: b.receivedAt,
      });
    if (
      b.collectAmount &&
      b.collectMethod === "bank" &&
      b.paymentReference.length < 5
    )
      throw new HttpError(400, "Nhập mã tham chiếu chuyển khoản từ 5 ký tự.");
    await c.execute(
      "INSERT INTO order_status_events(order_id,actor_id,status) VALUES(?,?,?)",
      [orderId, actor.id, b.initialStatus],
    );
    await audit(c, actor, "manual:create", "orders", orderId);
    if (request.draftId)
      await c.execute(
        "UPDATE order_drafts SET status='converted',converted_order_id=?,updated_by=?,version=version+1 WHERE id=?",
        [orderId, actor.id, request.draftId],
      );
    await emit(c, "order:" + orderId + ":new", {
      audience: "staff",
      title: "Đơn hàng mới",
      body: reference + " · " + b.customerName,
    });
    await enqueueOrderEmail(c, orderId, "order_confirmation");
    if (ghostCookie) {
      const [valid]: any = await c.execute(
        "SELECT g.actor_id FROM ghost_sessions g JOIN sessions s ON s.token_hash=g.admin_session_hash JOIN users a ON a.id=g.actor_id JOIN platform_memberships p ON p.user_id=a.id WHERE g.token_hash=? AND g.admin_session_hash=? AND g.target_id=? AND g.ended_at IS NULL AND g.expires_at>NOW() AND s.expires_at>NOW() AND a.active=1 AND p.role='platform_admin' AND NOT EXISTS(SELECT 1 FROM platform_memberships t WHERE t.user_id=g.target_id) FOR UPDATE",
        [digest(ghostCookie), digest(sessionCookie || ""), actor.id],
      );
      if (!valid.length)
        throw new HttpError(403, "Phiên Ghost đã hết hạn hoặc bị thu hồi.");
    }
    await c.commit();
    return { id: orderId, reference, total: q.total };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export async function manualOrdersAPI(
  path: string[],
  method: string,
  body: any,
  url: URL,
): Promise<any | undefined> {
  if (
    ![
      "manual-orders",
      "order-drafts",
      "order-customers",
      "order-products",
    ].includes(path[0])
  )
    return undefined;
  const actor = await requirePermission("orders");
  if (!orderCapabilities(actor.role).create)
    throw new HttpError(403, "Bạn chưa có quyền tạo đơn.");
  const readingOrder =
    path[0] === "manual-orders" &&
    path.length === 2 &&
    /^\d+$/.test(path[1]) &&
    method === "GET";
  if (process.env.MANUAL_ORDERS_ENABLED === "false" && !readingOrder)
    throw new HttpError(403, "Tạo đơn thủ công đang tạm tắt.");
  const area = path[0];
  if (
    (area === "order-customers" || area === "order-products") &&
    method === "GET" &&
    path.length === 1
  ) {
    const term = z
      .string()
      .trim()
      .max(100)
      .parse(url.searchParams.get("q") || "");
    const like = "%" + term.replace(/[\\%_]/g, "\\$&") + "%";
    if (area === "order-customers") {
      if (url.searchParams.has("customer"))
        return query("SELECT id,name,email,phone FROM customers WHERE id=?", [
          z.coerce
            .number()
            .int()
            .positive()
            .parse(url.searchParams.get("customer")),
        ]);
      const normalized = normalizePhone(term);
      return query(
        "SELECT id,name,email,phone FROM customers WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR phone_normalized LIKE ? ORDER BY id DESC LIMIT 20",
        [
          like,
          like,
          like,
          normalized ? "%" + normalized + "%" : "__no_phone__",
        ],
      );
    }
    return query(
      "SELECT id,name,image,price,stock FROM products WHERE active=1 AND name LIKE ? ORDER BY id DESC LIMIT 20",
      [like],
    );
  }
  if (area === "manual-orders" && path[1] === "options" && method === "GET") {
    const store = await storeBy(tenantId());
    return {
      capabilities: orderCapabilities(actor.role),
      settings: store.settings,
      requiresCoordinates: store.lat !== null && store.lng !== null,
      staff: await query(
        "SELECT m.user_id id,u.name FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=? AND m.status='active' AND u.active=1",
        [tenantId()],
      ),
    };
  }
  if (area === "manual-orders" && path[1] === "quote" && method === "POST") {
    const c = await pool.getConnection();
    try {
      return await quote(c, manualInput.parse(body), actor);
    } finally {
      c.release();
    }
  }
  if (area === "manual-orders" && path.length === 1 && method === "POST")
    return finalize(body, actor);
  if (area === "manual-orders" && path.length === 2 && method === "GET") {
    const id = z.coerce.number().int().positive().parse(path[1]);
    const [order] = await query<any[]>(
      "SELECT o.*,(SELECT u.name FROM users u WHERE u.id=o.created_by) creator_name,(SELECT COALESCE(SUM(IF(p.kind='collect',p.amount,-p.amount)),0) FROM order_payments p WHERE p.order_id=o.id) collected FROM orders o WHERE o.id=?",
      [id],
    );
    if (!order) throw new HttpError(404, "Không tìm thấy đơn.");
    order.items = await query(
      "SELECT product_name name,quantity,size,price,line_type,image,description FROM order_items WHERE order_id=?",
      [id],
    );
    return order;
  }
  if (area === "order-drafts") {
    if (method === "GET" && path.length === 1) {
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(url.searchParams.get("page") || 1);
      const [counts] = await query<any[]>(
        "SELECT COUNT(*) total FROM order_drafts WHERE status='draft'",
      );
      return {
        page,
        total: Number(counts.total),
        items: await query(
          "SELECT id,version,payload,updated_at,created_by FROM order_drafts WHERE status='draft' ORDER BY updated_at DESC,id DESC LIMIT 20 OFFSET ?",
          [(page - 1) * 20],
        ),
      };
    }
    if (method === "POST" && path.length === 1) {
      const payload = manualInput.parse(body);
      checkCapabilities(payload, actor);
      if (payload.collectAmount)
        throw new HttpError(
          400,
          "Nháp không ghi nhận tiền. Hãy tạo đơn để ghi nhận khoản đã nhận.",
        );
      const r = await mutate(
        "INSERT INTO order_drafts(created_by,updated_by,payload) VALUES(?,?,?)",
        [actor.id, actor.id, JSON.stringify(payload)],
      );
      return { id: r.insertId, version: 1 };
    }
    const id = z.coerce.number().int().positive().parse(path[1]);
    if (method === "GET" && path.length === 2) {
      const [draft] = await query<any[]>(
        "SELECT * FROM order_drafts WHERE id=?",
        [id],
      );
      if (!draft) throw new HttpError(404, "Không tìm thấy nháp.");
      return { ...draft, payload: jsonValue(draft.payload) };
    }
    if (
      (method === "PATCH" && path.length === 2) ||
      (method === "POST" && path[2] === "archive")
    ) {
      const version = positiveId.parse(body.version);
      const payload = manualInput.parse(body);
      checkCapabilities(payload, actor);
      const archive = path[2] === "archive";
      if (!archive && payload.collectAmount)
        throw new HttpError(
          400,
          "Nháp không ghi nhận tiền. Hãy tạo đơn để ghi nhận khoản đã nhận.",
        );
      const r = await mutate(
        "UPDATE order_drafts SET payload=IF(?=1,payload,?),status=?,updated_by=?,version=version+1 WHERE id=? AND version=? AND status='draft'",
        [
          archive ? 1 : 0,
          JSON.stringify(payload),
          archive ? "archived" : "draft",
          actor.id,
          id,
          version,
        ],
      );
      if (!r.affectedRows)
        throw new HttpError(
          409,
          "Nháp đã thay đổi hoặc không tồn tại. Hãy mở lại.",
        );
      return { id, version: version + 1 };
    }
  }
  throw new HttpError(404, "Không tìm thấy thao tác.");
}
