import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { pool, query, mutate } from "../lib/db";
import { withSystem, withStore } from "../lib/tenant";
import {
  advanceBilling,
  nextBillingDate,
  recordInvoicePayment,
} from "../lib/billing";
import {
  createIntent,
  platformBank,
  processWebhook,
  sepayCredentials,
} from "../lib/sepay";
import { passwordHash } from "../lib/auth";
import { processEmails } from "../lib/email";

assert(
  process.env.MYSQL_DATABASE === "fleur_saas_test" &&
    process.env.MYSQL_PORT === "3310",
  "Use isolated QA DB only",
);
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
const suffix = randomUUID().slice(0, 8);
const password = "Billing-Testing-2026-Only";
let checks = 0;
function check(value: unknown, label: string) {
  assert(value, label);
  console.log("PASS", label);
  checks++;
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
        .map((h) => h.split(";")[0])
        .join("; ");
    const data = await response.json();
    assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
    return data;
  };
}
async function transaction<T>(fn: (c: any) => Promise<T>) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

async function main() {
  return withSystem(async () => {
    const savedConfig = await query<any[]>(
      "SELECT * FROM platform_settings WHERE setting_key IN ('store_approval_required','billing_bank')",
    );
    const fixtures: number[] = [];
    const [adminUser] = await query<any[]>(
      "SELECT id FROM users WHERE email='owner@example.test'",
    );
    assert(adminUser, "Seed QA database first");
    const admin = client(),
      owner = client();
    await admin("auth/login", "POST", {
      email: "owner@example.test",
      password: "SaaS-Testing-2026-Only",
    });
    await mutate("INSERT IGNORE INTO platform_memberships(user_id) VALUES(?)", [
      adminUser.id,
    ]);
    const person = await mutate(
      "INSERT INTO users(name,email,password_hash,phone,address) VALUES(?,?,?,'0901234567','QA')",
      [
        "Billing Owner",
        `billing-${suffix}@example.test`,
        passwordHash(password),
      ],
    );
    await owner("auth/login", "POST", {
      email: `billing-${suffix}@example.test`,
      password,
    });
    try {
      check(
        nextBillingDate("2027-01-31") === "2027-02-28" &&
          nextBillingDate("2028-01-31") === "2028-02-29" &&
          nextBillingDate("2027-02-28", 31) === "2027-03-31",
        "Monthly periods retain anniversary across short months and leap years",
      );
      await admin("platform/config", "PATCH", { storeApprovalRequired: true });
      const free = await owner("stores", "POST", {
        name: "Billing Free " + suffix,
        slug: "bill-free-" + suffix,
        address: "123 Đường Hoa, Hà Nội",
        phone: "0901234567",
      });
      fixtures.push(free.id);
      // This suite retains coverage for grandfathered monthly stores.
      // New trial-first registrations are exercised in test-trial-billing.ts.
      await mutate("UPDATE subscriptions SET billing_policy=0,registration_plan_version_id=NULL,trial_days_granted=NULL,plan_version_id=NULL,status='free' WHERE store_id=?",[free.id]);
      const [pending] = await query<any[]>(
        "SELECT * FROM subscriptions WHERE store_id=?",
        [free.id],
      );
      check(
        !pending.current_period_start,
        "Waiting approval does not consume service days",
      );
      let detail = await admin("platform/stores/" + free.id);
      await admin(`platform/stores/${free.id}/status`, "PATCH", {
        status: "approved",
        reason: "Duyệt cửa hàng kiểm thử",
        version: detail.store.version,
      });
      let billing = await owner("workspace/billing", "GET", undefined, free.id);
      check(
        billing.subscription.status === "active" &&
          !!billing.subscription.current_period_start &&
          billing.subscription.period_end ===
            billing.subscription.current_period_end,
        "Approval activates subscription with synchronized period dates",
      );
      check(
        billing.invoices.length === 1 &&
          billing.invoices[0].status === "paid" &&
          billing.invoices[0].amount === 0,
        "Free approval creates zero-value settled invoice without cash payment",
      );
      await admin("platform/config", "PATCH", { storeApprovalRequired: false });
      const auto = await owner("stores", "POST", {
        name: "Billing Auto " + suffix,
        slug: "bill-auto-" + suffix,
        address: "123 Đường Hoa, Hà Nội",
        phone: "0901234567",
      });
      fixtures.push(auto.id);
      await mutate("DELETE FROM trial_claims WHERE store_id=?",[auto.id]);
      await mutate("UPDATE subscriptions SET billing_policy=0,registration_plan_version_id=NULL,trial_days_granted=NULL,plan_version_id=NULL,status='free',trial_started_at=NULL,trial_ends_at=NULL,access_started_at=NULL,access_ends_at=NULL,current_period_start=NULL,current_period_end=NULL,period_end=NULL WHERE store_id=?",[auto.id]);
      check(
        (await owner("workspace/billing", "GET", undefined, auto.id))
          .subscription.status === "active",
        "Grandfathered autoapproved store retains monthly billing workflow",
      );
      await mutate(
        "UPDATE subscriptions SET current_period_start=NULL,current_period_end=NULL WHERE store_id=?",
        [auto.id],
      );
      await advanceBilling(auto.id);
      const legacy = await owner(
        "workspace/billing",
        "GET",
        undefined,
        auto.id,
      );
      check(
        legacy.invoices.length === 1 &&
          legacy.subscription.current_period_end ===
            legacy.subscription.period_end,
        "Legacy period backfill reuses an existing invoice instead of charging twice",
      );
      await admin("platform/config", "PATCH", { storeApprovalRequired: true });
      const paid = await owner("stores", "POST", {
        name: "Billing Paid " + suffix,
        slug: "bill-paid-" + suffix,
        address: "123 Đường Hoa, Hà Nội",
        phone: "0901234567",
      });
      fixtures.push(paid.id);
      await mutate("UPDATE subscriptions SET plan_id=2,billing_policy=0,registration_plan_version_id=NULL,trial_days_granted=NULL,plan_version_id=NULL WHERE store_id=?", [
        paid.id,
      ]);
      detail = await admin("platform/stores/" + paid.id);
      await admin(`platform/stores/${paid.id}/status`, "PATCH", {
        status: "approved",
        reason: "Duyệt gói tính phí kiểm thử",
        version: detail.store.version,
      });
      billing = await owner("workspace/billing", "GET", undefined, paid.id);
      const initial = billing.invoices[0];
      check(
        initial.status === "open" &&
          initial.amount > 0 &&
          initial.period_end === billing.subscription.period_end,
        "Paid approval issues a real payable invoice for the initial service period",
      );
      const reference = "bill-initial-" + suffix;
      await admin(`platform/invoices/${initial.id}/payment`, "POST", {
        amount: initial.amount,
        reference,
      });
      const paidOnce = await owner(
        "workspace/billing",
        "GET",
        undefined,
        paid.id,
      );
      await admin(`platform/invoices/${initial.id}/payment`, "POST", {
        amount: initial.amount,
        reference,
      });
      check(
        (await owner("workspace/billing", "GET", undefined, paid.id))
          .subscription.period_end === paidOnce.subscription.period_end,
        "Manual payment retry never extends the period twice",
      );
      await mutate(
        "UPDATE subscriptions SET period_end=DATE_ADD(CURDATE(),INTERVAL 4 DAY),current_period_end=DATE_ADD(CURDATE(),INTERVAL 4 DAY),access_started_at=NULL,access_ends_at=NULL WHERE store_id=?",
        [paid.id],
      );
      await Promise.all([advanceBilling(paid.id), advanceBilling(paid.id)]);
      let [renewal] = await query<any[]>(
        "SELECT * FROM invoices WHERE store_id=? AND status='open'",
        [paid.id],
      );
      let [count] = await query<any[]>(
        "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='subscription_renewal_5d'",
        [paid.id],
      );
      check(
        count.n === 1 && !!renewal,
        "Concurrent worker runs create one renewal invoice and one 5-day reminder",
      );
      await mutate(
        "UPDATE invoices SET due_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),due_date=DATE_ADD(CURDATE(),INTERVAL 1 DAY) WHERE id=?",
        [renewal.id],
      );
      await advanceBilling(paid.id);
      await advanceBilling(paid.id);
      [count] = await query<any[]>(
        "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND dedupe_key=?",
        [paid.id, `subscription_renewal_1d:${renewal.id}`],
      );
      check(count.n === 1, "One-day reminder is deduplicated");
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
      await withStore(paid.id, () =>
        processEmails(100, async (message) => {
          sent.push(message);
          return "billing-test-" + message.id;
        }),
      );
      check(
        sent.filter(
          (m) =>
            m.subject.includes("sắp đến hạn") ||
            m.subject.includes("Còn 1 ngày"),
        ).length === 2 &&
          sent.every(
            (m) =>
              !m.body.includes("{{") &&
              m.recipient === `billing-${suffix}@example.test`,
          ),
        "5-day and 1-day messages render real invoice values and pass SMTP queue with mock delivery",
      );
      await mutate(
        "UPDATE invoices SET starts_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY),due_at=NULL,due_date=DATE_SUB(CURDATE(),INTERVAL 1 DAY) WHERE id=?",
        [renewal.id],
      );
      await advanceBilling(paid.id);
      const [frozen] = await query<any[]>("SELECT * FROM stores WHERE id=?", [
        paid.id,
      ]);
      check(
        frozen.status === "suspended" && frozen.billing_suspended === 1,
        "Any overdue unpaid invoice freezes store immediately without seven-day grace",
      );
      await admin(
        `platform/stores/${paid.id}/status`,
        "PATCH",
        {
          status: "approved",
          reason: "Thử mở lại khi còn công nợ",
          version: frozen.version,
        },
        1,
        409,
      );
      check(
        true,
        "Platform cannot silently reopen a store with outstanding overdue debt",
      );
      billing = await owner("workspace/billing", "GET", undefined, paid.id);
      check(
        billing.store.status === "suspended" &&
          billing.store.suspension_reason.includes("thanh toán"),
        "Frozen owner can still open billing and see the suspension reason",
      );
      await owner("workspace/settings", "PATCH", {}, paid.id, 403);
      check(true, "Frozen store cannot mutate operational settings");
      const notices = await owner(
        "admin/notifications",
        "GET",
        undefined,
        paid.id,
      );
      check(
        notices.items.some(
          (i: any) => i.type === "system" && i.title.includes("đóng băng"),
        ),
        "Freeze is visible in store bell/inbox",
      );
      await admin(`platform/invoices/${renewal.id}/payment`, "POST", {
        amount: 1000,
        reference: "partial-" + suffix,
      });
      check(
        (await owner("workspace/billing", "GET", undefined, paid.id)).store
          .status === "suspended",
        "Partial invoice payment does not restore frozen store",
      );
      await admin("platform/config", "PATCH", {
        billingBank: {
          bank_code: "MB",
          bank_name: "MB Bank",
          account_number: "123456789",
          account_holder: "PLATFORM QA",
          enabled: true,
        },
      });
      const qr = await owner(
        "workspace/billing/start",
        "POST",
        { plan_id: 2, invoice_id: renewal.id },
        paid.id,
      );
      check(
        qr.payment.amount === renewal.amount - 1000 &&
          qr.payment.bank.account_holder === "PLATFORM QA",
        "Renewal QR charges remaining invoice debt to platform bank, not merchant bank",
      );
      const credentials = await sepayCredentials();
      if (!credentials)
        process.env.SEPAY_WEBHOOK_SECRET = "billing-qa-signature-secret";
      const event = {
        id: "bill-sepay-" + suffix,
        referenceCode: "bill-sepay-ref-" + suffix,
        content: qr.payment.code,
        transferAmount: qr.payment.amount,
        transferType: "in",
        accountNumber: "123456789",
      };
      const raw = JSON.stringify(event);
      const headers = new Headers(
        credentials?.api_key
          ? { "x-api-key": credentials.api_key }
          : {
              "x-signature": createHmac(
                "sha256",
                process.env.SEPAY_WEBHOOK_SECRET!,
              )
                .update(raw)
                .digest("hex"),
            },
      );
      await processWebhook(raw, event, headers);
      const afterWebhook = await owner(
        "workspace/billing",
        "GET",
        undefined,
        paid.id,
      );
      await processWebhook(raw, event, headers);
      check(
        afterWebhook.store.status === "approved" &&
          afterWebhook.subscription.status === "active",
        "SePay full settlement automatically restores billing suspension",
      );
      check(
        afterWebhook.subscription.period_end ===
          (await owner("workspace/billing", "GET", undefined, paid.id))
            .subscription.period_end,
        "Duplicate SePay webhook neither collects nor extends twice",
      );
      [count] = await query<any[]>(
        "SELECT COUNT(*) n FROM billing_payments WHERE invoice_id=?",
        [renewal.id],
      );
      check(
        count.n === 2,
        "Partial manual payment and webhook share one invoice ledger",
      );
      detail = await admin("platform/stores/" + paid.id);
      const endBefore = detail.subscription.period_end;
      await admin(`platform/stores/${paid.id}/status`, "PATCH", {
        status: "suspended",
        reason: "Khóa kiểm thử bởi admin platform",
        version: detail.store.version,
      });
      const [manual] = await query<any[]>("SELECT * FROM stores WHERE id=?", [
        paid.id,
      ]);
      check(
        manual.status === "suspended" && manual.billing_suspended === 0,
        "Platform freeze records manual source and reason",
      );
      await owner(
        "workspace/billing/start",
        "POST",
        { plan_id: 2, trial: true },
        paid.id,
        409,
      );
      check(
        true,
        "A frozen store cannot bypass its suspension by claiming a trial",
      );
      const badEvent = {
        ...event,
        id: "bill-wrong-bank-" + suffix,
        accountNumber: "999999999",
      };
      const badRaw = JSON.stringify(badEvent);
      // A fresh pending QR must reject a transfer to a different destination account.
      const wrongInvoice = await mutate(
        "INSERT INTO invoices(store_id,period_key,plan_name,amount,due_date) VALUES(?,?,'QA bank',1000,CURDATE())",
        [paid.id, "bank-" + suffix],
      );
      const wrongQr = await transaction(async (c) =>
        createIntent(
          c,
          paid.id,
          "subscription",
          person.insertId,
          1000,
          null,
          wrongInvoice.insertId,
          (await platformBank(c))!,
        ),
      );
      badEvent.content = wrongQr.code;
      const wrongRaw = JSON.stringify(badEvent);
      const wrongHeaders = credentials?.api_key
        ? headers
        : new Headers({
            "x-signature": createHmac(
              "sha256",
              process.env.SEPAY_WEBHOOK_SECRET!,
            )
              .update(wrongRaw)
              .digest("hex"),
          });
      await assert.rejects(
        () => processWebhook(wrongRaw, badEvent, wrongHeaders),
        /Tài khoản nhận tiền/,
      );
      await mutate("UPDATE invoices SET status='void' WHERE id=?", [
        wrongInvoice.insertId,
      ]);
      check(true, "SePay rejects transfers to a mismatched bank account");
      const [extra] = await query<any[]>(
        "SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') start,DATE_FORMAT(DATE_ADD(CURDATE(),INTERVAL 2 MONTH),'%Y-%m-%d') finish",
      );
      const custom = await mutate(
        "INSERT INTO invoices(store_id,period_key,plan_name,amount,due_date,period_start,period_end) VALUES(?,?,'QA',1000,CURDATE(),?,?)",
        [paid.id, "manual-" + suffix, extra.start, extra.finish],
      );
      await transaction((c) =>
        recordInvoicePayment(
          c,
          custom.insertId,
          1000,
          "manual-freeze-" + suffix,
          adminUser.id,
        ),
      );
      check(
        (await owner("workspace/billing", "GET", undefined, paid.id)).store
          .status === "suspended",
        "Payment never overrides administrative freeze",
      );
      detail = await admin("platform/stores/" + paid.id);
      await admin(`platform/stores/${paid.id}/status`, "PATCH", {
        status: "approved",
        reason: "Mở lại sau kiểm thử admin",
        version: detail.store.version,
      });
      const reopened = await owner(
        "workspace/billing",
        "GET",
        undefined,
        paid.id,
      );
      check(
        reopened.store.status === "approved" &&
          reopened.subscription.period_end >= endBefore,
        "Admin reopening does not reset paid subscription dates",
      );
      const futureQr = await owner(
        "workspace/billing/start",
        "POST",
        { plan_id: 2 },
        paid.id,
      );
      await owner(
        "workspace/billing/cancel",
        "POST",
        { cancel: true },
        paid.id,
      );
      const [voidRenewal] = await query<any[]>(
        "SELECT i.status,p.status intent_status FROM invoices i JOIN payment_intents p ON p.invoice_id=i.id WHERE i.id=?",
        [futureQr.invoiceId],
      );
      check(
        voidRenewal.status === "void" &&
          voidRenewal.intent_status === "cancelled",
        "Stopping renewal voids the unused next-period invoice and its pending QR",
      );
      await owner(
        "workspace/billing/cancel",
        "POST",
        { cancel: false },
        paid.id,
      );
      const restartQr = await owner(
        "workspace/billing/start",
        "POST",
        { plan_id: 2 },
        paid.id,
      );
      check(
        restartQr.invoiceId !== futureQr.invoiceId,
        "Resuming renewal can replace a voided invoice without reviving its old QR",
      );
      await mutate(
        "UPDATE subscriptions SET period_end=DATE_SUB(CURDATE(),INTERVAL 2 DAY),current_period_end=DATE_SUB(CURDATE(),INTERVAL 2 DAY),cancel_at_period_end=1 WHERE store_id=?",
        [auto.id],
      );
      await advanceBilling(auto.id);
      const [cancelled] = await query<any[]>(
        "SELECT s.status,sub.status subscription_status FROM stores s JOIN subscriptions sub ON sub.store_id=s.id WHERE s.id=?",
        [auto.id],
      );
      check(
        cancelled.status === "suspended" &&
          cancelled.subscription_status === "cancelled",
        "Cancel-at-period-end stops service and freezes store at expiry",
      );
      await mutate(
        "UPDATE subscriptions SET period_end=DATE_SUB(CURDATE(),INTERVAL 2 DAY),current_period_end=DATE_SUB(CURDATE(),INTERVAL 2 DAY) WHERE store_id=?",
        [free.id],
      );
      await mutate(
        "UPDATE invoices SET period_key=CONCAT('history:',id),period_start=DATE_SUB(CURDATE(),INTERVAL 1 MONTH),period_end=DATE_SUB(CURDATE(),INTERVAL 2 DAY) WHERE store_id=?",
        [free.id],
      );
      await advanceBilling(free.id);
      check(
        (await owner("workspace/billing", "GET", undefined, free.id)).store
          .status === "approved",
        "Zero-price packages renew without freezing the merchant",
      );
      if (process.argv.includes("--ui")) {
        const { chromium, expect } = await import("@playwright/test");
        const { mkdir } = await import("node:fs/promises");
        await mkdir(".local/billing-qa", { recursive: true });
        const browser = await chromium.launch({ headless: true });
        try {
          const errors: string[] = [];
          const adminContext = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
          });
          await adminContext.request.post(base + "/api/auth/login", {
            headers: { origin: base, "x-fleur-store": "1" },
            data: {
              email: "owner@example.test",
              password: "SaaS-Testing-2026-Only",
            },
          });
          const page = await adminContext.newPage();
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(base + "/platform/stores");
          const row = page
            .getByRole("row")
            .filter({ hasText: "Billing Free " + suffix });
          await row
            .getByRole("button", { name: "Đóng băng", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Đóng băng Billing Free " + suffix,
          });
          await expect(dialog).toBeVisible();
          await dialog
            .getByRole("textbox", { name: "Lý do đóng băng" })
            .fill("Tạm đóng băng để kiểm thử giao diện");
          await page.screenshot({
            path: ".local/billing-qa/platform-freeze-desktop.png",
          });
          const rect = await dialog.boundingBox();
          check(
            !!rect && rect.x >= 0 && rect.x + rect.width <= 1440,
            "Freeze dialog fits desktop viewport",
          );
          await dialog
            .getByRole("button", { name: "Đóng băng cửa hàng", exact: true })
            .click();
          await expect(dialog).not.toBeVisible();
          await expect(
            row.getByText("Đóng băng", { exact: true }),
          ).toBeVisible();
          check(
            true,
            "Platform freeze action updates store row through the real modal",
          );
          const ownerContext = await browser.newContext({
            viewport: { width: 390, height: 844 },
            reducedMotion: "reduce",
          });
          await ownerContext.request.post(base + "/api/auth/login", {
            headers: { origin: base, "x-fleur-store": String(free.id) },
            data: { email: `billing-${suffix}@example.test`, password },
          });
          const mobile = await ownerContext.newPage();
          mobile.on("pageerror", (e) => errors.push(e.message));
          await mobile.goto(base + `/workspace/${free.id}/billing`);
          await expect(
            mobile.getByRole("heading", {
              name: "Hóa đơn dịch vụ",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            mobile
              .getByRole("heading", { name: "Cửa hàng đang tạm đóng băng" })
              .first(),
          ).toBeVisible();
          await expect(
            mobile.getByText("Tạm đóng băng để kiểm thử giao diện").first(),
          ).toBeVisible();
          await mobile.screenshot({
            path: ".local/billing-qa/frozen-billing-mobile.png",
            fullPage: true,
          });
          check(
            await mobile.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "Frozen billing and invoice table fit mobile without page overflow",
          );
          check(
            errors.length === 0,
            "Platform/store billing UI has no uncaught browser errors",
          );
        } finally {
          await browser.close();
        }
      }
      console.log(`${checks} billing checks passed`);
    } finally {
      for (const sid of fixtures) {
        for (const table of [
          "email_outbox",
          "email_templates",
          "notifications",
          "trial_claims","account_trial_claims",
          "subscriptions",
          "store_memberships",
          "payment_intents",
          "audit_logs",
        ])
          await mutate(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
        await mutate(
          "DELETE bp FROM billing_payments bp JOIN invoices i ON i.id=bp.invoice_id WHERE i.store_id=?",
          [sid],
        );
        await mutate("DELETE FROM invoices WHERE store_id=?", [sid]);
        await mutate("DELETE FROM stores WHERE id=?", [sid]);
      }
      await mutate("DELETE FROM sessions WHERE user_id=?", [person.insertId]);
      await mutate("DELETE FROM users WHERE id=?", [person.insertId]);
      await mutate(
        "DELETE FROM platform_settings WHERE setting_key IN ('store_approval_required','billing_bank')",
      );
      for (const config of savedConfig)
        await mutate(
          "INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES(?,?,?)",
          [config.setting_key, config.setting_value, config.updated_by],
        );
    }
  });
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
