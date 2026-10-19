import { mkdir, writeFile } from "node:fs/promises";
import { pool, query } from "../lib/db";
import { withStore, withSystem } from "../lib/tenant";
import { orderPaymentStatusSQL } from "../lib/order-payment-state";
import { reconcileOrderPaymentState } from "../lib/order-payments";

async function main() {
  const reference = process.argv
    .find((v) => v.startsWith("--reference="))
    ?.slice(12);
  const rows = await withSystem(() =>
    query<any[]>(
      "SELECT o.id,o.store_id,o.reference,o.version,o.payment_status stored_status," +
        orderPaymentStatusSQL() +
        " ledger_status FROM orders o" +
        (reference ? " WHERE o.reference=?" : ""),
      reference ? [reference] : [],
    ),
  );
  const stale = rows.filter((o) => o.stored_status !== o.ledger_status);
  console.log(JSON.stringify({ checked: rows.length, mismatches: stale }));
  if (!process.argv.includes("--apply") || !stale.length) return;
  await mkdir(".local/backups", { recursive: true });
  await writeFile(
    `.local/backups/payment-status-${Date.now()}.json`,
    JSON.stringify(stale, null, 2),
  );
  await withSystem(async () => {
    const indexes = await query<any[]>(
      "SHOW INDEX FROM order_payments WHERE Key_name='payment_order_ledger'",
    );
    if (!indexes.length)
      await pool.query(
        "ALTER TABLE order_payments ADD INDEX payment_order_ledger(store_id,order_id,id)",
      );
  });
  let repaired = 0;
  for (const order of stale)
    await withStore(order.store_id, async () => {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        if (await reconcileOrderPaymentState(c, order.id)) repaired++;
        await c.commit();
      } catch (error) {
        await c.rollback();
        throw error;
      } finally {
        c.release();
      }
    });
  console.log(JSON.stringify({ repaired, receiptsUnchanged: true }));
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
