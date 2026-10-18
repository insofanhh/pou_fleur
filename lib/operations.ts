import { z } from "zod";
import { pool } from "./db";
import { tenantId } from "./tenant";
import { HttpError } from "./auth";
import { jsonValue } from "./stores";
import { emit } from "./domain-events";
import { enqueueOrderEmail } from "./email";
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
export async function reschedule(id: number, actor: number, body: any) {
  const b = z
    .object({
      version: z.number().int().positive(),
      date: dateSchema,
      slot: z.string().max(30),
      reason: z.string().trim().min(5).max(500),
    })
    .parse(body);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [ss]: any = await c.execute(
      "SELECT settings FROM stores WHERE id=? FOR UPDATE",
      [tenantId()],
    );
    const settings = jsonValue(ss[0].settings);
    const [rows]: any = await c.execute(
      "SELECT * FROM orders WHERE id=? FOR UPDATE",
      [id],
    );
    const o = rows[0];
    if (!o) throw new HttpError(404, "Không tìm thấy đơn.");
    if (o.version !== b.version)
      throw new HttpError(409, "Đơn vừa thay đổi. Tải lại trước khi đổi lịch.");
    if (!["pending", "confirmed", "preparing", "ready"].includes(o.status))
      throw new HttpError(409, "Chỉ đổi lịch đơn chưa giao đi.");
    const start = new Date(
      b.date + "T" + b.slot.slice(0, 5) + ":00+07:00",
    ).getTime();
    if (
      !settings.slots.includes(b.slot) ||
      settings.closed_dates.includes(b.date) ||
      start < Date.now() + settings.lead_minutes * 60000 ||
      start > Date.now() + settings.advance_days * 86400000
    )
      throw new HttpError(409, "Lịch mới không khả dụng.");
    const [count]: any = await c.execute(
      "SELECT COUNT(*) n FROM orders WHERE id<>? AND delivery_date=? AND delivery_slot=? AND status<>'cancelled' FOR UPDATE",
      [id, b.date, b.slot],
    );
    if (count[0].n >= settings.capacity)
      throw new HttpError(409, "Lịch mới đã đủ đơn.");
    await c.execute(
      "UPDATE orders SET delivery_date=?,delivery_slot=?,version=version+1 WHERE id=?",
      [b.date, b.slot, id],
    );
    await c.execute(
      "INSERT INTO order_status_events(order_id,actor_id,status,detail) VALUES(?,?,?,?)",
      [
        id,
        actor,
        "rescheduled",
        `${o.delivery_date} ${o.delivery_slot} → ${b.date} ${b.slot}: ${b.reason}`,
      ],
    );
    await c.execute(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
      [actor, "reschedule: " + b.reason, "orders", String(id)],
    );
    await emit(c, "order:" + id + ":reschedule:" + (o.version + 1), {
      userId: o.user_id,
      title: "Đổi lịch đơn " + o.reference,
      body: `Lịch mới: ${b.date} · ${b.slot}`,
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
