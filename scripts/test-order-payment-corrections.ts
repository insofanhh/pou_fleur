import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { setOrderPaymentBalance, recordOrderPayment, reconcileOrderPaymentState } from "../lib/order-payments";
import { orderPaymentStatusSQL } from "../lib/order-payment-state";
import { analyticsQueries } from "../lib/store-analytics";
import { scopedSQL, withStore } from "../lib/tenant";

// Disposable fixture tables in local QA only; live tables are never accessed.
async function main() {
  const raw = await mysql.createConnection({ host: "127.0.0.1", port: 3310, user: "root", database: "fleur_saas_test", decimalNumbers: true });
  const prefix = "qa_correction_" + randomUUID().replaceAll("-", "").slice(0, 8) + "_";
  const created: string[] = [];
  const rewrite = (sql: string) => sql
    .replace(/\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+`?(stores|orders|order_payments|audit_logs|order_status_events|payment_intents)\b`?/gi, (_, keyword, name) => `${keyword} ${prefix}${name}`)
    .replace(/`?\b(stores|orders|order_payments|audit_logs|order_status_events|payment_intents)\b`?\s*\./gi, (_, name) => `${prefix}${name}.`);
  const db = {
    execute: (sql: string, values?: any[]) => raw.execute(rewrite(sql), values),
    query: (sql: string) => raw.query(rewrite(sql)),
    beginTransaction: () => raw.beginTransaction(), commit: () => raw.commit(), rollback: () => raw.rollback(),
  };
  let checks = 0;
  const check = (ok: unknown, label: string) => { assert(ok, label); checks++; console.log("PASS", label); };
  try {
    const tables = {
      stores: "id INT PRIMARY KEY",
      orders: "id INT PRIMARY KEY,store_id INT,total INT,payment_status VARCHAR(30),status VARCHAR(30),version INT,created_at DATETIME,creation_source VARCHAR(20),sales_channel VARCHAR(20),payment_method VARCHAR(20),fulfillment_method VARCHAR(20) DEFAULT 'delivery'",
      order_payments: "id INT AUTO_INCREMENT PRIMARY KEY,store_id INT,order_id INT,amount INT,kind VARCHAR(20),reference VARCHAR(100),actor_id INT,method VARCHAR(20),received_at DATETIME,UNIQUE KEY(store_id,reference)",
      audit_logs: "id INT AUTO_INCREMENT PRIMARY KEY,store_id INT,user_id INT,action VARCHAR(50),entity VARCHAR(50),entity_id VARCHAR(50),detail JSON",
      order_status_events: "id INT AUTO_INCREMENT PRIMARY KEY,store_id INT,order_id INT,actor_id INT,status VARCHAR(50),detail TEXT",
      payment_intents: "id INT AUTO_INCREMENT PRIMARY KEY,store_id INT,order_id INT,status VARCHAR(20),amount INT,paid_amount INT,paid_at DATETIME",
    };
    for (const [name, columns] of Object.entries(tables)) {
      await db.query(`CREATE TABLE ${name} (${columns})`);
      created.push(prefix + name);
    }
    await db.execute("INSERT INTO stores VALUES(1),(2)");
    await db.execute("INSERT INTO orders(id,store_id,total,payment_status,status,version,created_at,creation_source,sales_channel,payment_method) VALUES(1,1,1187000,'paid','pending',1,'2026-10-20','manual','phone','cash'),(2,2,1187000,'paid','pending',1,'2026-10-20','manual','phone','bank'),(3,1,1187000,'paid','pending',1,'2026-10-20','manual','phone','cash')");
    await db.execute("INSERT INTO order_payments(store_id,order_id,amount,kind,reference,actor_id,method) VALUES(1,1,1187000,'collect','ORIGINAL',10,'cash'),(2,2,1187000,'collect','OTHER-STORE',20,'bank')");
    await db.execute("INSERT INTO payment_intents(store_id,order_id,status,amount) VALUES(1,1,'pending',1187000)");
    const c = { execute: (sql: string, values: unknown[]) => db.execute(scopedSQL(sql), values) } as any;
    const one = async (sql: string, values: unknown[] = []) => (await db.execute(sql, values))[0] as any[];
    const order = async () => (await one(`SELECT o.*,${orderPaymentStatusSQL()} derived FROM orders o WHERE o.id=1`))[0];
    const update = async (amount: number, extra: any = {}) => withStore(1, async () => {
      const row = await order();
      const payload = { totalCollected: amount, method: "cash", version: row.version, requestKey: randomUUID(), operation: "correction", reason: "Tạo đơn nhầm trạng thái thanh toán", ...extra };
      await db.beginTransaction();
      try { const result = await setOrderPaymentBalance(c, 1, 10, payload); await db.commit(); return { result, payload }; }
      catch (error) { await db.rollback(); throw error; }
    });
    const verify = async (amount: number, status: string) => {
      const row = await order();
      check(row.payment_status === status && row.derived === status, `Stored and derived status both ${status}`);
      const rows = await withStore(1, () => c.execute(analyticsQueries.orders, ["2026-10-20", "2026-10-20"]));
      // Store 1 also contains a legacy paid order worth 1,187,000 VNĐ.
      check(Number(rows[0].reduce((sum: number, r: any) => sum + Number(r.collected), 0)) === amount + 1187000, `Analytics reflects corrected received balance ${amount}`);
    };
    const first = await update(0, { reason: "" });
    await verify(0, "unpaid");
    const original = (await one("SELECT * FROM order_payments WHERE reference='ORIGINAL'"))[0];
    check(original.amount === 1187000 && original.kind === "collect", "Correction preserves original receipt");
    check((await one("SELECT amount,kind FROM order_payments WHERE order_id=1 ORDER BY id DESC LIMIT 1"))[0].amount === -1187000, "Correction is a signed ledger adjustment");
    check(!(await one("SELECT id FROM order_payments WHERE order_id=1 AND kind='refund'")).length, "Correction does not fabricate a refund");
    check((await one("SELECT status FROM payment_intents WHERE order_id=1"))[0].status === "cancelled", "Correction invalidates QR with stale amount");
    check((await one("SELECT detail FROM order_status_events WHERE order_id=1"))[0].detail.includes("Điều chỉnh trạng thái thanh toán ghi nhầm"), "History auto-fills the reason when left empty");
    const replay = await update(0, first.payload);
    check(replay.result.duplicate, "Retry is idempotent after version changes");
    await assert.rejects(update(0, { ...first.payload, reason: "Lý do khác" }), (e: any) => e.status === 409);
    await assert.rejects(update(0, { ...first.payload, operation: "movement" }), (e: any) => e.status === 409);
    await assert.rejects(update(1, { version: first.payload.version }), (e: any) => e.status === 409);
    const omittedReason = await update(0, { ...first.payload, reason: undefined });
    check(omittedReason.result.duplicate, "Omitted and empty reasons normalize identically on retry");
    await assert.rejects(update(1, { reason: "x".repeat(501) }));
    await assert.rejects(update(1187001));
    await assert.rejects(update(-1));
    check(true, "Rejects changed retry payload, stale version, overlong reason and invalid amounts");
    await withStore(1, () => reconcileOrderPaymentState(c, 1, 10));
    check((await order()).payment_status === "unpaid", "Automatic reconciliation does not turn correction into refund");
    await update(200000, { reason: "Nhầm" }); await verify(200000, "partially_paid");
    check((await one("SELECT detail FROM order_status_events WHERE order_id=1 ORDER BY id DESC LIMIT 1"))[0].detail.includes("Nhầm"), "Optional short reason is accepted and retained");
    await update(1187000); await verify(1187000, "paid");
    await assert.rejects(update(1087000, { operation: "movement", reason: "" }), (e: any) => e.status === 409);
    await assert.rejects(withStore(1, () => recordOrderPayment(c, 1, 10, { kind: "refund", amount: 1, method: "cash", reference: "REFUND-ACTIVE-DENIED" })), (e: any) => e.status === 409);
    check(true, "Active orders reject real refunds through both balance and receipt APIs");
    await db.execute("UPDATE orders SET status='cancelled' WHERE id=1");
    await update(1187000 - 100000, { operation: "movement", reason: "" });
    await verify(1087000, "partially_refunded");
    await update(0, { operation: "movement", reason: "" });
    await verify(0, "refunded");
    await update(0); await verify(0, "unpaid");
    await db.execute("UPDATE orders SET status='pending' WHERE id=1");
    await withStore(1, () => recordOrderPayment(c, 1, 10, { kind: "collect", amount: 1187000, method: "bank", reference: "BANK-AFTER-CORRECTION" }));
    await verify(1187000, "paid");
    check(true, "Real receipts and refunds remain valid after corrections");
    await db.execute("UPDATE orders SET status='cancelled' WHERE id=1");
    await update(100000);
    await assert.rejects(update(200000), (e: any) => e.status === 409);
    check(true, "Cancelled order permits downward correction but rejects balance increases");
    await assert.rejects(withStore(1, () => setOrderPaymentBalance(c, 2, 10, { ...first.payload, version: 1, requestKey: randomUUID() })), (e: any) => e.status === 404);
    check((await one("SELECT payment_status FROM orders WHERE id=2"))[0].payment_status === "paid", "Cannot correct another store's order");
    await withStore(1, () => setOrderPaymentBalance(c, 3, 10, { ...first.payload, version: 1, requestKey: randomUUID() }));
    check((await one(`SELECT ${orderPaymentStatusSQL()} derived FROM orders o WHERE o.id=3`))[0].derived === "unpaid", "Legacy paid badge without receipt can be corrected without refund");
    const receiptsBeforeMethod = (await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=1"))[0].n;
    const statusBeforeMethod = (await order()).payment_status;
    const methodOnly = await update(100000, { updateBalance: false, paymentMethod: "bank" });
    check((await order()).payment_method === "bank" && (await order()).payment_status === statusBeforeMethod && (await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=1"))[0].n === receiptsBeforeMethod, "Method-only save preserves money and creates no correction receipt");
    check((await update(100000, methodOnly.payload)).result.duplicate, "Combined endpoint retries method-only saves safely");
    await assert.rejects(update(100000, { ...methodOnly.payload, paymentMethod: "cod" }), (e: any) => e.status === 409);
    await assert.rejects(update(50000, { updateBalance: false, paymentMethod: "cod" }), (e: any) => e.status === 400);
    check(true, "Method-only request cannot smuggle a balance change or alter a completed retry");
    const versionBeforeFailure = (await order()).version;
    await assert.rejects(update(0, { paymentMethod: "cod", reference: "ORIGINAL" }), (e: any) => e.status === 409);
    check((await order()).payment_method === "bank" && (await order()).version === versionBeforeFailure, "A rejected financial edit rolls back the method and version atomically");
    const combined = await update(50000, { paymentMethod: "cod" });
    check((await order()).payment_method === "cod" && (await order()).payment_status === "partially_paid", "A single transaction updates method and balance together");
    check((await update(50000, combined.payload)).result.duplicate, "Combined balance and method save is idempotent");
    console.log(`${checks} payment correction checks passed`);
  } finally {
    for (const name of created.reverse()) {
      assert(name.startsWith(prefix) && /^qa_correction_[a-f0-9]{8}_[a-z_]+$/.test(name));
      await raw.query(`DROP TABLE ${name}`);
    }
    await raw.end();
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
