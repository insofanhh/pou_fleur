import mysql from "mysql2/promise";
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "fleur_store",
  ssl:
    process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  dateStrings: true,
});
try {
  const [rows] =
    await c.execute(`SELECT s.id,s.status store_status,sub.plan_id,sub.status,
    sub.billing_policy,sub.trial_days_granted,sub.trial_started_at,sub.trial_ends_at,
    sub.current_period_end,sub.access_ends_at,
    (SELECT COUNT(*) FROM invoices i WHERE i.store_id=s.id AND i.paid>0) paid_invoices,
    (SELECT COUNT(*) FROM invoices i WHERE i.store_id=s.id AND i.status='open') open_invoices
    FROM stores s JOIN subscriptions sub ON sub.store_id=s.id ORDER BY s.id`);
  console.log(
    JSON.stringify(
      {
        read_only: true,
        stores: rows.map((s) => ({
          ...s,
          policy:
            s.billing_policy === 1
              ? "snapshot_trial_first"
              : s.trial_started_at
                ? "preserve_existing_trial"
                : s.paid_invoices
                  ? "preserve_paid_period"
                  : s.store_status === "pending"
                    ? "review_legacy_pending_offer"
                    : "preserve_legacy_access",
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await c.end();
}
