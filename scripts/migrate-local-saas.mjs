import mysql from "mysql2/promise";
import { migrateSaaS } from "./saas-schema.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const host = process.env.MYSQL_HOST || "127.0.0.1",
  database = process.env.MYSQL_DATABASE;
if (
  !["127.0.0.1", "localhost"].includes(host) ||
  !database ||
  !/^[\w]+$/.test(database)
)
  throw Error("Local databases only.");
const cfg = {
  host,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
  multipleStatements: true,
  dateStrings: true,
};
const source = await mysql.createConnection(cfg),
  test = await mysql.createConnection({
    ...cfg,
    port: 3310,
    database: undefined,
    user: "root",
    password: "",
  });
const tables = ["users", "orders", "order_items", "products", "customers"];
const fingerprint = async (c) => {
  const data = {};
  for (const t of tables) {
    const [rows] = await c.query("SELECT * FROM " + t + " ORDER BY id");
    data[t] = rows.map((r) => {
      const {
        store_id,
        checkout_owner,
        version,
        store_name,
        delivery_mode,
        completed_at,
        assigned_to,
        tags,
        delivery_lat,
        delivery_lng,
        confirmed_at,
        shipped_at,
        ...legacy
      } = r;
      return legacy;
    });
  }
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
};
const stamp = Date.now(),
  restore = "fleur_restore_" + stamp;
mkdirSync(".local/backups", { recursive: true });
const backup = resolve(".local/backups/" + database + "-" + stamp + ".sql");
try {
  const before = await fingerprint(source);
  execFileSync(
    "C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin/mysqldump.exe",
    [
      "--host=" + host,
      "--port=" + cfg.port,
      "--user=" + cfg.user,
      "--single-transaction",
      "--routines",
      "--triggers",
      "--no-tablespaces",
      "--set-gtid-purged=OFF",
      "--result-file=" + backup,
      database,
    ],
    {
      env: { ...process.env, MYSQL_PWD: cfg.password || "" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const sql = readFileSync(backup, "utf8");
  if (new RegExp("USE\\s+`?" + database + "`?", "i").test(sql))
    throw Error("Backup unexpectedly selects the original database");
  await test.query("CREATE DATABASE " + restore + " CHARACTER SET utf8mb4");
  await test.query("USE " + restore);
  await test.query(sql);
  if ((await fingerprint(test)) !== before)
    throw Error("Restore fingerprint mismatch");
  await migrateSaaS(test);
  await migrateSaaS(test);
  if ((await fingerprint(test)) !== before)
    throw Error("Migration changed legacy business data");
  await migrateSaaS(source);
  if ((await fingerprint(source)) !== before)
    throw Error("Post-migration fingerprint mismatch");
  const report = {
    backup,
    restoreDatabase: restore,
    legacyFingerprint: before,
    restoreVerified: true,
    migrationRerunVerified: true,
    sourceVerified: true,
    appliedAt: new Date().toISOString(),
  };
  writeFileSync(
    ".local/migration-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await source.end();
  await test.end();
}
