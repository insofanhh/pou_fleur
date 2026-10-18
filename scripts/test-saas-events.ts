import assert from "node:assert/strict";
import { query, mutate, pool } from "../lib/db";
import { withStore, withSystem } from "../lib/tenant";
import { processAutomations } from "../lib/automations";
import { processEmails } from "../lib/email";
import { processDomainEvents } from "../lib/domain-events";
import { advanceBilling } from "../lib/billing";
async function main() {
  assert(
    process.env.MYSQL_DATABASE === "fleur_saas_test" &&
      process.env.MYSQL_PORT === "3310",
  );
  Object.assign(process.env, {
    EMAIL_ENABLED: "true",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "465",
    SMTP_USER: "test@example.test",
    SMTP_PASSWORD: "fixture-only",
    SMTP_FROM_EMAIL: "test@example.test",
    APP_ORIGIN: "http://127.0.0.1:3004",
  });
  try {
    const [o] = await withSystem(() =>
      query<any[]>(
        "SELECT * FROM orders WHERE status='delivered' ORDER BY id DESC LIMIT 1",
      ),
    );
    assert(o);
    await withStore(o.store_id, async () => {
      await mutate(
        "UPDATE orders SET completed_at=DATE_SUB(NOW(),INTERVAL 3 DAY) WHERE id=?",
        [o.id],
      );
      await mutate(
        "DELETE FROM email_outbox WHERE dedupe_key LIKE 'automation:%'",
      );
      await mutate("UPDATE customers SET marketing_consent=1 WHERE email=?", [
        o.email,
      ]);
      const [t] = await query<any[]>(
        "SELECT id FROM email_templates WHERE template_key='crm_aftercare'",
      );
      await mutate(
        "INSERT INTO crm_automations(name,trigger_name,template_id,delay_days,message,active) VALUES('QA aftercare','aftercare',?,2,'Cảm ơn bạn đã chọn hoa của tiệm.',1)",
        [t.id],
      );
    });
    const first = await processAutomations(),
      second = await processAutomations();
    assert(first.queued === 1);
    assert(second.queued === 0);
    console.log("PASS CRM automation queues once and respects frequency cap");
    await withStore(o.store_id, async () => {
      await mutate("UPDATE customers SET marketing_consent=0 WHERE email=?", [
        o.email,
      ]);
      let marketingSent = 0;
      await processEmails(100, async (mail: any) => {
        if (mail.kind === "marketing") marketingSent++;
        return "fixture-" + mail.id;
      });
      assert(marketingSent === 0);
      const [mail] = await query<any[]>(
        "SELECT status FROM email_outbox WHERE dedupe_key LIKE 'automation:%' ORDER BY id DESC LIMIT 1",
      );
      assert(mail.status === "cancelled");
      console.log(
        "PASS consent withdrawal cancels queued marketing before delivery",
      );
      await mutate(
        "UPDATE crm_automations SET active=0 WHERE name='QA aftercare'",
      );
    });
    await processDomainEvents();
    const [{ n: before }] = await query<any[]>(
      "SELECT COUNT(*) n FROM notifications",
    );
    await processDomainEvents();
    const [{ n: after }] = await query<any[]>(
      "SELECT COUNT(*) n FROM notifications",
    );
    assert(before === after);
    console.log("PASS domain event retries do not duplicate inbox messages");
    const marketingKey = "qa-marketing-withdraw-" + Date.now();
    await mutate(
      "INSERT INTO domain_outbox(store_id,event_key,payload) VALUES(?,?,?)",
      [
        o.store_id,
        marketingKey,
        JSON.stringify({
          userId: o.user_id,
          marketing: true,
          title: "Không được gửi",
          body: "Consent đã rút",
        }),
      ],
    );
    await mutate(
      "UPDATE notification_preferences SET marketing=0 WHERE user_id=? AND store_id=?",
      [o.user_id, o.store_id],
    );
    await processDomainEvents();
    assert(
      (
        await query<any[]>("SELECT id FROM notifications WHERE event_key=?", [
          marketingKey,
        ])
      ).length === 0,
    );
    console.log(
      "PASS withdrawn consent blocks queued store broadcast delivery",
    );
    const [sub] = await query<any[]>(
      "SELECT * FROM subscriptions WHERE store_id=?",
      [o.store_id],
    );
    await mutate(
      "UPDATE subscriptions SET status='active',cancel_at_period_end=0 WHERE store_id=?",
      [o.store_id],
    );
    await mutate(
      "INSERT INTO invoices(store_id,period_key,plan_name,amount,due_date) VALUES(?,'qa-overdue','Fixture',1000,DATE_SUB(CURDATE(),INTERVAL 10 DAY)) ON DUPLICATE KEY UPDATE status='open',paid=0",
      [o.store_id],
    );
    await advanceBilling();
    assert(
      (
        await query<any[]>(
          "SELECT status FROM subscriptions WHERE store_id=?",
          [o.store_id],
        )
      )[0].status === "restricted",
    );
    console.log("PASS overdue billing restricts new orders after grace period");
    await mutate("DELETE FROM invoices WHERE store_id=? AND period_key=?", [
      o.store_id,
      "qa-overdue",
    ]);
    await mutate(
      "UPDATE subscriptions SET status=?,cancel_at_period_end=? WHERE store_id=?",
      [sub.status, sub.cancel_at_period_end, o.store_id],
    );
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
