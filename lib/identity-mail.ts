import { parseDateTime } from "./date-time";
import { query, mutate, pool } from "./db";
import { digest, throttle } from "./auth";
import { randomBytes } from "node:crypto";
import { emailConfiguration, sendSMTP, safeMailError } from "./email";
import { systemTemplate, renderSystemEmail } from "./system-email";
// Identity mail is outside store outboxes: store staff must never read reset URLs.
export async function requestPasswordReset(email: string) {
  await throttle("recovery:" + email, 5);
  const [user] = await query<any[]>(
    "SELECT id,name FROM users WHERE email=? AND active=1",
    [email],
  );
  if (!user) return;
  const token = randomBytes(32).toString("hex"),
    c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.execute("DELETE FROM password_resets WHERE user_id=?", [user.id]);
    await c.execute(
      "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE))",
      [digest(token), user.id],
    );
    const href = process.env.APP_ORIGIN + "/reset-password?token=" + token;
    // Invalidate old queued links together with the old token.
    await c.execute(
      "UPDATE identity_mail SET status='cancelled',body='' WHERE recipient=? AND template_key='account_password_reset' AND status IN ('pending','failed')",
      [email],
    );
    const t = await systemTemplate(c, "account_password_reset");
    const mail = renderSystemEmail(t, {
      customer_name: user.name,
      reset_url: href,
    });
    await c.execute(
      "INSERT INTO identity_mail(user_id,template_key,recipient,subject,body) VALUES(?,'account_password_reset',?,?,?)",
      [user.id, email, mail.subject, mail.body],
    );
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export async function processIdentityMail(sender = sendSMTP, limit = 10) {
  const config = emailConfiguration();
  if (!config.enabled || !config.ready) return { processed: 0, paused: true };
  // A crash after SMTP DATA is uncertain. Do not resend these automatically.
  await mutate(
    "UPDATE identity_mail SET status='uncertain' WHERE status='sending' AND updated_at<DATE_SUB(NOW(),INTERVAL 5 MINUTE)",
  );
  const jobs = await query<any[]>(
    "SELECT * FROM identity_mail WHERE status='pending' ORDER BY kind DESC,id LIMIT " +
      Math.max(1, Math.min(20, Math.trunc(limit))),
  );
  let processed = 0;
  const deadline = Date.now() + 30000;
  for (const job of jobs) {
    if (Date.now() + 21000 > deadline) break;
    const r = await mutate(
      "UPDATE identity_mail SET status='sending' WHERE id=? AND status='pending'",
      [job.id],
    );
    if (!r.affectedRows) continue;
    if (job.kind === "marketing") {
      const [u] = await query<any[]>(
        "SELECT id FROM users WHERE id=? AND email=? AND active=1 AND marketing_consent=1",
        [job.user_id, job.recipient],
      );
      if (!u) {
        await mutate(
          "UPDATE identity_mail SET status='cancelled',last_error='CONSENT_WITHDRAWN' WHERE id=?",
          [job.id],
        );
        continue;
      }
    }
    if (
      job.template_key === "account_password_reset" &&
      parseDateTime(job.created_at).getTime() + 30 * 60000 <
        Date.now()
    ) {
      await mutate(
        "UPDATE identity_mail SET status='cancelled',body='',last_error='RESET_LINK_EXPIRED' WHERE id=?",
        [job.id],
      );
      continue;
    }
    try {
      await sender({ ...job, id: -job.id, sender_name: "Fleurious Platform" });
      await mutate(
        "UPDATE identity_mail SET status='sent',sent_at=UTC_TIMESTAMP(),body=IF(template_key='account_password_reset','',body),last_error=NULL WHERE id=?",
        [job.id],
      );
      processed++;
    } catch (e) {
      const rejected = Number((e as any).responseCode) >= 400;
      await mutate(
        "UPDATE identity_mail SET status=?,last_error=? WHERE id=?",
        [rejected ? "failed" : "uncertain", safeMailError(e), job.id],
      );
    }
  }
  return { processed };
}
