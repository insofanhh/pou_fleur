import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, query, mutate } from "../lib/db";
import { withSystem, withStore } from "../lib/tenant";
import { passwordHash } from "../lib/auth";
import { quotaUsage } from "../lib/platform-overview";
import { migratePlatformOverview } from "./platform-overview-schema.mjs";
const key = randomUUID().slice(0, 8),
  origin = process.env.TEST_ORIGIN!,
  password = "Overview-QA-2026-Only";
assert(
  process.env.MYSQL_DATABASE === "fleur_saas_test" &&
    process.env.MYSQL_PORT === "3310",
);
let checks = 0;
const check = (v: unknown, t: string) => {
  assert(v, t);
  checks++;
  console.log("PASS", t);
};
const one = async (sql: string, args: any[] = []) =>
  (await query<any[]>(sql, args))[0];
function client() {
  const jar = new Map<string, string>();
  return async (path: string, method = "GET", body?: any, status = 200) => {
    const r = await fetch(origin + "/api/" + path, {
      method,
      headers: {
        cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
        origin,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=");
      if (!v || /Max-Age=0/i.test(c)) jar.delete(k);
      else jar.set(k, v);
    }
    const d = await r.json();
    assert.equal(r.status, status, path + ": " + JSON.stringify(d));
    return d;
  };
}
async function main() {
  return withSystem(async () => {
    const c = await pool.getConnection();
    try {
      await migratePlatformOverview(c);
      await migratePlatformOverview(c);
    } finally {
      c.release();
    }
    const users: number[] = [],
      stores: number[] = [],
      versions: number[] = [];
    async function person() {
      const api = client(),
        email = `overview-${key}-${users.length}@example.test`;
      const r = await mutate(
        "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
        ["Overview QA", email, passwordHash(password)],
      );
      users.push(r.insertId);
      await api("auth/login", "POST", { email, password });
      return { api, id: r.insertId };
    }
    try {
      const admin = await person(),
        customer = await person();
      await mutate("INSERT INTO platform_memberships(user_id) VALUES(?)", [
        admin.id,
      ]);
      await client()("platform/overview", "GET", undefined, 401);
      await customer.api("platform/overview", "GET", undefined, 403);
      check(true, "Overview requires a signed-in platform admin");
      await client()("activity", "POST", {}, 401);
      check(true, "Anonymous activity cannot be recorded");
      const limits = {
        products: 10,
        staff: 3,
        storage_mb: 100,
        email_sends: 50,
        ai_messages: 10,
      };
      async function store(
        pid: number,
        status = "approved",
        substatus = "active",
        price = 139000,
      ) {
        const v = await mutate(
          "INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) VALUES(?,?,?,?,0,UTC_TIMESTAMP())",
          [pid, `QA ${pid}`, price, JSON.stringify(limits)],
        );
        versions.push(v.insertId);
        const s = await mutate(
          "INSERT INTO stores(slug,name,owner_id,status,address,settings,theme,created_at) VALUES(?,?,?,?,?,'{}','{}','2001-02-01 00:05:00')",
          [
            `overview-${key}-${stores.length}`,
            `Overview store ${key} ${stores.length}`,
            customer.id,
            status,
            "Ha Noi",
          ],
        );
        stores.push(s.insertId);
        await mutate(
          "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')",
          [s.insertId, customer.id],
        );
        await mutate(
          "INSERT INTO subscriptions(store_id,plan_id,plan_version_id,status,billing_policy,access_started_at,access_ends_at) VALUES(?,?,?,?,1,UTC_TIMESTAMP(),?)",
          [
            s.insertId,
            pid,
            v.insertId,
            substatus,
            pid === 4 ? null : "2099-01-01 00:00:00",
          ],
        );
        return s.insertId;
      }
      const free = await store(4, "approved", "free", 0),
        paid = await store(2),
        trial = await store(1, "approved", "trialing"),
        frozen = await store(3, "suspended");
      const before = await admin.api(
        "platform/overview?from=2001-02-01&to=2001-02-03",
      );
      check(
        before.daily.length === 3 && before.daily[0].stores === 4,
        "Report zero-fills each Hanoi calendar day and counts registrations",
      );
      const invoice = await mutate(
        "INSERT INTO invoices(store_id,period_key,plan_name,amount,paid,status,due_date) VALUES(?,'overview-qa','QA',300,300,'paid','2001-02-01')",
        [paid],
      );
      await mutate(
        "INSERT INTO billing_payments(invoice_id,reference,amount,actor_id,created_at,received_at) VALUES(?,?,100,?,'2001-02-01 00:05:00',NULL),(?,?,200,?,'2001-02-02 02:00:00','2001-02-01 16:59:59')",
        [
          invoice.insertId,
          `overview-${key}-1`,
          admin.id,
          invoice.insertId,
          `overview-${key}-2`,
          admin.id,
        ],
      );
      for (const [state, total] of [
        ["delivered", 1000],
        ["delivered", 2000],
        ["cancelled", 9000],
      ] as const)
        await mutate(
          "INSERT INTO orders(store_id,reference,customer_name,email,phone,address,recipient_name,recipient_phone,delivery_date,delivery_slot,payment_method,status,subtotal,total,idempotency_key,created_at) VALUES(?,?,'QA','qa@example.test','0900000000','Ha Noi','QA','0900000000','2001-02-01','AM','cod',?,?,?,?,'2001-02-01 12:00:00')",
          [
            paid,
            `OV-${key}-${total}`,
            state,
            total,
            total,
            `ov-${key}-${total}`,
          ],
        );
      const category = await mutate(
        "INSERT INTO categories(store_id,name,slug) VALUES(?,'QA',?)",
        [free, `ov-${key}`],
      );
      for (let i = 0; i < 9; i++)
        await mutate(
          "INSERT INTO products(store_id,name,slug,category_id,price,active,image,description,flowers,care) VALUES(?,'QA',?,?,100,1,'','','','')",
          [free, `ov-${key}-${i}`, category.insertId],
        );
      await mutate(
        "INSERT INTO assets(store_id,url,size) VALUES(?,'qa-only',1048576)",
        [free],
      );
      await mutate(
        "INSERT INTO email_outbox(store_id,dedupe_key,template_key,kind,recipient,subject,body,status,quota_at) VALUES(?,?,'order_confirmation','transactional','qa@example.test','QA','QA','sent',UTC_TIMESTAMP()),(?,?,'subscription_registered','transactional','qa@example.test','QA','QA','sent',UTC_TIMESTAMP())",
        [free, `ov-${key}-mail`, free, `ov-${key}-system`],
      );
      await customer.api("activity", "POST", { store_id: free });
      const ac = await one(
        "SELECT last_seen_at FROM account_activity WHERE user_id=?",
        [customer.id],
      );
      await customer.api("activity", "POST", { store_id: free });
      check(
        (
          await one(
            "SELECT last_seen_at FROM account_activity WHERE user_id=?",
            [customer.id],
          )
        ).last_seen_at === ac.last_seen_at,
        "Repeated activity is throttled to one timestamp update per minute",
      );
      await admin.api("activity", "POST", { store_id: free }, 403);
      check(true, "Activity cannot be forged for another store");
      await admin.api(`platform/stores/${paid}/ghost`, "POST", {
        reason: "Kiểm thử không ghi nhận hoạt động khi hỗ trợ",
      });
      await admin.api("activity", "POST", { store_id: paid });
      await admin.api("auth/ghost/stop", "POST", {});
      check(
        !(await one("SELECT * FROM workspace_activity WHERE store_id=?", [
          paid,
        ])),
        "Ghost support does not make the store appear recently active",
      );
      await mutate(
        "INSERT INTO audit_logs(store_id,action,entity,entity_id) VALUES(?,'subscription_free_fallback','subscriptions',?), (?,'subscription_free_fallback','subscriptions',?)",
        [trial, String(trial), frozen, String(frozen)],
      );
      await mutate(
        "INSERT INTO audit_logs(store_id,user_id,action,entity,entity_id) VALUES(?,?,'account_trial_brought_forward','subscriptions',?)",
        [trial, customer.id, String(trial)],
      );
      check(
        (
          await withStore(paid, () =>
            query<any[]>("SELECT * FROM workspace_activity"),
          )
        ).length === 0,
        "Workspace activity obeys tenant SQL isolation",
      );
      const report = await admin.api(
        `platform/overview?from=2001-02-01&to=2001-02-03&q=${key}`,
      );
      check(
        report.stats.collected === Number(before.stats.collected) + 300 &&
          report.stats.gmv === Number(before.stats.gmv) + 3000 &&
          report.stats.orders === Number(before.stats.orders) + 3,
        "Multiple receipts do not multiply GMV; cancelled orders are excluded from GMV",
      );
      check(
        report.daily[0].collected === 300 && report.daily[1].collected === 0,
        "Receipt ledger respects Hanoi day boundaries",
      );
      const s = report.usage.rows.find((s: any) => s.id === free);
      check(
        s.usage.products.used === 9 &&
          s.usage.products.limit === 10 &&
          s.usage.products.level === "near",
        "Usage reads granted plan-version quota and classifies 90% as near limit",
      );
      check(
        s.usage.staff.used === 1 &&
          s.usage.storage_mb.used === 1 &&
          s.usage.email_sends.used === 1,
        "Usage counts owner, actual storage and store email only",
      );
      check(
        !!s.last_seen_at && !!s.last_activity_at,
        "Workspace interaction supplies real last activity",
      );
      check(
        !report.usage.rows.find((s: any) => s.id === trial).last_activity_at &&
          !report.usage.rows.find((s: any) => s.id === frozen).last_activity_at,
        "Automatic billing and trial reconciliation do not count as merchant activity",
      );
      const mrr = report.stats.mrr;
      await mutate(
        "UPDATE subscriptions SET status='trialing' WHERE store_id=?",
        [paid],
      );
      const trialReport = await admin.api(
        "platform/overview?from=2001-02-01&to=2001-02-03",
      );
      check(
        mrr - trialReport.stats.mrr === 139000,
        "MRR excludes Free, trial and manually frozen stores and uses snapshot price",
      );
      await admin.api(
        "platform/overview?from=2001-02-30&to=2001-03-02",
        "GET",
        undefined,
        400,
      );
      await admin.api(
        "platform/overview?from=2001-01-01&to=2003-01-01",
        "GET",
        undefined,
        400,
      );
      await admin.api("platform/overview?page=0", "GET", undefined, 400);
      check(
        true,
        "Invalid dates, excessive ranges and invalid pagination are rejected",
      );
      const near = await admin.api(`platform/overview?q=${key}&usage=near`);
      check(
        near.usage.total === 1 && near.usage.rows[0].id === free,
        "Near-limit filter and total agree",
      );
      const other = await admin.api(`platform/overview?q=${key}&plan=2`);
      check(
        other.usage.total === 1 && other.usage.rows[0].id === paid,
        "Plan and store search filters combine correctly",
      );
      const accounts = await admin.api(
        `platform/overview?user_q=overview-${key}`,
      );
      check(
        accounts.users.total === 2 &&
          accounts.users.rows.find((u: any) => u.id === customer.id).memberships
            .length === 4,
        "Account table reports role/store memberships and server pagination totals",
      );
      check(
        !JSON.stringify(accounts).includes("password_hash") &&
          !JSON.stringify(accounts).includes("token_hash"),
        "Overview never exposes account credentials",
      );
      check(
        quotaUsage(2, 1).level === "over" &&
          quotaUsage(1, 1).level === "full" &&
          quotaUsage(0, 0).percent === 0,
        "Quota edge cases cover exceeded, full and disabled allowances",
      );
      check(
        report.top_stores.some(
          (s: any) => s.id === paid && s.gmv === 3000 && s.collected === 300,
        ),
        "Top stores separate merchant GMV from platform receipts",
      );
      const stamp = await one(
        "SELECT last_seen_at FROM account_activity WHERE user_id=?",
        [customer.id],
      );
      check(
        stamp.last_seen_at === ac.last_seen_at,
        "Reading reports and auth checks does not generate user presence",
      );
      await mutate(
        "UPDATE subscriptions SET access_ends_at='2001-01-01 00:00:00' WHERE store_id=?",
        [paid],
      );
      const invoicesBefore = await one(
        "SELECT COUNT(*) n FROM invoices WHERE store_id=?",
        [paid],
      );
      await admin.api("platform/overview");
      check(
        (
          await one("SELECT plan_id FROM subscriptions WHERE store_id=?", [
            paid,
          ])
        ).plan_id === 2 &&
          (
            await one("SELECT COUNT(*) n FROM invoices WHERE store_id=?", [
              paid,
            ])
          ).n === invoicesBefore.n,
        "Reporting expired grants does not reconcile subscriptions or generate invoices",
      );
      console.log(`${checks} platform overview checks passed`);
    } finally {
      for (const sid of stores) {
        await mutate(
          "DELETE bp FROM billing_payments bp JOIN invoices i ON i.id=bp.invoice_id WHERE i.store_id=?",
          [sid],
        );
        for (const t of [
          "audit_logs",
          "email_outbox",
          "assets",
          "products",
          "categories",
          "orders",
          "invoices",
          "subscriptions",
          "store_memberships",
        ])
          await mutate(`DELETE FROM ${t} WHERE store_id=?`, [sid]);
        await mutate("DELETE FROM stores WHERE id=?", [sid]);
      }
      for (const uid of users) {
        await mutate(
          "DELETE FROM ghost_sessions WHERE actor_id=? OR target_id=?",
          [uid, uid],
        );
        await mutate(
          "DELETE FROM platform_audit_logs WHERE actor_id=? OR target_id=?",
          [uid, uid],
        );
        await mutate("DELETE FROM platform_memberships WHERE user_id=?", [uid]);
        await mutate("DELETE FROM sessions WHERE user_id=?", [uid]);
        await mutate("DELETE FROM users WHERE id=?", [uid]);
      }
      for (const vid of versions)
        await mutate("DELETE FROM plan_versions WHERE id=?", [vid]);
    }
  });
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
