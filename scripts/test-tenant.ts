import { strict as assert } from "node:assert";
import { withStore, scopedSQL } from "../lib/tenant";
const cases = [
  "SELECT * FROM products WHERE id=? OR active=1",
  "SELECT (SELECT SUM(total) FROM orders WHERE status='delivered') revenue",
  "SELECT p.*,c.name category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY p.id",
  "SELECT p.name,COALESCE(SUM(CASE WHEN o.status<>'cancelled' THEN i.quantity ELSE 0 END),0) sold FROM products p LEFT JOIN order_items i ON i.product_id=p.id LEFT JOIN orders o ON o.id=i.order_id GROUP BY p.id ORDER BY sold DESC LIMIT 5",
  "SELECT o.*,(SELECT JSON_ARRAYAGG(JSON_OBJECT('name',product_name,'quantity',quantity,'size',size,'price',price)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o ORDER BY id DESC LIMIT 500",
  "SELECT * FROM orders WHERE id=? FOR UPDATE",
  "UPDATE products SET stock=stock-? WHERE id=?",
  "INSERT INTO customers(email,name,phone,marketing_consent) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),phone=VALUES(phone),marketing_consent=GREATEST(marketing_consent,VALUES(marketing_consent))",
  "INSERT INTO email_outbox(dedupe_key,template_key,kind,recipient,order_id,subject,body) VALUES(?,?,'transactional',?,?,?,?) ON DUPLICATE KEY UPDATE dedupe_key=dedupe_key",
  "UPDATE email_outbox SET status=?,next_attempt_at=DATE_ADD(NOW(),INTERVAL 5 MINUTE) WHERE id=?",
];
withStore(2, () => {
  for (const sql of cases) {
    try {
      const out = scopedSQL(sql);
      assert(out.includes("store_id"));
      console.log("PASS", sql.slice(0, 65));
    } catch (e) {
      console.error("FAIL", sql, e);
      process.exitCode = 1;
    }
  }
});
assert.throws(() => scopedSQL("SELECT * FROM products"));
withStore(2, () => {
  assert.throws(() => scopedSQL("UPDATE products SET store_id=3"));
  assert.throws(() =>
    scopedSQL("INSERT INTO products(store_id,name) VALUES(3,?)"),
  );
});
