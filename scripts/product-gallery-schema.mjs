export async function setupProductGallery(connection) {
  const [columns] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products' AND COLUMN_NAME='gallery'",
  );
  if (!columns.length)
    await connection.execute(
      "ALTER TABLE products ADD COLUMN gallery JSON NULL",
    );
}
