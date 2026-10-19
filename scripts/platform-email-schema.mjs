import defaults from "../lib/email-defaults.json" with { type: "json" };

export async function migratePlatformEmail(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS platform_email_templates(
    id INT AUTO_INCREMENT PRIMARY KEY,template_key VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,kind VARCHAR(20) NOT NULL,subject VARCHAR(240) NOT NULL,
    body TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT 1,version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  await c.query(`CREATE TABLE IF NOT EXISTS platform_email_campaigns(
    id INT AUTO_INCREMENT PRIMARY KEY,request_key CHAR(36) UNIQUE NOT NULL,
    name VARCHAR(160) NOT NULL,template_id INT NOT NULL,audience TEXT NOT NULL,
    recipient_count INT NOT NULL,created_by INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  for (const [column, type] of [
    ["template_key", "VARCHAR(80) NOT NULL DEFAULT 'account_password_reset'"],
    ["dedupe_key", "VARCHAR(190) NULL"],
    ["user_id", "INT NULL"],
    ["kind", "VARCHAR(20) NOT NULL DEFAULT 'transactional'"],
    ["campaign_id", "INT NULL"],
    ["unsubscribe_token", "CHAR(64) NULL"],
    ["sent_at", "DATETIME NULL"],
    ["last_error", "VARCHAR(240) NULL"],
  ]) {
    const [rows] = await c.query(
      `SHOW COLUMNS FROM identity_mail LIKE '${column}'`,
    );
    if (!rows.length)
      await c.query(`ALTER TABLE identity_mail ADD COLUMN ${column} ${type}`);
  }
  for (const column of ["dedupe_key", "unsubscribe_token"]) {
    const [rows] = await c.query(
      `SHOW INDEX FROM identity_mail WHERE Key_name='identity_${column}'`,
    );
    if (!rows.length)
      await c.query(
        `ALTER TABLE identity_mail ADD UNIQUE KEY identity_${column}(${column})`,
      );
  }
  for (const t of defaults.filter(
    (t) => !t.key.startsWith("order_") && !t.key.startsWith("crm_"),
  ))
    await c.execute(
      "INSERT IGNORE INTO platform_email_templates(template_key,name,kind,subject,body) VALUES(?,?,?,?,?)",
      [t.key, t.name, t.kind, t.subject, t.body],
    );
}
