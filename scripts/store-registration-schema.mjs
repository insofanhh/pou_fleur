import { createHash } from "node:crypto";

export async function migrateStoreRegistration(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS store_registration_claims(
    identity_key CHAR(64) PRIMARY KEY,identity_type VARCHAR(12) NOT NULL,
    user_id INT NOT NULL,store_id INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX registration_user(user_id),INDEX registration_store(store_id))`);
  // Backfill all statuses, retaining existing stores even when old data has
  // duplicates. The first store holds the claim; every new registration checks
  // the current stores as well. Never delete historical registration claims.
  const [stores] = await c.query(
    "SELECT s.id,s.owner_id,s.phone,u.email,u.phone owner_phone FROM stores s JOIN users u ON u.id=s.owner_id ORDER BY s.id",
  );
  for (const store of stores) {
    const keys = [
      ["account", String(store.owner_id)],
      ["email", String(store.email).trim().toLowerCase()],
    ];
    for (const phone of new Set([store.phone, store.owner_phone].filter(Boolean))) {
      let digits = phone.replace(/\D/g, "");
      if (digits.startsWith("00")) digits = digits.slice(2);
      else if (digits.startsWith("0")) digits = "84" + digits.slice(1);
      if (/^[1-9]\d{8,14}$/.test(digits)) keys.push(["phone", digits]);
    }
    for (const [kind, value] of keys)
      await c.execute(
        "INSERT IGNORE INTO store_registration_claims(identity_key,identity_type,user_id,store_id) VALUES(?,?,?,?)",
        [createHash("sha256").update(kind + ":" + value).digest("hex"), kind, store.owner_id, store.id],
      );
  }
}
