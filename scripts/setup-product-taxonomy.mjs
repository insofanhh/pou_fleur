import mysql from "mysql2/promise";
import { migrateProductTaxonomy } from "./product-taxonomy-schema.mjs";
const local = ["localhost", "127.0.0.1"].includes(
  process.env.MYSQL_HOST || "127.0.0.1",
);
if (!local && !process.argv.includes("--production-backup-verified"))
  throw Error(
    "Verify a database backup restore before remote migration; then pass --production-backup-verified.",
  );
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "fleur_store",
  ssl:
    process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
try {
  await migrateProductTaxonomy(c);
  console.log("Product taxonomy schema ready.");
} finally {
  await c.end();
}
