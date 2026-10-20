import { z } from "zod";
import { pool, query } from "./db";
import { HttpError, ghostContext } from "./auth";
import { requireAI } from "./ai-access";
import { aiConfig } from "./ai-config";
import { aiPlanAllowed } from "./ai-policy";
import { jsonValue } from "./stores";
import { tenantId } from "./tenant";
import { finalizeAIOrder, manualInput } from "./manual-orders";
import { parseDateTime } from "./date-time";
import { emit } from "./domain-events";

export async function confirmAIAction(actionId: string, cancel = false) {
  z.uuid().parse(actionId);
  const { actor } = await requireAI();
  if (!(await aiConfig()).enabled) throw new HttpError(403, "Trợ lý AI đã được tắt.");
  const [settings] = await query<any[]>("SELECT enabled FROM store_ai_settings WHERE store_id=?", [tenantId()]);
  if (settings && !settings.enabled) throw new HttpError(403, "Chủ cửa hàng đã tắt trợ lý AI.");
  // Resolve Ghost before reserving a connection; concurrent confirmations must
  // not hold every pool connection while waiting for another auth query.
  const ghost = await ghostContext();
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows]: any = await c.execute("SELECT a.* FROM ai_action_drafts a JOIN ai_conversations conv ON conv.id=a.conversation_id AND conv.user_id=a.user_id WHERE a.id=? AND a.user_id=? AND conv.role_scope=? FOR UPDATE", [actionId, actor.id, actor.role]);
    const a = rows[0];
    if (!a) throw new HttpError(404, "Không tìm thấy đề xuất trong hội thoại của bạn.");
    if (a.status === "done") { await c.commit(); return { ok: true, result: jsonValue(a.result), duplicate: true }; }
    if (a.status !== "pending") throw new HttpError(409, "Đề xuất đã đóng. Hãy yêu cầu xem trước lại.");
    const [runs]: any = await c.execute("SELECT status FROM ai_runs WHERE id=?", [a.run_id]);
    if (runs[0]?.status !== "succeeded") throw new HttpError(409, "Lượt AI chưa hoàn tất. Vui lòng tải lại hội thoại.");
    const payload = jsonValue(a.payload);
    // Recover a committed order after a lost acknowledgment, using its immutable key.
    let recovered: any = null;
    if (a.kind === "order") {
      const [orders]: any = await c.execute("SELECT id,reference,total FROM orders WHERE idempotency_key=? AND created_by=?", [payload.idempotencyKey, actor.id]);
      recovered = orders[0];
    }
    if (!recovered && !cancel && parseDateTime(a.expires_at, "utc").getTime() <= Date.now()) throw new HttpError(409, "Đề xuất đã quá 15 phút. Hãy yêu cầu AI kiểm tra và xem trước lại.");
    if (cancel && !recovered) {
      await c.execute("UPDATE ai_action_drafts SET status='cancelled' WHERE id=?", [a.id]);
      await c.commit(); return { ok: true, cancelled: true };
    }
    let result: any;
    if (a.kind === "order") {
      result = recovered || await finalizeAIOrder(payload, actor, c, ghost);
      result = { ...result, href: `/workspace/${tenantId()}/board?order=${result.id}` };
    } else {
      // Serialize non-order writes with plan/status/membership changes.
      const [stores]: any = await c.execute("SELECT status FROM stores WHERE id=? FOR UPDATE", [tenantId()]);
      const [subs]: any = await c.execute("SELECT plan_id,status FROM subscriptions WHERE store_id=? FOR UPDATE", [tenantId()]);
      const [members]: any = await c.execute("SELECT role FROM store_memberships WHERE store_id=? AND user_id=? AND status='active' FOR UPDATE", [tenantId(), actor.id]);
      if (stores[0]?.status !== "approved" || !aiPlanAllowed(Number(subs[0]?.plan_id)) || !["active", "free", "trialing"].includes(subs[0]?.status) || members[0]?.role !== actor.role) throw new HttpError(403, "Quyền hoặc gói của bạn đã thay đổi.");
      if (a.kind === "note") {
        const [r]: any = await c.execute("INSERT INTO calendar_notes(title,content,color,day,author_id) VALUES(?,?,?,?,?)", [payload.title, payload.content, payload.color, payload.day, actor.id]);
        result = { id: r.insertId, href: `/workspace/${tenantId()}/calendar`, message: "Đã lưu ghi chú trên lịch." };
      } else if (a.kind === "order_draft") {
        const b = manualInput.parse(payload);
        const [r]: any = await c.execute("INSERT INTO order_drafts(created_by,updated_by,payload) VALUES(?,?,?)", [actor.id, actor.id, JSON.stringify(b)]);
        result = { id: r.insertId, href: `/workspace/${tenantId()}/orders/new?draft=${r.insertId}`, message: "Đã lưu nháp. Mở form để hoàn thiện." };
      } else if (a.kind === "reminder") {
        const due = parseDateTime(payload.dueAt);
        if (due.getTime() < Date.now() + 1000) throw new HttpError(409, "Giờ nhắc đã qua. Hãy chọn giờ mới.");
        const [targets]: any = await c.execute("SELECT m.user_id FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=? AND m.user_id=? AND m.status='active' AND m.role IN ('owner','admin','manager','support') AND u.active=1", [tenantId(), payload.assignedTo]);
        if (!targets.length) throw new HttpError(409, "Người nhận nhắc không còn quyền tại store.");
        if (payload.orderId) {
          const [orders]: any = await c.execute("SELECT status,delivery_date,delivery_slot FROM orders WHERE id=? FOR UPDATE", [payload.orderId]);
          const o = orders[0];
          if (!o || ["cancelled", "delivered"].includes(o.status) || o.delivery_date !== payload.orderDay || o.delivery_slot !== payload.orderSlot) throw new HttpError(409, "Đơn đã kết thúc hoặc đổi lịch. Hãy chuẩn bị nhắc việc lại.");
        }
        await c.execute("INSERT INTO workspace_reminders(id,user_id,created_by,title,content,due_at,order_id,order_day,order_slot) VALUES(?,?,?,?,?,?,?,?,?)", [a.id, payload.assignedTo, actor.id, payload.title, payload.content, due.toISOString().slice(0, 19).replace("T", " "), payload.orderId, payload.orderDay, payload.orderSlot]);
        result = { id: a.id, message: "Đã lưu lịch nhắc.", href: `/workspace/${tenantId()}/calendar` };
      } else if (a.kind === "issue") {
        await c.execute("INSERT INTO ai_issue_reports(id,user_id,title,content,page) VALUES(?,?,?,?,?)", [a.id, actor.id, payload.title, payload.content, payload.page]);
        result = { id: a.id, message: "Đã gửi báo lỗi tới admin platform." };
      } else throw new HttpError(400, "Đề xuất không được hỗ trợ.");
    }
    await c.execute("INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)", [actor.id, "ai:" + a.kind, "ai_action", a.id]);
    if (ghost) await c.execute("INSERT INTO platform_audit_logs(actor_id,target_id,action,metadata) VALUES(?,?,'ghost:ai-confirm',?)", [ghost.actorId, actor.id, JSON.stringify({ actionId: a.id, kind: a.kind })]);
    await c.execute("UPDATE ai_action_drafts SET status='done',result=? WHERE id=?", [JSON.stringify(result), a.id]);
    await c.commit();
    return { ok: true, result };
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}

