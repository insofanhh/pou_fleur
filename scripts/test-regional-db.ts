import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { parseDateTime, hanoiDateKey } from "../lib/date-time";
import { emailUsageSQL } from "../lib/email-policy";
import { withSystem } from "../lib/tenant";

// Read-only checks plus connection-local temporary fixtures, no store data changes.
async function main() {
try {
  await withSystem(async () => {
    const connections = await Promise.all(Array.from({ length: 5 }, () => pool.getConnection()));
    try {
      for (const c of connections) {
        const [rows]: any = await c.query("SELECT @@session.time_zone zone,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()) seconds,CURDATE() day,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE) deadline");
        assert.equal(rows[0].zone, "+07:00");
        assert.equal(rows[0].seconds, 25200);
        assert.equal(rows[0].day, hanoiDateKey());
        const remaining = parseDateTime(rows[0].deadline, "utc").getTime() - Date.now();
        assert(remaining > 598000 && remaining <= 600000, "QR remains valid for 10 minutes");
      }
      const c = connections[0];
      // TIMESTAMP is a calendar view of the same instant in different SQL zones.
      await c.query("CREATE TEMPORARY TABLE regional_qa (created_at TIMESTAMP, quota_at DATETIME NULL, sent_at DATETIME NULL,store_id INT,template_key VARCHAR(30),status VARCHAR(20))");
      try {
        await c.query("INSERT INTO regional_qa VALUES ('2026-11-01 00:01:00',NULL,NULL,1,'order_confirmation','sent'),('2026-10-31 23:59:00',NULL,NULL,1,'order_confirmation','sent')");
        const [local]: any = await c.query("SELECT DATE(created_at) day,COUNT(*) n FROM regional_qa GROUP BY DATE(created_at) ORDER BY day");
        assert.deepEqual(local.map((r: any) => [r.day, r.n]), [["2026-10-31", 1], ["2026-11-01", 1]]);
        const usage = emailUsageSQL("1").replaceAll("email_outbox", "regional_qa").replaceAll("UTC_TIMESTAMP()", "TIMESTAMP('2026-10-31 17:02:00')");
        const [counts]: any = await c.query(`SELECT ${usage} used`);
        assert.equal(counts[0].used, 1, "monthly mail allowance rolls at Hanoi midnight");
        await c.query("SET time_zone='+00:00'");
        const [utc]: any = await c.query("SELECT created_at FROM regional_qa ORDER BY created_at DESC");
        assert.equal(utc[0].created_at, "2026-10-31 17:01:00");
        await c.query("SET time_zone='+07:00'");
      } finally { await c.query("DROP TEMPORARY TABLE regional_qa"); }
    } finally { for (const c of connections) c.release(); }
    const [reused]: any = await pool.query("SELECT @@session.time_zone zone");
    assert.equal(reused[0].zone, "+07:00");
  });
  console.log("PASS Hanoi SQL zone on 5 pooled connections, reuse, report calendar, QR UTC deadline and monthly email allowance");
} finally { await pool.end(); }

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
