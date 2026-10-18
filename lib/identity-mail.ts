import { query, mutate, pool } from "./db";
import { digest, throttle } from "./auth";
import { randomBytes } from "node:crypto";
import { emailConfiguration, sendSMTP } from "./email";
// Identity mail is outside store outboxes: store staff must never read reset URLs.
export async function requestPasswordReset(email: string) {
  await throttle("recovery:" + email, 5);
  const [user] = await query<any[]>(
    "SELECT id FROM users WHERE email=? AND active=1",
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
    await c.execute(
      "INSERT INTO identity_mail(recipient,subject,body) VALUES(?,?,?)",
      [
        email,
        "Đặt lại mật khẩu tài khoản Fleurious",
        "Bạn đã yêu cầu đặt lại mật khẩu. Liên kết có hiệu lực 30 phút:\n\n" +
          href +
          "\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.",
      ],
    );
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export async function processIdentityMail(sender = sendSMTP) {
  const config = emailConfiguration();
  if (!config.enabled || !config.ready) return { processed: 0, paused: true };
  // A crash after SMTP DATA is uncertain. Do not resend these automatically.
  await mutate(
    "UPDATE identity_mail SET status='uncertain' WHERE status='sending' AND updated_at<DATE_SUB(NOW(),INTERVAL 5 MINUTE)",
  );
  const jobs = await query<any[]>(
    "SELECT * FROM identity_mail WHERE status='pending' ORDER BY id LIMIT 1",
  );
  let processed = 0;
  for (const job of jobs) {
    const r = await mutate(
      "UPDATE identity_mail SET status='sending' WHERE id=? AND status='pending'",
      [job.id],
    );
    if (!r.affectedRows) continue;
    try {
      await sender({ ...job, id: -job.id, unsubscribe_token: null });
      await mutate(
        "UPDATE identity_mail SET status='sent',body='' WHERE id=?",
        [job.id],
      );
      processed++;
    } catch {
      await mutate("UPDATE identity_mail SET status='uncertain' WHERE id=?", [
        job.id,
      ]);
    }
  }
  return { processed };
}
