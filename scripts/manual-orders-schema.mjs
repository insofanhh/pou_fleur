// Additive, rerunnable migration. Run through the backup/restore workflow locally.
export async function migrateManualOrders(c) {
  const add = async (table, columns) => {
    for (const [name, type] of Object.entries(columns)) {
      const [rows] = await c.query(`SHOW COLUMNS FROM ${table} LIKE '${name}'`);
      if (!rows.length)
        await c.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  };
  await add("orders", {
    customer_id: "INT NULL",
    creation_source: "VARCHAR(20) NOT NULL DEFAULT 'web'",
    sales_channel: "VARCHAR(30) NOT NULL DEFAULT 'website'",
    created_by: "INT NULL",
    confirmed_by: "INT NULL",
    internal_notes: "TEXT NULL",
    manual_payload_hash: "CHAR(64) NULL",
    adjustment: "JSON NULL",
    email_skip_reason: "VARCHAR(100) NULL",
  });
  await add("customers", {
    phone_normalized: "VARCHAR(30) NOT NULL DEFAULT ''",
  });
  await add("order_items", {
    line_type: "VARCHAR(20) NOT NULL DEFAULT 'catalog'",
    original_price: "INT NULL",
    description: "TEXT NULL",
  });
  await add("order_payments", {
    method: "VARCHAR(20) NOT NULL DEFAULT 'cash'",
    received_at: "DATETIME NULL",
  });
  await c.query("ALTER TABLE orders MODIFY email VARCHAR(190) NULL");
  await c.query("ALTER TABLE customers MODIFY email VARCHAR(190) NULL");
  await c.query("ALTER TABLE order_items MODIFY product_id INT NULL");
  await c.query(`CREATE TABLE IF NOT EXISTS order_drafts(
    id INT AUTO_INCREMENT PRIMARY KEY,store_id INT NOT NULL,created_by INT NOT NULL,updated_by INT NOT NULL,
    version INT NOT NULL DEFAULT 1,status VARCHAR(20) NOT NULL DEFAULT 'draft',payload JSON NOT NULL,
    converted_order_id INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX draft_store(store_id,status,updated_at))`);
  for (const [table, name, columns] of [
    ["orders", "customer_orders", "store_id,customer_id"],
    ["customers", "customer_phone", "store_id,phone_normalized"],
    ["order_payments", "payment_order_ledger", "store_id,order_id,id"],
  ]) {
    const [rows] = await c.query(
      `SHOW INDEX FROM ${table} WHERE Key_name='${name}'`,
    );
    if (!rows.length)
      await c.query(`ALTER TABLE ${table} ADD INDEX ${name}(${columns})`);
  }
  // Unique email within a tenant already exists. Never join contacts across stores.
  await c.query(`UPDATE orders o JOIN customers c ON c.store_id=o.store_id AND c.email=o.email
    SET o.customer_id=c.id WHERE o.customer_id IS NULL AND o.email IS NOT NULL`);
  await c.query(
    "UPDATE order_items SET original_price=price WHERE original_price IS NULL",
  );
  const [contacts] = await c.query(
    "SELECT id,phone FROM customers WHERE phone_normalized='' AND phone<>''",
  );
  for (const row of contacts) {
    let phone = row.phone.replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "84" + phone.slice(1);
    await c.execute("UPDATE customers SET phone_normalized=? WHERE id=?", [
      phone,
      row.id,
    ]);
  }
  await c.query(
    "INSERT IGNORE INTO schema_migrations(version) VALUES('manual-orders-v1')",
  );
}
