import mysql from "mysql2/promise";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { migrateSaaS } from "./saas-schema.mjs";
const host = process.env.MYSQL_HOST || "127.0.0.1",
  database = process.env.MYSQL_DATABASE || "fleur_store";
if (!["localhost", "127.0.0.1"].includes(host) || !/^\w+$/.test(database))
  throw Error("Local database only");
const config = {
  host,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database,
  dateStrings: true,
};
const source = await mysql.createConnection(config),
  test = await mysql.createConnection({
    host: "127.0.0.1",
    port: 3310,
    user: "root",
    multipleStatements: true,
    dateStrings: true,
  });
const stamp = Date.now(),
  restored = "fleur_trial_restore_" + stamp;
mkdirSync(".local/backups", { recursive: true });
const backup = resolve(
  ".local/backups/" + database + "-trial-" + stamp + ".sql",
);
async function fingerprint(c) {
  const result = {};
  for (const [table, columns] of Object.entries({
    stores: "id,status,billing_suspended,suspension_reason",
    subscriptions:
      "store_id,plan_id,status,period_end,current_period_start,current_period_end,trial_started_at,trial_ends_at,billing_anchor_day,plan_version_id,version",
    invoices:
      "id,store_id,period_key,plan_name,amount,paid,status,due_date,period_start,period_end,plan_version_id,applied_at",
    billing_payments: "id,invoice_id,reference,amount,actor_id",
    trial_claims: "store_id,trial_days,started_at,ends_at",
    plans: "id,name,monthly_price,limits,trial_days",
    orders: "id,status,payment_status,total",
    products: "id,name,price,stock",
  })) {
    const [rows] = await c.query(
      "SELECT " +
        columns +
        " FROM " +
        table +
        " ORDER BY " +
        (["subscriptions","trial_claims"].includes(table) ? "store_id" : "id"),
    );
    result[table] = rows;
  }
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}
try {
  const before = await fingerprint(source);
  const dump = execFileSync(
    "C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin/mysqldump.exe",
    [
      "-h",
      host,
      "-P",
      String(config.port),
      "-u",
      config.user,
      "--single-transaction",
      "--no-tablespaces",
      "--set-gtid-purged=OFF",
      database,
    ],
    {
      env: { ...process.env, MYSQL_PWD: config.password },
      maxBuffer: 100 * 1024 * 1024,
    },
  );
  writeFileSync(backup, dump);
  await test.query("CREATE DATABASE `" + restored + "` CHARACTER SET utf8mb4");
  await test.changeUser({ database: restored });
  await test.query(readFileSync(backup, "utf8"));
  if ((await fingerprint(test)) !== before)
    throw Error("Backup restore fingerprint mismatch; source unchanged");
  await migrateSaaS(test);
  await migrateSaaS(test);
  if ((await fingerprint(test)) !== before)
    throw Error("Migration changed existing business values; source unchanged");
  await migrateSaaS(source);
  const after = await fingerprint(source);
  if (after !== before)
    throw Error("Source fingerprint mismatch after migration; inspect backup");
  const report = {
    backup,
    restored,
    before,
    after,
    restoreVerified: true,
    rerunVerified: true,
    businessDataPreserved: true,
    appliedAt: new Date().toISOString(),
  };
  writeFileSync(
    ".local/trial-migration-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "Local trial-first schema migration complete: backup restored, rerun verified; existing subscription dates, invoices, payments and business data preserved. Report: .local/trial-migration-report.json",
  );
} finally {
  await source.end();
  await test.end();
}
