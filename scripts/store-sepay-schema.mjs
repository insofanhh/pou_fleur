export async function migrateStoreSepay(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS store_sepay_integrations (
    store_id INT NOT NULL PRIMARY KEY,
    api_key_hash CHAR(64) NOT NULL,
    api_last4 CHAR(4) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    updated_by INT NOT NULL,
    last_received_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await c.query("INSERT IGNORE INTO schema_migrations(version) VALUES('store-sepay-v1')");
}
