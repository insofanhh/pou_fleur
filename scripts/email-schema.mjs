import defaults from "../lib/email-defaults.json" with { type: "json" };
export async function setupEmail(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS email_templates (
    id INT AUTO_INCREMENT PRIMARY KEY, template_key VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL, kind ENUM('transactional','marketing') NOT NULL,
    subject VARCHAR(240) NOT NULL, body TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await c.query(`CREATE TABLE IF NOT EXISTS email_campaigns (
    id INT AUTO_INCREMENT PRIMARY KEY, request_key CHAR(36) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL, template_id INT NOT NULL, audience TEXT NOT NULL,
    recipient_count INT NOT NULL DEFAULT 0, created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await c.query(`CREATE TABLE IF NOT EXISTS email_suppressions (
    email VARCHAR(190) PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await c.query(`CREATE TABLE IF NOT EXISTS email_outbox (
    id INT AUTO_INCREMENT PRIMARY KEY, dedupe_key VARCHAR(190) NOT NULL UNIQUE,
    template_key VARCHAR(80) NOT NULL, kind ENUM('transactional','marketing') NOT NULL,
    recipient VARCHAR(190) NOT NULL, customer_id INT NULL, order_id INT NULL,
    campaign_id INT NULL, subject VARCHAR(500) NOT NULL, body MEDIUMTEXT NOT NULL,
    unsubscribe_token CHAR(64) NULL UNIQUE,
    status ENUM('pending','sending','sent','failed','uncertain','cancelled') NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0, next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_until DATETIME NULL, claim_token CHAR(36) NULL, last_error VARCHAR(240) NULL,
    message_id VARCHAR(255) NULL, sent_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX email_pending(status,next_attempt_at), INDEX email_campaign(campaign_id), INDEX email_order(order_id)
  )`);
  for (const t of defaults)
    await c.execute(
      "INSERT IGNORE INTO email_templates(template_key,name,kind,subject,body) VALUES(?,?,?,?,?)",
      [t.key, t.name, t.kind, t.subject, t.body],
    );
}
