import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";
import { setupEmail } from "./email-schema.mjs";
import { emailHTML, interpolateEmail } from "../lib/email-content";
async function main() {
  const host = process.env.MYSQL_HOST || "127.0.0.1";
  assert.ok(
    ["127.0.0.1", "localhost"].includes(host),
    "Email tests must use local MySQL",
  );
  const database = "fleur_mail_qa_" + randomBytes(6).toString("hex");
  const c = await mysql.createConnection({
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    multipleStatements: true,
    dateStrings: true,
  });
  let appPool: any;
  let checks = 0;
  const check = (v: unknown, label: string) => {
    assert.ok(v, label);
    checks++;
    console.log("PASS " + label);
  };
  try {
    await c.query("CREATE DATABASE " + database + " CHARACTER SET utf8mb4");
    await c.query("USE " + database);
    await c.query(
      "CREATE TABLE customers(id INT PRIMARY KEY,email VARCHAR(190),name VARCHAR(100),marketing_consent INT); CREATE TABLE users(id INT PRIMARY KEY,email VARCHAR(190),marketing_consent INT); CREATE TABLE orders(id INT PRIMARY KEY,reference VARCHAR(40),customer_name VARCHAR(100),email VARCHAR(190),total INT,status VARCHAR(30),recipient_name VARCHAR(100),address TEXT,delivery_date DATE,delivery_slot VARCHAR(60)); CREATE TABLE order_items(id INT PRIMARY KEY,order_id INT,product_name VARCHAR(100),size VARCHAR(3),quantity INT,price INT)",
    );
    await setupEmail(c);
    process.env.MYSQL_DATABASE = database;
    process.env.MYSQL_SSL = "false";
    Object.assign(process.env, {
      EMAIL_ENABLED: "true",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "465",
      SMTP_USER: "test@example.test",
      SMTP_PASSWORD: "fixture-only",
      SMTP_FROM_EMAIL: "test@example.test",
      APP_ORIGIN: "https://example.test",
    });
    const mail = await import("../lib/email");
    const db = await import("../lib/db");
    appPool = db.pool;
    const rendered = emailHTML(
      interpolateEmail("Chào {{customer_name}}", {
        customer_name: "<img src=x onerror=alert(1)>",
      }),
    );
    check(
      rendered.includes("&lt;img") && !rendered.includes("<img"),
      "Personalization escapes HTML injection",
    );
    await c.query(
      "INSERT INTO customers VALUES(1,'yes@example.test','Yes',1),(2,'no@example.test','No',0); INSERT INTO users VALUES(1,'yes@example.test',1); INSERT INTO orders VALUES(1,'FLTEST','An','order@example.test',932000,'pending','Minh','Địa chỉ thử','2026-10-20','09:00–12:00'); INSERT INTO order_items VALUES(1,1,'Tulip','M',1,897000)",
    );
    const conn = await appPool.getConnection();
    try {
      await conn.beginTransaction();
      await mail.enqueueOrderEmail(conn, 1, "order_confirmation");
      await conn.rollback();
      const [[r]] = await c.query<any[]>("SELECT COUNT(*) n FROM email_outbox");
      check(r.n === 0, "Rolled-back order does not queue an email");
      await conn.beginTransaction();
      await mail.enqueueOrderEmail(conn, 1, "order_confirmation");
      await mail.enqueueOrderEmail(conn, 1, "order_confirmation");
      await conn.commit();
    } finally {
      conn.release();
    }
    let [[r]] = await c.query<any[]>("SELECT COUNT(*) n FROM email_outbox");
    check(r.n === 1, "Idempotent order confirmation queues exactly once");
    const [[confirmation]] = await c.query<any[]>(
      "SELECT * FROM email_outbox LIMIT 1",
    );
    check(
      confirmation.body.includes("FLTEST") &&
        confirmation.body.includes("Tulip") &&
        confirmation.body.includes("Minh") &&
        confirmation.recipient === "order@example.test",
      "Order email contains reference, items, delivery and purchaser email",
    );
    await c.query(
      "UPDATE email_templates SET body='Changed {{order_reference}}' WHERE template_key='order_confirmation'",
    );
    await setupEmail(c);
    const [[t]] = await c.query<any[]>(
      "SELECT body FROM email_templates WHERE template_key='order_confirmation'",
    );
    check(
      t.body === "Changed {{order_reference}}",
      "Migration preserves customized templates",
    );
    const [[unchanged]] = await c.query<any[]>(
      "SELECT body FROM email_outbox LIMIT 1",
    );
    check(
      unchanged.body === confirmation.body,
      "Queued email preserves original content",
    );
    const stream = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    let mime = "";
    const transport = {
      sendMail: async (options: any) => {
        const result = await stream.sendMail(options);
        mime = result.message.toString();
        return { accepted: ["yes@example.test"], messageId: result.messageId };
      },
      close: () => stream.close(),
    };
    await mail.sendSMTP(
      { ...confirmation, unsubscribe_token: randomBytes(32).toString("hex") },
      transport as any,
    );
    check(
      mime.includes("List-Unsubscribe:") &&
        mime.includes("List-Unsubscribe-Post:") &&
        mime.includes("multipart/alternative") &&
        mime.includes("Message-ID: <fleur-"),
      "SMTP message contains HTML, text, stable ID and unsubscribe headers",
    );
    let sends = 0;
    const sender = async () => {
      sends++;
      await new Promise((r) => setTimeout(r, 25));
      return "mock-message-" + sends;
    };
    process.env.EMAIL_ENABLED = "false";
    await mail.processEmails(10, sender);
    check(sends === 0, "Disabled delivery retains pending messages");
    process.env.EMAIL_ENABLED = "true";
    await Promise.all([
      mail.processEmails(1, sender),
      mail.processEmails(1, sender),
    ]);
    check(sends === 1, "Concurrent workers do not send the same message twice");
    [[r]] = await c.query<any[]>(
      "SELECT status,message_id FROM email_outbox LIMIT 1",
    );
    check(r.status === "sent" && r.message_id, "SMTP acceptance is recorded");
    const insert = async (
      key: string,
      kind = "transactional",
      customer: number | null = null,
      token: string | null = null,
    ) => {
      const [r] = await c.execute<any>(
        "INSERT INTO email_outbox(dedupe_key,template_key,kind,recipient,customer_id,subject,body,unsubscribe_token) VALUES(?,'test',?,?,?,?,?,?)",
        [
          key,
          kind,
          customer === 1
            ? "yes@example.test"
            : customer === 2
              ? "no@example.test"
              : "order@example.test",
          customer,
          "Test",
          "Body",
          token,
        ],
      );
      return r.insertId;
    };
    const refused = await insert("no-consent", "marketing", 2);
    await mail.processEmails(10, sender);
    [[r]] = await c.execute<any[]>(
      "SELECT status FROM email_outbox WHERE id=?",
      [refused],
    );
    check(
      r.status === "cancelled" && sends === 1,
      "Marketing consent rechecked at send time",
    );
    const token = randomBytes(32).toString("hex");
    const unsub = await insert("unsubscribe", "marketing", 1, token);
    check(await mail.unsubscribeEmail(token), "Unsubscribe token accepted");
    check(await mail.unsubscribeEmail(token), "Unsubscribe is idempotent");
    [[r]] = await c.execute<any[]>(
      "SELECT status FROM email_outbox WHERE id=?",
      [unsub],
    );
    check(r.status === "cancelled", "Unsubscribe cancels queued marketing");
    await c.query("UPDATE customers SET marketing_consent=1 WHERE id=1");
    const suppressed = await insert("suppression", "marketing", 1);
    await mail.processEmails(10, sender);
    [[r]] = await c.execute<any[]>(
      "SELECT status FROM email_outbox WHERE id=?",
      [suppressed],
    );
    check(
      r.status === "cancelled",
      "Suppression prevents accidental re-subscription",
    );
    check(
      !(await mail.unsubscribeEmail(randomBytes(32).toString("hex"))),
      "Invalid token cannot unsubscribe arbitrary customer",
    );
    const transient = await insert("retry");
    await mail.processEmails(1, async () => {
      throw Object.assign(Error("secret must not be logged"), {
        code: "EENVELOPE",
        responseCode: 450,
      });
    });
    [[r]] = await c.execute<any[]>(
      "SELECT status,last_error,attempts FROM email_outbox WHERE id=?",
      [transient],
    );
    check(
      r.status === "pending" &&
        r.attempts === 1 &&
        !r.last_error.includes("secret"),
      "Temporary SMTP rejection retries without secret leakage",
    );
    const permanent = await insert("permanent");
    await mail.processEmails(1, async () => {
      throw Object.assign(Error("no"), { responseCode: 550 });
    });
    [[r]] = await c.execute<any[]>(
      "SELECT status FROM email_outbox WHERE id=?",
      [permanent],
    );
    check(r.status === "failed", "Permanent rejection requires manual retry");
    const uncertain = await insert("uncertain");
    await mail.processEmails(1, async () => {
      throw Object.assign(Error("lost DATA ack"), {
        code: "ETIMEDOUT",
        command: "DATA",
      });
    });
    [[r]] = await c.execute<any[]>(
      "SELECT status FROM email_outbox WHERE id=?",
      [uncertain],
    );
    check(
      r.status === "uncertain",
      "Lost SMTP acknowledgment is never blindly resent",
    );
    const crashed = await insert("crashed");
    await c.execute(
      "UPDATE email_outbox SET status='sending',lease_until=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=?",
      [crashed],
    );
    await mail.processEmails(10, sender);
    [[r]] = await c.execute<any[]>(
      "SELECT status FROM email_outbox WHERE id=?",
      [crashed],
    );
    check(r.status === "uncertain", "Interrupted worker is flagged for review");
    const lock = await appPool.getConnection();
    try {
      await c.query("UPDATE orders SET status='confirmed' WHERE id=1");
      await mail.enqueueOrderEmail(lock, 1, "order_status", "pending");
    } finally {
      lock.release();
    }
    const [[status]] = await c.query<any[]>(
      "SELECT body FROM email_outbox WHERE template_key='order_status'",
    );
    check(
      status.body.includes("Chờ xác nhận") &&
        status.body.includes("Đã xác nhận") &&
        status.body.includes("FLTEST"),
      "Status email includes previous state, new state and reference",
    );
    console.log(
      "All " + checks + " email checks passed. No external email sent.",
    );
  } finally {
    if (appPool) await appPool.end();
    if (!/^fleur_mail_qa_[a-f0-9]{12}$/.test(database))
      throw Error("Refusing cleanup");
    await c.query("DROP DATABASE IF EXISTS " + database);
    await c.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
