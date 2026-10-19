import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { once } from "node:events";
import mysql from "mysql2/promise";
import { chromium, expect } from "@playwright/test";
import { testOrderPaymentStatus } from "./test-order-payment-status.mjs";
import { testProductTaxonomy } from "./test-product-taxonomy.mjs";

// A disposable full-schema database; never writes fixtures into the user's DB.
assert(
  ["127.0.0.1", "localhost"].includes(process.env.MYSQL_HOST || "127.0.0.1"),
);
const database = "fleur_onboarding_qa_" + randomBytes(6).toString("hex");
const port = Number(process.env.ONBOARDING_TEST_PORT || 3011),
  origin = `http://127.0.0.1:${port}`;
const password = "Onboarding-QA-2026-Only";
const dist = ".next-onboarding-qa";
const env = {
  ...process.env,
  MYSQL_DATABASE: database,
  MYSQL_SSL: "false",
  APP_ORIGIN: origin,
  ADMIN_EMAIL: "platform@example.test",
  ADMIN_PASSWORD: password,
  EMAIL_ENABLED: "false",
  GOONG_API_KEY: "",
  NEXT_PUBLIC_GOONG_MAPTILES_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  FLEUR_DIST_DIR: dist,
  NEXT_TELEMETRY_DISABLED: "1",
};
const db = await mysql.createConnection({
  host: env.MYSQL_HOST || "127.0.0.1",
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER || "root",
  password: env.MYSQL_PASSWORD,
  dateStrings: true,
});
const saved = await Promise.all(
  ["tsconfig.json", "next-env.d.ts"].map(async (p) => [
    p,
    await readFile(p, "utf8"),
  ]),
);
let server,
  browser,
  log = "",
  checks = 0;
