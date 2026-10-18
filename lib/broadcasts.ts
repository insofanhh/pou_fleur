import { z } from "zod";
import { pool } from "./db";
import { tenantId } from "./tenant";
import { requirePermission, HttpError } from "./auth";
import { emit } from "./domain-events";
export async function broadcast(input: unknown) {
  const actor = await requirePermission("crm");
  if (!["owner", "admin", "manager"].includes(actor.role))
    throw new HttpError(403, "Bạn không có quyền gửi chương trình.");
  const b = z
    .object({
      key: z.uuid(),
      title: z.string().trim().min(3).max(100),
      message: z.string().trim().min(5).max(500),
    })
    .parse(input);
  const sid = tenantId(),
    key = `store:${sid}:broadcast:${b.key}`,
    c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [stores]: any = await c.execute(
      "SELECT slug,status FROM stores WHERE id=? FOR UPDATE",
      [sid],
    );
    if (stores[0]?.status !== "approved")
      throw new HttpError(
        409,
        "Chỉ cửa hàng đã công bố mới được gửi chương trình.",
      );
    const [old]: any = await c.execute(
      "SELECT payload FROM domain_outbox WHERE event_key=?",
      [key],
    );
    if (old[0]) {
      await c.commit();
      const p =
        typeof old[0].payload === "string"
          ? JSON.parse(old[0].payload)
          : old[0].payload;
      return { queued: p.queued };
    }
    const [audience]: any = await c.execute(
      "SELECT DISTINCT o.user_id FROM orders o JOIN customers c ON c.id=o.customer_id JOIN notification_preferences p ON p.user_id=o.user_id AND p.store_id=? WHERE o.status='delivered' AND c.marketing_consent=1 AND p.marketing=1 AND o.user_id IS NOT NULL LIMIT 1001",
      [sid],
    );
    if (audience.length > 1000)
      throw new HttpError(
        409,
        "Chương trình vượt giới hạn 1.000 khách mỗi lần.",
      );
    const [recent]: any = await c.execute(
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.userId')) user_id FROM domain_outbox WHERE store_id=? AND created_at>DATE_SUB(NOW(),INTERVAL 7 DAY) AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.marketing'))='true'",
      [sid],
    );
    const sent = new Set(recent.map((p: any) => Number(p.user_id))),
      targets = audience.filter((p: any) => !sent.has(p.user_id));
    for (const p of targets)
      await emit(c, key + ":" + p.user_id, {
        userId: p.user_id,
        marketing: true,
        title: b.title,
        body: b.message,
        href: "/s/" + stores[0].slug,
      });
    await c.execute(
      "INSERT INTO domain_outbox(store_id,event_key,payload,status) VALUES(?,?,?,'done')",
      [
        sid,
        key,
        JSON.stringify({
          title: b.title,
          queued: targets.length,
          actor: actor.id,
        }),
      ],
    );
    await c.execute(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)",
      [actor.id, "broadcast: " + targets.length, "notifications", b.key],
    );
    await c.commit();
    return { queued: targets.length };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
