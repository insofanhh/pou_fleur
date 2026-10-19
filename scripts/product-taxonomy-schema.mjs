// Additive and rerunnable. Existing free-text compositions remain unchanged.
export async function migrateProductTaxonomy(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS flower_components (
    id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(160) NOT NULL,
    description TEXT,
    UNIQUE KEY store_flower_slug(store_id,slug),
    UNIQUE KEY store_flower_name(store_id,name)
  )`);
  await c.query(`CREATE TABLE IF NOT EXISTS product_flower_components (
    id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    product_id INT NOT NULL,
    component_id INT NOT NULL,
    UNIQUE KEY store_product_component(store_id,product_id,component_id),
    KEY store_component(store_id,component_id)
  )`);
  const [columns] = await c.query(
    "SHOW COLUMNS FROM products LIKE 'flower_other'",
  );
  if (!columns.length)
    await c.query(
      "ALTER TABLE products ADD COLUMN flower_other VARCHAR(255) NULL",
    );
}
