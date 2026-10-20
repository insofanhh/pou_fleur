import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect as pwExpect } from "@playwright/test";
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Local app only");
const expect = pwExpect.configure({ timeout: 20000 });
const output = ".local/starter-ai-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
let checks = 0;
function check(value, title) { assert(value, title); checks++; console.log("PASS", title); }
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
  let plans = [1,2,3].map((id) => ({ id, name: ["Khởi đầu", "Studio", "Atelier"][id-1], monthly_price: [99000,299000,599000][id-1], trial_days: 14, active: 1, registration_trial_available: true, limits: { products: 30, staff: 3, storage_mb: 100, email_sends: 100, ...(id === 1 ? {} : { ai_messages: id === 2 ? 300 : 1500 }) } }));
  plans.push({id:4,name:"Trải nghiệm",monthly_price:0,trial_days:0,active:1,registration_trial_available:false,limits:{products:10,staff:1,storage_mb:100,email_sends:50,ai_messages:10}});
  const writes = [], errors = [], registrations = [];
  let freeBilling = false;
  await ctx.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let data = [], status = 200;
    if (path === "/api/auth/me") data = { user: { id: 999997, name: "Plan UI QA", email: "plan-ui@example.test", phone: "0900000000", role: "owner", platformRole: "platform_admin", memberships: [] } };
    else if (path.endsWith("/notifications")) data = { items: [] };
    else if (path === "/api/platform/plans" || path === "/api/billing/plans") data = plans;
    else if (path.startsWith("/api/platform/plans/") && req.method() === "PATCH") {
      const value = req.postDataJSON(), id = Number(path.split("/").at(-1));
      writes.push({ id, value }); plans = plans.map(p => p.id === id ? { ...p, ...value } : p); data = { ok: true };
    } else if (path === "/api/platform/config") data = { storeApprovalRequired: false, billingBank: {}, paymentIssues: [], deepseek: { configured: false, encryptionReady: true } };
    else if (path === "/api/platform/invoices") data = { rows: [{ id: 900001, store_name: "Free invoice QA", plan_id: 4, plan_name: "Trải nghiệm", amount: 0, paid: 0, balance: 0, status: "paid", display_status: "free", purpose: "plan_change", effective_start_at: "2026-10-20 00:00:00", effective_end_at: "2026-11-20 00:00:00" }], plans, summary: {paid:0,outstanding:0,overdue:0}, total:1,page:1,page_size:20 };
    else if (path === "/api/stores/registration") data = { eligible: true, store: null };
    else if (path === "/api/stores" && req.method() === "POST") { registrations.push(req.postDataJSON()); status=409; data={error:"QA: kiểm tra lựa chọn, không tạo cửa hàng thật"}; }
    else if (path === "/api/workspace/billing") data = { server_now: new Date().toISOString(), subscription: freeBilling ? { name:"Trải nghiệm",plan_id:4,status:"free",monthly_price:0,limits:plans[3].limits,expires_at:null } : { name: "Khởi đầu", plan_id: 1, status: "trialing", monthly_price: 99000, limits: plans[0].limits, days_remaining: 14 }, plans, usage: { ai_messages: 7 }, invoices: [], store: { status: "approved" }, store_trials: [], account_trials: { claims: [],available:1 } };
    else if (req.method() !== "GET") { status = 400; data = { error: "Unexpected write blocked by UI QA" }; }
    await route.fulfill({ status, json: data });
  });
  const page = await ctx.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/platform/plans");
  const aiInputs = page.locator('input[name$="-ai_messages"]');
  await expect(aiInputs).toHaveCount(4);
  await expect(page.locator('input[name="1-ai_messages"]')).toHaveValue("50");
  await expect(page.locator('input[name="4-price"]')).toHaveAttribute('readonly','');
  await expect(page.locator('input[name="4-trial"]')).toHaveValue('0');
  check(true, "All four platform plans expose quotas; Free price/duration are locked");
  await page.locator('input[name="1-ai_messages"]').fill("73");
  await page.getByRole("button", { name: "Lưu tất cả thay đổi", exact: true }).click();
  await expect.poll(() => writes.length).toBe(4);
  check(writes[0].value.limits.ai_messages === 73 && writes[1].value.limits.ai_messages === 300 && writes[2].value.limits.ai_messages === 1500, "One save sends the actual editable AI quota for every plan");
  await page.locator('input[name="1-ai_messages"]').fill("-1");
  await page.getByRole("button", { name: "Lưu tất cả thay đổi", exact: true }).click();
  check(writes.length === 4 && !await page.locator('input[name="1-ai_messages"]').evaluate(e => e.validity.valid), "Negative AI quota fails browser form validation");
  await page.locator('input[name="1-ai_messages"]').fill("0");
  await page.getByRole("button", { name: "Lưu tất cả thay đổi", exact: true }).click();
  await expect.poll(() => writes.length).toBe(8);
  await page.reload();
  await expect(page.locator('input[name="1-ai_messages"]')).toHaveValue("0");
  check(true, "Intentional zero quota survives save and reload");
  await page.goto(origin + "/platform/config");
  await expect(page.getByText("Bật trợ lý AI cho các store thuộc các gói có hạn mức AI", { exact: true })).toBeVisible();
  check(true, "Platform AI configuration text includes Starter");

  plans[0].limits.ai_messages = 50;
  await page.goto(origin + "/start");
  await expect(page.locator(".start-store-plan-card")).toHaveCount(3);
  await expect(page.locator(".start-store-plan-card").first()).toContainText("50 lượt trợ lý AI/tháng");
  check(true, "Store registration shows Starter monthly AI entitlement");
  await expect(page.locator('.start-store-free-choice button')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.start-store-selected-plan')).toContainText('Trải nghiệm');
  await expect(page.locator('.start-store-free-choice')).toContainText('không giới hạn ngày');
  await page.locator('.start-store-plan-card').nth(1).click();
  await expect(page.locator('.start-store-selected-plan')).toContainText('Studio');
  await page.locator('.start-store-free-choice button').click();
  await expect(page.locator('.start-store-selected-plan')).toContainText('Trải nghiệm');
  check(true,'Registration retains three paid cards with an explicit default Free text choice');
  await page.locator('.start-store-plan-card').nth(1).click();
  await page.locator('input[name="name"]').fill('QA Flower');
  await page.getByLabel('Địa chỉ cửa hàng',{exact:true}).fill('12 Hoan Kiem Ha Noi');
  await page.getByRole('button',{name:'Tạo cửa hàng',exact:true}).click();
  await expect.poll(()=>registrations.length).toBe(1);
  check(registrations[0].plan_id===2,'Registration submits explicitly selected paid plan');
  await expect(page.locator('.start-store-selected-plan')).toContainText('Studio');
  check(true,'Offer refresh after a rejected form retains explicit plan choice');
  await page.goto(origin + "/workspace/1/billing");
  const usage = page.locator(".billing-usage-card").filter({ hasText: "Trợ lý AI" });
  await expect(usage).toContainText("7 / 50 lượt/tháng");
  await expect(usage).toContainText("đã dùng 14%");
  await expect(page.locator(".billing-plan-card").first()).toContainText("Trợ lý AI");
  check(true, "Starter billing usage and plan cards show AI quota and consumed percentage");
  await expect(page.locator('.billing-free-choice')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Chuyển về gói miễn phí',exact:true})).toHaveCount(0);
  check(true,'Paid billing hides the Free choice and manual downgrade action');
  for (const route of ["/platform/plans", "/start", "/workspace/1/billing"]) {
    await page.goto(origin + route);
    const marker = route === "/platform/plans" ? '.platform-plan-card' : route === "/start" ? '.start-store-plan-card' : '.billing-usage-card';
    await expect(page.locator(marker).first()).toBeVisible();
    for (const width of [1440,390,360]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} AI quota layout fits ${width}px`);
      await page.screenshot({ path: `${output}/${route.split("/").filter(Boolean).join("-")}-${width}.png`, fullPage: true });
    }
  }
  freeBilling=true;
  await page.goto(origin+'/workspace/1/billing');
  await expect(page.getByText('Miễn phí không giới hạn ngày',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Ngừng gia hạn cuối kỳ',exact:true})).toHaveCount(0);
  await expect(page.locator('.billing-plan-card')).toHaveCount(3);
  await expect(page.locator('.billing-free-choice')).toHaveCount(0);
  await expect(page.locator('.billing-current h2')).toHaveText('Trải nghiệm');
  await expect(page.locator('.billing-usage-card').filter({hasText:'Trợ lý AI'})).toContainText('7 / 10 lượt/tháng');
  for(const width of [1440,390,360]){
    await page.setViewportSize({width,height:900});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Free billing fits ${width}px without expiry or renewal action`);
    await page.screenshot({path:`${output}/free-billing-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin+'/platform/invoices');
  const freeInvoice = page.getByRole('row').filter({hasText:'Free invoice QA'});
  await expect(freeInvoice).toContainText('Không giới hạn ngày');
  await expect(freeInvoice.locator('.invoice-status')).toHaveText('Miễn phí');
  await expect(freeInvoice).not.toContainText('Hạn thanh toán');
  check(true,'Platform Free invoice shows unlimited access and no payment deadline');
  check(errors.length === 0, "No runtime errors: " + errors.join("; "));
  await writeFile(`${output}/ui-report.json`, JSON.stringify({ checks, api: "intercepted fixtures" }, null, 2));
  console.log(`${checks} AI plan UI checks passed`);
} finally { await browser.close(); }