const check = (v, label) => {
  assert(v, label);
  checks++;
  console.log("PASS", label);
};
async function run(file, args = []) {
  const child = spawn(process.execPath, [file, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
}
function client() {
  const jar = new Map();
  return {
    jar,
    async call(path, method = "GET", body, status = 200, sid = 1) {
      const r = await fetch(origin + "/api/" + path, {
        method,
        headers: {
          origin,
          "content-type": "application/json",
          "x-fleur-store": String(sid),
          cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      for (const h of r.headers.getSetCookie()) {
        const [k, v] = h.split(";")[0].split("=");
        if (v) jar.set(k, v);
        else jar.delete(k);
      }
      const d = await r.json();
      assert.equal(r.status, status, path + ": " + JSON.stringify(d));
      return d;
    },
  };
}
async function register(email) {
  const c = client();
  await c.call("auth/register", "POST", {
    name: "Chủ tiệm QA",
    email,
    password,
    phone: "0901234567",
  });
  return c;
}
async function createStore(c, slug, planId = 1) {
  const plans = await c.call("billing/plans"),
    p = plans.find((p) => p.id === planId);
  return c.call("stores", "POST", {
    name: "Tiệm " + slug,
    slug,
    address: "12 Nguyễn Huệ, Thành phố Hồ Chí Minh",
    phone: "0901234567",
    plan_id: planId,
    offer_version_id: p.offer_version_id,
  });
}
const one = async (sql, args = []) => (await db.execute(sql, args))[0][0];
try {
  await run("scripts/setup-saas.mjs");
  await db.query("USE " + database);
  const adminUser = await one("SELECT id FROM users WHERE email=?", [
    "platform@example.test",
  ]);
  await db.execute("INSERT INTO platform_memberships(user_id) VALUES(?)", [
    adminUser.id,
  ]);
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  server.stdout.on("data", (d) => {
    log = (log + d).slice(-20000);
  });
  server.stderr.on("data", (d) => {
    log = (log + d).slice(-20000);
  });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(origin + "/api/billing/plans", {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) break;
    } catch {}
    if (i === 119) throw Error("QA server not ready: " + log);
    await new Promise((r) => setTimeout(r, 500));
  }
  const admin = client(),
    anon = client();
  await admin.call("auth/login", "POST", {
    email: "platform@example.test",
    password,
  });
  await admin.call("platform/config", "PATCH", { storeApprovalRequired: true });
  let plans = await admin.call("platform/plans");
  const updatePlan = async (id, days, emailLimit) => {
    const p = plans.find((p) => p.id === id);
    await admin.call("platform/plans/" + id, "PATCH", {
      name: p.name,
      monthly_price: p.monthly_price,
      trial_days: days,
      limits: { ...p.limits, email_sends: emailLimit },
    });
  };
  await updatePlan(1, 7, 123);
  await updatePlan(2, 11, 567);
  const owner = await register("owner-qa@example.test"),
    untouched = await register("fresh-qa@example.test");
  const first = await createStore(owner, "pending-qa");
  check(first.status === "pending", "Registration waits for platform approval");
  const pending = await one(
    "SELECT * FROM email_outbox WHERE store_id=? AND template_key='store_registration_pending'",
    [first.id],
  );
  check(
    pending?.recipient === "owner-qa@example.test" &&
      pending.body.includes("Tiệm pending-qa") &&
      pending.status === "pending",
    "Owner receives a queued pending-registration email with store identity",
  );
  await owner.call("workspace/settings", "PATCH", {}, 403, first.id);
  const before = await one("SELECT * FROM subscriptions WHERE store_id=?", [
    first.id,
  ]);
  check(
    !before.trial_ends_at && before.trial_days_granted === 7,
    "Pending registration snapshots N days without starting the clock",
  );
  await updatePlan(1, 9, 321);
  const storeDetail = await admin.call("platform/stores/" + first.id);
  await admin.call("platform/stores/" + first.id + "/status", "PATCH", {
    status: "approved",
    version: storeDetail.store.version,
    reason: "Duyệt đăng ký kiểm thử",
  });
  const sub = await one(
    "SELECT *,TIMESTAMPDIFF(DAY,trial_started_at,trial_ends_at) days FROM subscriptions WHERE store_id=?",
    [first.id],
  );
  check(
    sub.status === "trialing" && sub.days === 7,
    "Approval starts the original N-day trial despite later catalog edits",
  );
  const approved = await one(
    "SELECT * FROM email_outbox WHERE store_id=? AND template_key='store_approved'",
    [first.id],
  );
  check(
    approved?.recipient === pending.recipient &&
      approved.body.includes("/workspace/" + first.id),
    "Approval queues the workspace email to the correct account",
  );
  const billing = await owner.call(
    "workspace/billing",
    "GET",
    undefined,
    200,
    first.id,
  );
  check(
    billing.usage.email_sends === 0 &&
      billing.subscription.limits.email_sends === 123,
    "Workspace usage excludes system email and keeps the plan allowance snapshot",
  );
  const freshPlans = await untouched.call("billing/plans");
  check(
    freshPlans.find((p) => p.id === 1).trial_days === 9 &&
      freshPlans.find((p) => p.id === 2).trial_days === 11,
    "New registrations see the configured N for each package",
  );
  const againPlans = await owner.call("billing/plans");
  check(
    !againPlans.find((p) => p.id === 1).registration_trial_available &&
      againPlans.find((p) => p.id === 2).registration_trial_available,
    "Used starter entitlement is not falsely advertised as another free trial",
  );
  const second = await createStore(untouched, "second-qa", 2);
  await admin.call("platform/config", "PATCH", {
    storeApprovalRequired: false,
  });
  check(
    (await one("SELECT status FROM stores WHERE id=?", [second.id])).status ===
      "approved" &&
      (
        await one(
          "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='store_approved'",
          [second.id],
        )
      ).n === 1,
    "Disabling approval activates pending stores and queues approval once",
  );
  await admin.call("platform/config", "PATCH", {
    storeApprovalRequired: false,
  });
  check(
    (
      await one(
        "SELECT COUNT(*) n FROM email_outbox WHERE store_id=? AND template_key='store_approved'",
        [second.id],
      )
    ).n === 1,
    "Repeated approval configuration cannot duplicate the approval email",
  );
  const directOwner = await register("direct-qa@example.test");
  const direct = await createStore(directOwner, "direct-qa");
  check(
    direct.status === "approved" &&
      (
        await one(
          "SELECT trial_days_granted FROM subscriptions WHERE store_id=?",
          [direct.id],
        )
      ).trial_days_granted === 9,
    "Automatic approval grants the latest configured N",
  );
  await updatePlan(3, 0, 1000);
  const paidOwner = await register("paid-qa@example.test");
  await admin.call("platform/config", "PATCH", { storeApprovalRequired: true });
  const paid = await createStore(paidOwner, "paid-qa", 3);
  const paidDetail = await admin.call("platform/stores/" + paid.id);
  await admin.call("platform/stores/" + paid.id + "/status", "PATCH", {
    status: "approved",
    version: paidDetail.store.version,
    reason: "Duyệt gói cần thanh toán",
  });
  check(
    !!(await one(
      "SELECT id FROM email_outbox WHERE store_id=? AND template_key='store_approved'",
      [paid.id],
    )),
    "Approval notification is sent even when the chosen package requires payment",
  );
  await db.execute(
    "INSERT INTO customers(store_id,name,email,phone,segment,marketing_consent) VALUES(?,?,?,?,'new',1)",
    [first.id, "Khách QA", "buyer@example.test", "0909876543"],
  );
  const customer = await one("SELECT id FROM customers WHERE store_id=?", [
    first.id,
  ]);
  await db.execute(
    "INSERT INTO customers(store_id,name,email,phone,segment) VALUES(?,?,?,?,'loyal')",
    [second.id, "Khách tiệm khác", "buyer@example.test", "0909876543"],
  );
  await anon.call("platform/emails", "GET", undefined, 401);
  await owner.call("platform/emails", "GET", undefined, 403);
  await admin.call("platform/crm", "GET", undefined, 404);
  const crm = await owner.call("admin/crm", "GET", undefined, 200, first.id);
  check(
    crm.customers.length === 1 && crm.customers[0].id === customer.id,
    "Store CRM restored with tenant isolation",
  );
  const path = "admin/crm/" + customer.id;
  await owner.call(
    path,
    "PATCH",
    { segment: "vip", birthday: "2000-02-29" },
    200,
    first.id,
  );
  await owner.call(
    path + "/notes",
    "POST",
    { content: "Khách thích hoa màu trắng." },
    200,
    first.id,
  );
  await owner.call(
    path + "/tasks",
    "POST",
    { title: "Gọi chăm sóc khách", due_date: "2026-12-01" },
    200,
    first.id,
  );
  const profile = await owner.call(
    "admin/crm",
    "GET",
    undefined,
    200,
    first.id,
  );
  await owner.call(
    path + "/tasks",
    "PATCH",
    { id: profile.tasks[0].id, status: "done" },
    200,
    first.id,
  );
  await untouched.call(
    path,
    "PATCH",
    { segment: "new", birthday: null },
    404,
    second.id,
  );
  await untouched.call(
    path + "/notes",
    "POST",
    { content: "Cross tenant write" },
    404,
    second.id,
  );
  const final = await owner.call("admin/crm", "GET", undefined, 200, first.id);
  check(
    final.customers[0].segment === "vip" &&
      final.notes.length === 1 &&
      final.tasks[0].status === "done",
    "Restored CRM supports notes, segments and tasks without crossing stores",
  );
  const mailData = await admin.call("platform/emails");
  const keys = mailData.templates.map((t) => t.template_key);
  check(
    [
      "account_welcome",
      "account_password_reset",
      "store_registration_pending",
      "store_approved",
      "subscription_registered",
      "subscription_changed",
      "subscription_change_confirmed",
      "subscription_renewal_5d",
      "subscription_renewal_1d",
      "subscription_renewed",
      "subscription_trial_started",
      "subscription_trial_expired",
    ].every((k) => keys.includes(k)),
    "Platform contains all account/store/subscription lifecycle templates",
  );
  check(
    (
      await one(
        "SELECT COUNT(*) n FROM identity_mail WHERE template_key='account_welcome' AND recipient='owner-qa@example.test'",
      )
    ).n === 1,
    "Account registration queues welcome exactly once",
  );
  const t = mailData.templates.find((t) => t.template_key === "store_approved");
  await admin.call("platform/emails/templates/" + t.id, "PATCH", {
    ...t,
    subject: "Đã chấp thuận {{store_name}}",
  });
  await admin.call("platform/emails/templates/" + t.id, "PATCH", t, 409);
  const welcome = mailData.templates.find(
    (t) => t.template_key === "account_welcome",
  );
  await admin.call(
    "platform/emails/templates/" + welcome.id,
    "PATCH",
    { ...welcome, body: "Nội dung thiếu liên kết bắt buộc" },
    400,
  );
  await admin.call(
    "platform/emails/templates/" + welcome.id,
    "PATCH",
    { ...welcome, active: 0 },
    400,
  );
  check(
    true,
    "Platform template edits enforce version, required variables and essential delivery",
  );
  const wsEmails = await owner.call(
    "admin/emails",
    "GET",
    undefined,
    200,
    first.id,
  );
  check(
    wsEmails.templates.length === 6 &&
      !wsEmails.templates.some((t) =>
        t.template_key.startsWith("subscription_"),
      ),
    "Store retains six editable order/CRM templates without platform templates",
  );
  const wt = wsEmails.templates.find(
    (t) => t.template_key === "order_confirmation",
  );
  await owner.call(
    "admin/emails/templates/" + wt.id,
    "PATCH",
    { ...wt, subject: "Tiệm riêng · {{order_reference}}" },
    200,
    first.id,
  );
  await untouched.call(
    "admin/emails/templates/" + wt.id,
    "PATCH",
    wt,
    404,
    second.id,
  );
  const reset = await one(
    "SELECT id FROM users WHERE email='owner-qa@example.test'",
  );
  await owner.call("auth/forgot-password", "POST", {
    email: "owner-qa@example.test",
  });
  const resetMail = await one(
    "SELECT id FROM identity_mail WHERE template_key='account_password_reset' AND user_id=?",
    [reset.id],
  );
  const hidden = await admin.call(
    "platform/emails/message/account-" + resetMail.id,
    "POST",
    {},
  );
  check(
    !hidden.html.includes("token=") && hidden.html.includes("được ẩn"),
    "Platform history never exposes live password reset links",
  );
  const previewInput = {
    requestKey: crypto.randomUUID(),
    name: "Tin nền tảng",
    templateId: mailData.templates.find((t) => t.kind === "marketing").id,
    segment: "all",
    message: "Thông tin mới cho cửa hàng",
  };
  await db.execute(
    "UPDATE users SET marketing_consent=1 WHERE email='owner-qa@example.test'",
  );
  const preview = await admin.call(
    "platform/emails/preview-campaign",
    "POST",
    previewInput,
  );
  check(
    preview.count === 1 &&
      preview.recipients[0].email === "owner-qa@example.test",
    "Platform programs target opted-in accounts, not store customer lists",
  );
  await admin.call("platform/health", "GET", undefined, 404);
  check(true, "Retired integration/queue navigation remains removed");

  browser = await chromium.launch({ headless: true });
  const errors = [];
  async function pageFor(c, width = 1440) {
    const ctx = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    await ctx.addCookies(
      [...c.jar].map(([name, value]) => ({ name, value, url: origin })),
    );
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    return p;
  }
  const fresh = await register("ui-qa@example.test");
  const page = await pageFor(fresh);
  await page.goto(origin + "/start");
  await expect(page.locator(".start-store-plan-card")).toHaveCount(3);
  await expect(page.locator(".start-store-plan-card").first()).toContainText(
    "9 ngày dùng thử",
  );
  await expect(page.locator(".start-store-plan-card").nth(1)).toContainText(
    "11 ngày dùng thử",
  );
  await expect(page.locator(".start-store-plan-card").nth(2)).not.toContainText(
    "ngày dùng thử",
  );
  const boxes = await Promise.all(
    [".start-store-plans", ".start-store-form"].map((s) =>
      page.locator(s).boundingBox(),
    ),
  );
  check(
    boxes[0].x < boxes[1].x &&
      boxes[0].width / boxes[1].width > 1.8 &&
      Math.abs(boxes[0].y - boxes[1].y) < 3,
    "Desktop registration shows three plan cards in the left two-thirds and the form on the right",
  );
  await page.locator(".start-store-plan-card").nth(1).click();
  await expect(page.locator(".start-store-selected-plan")).toContainText(
    "11 ngày dùng thử",
  );
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({
    path: ".local/screenshots/onboarding-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile registration has no horizontal overflow",
  );
  await page.screenshot({
    path: ".local/screenshots/onboarding-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  check(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        [...document.querySelectorAll(".start-store-plan-card")].every(
          (el) => el.scrollWidth <= el.clientWidth + 1,
        ),
    ),
    "Plan card contents fit intermediate desktop widths",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Tên cửa hàng", { exact: true }).fill("Tiệm UI");
  await page.getByLabel("Đường dẫn store", { exact: true }).fill("ui-qa");
  await page
    .getByLabel("Địa chỉ cửa hàng", { exact: true })
    .fill("12 Nguyễn Huệ, Hồ Chí Minh");
  await page.getByLabel("Điện thoại", { exact: true }).fill("0901234567");
  let release;
  const paused = new Promise((r) => (release = r));
  let submissions = 0;
  await page.route("**/api/stores", async (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      await paused;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Tạo cửa hàng", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Đang tạo cửa hàng…", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".start-store-plan-card").first()).toBeDisabled();
  release();
  await page.waitForURL("**/start/pending?store=*");
  check(
    submissions === 1,
    "Registration shows loading, prevents resubmission and opens the pending page",
  );
  const pp = await pageFor(admin);
  await pp.goto(origin + "/platform/emails");
  await expect(
    pp.getByRole("heading", { name: "Email & chương trình", exact: true }),
  ).toBeVisible();
  await pp.getByRole("button", { name: /Chào mừng tài khoản mới/ }).click();
  await expect(pp.getByLabel("Tiêu đề email", { exact: true })).toHaveValue(
    welcome.subject,
  );
  await pp
    .getByLabel("Tiêu đề email", { exact: true })
    .fill("Xin chào {{customer_name}} · Fleurious");
  await pp.getByRole("button", { name: "Lưu mẫu", exact: true }).click();
  await expect(
    pp.getByRole("button", { name: "Lưu mẫu", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(
      async () =>
        (
          await one("SELECT subject FROM platform_email_templates WHERE id=?", [
            welcome.id,
          ])
        ).subject,
    )
    .toBe("Xin chào {{customer_name}} · Fleurious");
  await pp.getByRole("tab", { name: "Chương trình nền tảng" }).click();
  await expect(
    pp.getByRole("heading", { name: "Gửi một chương trình" }),
  ).toBeVisible();
  await pp.getByRole("tab", { name: "Lịch sử gửi" }).click();
  await expect(
    pp.locator(".email-table-scroll tbody tr").first(),
  ).toBeVisible();
  check(
    (await pp.locator('.admin-sidebar a[href="/platform/crm"]').count()) === 0,
    "Platform email UI saves templates and shows programs/history without customer CRM",
  );
  await pp.setViewportSize({ width: 390, height: 844 });
  check(
    await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "Platform email UI fits mobile",
  );
  await pp.screenshot({
    path: ".local/screenshots/platform-email-mobile.png",
    fullPage: true,
  });
  const wp = await pageFor(owner);
  await wp.goto(origin + "/workspace/" + first.id + "/crm");
  await expect(wp.getByLabel("Tìm khách hàng")).toBeVisible();
  await wp.getByLabel("Tìm khách hàng").fill("Khách QA");
  await expect(wp.locator("tbody tr")).toHaveCount(1);
  await wp
    .getByRole("button", { name: "Mở hồ sơ khách hàng", exact: true })
    .click();
  await expect(wp.getByRole("dialog")).toContainText(
    "Khách thích hoa màu trắng.",
  );
  check(true, "Store CRM profile retains original customer notes and UI");
  check(
    errors.length === 0,
    "Onboarding, store CRM and platform emails have no browser errors",
  );
  await run("node_modules/tsx/dist/cli.mjs", [
    "scripts/test-platform-email-worker.ts",
  ]);
  check(
    true,
    "Platform campaigns and billing email workers pass integration checks",
  );
  // Staff-recorded marketing consent, through the real CRM UI and scoped APIs.
  const buyer = await register("buyer@example.test");
  const buyerUser = await one(
    "SELECT id,marketing_consent FROM users WHERE email='buyer@example.test'",
  );
  await db.execute(
    "INSERT INTO notification_preferences(user_id,store_id,marketing,push) VALUES(?,?,0,1),(?,?,0,1)",
    [buyerUser.id, first.id, buyerUser.id, second.id],
  );
  const consentPath = path + "/marketing-consent";
  await buyer.call(
    consentPath,
    "PATCH",
    { consent: true, previousConsent: true, confirmed: true },
    403,
    first.id,
  );
  await untouched.call(
    consentPath,
    "PATCH",
    { consent: false, previousConsent: true },
    404,
    second.id,
  );
  await owner.call(
    consentPath,
    "PATCH",
    { consent: true, previousConsent: true },
    400,
    first.id,
  );
  check(
    true,
    "Manual marketing consent requires CRM permission, store ownership and explicit confirmation",
  );
  const [queuedMarketing] = await db.execute(
    "INSERT INTO email_outbox(store_id,dedupe_key,template_key,kind,recipient,customer_id,subject,body) VALUES(?,'manual-consent-marketing','crm_qa','marketing','buyer@example.test',?,'QA','QA body')",
    [first.id, customer.id],
  );
  const [queuedOrder] = await db.execute(
    "INSERT INTO email_outbox(store_id,dedupe_key,template_key,kind,recipient,customer_id,subject,body) VALUES(?,'manual-consent-order','order_confirmation','transactional','buyer@example.test',?,'QA order','QA body')",
    [first.id, customer.id],
  );
  const dialog = wp.getByRole("dialog");
  await chooseSelect(nativeSelect(dialog, "Trạng thái tiếp thị"), "0");
  await dialog
    .getByLabel("Ghi chú xác nhận (không bắt buộc)", { exact: true })
    .fill("Khách yêu cầu ngừng nhận qua điện thoại.");
  await dialog
    .getByRole("button", { name: "Lưu lựa chọn tiếp thị", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Lưu lựa chọn tiếp thị", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(
      async () =>
        (
          await one("SELECT marketing_consent FROM customers WHERE id=?", [
            customer.id,
          ])
        ).marketing_consent,
    )
    .toBe(0);
  check(
    (
      await one("SELECT status FROM email_outbox WHERE id=?", [
        queuedMarketing.insertId,
      ])
    ).status === "cancelled" &&
      (
        await one("SELECT status FROM email_outbox WHERE id=?", [
          queuedOrder.insertId,
        ])
      ).status === "pending",
    "Manual opt-out cancels queued marketing while preserving order emails",
  );
  check(
    (
      await one(
        "SELECT marketing,push FROM notification_preferences WHERE user_id=? AND store_id=?",
        [buyerUser.id, first.id],
      )
    ).marketing === 0,
    "CRM opt-out synchronizes the buyer's store notification preference",
  );
  await chooseSelect(nativeSelect(dialog, "Trạng thái tiếp thị"), "1");
  await expect(
    dialog.getByRole("button", { name: "Lưu lựa chọn tiếp thị", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", {
      name: "Khách đã đồng ý nhận email tiếp thị từ cửa hàng; tôi xác nhận ghi nhận thay khách.",
      exact: true,
    })
    .check();
  await dialog
    .getByLabel("Ghi chú xác nhận (không bắt buộc)", { exact: true })
    .fill("Khách xác nhận lại qua tin nhắn.");
  await dialog
    .getByRole("button", { name: "Lưu lựa chọn tiếp thị", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await one("SELECT marketing_consent FROM customers WHERE id=?", [
            customer.id,
          ])
        ).marketing_consent,
    )
    .toBe(1);
  await expect(dialog).toContainText("Khách xác nhận lại qua tin nhắn.");
  const preference = await one(
    "SELECT marketing,push FROM notification_preferences WHERE user_id=? AND store_id=?",
    [buyerUser.id, first.id],
  );
  check(
    preference.marketing === 1 &&
      preference.push === 1 &&
      !(await one(
        "SELECT email FROM email_suppressions WHERE store_id=? AND email='buyer@example.test'",
        [first.id],
      )),
    "Manual re-consent synchronizes preferences, preserves push and removes this store's suppression",
  );
  check(
    (
      await one(
        "SELECT marketing_consent FROM customers WHERE store_id=? AND email='buyer@example.test'",
        [second.id],
      )
    ).marketing_consent === 0 &&
      (
        await one(
          "SELECT marketing FROM notification_preferences WHERE user_id=? AND store_id=?",
          [buyerUser.id, second.id],
        )
      ).marketing === 0 &&
      (
        await one("SELECT marketing_consent FROM users WHERE id=?", [
          buyerUser.id,
        ])
      ).marketing_consent === buyerUser.marketing_consent,
    "Manual consent cannot alter another store or platform marketing consent",
  );
  check(
    (
      await one(
        "SELECT COUNT(*) n FROM audit_logs WHERE store_id=? AND entity_id=? AND action='marketing_consent'",
        [first.id, String(customer.id)],
      )
    ).n === 2,
    "Both consent changes record the staff member, timestamp and confirmation note",
  );
  await owner.call(
    consentPath,
    "PATCH",
    { consent: false, previousConsent: false },
    409,
    first.id,
  );
  const [withoutEmail] = await db.execute(
    "INSERT INTO customers(store_id,name,phone) VALUES(?,'Khách chưa có email','0901111222')",
    [first.id],
  );
  await owner.call(
    "admin/crm/" + withoutEmail.insertId + "/marketing-consent",
    "PATCH",
    { consent: true, previousConsent: false, confirmed: true },
    400,
    first.id,
  );
  check(
    true,
    "Stale consent forms and granting email marketing to a contact without email are rejected",
  );
  await testOrderPaymentStatus({
    owner,
    admin,
    untouched,
    buyer,
    first,
    second,
    db,
    one,
    check,
    pageFor,
    origin,
  });
  await testProductTaxonomy({ owner, first, second, db, one, check, pageFor, origin });
  check(errors.length === 0, "Order payment and taxonomy UI have no browser errors");
  console.log(
    `All ${checks} onboarding/CRM/email checks passed. No external email sent.`,
  );
} catch (e) {
  console.error(log.slice(-5000));
  throw e;
} finally {
  await browser?.close();
  if (server?.pid) {
    if (process.platform === "win32") {
      const killer = spawn(
        "taskkill",
        ["/PID", String(server.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      await once(killer, "exit");
    } else {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
  }
  for (const [p, content] of saved) await writeFile(p, content);
  assert(/^fleur_onboarding_qa_[a-f0-9]{12}$/.test(database));
  await db.query("DROP DATABASE IF EXISTS " + database);
  await db.end();
  await rm(dist, { recursive: true, force: true });
}
