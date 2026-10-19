import mysql from "mysql2/promise";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { migrateProductTaxonomy } from "./product-taxonomy-schema.mjs";
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
    ...config,
    multipleStatements: true,
    dateStrings: true,
  });
const stamp = Date.now(),
  restored = "fleur_taxonomy_restore_" + stamp;
mkdirSync(".local/backups", { recursive: true });
const backup = resolve(
  ".local/backups/" + database + "-taxonomy-" + stamp + ".sql",
);
async function fingerprint(c) {
  const result = {};
  for (const [table, columns] of Object.entries({
    orders:
      "id,reference,user_id,customer_name,email,phone,status,payment_status,subtotal,discount,shipping,total",
    order_items: "id,order_id,product_id,product_name,quantity,price",
    products: "id,name,price,stock,flowers",
    categories: "id,name,slug,description",
    customers: "id,email,name,phone,marketing_consent",
  })) {
    const [rows] = await c.query(
      "SELECT " + columns + " FROM " + table + " ORDER BY id",
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
  await migrateProductTaxonomy(test);
  await migrateProductTaxonomy(test);
  if ((await fingerprint(test)) !== before)
    throw Error("Migration changed existing business values; source unchanged");
  await migrateProductTaxonomy(source);
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
    ".local/taxonomy-migration-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "Local product taxonomy migration complete: backup restored, migration rerun verified, existing orders/stock/money preserved. Report: .local/taxonomy-migration-report.json",
  );
} finally {
  await source.end();
  await test.end();
}
