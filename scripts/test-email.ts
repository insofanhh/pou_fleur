import { withStore } from "../lib/tenant";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";
import { migratePlatformEmail } from "./platform-email-schema.mjs";
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
    const storeBranding = emailHTML("Order body", undefined, "Store qua Fleurious", "Hoa <An> & Bạn");
    check(
      storeBranding.includes('class="store-workspace-label"') && storeBranding.includes("Hoa &lt;An&gt; &amp; Bạn&#39;s workspace") && !storeBranding.includes("Store qua Fleurious</div>"),
      "Store mail keeps the Fleurious logo and escapes the workspace label beneath it",
    );
    check(!emailHTML("System body", undefined, "Fleurious Platform").includes('class="store-workspace-label"'), "Platform mail has no store workspace label");
    await c.query(
      "INSERT INTO customers VALUES(1,'yes@example.test','Yes',1),(2,'no@example.test','No',0); INSERT INTO users VALUES(1,'yes@example.test',1); INSERT INTO orders VALUES(1,'FLTEST','An','order@example.test',932000,'pending','Minh','Địa chỉ thử','2026-10-20','09:00–12:00'); INSERT INTO order_items VALUES(1,1,'Tulip','M',1,897000)",
    );
    for (const table of [
      "customers",
      "orders",
      "order_items",
      "email_templates",
      "email_campaigns",
      "email_suppressions",
      "email_outbox",
    ])
      await c.query(
        "ALTER TABLE " + table + " ADD COLUMN store_id INT NOT NULL DEFAULT 1",
      );
    await c.query(
      "ALTER TABLE orders ADD COLUMN version INT DEFAULT 1,ADD COLUMN store_name VARCHAR(100) DEFAULT 'Fleur'; CREATE TABLE stores(id INT PRIMARY KEY,slug VARCHAR(100),name VARCHAR(160),owner_id INT,status VARCHAR(30)); INSERT INTO stores VALUES(1,'fleur','Fleur',1,'pending'); ALTER TABLE users ADD COLUMN name VARCHAR(160) DEFAULT 'QA Owner'; CREATE TABLE plans(id INT PRIMARY KEY,limits JSON); CREATE TABLE plan_versions(id INT PRIMARY KEY,limits JSON); CREATE TABLE subscriptions(store_id INT PRIMARY KEY,plan_id INT,plan_version_id INT); INSERT INTO plans VALUES(1,'{\"email_sends\":100}'); INSERT INTO subscriptions VALUES(1,1,NULL)",
    );
    await c.query("CREATE TABLE identity_mail(id INT AUTO_INCREMENT PRIMARY KEY,recipient VARCHAR(190),subject VARCHAR(240),body TEXT,status VARCHAR(20) DEFAULT 'pending',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP); ALTER TABLE users ADD COLUMN active INT DEFAULT 1");
    await migratePlatformEmail(c);
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
    let smtpOptions: any;
    const transport = {
      sendMail: async (options: any) => {
        smtpOptions = options;
        const result = await stream.sendMail(options);
        mime = result.message.toString();
        return { accepted: ["yes@example.test"], messageId: result.messageId };
      },
      close: () => stream.close(),
    };
    await mail.sendSMTP(
      { ...confirmation, sender_name: "Fleur qua Fleurious", store_name: "Fleur", unsubscribe_token: randomBytes(32).toString("hex") },
      transport as any,
    );
    check(
      mime.includes("List-Unsubscribe:") &&
        mime.includes("List-Unsubscribe-Post:") &&
        mime.includes("multipart/alternative") &&
        mime.includes("Message-ID: <fleur-"),
      "SMTP message contains HTML, text, stable ID and unsubscribe headers",
    );
    check(smtpOptions.html.includes("Fleur&#39;s workspace") && smtpOptions.text.startsWith("Fleurious\nFleur's workspace\n\n") && smtpOptions.from.name === "Fleur qua Fleurious", "Actual SMTP HTML and text include store branding while retaining sender identity");
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
    const lifecycle = await appPool.getConnection();
    try {
      await lifecycle.beginTransaction();
      await mail.enqueueStoreLifecycleEmail(lifecycle,1,'store_registration_pending');
      await mail.enqueueStoreLifecycleEmail(lifecycle,1,'store_registration_pending');
      await lifecycle.commit();
      const [[pending]]: any = await c.query("SELECT COUNT(*) n,MIN(body) body FROM email_outbox WHERE template_key='store_registration_pending'");
      check(pending.n===1 && pending.body.includes('Fleur') && pending.body.includes('/workspace/1'), 'Registration mail identifies owner/store and deduplicates');
      await lifecycle.beginTransaction();
      await mail.enqueueStoreLifecycleEmail(lifecycle,1,'store_approved');
      await lifecycle.rollback();
      const [[rollback]]: any = await c.query("SELECT COUNT(*) n FROM email_outbox WHERE template_key='store_approved'");
      check(rollback.n===0,'Approval rollback cannot send success email');
    } finally { lifecycle.release(); }
    await c.query("UPDATE email_outbox SET status='cancelled' WHERE status='pending'");
    await c.query("UPDATE plans SET limits='{\"email_sends\":1}' WHERE id=1");
    const blocked=await insert('quota-blocked');
    const beforeQuota=sends;
    await mail.processEmails(10,sender);
    const [[quotaMail]]: any=await c.query('SELECT status,last_error,attempts FROM email_outbox WHERE id=?',[blocked]);
    check(sends===beforeQuota && quotaMail.status==='pending' && quotaMail.last_error==='EMAIL_MONTHLY_LIMIT' && quotaMail.attempts===0,'Quota keeps business mail pending without contacting SMTP');
    const platformConn=await appPool.getConnection();
    try { await mail.enqueueStoreLifecycleEmail(platformConn,1,'store_approved'); } finally {platformConn.release();}
    await mail.processEmails(10,async m=>{check(m.sender_name==='Fleurious Platform' && !m.store_name,'Platform approval mail does not inherit store branding');return sender();});
    check(sends===beforeQuota+1,'Platform approval email is exempt from store quota');
    await c.query("UPDATE plans SET limits='{\"email_sends\":100}' WHERE id=1");
    await c.query("UPDATE email_outbox SET next_attempt_at=NOW() WHERE id=?",[blocked]);
    let senderName='';
    await mail.processEmails(1,async (m)=>{senderName=m.sender_name || '';return 'quota-upgraded';});
    check(senderName==='Fleur qua Fleurious','Upgraded allowance resumes pending email with seller identity');
    const identity=await import('../lib/identity-mail');
    const system=await import('../lib/system-email');
    const {emailAllowance}=await import('../lib/email-policy');
    const accountConn=await appPool.getConnection();
    try {
      await accountConn.beginTransaction();
      await system.enqueueAccountWelcome(accountConn,1);
      await accountConn.rollback();
      const [[none]]:any=await c.query("SELECT COUNT(*) n FROM identity_mail");
      check(none.n===0,'Welcome mail rolls back with account creation');
      await accountConn.beginTransaction();
      await system.enqueueAccountWelcome(accountConn,1);
      await system.enqueueAccountWelcome(accountConn,1);
      await accountConn.commit();
    }finally{accountConn.release();}
    const [[welcome]]:any=await c.query("SELECT * FROM identity_mail WHERE template_key='account_welcome'");
    check(welcome.body.includes('/account'),'Account welcome includes the correct destination');
    const countBefore=(await emailAllowance(appPool,1)).used;
    let identitySends=0;
    await Promise.all([identity.processIdentityMail(async m=>{check(m.sender_name==='Fleurious Platform','Account mail uses system sender identity');identitySends++;return 'identity-sent';}),identity.processIdentityMail(async()=>{identitySends++;return 'identity-sent';})]);
    check(identitySends===1,'Concurrent identity workers send welcome once');
    check((await emailAllowance(appPool,1)).used===countBefore,'Account mail does not consume store allowance');
    await c.execute("UPDATE platform_email_templates SET body='Platform-approved {{store_name}} · {{workspace_url}}' WHERE template_key='store_approved'");
    await c.execute("DELETE FROM email_outbox WHERE template_key='store_approved'");
    const centralConn=await appPool.getConnection();
    try{await mail.enqueueStoreLifecycleEmail(centralConn,1,'store_approved');}finally{centralConn.release();}
    const [[central]]:any=await c.query("SELECT body FROM email_outbox WHERE template_key='store_approved'");
    check(central.body.startsWith('Platform-approved Fleur'),'Store lifecycle mail renders the central platform template');
    const platformToken=randomBytes(32).toString('hex');
    await c.execute("UPDATE users SET marketing_consent=1 WHERE id=1");
    await c.execute("INSERT INTO identity_mail(user_id,template_key,kind,recipient,subject,body,unsubscribe_token) VALUES(1,'platform_news','marketing','yes@example.test','News','Body',?)",[platformToken]);
    await c.execute("UPDATE users SET marketing_consent=0 WHERE id=1");
    await identity.processIdentityMail(async()=>{throw Error('Consent must block SMTP');});
    const [[cancelled]]:any=await c.execute("SELECT status FROM identity_mail WHERE unsubscribe_token=?",[platformToken]);
    check(cancelled.status==='cancelled','Platform marketing consent is rechecked before SMTP');
    await c.execute("UPDATE users SET marketing_consent=1 WHERE id=1");
    await c.execute("UPDATE customers SET marketing_consent=1 WHERE id=1");
    await c.execute("DELETE FROM email_suppressions");
    check(await mail.unsubscribeEmail(platformToken),'Platform unsubscribe token is accepted');
    const [[consents]]:any=await c.query("SELECT u.marketing_consent platform_consent,c.marketing_consent store_consent FROM users u JOIN customers c ON c.id=u.id WHERE u.id=1");
    check(consents.platform_consent===0&&consents.store_consent===1,'Platform unsubscribe preserves independent store consent');
    const lostId=(await c.execute<any>("INSERT INTO identity_mail(template_key,recipient,subject,body) VALUES('account_welcome','yes@example.test','Hi','Body')"))[0].insertId;
    await identity.processIdentityMail(async()=>{throw Object.assign(Error('lost ack'),{code:'ETIMEDOUT'});});
    const [[lost]]:any=await c.query("SELECT status FROM identity_mail WHERE id=?",[lostId]);
    check(lost.status==='uncertain','Identity worker does not blindly retry lost SMTP acknowledgement');
    await c.query("ALTER TABLE email_templates DROP INDEX template_key,ADD UNIQUE KEY store_template(store_id,template_key)");
    await c.query("INSERT INTO stores VALUES(2,'store-two','Second Store',1,'approved'); INSERT INTO subscriptions VALUES(2,1,NULL)");
    await c.query("INSERT INTO email_templates(store_id,template_key,name,kind,subject,body,active) SELECT 2,template_key,name,kind,subject,body,active FROM email_templates WHERE store_id=1");
    await c.query("UPDATE email_templates SET subject='Custom Second Store {{order_reference}}',body='Second Store order {{order_reference}} for {{customer_name}}' WHERE store_id=2 AND template_key='order_confirmation'");
    await c.query("INSERT INTO orders(id,reference,customer_name,email,total,status,recipient_name,address,delivery_date,delivery_slot,store_id,store_name,version) VALUES(2,'FLSECOND','Buyer Two','buyer2@example.test',100000,'pending','Recipient','Address','2026-10-20','09:00',2,'Second Store',1)");
    await withStore(2,async()=>{
      const c2=await appPool.getConnection();
      try{await mail.enqueueOrderEmail(c2,2,'order_confirmation');}finally{c2.release();}
      let second:any;
      await mail.processEmails(1,async m=>{second=m;return 'second-store-sent';});
      check(second.recipient==='buyer2@example.test'&&second.subject==='Custom Second Store FLSECOND'&&second.body.includes('Second Store order FLSECOND')&&second.sender_name==='Second Store qua Fleurious','Second store sends its own customized content and identity through shared SMTP');
      check(second.store_name==='Second Store' && emailHTML(second.body,undefined,second.sender_name,second.store_name).includes('Second Store&#39;s workspace'),'Worker applies the correct store label independently for each tenant');
      check((await emailAllowance(appPool,2)).used===1,'Second-store mail increments only the second-store counter');
    });
    check((await emailAllowance(appPool,1)).used===countBefore,'Other-store sends do not change first-store usage');
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
withStore(1, main).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
