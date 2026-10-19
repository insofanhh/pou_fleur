import type { PoolConnection } from "mysql2/promise";
import defaults from "./email-defaults.json";
import { interpolateEmail } from "./email-content";

// System copy is owned by platform; store templates never override it.
export async function systemTemplate(
  c: Pick<PoolConnection, "execute">,
  key: string,
) {
  const [rows]: any = await c.execute(
    "SELECT * FROM platform_email_templates WHERE template_key=?",
    [key],
  );
  const t = rows[0] || defaults.find((t) => t.key === key);
  if (!t) throw Error("UNKNOWN_SYSTEM_TEMPLATE");
  return t;
}
export function renderSystemEmail(
  t: { subject: string; body: string },
  values: Record<string, string>,
) {
  return {
    subject: interpolateEmail(t.subject, values)
      .replace(/[\r\n]/g, " ")
      .slice(0, 240),
    body: interpolateEmail(t.body, values),
  };
}
export async function enqueueAccountWelcome(c: PoolConnection, userId: number) {
  const [rows]: any = await c.execute(
    "SELECT name,email FROM users WHERE id=?",
    [userId],
  );
  const user = rows[0];
  if (!user) return;
  const t = await systemTemplate(c, "account_welcome");
  const mail = renderSystemEmail(t, {
    customer_name: user.name,
    account_url: (process.env.APP_ORIGIN || "") + "/account",
  });
  await c.execute(
    "INSERT IGNORE INTO identity_mail(user_id,template_key,dedupe_key,recipient,subject,body) VALUES(?,'account_welcome',?,?,?,?)",
    [userId, "welcome:" + userId, user.email, mail.subject, mail.body],
  );
}
