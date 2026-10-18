import mysql from "mysql2/promise";
import { migrateManualOrders } from "./manual-orders-schema.mjs";
const host = process.env.MYSQL_HOST || "127.0.0.1";
if (
  !["127.0.0.1", "localhost"].includes(host) &&
  !process.argv.includes("--production-backup-verified")
)
  throw Error(
    "Verify a backup restore before remote migration; pass --production-backup-verified afterwards.",
  );
const c = await mysql.createConnection({
  host,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "fleur_store",
  ssl:
    process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
try {
  await migrateManualOrders(c);
  console.log("Manual orders migration complete");
} finally {
  await c.end();
}
