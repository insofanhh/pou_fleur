import { query, mutate, pool } from "./db";
import { withStore } from "./tenant";
import { randomBytes } from "node:crypto";
import { interpolateEmail } from "./email-content";
import { storeBy, jsonValue } from "./stores";
// Rules are disabled by default. Consent is checked at enqueue AND delivery.
export async function processAutomations() {
  const stores = await query<any[]>(
    "SELECT id FROM stores WHERE status='approved'",
  );
  let queued = 0;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  for (const s of stores)
    await withStore(s.id, async () => {
      const rules = await query<any[]>(
          "SELECT * FROM crm_automations WHERE active=1",
        ),
        store = await storeBy(s.id);
      for (const r of rules) {
        const [template] = await query<any[]>(
          "SELECT * FROM email_templates WHERE id=? AND kind='marketing' AND active=1",
          [r.template_id],
        );
        if (!template) continue;
        let audience: any[] = [];
        const eligible =
          "c.email IS NOT NULL AND c.email<>'' AND c.marketing_consent=1 AND NOT EXISTS(SELECT 1 FROM email_suppressions es WHERE es.email=c.email)";
        if (r.trigger_name === "aftercare")
          audience = await query<any[]>(
            "SELECT c.*,o.id order_id FROM customers c JOIN orders o ON o.customer_id=c.id WHERE " +
              eligible +
              " AND o.status='delivered' AND o.completed_at<=DATE_SUB(NOW(),INTERVAL ? DAY) AND o.completed_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) LIMIT 100",
            [r.delay_days],
          );
        if (r.trigger_name === "birthday")
          audience = await query<any[]>(
            "SELECT c.*,0 order_id FROM customers c WHERE " +
              eligible +
              " AND DATE_FORMAT(c.birthday,'%m-%d')=? LIMIT 100",
            [today.slice(5)],
          );
        if (r.trigger_name === "winback")
          audience = await query<any[]>(
            "SELECT c.*,0 order_id FROM customers c WHERE " +
              eligible +
              " AND EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.id AND o.status='delivered') AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.id AND o.status='delivered' AND o.completed_at>DATE_SUB(NOW(),INTERVAL ? DAY)) LIMIT 100",
            [r.delay_days],
          );
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          // Serializes rule runs so parallel worker invocations respect the frequency cap.
          await c.execute(
            "SELECT id FROM crm_automations WHERE id=? FOR UPDATE",
            [r.id],
          );
          for (const customer of audience) {
            const dedupe =
              "automation:" +
              r.id +
              ":" +
              customer.id +
              ":" +
              (r.trigger_name === "aftercare"
                ? customer.order_id
                : r.trigger_name === "birthday"
                  ? today.slice(0, 4)
                  : today.slice(0, 7));
            const [recent]: any = await c.execute(
              "SELECT id FROM email_outbox WHERE customer_id=? AND kind='marketing' AND status IN ('pending','sending','sent') AND created_at>DATE_SUB(NOW(),INTERVAL 7 DAY)",
              [customer.id],
            );
            if (recent.length) continue;
            const values = {
              customer_name: customer.name,
              store_name: store.name,
              campaign_message: r.message,
              campaign_name: r.name,
              promotion_code: "",
              event_date: "",
            };
            const [insert]: any = await c.execute(
              "INSERT IGNORE INTO email_outbox(dedupe_key,template_key,kind,recipient,customer_id,subject,body,unsubscribe_token) VALUES(?,?,'marketing',?,?,?,?,?)",
              [
                dedupe,
                template.template_key,
                customer.email,
                customer.id,
                interpolateEmail(template.subject, values)
                  .replace(/[\r\n]/g, " ")
                  .slice(0, 500),
                interpolateEmail(template.body, values),
                randomBytes(32).toString("hex"),
              ],
            );
            queued += insert.affectedRows;
          }
          await c.commit();
        } catch (e) {
          await c.rollback();
          throw e;
        } finally {
          c.release();
        }
      }
    });
  return { queued };
}
