import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { scryptSync, timingSafeEqual } from "node:crypto";
for (const key of [
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
]) {
  if (!process.env[key]?.trim()) throw Error("Missing " + key);
}
assert.equal(
  process.env.MYSQL_SSL,
  "true",
  "TiDB verification requires MYSQL_SSL=true",
);
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 4000),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  connectTimeout: 15000,
});
try {
  const [[server]] = await c.query("SELECT VERSION() version");
  assert.match(server.version, /tidb/i, "Connection must point to TiDB");
  const stream = c.connection.stream;
  assert.equal(stream.encrypted, true, "Connection must use TLS");
  assert.equal(
    stream.authorized,
    true,
    "TLS server certificate must be verified",
  );
  const [tables] = await c.query("SHOW TABLES");
  const expected = [
    "categories",
    "products",
    "users",
    "sessions",
    "promotions",
    "orders",
    "order_items",
    "customers",
    "crm_notes",
    "crm_tasks",
    "events",
    "posts",
    "inquiries",
    "audit_logs",
    "login_attempts",
    "password_resets",
    "email_templates",
    "email_campaigns",
    "email_outbox",
    "email_suppressions",
  ];
  const names = new Set(tables.flatMap((row) => Object.values(row)));
  for (const table of expected)
    assert.ok(names.has(table), "Missing table: " + table);
  const [[counts]] = await c.query(
    "SELECT (SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM categories) categories,(SELECT COUNT(*) FROM posts) posts,(SELECT COUNT(*) FROM events) events",
  );
  const [[admin]] = await c.execute(
    "SELECT role,active,password_hash FROM users WHERE email=?",
    [process.env.ADMIN_EMAIL || "admin@fleur.local"],
  );
  assert.ok(
    admin && admin.role === "admin" && admin.active === 1,
    "Admin must exist and be active",
  );
  const [salt, hash] = admin.password_hash.split(":");
  const expectedHash = Buffer.from(hash, "hex");
  const actual = scryptSync(process.env.ADMIN_PASSWORD, salt, 64);
  assert.ok(
    expectedHash.length === actual.length &&
      timingSafeEqual(expectedHash, actual),
    "Admin credentials do not match this environment",
  );
  const [[aggregate]] = await c.query(
    "SELECT JSON_ARRAYAGG(JSON_OBJECT('id',id)) result FROM categories",
  );
  assert.ok(aggregate.result, "JSON aggregate compatibility");
  await c.beginTransaction();
  await c.query("SELECT id FROM products ORDER BY id LIMIT 1 FOR UPDATE");
  await c.rollback();
  console.log(
    JSON.stringify(
      {
        server: server.version,
        tlsVerified: true,
        tables: expected.length,
        ...counts,
        adminVerified: true,
        jsonAggregateVerified: true,
        transactionLockVerified: true,
      },
      null,
      2,
    ),
  );
} finally {
  await c.end();
}
