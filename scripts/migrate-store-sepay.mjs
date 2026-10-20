import mysql from "mysql2/promise";
import { migrateStoreSepay } from "./store-sepay-schema.mjs";
const host = process.env.MYSQL_HOST || "127.0.0.1";
if (!["localhost", "127.0.0.1"].includes(host) && !process.argv.includes("--production-backup-verified"))
  throw Error("Verify a backup restore before remote migration; pass --production-backup-verified afterwards.");
const c = await mysql.createConnection({ host, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || "root", password: process.env.MYSQL_PASSWORD || "", database: process.env.MYSQL_DATABASE || "fleur_store", ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined });
try { await migrateStoreSepay(c); console.log("Store SePay schema ready (additive, rerunnable)"); } finally { await c.end(); }
