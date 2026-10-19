import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { migrateSaaS } from './saas-schema.mjs';

assert(process.env.MYSQL_DATABASE === 'fleur_saas_test' && process.env.MYSQL_PORT === '3310', 'Isolated QA DB only');
const c = await mysql.createConnection({host:'127.0.0.1',port:3310,user:'root',dateStrings:true});
const database = 'fleur_timeout_qa_' + randomUUID().replaceAll('-','');
try {
  await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
  const [tables] = await c.query('SHOW TABLES FROM fleur_saas_test');
  for (const row of tables) {
    const table = Object.values(row)[0];
    assert(/^\w+$/.test(table));
    await c.query(`CREATE TABLE ${database}.${table} LIKE fleur_saas_test.${table}`);
  }
  await c.changeUser({database});
  await c.query("INSERT INTO users(name,email,password_hash,role) VALUES('Migration QA','migration@example.test','test-only','admin')");
  await migrateSaaS(c);
  await c.query("SET time_zone='+07:00'");
  const [store] = await c.query("INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES('timeout-migration','Migration QA',1,'approved','{}','{}')");
  await c.query("INSERT INTO subscriptions(store_id,plan_id,access_ends_at) VALUES(?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY))",[store.insertId]);
  const [[version]] = await c.query('SELECT id FROM plan_versions WHERE plan_id=2 LIMIT 1');
  const ids = [];
  for (const [key, paid, status] of [['pending',0,'open'],['partial',100,'open'],['settled',299000,'paid']]) {
    const [invoice] = await c.query("INSERT INTO invoices(store_id,period_key,plan_name,amount,paid,status,due_date,created_at,starts_at,plan_version_id) VALUES(?,?,'Studio',299000,?,?,CURRENT_DATE(),DATE_SUB(NOW(),INTERVAL 20 MINUTE),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 DAY),?)",[store.insertId,key,paid,status,version.id]);
    ids.push(invoice.insertId);
  }
  await c.query("DELETE FROM schema_migrations WHERE version IN ('plan-change-timeout-v1','plan-change-timeout-utc-v2')");
  await migrateSaaS(c);
  let [[invoice]] = await c.query("SELECT purpose,payment_deadline_at,UTC_TIMESTAMP() now_utc,TIMESTAMPADD(SECOND,UNIX_TIMESTAMP(created_at)+600,'1970-01-01 00:00:00') expected FROM invoices WHERE id=?",[ids[0]]);
  assert.equal(invoice.purpose,'plan_change');
  assert.equal(invoice.payment_deadline_at,invoice.expected);
  assert(invoice.payment_deadline_at < invoice.now_utc);
  console.log('PASS Legacy request gets exact UTC deadline on Vietnam-time server');
  // Reproduce v1 deadlines already written using local TIMESTAMP display.
  await c.query("UPDATE invoices SET payment_deadline_at=DATE_ADD(created_at,INTERVAL 10 MINUTE) WHERE id=?",[ids[0]]);
  await c.query("DELETE FROM schema_migrations WHERE version='plan-change-timeout-utc-v2'");
  await c.query("SET time_zone='+00:00'");
  await migrateSaaS(c);
  const [[repaired]] = await c.query('SELECT payment_deadline_at FROM invoices WHERE id=?',[ids[0]]);
  assert.equal(repaired.payment_deadline_at,invoice.expected);
  console.log('PASS v2 repairs Vietnam-time deadline from a UTC session without extending the request');
  const [[partial]] = await c.query('SELECT paid,status FROM invoices WHERE id=?',[ids[1]]);
  assert.equal(partial.paid,100); assert.equal(partial.status,'open');
  const [[settled]] = await c.query('SELECT paid,status,purpose,payment_deadline_at FROM invoices WHERE id=?',[ids[2]]);
  assert.equal(settled.paid,299000); assert.equal(settled.status,'paid'); assert.equal(settled.purpose,'renewal'); assert.equal(settled.payment_deadline_at,null);
  console.log('PASS Migration preserves partial receipts and settled invoices');
  await c.query("SET time_zone='+00:00'");
  await migrateSaaS(c);
  [[invoice]] = await c.query('SELECT payment_deadline_at FROM invoices WHERE id=?',[ids[0]]);
  assert.equal(invoice.payment_deadline_at,repaired.payment_deadline_at);
  console.log('PASS Repeated migration in UTC preserves repaired deadline');
  const [[starterVersion]] = await c.query('SELECT id FROM plan_versions WHERE plan_id=1 ORDER BY id LIMIT 1');
  await c.query("UPDATE subscriptions SET registration_plan_version_id=?,plan_version_id=?,trial_days_granted=14,trial_started_at=UTC_TIMESTAMP(),trial_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 14 DAY),status='trialing' WHERE store_id=?",[starterVersion.id,starterVersion.id,store.insertId]);
  await c.query("INSERT INTO trial_claims(store_id,trial_days,started_at,ends_at) VALUES(?,14,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 14 DAY))",[store.insertId]);
  const [otherStore] = await c.query("INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES('pending-discovery','Pending Discovery',1,'pending','{}','{}')");
  await c.query("INSERT INTO subscriptions(store_id,plan_id,registration_plan_version_id,trial_days_granted,status) VALUES(?,2,?,7,'pending_activation')",[otherStore.insertId,version.id]);
  await c.query("DELETE FROM schema_migrations WHERE version='account-trials-v1'");
  await migrateSaaS(c);
  const [claims] = await c.query("SELECT * FROM account_trial_claims WHERE user_id=1 ORDER BY bucket");
  assert.equal(claims.length,2);assert.equal(claims[0].bucket,'discovery');assert.equal(claims[0].starts_at,null);assert.equal(claims[1].bucket,'starter');assert(claims[1].activated_at);
  console.log('PASS Existing started trial and pending non-starter offer consume the correct account slots');
  const [[beforeSub]] = await c.query('SELECT * FROM subscriptions WHERE store_id=?',[store.insertId]);
  await migrateSaaS(c);
  const [[afterSub]] = await c.query('SELECT * FROM subscriptions WHERE store_id=?',[store.insertId]);
  assert.deepEqual(beforeSub,afterSub);
  const [[count]] = await c.query('SELECT COUNT(*) n FROM account_trial_claims WHERE user_id=1');assert.equal(count.n,2);
  console.log('PASS Account trial migration is idempotent and preserves existing subscription rights');
} finally {
  await c.changeUser({database:'fleur_saas_test'});
  await c.query(`DROP DATABASE ${database}`);
  await c.end();
}
