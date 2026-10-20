import defaults from "../lib/email-defaults.json" with { type: "json" };

export async function migratePickup(c) {
  const [columns] = await c.query("SHOW COLUMNS FROM orders");
  for (const [name, type] of Object.entries({
    fulfillment_method: "VARCHAR(20) NOT NULL DEFAULT 'delivery'",
    pickup_location_snapshot: "JSON NULL",
    picked_up_at: "DATETIME NULL",
  })) {
    if (!columns.some((col) => col.Field === name))
      await c.query(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
  }
  for (const t of defaults.filter((t) => t.key.startsWith("order_pickup_")))
    await c.execute(
      "INSERT IGNORE INTO email_templates(store_id,template_key,name,kind,subject,body) SELECT id,?,?,?,?,? FROM stores",
      [t.key, t.name, t.kind, t.subject, t.body],
    );
  await c.query(
    "INSERT IGNORE INTO schema_migrations(version) VALUES('order-pickup-v1')",
  );
}
