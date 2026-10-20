import { z } from "zod";
import { query } from "./db";
import { analyticsPeriod } from "./store-analytics";
import { hanoiDateKey, parseDateTime } from "./date-time";
import { HttpError } from "./auth";
import { accessEndSQL } from "./billing";
import { emailUsageSQL, defaultEmailLimit } from "./email-policy";
import { aiAllowance, aiMonth } from "./ai-policy";

export const usageKeys = [
  "products",
  "staff",
  "storage_mb",
  "email_sends",
  "ai_messages",
] as const;
export function quotaUsage(used: number, limit: number) {
  return {
    used,
    limit,
    percent: limit > 0 ? Math.round((used / limit) * 100) : used > 0 ? 100 : 0,
    level:
      used > limit
        ? "over"
        : used === limit && limit > 0
          ? "full"
          : limit > 0 && used / limit >= 0.8
            ? "near"
            : "normal",
  };
}
const json = (v: any) => (typeof v === "string" ? JSON.parse(v) : v || {});

// Called only after platformActor(), inside system scope. All sums use their
// own ledger/group before joining, so receipts cannot multiply order values.
export async function loadPlatformOverview(url: URL) {
  const params = z
    .object({
      from: z.string(),
      to: z.string(),
      q: z.string().max(190),
      user_q: z.string().max(190),
      plan: z.coerce.number().int().min(0).max(100000),
      usage: z.enum(["all", "near"]),
      page: z.coerce.number().int().min(1).max(100000),
      user_page: z.coerce.number().int().min(1).max(100000),
    })
    .parse({
      from:
        url.searchParams.get("from") ||
        hanoiDateKey(Date.now() - 29 * 86400000),
      to: url.searchParams.get("to") || hanoiDateKey(),
      q: url.searchParams.get("q") || "",
      user_q: url.searchParams.get("user_q") || "",
      plan: url.searchParams.get("plan") || 0,
      usage: url.searchParams.get("usage") || "all",
      page: url.searchParams.get("page") || 1,
      user_page: url.searchParams.get("user_page") || 1,
    });
  let period;
  try {
    period = analyticsPeriod(params.from, params.to);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const start = params.from + " 00:00:00",
    end = params.to + " 23:59:59";
  const [
    stores,
    plans,
    orders,
    receipts,
    registrations,
    userCounts,
    health,
    userTotal,
    users,
  ] = await Promise.all([
    query<any[]>(
      `SELECT s.id,s.name,s.slug,s.status,s.billing_suspended,s.created_at,u.email owner_email,sub.plan_id,sub.status subscription_status,sub.cancel_at_period_end,${accessEndSQL()} expires_at,COALESCE(v.name,p.name) plan_name,COALESCE(v.limits,p.limits) limits,COALESCE(v.monthly_price,p.monthly_price,0) monthly_price,
      COALESCE(pr.used,0) products,COALESCE(st.used,0) staff,COALESCE(a.used,0)/1048576 storage_mb,${emailUsageSQL("s.id")} email_sends,COALESCE(ai.used,0) ai_messages,wa.last_seen_at,
      (SELECT MAX(al.created_at) FROM audit_logs al WHERE al.store_id=s.id AND al.user_id IS NOT NULL AND al.action<>'account_trial_brought_forward' AND EXISTS(SELECT 1 FROM store_memberships am WHERE am.store_id=s.id AND am.user_id=al.user_id AND am.status='active') AND NOT EXISTS(SELECT 1 FROM platform_memberships pm WHERE pm.user_id=al.user_id)) last_action_at,
      (SELECT MAX(o.created_at) FROM orders o WHERE o.store_id=s.id) last_order_at,
      (SELECT COUNT(*) FROM invoices i WHERE i.store_id=s.id AND i.status='open' AND i.paid<i.amount AND COALESCE(i.due_at,DATE_ADD(i.due_date,INTERVAL 1 DAY))<=UTC_TIMESTAMP()) overdue_invoices
      FROM stores s JOIN users u ON u.id=s.owner_id LEFT JOIN subscriptions sub ON sub.store_id=s.id LEFT JOIN plans p ON p.id=sub.plan_id LEFT JOIN plan_versions v ON v.id=sub.plan_version_id
      LEFT JOIN (SELECT store_id,COUNT(*) used FROM products WHERE active=1 GROUP BY store_id) pr ON pr.store_id=s.id
      LEFT JOIN (SELECT store_id,COUNT(*) used FROM store_memberships WHERE status='active' GROUP BY store_id) st ON st.store_id=s.id
      LEFT JOIN (SELECT store_id,SUM(size) used FROM assets GROUP BY store_id) a ON a.store_id=s.id
      LEFT JOIN (SELECT store_id,COUNT(*) used FROM ai_runs WHERE month_key=? AND (status='succeeded' OR (status='running' AND lease_until>UTC_TIMESTAMP())) GROUP BY store_id) ai ON ai.store_id=s.id
      LEFT JOIN (SELECT store_id,MAX(last_seen_at) last_seen_at FROM workspace_activity GROUP BY store_id) wa ON wa.store_id=s.id`,
      [aiMonth()],
    ),
    query<any[]>("SELECT id,name,monthly_price,limits FROM plans ORDER BY id"),
    query<any[]>(
      "SELECT DATE(created_at) day,store_id,COUNT(*) orders_count,SUM(IF(status='delivered',total,0)) gmv,SUM(status='cancelled') cancelled FROM orders WHERE created_at>=? AND created_at<=? GROUP BY DATE(created_at),store_id",
      [start, end],
    ),
    query<any[]>(
      "SELECT DATE(COALESCE(CONVERT_TZ(bp.received_at,'+00:00','+07:00'),bp.created_at)) day,i.store_id,SUM(bp.amount) collected FROM billing_payments bp JOIN invoices i ON i.id=bp.invoice_id WHERE COALESCE(CONVERT_TZ(bp.received_at,'+00:00','+07:00'),bp.created_at)>=? AND COALESCE(CONVERT_TZ(bp.received_at,'+00:00','+07:00'),bp.created_at)<=? GROUP BY DATE(COALESCE(CONVERT_TZ(bp.received_at,'+00:00','+07:00'),bp.created_at)),i.store_id",
      [start, end],
    ),
    query<any[]>(
      "SELECT DATE(created_at) day,COUNT(*) stores FROM stores WHERE created_at>=? AND created_at<=? GROUP BY DATE(created_at)",
      [start, end],
    ),
    query<any[]>(
      "SELECT COUNT(*) total,SUM(u.active=1) enabled,SUM(u.active=1 AND ac.last_seen_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)) active_30d,SUM(u.created_at>=? AND u.created_at<=?) new_users FROM users u LEFT JOIN account_activity ac ON ac.user_id=u.id LEFT JOIN platform_user_states ps ON ps.user_id=u.id WHERE ps.deleted_at IS NULL",
      [start, end],
    ),
    query<any[]>(
      "SELECT (SELECT COUNT(*) FROM email_outbox WHERE status IN ('failed','uncertain')) email_issues,(SELECT COUNT(*) FROM ai_runs WHERE status='failed' AND created_at>=DATE_SUB(NOW(),INTERVAL 1 DAY)) ai_failures,(SELECT COUNT(*) FROM ai_issue_reports WHERE status IN ('new','reviewing')) open_issues,(SELECT COUNT(*) FROM sepay_webhook_events WHERE processed=0) payment_issues",
    ),
    query<any[]>(
      "SELECT COUNT(*) total FROM users u LEFT JOIN platform_user_states ps ON ps.user_id=u.id WHERE ps.deleted_at IS NULL AND (u.name LIKE ? OR u.email LIKE ?)",
      ["%" + params.user_q + "%", "%" + params.user_q + "%"],
    ),
    query<any[]>(
      `SELECT u.id,u.name,u.email,u.active,u.created_at,ac.last_seen_at,EXISTS(SELECT 1 FROM platform_memberships pm WHERE pm.user_id=u.id) platform_admin FROM users u LEFT JOIN account_activity ac ON ac.user_id=u.id LEFT JOIN platform_user_states ps ON ps.user_id=u.id WHERE ps.deleted_at IS NULL AND (u.name LIKE ? OR u.email LIKE ?) ORDER BY ac.last_seen_at DESC,u.id DESC LIMIT 10 OFFSET ${10 * (params.user_page - 1)}`,
      ["%" + params.user_q + "%", "%" + params.user_q + "%"],
    ),
  ]);
  const now = Date.now(),
    byStore = new Map<number, any>();
  const rows = stores.map((s) => {
    const expired =
      !!s.expires_at && parseDateTime(s.expires_at, "utc").getTime() <= now;
    // Flag stale entitlements explicitly; GET reporting never activates periods,
    // issues invoices or sends reminders just to render a chart.
    const limits = json(s.limits);
    const usage = Object.fromEntries(
      usageKeys.map((k) => [
        k,
        quotaUsage(
          Number(s[k]),
          Number(
            limits[k] ??
              (k === "ai_messages"
                ? aiAllowance(s.plan_id, limits)
                : k === "email_sends"
                  ? defaultEmailLimit(s.plan_id)
                  : 0),
          ),
        ),
      ]),
    );
    const recent = [
      s.last_seen_at && parseDateTime(s.last_seen_at, "utc").getTime(),
      s.last_action_at && parseDateTime(s.last_action_at).getTime(),
      s.last_order_at && parseDateTime(s.last_order_at).getTime(),
    ].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const row = {
      ...s,
      limits: undefined,
      usage,
      expired: Boolean(expired),
      last_activity_at: recent.length
        ? new Date(Math.max(...recent)).toISOString()
        : null,
      period_orders: 0,
      period_gmv: 0,
      period_collected: 0,
    };
    byStore.set(Number(s.id), row);
    return row;
  });
  const daily = Array.from({ length: period.days }, (_, i) => ({
      day: hanoiDateKey(parseDateTime(period.from).getTime() + i * 86400000),
      orders_count: 0,
      gmv: 0,
      collected: 0,
      stores: 0,
    })),
    days = new Map(daily.map((d) => [d.day, d]));
  for (const o of orders) {
    const d = days.get(hanoiDateKey(o.day));
    if (d) {
      d.orders_count += Number(o.orders_count);
      d.gmv += Number(o.gmv);
    }
    const s = byStore.get(Number(o.store_id));
    if (s) {
      s.period_orders += Number(o.orders_count);
      s.period_gmv += Number(o.gmv);
    }
  }
  for (const r of receipts) {
    const d = days.get(hanoiDateKey(r.day));
    if (d) d.collected += Number(r.collected);
    const s = byStore.get(Number(r.store_id));
    if (s) s.period_collected += Number(r.collected);
  }
  for (const r of registrations) {
    const d = days.get(hanoiDateKey(r.day));
    if (d) d.stores = Number(r.stores);
  }
  const paid = rows.filter(
    (s) =>
      s.status === "approved" &&
      s.subscription_status === "active" &&
      Number(s.monthly_price) > 0 &&
      !s.expired &&
      Number(s.plan_id) !== 4,
  );
  const totals = daily.reduce(
    (a, d) => ({
      orders: a.orders + d.orders_count,
      gmv: a.gmv + d.gmv,
      collected: a.collected + d.collected,
      new_stores: a.new_stores + d.stores,
    }),
    { orders: 0, gmv: 0, collected: 0, new_stores: 0 },
  );
  const critical = rows.filter((s) =>
    Object.values(s.usage).some((u: any) => u.level !== "normal"),
  );
  const filtered = rows
    .filter(
      (s) =>
        (!params.plan || Number(s.plan_id) === params.plan) &&
        (!params.q ||
          `${s.name} ${s.owner_email}`
            .toLocaleLowerCase()
            .includes(params.q.toLocaleLowerCase())) &&
        (params.usage === "all" || critical.includes(s)),
    )
    .sort(
      (a, b) =>
        Math.max(...Object.values(b.usage).map((u: any) => u.percent)) -
          Math.max(...Object.values(a.usage).map((u: any) => u.percent)) ||
        b.id - a.id,
    );
  const memberships = users.length
    ? await query<any[]>(
        `SELECT m.user_id,m.role,s.id store_id,s.name store_name FROM store_memberships m JOIN stores s ON s.id=m.store_id WHERE m.status='active' AND m.user_id IN (${users.map(() => "?").join(",")}) ORDER BY s.name`,
        users.map((u) => u.id),
      )
    : [];
  return {
    period,
    generated_at: new Date().toISOString(),
    stats: {
      ...totals,
      stores: rows.length,
      pending: rows.filter((s) => s.status === "pending").length,
      approved: rows.filter((s) => s.status === "approved").length,
      suspended: rows.filter(
        (s) => s.status === "suspended" && !s.billing_suspended,
      ).length,
      paid: paid.length,
      mrr: paid.reduce((n, s) => n + Number(s.monthly_price), 0),
      free: rows.filter(
        (s) => s.subscription_status === "free" && Number(s.plan_id) === 4,
      ).length,
      trialing: rows.filter(
        (s) => s.subscription_status === "trialing" && !s.expired,
      ).length,
      near_limit: critical.length,
      expiring: rows.filter(
        (s) =>
          s.expires_at &&
          !s.expired &&
          parseDateTime(s.expires_at, "utc").getTime() - now <= 5 * 86400000,
      ).length,
      overdue: rows.filter((s) => Number(s.overdue_invoices) > 0).length,
      inactive: rows.filter(
        (s) =>
          s.status === "approved" &&
          s.last_activity_at &&
          parseDateTime(s.last_activity_at).getTime() < now - 14 * 86400000,
      ).length,
      needs_sync: rows.filter(
        (s) => s.expired && s.subscription_status !== "pending_activation",
      ).length,
      users: Number(userCounts[0].total),
      active_users_30d: Number(userCounts[0].active_30d || 0),
      new_users: Number(userCounts[0].new_users || 0),
    },
    health: health[0],
    daily,
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      stores: rows.filter((s) => Number(s.plan_id) === Number(p.id)).length,
      paid: paid.filter((s) => Number(s.plan_id) === Number(p.id)).length,
      mrr: paid
        .filter((s) => Number(s.plan_id) === Number(p.id))
        .reduce((n, s) => n + Number(s.monthly_price), 0),
    })),
    usage: {
      rows: filtered.slice((params.page - 1) * 10, params.page * 10),
      total: filtered.length,
      page: params.page,
      page_size: 10,
    },
    users: {
      rows: users.map((u) => ({
        ...u,
        memberships: memberships.filter((m) => m.user_id === u.id),
      })),
      total: Number(userTotal[0].total),
      page: params.user_page,
      page_size: 10,
    },
    top_stores: [...rows]
      .sort(
        (a, b) =>
          b.period_gmv - a.period_gmv || b.period_orders - a.period_orders,
      )
      .filter((s) => s.period_orders > 0)
      .slice(0, 8)
      .map((s) => ({
        id: s.id,
        name: s.name,
        orders: s.period_orders,
        gmv: s.period_gmv,
        collected: s.period_collected,
        last_activity_at: s.last_activity_at,
      })),
    filters: params,
  };
}
