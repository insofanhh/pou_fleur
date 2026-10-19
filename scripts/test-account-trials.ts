import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { pool, query, mutate } from "../lib/db";
import { withSystem } from "../lib/tenant";
import { passwordHash } from "../lib/auth";
import {
  captureRegistrationPlan,
  activateApprovedStore,
  previewAccountTrial,
  reserveAccountTrial,
  refreshBillingAccess,
  advanceBilling,
  prepareSubscriptionInvoice,
  recordInvoicePayment,
  accountTrialAvailability,
} from "../lib/billing";
assert(
  process.env.MYSQL_DATABASE === "fleur_saas_test" &&
    process.env.MYSQL_PORT === "3310",
  "Isolated QA database only",
);
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3005",
  key = randomUUID().slice(0, 8),
  password = "Account-Trials-QA-2026";
let checks = 0;
function check(value: unknown, label: string) {
  assert(value, label);
  checks++;
  console.log("PASS", label);
}
const one = async (sql: string, args: any[] = []) =>
  (await query<any[]>(sql, args))[0];
async function tx<T>(fn: (c: any) => Promise<T>) {
  const c = await pool.getConnection();
  try {
    await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
function client() {
  let cookie = "";
  return async (
    path: string,
    method = "GET",
    body?: any,
    sid = 1,
    status = 200,
  ) => {
    const r = await fetch(origin + "/api/" + path, {
      method,
      headers: {
        origin,
        "content-type": "application/json",
        "x-fleur-store": String(sid),
        cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; ");
    const data = await r.json();
    assert.equal(r.status, status, path + ": " + JSON.stringify(data));
    return data;
  };
}
async function main() {
  return withSystem(async () => {
    const users: number[] = [],
      stores: number[] = [],
      plans: number[] = [];
    async function person() {
      const email = `account-${key}-${users.length}@example.test`;
      const r = await mutate(
        "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
        ["Account Trial QA", email, passwordHash(password)],
      );
      users.push(r.insertId);
      return { id: r.insertId, email };
    }
    async function plan(name: string, days: number, price: number) {
      const next = await one("SELECT COALESCE(MAX(id),0)+1 id FROM plans");
      const r = await mutate(
        "INSERT INTO plans(id,name,monthly_price,limits,trial_days) VALUES(?,?,?,?,?)",
        [
          next.id,
          name,
          price,
          JSON.stringify({ products: 100, staff: 10, storage_mb: 1000 }),
          days,
        ],
      );
      r.insertId = next.id;
      plans.push(r.insertId);
      await mutate(
        "INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) SELECT id,name,monthly_price,limits,trial_days,UTC_TIMESTAMP() FROM plans WHERE id=?",
        [r.insertId],
      );
      return r.insertId;
    }
    async function store(uid: number, pid = 1, activate = true) {
      const r = await mutate(
        "INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,?,?,?,'{}','{}')",
        [
          `account-${key}-${stores.length}`,
          "Account Trial Store",
          uid,
          activate ? "approved" : "pending",
        ],
      );
      stores.push(r.insertId);
      await mutate(
        "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')",
        [r.insertId, uid],
      );
      await mutate("INSERT INTO subscriptions(store_id,plan_id) VALUES(?,?)", [
        r.insertId,
        pid,
      ]);
      await tx(async (c) => {
        await captureRegistrationPlan(c, r.insertId, pid);
        if (activate) await activateApprovedStore(c, r.insertId);
      });
      return r.insertId;
    }
    async function quote(sid: number, pid: number, uid: number) {
      const c = await pool.getConnection();
      try {
        await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
        await c.beginTransaction();
        const q = await previewAccountTrial(c, sid, pid, uid);
        await c.rollback();
        return q;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    }
    const reserve = (sid: number, pid: number, uid: number, q: any) =>
      tx((c) => reserveAccountTrial(c, sid, pid, uid, q.token, q.expires_at));
    try {
      const studio = await plan("Studio trải nghiệm QA " + key, 3, 129000),
        atelier = await plan("Atelier trải nghiệm QA " + key, 5, 259000);
      const owner = await person(),
        s = await store(owner.id, 1, false);
      const starterConfig = Number((await one("SELECT trial_days FROM plans WHERE id=1")).trial_days);
      const held = await one(
        "SELECT * FROM account_trial_claims WHERE user_id=? AND bucket='starter'",
        [owner.id],
      );
      check(
        held && !held.starts_at && !held.ends_at,
        "Registration reserves starter slot without starting its clock",
      );
      const second = await store(owner.id, 1, false);
      check(
        (
          await one(
            "SELECT trial_days_granted FROM subscriptions WHERE store_id=?",
            [second],
          )
        ).trial_days_granted === 0,
        "Another store cannot reserve the same account slot",
      );
      await mutate("UPDATE stores SET status='approved' WHERE id=?", [s]);
      await tx((c) => activateApprovedStore(c, s));
      let sub = await one("SELECT * FROM subscriptions WHERE store_id=?", [s]);
      const originalEnd = sub.trial_ends_at;
      check(
        sub.status === "trialing" && sub.active_trial_bucket === "starter",
        "Approval starts reserved starter trial",
      );
      check(
        Number(sub.trial_days_granted) === starterConfig,
        "Starter onboarding trial uses the platform-configured duration",
      );
      await tx((c) => activateApprovedStore(c, s));
      check(
        (
          await one(
            "SELECT trial_ends_at FROM subscriptions WHERE store_id=?",
            [s],
          )
        ).trial_ends_at === originalEnd,
        "Repeated approval never resets trial",
      );
      await mutate("UPDATE stores SET status='approved' WHERE id=?", [second]);
      await tx((c) => activateApprovedStore(c, second));
      check(
        (
          await one("SELECT status FROM subscriptions WHERE store_id=?", [
            second,
          ])
        ).status !== "trialing",
        "Second store receives normal billing instead of duplicated trial",
      );
      check(
        (await accountTrialAvailability(owner.id)).available === 1,
        "Account exposes one remaining shared discovery slot",
      );
      const before = JSON.stringify(
        await query("SELECT * FROM account_trial_claims WHERE user_id=?", [
          owner.id,
        ]),
      );
      const q = await quote(s, studio, owner.id),
        alternative = await quote(s, atelier, owner.id);
      await assert.rejects(
        () => quote(s, 1, owner.id),
        /tự động theo số ngày admin cấu hình/,
      );
      check(true, "Starter trial cannot be selected again from workspace");
      check(
        before ===
          JSON.stringify(
            await query("SELECT * FROM account_trial_claims WHERE user_id=?", [
              owner.id,
            ]),
          ),
        "Trial preview does not consume a slot",
      );
      check(
        q.starts_at === originalEnd && q.amount_due === 0 && q.trial_days === 3,
        "Discovery trial follows current entitlement with zero amount due",
      );
      await assert.rejects(
        () => reserve(s, studio, owner.id, { ...q, token: "0".repeat(64) }),
        /thay đổi/,
      );
      check(
        (await accountTrialAvailability(owner.id)).available === 1,
        "Invalid confirmation leaves account entitlement untouched",
      );
      const api = client();
      await api("auth/login", "POST", { email: owner.email, password });
      const apiQuote = await api(
        "workspace/billing/preview",
        "POST",
        { plan_id: studio, trial: true },
        s,
      );
      if (process.argv.includes("--ui")) {
        const { chromium, expect } = await import("@playwright/test");
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({
            viewport: { width: 390, height: 844 },
            reducedMotion: "reduce",
          });
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(origin + "/login");
          await page.locator("input[type=email]:visible").fill(owner.email);
          await page.locator("input[type=password]:visible").fill(password);
          await page
            .getByRole("button", { name: "Đăng nhập", exact: true })
            .click();
          await page.waitForURL(/workspace|platform|admin/);
          await page.goto(origin + `/workspace/${s}/billing`);
          const card = page.locator(".billing-plan-card").filter({
            has: page.getByRole("heading", {
              name: "Studio trải nghiệm QA " + key,
              exact: true,
            }),
          });
          await card
            .getByRole("button", { name: "Dùng thử 3 ngày", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Studio trải nghiệm QA " + key,
          });
          await expect(
            dialog.getByRole("button", { name: "Xác nhận dùng thử" }),
          ).toBeVisible();
          await expect(
            dialog.getByText(/Không tự trích tiền/).first(),
          ).toBeVisible();
          await mkdir(".local/account-trial-qa", { recursive: true });
          await page.screenshot({
            path: ".local/account-trial-qa/mobile-preview.png",
          });
          check(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "Mobile trial preview fits viewport",
          );
          await dialog
            .getByRole("button", { name: "Xác nhận dùng thử" })
            .click();
          await expect(dialog).toHaveCount(0);
          await expect(
            page.getByText(/Đã đặt lịch dùng thử Studio/),
          ).toBeVisible();
          await expect(
            card.getByRole("button", { name: "Dùng thử 3 ngày", exact: true }),
          ).toHaveCount(0);
          await page.screenshot({
            path: ".local/account-trial-qa/mobile-reserved.png",
          });
          check(
            !errors.length,
            "Trial confirmation updates shared slot and schedule without browser errors",
          );
        } finally {
          await browser.close();
        }
      } else
        await api(
          "workspace/billing/start",
          "POST",
          {
            plan_id: studio,
            trial: true,
            quote_token: apiQuote.token,
            quote_expires_at: apiQuote.expires_at,
          },
          s,
        );
      let claim = await one(
        "SELECT * FROM account_trial_claims WHERE user_id=? AND bucket='discovery'",
        [owner.id],
      );
      check(
        claim.plan_id === studio &&
          claim.starts_at === originalEnd &&
          !claim.activated_at,
        "Confirmation reserves discovery once without replacing current trial",
      );
      check(
        (
          await one(
            "SELECT plan_id,trial_ends_at FROM subscriptions WHERE store_id=?",
            [s],
          )
        ).trial_ends_at === originalEnd,
        "Starter end is retained after discovery reservation",
      );
      await assert.rejects(
        () => reserve(s, atelier, owner.id, alternative),
        /đã dùng/,
      );
      check(
        (await accountTrialAvailability(owner.id)).available === 0,
        "Studio and Atelier share the same account trial slot",
      );
      await assert.rejects(() => quote(second, atelier, owner.id), /đã dùng/);
      check(true, "New store cannot bypass a discovery claim");
      const intruder = await person();
      await assert.rejects(() => quote(s, atelier, intruder.id), /Chỉ chủ/);
      check(true, "Another account cannot claim trial for this store");
      await mutate(
        "UPDATE plans SET trial_days=9,monthly_price=199000 WHERE id=?",
        [studio],
      );
      await mutate(
        "INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) SELECT id,name,monthly_price,limits,trial_days,UTC_TIMESTAMP() FROM plans WHERE id=?",
        [studio],
      );
      check(
        (
          await one(
            "SELECT trial_days,ends_at FROM account_trial_claims WHERE user_id=? AND bucket='discovery'",
            [owner.id],
          )
        ).trial_days === 3,
        "Catalog changes preserve days and price snapshot already reserved",
      );
      // Move both adjacent boundaries together to exercise exact activation without waiting days.
      await mutate(
        "UPDATE subscriptions SET access_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),trial_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE store_id=?",
        [s],
      );
      await mutate(
        "UPDATE account_trial_claims SET starts_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 4 DAY) WHERE user_id=? AND bucket='discovery'",
        [owner.id],
      );
      await advanceBilling(s);
      let inv = await one(
        "SELECT * FROM invoices WHERE store_id=? AND status='open' ORDER BY id DESC LIMIT 1",
        [s],
      );
      claim = await one(
        "SELECT * FROM account_trial_claims WHERE user_id=? AND bucket='discovery'",
        [owner.id],
      );
      check(
        inv.amount === 129000 &&
          inv.starts_at === claim.ends_at &&
          inv.purpose === "renewal",
        "Worker bills selected discovery package after trial using promised price",
      );
      await mutate(
        "UPDATE account_trial_claims SET starts_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 DAY) WHERE user_id=? AND bucket='discovery'",
        [owner.id],
      );
      await mutate(
        "UPDATE subscriptions SET access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE store_id=?",
        [s],
      );
      await refreshBillingAccess(s);
      sub = await one("SELECT * FROM subscriptions WHERE store_id=?", [s]);
      check(
        sub.plan_id === studio &&
          sub.status === "trialing" &&
          sub.trial_days_granted === 3,
        "Scheduled discovery activates at boundary without resetting duration",
      );
      await refreshBillingAccess(s);
      check(
        (
          await one(
            "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key=?",
            [s, "subscription_trial_started"],
          )
        ).n === 2,
        "Each started trial queues exactly one welcome email",
      );
      await mutate(
        "UPDATE subscriptions SET access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE store_id=?",
        [s],
      );
      await refreshBillingAccess(s);
      check(
        (await one("SELECT billing_suspended FROM stores WHERE id=?", [s]))
          .billing_suspended === 1,
        "Unpaid discovery expiry freezes operations",
      );
      check(
        (await accountTrialAvailability(owner.id)).available === 0,
        "Expiry does not restore trial slots",
      );

      const paidOwner = await person(),
        paidStore = await store(paidOwner.id);
      let paidInvoice: any;
      await tx(async (c) => {
        paidInvoice = await prepareSubscriptionInvoice(c, paidStore, studio);
        await recordInvoicePayment(
          c,
          paidInvoice.id,
          paidInvoice.amount,
          `account-paid-${key}`,
          paidOwner.id,
        );
      });
      const paidPeriod = await one("SELECT * FROM invoices WHERE id=?", [
        paidInvoice.id,
      ]);
      const paidQuote = await quote(paidStore, atelier, paidOwner.id);
      check(
        paidQuote.starts_at === paidPeriod.effective_end_at,
        "New trial starts after every purchased period",
      );
      await reserve(paidStore, atelier, paidOwner.id, paidQuote);
      check(
        (
          await one("SELECT status,paid FROM invoices WHERE id=?", [
            paidInvoice.id,
          ])
        ).paid === paidInvoice.amount,
        "Trial reservation preserves cash-paid invoice and ledger",
      );
      const partialOwner = await person(),
        partialStore = await store(partialOwner.id);
      await tx(async (c) => {
        const i = await prepareSubscriptionInvoice(c, partialStore, studio);
        await recordInvoicePayment(
          c,
          i.id,
          100,
          `account-partial-${key}`,
          partialOwner.id,
        );
      });
      await assert.rejects(
        () => quote(partialStore, atelier, partialOwner.id),
        /một phần/,
      );
      check(
        (await accountTrialAvailability(partialOwner.id)).available === 1,
        "Partial receipts block trial replacement without consuming slot",
      );
      const frozenOwner = await person(),
        frozenStore = await store(frozenOwner.id);
      await mutate(
        "UPDATE stores SET status='suspended',billing_suspended=0,suspension_reason='QA freeze' WHERE id=?",
        [frozenStore],
      );
      await assert.rejects(
        () => quote(frozenStore, studio, frozenOwner.id),
        /đóng băng/,
      );
      check(true, "Trial cannot bypass manual platform suspension");
      const expiredOwner = await person(),
        expiredStore = await store(expiredOwner.id);
      await mutate(
        "UPDATE subscriptions SET cancel_at_period_end=1,access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE store_id=?",
        [expiredStore],
      );
      await refreshBillingAccess(expiredStore);
      await reserve(
        expiredStore,
        studio,
        expiredOwner.id,
        await quote(expiredStore, studio, expiredOwner.id),
      );
      check(
        (
          await one(
            "SELECT plan_id,status FROM subscriptions WHERE store_id=?",
            [expiredStore],
          )
        ).plan_id === studio &&
          (await one("SELECT status FROM stores WHERE id=?", [expiredStore]))
            .status === "approved",
        "Unused discovery trial starts immediately and restores a store frozen only by expired billing",
      );
      const directOwner = await person(),
        directStore = await store(directOwner.id, studio);
      check(
        (await accountTrialAvailability(directOwner.id)).available === 1,
        "Registering a non-starter package consumes discovery only",
      );
      await assert.rejects(
        () => quote(directStore, 1, directOwner.id),
        /tự động theo số ngày admin cấu hình/,
      );
      check(true, "Starter onboarding trial is not selectable after registration");
      const staleOwner = await person(),
        staleStore = await store(staleOwner.id),
        staleQuote = await quote(staleStore, atelier, staleOwner.id);
      await mutate("UPDATE plans SET trial_days=8 WHERE id=?", [atelier]);
      await mutate(
        "INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) SELECT id,name,monthly_price,limits,trial_days,UTC_TIMESTAMP() FROM plans WHERE id=?",
        [atelier],
      );
      await assert.rejects(
        () => reserve(staleStore, atelier, staleOwner.id, staleQuote),
        /thay đổi/,
      );
      check(
        (await accountTrialAvailability(staleOwner.id)).available === 1,
        "Changing trial configuration invalidates stale preview without consuming the slot",
      );
      const disabled = await plan("Disabled trial QA " + key, 0, 199000);
      await assert.rejects(
        () => quote(staleStore, disabled, staleOwner.id),
        /không mở/,
      );
      check(
        true,
        "Zero configured days disables trial without consuming account eligibility",
      );
      const replaceOwner = await person(),
        replaceStore = await store(replaceOwner.id);
      const replaceInv = await tx((c) =>
        prepareSubscriptionInvoice(c, replaceStore, studio),
      );
      await mutate(
        "INSERT INTO payment_intents(store_id,invoice_id,kind,reference_code,amount,expires_at,qr_payload) VALUES(?,?,'subscription',?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE),'{}')",
        [
          replaceStore,
          replaceInv.id,
          "trial-replace-" + key,
          replaceInv.amount,
        ],
      );
      await reserve(
        replaceStore,
        atelier,
        replaceOwner.id,
        await quote(replaceStore, atelier, replaceOwner.id),
      );
      check(
        (await one("SELECT status FROM invoices WHERE id=?", [replaceInv.id]))
          .status === "void" &&
          (
            await one("SELECT status FROM payment_intents WHERE invoice_id=?", [
              replaceInv.id,
            ])
          ).status === "cancelled",
        "Trial selection atomically voids untouched pending invoice and every pending QR",
      );
      const concurrent = await person(),
        a = await store(concurrent.id, 1, false),
        b = await store(concurrent.id, 1, false);
      await mutate("UPDATE stores SET status='approved' WHERE id IN (?,?)", [
        a,
        b,
      ]);
      await tx((c) => activateApprovedStore(c, a));
      await tx((c) => activateApprovedStore(c, b));
      const qa = await quote(a, studio, concurrent.id),
        qb = await quote(b, atelier, concurrent.id);
      const raced = await Promise.allSettled([
        reserve(a, studio, concurrent.id, qa),
        reserve(b, atelier, concurrent.id, qb),
      ]);
      check(
        raced.filter((x) => x.status === "fulfilled").length === 1 &&
          (
            await query(
              "SELECT * FROM account_trial_claims WHERE user_id=? AND bucket='discovery'",
              [concurrent.id],
            )
          ).length === 1,
        "Concurrent stores can reserve exactly one shared discovery slot",
      );
      const offline = await person(),
        offlineStore = await store(offline.id);
      await reserve(
        offlineStore,
        studio,
        offline.id,
        await quote(offlineStore, studio, offline.id),
      );
      await mutate(
        "UPDATE account_trial_claims SET starts_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 DAY),ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY) WHERE user_id=? AND bucket='discovery'",
        [offline.id],
      );
      await mutate(
        "UPDATE subscriptions SET access_started_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 20 DAY),access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 DAY),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 DAY) WHERE store_id=?",
        [offlineStore],
      );
      await refreshBillingAccess(offlineStore);
      sub = await one("SELECT * FROM subscriptions WHERE store_id=?", [
        offlineStore,
      ]);
      check(
        sub.plan_id === 1 &&
          sub.status !== "trialing" &&
          !(
            await one(
              "SELECT activated_at FROM account_trial_claims WHERE user_id=? AND bucket='discovery'",
              [offline.id],
            )
          ).activated_at,
        "Offline store never gains a fresh trial after the scheduled window has elapsed",
      );
      console.log(`${checks} account-trial checks passed`);
    } finally {
      for (const sid of stores) {
        await mutate(
          "DELETE bp FROM billing_payments bp JOIN invoices i ON i.id=bp.invoice_id WHERE i.store_id=?",
          [sid],
        );
        for (const t of [
          "email_outbox",
          "notifications",
          "trial_claims",
          "account_trial_claims",
          "subscriptions",
          "store_memberships",
          "payment_intents",
          "audit_logs",
          "invoices",
        ])
          await mutate(`DELETE FROM ${t} WHERE store_id=?`, [sid]);
        await mutate("DELETE FROM stores WHERE id=?", [sid]);
      }
      for (const pid of plans) {
        await mutate("DELETE FROM plan_versions WHERE plan_id=?", [pid]);
        await mutate("DELETE FROM plans WHERE id=?", [pid]);
      }
      for (const uid of users) {
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
