import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { pool, mutate } from "./db";
import { emailHTML, interpolateEmail, orderStatusNames } from "./email-content";

export function emailConfiguration() {
  const missing = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM_EMAIL",
    "APP_ORIGIN",
  ].filter((k) => !process.env[k]?.trim());
  let validOrigin = false;
  try {
    const url = new URL(process.env.APP_ORIGIN || "");
    validOrigin =
      (url.protocol === "https:" ||
        (process.env.VERCEL !== "1" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname))) &&
      url.origin === process.env.APP_ORIGIN;
  } catch {}
  const validPort = [465, 587].includes(Number(process.env.SMTP_PORT));
  return {
    enabled: process.env.EMAIL_ENABLED === "true",
    ready: missing.length === 0 && validOrigin && validPort,
    missing,
    validOrigin,
    validPort,
    from: process.env.SMTP_FROM_EMAIL || "",
    provider: "SMTP",
  };
}
export function smtpTransport() {
  const config = emailConfiguration();
  if (!config.ready) throw Error("SMTP_NOT_CONFIGURED");
  const port = Number(process.env.SMTP_PORT);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export async function verifySMTP() {
  const transport = smtpTransport();
  try {
    await transport.verify();
    return { ok: true };
  } finally {
    transport.close();
  }
}
export async function enqueueOrderEmail(
  c: PoolConnection,
  id: number,
  key: "order_confirmation" | "order_status",
  previousStatus = "",
) {
  const [templates] = await c.execute(
    "SELECT * FROM email_templates WHERE template_key=? AND active=1",
    [key],
  );
  const t = (templates as any[])[0];
  if (!t) return;
  const [orders] = await c.execute("SELECT * FROM orders WHERE id=?", [id]);
  const o = (orders as any[])[0];
  const [items] = await c.execute(
    "SELECT product_name,size,quantity,price FROM order_items WHERE order_id=? ORDER BY id",
    [id],
  );
  const money = (n: number) =>
    new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(n);
  const values = {
    customer_name: o.customer_name,
    order_reference: o.reference,
    order_items: (items as any[])
      .map(
        (i) =>
          i.product_name +
          " · " +
          i.size +
          " × " +
          i.quantity +
          " · " +
          money(i.price * i.quantity),
      )
      .join("\n"),
    order_total: money(o.total),
    order_status: orderStatusNames[o.status] || o.status,
    previous_status: orderStatusNames[previousStatus] || previousStatus,
    recipient_name: o.recipient_name,
    delivery_address: o.address,
    delivery_date: String(o.delivery_date).slice(0, 10),
    delivery_slot: o.delivery_slot,
    tracking_url:
      (process.env.APP_ORIGIN || "").replace(/\/$/, "") + "/track-order",
  };
  await c.execute(
    "INSERT INTO email_outbox(dedupe_key,template_key,kind,recipient,order_id,subject,body) VALUES(?,?,'transactional',?,?,?,?) ON DUPLICATE KEY UPDATE dedupe_key=dedupe_key",
    [
      key + ":" + id + (key === "order_status" ? ":" + o.status : ""),
      key,
      o.email,
      id,
      interpolateEmail(t.subject, values)
        .replace(/[\r\n]/g, " ")
        .slice(0, 500),
      interpolateEmail(t.body, values),
    ],
  );
}
export type OutgoingEmail = {
  recipient: string;
  subject: string;
  body: string;
  unsubscribe_token: string | null;
  id: number;
};
export async function sendSMTP(
  mail: OutgoingEmail,
  transport = smtpTransport(),
) {
  const deadline = setTimeout(() => transport.close(), 20000);
  const unsubscribeUrl = mail.unsubscribe_token
    ? process.env.APP_ORIGIN +
      "/api/email/unsubscribe?token=" +
      mail.unsubscribe_token
    : undefined;
  try {
    const result = await transport.sendMail({
      from: {
        name: process.env.SMTP_FROM_NAME || "Fleur",
        address: process.env.SMTP_FROM_EMAIL!,
      },
      to: { address: mail.recipient, name: "" },
      subject: mail.subject,
      text:
        mail.body +
        (unsubscribeUrl
          ? "\n\nHủy nhận email chương trình: " + unsubscribeUrl
          : ""),
      html: emailHTML(mail.body, unsubscribeUrl),
      messageId:
        "<fleur-" +
        mail.id +
        "@" +
        process.env.SMTP_FROM_EMAIL!.split("@")[1] +
        ">",
      ...(unsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": "<" + unsubscribeUrl + ">",
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (!result.accepted.length)
      throw Object.assign(Error("SMTP_REJECTED"), { responseCode: 550 });
    return result.messageId;
  } finally {
    clearTimeout(deadline);
    transport.close();
  }
}
export function safeMailError(error: unknown) {
  const e = error as { code?: string; responseCode?: number };
  return [
    e.code?.replace(/[^A-Z0-9_]/g, "").slice(0, 40) || "SMTP_ERROR",
    Number.isInteger(e.responseCode) ? e.responseCode : "",
  ]
    .filter(Boolean)
    .join(" ");
}
// SMTP cannot promise exactly-once delivery after an interrupted DATA response.
// Do not automatically resend uncertain submissions.
export async function processEmails(limit = 20, sender = sendSMTP) {
  const config = emailConfiguration();
  if (!config.enabled || !config.ready) return { processed: 0, paused: true };
  await mutate(
    "UPDATE email_outbox SET status='uncertain',last_error='WORKER_INTERRUPTED',claim_token=NULL WHERE status='sending' AND lease_until<NOW()",
  );
  const started = Date.now();
  let processed = 0;
  while (processed < limit && Date.now() - started < 35000) {
    const claim = randomUUID();
    const c = await pool.getConnection();
    let mail: any;
    try {
      await c.beginTransaction();
      const [rows] = await c.query(
        "SELECT * FROM email_outbox WHERE status='pending' AND next_attempt_at<=NOW() ORDER BY id LIMIT 1 FOR UPDATE",
      );
      mail = (rows as any[])[0];
      if (!mail) {
        await c.commit();
        break;
      }
      if (mail.kind === "marketing") {
        const [eligible] = await c.execute(
          "SELECT id FROM customers WHERE id=? AND email=? AND marketing_consent=1 AND NOT EXISTS(SELECT 1 FROM email_suppressions WHERE email=?)",
          [mail.customer_id, mail.recipient, mail.recipient],
        );
        if (!(eligible as any[]).length) {
          await c.execute(
            "UPDATE email_outbox SET status='cancelled',last_error='CONSENT_WITHDRAWN' WHERE id=?",
            [mail.id],
          );
          await c.commit();
          processed++;
          continue;
        }
      }
      await c.execute(
        "UPDATE email_outbox SET status='sending',attempts=attempts+1,claim_token=?,lease_until=DATE_ADD(NOW(),INTERVAL 5 MINUTE) WHERE id=?",
        [claim, mail.id],
      );
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    let messageId: string;
    try {
      messageId = await sender(mail);
    } catch (error) {
      const e = error as {
        code?: string;
        responseCode?: number;
        command?: string;
      };
      const rejected =
        Number.isInteger(e.responseCode) && e.responseCode! >= 400;
      const beforeData =
        ["EDNS", "EAUTH", "ETLS"].includes(e.code || "") ||
        (e.code === "ECONNECTION" && e.command === "CONN") ||
        (e.code === "ETIMEDOUT" &&
          ["CONN", "EHLO", "STARTTLS", "AUTH"].includes(e.command || ""));
      const retry =
        ((rejected && e.responseCode! < 500) ||
          (beforeData && e.code !== "EAUTH")) &&
        mail.attempts + 1 < 5;
      const status = retry
        ? "pending"
        : rejected || beforeData
          ? "failed"
          : "uncertain";
      await mutate(
        "UPDATE email_outbox SET status=?,last_error=?,next_attempt_at=DATE_ADD(NOW(),INTERVAL 5 MINUTE),lease_until=NULL,claim_token=NULL WHERE id=? AND claim_token=?",
        [status, safeMailError(error), mail.id, claim],
      );
      processed++;
      continue;
    }
    // Keep a DB acknowledgment failure outside the SMTP retry handler.
    await mutate(
      "UPDATE email_outbox SET status='sent',message_id=?,sent_at=NOW(),last_error=NULL,lease_until=NULL,claim_token=NULL WHERE id=? AND claim_token=?",
      [messageId, mail.id, claim],
    );
    processed++;
  }
  return { processed, paused: false };
}
export async function safelyProcessEmails() {
  try {
    await processEmails();
  } catch {
    console.error(
      "Email worker failed; inspect email outbox. No credentials logged.",
    );
  }
}
export async function unsubscribeEmail(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.execute(
      "SELECT recipient FROM email_outbox WHERE unsubscribe_token=? AND kind='marketing'",
      [token],
    );
    const mail = (rows as any[])[0];
    if (!mail) {
      await c.rollback();
      return false;
    }
    await c.execute("INSERT IGNORE INTO email_suppressions(email) VALUES(?)", [
      mail.recipient,
    ]);
    await c.execute("UPDATE customers SET marketing_consent=0 WHERE email=?", [
      mail.recipient,
    ]);
    await c.execute("UPDATE users SET marketing_consent=0 WHERE email=?", [
      mail.recipient,
    ]);
    await c.execute(
      "UPDATE email_outbox SET status='cancelled',last_error='CONSENT_WITHDRAWN' WHERE recipient=? AND kind='marketing' AND status IN ('pending','failed')",
      [mail.recipient],
    );
    await c.commit();
    return true;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