export async function reminderAction(id: string, body: unknown) {
  const { actor } = await requireAI();
  const v = z.object({ action: z.enum(["done", "cancel", "snooze"]), generation: z.number().int().positive(), dueAt: z.string().datetime({ offset: true }).optional() }).strict().parse(body);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows]: any = await c.execute("SELECT * FROM workspace_reminders WHERE id=? FOR UPDATE", [z.uuid().parse(id)]);
    const r = rows[0];
    if (!r || (r.user_id !== actor.id && !["owner", "admin", "manager"].includes(actor.role))) throw new HttpError(404, "Không tìm thấy nhắc việc.");
    if (r.generation !== v.generation || !["scheduled", "notified"].includes(r.status)) throw new HttpError(409, "Nhắc việc đã thay đổi. Vui lòng tải lại.");
    const due = v.dueAt ? parseDateTime(v.dueAt) : new Date(Date.now() + 15 * 60000);
    if (v.action === "snooze" && (due.getTime() <= Date.now() || due.getTime() > Date.now() + 366 * 86400000)) throw new HttpError(400, "Giờ nhắc không hợp lệ.");
    await c.execute("UPDATE workspace_reminders SET status=?,due_at=?,generation=generation+1 WHERE id=?", [v.action === "snooze" ? "scheduled" : v.action === "done" ? "done" : "cancelled", due.toISOString().slice(0, 19).replace("T", " "), r.id]);
    await c.execute("INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,'reminder',?)", [actor.id, "ai:reminder:" + v.action, r.id]);
    await c.commit(); return { ok: true };
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
