import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { migrateStarterAI } from "./starter-ai-schema.mjs";

assert(process.env.MYSQL_DATABASE === "fleur_saas_test" && process.env.MYSQL_PORT === "3310" && ["127.0.0.1", "localhost"].includes(process.env.MYSQL_HOST || "127.0.0.1"), "Isolated QA DB only");
const c = await mysql.createConnection({ host: "127.0.0.1", port: 3310, user: "root", database: "fleur_saas_test" });
const rows = async (sql, params = []) => (await c.query(sql, params))[0];
const decode = value => typeof value === "string" ? JSON.parse(value) : value;
const savedPlan = (await rows("SELECT * FROM plans WHERE id=1"))[0];
const savedVersions = await rows("SELECT id,limits FROM plan_versions WHERE plan_id=1");
const savedMarker = await rows("SELECT * FROM schema_migrations WHERE version='starter-ai-allowance-v1'");
const otherPlans = await rows("SELECT * FROM plans WHERE id<>1 ORDER BY id");
const otherVersions = await rows("SELECT * FROM plan_versions WHERE plan_id<>1 ORDER BY id");
const subscriptions = await rows("SELECT * FROM subscriptions ORDER BY store_id");
const invoices = await rows("SELECT * FROM invoices ORDER BY id");
const added = [];
let checks = 0;
function check(value, title) { assert(value, title); checks++; console.log("PASS", title); }
try {
  await c.query("DELETE FROM schema_migrations WHERE version='starter-ai-allowance-v1'");
  await c.execute("UPDATE plans SET limits=? WHERE id=1", [JSON.stringify({ ...decode(savedPlan.limits), ai_messages: 0 })]);
  for (const quota of [undefined, 0, 17]) {
    const limits = { ...decode(savedPlan.limits), ai_messages: quota };
    const [result] = await c.execute("INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) VALUES(1,?,?,?,23,UTC_TIMESTAMP())", ["Starter migration fixture", 123456, JSON.stringify(limits)]);
    added.push(result.insertId);
  }
  const result = await migrateStarterAI(c);
  check(!result.skipped && result.updated >= 3, "One-time migration grants Starter catalog and missing/forced-zero versions");
  const catalog = (await rows("SELECT * FROM plans WHERE id=1"))[0];
  check(decode(catalog.limits).ai_messages === 50, "Legacy forced-zero catalog becomes 50 turns");
  for (const [index, id] of added.entries()) {
    const row = (await rows("SELECT * FROM plan_versions WHERE id=?", [id]))[0];
    const { ai_messages: actual, ...remaining } = decode(row.limits);
    const { ai_messages: ignored, ...original } = decode(savedPlan.limits);
    check(actual === (index === 2 ? 17 : 50), `Legacy version ${index} default/custom AI allowance preserved correctly`);
    check(JSON.stringify(remaining) === JSON.stringify(original) && row.monthly_price === 123456 && row.trial_days === 23, `Version ${index} keeps other quotas, price and trial days`);
  }
  check(JSON.stringify(await rows("SELECT * FROM plans WHERE id<>1 ORDER BY id")) === JSON.stringify(otherPlans) && JSON.stringify(await rows("SELECT * FROM plan_versions WHERE plan_id<>1 ORDER BY id")) === JSON.stringify(otherVersions), "Studio/Atelier and unknown plans/versions unchanged");
  check(JSON.stringify(await rows("SELECT * FROM subscriptions ORDER BY store_id")) === JSON.stringify(subscriptions) && JSON.stringify(await rows("SELECT * FROM invoices ORDER BY id")) === JSON.stringify(invoices), "Subscription periods, payment/invoice status and granted dates unchanged");
  await c.execute("UPDATE plans SET limits=? WHERE id=1", [JSON.stringify({ ...decode(catalog.limits), ai_messages: 0 })]);
  await c.execute("UPDATE plan_versions SET limits=? WHERE id=?", [JSON.stringify({ ...decode(savedPlan.limits), ai_messages: 0 }), added[0]]);
  check((await migrateStarterAI(c)).skipped, "Second migration run is a no-op");
  check(decode((await rows("SELECT limits FROM plans WHERE id=1"))[0].limits).ai_messages === 0 && decode((await rows("SELECT limits FROM plan_versions WHERE id=?", [added[0]]))[0].limits).ai_messages === 0, "Rerun cannot overwrite an intentional admin zero after rollout");
  console.log(`${checks} Starter AI migration checks passed`);
} finally {
  await c.execute("UPDATE plans SET limits=? WHERE id=1", [JSON.stringify(decode(savedPlan.limits))]);
  for (const row of savedVersions) await c.execute("UPDATE plan_versions SET limits=? WHERE id=?", [JSON.stringify(decode(row.limits)), row.id]);
  for (const id of added) await c.execute("DELETE FROM plan_versions WHERE id=?", [id]);
  await c.query("DELETE FROM schema_migrations WHERE version='starter-ai-allowance-v1'");
  for (const row of savedMarker) await c.execute("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)", [row.version, row.applied_at]);
  await c.end();
}
