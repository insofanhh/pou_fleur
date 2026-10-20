import { pool, query } from "./db";
import { withStore, withSystem } from "./tenant";
import { emit } from "./domain-events";
import { aiPlanAllowed } from "./ai-policy";
import { refreshBillingAccess } from "./billing";

// Claim and enqueue in one transaction. A crash cannot lose a reminder between
// marking it sent and persisting its notification; generation deduplicates snoozes.
export async function processAIReminders(deadline = Date.now() + 15000) {
  return withSystem(async () => {
    const due = await query<any[]>("SELECT id,store_id FROM workspace_reminders WHERE status='scheduled' AND due_at<=UTC_TIMESTAMP() ORDER BY due_at LIMIT 50");
    let notified = 0, cancelled = 0;
    for (const job of due) {
      if (Date.now() > deadline) break;
      await withStore(job.store_id, async () => {
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          const store = await refreshBillingAccess(job.store_id, c);
          const [rows]: any = await c.execute("SELECT * FROM workspace_reminders WHERE id=? AND status='scheduled' AND due_at<=UTC_TIMESTAMP() FOR UPDATE", [job.id]);
          const r = rows[0];
          if (!r) { await c.commit(); return; }
          const [subs]: any = await c.execute("SELECT plan_id,status FROM subscriptions WHERE store_id=?", [job.store_id]);
          const [members]: any = await c.execute("SELECT m.role FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=? AND m.user_id=? AND m.status='active' AND u.active=1", [job.store_id, r.user_id]);
          let valid = store.status === "approved" && aiPlanAllowed(subs[0]?.plan_id) && ["active", "trialing", "free"].includes(subs[0]?.status) && ["owner", "admin", "manager", "support"].includes(members[0]?.role);
          if (r.order_id) {
            const [orders]: any = await c.execute("SELECT status,delivery_date,delivery_slot FROM orders WHERE id=? FOR UPDATE", [r.order_id]);
            const o = orders[0];
            valid = valid && !!o && !["delivered", "cancelled"].includes(o.status) && o.delivery_date === r.order_day && o.delivery_slot === r.order_slot;
          }
          if (valid) {
            await emit(c, `ai-reminder:${r.id}:${r.generation}`, { userId: r.user_id, title: r.title, body: r.content, pushTitle: "Nhắc việc cửa hàng", pushBody: "Bạn có nhắc việc đến hạn. Mở workspace để xem.", href: `/workspace/${job.store_id}/${r.order_id ? "board?order=" + r.order_id : "ai"}` });
            await c.execute("UPDATE workspace_reminders SET status='notified' WHERE id=?", [r.id]);
            notified++;
          } else {
            await c.execute("UPDATE workspace_reminders SET status='cancelled' WHERE id=?", [r.id]);
            cancelled++;
          }
          await c.commit();
        } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
      });
    }
    return { notified, cancelled };
  });
}
