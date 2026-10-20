import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { loadOrderRefunds, markOrderRefund } from "../lib/order-refunds";
import { scopedSQL, withStore } from "../lib/tenant";
import { orderPaymentStatusSQL } from "../lib/order-payment-state";

async function main() {
  const config = {
    host: "127.0.0.1",
    port: 3310,
    user: "root",
    database: "fleur_saas_test",
    decimalNumbers: true,
  };
  const raw = await mysql.createConnection(config),
    other = await mysql.createConnection(config);
  const prefix =
    "qa_refund_" + randomUUID().replaceAll("-", "").slice(0, 8) + "_";
  const created: string[] = [];
  const rewrite = (sql: string) =>
    sql
      .replace(
        /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+`?(stores|orders|order_payments|audit_logs|order_status_events|payment_intents)\b`?/gi,
        (_, keyword, name) => `${keyword} ${prefix}${name}`,
      )
      .replace(
        /`?\b(stores|orders|order_payments|audit_logs|order_status_events|payment_intents)\b`?\s*\./gi,
        (_, name) => `${prefix}${name}.`,
      );
  const execute = (sql: string, values: any[] = []) =>
    raw.execute(rewrite(sql), values);
  const rows = async (sql: string, values: any[] = []) =>
    (await execute(sql, values))[0] as any[];
  const connection = (db: typeof raw) =>
    ({
      execute: (sql: string, values: any[]) =>
        db.execute(rewrite(scopedSQL(sql)), values),
    }) as any;
  const run = (async (sql: string, values: any[] = []) =>
    rows(scopedSQL(sql), values)) as any;
  let checks = 0;
  const check = (value: unknown, message: string) => {
    assert(value, message);
    checks++;
    console.log("PASS", message);
  };
  const payload = (extra: any = {}) => ({
    amount: 1000,
    version: 1,
    method: "bank",
    confirmed: true,
    requestKey: randomUUID(),
    reference: "",
    note: "Đã xác nhận với khách",
    ...extra,
  });
  const mark = async (id: number, body: any, db = raw, store = 1) =>
    withStore(store, async () => {
      await db.beginTransaction();
      try {
        const result = await markOrderRefund(connection(db), id, 10, body);
        await db.commit();
        return result;
      } catch (e) {
        await db.rollback();
        throw e;
      }
    });
  const list = (state = "pending", q = "", page = "1", store = 1) =>
    withStore(store, () =>
      loadOrderRefunds(
        new URL("http://localhost/?" + new URLSearchParams({ state, q, page })),
        run,
      ),
    );
  try {
    const tables = {
      stores: "id INT PRIMARY KEY",
      orders:
        "id INT PRIMARY KEY,store_id INT,total INT,payment_status VARCHAR(30),status VARCHAR(30),version INT,reference VARCHAR(60),customer_name VARCHAR(100),phone VARCHAR(30)",
      order_payments:
        "id INT AUTO_INCREMENT PRIMARY KEY,store_id INT,order_id INT,amount INT,kind VARCHAR(20),reference VARCHAR(100),actor_id INT,method VARCHAR(20),received_at DATETIME,UNIQUE KEY(store_id,reference)",
      audit_logs:
        "id INT AUTO_INCREMENT PRIMARY KEY,store_id INT,user_id INT,action VARCHAR(50),entity VARCHAR(50),entity_id VARCHAR(50),detail JSON",
      order_status_events:
        "id INT AUTO_INCREMENT PRIMARY KEY,store_id INT,order_id INT,actor_id INT,status VARCHAR(50),detail TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
      payment_intents:
        "id INT AUTO_INCREMENT PRIMARY KEY,store_id INT,order_id INT,status VARCHAR(20),amount INT,paid_amount INT,paid_at DATETIME",
    };
    for (const [name, columns] of Object.entries(tables)) {
      await raw.query(rewrite(`CREATE TABLE ${name} (${columns})`));
      created.push(prefix + name);
    }
    await execute("INSERT INTO stores VALUES(1),(2)");
    for (let id = 1; id <= 9; id++) {
      await execute("INSERT INTO orders VALUES(?,?,1000,?,?,1,?,?,?)", [
        id,
        id === 8 ? 2 : 1,
        id === 5 ? "unpaid" : "paid",
        id === 6 ? "confirmed" : "cancelled",
        "REF-" + id,
        "Khách " + id,
        "090000000" + id,
      ]);
      if (![5, 7].includes(id))
        await execute(
          "INSERT INTO order_payments(store_id,order_id,amount,kind,reference,method) VALUES(?,?,?,'collect',?,'bank')",
          [id === 8 ? 2 : 1, id, id === 2 ? 400 : 1000, "PAY-" + id],
        );
      if (id !== 6)
        await execute(
          "INSERT INTO order_status_events(store_id,order_id,status) VALUES(?,?,'cancelled')",
          [id === 8 ? 2 : 1, id],
        );
    }
    await execute(
      "INSERT INTO order_payments(store_id,order_id,amount,kind,reference,method) VALUES(1,3,250,'refund','PREVIOUS-3','bank'),(1,4,-1000,'correction','CORRECTION-4','bank'),(1,9,1000,'refund','PREVIOUS-9','cash')",
    );
    await execute(
      "INSERT INTO payment_intents(store_id,order_id,status,amount) VALUES(1,1,'pending',1000)",
    );
    let data = await list();
    check(
      data.total === 3 &&
        data.items
          .map((o) => o.id)
          .sort()
          .join() === "1,2,3",
      "Queue includes full, partial collection and partially refunded canceled orders only",
    );
    check(
      Number(data.summary.outstanding) === 2150 &&
        Number(data.summary.pending_count) === 3 &&
        Number(data.summary.completed_count) === 1 &&
        Number(data.summary.review_count) === 1,
      "Totals distinguish balances, real refunds and legacy review",
    );
    check(
      (await list("completed")).items[0].id === 9,
      "Completed filter requires a real refund",
    );
    check(
      (await list("review")).items[0].id === 7,
      "Legacy paid badge without receipt requires reconciliation",
    );
    check(
      (await list("all")).total === 5,
      "Unpaid, corrected-to-zero and active orders are excluded",
    );
    check(
      (await list("all", "Khách 2")).items[0].id === 2 &&
        (await list("all", "0900000003")).items[0].id === 3,
      "Search by name and phone",
    );
    check(
      (await list("pending", "REF-1")).total === 1 &&
        (await list("pending", "' OR 1=1 --")).total === 0,
      "Bound search handles code and SQL injection input safely",
    );
    check(
      (await list("all", "", "2")).items.length === 0,
      "Pagination remains bounded",
    );
    check(
      (await list("all", "", "1", 2)).items.length === 1 &&
        (await list("all", "", "1", 2)).items[0].id === 8,
      "List and summary are tenant scoped",
    );
    await assert.rejects(mark(8, payload()), (e: any) => e.status === 404);
    check(true, "Cannot refund another tenant's order");
    await assert.rejects(mark(6, payload()), (e: any) => e.status === 409);
    await assert.rejects(mark(7, payload()), (e: any) => e.status === 409);
    await assert.rejects(
      mark(1, payload({ amount: 1001 })),
      (e: any) => e.status === 409,
    );
    await assert.rejects(mark(1, payload({ amount: 0 })));
    await assert.rejects(mark(1, payload({ amount: -5 })));
    await assert.rejects(mark(1, payload({ amount: 0.1 })));
    await assert.rejects(mark(1, payload({ confirmed: false })));
    check(
      true,
      "Rejects noncancelled, unverified legacy, excessive/invalid amounts and absent confirmation",
    );
    const first = payload({ amount: 300, reference: "RETURN-300" });
    await mark(1, first);
    data = await list();
    const partial = data.items.find((o) => o.id === 1)!;
    check(
      Number(partial.outstanding) === 700 &&
        Number(partial.refunded) === 300 &&
        partial.version === 2,
      "Partial refund atomically updates balance and order version",
    );
    check(
      (
        await rows(
          `SELECT o.payment_status,${orderPaymentStatusSQL()} derived FROM orders o WHERE id=1`,
        )
      )[0].derived === "partially_refunded",
      "Shared payment status reflects partial refund",
    );
    check(
      (await rows("SELECT status FROM payment_intents WHERE order_id=1"))[0]
        .status === "cancelled",
      "Refund invalidates stale payment QR",
    );
    check(
      (await mark(1, first)).duplicate,
      "Same request retry succeeds without another refund",
    );
    await assert.rejects(
      mark(1, payload({ amount: 300, version: 2, reference: "RETURN-300" })),
      (e: any) => e.status === 409,
    );
    await assert.rejects(
      mark(2, payload({ amount: 300, reference: "RETURN-300" })),
      (e: any) => e.status === 409,
    );
    check(
      true,
      "Same transfer reference cannot be reused on this or another order in the store",
    );
    await assert.rejects(
      mark(1, { ...first, amount: 200 }),
      (e: any) => e.status === 409,
    );
    await assert.rejects(
      mark(1, { ...first, note: "changed" }),
      (e: any) => e.status === 409,
    );
    await assert.rejects(
      mark(1, payload({ amount: 200 })),
      (e: any) => e.status === 409,
    );
    check(
      (
        await rows(
          "SELECT id FROM order_payments WHERE order_id=1 AND kind='refund'",
        )
      ).length === 1,
      "Changed retry payload and stale version do not duplicate money movement",
    );
    // Two real connections contend for the same store/order lock and version.
    const concurrent = await Promise.allSettled([
      mark(1, payload({ version: 2, amount: 700 })),
      mark(1, payload({ version: 2, amount: 700 }), other),
    ]);
    check(
      concurrent.filter((r) => r.status === "fulfilled").length === 1,
      "Concurrent confirmations can complete only once",
    );
    const final = (
      await rows(
        `SELECT o.*,${orderPaymentStatusSQL()} derived FROM orders o WHERE id=1`,
      )
    )[0];
    check(
      final.payment_status === "refunded" &&
        final.derived === "refunded" &&
        final.status === "cancelled",
      "Full refund synchronizes status and preserves cancellation",
    );
    check(
      (await list()).total === 2 && (await list("completed")).total === 2,
      "Completed order leaves pending queue and appears in history",
    );
    check(
      (
        await rows(
          "SELECT * FROM order_status_events WHERE order_id=1 AND status='payment_refunded'",
        )
      ).length === 2 &&
        (
          await rows(
            "SELECT detail FROM audit_logs WHERE action='order_refund' AND entity_id='1'",
          )
        ).length === 2,
      "Every partial refund has one history event and detailed audit",
    );
    await execute(
      "UPDATE orders SET status='confirmed',version=version+1 WHERE id=2",
    );
    await assert.rejects(
      mark(2, payload({ amount: 400 })),
      (e: any) => e.status === 409,
    );
    check(
      !(await list()).items.some((o) => o.id === 2),
      "Restored order leaves queue; stale refund cannot alter it",
    );
    await assert.rejects(list("invalid"));
    await assert.rejects(list("all", "x".repeat(101)));
    await assert.rejects(list("all", "", "0"));
    check(true, "List validates filters, search length and page boundaries");
    console.log(`${checks} refund SQL and concurrency checks passed`);
  } finally {
    for (const name of created.reverse()) {
      assert(/^qa_refund_[a-f0-9]{8}_[a-z_]+$/.test(name));
      await raw.query(`DROP TABLE ${name}`);
    }
    await other.end();
    await raw.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
