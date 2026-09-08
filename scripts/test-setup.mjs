import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const host = process.env.MYSQL_HOST || "127.0.0.1";
assert.ok(
  ["localhost", "127.0.0.1"].includes(host),
  "Seed regression tests are local-only",
);
const database = "fleur_setup_qa_" + randomBytes(6).toString("hex");
const c = await mysql.createConnection({
  host,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
});
const env = {
  ...process.env,
  MYSQL_HOST: host,
  MYSQL_DATABASE: database,
  MYSQL_SSL: "false",
  ADMIN_EMAIL: "seed-test@example.test",
  ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
};
const run = (extra = {}, args = []) =>
  spawnSync(process.execPath, ["scripts/setup-db.mjs", ...args], {
    env: { ...env, ...extra },
    encoding: "utf8",
    timeout: 60000,
  });
let checks = 0;
const check = (condition, label) => {
  assert.ok(condition, label);
  console.log("PASS " + label);
  checks++;
};
try {
  let r = run({ MYSQL_HOST: "", MYSQL_USER: "", MYSQL_PASSWORD: "" }, [
    "--tidb",
  ]);
  check(
    r.status !== 0 && r.stderr.includes("Missing TiDB configuration"),
    "Missing TiDB credentials fail before connection",
  );
  r = run({ MYSQL_PASSWORD: "validation-only" }, ["--tidb"]);
  check(
    r.status !== 0 && r.stderr.includes("MYSQL_SSL=true"),
    "TiDB setup refuses plaintext",
  );
  r = run({ MYSQL_SSL: "true", MYSQL_PASSWORD: "validation-only" }, ["--tidb"]);
  check(
    r.status !== 0 && r.stderr.includes("cloud hostname"),
    "TiDB setup refuses local MySQL fallback",
  );
  r = run({ ADMIN_PASSWORD: "short" });
  check(
    r.status !== 0 && r.stderr.includes("unique ADMIN_PASSWORD"),
    "Invalid admin password fails before schema writes",
  );
  r = run({ MYSQL_DATABASE: "sys" });
  check(
    r.status !== 0 && r.stderr.includes("system database"),
    "System databases cannot be seeded",
  );
  await c.query(
    "CREATE DATABASE " +
      database +
      " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
  );
  await c.query("USE " + database);
  await c.query(
    "CREATE TABLE categories(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120) NOT NULL,slug VARCHAR(160) UNIQUE NOT NULL,description TEXT) AUTO_INCREMENT=101",
  );
  r = run();
  if (r.status !== 0) throw Error(r.stderr);
  check(r.status === 0, "Fresh seed succeeds with non-default category IDs");
  let [[counts]] = await c.query(
    "SELECT (SELECT COUNT(*) FROM categories) categories,(SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM users WHERE role='admin') admins,(SELECT COUNT(*) FROM posts) posts,(SELECT COUNT(*) FROM events) events",
  );
  check(
    counts.categories === 4 &&
      counts.products === 6 &&
      counts.admins === 1 &&
      counts.posts === 2 &&
      counts.events === 2,
    "Expected seed records created",
  );
  const [[product]] = await c.query(
    "SELECT c.slug FROM products p JOIN categories c ON p.category_id=c.id WHERE p.slug='pure-poetry'",
  );
  check(
    product.slug === "hoa-binh",
    "Product category resolves by slug, not assumed ID",
  );
  const [[before]] = await c.query(
    "SELECT password_hash FROM users WHERE role='admin'",
  );
  r = run({ ADMIN_PASSWORD: randomBytes(24).toString("base64url") });
  if (r.status !== 0) throw Error(r.stderr);
  const [[after]] = await c.query(
    "SELECT password_hash FROM users WHERE role='admin'",
  );
  check(
    before.password_hash === after.password_hash,
    "Rerunning seed preserves existing admin password",
  );
  [[counts]] = await c.query(
    "SELECT (SELECT COUNT(*) FROM categories) categories,(SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM users) users",
  );
  check(
    counts.categories === 4 && counts.products === 6 && counts.users === 1,
    "Rerunning seed does not duplicate records",
  );
  console.log("All " + checks + " seed regression checks passed.");
} finally {
  if (!/^fleur_setup_qa_[a-f0-9]{12}$/.test(database))
    throw Error("Refusing cleanup of unexpected database");
  await c.query("DROP DATABASE IF EXISTS " + database);
  await c.end();
}
