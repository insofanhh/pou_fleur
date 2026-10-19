import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, query, mutate } from "../lib/db";
import { withSystem, withStore } from "../lib/tenant";
import { platformEmails } from "../lib/platform-email";
import { processIdentityMail } from "../lib/identity-mail";
import { processEmails, unsubscribeEmail } from "../lib/email";
import { emailAllowance } from "../lib/email-policy";
import {
  captureRegistrationPlan,
  activateApprovedStore,
  prepareSubscriptionInvoice,
  recordInvoicePayment,
  advanceBilling,
} from "../lib/billing";

assert(
  /^fleur_onboarding_qa_[a-f0-9]{12}$/.test(process.env.MYSQL_DATABASE || ""),
  "Disposable QA database only",
);
Object.assign(process.env, {
  EMAIL_ENABLED: "true",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "465",
  SMTP_USER: "qa@example.test",
  SMTP_PASSWORD: "fixture-only",
  SMTP_FROM_EMAIL: "qa@example.test",
});
let checks = 0;
const check = (v: unknown, label: string) => {
  assert(v, label);
  console.log("PASS", label);
  checks++;
};
const one = async (sql: string, args: any[] = []) =>
  (await query<any[]>(sql, args))[0];
async function tx(work: (c: any) => Promise<any>) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const r = await work(c);
    await c.commit();
    return r;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function main() {
  return withSystem(async () => {
    const actor = (
      await one("SELECT id FROM users WHERE email='platform@example.test'")
    ).id;
    const data: any = await platformEmails([], "GET", {}, actor);
    const input = {
      requestKey: randomUUID(),
      name: "Platform campaign QA",
      templateId: data.templates.find((t: any) => t.kind === "marketing").id,
      segment: "owners",
      message: "Thông báo chương trình QA",
    };
    const preview: any = await platformEmails(
      ["preview-campaign"],
      "POST",
      input,
      actor,
    );
    const approved = {
      ...input,
      recipientIds: preview.recipients.map((p: any) => p.id),
      templateVersion: preview.templateVersion,
      audienceVersion: preview.audienceVersion,
    };
    await assert.rejects(
      () =>
        platformEmails(
          ["campaigns"],
          "POST",
          { ...approved, audienceVersion: "stale" },
          actor,
        ),
      (e: any) => e.status === 409,
    );
    check(true, "Platform campaign rejects a stale audience review");
    const queued: any = await platformEmails(
      ["campaigns"],
      "POST",
      approved,
      actor,
    );
    const retry: any = await platformEmails(
      ["campaigns"],
      "POST",
      approved,
      actor,
    );
    check(
      queued.id === retry.id &&
        (
          await one(
            "SELECT COUNT(*) n FROM identity_mail WHERE campaign_id=?",
            [queued.id],
          )
        ).n === preview.count,
      "Platform program queue is idempotent",
    );
    const m = await one("SELECT * FROM identity_mail WHERE campaign_id=?", [
      queued.id,
    ]);
    await mutate(
      "UPDATE identity_mail SET status='cancelled' WHERE status='pending' AND id<>?",
      [m.id],
    );
    let sends = 0;
    await processIdentityMail(async (job) => {
      assert(job.unsubscribe_token && job.sender_name === "Fleurious Platform");
      sends++;
      return "platform-accepted";
    });
    check(
      sends === 1 &&
        (await one("SELECT status FROM identity_mail WHERE id=?", [m.id]))
          .status === "sent",
      "Platform programs send through shared system transport with unsubscribe",
    );
    await unsubscribeEmail(m.unsubscribe_token);
    check(
      (await one("SELECT marketing_consent FROM users WHERE id=?", [m.user_id]))
        .marketing_consent === 0,
      "Platform program unsubscribe updates the account",
    );

    const pid = 9001;
    await mutate(
      'INSERT INTO plans(id,name,monthly_price,limits,trial_days,active) VALUES(9001,\'Email QA Paid\',299000,\'{"products":50,"staff":5,"storage_mb":500,"email_sends":2}\',7,1)',
    );
    const vid = (
      await mutate(
        "INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) SELECT id,name,monthly_price,limits,trial_days,UTC_TIMESTAMP() FROM plans WHERE id=?",
        [pid],
      )
    ).insertId;
    const uid = (
      await mutate(
        "INSERT INTO users(name,email,password_hash) VALUES('Billing QA','billing-mail@example.test','unused')",
      )
    ).insertId;
    const sid = (
      await mutate(
        "INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES('email-worker-qa','Email Worker QA',?,'approved','{}','{}')",
        [uid],
      )
    ).insertId;
    await mutate("INSERT INTO subscriptions(store_id,plan_id) VALUES(?,?)", [
      sid,
      pid,
    ]);
    await tx(async (c) => {
      await captureRegistrationPlan(c, sid, pid);
      await activateApprovedStore(c, sid);
    });
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_trial_started'",
          [sid],
        )
      ).n === 1,
      "Approved trial sends exactly one activation mail",
    );
    await mutate(
      "UPDATE subscriptions SET trial_started_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY),access_started_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY),trial_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 DAY),access_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 DAY) WHERE store_id=?",
      [sid],
    );
    await advanceBilling(sid);
    await advanceBilling(sid);
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_renewal_5d'",
          [sid],
        )
      ).n === 1,
      "Five-day reminder is sent once across repeated workers",
    );
    // Keep the same invoice and move its due instant to the next reminder mark.
    await mutate(
      "UPDATE invoices SET due_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE store_id=? AND status='open'",
      [sid],
    );
    await advanceBilling(sid);
    await advanceBilling(sid);
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_renewal_1d'",
          [sid],
        )
      ).n === 1,
      "One-day reminder is sent once",
    );
    const i = await one(
      "SELECT * FROM invoices WHERE store_id=? AND status='open'",
      [sid],
    );
    await tx((c) =>
      recordInvoicePayment(c, i.id, 100000, "email-qa-partial", actor),
    );
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_payment_received'",
          [sid],
        )
      ).n === 0,
      "Partial payment never sends full-payment success",
    );
    await tx((c) =>
      recordInvoicePayment(
        c,
        i.id,
        Number(i.amount) - 100000,
        "email-qa-settled",
        actor,
      ),
    );
    await tx((c) =>
      recordInvoicePayment(
        c,
        i.id,
        Number(i.amount) - 100000,
        "email-qa-settled",
        actor,
      ),
    );
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_registered'",
          [sid],
        )
      ).n === 1,
      "First paid subscription sends registration success exactly once",
    );
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_payment_received'",
          [sid],
        )
      ).n === 1,
      "Payment retries cannot duplicate the receipt",
    );
    const paid = await one("SELECT * FROM invoices WHERE id=?", [i.id]);
    await mutate(
      "UPDATE subscriptions SET status='active',active_trial_bucket=NULL,trial_started_at=NULL,trial_ends_at=NULL,access_started_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY),access_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 20 DAY),plan_version_id=? WHERE store_id=?",
      [vid, sid],
    );
    await mutate(
      "UPDATE invoices SET activated_at=UTC_TIMESTAMP(),effective_start_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY),effective_end_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 20 DAY) WHERE id=?",
      [paid.id],
    );
    const renewal = await tx((c) => prepareSubscriptionInvoice(c, sid, pid));
    await tx((c) =>
      recordInvoicePayment(
        c,
        renewal.id,
        Number(renewal.amount),
        "email-qa-renewal",
        actor,
      ),
    );
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_renewed'",
          [sid],
        )
      ).n === 1,
      "Renewing the same plan queues the renewal-success template",
    );
    const newPlan = 9002;
    await mutate(
      "INSERT INTO plans(id,name,monthly_price,limits,trial_days,active) VALUES(9002,'Email QA Upgrade',599000,'{\"email_sends\":10}',0,1)",
    );
    await mutate(
      "INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) SELECT id,name,monthly_price,limits,trial_days,UTC_TIMESTAMP() FROM plans WHERE id=?",
      [newPlan],
    );
    const change = await tx((c) => prepareSubscriptionInvoice(c, sid, newPlan));
    await tx((c) =>
      recordInvoicePayment(
        c,
        change.id,
        Number(change.amount),
        "email-qa-change",
        actor,
      ),
    );
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_change_confirmed'",
          [sid],
        )
      ).n === 1 &&
        (
          await one(
            "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_changed'",
            [sid],
          )
        ).n === 0,
      "Future plan change confirms payment without claiming early activation",
    );
    await mutate(
      "UPDATE invoices SET effective_start_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE),effective_end_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 40 DAY) WHERE id=?",
      [change.id],
    );
    await advanceBilling(sid);
    await advanceBilling(sid);
    check(
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_changed'",
          [sid],
        )
      ).n === 1,
      "Plan-change activation queues exactly one effective-change notification",
    );
    await withStore(sid, async () => {
      await mutate(
        "UPDATE email_outbox SET status='cancelled' WHERE status='pending'",
      );
      for (let n = 0; n < 3; n++)
        await mutate(
          "INSERT INTO email_outbox(dedupe_key,template_key,kind,recipient,subject,body) VALUES(?,'order_confirmation','transactional','buyer@example.test','Order QA','Body')",
          ["quota-qa-" + n],
        );
      // Restore the original allowance snapshot for this explicit boundary test.
      await mutate(
        "UPDATE subscriptions SET plan_id=?,plan_version_id=? WHERE store_id=?",
        [pid, vid, sid],
      );
      const initial = await emailAllowance(pool, sid);
      check(
        initial.used === 0 && initial.limit === 2,
        "System messages leave the plan email counter at zero",
      );
      await processEmails(10, async () => "quota-mock");
      const used = await emailAllowance(pool, sid);
      check(
        used.used === 2 &&
          (
            await one(
              "SELECT COUNT(*) n FROM email_outbox WHERE status='pending' AND last_error='EMAIL_MONTHLY_LIMIT'",
            )
          ).n === 1,
        "Order mail consumes store quota and pauses exactly at plan allowance",
      );
      await mutate(
        "INSERT INTO email_outbox(dedupe_key,template_key,kind,recipient,subject,body) VALUES('system-at-limit','subscription_renewed','transactional','billing-mail@example.test','Renewed','Body')",
      );
      let delivered = 0;
      await processEmails(5, async () => {
        delivered++;
        return "system-exempt";
      });
      check(
        delivered === 1 && (await emailAllowance(pool, sid)).used === 2,
        "Subscription success remains deliverable at exhausted store quota",
      );
    });
    console.log(
      `All ${checks} platform program/billing mail checks passed. Mock SMTP only.`,
    );
  });
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
