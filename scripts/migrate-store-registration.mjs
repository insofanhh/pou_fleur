import mysql from "mysql2/promise";
import { migrateStoreRegistration } from "./store-registration-schema.mjs";

if (!["localhost", "127.0.0.1"].includes(process.env.MYSQL_HOST || "127.0.0.1") &&
    !process.argv.includes("--production-backup-verified"))
  throw Error("Remote migration requires --production-backup-verified after a restore drill");
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "fleur_store",
  ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
try {
  await migrateStoreRegistration(c);
  console.log("Store registration identity claims ready. Existing stores preserved.");
} finally { await c.end(); }
