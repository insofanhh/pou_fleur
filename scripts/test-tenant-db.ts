import assert from "node:assert/strict";
import { query, mutate, pool } from "../lib/db";
import { withStore, withSystem } from "../lib/tenant";
async function main() {
  if (
    process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
    process.env.MYSQL_PORT !== "3310"
  )
    throw Error("Only isolated SaaS test database is allowed");
  try {
    const stores = await query<any[]>(
      "SELECT id FROM stores WHERE id<>1 ORDER BY id DESC LIMIT 1",
    );
    const sid = stores[0].id;
    const list = await withStore(sid, () =>
      query<any[]>("SELECT * FROM products WHERE id=0 OR active=1"),
    );
    assert(list.length && list.every((p) => p.store_id === sid));
    const [{ n }] = await withStore(sid, () =>
      query<any[]>("SELECT (SELECT COUNT(*) FROM products WHERE active=1) n"),
    );
    assert(n === list.length);
    const [other] = await withStore(1, () =>
      query<any[]>("SELECT * FROM products LIMIT 1"),
    );
    assert(
      (
        await withStore(sid, () =>
          mutate("UPDATE products SET name=? WHERE id=?", [
            "Forbidden",
            other.id,
          ]),
        )
      ).affectedRows === 0,
    );
    const joins = await withStore(1, () =>
      query<any[]>(
        "SELECT p.store_id p_store,i.store_id i_store FROM products p LEFT JOIN order_items i ON i.product_id=p.id",
      ),
    );
    assert(
      joins.every(
        (p) => p.p_store === 1 && (p.i_store === null || p.i_store === 1),
      ),
    );
    await assert.rejects(async () => query("SELECT * FROM orders"));
    const all = await withSystem(() =>
      query<any[]>("SELECT DISTINCT store_id FROM products"),
    );
    assert(all.length >= 2);
    console.log(
      "PASS actual SQL isolation: OR, nested SELECT, mutation, LEFT JOIN, missing scope, system scope",
    );
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
