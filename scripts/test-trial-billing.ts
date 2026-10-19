import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, query, mutate } from "../lib/db";
import { withSystem, withStore } from "../lib/tenant";
import { passwordHash, digest } from "../lib/auth";
import {
  activateApprovedStore,
  advanceBilling,
  prepareSubscriptionInvoice,
  recordInvoicePayment,
  nextBillingInstant,
  refreshBillingAccess,
  extendStoreTrial,
} from "../lib/billing";
import { createIntent, platformBank, processWebhook } from "../lib/sepay";
import { processEmails } from "../lib/email";
import { quota } from "../lib/stores";

assert(
  process.env.MYSQL_DATABASE === "fleur_saas_test" &&
    process.env.MYSQL_PORT === "3310",
  "Isolated QA DB only",
);
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
const key = randomUUID().slice(0, 8),
  password = "Trial-Testing-2026-Only";
let count = 0;
function check(value: unknown, label: string) {
  assert(value, label);
  console.log("PASS", label);
  count++;
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
    const response = await fetch(base + "/api/" + path, {
      method,
      headers: {
        origin: base,
        "content-type": "application/json",
        "x-fleur-store": String(sid),
        cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; ");
    const data = await response.json();
    assert.equal(response.status, status, path + ": " + JSON.stringify(data));
    return data;
  };
}
async function tx<T>(fn: (c: any) => Promise<T>) {
  const c = await pool.getConnection();
  try {
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
const parse = (v: string) => Date.parse(v.replace(" ", "T") + "Z");
async function main() {
  return withSystem(async () => {
    const savedPlans = await query<any[]>("SELECT * FROM plans"),
      savedConfig = await query<any[]>(
        "SELECT * FROM platform_settings WHERE setting_key IN ('store_approval_required','billing_bank')",
      );
    const savedCredentials = await query<any[]>(
      "SELECT * FROM platform_integrations WHERE provider='sepay'",
    );
    const [adminUser] = await query<any[]>(
      "SELECT id FROM users WHERE email='owner@example.test'",
    );
    assert(adminUser, "QA seed required");
    await mutate("INSERT IGNORE INTO platform_memberships(user_id) VALUES(?)", [
      adminUser.id,
    ]);
    await mutate("DELETE FROM login_attempts WHERE attempt_key=?", [
      digest("login:owner@example.test"),
    ]);
    const admin = client(),
      owner = client();
    await admin("auth/login", "POST", {
      email: "owner@example.test",
      password: "SaaS-Testing-2026-Only",
    });
    const person = await mutate(
      "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
      ["Trial Owner", `trial-${key}@example.test`, passwordHash(password)],
    );
    await owner("auth/login", "POST", {
      email: `trial-${key}@example.test`,
      password,
    });
    const fixtures: number[] = [];
    const billing = (sid: number) =>
      owner("workspace/billing", "GET", undefined, sid);
    async function configure(
      days: number,
      price = 199000,
      limits = { products: 30, staff: 3, storage_mb: 100 },
    ) {
      await admin("platform/plans/1", "PATCH", {
        name: "Khởi đầu QA",
        monthly_price: price,
        trial_days: days,
        limits,
      });
    }
    async function create(
      days: number,
      approve = true,
      auto = false,
      price = 199000,
      planId = 1,
    ) {
      // Independent lifecycle scenario; cross-store account limits are covered separately.
      await mutate("DELETE FROM account_trial_claims WHERE user_id=?", [
        person.insertId,
      ]);
      await configure(days, price);
      await admin("platform/config", "PATCH", { storeApprovalRequired: !auto });
      // Remove only this fixture's counter; the production throttle is unchanged.
      await mutate("DELETE FROM login_attempts WHERE attempt_key=?", [
        digest("create-store:" + person.insertId),
      ]);
      const s = await owner("stores", "POST", {
        name: `Trial ${fixtures.length} ${key}`,
        slug: `trial-${key}-${fixtures.length}`,
        address: "123 Đường Hoa, Hà Nội",
        phone: "0901234567",
        plan_id: planId,
      });
      fixtures.push(s.id);
      if (approve && !auto) await approveStore(s.id);
      return s.id;
    }
    async function approveStore(sid: number) {
      const d = await admin("platform/stores/" + sid);
      await admin(`platform/stores/${sid}/status`, "PATCH", {
        status: "approved",
        reason: "Duyệt cửa hàng kiểm thử",
        version: d.store.version,
      });
    }
    async function expire(sid: number, seconds = 3600) {
      await mutate(
        "UPDATE subscriptions SET trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? SECOND),access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? SECOND),current_period_end=DATE(UTC_TIMESTAMP()),period_end=DATE(UTC_TIMESTAMP()) WHERE store_id=?",
        [seconds, seconds, sid],
      );
    }
    try {
      check(
        nextBillingInstant("2027-01-31 03:12:00") === "2027-02-28 03:12:00" &&
          nextBillingInstant("2028-01-31 03:12:00") === "2028-02-29 03:12:00" &&
          nextBillingInstant("2027-02-28 03:12:00", 31) ===
            "2027-03-31 03:12:00",
        "Calendar months preserve Vietnam anniversary, time and leap years",
      );
      check(
        nextBillingInstant("2027-01-30 18:30:00") === "2027-02-27 18:30:00",
        "Month anchor follows Vietnam date across UTC midnight",
      );
      const first = await create(14, false);
      let [sub] = await query<any[]>(
        "SELECT * FROM subscriptions WHERE store_id=?",
        [first],
      );
      const promised = sub.registration_plan_version_id;
      check(
        sub.status === "pending_activation" &&
          !sub.access_started_at &&
          sub.trial_days_granted === 14,
        "Pending registration captures offer without consuming trial",
      );
      await configure(7, 299000, { products: 50, staff: 5, storage_mb: 200 });
      await owner(
        "stores",
        "POST",
        {
          name: "Stale offer",
          slug: `stale-offer-${key}`,
          address: "123 Đường Hoa, Hà Nội",
          phone: "0901234567",
          plan_id: 1,
          offer_version_id: promised,
        },
        1,
        409,
      );
      const [stale] = await query<any[]>(
        "SELECT COUNT(*) n FROM stores WHERE slug=?",
        [`stale-offer-${key}`],
      );
      check(
        stale.n === 0,
        "A stale displayed offer is rejected atomically before creating a store",
      );
      await approveStore(first);
      let b = await billing(first);
      check(
        b.subscription.status === "trialing" &&
          parse(b.subscription.trial_ends_at) -
            parse(b.subscription.trial_started_at) ===
            14 * 86400000,
        "Approval gives exactly promised 14 days after offer changed to 7",
      );
      check(
        b.subscription.registration_plan_version_id === promised &&
          b.subscription.monthly_price === 199000 &&
          JSON.parse(
            typeof b.subscription.limits === "string"
              ? b.subscription.limits
              : JSON.stringify(b.subscription.limits),
          ).products === 30,
        "Price and trial limits keep registration version",
      );
      await assert.rejects(
        () => withStore(first, () => quota("products", 31)),
        /giới hạn/,
      );
      check(
        true,
        "Quota enforcement uses promised limits, not updated catalog limits",
      );
      check(
        b.invoices.length === 0 && b.subscription.days_remaining === 14,
        "Trial has no immediate monthly invoice and shows correct remaining days",
      );
      const end = b.subscription.trial_ends_at;
      await tx((c) => activateApprovedStore(c, first));
      check(
        (await billing(first)).subscription.trial_ends_at === end,
        "Repeat activation never restarts trial",
      );
      const next = await create(7);
      check(
        (await billing(next)).subscription.trial_days_granted === 7,
        "New registration receives new 7-day offer",
      );
      await configure(30);
      check(
        (await billing(first)).subscription.trial_ends_at === end &&
          (await billing(next)).subscription.trial_days_granted === 7,
        "Increasing trial days does not recalculate existing trials",
      );
      const auto = await create(30, true, true);
      check(
        (await billing(auto)).subscription.status === "trialing",
        "Autoapproval activates trial through same workflow",
      );
      const autoEnd = (await billing(auto)).subscription.trial_ends_at;
      const selected = await tx((c) => prepareSubscriptionInvoice(c, auto, 2));
      const changed = await tx((c) => prepareSubscriptionInvoice(c, auto, 3));
      await advanceBilling(auto);
      const [selection] = await query<any[]>(
        "SELECT status FROM invoices WHERE id=?",
        [selected.id],
      );
      check(
        selection.status === "void" &&
          changed.id !== selected.id &&
          (await billing(auto)).subscription.trial_ends_at === autoEnd,
        "Selecting another future package replaces unpaid quote without resetting trial",
      );
      const noTrial = await create(0);
      b = await billing(noTrial);
      check(
        b.subscription.status === "awaiting_payment" &&
          !b.subscription.access_ends_at &&
          b.invoices.length === 1 &&
          b.store.billing_suspended,
        "Zero-day paid plan waits for payment without granting a month",
      );
      await tx((c) =>
        recordInvoicePayment(
          c,
          b.invoices[0].id,
          b.invoices[0].amount,
          "zero-" + key,
          adminUser.id,
        ),
      );
      check(
        (await billing(noTrial)).subscription.status === "active",
        "First full payment starts zero-trial paid service",
      );
      const autoNoTrial = await create(0, true, true);
      const [autoWaiting] = await query<any[]>(
        "SELECT status,billing_suspended FROM stores WHERE id=?",
        [autoNoTrial],
      );
      check(
        autoWaiting.status === "suspended" &&
          autoWaiting.billing_suspended === 1,
        "Autoapproved zero-day paid signup is restricted immediately before any billing-page visit",
      );
      await owner(
        "workspace/billing/start",
        "POST",
        { plan_id: 2, trial: true },
        first,
        409,
      );
      check(
        (await billing(first)).subscription.trial_ends_at === end,
        "A trial cannot be claimed without a confirmed preview or reset current trial",
      );
      await admin(
        `platform/stores/${first}/subscription`,
        "PATCH",
        {
          plan_id: 1,
          status: "active",
          period_end: "2027-01-01",
          version: (await billing(first)).subscription.version,
        },
        1,
        409,
      );
      check(
        true,
        "Generic admin subscription editing cannot silently erase trial",
      );

      const inv = await tx((c) => prepareSubscriptionInvoice(c, first, 1));
      check(
        inv.amount === 199000 && inv.starts_at === end,
        "First monthly invoice honors promised price and begins after trial",
      );
      await tx((c) =>
        recordInvoicePayment(
          c,
          inv.id,
          1000,
          "early-part-" + key,
          adminUser.id,
        ),
      );
      check(
        (await billing(first)).subscription.status === "trialing" &&
          !(await billing(first)).scheduled,
        "Partial early receipt does not activate paid cycle",
      );
      await tx((c) =>
        recordInvoicePayment(
          c,
          inv.id,
          inv.amount - 1000,
          "early-full-" + key,
          adminUser.id,
        ),
      );
      b = await billing(first);
      check(
        b.subscription.trial_ends_at === end &&
          b.subscription.status === "trialing" &&
          b.scheduled.effective_start_at === end,
        "Early full payment reserves month and retains remaining trial",
      );
      const reservedEnd = b.scheduled.effective_end_at;
      await tx((c) =>
        recordInvoicePayment(
          c,
          inv.id,
          inv.amount - 1000,
          "early-full-" + key,
          adminUser.id,
        ),
      );
      check(
        (await billing(first)).scheduled.effective_end_at === reservedEnd,
        "Receipt retry never adds another month",
      );
      await admin(
        `platform/stores/${first}/trial-extension`,
        "POST",
        {
          days: 7,
          reason: "Không dời kỳ đã thu",
          version: b.subscription.version,
        },
        1,
        409,
      );
      check(true, "Trial extension refuses a paid future cycle");
      await mutate(
        "UPDATE subscriptions SET trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE store_id=?",
        [first],
      );
      await mutate(
        "UPDATE invoices SET effective_start_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),effective_end_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 MONTH) WHERE id=?",
        [inv.id],
      );
      await refreshBillingAccess(first);
      b = await billing(first);
      check(
        b.subscription.status === "active" &&
          !b.subscription.trial_ends_at &&
          !b.scheduled,
        "At boundary, paid coverage becomes current without waiting for cron",
      );

      await expire(next);
      await advanceBilling(next);
      b = await billing(next);
      const late = b.invoices.find((x: any) => x.status === "open");
      check(
        b.store.status === "suspended" &&
          b.subscription.status === "restricted" &&
          !!late,
        "Unpaid expired trial freezes store and retains billing access",
      );
      await owner("workspace/settings", "PATCH", {}, next, 403);
      check(true, "Frozen store cannot mutate operational settings");
      await tx((c) =>
        recordInvoicePayment(
          c,
          late.id,
          1000,
          "late-part-" + key,
          adminUser.id,
        ),
      );
      check(
        (await billing(next)).store.status === "suspended",
        "Partial late receipt does not unfreeze store",
      );
      await mutate(
        "UPDATE invoices SET starts_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 3 DAY),ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 27 DAY),due_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 3 DAY) WHERE id=?",
        [late.id],
      );
      await tx((c) =>
        recordInvoicePayment(
          c,
          late.id,
          late.amount - 1000,
          "late-full-" + key,
          adminUser.id,
        ),
      );
      b = await billing(next);
      const actual = b.invoices.find((x: any) => x.id === late.id);
      check(
        b.store.status === "approved" &&
          b.subscription.status === "active" &&
          parse(actual.effective_start_at) > parse(actual.starts_at) &&
          actual.effective_end_at ===
            nextBillingInstant(actual.effective_start_at),
        "Late full settlement buys a full month from receipt, preserving invoice's original estimate",
      );
      let detail = await admin("platform/stores/" + next);
      await admin(`platform/stores/${next}/status`, "PATCH", {
        status: "suspended",
        reason: "Khóa thủ công kiểm thử",
        version: detail.store.version,
      });
      await refreshBillingAccess(next);
      check(
        (await billing(next)).store.status === "suspended" &&
          !(await billing(next)).store.billing_suspended,
        "Billing reconciliation preserves manual suspension",
      );

      // Extend an unpaid trial, invalidate its pending QR and old reminder.
      await admin("platform/config", "PATCH", {
        billingBank: {
          bank_code: "MB",
          bank_name: "MB Bank",
          account_number: "123456789",
          account_holder: "PLATFORM QA",
          enabled: true,
        },
      });
      const extension = await create(3);
      b = await billing(extension);
      const old = b.invoices.find((x: any) => x.status === "open");
      const qr = await owner(
        "workspace/billing/start",
        "POST",
        { plan_id: 1, invoice_id: old.id },
        extension,
      );
      const oldEnd = b.subscription.trial_ends_at;
      await admin(`platform/stores/${extension}/trial-extension`, "POST", {
        days: 7,
        reason: "Tặng thêm thời gian trải nghiệm",
        version: b.subscription.version,
      });
      b = await billing(extension);
      const [cancelled] = await query<any[]>(
        "SELECT i.status,p.status intent_status FROM invoices i JOIN payment_intents p ON p.invoice_id=i.id WHERE i.id=?",
        [old.id],
      );
      check(
        parse(b.subscription.trial_ends_at) - parse(oldEnd) === 7 * 86400000 &&
          cancelled.status === "void" &&
          cancelled.intent_status === "cancelled",
        "Explicit extension adds days once and voids unpaid invoice/QR",
      );
      check(
        b.invoices.some(
          (i: any) =>
            i.status === "open" &&
            i.starts_at === b.subscription.trial_ends_at &&
            i.amount === old.amount,
        ),
        "Extension replaces the invoice using committed price and new deadline",
      );
      await admin(
        `platform/stores/${extension}/trial-extension`,
        "POST",
        {
          days: 7,
          reason: "Lặp thao tác đã gửi",
          version: b.subscription.version - 1,
        },
        1,
        409,
      );
      check(true, "Optimistic version prevents duplicate extension");
      const [audit] = await query<any[]>(
        "SELECT COUNT(*) n FROM audit_logs WHERE store_id=? AND action='trial_extend' AND detail IS NOT NULL",
        [extension],
      );
      check(audit.n === 1, "Trial extension is audited");

      // Five/one-day emails are queued once, tested without contacting SMTP.
      await mutate(
        "UPDATE subscriptions SET trial_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 DAY),access_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 DAY) WHERE store_id=?",
        [extension],
      );
      await mutate(
        "UPDATE invoices SET due_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 DAY) WHERE store_id=? AND status='open'",
        [extension],
      );
      await Promise.all([advanceBilling(extension), advanceBilling(extension)]);
      b = await billing(extension);
      const renewal = b.invoices.find((x: any) => x.status === "open");
      const [five] = await query<any[]>(
        "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_renewal_5d'",
        [extension],
      );
      check(five.n === 1, "Concurrent workers queue only one 5-day reminder");
      await mutate(
        "UPDATE invoices SET due_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE id=?",
        [renewal.id],
      );
      await advanceBilling(extension);
      await advanceBilling(extension);
      const [one] = await query<any[]>(
        "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_renewal_1d'",
        [extension],
      );
      check(one.n === 1, "One-day reminder is deduplicated");
      Object.assign(process.env, {
        EMAIL_ENABLED: "true",
        SMTP_HOST: "smtp.example.test",
        SMTP_PORT: "465",
        SMTP_USER: "test@example.test",
        SMTP_PASSWORD: "fixture-only",
        SMTP_FROM_EMAIL: "test@example.test",
        APP_ORIGIN: base,
      });
      const sent: any[] = [];
      await withStore(extension, () =>
        processEmails(100, async (m) => {
          sent.push(m);
          return "trial-test-" + m.id;
        }),
      );
      check(
        sent.some((m) => m.subject.includes("dùng thử")) &&
          sent.every((m) => !m.body.includes("{{")),
        "Trial and renewal templates render through mocked SMTP delivery",
      );

      const webhook = await create(1);
      b = await billing(webhook);
      const [shortEmails] = await query<any[]>(
        "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key IN ('subscription_renewal_5d','subscription_renewal_1d')",
        [webhook],
      );
      check(
        shortEmails.n === 0,
        "One-day trial does not send redundant reminder alongside welcome",
      );
      await expire(webhook);
      await advanceBilling(webhook);
      b = await billing(webhook);
      const wi = b.invoices.find((x: any) => x.status === "open");
      await mutate(
        "UPDATE invoices SET starts_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE id=?",
        [wi.id],
      );
      const intent = await tx(async (c) =>
        createIntent(
          c,
          webhook,
          "subscription",
          person.insertId,
          wi.amount,
          null,
          wi.id,
          (await platformBank(c))!,
        ),
      );
      await mutate(
        "UPDATE payment_intents SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?",
        [intent.id],
      );
      const credentials = await admin("platform/sepay/credentials", "POST", {});
      const headers = new Headers({ "x-api-key": credentials.apiKey });
      const [time] = await query<any[]>(
        "SELECT DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 MINUTE),'%Y-%m-%dT%H:%i:%sZ') received",
      );
      const event = {
        id: `trial-webhook-${key}`,
        content: intent.code,
        transferAmount: 1000,
        transferType: "in",
        accountNumber: "123456789",
        transactionDate: time.received,
      };
      await processWebhook(JSON.stringify(event), event, headers);
      check(
        (await billing(webhook)).store.status === "suspended",
        "SePay partial receipt remains frozen even with expired QR",
      );
      const full = {
        ...event,
        id: event.id + "-full",
        transferAmount: wi.amount - 1000,
      };
      await processWebhook(JSON.stringify(full), full, headers);
      await processWebhook(JSON.stringify(full), full, headers);
      b = await billing(webhook);
      const wb = b.invoices.find((x: any) => x.id === wi.id);
      check(
        b.store.status === "approved" &&
          wb.effective_start_at ===
            time.received.slice(0, 19).replace("T", " "),
        "Delayed webhook honors verified bank timestamp and expired QR without losing payment",
      );
      const [ledger] = await query<any[]>(
        "SELECT COUNT(*) n FROM billing_payments WHERE invoice_id=?",
        [wi.id],
      );
      check(
        ledger.n === 2,
        "Partial/full webhook and duplicate share one payment ledger",
      );
      const extra = { ...full, id: full.id + "-extra", transferAmount: 1000 };
      await assert.rejects(
        () => processWebhook(JSON.stringify(extra), extra, headers),
        /đối soát/,
      );
      const issues = await admin("platform/config");
      check(
        issues.paymentIssues.some((x: any) => x.provider_event_id === extra.id),
        "Extra transfer goes to platform reconciliation instead of silently adding a month",
      );

      await expire(auto, 0);
      const listed = await owner("stores");
      check(
        !listed.some((s: any) => s.id === auto),
        "Marketplace hides expired trial at exact deadline before cron",
      );
      await owner("workspace/settings", "PATCH", {}, auto, 403);
      check(true, "API blocks expired trial at exact instant without cron");
      const permanent = await create(3, true, false, 0);
      await expire(permanent);
      await advanceBilling(permanent);
      b = await billing(permanent);
      check(
        b.store.status === "approved" &&
          b.subscription.status === "free" &&
          b.subscription.access_ends_at &&
          !b.subscription.trial_ends_at,
        "Price-zero package continues free monthly service after trial",
      );
      const freeTrial = await create(3, true, false, 0);
      b = await billing(freeTrial);
      await admin(`platform/stores/${freeTrial}/trial-extension`, "POST", {
        days: 2,
        reason: "Gia hạn không có tiền đã thu",
        version: b.subscription.version,
      });
      b = await billing(freeTrial);
      check(
        b.subscription.trial_days_granted === 5 &&
          b.subscription.status === "trialing",
        "Zero-value reserved month does not prevent extending a free trial",
      );
      await owner(
        "workspace/billing/cancel",
        "POST",
        { cancel: true },
        freeTrial,
      );
      await expire(freeTrial);
      await advanceBilling(freeTrial);
      b = await billing(freeTrial);
      check(
        b.subscription.status === "cancelled" && b.store.status === "suspended",
        "Stopping renewal voids free reserved coverage and ends access at trial expiry",
      );
      await mutate(
        "UPDATE subscriptions SET cancel_at_period_end=0 WHERE store_id=?",
        [freeTrial],
      );
      await advanceBilling(freeTrial);
      check(
        (await billing(freeTrial)).subscription.status === "cancelled",
        "An already cancelled subscription never resumes through automatic free renewal",
      );

      const studio = await create(14, true, false, 199000, 2);
      const atelier = await create(14, true, false, 199000, 3);
      check(
        (await billing(studio)).subscription.plan_id === 2 &&
          (await billing(atelier)).subscription.plan_id === 3,
        "Registration can claim the selected Studio or Atelier offer",
      );
      if (process.argv.includes("--ui")) {
        const { chromium, expect } = await import("@playwright/test");
        const browser = await chromium.launch({ headless: true });
        const { mkdir } = await import("node:fs/promises");
        await mkdir(".local/trial-billing-qa", { recursive: true });
        try {
          const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
          });
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(base + "/login");
          await page
            .locator("input[type=email]:visible")
            .fill(`trial-${key}@example.test`);
          await page.locator("input[type=password]:visible").fill(password);
          await page
            .getByRole("button", { name: "Đăng nhập", exact: true })
            .click();
          await page.waitForURL(/workspace|platform|admin/);
          await page.goto(base + "/start");
          await expect(nativeSelect(page, "Gói đăng ký")).toBeVisible();
          await chooseSelect(nativeSelect(page, "Gói đăng ký"), "2");
          await expect(
            page.getByText(/300 sản phẩm.*10 nhân sự/),
          ).toBeVisible();
          check(
            true,
            "Store registration shows selected package trial, price and limits",
          );
          await page.goto(base + `/workspace/${extension}/billing`);
          await expect(
            page.getByText("Đang dùng thử", { exact: false }).first(),
          ).toBeVisible();
          await expect(page.getByText(/Đã cấp.*ngày dùng thử/)).toBeVisible();
          await page.screenshot({
            path: ".local/trial-billing-qa/store-desktop.png",
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.reload();
          await expect(page.locator(".billing-current")).toBeVisible();
          await expect
            .poll(async () =>
              page
                .locator(".admin-sidebar")
                .evaluate((el) => el.getBoundingClientRect().right),
            )
            .toBeLessThanOrEqual(1);
          await page.screenshot({
            path: ".local/trial-billing-qa/store-mobile.png",
            fullPage: true,
          });
          check(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            "Mobile billing fits viewport",
          );
          const ap = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
          });
          await ap.goto(base + "/login");
          await ap
            .locator("input[type=email]:visible")
            .fill("owner@example.test");
          await ap
            .locator("input[type=password]:visible")
            .fill("SaaS-Testing-2026-Only");
          await ap
            .getByRole("button", { name: "Đăng nhập", exact: true })
            .click();
          await ap.waitForURL(/platform|workspace|admin/);
          await ap.goto(base + "/platform/plans");
          await expect(
            ap.getByRole("button", { name: "Lưu tất cả thay đổi" }),
          ).toBeVisible();
          check(
            (await ap.getByRole("button", { name: /Lưu/ }).count()) === 1,
            "Plan catalog has one save action",
          );
          await ap.screenshot({
            path: ".local/trial-billing-qa/platform-plans.png",
            fullPage: true,
          });
          await ap.goto(base + "/platform/stores");
          await ap
            .getByRole("button", {
              name: `Trial ${fixtures.indexOf(extension)} ${key}`,
              exact: true,
            })
            .click();
          await expect(
            ap.getByRole("button", { name: "Xác nhận gia hạn dùng thử" }),
          ).toBeVisible();
          await ap.getByLabel("Số ngày cộng thêm").fill("2");
          await expect(ap.getByText(/Hạn mới:/)).toBeVisible();
          await ap.screenshot({
            path: ".local/trial-billing-qa/platform-trial-extension.png",
            fullPage: true,
          });
          check(
            true,
            "Platform trial-extension form shows a date preview inside store detail",
          );
          check(
            errors.length === 0,
            "Billing UI has no uncaught browser errors",
          );
        } finally {
          await browser.close();
        }
      }
      console.log(`${count} trial-first billing checks passed`);
    } finally {
      for (const sid of fixtures) {
        await mutate(
          "DELETE bp FROM billing_payments bp JOIN invoices i ON i.id=bp.invoice_id WHERE i.store_id=?",
          [sid],
        );
        for (const table of [
          "email_outbox",
          "email_templates",
          "notifications",
          "trial_claims",
          "account_trial_claims",
          "subscriptions",
          "store_memberships",
          "payment_intents",
          "audit_logs",
          "invoices",
        ])
          await mutate(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
        await mutate("DELETE FROM stores WHERE id=?", [sid]);
      }
      await mutate("DELETE FROM sessions WHERE user_id=?", [person.insertId]);
      await mutate("DELETE FROM users WHERE id=?", [person.insertId]);
      for (const p of savedPlans)
        await admin("platform/plans/" + p.id, "PATCH", {
          name: p.name,
          monthly_price: p.monthly_price,
          trial_days: p.trial_days,
          limits:
            typeof p.limits === "string" ? JSON.parse(p.limits) : p.limits,
        });
      await mutate(
        "DELETE FROM platform_settings WHERE setting_key IN ('store_approval_required','billing_bank')",
      );
      for (const c of savedConfig)
        await mutate(
          "INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES(?,?,?)",
          [c.setting_key, c.setting_value, c.updated_by],
        );
      await mutate("DELETE FROM platform_integrations WHERE provider='sepay'");
      for (const c of savedCredentials)
        await mutate(
          "INSERT INTO platform_integrations(provider,webhook_secret,api_key,enabled,created_by) VALUES('sepay',?,?,?,?)",
          [c.webhook_secret, c.api_key, c.enabled, c.created_by],
        );
      await mutate(
        "DELETE FROM sepay_webhook_events WHERE provider_event_id LIKE ?",
        [`trial-webhook-${key}%`],
      );
    }
  });
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
