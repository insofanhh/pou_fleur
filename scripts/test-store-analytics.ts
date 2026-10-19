import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { mkdir, writeFile } from "node:fs/promises";
import {
  analyticsPeriod,
  analyticsQueries,
  loadStoreAnalytics,
} from "../lib/store-analytics";
import { scopedSQL, withStore } from "../lib/tenant";

// Only connection-local temporary tables on local MySQL. Existing tables,
// accounts and orders are never written; closing the connection drops fixtures.
async function main() {
  const db = await mysql.createConnection({
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    database: "fleur_store",
    dateStrings: true,
    decimalNumbers: true,
  });
  try {
    await db.query("SET time_zone='+07:00'");
    const schemas = {
      orders:
        "id INT,store_id INT,created_at DATETIME,delivery_date DATE,status VARCHAR(30),payment_status VARCHAR(30),payment_method VARCHAR(20),creation_source VARCHAR(20),sales_channel VARCHAR(20),total INT",
      order_payments: "store_id INT,order_id INT,kind VARCHAR(20),amount INT",
      order_items:
        "store_id INT,order_id INT,product_id INT NULL,product_name VARCHAR(160),line_type VARCHAR(20),quantity INT,price INT",
      products: "id INT,store_id INT,category_id INT",
      categories: "id INT,store_id INT,name VARCHAR(160)",
      customers: "store_id INT,segment VARCHAR(20)",
      analytics_events: "store_id INT,name VARCHAR(30),created_at DATETIME",
    };
    for (const [name, schema] of Object.entries(schemas))
      await db.query(`CREATE TEMPORARY TABLE ${name} (${schema})`);
    const orders = [
      [
        1,
        1,
        "2026-10-01 00:00:00",
        "2026-10-02",
        "delivered",
        "paid",
        "bank",
        "website",
        null,
        1000000,
      ],
      [
        2,
        1,
        "2026-10-02 12:00:00",
        "2026-10-03",
        "confirmed",
        "unpaid",
        "cod",
        "manual",
        "zalo",
        600000,
      ],
      [
        3,
        1,
        "2026-10-02 14:00:00",
        "2026-10-02",
        "cancelled",
        "paid",
        "bank",
        "manual",
        "social",
        400000,
      ],
      [
        4,
        1,
        "2026-10-03 23:59:59",
        "2026-10-03",
        "delivered",
        "paid",
        "cod",
        "manual",
        "phone",
        700000,
      ],
      [
        5,
        1,
        "2026-10-03 12:00:00",
        "2026-10-03",
        "cancelled",
        "paid",
        "bank",
        "website",
        null,
        300000,
      ],
      [
        6,
        1,
        "2026-10-03 13:00:00",
        "2026-10-03",
        "confirmed",
        "unpaid",
        "cod",
        "manual",
        "in_person",
        0,
      ],
      [
        7,
        1,
        "2026-09-30 12:00:00",
        "2026-10-02",
        "delivered",
        "unpaid",
        "cod",
        "website",
        null,
        800000,
      ],
      [
        8,
        1,
        "2026-09-28 00:00:00",
        "2026-09-28",
        "delivered",
        "paid",
        "bank",
        "website",
        null,
        500000,
      ],
      [
        9,
        2,
        "2026-10-01 12:00:00",
        "2026-10-02",
        "delivered",
        "paid",
        "bank",
        "website",
        null,
        99000000,
      ],
      [
        10,
        1,
        "2026-10-04 00:00:00",
        "2026-10-04",
        "delivered",
        "paid",
        "cod",
        "website",
        null,
        9000000,
      ],
    ];
    await db.query("INSERT INTO orders VALUES ?", [orders]);
    await db.query("INSERT INTO order_payments VALUES ?", [
      [
        [1, 1, "collect", 600000],
        [1, 1, "collect", 400000],
        [1, 1, "refund", 100000],
        [1, 2, "collect", 200000],
        [1, 3, "collect", 100000],
        [1, 5, "collect", 300000],
        [1, 5, "refund", 300000],
        [2, 1, "collect", 99000000],
      ],
    ]);
    await db.query("INSERT INTO order_items VALUES ?", [
      [
        [1, 1, 100, "Hoa trắng", "catalog", 2, 400000],
        [1, 2, 100, "Hoa trắng", "catalog", 1, 600000],
        [1, 4, null, "Bó riêng", "custom", 1, 700000],
        [1, 3, 100, "Đã hủy", "catalog", 100, 1000000],
        [2, 1, 100, "Khác store", "catalog", 100, 1000000],
      ],
    ]);
    await db.query("INSERT INTO products VALUES (100,1,10),(200,2,20)");
    await db.query(
      "INSERT INTO categories VALUES (10,1,'Bó hoa'),(20,2,'Store khác')",
    );
    await db.query(
      "INSERT INTO customers VALUES (1,'new'),(1,'new'),(1,'vip'),(2,'loyal')",
    );
    await db.query(
      "INSERT INTO analytics_events VALUES (1,'store_view','2026-10-01 12:00:00'),(2,'store_view','2026-10-01 12:00:00'),(1,'product_view','2026-09-30 12:00:00')",
    );
    const read = async (sql: string, args: unknown[] = []) =>
      (await db.execute(scopedSQL(sql), args as any[]))[0] as any[];
    const data = await withStore(1, () =>
      loadStoreAnalytics("2026-10-01", "2026-10-03", 1, read),
    );
    assert.equal(data.summary.orders_count, 6);
    assert.equal(data.summary.revenue, 1700000);
    assert.equal(data.summary.order_value, 2300000);
    assert.equal(
      data.summary.collected,
      1900000,
      "No duplicated receipts; retain legacy paid and honor zero after refund",
    );
    assert.equal(
      data.summary.outstanding,
      500000,
      "Cancelled balances are not receivables",
    );
    assert.equal(
      data.summary.refund_due,
      100000,
      "Cancelled order with retained money requires refund",
    );
    assert.equal(data.summary.cancellations, 2);
    assert.equal(data.summary.delivered, 2);
    assert.equal(data.summary.partial_count, 2);
    assert.equal(
      data.summary.paid_count,
      2,
      "Free order has no outstanding payment",
    );
    assert.equal(data.summary.unpaid_count, 0);
    assert.equal(data.previous.orders_count, 2);
    assert.equal(data.previous.revenue, 1300000);
    assert.equal(data.daily.length, 3);
    assert.equal(data.daily[0].orders_count, 1, "Inclusive start");
    assert.equal(
      data.daily[2].orders_count,
      3,
      "Inclusive end, exclude next midnight",
    );
    assert.equal(
      data.products[0].quantity,
      3,
      "Cancelled and foreign store items excluded",
    );
    assert.equal(data.products[0].item_value, 1400000);
    assert.equal(data.categories.find((c) => c.name === "Bó hoa")?.quantity, 3);
    assert.equal(
      data.categories.find((c) => c.id === null)?.item_value,
      700000,
    );
    assert.equal(
      data.deliveries.reduce((n, d) => n + d.orders_count, 0),
      5,
      "Delivery workload includes orders placed before period",
    );
    assert.equal(
      data.segments.reduce((n, s) => n + s.count, 0),
      3,
    );
    assert.deepEqual(data.funnel, [{ name: "store_view", count: 1 }]);
    assert.equal(
      data.sources.reduce((n, s) => n + s.orders_count, 0),
      data.summary.orders_count,
    );
    assert.equal(
      data.payments.reduce((n, p) => n + p.collected, 0),
      data.summary.collected,
    );
    const empty = await withStore(1, () =>
      loadStoreAnalytics("2026-11-01", "2026-11-07", 1, read),
    );
    assert.equal(empty.daily.length, 7);
    assert(empty.daily.every((d) => d.revenue === 0 && d.collected === 0));
    assert.equal(empty.sources.length, 0);
    assert.equal(empty.summary.orders_count, 0);
    assert.throws(() => analyticsPeriod("2026-02-30", "2026-03-02"));
    assert.throws(() => analyticsPeriod("2026-10-03", "2026-10-01"));
    assert.throws(() => analyticsPeriod("2025-01-01", "2026-01-02"));
    assert.equal(analyticsPeriod("2028-02-28", "2028-03-01").days, 3);
    assert.equal(
      analyticsPeriod("2026-01-01", "2026-01-01").previousFrom,
      "2025-12-31",
    );
    for (const [name, sql] of Object.entries(analyticsQueries)) {
      if (name === "funnel") assert(sql.includes("WHERE store_id=?"));
      else
        assert.throws(
          () => scopedSQL(sql),
          "Require tenant for every scoped report query",
        );
    }
    await mkdir(".local", { recursive: true });
    await writeFile(
      ".local/analytics-fixture.json",
      JSON.stringify({ data, empty }),
    );
    console.log(
      "PASS analytics SQL: MySQL execution, tenant isolation, date boundaries, previous period, receipt/refund accounting, legacy paid, zero-price orders, products/categories, delivery dates, empty periods and validation",
    );
  } finally {
    await db.end();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
