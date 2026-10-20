export async function migrateCOD(c) {
  const [columns] = await c.query("SHOW COLUMNS FROM orders");
  if (!columns.some((col) => col.Field === "cod_payer"))
    await c.query("ALTER TABLE orders ADD COLUMN cod_payer VARCHAR(20) NULL");
  if (!columns.some((col) => col.Field === "cod_recipient_consent_at"))
    await c.query(
      "ALTER TABLE orders ADD COLUMN cod_recipient_consent_at DATETIME NULL",
    );
  // Existing gift orders stay unknown; do not invent who agreed to pay.
  await c.query(
    "INSERT IGNORE INTO schema_migrations(version) VALUES('order-cod-v1')",
  );
}
