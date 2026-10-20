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
  cancelSubscriptionPayment,
} from "../lib/billing";
assert(
  process.env.MYSQL_DATABASE === "fleur_saas_test" &&
    process.env.MYSQL_PORT === "3310",
  "Isolated QA database only",
);
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3005",
  key = randomUUID().slice(0, 8),
  password = "Account-Trials-QA-2026";
const databaseOnly = process.argv.includes("--db-only");
assert(!(databaseOnly && process.argv.includes("--ui")), "DB-only mode cannot run UI checks");
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
    async function store(uid: number, pid = 4, activate = true) {
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
      const onboarding = await person(), onboardingStore = await store(onboarding.id, 1, false);
      const starterConfig = Number((await one("SELECT trial_days FROM plans WHERE id=1")).trial_days);
      const held = await one("SELECT * FROM account_trial_claims WHERE user_id=?",[onboarding.id]);
      check(held?.bucket === "discovery" && !held.starts_at, "Paid registration reserves the single shared slot without starting its clock");
      const secondPaid = await store(onboarding.id, 1, false);
      check((await one("SELECT trial_days_granted FROM subscriptions WHERE store_id=?",[secondPaid])).trial_days_granted === 0, "Another registration cannot reserve a second paid trial");
      await mutate("UPDATE stores SET status='approved' WHERE id=?",[onboardingStore]);
      await tx(c=>activateApprovedStore(c,onboardingStore));
      const started = await one("SELECT * FROM subscriptions WHERE store_id=?",[onboardingStore]);
      check(started.status === "trialing" && started.trial_days_granted === starterConfig, "Approval starts paid trial for configured N days");
      await tx(c=>activateApprovedStore(c,onboardingStore));
      check((await one("SELECT trial_ends_at FROM subscriptions WHERE store_id=?",[onboardingStore])).trial_ends_at === started.trial_ends_at, "Reapproval preserves expiry");
      await assert.rejects(()=>quote(onboardingStore,studio,onboarding.id),/đã dùng/);
      check((await accountTrialAvailability(onboarding.id)).available === 0,"Starter consumes the same lifetime entitlement as Studio/Atelier");
      const oldPendingOwner=await person(),oldPendingStore=await store(oldPendingOwner.id,1,false);
      await mutate("UPDATE account_trial_claims SET bucket='starter' WHERE user_id=?",[oldPendingOwner.id]);
      await mutate("UPDATE stores SET status='approved' WHERE id=?",[oldPendingStore]);
      await tx(c=>activateApprovedStore(c,oldPendingStore));
      const oldPending=await one("SELECT * FROM subscriptions WHERE store_id=?",[oldPendingStore]);
      check(oldPending.status==='trialing'&&oldPending.active_trial_bucket==='starter'&&oldPending.trial_days_granted===starterConfig,"Pending legacy Starter reservation activates its original bucket and offer");
      await assert.rejects(()=>quote(oldPendingStore,studio,oldPendingOwner.id),/đã dùng/);
      check(true,"Legacy Starter alone consumes the sole new paid trial entitlement");
      const owner = await person(), s = await store(owner.id), second = await store(owner.id);
      let sub = await one("SELECT * FROM subscriptions WHERE store_id=?",[s]);
      check(sub.plan_id === 4 && sub.status === "free" && !sub.access_ends_at && !sub.period_end, "Free registration activates indefinitely without a billing period");
      check((await accountTrialAvailability(owner.id)).available === 1,"Free registration leaves the paid trial available");
      await advanceBilling(s); await refreshBillingAccess(s);
      check((await one("SELECT COUNT(*) n FROM invoices WHERE store_id=?",[s])).n === 0,"Free worker creates no renewal invoices or expiry reminders");
      await assert.rejects(()=>tx(c=>prepareSubscriptionInvoice(c,s,4)),/không cần gia hạn/);
      check(true,"Free cannot be repeatedly renewed to create zero invoices");
      const before = JSON.stringify(
        await query("SELECT * FROM account_trial_claims WHERE user_id=?", [
          owner.id,
        ]),
      );
      const q = await quote(s, studio, owner.id),
        alternative = await quote(s, atelier, owner.id);
      check((await quote(s,1,owner.id)).trial_days === starterConfig,"Starter is selectable when account has not used its paid trial");
      await assert.rejects(()=>quote(s,4,owner.id),/miễn phí/);
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
        q.starts_immediately && !q.replaces_current_trial && q.amount_due === 0 && q.trial_days === 3,
        "Paid trial preview starts immediately from Free with zero amount due",
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
      if (!databaseOnly) await api("auth/login", "POST", { email: owner.email, password });
      const apiQuote = databaseOnly ? q : await api(
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
            page.getByText("Đã chuyển gói và bắt đầu dùng thử."),
          ).toBeVisible();
          await expect(
            card.getByRole("button", { name: "Dùng thử 3 ngày", exact: true }),
          ).toHaveCount(0);
          await page.screenshot({
            path: ".local/account-trial-qa/mobile-reserved.png",
          });
          check(
            !errors.length,
            "Trial confirmation immediately updates current plan without browser errors",
          );
        } finally {
          await browser.close();
        }
      } else if (databaseOnly) await reserve(s, studio, owner.id, apiQuote);
      else
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
          !!claim.starts_at &&
          !!claim.activated_at,
        "Confirmation activates the selected paid trial immediately from Free",
      );
      check(
        (await one("SELECT plan_id,trial_ends_at FROM subscriptions WHERE store_id=?", [s])).plan_id === studio,
        "Subscription switches from Free to the selected paid plan",
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
        "UPDATE account_trial_claims SET starts_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 4 DAY),activated_at=NULL WHERE user_id=? AND bucket='discovery'",
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
        ).n === 1,
        "Each started trial queues exactly one welcome email",
      );
      await mutate(
        "UPDATE subscriptions SET access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE store_id=?",
        [s],
      );
      await refreshBillingAccess(s);
      check(
        (await one("SELECT plan_id FROM subscriptions WHERE store_id=?", [s])).plan_id === 4 &&
          (await one("SELECT status FROM stores WHERE id=?", [s])).status === 'approved',
        "Unpaid discovery expiry falls back to Experience without freezing operations",
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
        !(await one("SELECT activated_at FROM account_trial_claims WHERE user_id=? AND bucket='discovery'", [paidOwner.id])).activated_at &&
          (await one("SELECT plan_id FROM subscriptions WHERE store_id=?", [paidStore])).plan_id === studio,
        "Discovery never replaces purchased access before its end",
      );
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
        (await accountTrialAvailability(directOwner.id)).available === 0,
        "Registering a non-starter package consumes the only selectable discovery trial",
      );
      await assert.rejects(
        () => quote(directStore, 1, directOwner.id),
        /đã dùng/,
      );
      check(true, "Starter cannot claim another paid trial after registration consumed one");
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
      const replacementQuote = await quote(replaceStore, atelier, replaceOwner.id);
      await assert.rejects(() => reserve(
        replaceStore,
        atelier,
        replaceOwner.id,
        replacementQuote,
      ), /yêu cầu thanh toán/);
      await tx(c => cancelSubscriptionPayment(c, replaceStore, replaceInv.id, replaceOwner.id));
      await reserve(replaceStore, atelier, replaceOwner.id, await quote(replaceStore, atelier, replaceOwner.id));
      check(
        (await one("SELECT status FROM invoices WHERE id=?", [replaceInv.id]))
          .status === "void" &&
          (
            await one("SELECT status FROM payment_intents WHERE invoice_id=?", [
              replaceInv.id,
            ])
          ).status === "cancelled",
        "Trial selection requires explicit cancellation of the existing payment and QR",
      );
      const concurrent = await person(),
        a = await store(concurrent.id, 4, false),
        b = await store(concurrent.id, 4, false);
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
      async function legacyDiscovery(sid: number, uid: number, pid: number, start: string) {
        const offer = await one("SELECT id plan_version_id,trial_days FROM plan_versions WHERE plan_id=? ORDER BY id DESC LIMIT 1",[pid]);
        await mutate("INSERT INTO account_trial_claims(user_id,bucket,store_id,plan_id,plan_version_id,trial_days,starts_at,ends_at) VALUES(?,'discovery',?,?,?,?,?,DATE_ADD(?,INTERVAL ? DAY))", [uid, sid, pid, offer.plan_version_id, offer.trial_days, start, start, offer.trial_days]);
        return offer;
      }
      async function legacyStoreFor(uid:number) {
        const sid = await store(uid,1);
        await mutate("UPDATE account_trial_claims SET bucket='starter' WHERE user_id=? AND bucket='discovery'",[uid]);
        await mutate("UPDATE subscriptions SET active_trial_bucket='starter' WHERE store_id=?",[sid]);
        await mutate("UPDATE email_outbox SET dedupe_key=REPLACE(dedupe_key,'-discovery','-starter') WHERE store_id=?",[sid]);
        return sid;
      }
      const legacyOwner = await person(), legacyStore = await legacyStoreFor(legacyOwner.id);
      const legacySub = await one("SELECT * FROM subscriptions WHERE store_id=?", [legacyStore]);
      const legacyRenewal = await tx(c => prepareSubscriptionInvoice(c, legacyStore, 1));
      const legacyOffer = await legacyDiscovery(legacyStore, legacyOwner.id, studio, legacySub.trial_ends_at);
      await refreshBillingAccess(legacyStore);
      const repaired = await one("SELECT * FROM account_trial_claims WHERE user_id=? AND bucket='discovery'", [legacyOwner.id]);
      check(!!repaired.activated_at && repaired.starts_at < legacySub.trial_ends_at && (await one("SELECT plan_id FROM subscriptions WHERE store_id=?", [legacyStore])).plan_id === studio,
        "Legacy discovery queued behind Starter is repaired and activated on access refresh");
      check(new Date(repaired.ends_at + 'Z').getTime() - new Date(repaired.starts_at + 'Z').getTime() === legacyOffer.trial_days * 86400000,
        "Legacy repair grants the snapshotted N days rather than current catalog or old start date");
      check((await one("SELECT status FROM invoices WHERE id=?", [legacyRenewal.id])).status === 'void',
        "Legacy repair voids the obsolete unpaid renewal");
      await refreshBillingAccess(legacyStore);
      check((await one("SELECT ends_at FROM account_trial_claims WHERE user_id=? AND bucket='discovery'", [legacyOwner.id])).ends_at === repaired.ends_at &&
        (await one("SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_trial_started'", [legacyStore])).n === 2,
        "Repeated refresh does not restart repaired trial or duplicate started mail");

      const prepaidOwner = await person(), prepaidStore = await legacyStoreFor(prepaidOwner.id);
      const prepaid = await tx(async c => {
        const i = await prepareSubscriptionInvoice(c, prepaidStore, 1);
        // QA catalogs may price Starter at zero. Create a cash-bearing renewal
        // fixture without changing the shared catalog used by other checks.
        if (Number(i.amount) === 0) {
          await c.execute("UPDATE invoices SET amount=1000,paid=0,status='open',applied_at=NULL,activated_at=NULL,effective_start_at=NULL,effective_end_at=NULL WHERE id=?", [i.id]);
          i.amount = 1000;
        }
        await recordInvoicePayment(c, i.id, i.amount, `prepaid-starter-${key}`, prepaidOwner.id);
        return i;
      });
      const prepaidPeriod = await one("SELECT * FROM invoices WHERE id=?", [prepaid.id]);
      await legacyDiscovery(prepaidStore, prepaidOwner.id, atelier, prepaidPeriod.effective_end_at);
      await refreshBillingAccess(prepaidStore);
      check(!(await one("SELECT activated_at FROM account_trial_claims WHERE user_id=? AND bucket='discovery'", [prepaidOwner.id])).activated_at &&
        (await one("SELECT status FROM invoices WHERE id=?", [prepaid.id])).status === 'paid',
        "Legacy repair preserves a prepaid period after the onboarding trial");

      const qrOwner = await person(), qrStore = await legacyStoreFor(qrOwner.id);
      const qrInvoice = await tx(c => prepareSubscriptionInvoice(c, qrStore, 1));
      if (Number(qrInvoice.amount) === 0) {
        await mutate("UPDATE invoices SET amount=1000,paid=0,status='open',applied_at=NULL,activated_at=NULL,effective_start_at=NULL,effective_end_at=NULL WHERE id=?", [qrInvoice.id]);
        qrInvoice.amount = 1000;
      }
      await mutate("INSERT INTO payment_intents(store_id,invoice_id,kind,reference_code,amount,expires_at,qr_payload) VALUES(?,?,'subscription',?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE),'{}')", [qrStore, qrInvoice.id, `legacy-qr-${key}`, qrInvoice.amount]);
      await legacyDiscovery(qrStore, qrOwner.id, atelier, (await one("SELECT trial_ends_at FROM subscriptions WHERE store_id=?", [qrStore])).trial_ends_at);
      await refreshBillingAccess(qrStore);
      check(!(await one("SELECT activated_at FROM account_trial_claims WHERE user_id=? AND bucket='discovery'", [qrOwner.id])).activated_at &&
        (await one("SELECT status FROM payment_intents WHERE invoice_id=?", [qrInvoice.id])).status === 'pending',
        "Legacy repair does not invalidate a pending payment QR");
      const offline = await person(),
        offlineStore = await store(offline.id);
      await reserve(
        offlineStore,
        studio,
        offline.id,
        await quote(offlineStore, studio, offline.id),
      );
      await mutate(
        "UPDATE account_trial_claims SET starts_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 DAY),ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY),activated_at=NULL WHERE user_id=? AND bucket='discovery'",
        [offline.id],
      );
      await mutate(
        "UPDATE subscriptions SET plan_id=1,access_started_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 20 DAY),access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 DAY),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 DAY) WHERE store_id=?",
        [offlineStore],
      );
      await refreshBillingAccess(offlineStore);
      sub = await one("SELECT * FROM subscriptions WHERE store_id=?", [
        offlineStore,
      ]);
      check(
        sub.plan_id === 4 &&
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
