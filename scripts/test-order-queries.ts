import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { orderPaymentStatusSQL } from "../lib/order-payment-state";
import { scopedSQL, withStore } from "../lib/tenant";

// Read-only compatibility check against MySQL or TiDB, using the selected env.
// No orders, payments, accounts or emails are created or modified.
async function main() {
  const db = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "fleur_store",
    ssl:
      process.env.MYSQL_SSL === "true"
        ? { rejectUnauthorized: true }
        : undefined,
  });
  try {
    const fixtures = `WITH orders AS (
    SELECT 1 id,1 store_id,100 total,'paid' payment_status UNION ALL
    SELECT 2,1,100,'unpaid' UNION ALL SELECT 3,1,100,'unpaid' UNION ALL
    SELECT 4,1,100,'unpaid' UNION ALL SELECT 5,1,100,'paid' UNION ALL
    SELECT 6,1,100,'paid' UNION ALL SELECT 7,1,100,'unpaid'
  ), order_payments AS (
    SELECT 1 id,3 order_id,1 store_id,'collect' kind,40 amount UNION ALL
    SELECT 2,4,1,'collect',100 UNION ALL SELECT 3,5,1,'collect',100 UNION ALL
    SELECT 4,5,1,'refund',25 UNION ALL SELECT 5,6,1,'collect',100 UNION ALL
    SELECT 6,6,1,'refund',100 UNION ALL SELECT 7,7,2,'collect',100
  ) SELECT o.id,${orderPaymentStatusSQL()} payment_status FROM orders o ORDER BY o.id`;
    const [states]: any = await db.execute(fixtures);
    assert.deepEqual(
      states.map((row: any) => row.payment_status),
      [
        "paid",
        "unpaid",
        "partially_paid",
        "paid",
        "partially_refunded",
        "refunded",
        "unpaid",
      ],
    );
    console.log(
      "PASS legacy, partial, paid, refund and cross-store receipt isolation",
    );
    const select = `SELECT o.*,${orderPaymentStatusSQL()} payment_status,
    (SELECT u.name FROM users u WHERE u.id=o.created_by) creator_name,
    (SELECT COALESCE(SUM(IF(p.kind='collect',p.amount,-p.amount)),0) FROM order_payments p WHERE p.order_id=o.id) collected,
    (SELECT JSON_ARRAYAGG(JSON_OBJECT('name',product_name,'quantity',quantity,'size',size,'price',price,'line_type',line_type,'description',description,'image',image)) FROM order_items i WHERE i.order_id=o.id) items
    FROM orders o WHERE `;
    for (const [name, sql, values] of [
      [
        "board page 1",
        select +
          "o.status=? ORDER BY o.delivery_date,o.delivery_slot,o.id LIMIT 20 OFFSET 0",
        ["pending"],
      ],
      [
        "board page 2/payment filter",
        select +
          orderPaymentStatusSQL() +
          "=? ORDER BY o.id LIMIT 20 OFFSET 20",
        ["paid"],
      ],
      [
        "calendar",
        select +
          "o.delivery_date BETWEEN ? AND ? ORDER BY o.delivery_date,o.delivery_slot,o.id",
        ["2000-01-01", "2100-01-01"],
      ],
      [
        "draft page 2",
        "SELECT id FROM order_drafts WHERE status='draft' ORDER BY id LIMIT 20 OFFSET 20",
        [],
      ],
    ] as const) {
      await db.execute(
        withStore(1, () => scopedSQL(sql)),
        [...values],
      );
      console.log("PASS", name);
    }
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  // Avoid logging mysql2's full error object (it can contain SQL and parameters).
  console.error(
    "Order query verification failed:",
    error.code || error.message,
  );
  process.exitCode = 1;
});
