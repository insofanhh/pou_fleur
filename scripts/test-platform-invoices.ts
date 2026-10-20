import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, query, mutate } from "../lib/db";
import { withSystem } from "../lib/tenant";
import { passwordHash } from "../lib/auth";
assert(
  process.env.MYSQL_DATABASE === "fleur_saas_test" &&
    process.env.MYSQL_PORT === "3310",
);
const origin = process.env.TEST_ORIGIN!,
  key = randomUUID().slice(0, 8),
  password = "Invoices-QA-2026-Only";
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
        origin,
        "content-type": "application/json",
        cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=");
      if (v) jar.set(k, v);
      else jar.delete(k);
    }
    const d = await r.json();
    assert.equal(r.status, status, path + ": " + JSON.stringify(d));
    return d;
  };
}
async function main() {
  return withSystem(async () => {
    const users: number[] = [],
      stores: number[] = [];
    async function person() {
      const api = client(),
        email = `invoices-${key}-${users.length}@example.test`;
      const r = await mutate(
        "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
        ["Invoice QA", email, passwordHash(password)],
      );
      users.push(r.insertId);
      await api("auth/login", "POST", { email, password });
      return { api, id: r.insertId, email };
    }
    try {
      const admin = await person(),
        owner = await person();
      await mutate("INSERT INTO platform_memberships(user_id) VALUES(?)", [
        admin.id,
      ]);
      for (let i = 0; i < 2; i++) {
        const s = await mutate(
          "INSERT INTO stores(slug,name,owner_id,status,address,settings,theme) VALUES(?,?,?,'approved','Ha Noi','{}','{}')",
          [`invoice-${key}-${i}`, `Invoice ${key} store ${i}`, owner.id],
        );
        stores.push(s.insertId);
        await mutate(
          "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')",
          [s.insertId, owner.id],
        );
      }
      const version = (
        await one(
          "SELECT id FROM plan_versions WHERE plan_id=2 ORDER BY id DESC LIMIT 1",
        )
      ).id;
      const starter = await one("SELECT name FROM plans WHERE id=1");
      await mutate(
        "INSERT INTO subscriptions(store_id,plan_id,status) VALUES(?,3,'active')",
        [stores[0]],
      );
      const ids: Record<string, number> = {};
      async function invoice(
        label: string,
        status: string,
        amount: number,
        paid: number,
        opts: any = {},
      ) {
        const r = await mutate(
          "INSERT INTO invoices(store_id,period_key,plan_name,plan_version_id,amount,paid,status,due_date,due_at,void_reason,created_at) VALUES(?,?,?,?,?,?,?,'2099-01-01',?,?,'2001-02-01 00:05:00')",
          [
            stores[0],
            `${key}-${label}`,
            opts.name || "Studio QA",
            opts.legacy ? null : version,
            amount,
            paid,
            status,
            opts.overdue ? "2001-01-01 00:00:00" : "2099-01-01 00:00:00",
            opts.reason || null,
          ],
        );
        ids[label] = r.insertId;
        return r.insertId;
      }
      await invoice("open", "open", 100, 0);
      await invoice("partial", "open", 100, 25);
      await invoice("overdue", "open", 100, 10, { overdue: true });
      await invoice("paid", "paid", 100, 100);
      await invoice("void", "void", 100, 0);
      await invoice("timeout", "void", 100, 0, { reason: "payment_timeout" });
      await invoice("legacy", "paid", 100, 100, {
        legacy: true,
        name: starter.name,
      });
      const freeversion = (
        await one(
          "SELECT id FROM plan_versions WHERE plan_id=4 ORDER BY id DESC LIMIT 1",
        )
      ).id;
      await invoice("free", "paid", 0, 0);
      await mutate("UPDATE invoices SET plan_version_id=? WHERE id=?", [
        freeversion,
        ids.free,
      ]);
      await mutate(
        "INSERT INTO billing_payments(invoice_id,reference,amount,actor_id,received_at) VALUES(?,?,25,?,'2001-01-31 17:05:00')",
        [ids.partial, `TX-${key}-unique`, admin.id],
      );
      await client()("platform/invoices?view=list", "GET", undefined, 401);
      await owner.api("platform/invoices?view=list", "GET", undefined, 403);
      await owner.api(`platform/invoices/${ids.open}`, "GET", undefined, 403);
      check(true, "Invoice list and details require platform admin");
      const list = (suffix = "") =>
        admin.api(`platform/invoices?view=list&q=${key}${suffix}`);
      let r = await list();
      check(
        r.total === 8 &&
          r.rows.length === 8 &&
          Number(r.summary.outstanding) === 265 &&
          Number(r.summary.paid) === 235 &&
          Number(r.summary.overdue) === 1,
        "Filtered summary counts every matching invoice and excludes void debt",
      );
      const statuses = Object.fromEntries(
        r.rows.map((i: any) => [i.id, i.display_status]),
      );
      check(
        statuses[ids.open] === "open" &&
          statuses[ids.partial] === "partially_paid" &&
          statuses[ids.overdue] === "overdue" &&
          statuses[ids.timeout] === "payment_timeout" &&
          statuses[ids.free] === "free",
        "Status labels distinguish partial, overdue, Free and timed out invoices",
      );
      check(
        r.rows.find((i: any) => i.id === ids.partial).can_pay &&
          !r.rows.find((i: any) => i.id === ids.partial).can_void &&
          !r.rows.find((i: any) => i.id === ids.free).can_void,
        "Available actions protect partial payments and Free invoices",
      );
      check(
        (
          await admin.api(
            `platform/invoices?view=list&q=HD-${String(ids.open).padStart(6, "0")}`,
          )
        ).rows[0].id === ids.open,
        "Search accepts displayed invoice code",
      );
      check(
        (await admin.api(`platform/invoices?view=list&q=TX-${key}-unique`))
          .rows[0].id === ids.partial,
        "Search finds actual receipt references",
      );
      check(
        (
          await admin.api(
            `platform/invoices?view=list&q=${encodeURIComponent(owner.email)}`,
          )
        ).total === 8,
        "Search finds owner email",
      );
      check(
        (await list("&status=partially_paid")).total === 2 &&
          (await list("&status=overdue")).total === 1 &&
          (await list("&status=void")).total === 1 &&
          (await list("&status=payment_timeout")).total === 1,
        "Overdue partial belongs to both debt filters while cancelled and timed-out filters remain distinct",
      );
      check(
        (await list("&status=open")).total === 3 &&
          (await list("&status=paid")).total === 2 &&
          (await list("&status=free")).total === 1,
        "Open includes all outstanding states; Free stays separate from paid",
      );
      check(
        (await list("&plan=2")).total === 6 &&
          (await list("&plan=1")).total === 1,
        "Plan filter uses historical invoice version and legacy name, not the current store subscription",
      );
      check(
        (await list("&from=2001-02-01&to=2001-02-01")).total === 8 &&
          (await list("&from=2001-01-31&to=2001-01-31")).total === 0,
        "Created-date filter follows Hanoi calendar boundaries",
      );
      for (const bad of [
        "status=invalid",
        "sort=DROP",
        "page=0",
        "plan=-1",
        "from=2001-02-30&to=2001-03-01",
        "from=2001-01-01",
        "from=2001-01-01&to=2003-01-01",
      ])
        await admin.api(
          `platform/invoices?view=list&${bad}`,
          "GET",
          undefined,
          400,
        );
      check(
        true,
        "Invalid filters, pages and incomplete/excessive date ranges fail safely",
      );
      const detail = await admin.api(`platform/invoices/${ids.partial}`);
      check(
        detail.payments.length === 1 &&
          detail.payments[0].reference === `TX-${key}-unique` &&
          detail.invoice.plan_id === 2,
        "Details show invoice snapshot and receipt ledger",
      );
      check(
        !JSON.stringify(detail).includes("password_hash") &&
          !JSON.stringify(detail).includes("api_key"),
        "Invoice details contain no authentication or integration secrets",
      );
      await admin.api("platform/invoices/2147483647", "GET", undefined, 404);
      check(true, "Unknown invoice returns 404");
      await admin.api(
        `platform/invoices/${ids.partial}/void`,
        "POST",
        { reason: "Cannot remove received money" },
        409,
      );
      await admin.api(
        `platform/invoices/${ids.free}/void`,
        "POST",
        { reason: "Cannot void activated Free" },
        409,
      );
      check(true, "Server rejects voiding received or activated Free invoices");
      await admin.api(`platform/invoices/${ids.open}/payment`, "POST", {
        amount: 10,
        reference: `MANUAL-${key}`,
      });
      await admin.api(`platform/invoices/${ids.open}/payment`, "POST", {
        amount: 10,
        reference: `MANUAL-${key}`,
      });
      check(
        Number(
          (await one("SELECT paid FROM invoices WHERE id=?", [ids.open])).paid,
        ) === 10 &&
          (
            await one(
              "SELECT COUNT(*) n FROM billing_payments WHERE reference=?",
              [`MANUAL-${key}`],
            )
          ).n === 1,
        "Manual receipt remains idempotent with the same transaction code",
      );
      await admin.api(
        `platform/invoices/${ids.open}/payment`,
        "POST",
        { amount: 100, reference: `OVER-${key}` },
        409,
      );
      check(true, "Manual receipts cannot exceed remaining balance");
      await invoice("cancel", "open", 100, 0);
      await admin.api(`platform/invoices/${ids.cancel}/void`, "POST", {
        reason: "Invoice QA cancellation",
      });
      check(
        (await one("SELECT status FROM invoices WHERE id=?", [ids.cancel]))
          .status === "void",
        "Existing cancellation action remains functional",
      );
      const c = await pool.getConnection();
      try {
        const values = Array.from({ length: 505 }, (_, i) => [
          stores[1],
          `${key}-bulk-${i}`,
          "QA bulk",
          1,
          1,
          "paid",
          "2099-01-01",
        ]);
        await c.query(
          "INSERT INTO invoices(store_id,period_key,plan_name,amount,paid,status,due_date) VALUES ?",
          [values],
        );
      } finally {
        c.release();
      }
      r = await list("&sort=oldest");
      check(
        r.total > 500 && r.rows.length === 20 && Number(r.summary.paid) >= 740,
        "Server pagination and aggregate summaries include invoices beyond the old 500-row cap",
      );
      const last = await list("&page=999");
      check(
        last.page === Math.ceil(last.total / 20) && last.rows.length > 0,
        "Out-of-range pages clamp to the last valid page",
      );
      const balance = await list("&sort=balance");
      check(
        Number(balance.rows[0].balance) >= Number(balance.rows[1].balance),
        "Outstanding amount sort prioritizes open debt",
      );
      console.log(`${checks} platform invoice checks passed`);
    } finally {
      for (const sid of stores) {
        await mutate(
          "DELETE bp FROM billing_payments bp JOIN invoices i ON i.id=bp.invoice_id WHERE i.store_id=?",
          [sid],
        );
        for (const table of [
          "email_outbox",
          "payment_intents",
          "audit_logs",
          "invoices",
          "subscriptions",
          "store_memberships",
        ])
          await mutate(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
        await mutate("DELETE FROM stores WHERE id=?", [sid]);
      }
      for (const uid of users) {
        await mutate("DELETE FROM platform_memberships WHERE user_id=?", [uid]);
        await mutate("DELETE FROM sessions WHERE user_id=?", [uid]);
        await mutate("DELETE FROM users WHERE id=?", [uid]);
      }
    }
  });
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
