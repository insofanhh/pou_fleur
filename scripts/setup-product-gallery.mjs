import mysql from "mysql2/promise";
import { setupProductGallery } from "./product-gallery-schema.mjs";
if (process.argv.includes("--tidb") && process.env.MYSQL_SSL !== "true")
  throw Error("TiDB requires verified TLS.");
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "fleur_store",
  connectTimeout: 15000,
  ssl:
    process.env.MYSQL_SSL === "true"
      ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
      : undefined,
});
try {
  await setupProductGallery(c);
  console.log("Product gallery column ready; existing products preserved.");
} finally {
  await c.end();
}
