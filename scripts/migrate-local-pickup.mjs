// Local app repair: verify a restorable backup before adding COD/pickup fields.
import mysql from "mysql2/promise";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrateCOD } from "./cod-schema.mjs";
import { migratePickup } from "./pickup-schema.mjs";

const host = process.env.MYSQL_HOST || "127.0.0.1";
const database = process.env.MYSQL_DATABASE || "fleur_store";
assert(["localhost", "127.0.0.1"].includes(host), "Local database only");
assert(/^\w+$/.test(database), "Invalid database name");
const config = {
  host,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database,
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
};
const source = await mysql.createConnection(config);
const restore = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  multipleStatements: true,
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
});
const quote = (name) => "`" + name.replaceAll("`", "``") + "`";
const canonical = (v) =>
  !v || typeof v !== "object"
    ? v
    : Array.isArray(v)
      ? v.map(canonical)
      : Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        );
const digest = (rows) =>
  createHash("sha256")
    .update(
      JSON.stringify(rows.map((row) => JSON.stringify(canonical(row))).sort()),
    )
    .digest("hex");
const tables = [
  "orders",
  "order_items",
  "order_payments",
  "products",
  "customers",
  "promotions",
];
const columns = {};
async function fingerprints(c) {
  const result = {};
  for (const table of tables) {
    const [rows] = await c.query(
      "SELECT " + columns[table].map(quote).join(",") + " FROM " + quote(table),
    );
    result[table] = { rows: rows.length, hash: digest(rows) };
  }
  return result;
}
async function verify(c) {
  const [cols] = await c.query("SHOW COLUMNS FROM orders");
  for (const field of [
    "cod_payer",
    "cod_recipient_consent_at",
    "fulfillment_method",
    "pickup_location_snapshot",
    "picked_up_at",
  ])
    assert(
      cols.some((col) => col.Field === field),
      "Missing column: " + field,
    );
  assert.equal(
    cols.find((col) => col.Field === "fulfillment_method").Default,
    "delivery",
  );
  const [markers] = await c.query(
    "SELECT version FROM schema_migrations WHERE version IN ('order-cod-v1','order-pickup-v1')",
  );
  assert.equal(markers.length, 2);
  await c.query(
    "SELECT o.id,o.fulfillment_method,o.cod_payer FROM orders o WHERE o.fulfillment_method='pickup' LIMIT 0",
  );
}
try {
  await source.query("SET time_zone='+00:00'");
  await restore.query("SET time_zone='+00:00'");
  for (const table of tables) {
    const [rows] = await source.query("SHOW COLUMNS FROM " + quote(table));
    columns[table] = rows.map((row) => row.Field);
  }
  const before = await fingerprints(source);
  const [templates] = await source.query(
    "SELECT * FROM email_templates ORDER BY id",
  );
  const stamp = Date.now(),
    restored = "fleur_pickup_restore_" + stamp;
  assert.notEqual(restored, database);
  const backup = resolve(
    ".local/backups/" + database + "-pickup-" + stamp + ".sql",
  );
  mkdirSync(resolve(".local/backups"), { recursive: true });
  const dump = execFileSync(
    process.env.MYSQLDUMP_PATH ||
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
      "--hex-blob",
      database,
    ],
    {
      env: { ...process.env, MYSQL_PWD: config.password },
      maxBuffer: 100 * 1024 * 1024,
    },
  );
  writeFileSync(backup, dump, { flag: "wx", mode: 0o600 });
  await restore.query(
    "CREATE DATABASE " + quote(restored) + " CHARACTER SET utf8mb4",
  );
  await restore.changeUser({ database: restored });
  await restore.query(readFileSync(backup, "utf8"));
  // changeUser and mysqldump restore session settings; normalize TIMESTAMP
  // reads again before comparing databases with different server timezones.
  await restore.query("SET time_zone='+00:00'");
  assert.deepEqual(
    await fingerprints(restore),
    before,
    "Backup restore mismatch; source unchanged",
  );
  assert.equal(
    digest(
      (await restore.query("SELECT * FROM email_templates ORDER BY id"))[0],
    ),
    digest(templates),
  );
  console.log(
    "PASS local backup restored; order, payment, stock, customer and template values match",
  );
  for (let n = 0; n < 2; n++) {
    await migrateCOD(restore);
    await migratePickup(restore);
    await verify(restore);
    assert.deepEqual(
      await fingerprints(restore),
      before,
      "Migration changed business data; source unchanged",
    );
    const [currentTemplates] = await restore.query(
      "SELECT * FROM email_templates ORDER BY id",
    );
    assert.equal(
      digest(
        currentTemplates.filter((t) =>
          templates.some((old) => old.id === t.id),
        ),
      ),
      digest(templates),
      "Custom templates changed; source unchanged",
    );
  }
  console.log(
    "PASS restored database migration and repeat run preserve existing business data and templates",
  );
  // Recheck after the drill; do not migrate through an unexpected concurrent edit.
  assert.deepEqual(
    await fingerprints(source),
    before,
    "Local data changed during preflight; rerun with a fresh backup",
  );
  await migrateCOD(source);
  await migratePickup(source);
  await verify(source);
  const after = await fingerprints(source);
  assert.deepEqual(
    after,
    before,
    "Source fingerprint mismatch after migration; inspect backup",
  );
  writeFileSync(
    ".local/pickup-local-migration-report.json",
    JSON.stringify(
      {
        database,
        port: config.port,
        backup,
        restored,
        before,
        after,
        backupRestoreVerified: true,
        repeatRunVerified: true,
        businessDataPreserved: true,
        migrations: ["order-cod-v1", "order-pickup-v1"],
        appliedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS local app database repaired; existing orders, money, stock and customers preserved",
  );
  console.log("Report: .local/pickup-local-migration-report.json");
} finally {
  await source.end();
  await restore.end();
}
