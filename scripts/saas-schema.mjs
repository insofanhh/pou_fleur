import { migratePlatformEmail } from "./platform-email-schema.mjs";
import { migrateProductTaxonomy } from "./product-taxonomy-schema.mjs";
import defaults from "../lib/email-defaults.json" with { type: "json" };
import { migrateManualOrders } from "./manual-orders-schema.mjs";

export const tenantTables = [
  "categories",
  "products",
  "promotions",
  "orders",
  "order_items",
  "customers",
  "crm_notes",
  "crm_tasks",
  "events",
  "posts",
  "inquiries",
  "audit_logs",
  "email_templates",
  "email_campaigns",
  "email_suppressions",
  "email_outbox",
];
export async function migrateSaaS(c) {
  await c.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations(version VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  );
  await c.query(`CREATE TABLE IF NOT EXISTS stores(
    id INT AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(100) UNIQUE NOT NULL, name VARCHAR(160) NOT NULL,
    owner_id INT NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'draft', description TEXT,
    address VARCHAR(500) NOT NULL DEFAULT '',lat DOUBLE NULL,lng DOUBLE NULL,radius_km DOUBLE NOT NULL DEFAULT 10,
    logo TEXT,cover TEXT,phone VARCHAR(30) DEFAULT '',settings JSON NOT NULL,theme JSON NOT NULL,draft_theme JSON NULL,
    version INT NOT NULL DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  await c.query(
    `CREATE TABLE IF NOT EXISTS store_memberships(store_id INT NOT NULL,user_id INT NOT NULL,role VARCHAR(30) NOT NULL,status VARCHAR(20) DEFAULT 'active',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(store_id,user_id),INDEX member_lookup(user_id,status))`,
  );
  await c.query(
    `CREATE TABLE IF NOT EXISTS platform_memberships(user_id INT PRIMARY KEY,role VARCHAR(40) NOT NULL DEFAULT 'platform_admin')`,
  );
  await c.query(`CREATE TABLE IF NOT EXISTS platform_user_states(
    user_id INT PRIMARY KEY,version INT NOT NULL DEFAULT 1,deleted_at DATETIME NULL)`);
  await c.query(`CREATE TABLE IF NOT EXISTS platform_audit_logs(
    id BIGINT AUTO_INCREMENT PRIMARY KEY,actor_id INT NOT NULL,target_id INT NULL,
    action VARCHAR(100) NOT NULL,metadata JSON NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX target_audit(target_id,id))`);
  await c.query(`CREATE TABLE IF NOT EXISTS ghost_sessions(
    token_hash CHAR(64) PRIMARY KEY,admin_session_hash CHAR(64) NOT NULL,actor_id INT NOT NULL,
    target_id INT NOT NULL,reason VARCHAR(500) NOT NULL,expires_at DATETIME NOT NULL,
    ended_at DATETIME NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX ghost_admin_session(admin_session_hash),INDEX ghost_target(target_id))`);
  await c.query(
    `CREATE TABLE IF NOT EXISTS auth_identities(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,provider VARCHAR(40) NOT NULL,subject VARCHAR(190) NOT NULL,UNIQUE KEY identity_subject(provider,subject))`,
  );
  await c.query(
    `CREATE TABLE IF NOT EXISTS invitations(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,email VARCHAR(190) NOT NULL,role VARCHAR(30) NOT NULL,token_hash CHAR(64) UNIQUE NOT NULL,status VARCHAR(20) DEFAULT 'pending',expires_at DATETIME NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  );
  const settings = JSON.stringify({
    shipping: 35000,
    free_shipping: 1000000,
    open: true,
    lead_minutes: 120,
    advance_days: 90,
    capacity: 20,
    slots: ["09:00–12:00", "12:00–15:00", "15:00–18:00", "18:00–20:00"],
    closed_dates: [],
    timezone: "Asia/Ho_Chi_Minh",
  });
  const theme = JSON.stringify({
    template: "minimal",
    accent: "#171717",
    background: "#ffffff",
    font: "system",
    hero: "Hoa cho những điều không thể nói.",
    story: "Một chút hoa. Một ngày thật khác.",
  });
  const [[owner]] = await c.query(
    "SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1",
  );
  if (!owner) throw Error("Initialize the legacy store before migration");
  await c.execute(
    "INSERT IGNORE INTO stores(id,slug,name,owner_id,status,description,settings,theme) VALUES(1,'fleur','Fleur',?,'approved','Floral studio',?,?)",
    [owner.id, settings, theme],
  );
  for (const table of tenantTables) {
    const [columns] = await c.query(
      `SHOW COLUMNS FROM ${table} LIKE 'store_id'`,
    );
    if (!columns.length)
      await c.query(
        `ALTER TABLE ${table} ADD COLUMN store_id INT NOT NULL DEFAULT 1, ADD INDEX tenant_lookup(store_id)`,
      );
  }
  for (const [table, column] of [
    ["orders", "idempotency_key"],
    ["categories", "slug"],
    ["products", "slug"],
    ["promotions", "code"],
    ["customers", "email"],
    ["posts", "slug"],
    ["email_templates", "template_key"],
    ["email_campaigns", "request_key"],
    ["email_outbox", "dedupe_key"],
  ]) {
    const [indexes] = await c.query(`SHOW INDEX FROM ${table}`);
    for (const name of new Set(
      indexes
        .filter(
          (x) =>
            x.Non_unique === 0 &&
            x.Key_name !== "PRIMARY" &&
            x.Column_name === column,
        )
        .map((x) => x.Key_name),
    )) {
      const cols = indexes.filter((x) => x.Key_name === name);
      if (cols.length === 1)
        await c.query(`ALTER TABLE ${table} DROP INDEX \`${name}\``);
    }
    if (!indexes.some((x) => x.Key_name === "tenant_unique"))
      await c.query(
        `ALTER TABLE ${table} ADD UNIQUE KEY tenant_unique(store_id,${column})`,
      );
  }
  const [supp] = await c.query(
    "SHOW INDEX FROM email_suppressions WHERE Key_name='PRIMARY'",
  );
  if (supp.length === 1)
    await c.query(
      "ALTER TABLE email_suppressions DROP PRIMARY KEY, ADD PRIMARY KEY(store_id,email)",
    );
  const orderColumns = {
    checkout_owner: "CHAR(64) NULL",
    delivery_lat: "DOUBLE NULL",
    delivery_lng: "DOUBLE NULL",
    confirmed_at: "DATETIME NULL",
    shipped_at: "DATETIME NULL",
    version: "INT NOT NULL DEFAULT 1",
    store_name: "VARCHAR(160) NOT NULL DEFAULT 'Fleur'",
    delivery_mode: "VARCHAR(20) NOT NULL DEFAULT 'gift'",
    completed_at: "DATETIME NULL",
    assigned_to: "INT NULL",
    tags: "JSON NULL",
  };
  for (const [name, type] of Object.entries(orderColumns)) {
    const [cols] = await c.query(`SHOW COLUMNS FROM orders LIKE '${name}'`);
    if (!cols.length)
      await c.query(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
  }
  await c.query(
    "ALTER TABLE orders MODIFY payment_status ENUM('unpaid','partially_paid','paid','partially_refunded','refunded') DEFAULT 'unpaid'",
  );
  await c.query(
    "ALTER TABLE orders MODIFY status ENUM('pending','confirmed','preparing','ready','shipping','delivered','cancelled') NOT NULL DEFAULT 'pending'",
  );
  await c.query(
    "INSERT IGNORE INTO store_memberships(store_id,user_id,role) SELECT 1,id,IF(id=" +
      Number(owner.id) +
      ",'owner',role) FROM users WHERE role<>'customer'",
  );
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS store_bank_accounts(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,bank_code VARCHAR(40) NOT NULL,bank_name VARCHAR(120) NOT NULL,account_number VARCHAR(40) NOT NULL,account_holder VARCHAR(160) NOT NULL,enabled BOOLEAN NOT NULL DEFAULT 1,sepay_enabled BOOLEAN NOT NULL DEFAULT 0,auto_confirm_status VARCHAR(30) NOT NULL DEFAULT 'confirmed',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY store_bank(store_id))`,
    `CREATE TABLE IF NOT EXISTS payment_intents(id BIGINT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,order_id INT NULL,invoice_id INT NULL,kind VARCHAR(20) NOT NULL,reference_code VARCHAR(80) NOT NULL,amount INT NOT NULL,paid_amount INT NOT NULL DEFAULT 0,status VARCHAR(20) NOT NULL DEFAULT 'pending',expires_at DATETIME NOT NULL,paid_at DATETIME NULL,qr_payload TEXT NOT NULL,provider_reference VARCHAR(120) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY intent_code(reference_code),INDEX intent_order(store_id,order_id,status),INDEX intent_invoice(store_id,invoice_id,status))`,
    `CREATE TABLE IF NOT EXISTS sepay_webhook_events(id BIGINT AUTO_INCREMENT PRIMARY KEY,provider_event_id VARCHAR(120) NOT NULL,payload_hash CHAR(64) NOT NULL,processed BOOLEAN NOT NULL DEFAULT 0,error_message VARCHAR(500) NULL,received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,processed_at DATETIME NULL,UNIQUE KEY sepay_event(provider_event_id),UNIQUE KEY sepay_hash(payload_hash))`,
    `CREATE TABLE IF NOT EXISTS platform_integrations(id INT AUTO_INCREMENT PRIMARY KEY,provider VARCHAR(40) NOT NULL,webhook_secret VARCHAR(255) NOT NULL,api_key VARCHAR(255) NOT NULL,enabled BOOLEAN NOT NULL DEFAULT 1,created_by INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY provider_name(provider))`,
    `CREATE TABLE IF NOT EXISTS platform_settings(setting_key VARCHAR(80) PRIMARY KEY,setting_value VARCHAR(255) NOT NULL,updated_by INT NULL,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS plan_versions(id BIGINT AUTO_INCREMENT PRIMARY KEY,plan_id INT NOT NULL,name VARCHAR(80) NOT NULL,monthly_price INT NOT NULL,limits JSON NOT NULL,trial_days INT NOT NULL DEFAULT 14,effective_at DATETIME NOT NULL,actor_id INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX plan_history(plan_id,effective_at))`,
    `CREATE TABLE IF NOT EXISTS trial_claims(store_id INT PRIMARY KEY,trial_days INT NOT NULL DEFAULT 14,started_at DATETIME NOT NULL,ends_at DATETIME NOT NULL,claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS crm_automations(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,name VARCHAR(160) NOT NULL,trigger_name VARCHAR(30) NOT NULL,template_id INT NOT NULL,delay_days INT NOT NULL DEFAULT 2,message TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT 0,INDEX rules(store_id,active))`,
    `CREATE TABLE IF NOT EXISTS identity_mail(id INT AUTO_INCREMENT PRIMARY KEY,recipient VARCHAR(190) NOT NULL,subject VARCHAR(240) NOT NULL,body TEXT NOT NULL,status VARCHAR(20) DEFAULT 'pending',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS oauth_requests(token_hash CHAR(64) PRIMARY KEY,state VARCHAR(100) NOT NULL,verifier VARCHAR(150) NOT NULL,nonce VARCHAR(100) NOT NULL,next_path VARCHAR(500) NOT NULL,link_user_id INT NULL,expires_at DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS calendar_notes(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,title VARCHAR(200) NOT NULL,content TEXT,color VARCHAR(20) NOT NULL DEFAULT '#555555',day DATE NOT NULL,author_id INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX note_day(store_id,day))`,
    `CREATE TABLE IF NOT EXISTS order_status_events(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,order_id INT NOT NULL,actor_id INT NULL,status VARCHAR(30) NOT NULL,detail TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX order_timeline(store_id,order_id))`,
    `CREATE TABLE IF NOT EXISTS order_payments(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,order_id INT NOT NULL,amount INT NOT NULL,kind VARCHAR(20) NOT NULL,reference VARCHAR(100) NOT NULL,actor_id INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY payment_ref(store_id,reference))`,
    `CREATE TABLE IF NOT EXISTS assets(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,url VARCHAR(2000) NOT NULL,size INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS notifications(id BIGINT AUTO_INCREMENT PRIMARY KEY,store_id INT NULL,user_id INT NOT NULL,event_key VARCHAR(190) NOT NULL,title VARCHAR(200) NOT NULL,body TEXT,href VARCHAR(500) NOT NULL,read_at DATETIME NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY notification_event(user_id,event_key),INDEX inbox(user_id,read_at,id))`,
    `CREATE TABLE IF NOT EXISTS notification_preferences(user_id INT NOT NULL,store_id INT NOT NULL,marketing BOOLEAN NOT NULL DEFAULT 0,push BOOLEAN NOT NULL DEFAULT 0,PRIMARY KEY(user_id,store_id))`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,endpoint_hash CHAR(64) UNIQUE NOT NULL,subscription JSON NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS domain_outbox(id BIGINT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,event_key VARCHAR(190) UNIQUE NOT NULL,payload JSON NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',attempts INT DEFAULT 0,available_at DATETIME DEFAULT CURRENT_TIMESTAMP,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,last_error VARCHAR(100),INDEX jobs(status,available_at))`,
    `CREATE TABLE IF NOT EXISTS plans(id INT PRIMARY KEY,name VARCHAR(80) NOT NULL,monthly_price INT NOT NULL,limits JSON NOT NULL,active BOOLEAN DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS subscriptions(store_id INT PRIMARY KEY,plan_id INT NOT NULL,status VARCHAR(30) NOT NULL DEFAULT 'free',period_end DATE NULL,cancel_at_period_end BOOLEAN DEFAULT 0,version INT DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS invoices(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,period_key VARCHAR(30) NOT NULL,plan_name VARCHAR(80) NOT NULL,amount INT NOT NULL,paid INT NOT NULL DEFAULT 0,status VARCHAR(20) DEFAULT 'open',due_date DATE NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY invoice_period(store_id,period_key))`,
    `CREATE TABLE IF NOT EXISTS billing_payments(id INT AUTO_INCREMENT PRIMARY KEY,invoice_id INT NOT NULL,reference VARCHAR(100) UNIQUE NOT NULL,amount INT NOT NULL,actor_id INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS merchant_tasks(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,title VARCHAR(200) NOT NULL,note TEXT,due_date DATE NULL,status VARCHAR(20) DEFAULT 'open',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS theme_versions(id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,theme JSON NOT NULL,actor_id INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS analytics_events(id BIGINT AUTO_INCREMENT PRIMARY KEY,store_id INT NULL,event_key CHAR(36) UNIQUE NOT NULL,name VARCHAR(50) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX metrics(store_id,name,created_at))`,
  ])
    await c.query(sql);
  await c.query(
    "INSERT IGNORE INTO platform_settings(setting_key,setting_value) VALUES('store_approval_required','0')",
  );
  await c.query("ALTER TABLE platform_settings MODIFY setting_value TEXT NOT NULL");
  for (const [table, column, type] of [
    ["email_outbox", "quota_at", "DATETIME NULL"],
    ["stores", "billing_suspended", "BOOLEAN NOT NULL DEFAULT 0"],
    ["stores", "suspension_reason", "VARCHAR(1000) NULL"],
    ["plans", "trial_days", "INT NOT NULL DEFAULT 14"],
    ["subscriptions", "trial_started_at", "DATETIME NULL"],
    ["subscriptions", "trial_ends_at", "DATETIME NULL"],
    ["subscriptions", "billing_anchor_day", "TINYINT NULL"],
    ["subscriptions", "current_period_start", "DATE NULL"],
    ["subscriptions", "current_period_end", "DATE NULL"],
    ["subscriptions", "plan_version_id", "BIGINT NULL"],
    ["subscriptions", "registration_plan_version_id", "BIGINT NULL"],
    ["subscriptions", "trial_days_granted", "INT NULL"],
    ["subscriptions", "active_trial_bucket", "VARCHAR(20) NULL"],
    ["subscriptions", "billing_policy", "TINYINT NOT NULL DEFAULT 0"],
    ["subscriptions", "access_started_at", "DATETIME NULL"],
    ["subscriptions", "access_ends_at", "DATETIME NULL"],
    ["invoices", "period_start", "DATE NULL"],
    ["invoices", "period_end", "DATE NULL"],
    ["invoices", "plan_version_id", "BIGINT NULL"],
    ["invoices", "applied_at", "DATETIME NULL"],
    ["invoices", "starts_at", "DATETIME NULL"],
    ["invoices", "ends_at", "DATETIME NULL"],
    ["invoices", "due_at", "DATETIME NULL"],
    ["invoices", "effective_start_at", "DATETIME NULL"],
    ["invoices", "effective_end_at", "DATETIME NULL"],
    ["invoices", "activated_at", "DATETIME NULL"],
    ["invoices", "purpose", "VARCHAR(20) NOT NULL DEFAULT 'renewal'"],
    ["invoices", "payment_deadline_at", "DATETIME NULL"],
    ["invoices", "void_reason", "VARCHAR(40) NULL"],
    ["invoices", "fallback_invoice_id", "BIGINT NULL"],
    ["billing_payments", "received_at", "DATETIME NULL"],
    ["audit_logs", "detail", "JSON NULL"],
  ]) {
    const [cols] = await c.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
    if (!cols.length) await c.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  await c.query("ALTER TABLE invoices MODIFY period_key VARCHAR(120) NOT NULL");
  await c.query(`CREATE TABLE IF NOT EXISTS account_trial_claims(
    user_id INT NOT NULL,bucket VARCHAR(20) NOT NULL,store_id INT NOT NULL,
    plan_id INT NOT NULL,plan_version_id BIGINT NOT NULL,trial_days INT NOT NULL,
    starts_at DATETIME NULL,ends_at DATETIME NULL,activated_at DATETIME NULL,
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,bucket),INDEX store_trials(store_id,starts_at,ends_at))`);
  const [accountTrialMigration] = await c.query("SELECT version FROM schema_migrations WHERE version='account-trials-v1'");
  if (!accountTrialMigration.length) {
    // Preserve every existing entitlement. Record the earliest historical claim
    // per owner/group; creating or renaming another store cannot reset it.
    await c.query(`INSERT IGNORE INTO account_trial_claims(user_id,bucket,store_id,plan_id,plan_version_id,trial_days,starts_at,ends_at,activated_at)
      SELECT st.owner_id,IF(v.plan_id=1,'starter','discovery'),cl.store_id,v.plan_id,v.id,cl.trial_days,cl.started_at,cl.ends_at,cl.started_at
      FROM trial_claims cl JOIN stores st ON st.id=cl.store_id JOIN subscriptions sub ON sub.store_id=cl.store_id
      JOIN plan_versions v ON v.id=COALESCE(sub.registration_plan_version_id,sub.plan_version_id)
      ORDER BY cl.started_at,cl.store_id`);
    await c.query(`INSERT IGNORE INTO account_trial_claims(user_id,bucket,store_id,plan_id,plan_version_id,trial_days,starts_at,ends_at,activated_at)
      SELECT st.owner_id,IF(v.plan_id=1,'starter','discovery'),sub.store_id,v.plan_id,v.id,COALESCE(sub.trial_days_granted,0),sub.trial_started_at,sub.trial_ends_at,sub.trial_started_at
      FROM subscriptions sub JOIN stores st ON st.id=sub.store_id JOIN plan_versions v ON v.id=COALESCE(sub.registration_plan_version_id,sub.plan_version_id)
      WHERE sub.trial_started_at IS NOT NULL AND sub.trial_ends_at IS NOT NULL ORDER BY sub.trial_started_at,sub.store_id`);
    await c.query(`INSERT IGNORE INTO account_trial_claims(user_id,bucket,store_id,plan_id,plan_version_id,trial_days)
      SELECT st.owner_id,IF(v.plan_id=1,'starter','discovery'),sub.store_id,v.plan_id,v.id,sub.trial_days_granted
      FROM subscriptions sub JOIN stores st ON st.id=sub.store_id JOIN plan_versions v ON v.id=sub.registration_plan_version_id
      WHERE sub.status='pending_activation' AND sub.trial_days_granted>0 AND st.status='pending' ORDER BY st.id`);
    await c.query("INSERT INTO schema_migrations(version) VALUES('account-trials-v1')");
  }
  const [timeoutMigration] = await c.query("SELECT version FROM schema_migrations WHERE version='plan-change-timeout-v1'");
  if (!timeoutMigration.length) {
    // Classify only unfulfilled future package changes, never historical debt.
    await c.query("UPDATE invoices i JOIN subscriptions s ON s.store_id=i.store_id JOIN plan_versions v ON v.id=i.plan_version_id SET i.purpose='plan_change',i.payment_deadline_at=TIMESTAMPADD(SECOND,UNIX_TIMESTAMP(i.created_at)+600,'1970-01-01 00:00:00') WHERE i.status='open' AND v.plan_id<>s.plan_id AND i.starts_at>=COALESCE(s.access_ends_at,s.trial_ends_at,DATE_ADD(s.current_period_end,INTERVAL 1 DAY))");
    await c.query("INSERT INTO schema_migrations(version) VALUES('plan-change-timeout-v1')");
  }
  const [timeoutTimezoneMigration] = await c.query("SELECT version FROM schema_migrations WHERE version='plan-change-timeout-utc-v2'");
  if (!timeoutTimezoneMigration.length) {
    // Repair untouched requests predating v1, even if the migration session's
    // timezone changed since v1. New requests keep their confirmation deadline.
    await c.query("UPDATE invoices SET payment_deadline_at=TIMESTAMPADD(SECOND,UNIX_TIMESTAMP(created_at)+600,'1970-01-01 00:00:00') WHERE purpose='plan_change' AND status='open' AND paid=0 AND created_at<=(SELECT applied_at FROM schema_migrations WHERE version='plan-change-timeout-v1')");
    await c.query("INSERT INTO schema_migrations(version) VALUES('plan-change-timeout-utc-v2')");
  }
  const [outboxColumns] = await c.query(
    "SHOW COLUMNS FROM domain_outbox LIKE 'created_at'",
  );
  if (!outboxColumns.length)
    await c.query(
      "ALTER TABLE domain_outbox ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    );
  for (const [id, name, price, limits] of [
    [1, "Khởi đầu", 0, { products: 30, staff: 3, storage_mb: 100, email_sends: 100 }],
    [2, "Studio", 299000, { products: 300, staff: 10, storage_mb: 1000, email_sends: 1000 }],
    [3, "Atelier", 599000, { products: 1000, staff: 30, storage_mb: 5000, email_sends: 5000 }],
  ])
    await c.execute("INSERT IGNORE INTO plans(id,name,monthly_price,limits,active,trial_days) VALUES(?,?,?,?,1,14)", [
      id,
      name,
      price,
      JSON.stringify(limits),
    ]);
  const [planRows] = await c.query("SELECT id,name,monthly_price,limits,trial_days FROM plans");
  for (const p of planRows) {
    const limits = typeof p.limits === "string" ? JSON.parse(p.limits) : p.limits || {};
    if (!Number.isFinite(Number(limits.email_sends))) {
      const fallback = p.id === 1 ? 100 : p.id === 2 ? 1000 : 5000;
      limits.email_sends = fallback;
      p.limits = JSON.stringify(limits);
      await c.execute("UPDATE plans SET limits=? WHERE id=?", [p.limits, p.id]);
    }
  }
  const [versionRows] = await c.query("SELECT id,plan_id,limits FROM plan_versions");
  for (const v of versionRows) {
    const limits = typeof v.limits === "string" ? JSON.parse(v.limits) : v.limits || {};
    if (!Number.isFinite(Number(limits.email_sends))) {
      limits.email_sends = v.plan_id === 1 ? 100 : v.plan_id === 2 ? 1000 : 5000;
      await c.execute("UPDATE plan_versions SET limits=? WHERE id=?", [JSON.stringify(limits), v.id]);
    }
  }
  for (const p of planRows) {
    const [versions] = await c.query("SELECT id FROM plan_versions WHERE plan_id=? ORDER BY id LIMIT 1", [p.id]);
    if (!versions.length)
      await c.execute("INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP())", [p.id,p.name,p.monthly_price,p.limits,p.trial_days]);
  }
  await c.query(
    "INSERT IGNORE INTO subscriptions(store_id,plan_id,status) SELECT id,1,'free' FROM stores",
  );
  for (const [table, name, columns] of [
    ["orders", "store_delivery", "store_id,delivery_date,delivery_slot,status"],
    ["invoices", "billing_debt", "store_id,status,due_date"],
    ["orders", "store_status", "store_id,status,id"],
    ["products", "store_active", "store_id,active,id"],
    ["email_outbox", "store_pending", "store_id,status,next_attempt_at"],
    ["order_items", "store_order", "store_id,order_id"],
  ]) {
    const [indexes] = await c.query("SHOW INDEX FROM " + table);
    if (!indexes.some((i) => i.Key_name === name))
      await c.query(
        "ALTER TABLE " + table + " ADD INDEX " + name + "(" + columns + ")",
      );
  }
  const [stores] = await c.query("SELECT id,name FROM stores");
  await migratePlatformEmail(c);
  for (const store of stores) await seedStoreTemplates(c, store.id, store.name);
  await c.query(
    "INSERT IGNORE INTO schema_migrations(version) VALUES('saas-v1')",
  );
  await migrateManualOrders(c);
  await migrateProductTaxonomy(c);
}
export async function seedStoreTemplates(c, storeId, storeName = "Fleurious") {
  for (const t of defaults.filter(t=>t.key.startsWith("order_")||t.key.startsWith("crm_")))
    await c.execute(
      "INSERT IGNORE INTO email_templates(store_id,template_key,name,kind,subject,body) VALUES(?,?,?,?,?,?)",
      [
        storeId,
        t.key,
        t.name,
        t.kind,
        t.key.startsWith("subscription_") || t.key.startsWith("store_") ? t.subject : t.subject.replaceAll("Fleurious", storeName),
        t.key.startsWith("subscription_") || t.key.startsWith("store_") ? t.body : t.body.replaceAll("Fleurious", storeName),
      ],
    );
}
