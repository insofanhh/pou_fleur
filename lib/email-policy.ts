import { query } from "./db";
import { tenantId } from "./tenant";

export const isPlatformEmail = (key: string) =>
  key.startsWith("store_") || key.startsWith("subscription_");
export const defaultEmailLimit = (plan: number) =>
  plan === 1 ? 100 : plan === 2 ? 1000 : 5000;
// Calendar month in Vietnam. SMTP-uncertain submissions retain their slot so
// retries cannot bypass the allowance after a lost DATA acknowledgment.
export const emailMonthStart =
  "CONVERT_TZ(DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 HOUR),'%Y-%m-01 00:00:00'),'+07:00','+00:00')";
export const emailUsageSQL = (store: string) =>
  `(SELECT COUNT(*) FROM email_outbox em WHERE em.store_id=${store} AND LEFT(em.template_key,13)<>'subscription_' AND LEFT(em.template_key,6)<>'store_' AND em.status IN ('sent','sending','uncertain') AND COALESCE(em.quota_at,CONVERT_TZ(COALESCE(em.sent_at,em.created_at),'+07:00','+00:00'))>=${emailMonthStart})`;

export async function emailAllowance(
  c: { execute: (sql: string, values?: any[]) => Promise<any> },
  sid: number,
) {
  const [rows]: any = await c.execute(
    `SELECT sub.plan_id,COALESCE(v.limits,p.limits) limits,${emailUsageSQL("sub.store_id")} used FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id LEFT JOIN plan_versions v ON v.id=sub.plan_version_id WHERE sub.store_id=?`,
    [sid],
  );
  const r = rows[0];
  const limits =
    typeof r?.limits === "string" ? JSON.parse(r.limits) : r?.limits;
  return {
    used: Number(r?.used || 0),
    limit: Number(
      limits?.email_sends ?? defaultEmailLimit(Number(r?.plan_id || 1)),
    ),
  };
}
export async function storeEmailIdentity() {
  const [s] = await query<any[]>("SELECT name,slug FROM stores WHERE id=?", [
    tenantId(),
  ]);
  return {
    store_name: s.name,
    store_url:
      (process.env.APP_ORIGIN || "").replace(/\/$/, "") + "/s/" + s.slug,
  };
}
