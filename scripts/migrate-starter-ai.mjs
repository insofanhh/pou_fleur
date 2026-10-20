import mysql from "mysql2/promise";
import { mkdir, writeFile } from "node:fs/promises";
import { migrateStarterAI } from "./starter-ai-schema.mjs";
const local = ["localhost", "127.0.0.1"].includes(process.env.MYSQL_HOST || "127.0.0.1");
if (!local && !process.argv.includes("--production-backup-verified")) throw Error("Remote migration requires --production-backup-verified after a full backup and restore drill");
const c = await mysql.createConnection({ host: process.env.MYSQL_HOST || "127.0.0.1", port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || "root", password: process.env.MYSQL_PASSWORD || "", database: process.env.MYSQL_DATABASE || "fleur_store", ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined });
try {
  const [plans] = await c.query("SELECT * FROM plans WHERE id=1");
  const [versions] = await c.query("SELECT * FROM plan_versions WHERE plan_id=1");
  const [marker] = await c.query("SELECT * FROM schema_migrations WHERE version='starter-ai-allowance-v1'");
  await mkdir(".local/backups", { recursive: true });
  const backup = `.local/backups/starter-ai-${Date.now()}.json`;
  await writeFile(backup, JSON.stringify({ plans, versions, marker }, null, 2), { flag: "wx" });
  const result = await migrateStarterAI(c);
  console.log(JSON.stringify({ ...result, backup, scope: "Starter AI quota only" }));
} finally { await c.end(); }
