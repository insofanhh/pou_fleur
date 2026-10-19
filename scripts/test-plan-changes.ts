import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { pool, query, mutate } from "../lib/db";
import { withSystem, withStore } from "../lib/tenant";
import { passwordHash } from "../lib/auth";
import { captureRegistrationPlan, activateApprovedStore, recordInvoicePayment, advanceBilling, refreshBillingAccess, expirePlanChangeRequests } from "../lib/billing";
import { quota } from "../lib/stores";
import { processWebhook } from "../lib/sepay";

assert(process.env.MYSQL_DATABASE === "fleur_saas_test" && process.env.MYSQL_PORT === "3310", "Isolated QA DB only");
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
const key = randomUUID().slice(0,8), password = "Plan-Changes-2026-Only";
const email = `plan-${key}@example.test`;
let checks = 0;
function check(value: unknown, label: string) { assert(value,label); console.log("PASS",label); checks++; }
function client() {
  let cookie = "";
  return async (path: string, method = "GET", body?: any, sid = 1, expected: number | number[] = 200) => {
    const res = await fetch(origin+"/api/"+path,{method,headers:{origin,"content-type":"application/json","x-fleur-store":String(sid),cookie},body: body === undefined ? undefined : JSON.stringify(body)});
    if (res.headers.get("set-cookie")) cookie = res.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
    const value = await res.json();
    assert((Array.isArray(expected) ? expected : [expected]).includes(res.status),path+": "+res.status+" "+JSON.stringify(value));
    return {...value,http_status:res.status};
  };
}
async function tx<T>(work: (c: any)=>Promise<T>) {
  const c=await pool.getConnection();
  try { await c.beginTransaction(); const r=await work(c); await c.commit(); return r; }
  catch(e) { await c.rollback(); throw e; } finally { c.release(); }
}
async function main() { return withSystem(async()=>{
  const fixtures: number[] = [], plans: number[] = [];
  const person=await mutate("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",["Plan Owner",email,passwordHash(password)]);
  const outsider=await mutate("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",["Other Owner",`other-${key}@example.test`,passwordHash(password)]);
  const savedBank=await query<any[]>("SELECT * FROM platform_settings WHERE setting_key='billing_bank'");
  const savedCredentials=await query<any[]>("SELECT * FROM platform_integrations WHERE provider='sepay'");
  const owner=client(), other=client();
  await owner("auth/login","POST",{email,password});
  await other("auth/login","POST",{email:`other-${key}@example.test`,password});
  const billing=(sid:number)=>owner("workspace/billing","GET",undefined,sid);
  const preview=(sid:number,plan_id:number)=>owner("workspace/billing/preview","POST",{plan_id},sid);
  const confirm=(sid:number,p:any,expected: number | number[]=200)=>owner("workspace/billing/start","POST",{plan_id:p.plan_id,quote_token:p.token,quote_expires_at:p.expires_at},sid,expected);
  const one=async(sql:string,values:any[]) => (await query<any[]>(sql,values))[0];
  const pay=(id:number,amount:number,reference:string)=>tx(c=>recordInvoicePayment(c,id,amount,`${key}-${reference}`,person.insertId));
  async function makePlan(name:string,price:number,limits:any) {
    const max=await one("SELECT COALESCE(MAX(id),0)+1 id FROM plans",[]);
    await mutate("INSERT INTO plans(id,name,monthly_price,limits,trial_days) VALUES(?,?,?,?,14)",[max.id,name,price,JSON.stringify(limits)]);
    plans.push(max.id);
    await mutate("INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) VALUES(?,?,?,?,14,UTC_TIMESTAMP())",[max.id,name,price,JSON.stringify(limits)]);
    return max.id;
  }
  async function store(planId:number) {
    // Each fixture tests an independent subscription scenario; account limits have their own suite.
    await mutate("DELETE FROM account_trial_claims WHERE user_id=?",[person.insertId]);
    const r=await mutate("INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,?,?,'approved','{}','{}')",[`plan-${key}-${fixtures.length}`,`Plan Store ${fixtures.length}`,person.insertId]);
    const sid=r.insertId; fixtures.push(sid);
    await mutate("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')",[sid,person.insertId]);
    await mutate("INSERT INTO subscriptions(store_id,plan_id) VALUES(?,?)",[sid,planId]);
    await tx(async c=>{await captureRegistrationPlan(c,sid,planId); await activateApprovedStore(c,sid);});
    return sid;
  }
  async function snapshot(sid:number) {
    const data=[];
    for(const table of ["subscriptions","invoices","payment_intents","notifications","email_outbox","audit_logs"]) data.push(await query(`SELECT * FROM ${table} WHERE store_id=?`,[sid]));
    return JSON.stringify(data);
  }
  try {
    await mutate("REPLACE INTO platform_settings(setting_key,setting_value) VALUES('billing_bank',?)",[JSON.stringify({bank_code:"MB",bank_name:"MB",account_number:"123456789",account_holder:"QA ONLY",enabled:true})]);
    const free=await makePlan("Miễn phí đổi gói QA",0,{products:1,staff:1,storage_mb:1});
    const studio=await makePlan("Studio đổi gói QA",129000,{products:300,staff:10,storage_mb:2048});
    const atelier=await makePlan("Atelier đổi gói QA",259000,{products:1000,staff:30,storage_mb:8192});
    const sid=await store(free), end=(await billing(sid)).subscription.expires_at;
    const before=await snapshot(sid), first=await preview(sid,free);
    check(before===await snapshot(sid),"Preview does not persist invoices, emails, QR, audit or entitlement changes");
    check(first.amount_due===0 && first.starts_at===end,"Preview preserves the exact trial boundary without granting extra days");
    await confirm(sid,first);
    let data=await billing(sid);
    const zero=data.scheduled.id;
    check(data.reservations.length===1 && data.scheduled.amount===0,"Zero-value monthly coverage is shown as a free reservation");
    const p=await preview(sid,studio);
    check(p.amount_due===129000 && p.starts_at===end,"Paid package remains selectable despite free reservation");
    check((await one("SELECT status FROM invoices WHERE id=?",[zero])).status==='paid',"Merely previewing another package preserves old free reservation");
    const selected=await confirm(sid,p);
    check(selected.payment && (await one("SELECT status FROM invoices WHERE id=?",[zero])).status==='void',"Confirming a different package replaces zero-value reservation and creates QR");
    data=await billing(sid);
    check(data.subscription.plan_id===free && data.subscription.expires_at===end && data.pending_plan.plan_id===studio,"Chosen unpaid package does not replace current entitlement or trial");
    await advanceBilling(sid);
    check((await billing(sid)).pending_plan.plan_id===studio,"Worker preserves store-selected package");
    await owner("workspace/billing/preview","POST",{plan_id:atelier},sid,409);
    const stale=await preview(sid,studio);
    await pay(selected.invoiceId,1000,"partial");
    const partialReopen=await confirm(sid,stale);
    check(partialReopen.invoiceId===selected.invoiceId && partialReopen.payment.code===selected.payment.code && partialReopen.payment.amount===128000,"Partial receipt reopens same invoice/code for the remaining amount");
    await owner("workspace/billing/cancel-payment","POST",{invoice_id:selected.invoiceId},sid,409);
    await owner("workspace/billing/preview","POST",{plan_id:atelier},sid,409);
    check((await one("SELECT paid,status FROM invoices WHERE id=?",[selected.invoiceId])).paid===1000,"Partial receipt blocks cancellation and replacement without losing money");
    await pay(selected.invoiceId,128000,"rest");
    data=await billing(sid);
    const paid=data.reservations[0];
    const lower=await preview(sid,free);
    check(lower.starts_at===paid.effective_end_at && lower.retained[0].id===paid.id,"Different package starts after prepaid cash coverage");
    await confirm(sid,lower);
    check((await billing(sid)).reservations.length===2,"Cash-paid period and later free choice coexist without overlap");
    const revert=await preview(sid,studio);
    await confirm(sid,revert);
    data=await billing(sid);
    check(data.reservations.length===1 && data.reservations[0].id===paid.id,"Re-selecting prepaid package removes only later zero-value choice");
    const upgrade=await preview(sid,atelier);
    const next=await confirm(sid,upgrade);
    await pay(next.invoiceId,259000,"next");
    data=await billing(sid);
    check(data.reservations.length===2 && data.reservations[1].effective_start_at===paid.effective_end_at,"Prepaid package changes retain all previously purchased service");
    const repeat=await preview(sid,atelier);
    const repeated=await confirm(sid,repeat);
    check(repeated.invoiceId===next.invoiceId && !repeated.payment,"Selecting already prepaid package is idempotent and does not charge twice");
    await owner("workspace/billing/cancel","POST",{cancel:true},sid,409);
    check(true,"Cancelling cannot silently discard cash-paid future service");

    const replace=await store(studio);
    const old=await confirm(replace,await preview(replace,studio));
    await owner("workspace/billing/preview","POST",{plan_id:atelier},replace,409);
    await owner("workspace/billing/cancel-payment","POST",{invoice_id:old.invoiceId},replace);
    await owner("workspace/billing/cancel-payment","POST",{invoice_id:old.invoiceId},replace);
    await advanceBilling(replace);
    check(!(await billing(replace)).pending_plan,"Manual cancellation survives worker runs and refresh without regenerating an invoice");
    const swap=await confirm(replace,await preview(replace,atelier));
    check(old.invoiceId!==swap.invoiceId && (await one("SELECT status FROM invoices WHERE id=?",[old.invoiceId])).status==='void' && (await one("SELECT status FROM payment_intents WHERE id=?",[old.payment.id])).status==='cancelled',"Only explicit cancellation closes the invoice and QR before a different selection");
    await owner("workspace/billing/cancel-payment","POST",{invoice_id:swap.invoiceId},replace);
    const priced=await preview(replace,free);
    await mutate("UPDATE plans SET monthly_price=10000 WHERE id=?",[free]);
    await mutate("INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) SELECT id,name,monthly_price,limits,trial_days,UTC_TIMESTAMP() FROM plans WHERE id=?",[free]);
    await confirm(replace,priced,409);
    check((await one("SELECT status FROM invoices WHERE id=?",[swap.invoiceId])).status==='void',"Catalog price changes invalidate preview without reviving a cancelled invoice");
    await mutate("UPDATE plans SET monthly_price=0 WHERE id=?",[free]);
    await mutate("INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) SELECT id,name,monthly_price,limits,trial_days,UTC_TIMESTAMP() FROM plans WHERE id=?",[free]);

    const race=await store(studio), racePreview=await preview(race,atelier);
    const outcomes=await Promise.all([confirm(race,racePreview,[200,409]),confirm(race,racePreview,[200,409])]);
    check(outcomes.every(x=>x.http_status===200) && outcomes[0].invoiceId===outcomes[1].invoiceId && outcomes[0].payment.code===outcomes[1].payment.code && outcomes[0].payment.expiresAt===outcomes[1].payment.expiresAt && (await query<any[]>("SELECT id FROM payment_intents WHERE store_id=?",[race])).length===1,"Concurrent confirmations return the same invoice, QR code and deadline");
    const parallelA=await store(free), parallelB=await store(atelier);
    for(let n=0;n<4;n++) await Promise.all([preview(parallelA,atelier),preview(parallelB,free)]);
    check(true,"Different stores can preview opposite package changes concurrently without catalog deadlocks");
    const timed=await preview(parallelA,free);
    await confirm(parallelA,{...timed,expires_at:Date.now()-1000},409);
    await other("workspace/billing/preview","POST",{plan_id:free},race,403);
    check(true,"Expired previews and another tenant's owner cannot change a subscription");

    await other("workspace/billing/cancel-payment","POST",{invoice_id:outcomes[0].invoiceId},race,403);
    const cancelRace=await store(studio), cancelReq=await confirm(cancelRace,await preview(cancelRace,studio));
    await Promise.all([owner("workspace/billing/cancel-payment","POST",{invoice_id:cancelReq.invoiceId},cancelRace),owner("workspace/billing/cancel-payment","POST",{invoice_id:cancelReq.invoiceId},cancelRace)]);
    check((await one("SELECT COUNT(*) n FROM audit_logs WHERE store_id=? AND action='subscription_payment_cancelled'",[cancelRace])).n===1,"Concurrent cancellation is idempotent, audited once, and tenant protected");
    const down=await store(studio);
    await mutate("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'support')",[down,outsider.insertId]);
    const warning=await preview(down,free);
    check(warning.usage.staff===2 && warning.limits.staff===1,"Downgrade preview exposes current usage exceeding new quota");
    const lowerConfirmed=await confirm(down,warning);
    const lowerInv=await one("SELECT * FROM invoices WHERE id=?",[lowerConfirmed.invoiceId]);
    // Advance the boundary in this isolated fixture only.
    await mutate("UPDATE subscriptions SET access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE store_id=?",[down]);
    await mutate("UPDATE invoices SET effective_start_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",[lowerInv.id]);
    await refreshBillingAccess(down);
    data=await billing(down);
    check(data.subscription.plan_id===free && data.subscription.status==='free' && !data.subscription.trial_ends_at,"At boundary the new package activates once without restarting trial");
    check((await one("SELECT COUNT(*) n FROM store_memberships WHERE store_id=? AND status='active'",[down])).n===2,"Downgrade never deletes existing staff or other business data");
    await assert.rejects(()=>withStore(down,()=>quota("staff",1)),/giới hạn/);
    check(true,"New quota prevents adding staff when existing usage exceeds downgraded package");
    const cancelled=await store(studio);
    await owner("workspace/billing/cancel","POST",{cancel:true},cancelled);
    await confirm(cancelled,await preview(cancelled,free));
    check(!(await billing(cancelled)).subscription.cancel_at_period_end,"Explicit package selection resumes previously stopped renewal");
    const late=await store(studio);
    await mutate("UPDATE subscriptions SET access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE store_id=?",[late]);
    await refreshBillingAccess(late);
    const revived=await confirm(late,await preview(late,free));
    check(revived.ok && (await billing(late)).store.status==='approved',"Expired billing-frozen store can select free package and recover access");
    await mutate("UPDATE stores SET status='suspended',billing_suspended=0,suspension_reason='Manual QA' WHERE id=?",[late]);
    await confirm(late,await preview(late,atelier));
    check((await billing(late)).store.status==='suspended',"Package selection never removes a platform manual freeze");
    check((await one("SELECT COUNT(*) n FROM audit_logs WHERE store_id=? AND action='subscription_plan_selected'",[sid])).n>=4,"Confirmed package selections are recorded in audit trail");

    const timeout=await store(free);
    await confirm(timeout,await preview(timeout,free));
    const fallback=(await billing(timeout)).scheduled;
    const expiring=await confirm(timeout,await preview(timeout,studio));
    let exp=await one("SELECT * FROM invoices WHERE id=?",[expiring.invoiceId]);
    check(exp.purpose==='plan_change' && exp.payment_deadline_at && exp.fallback_invoice_id===fallback.id,"Paid change requests have a fixed deadline and remember displaced free reservation");
    const reopened=await owner("workspace/billing/start","POST",{plan_id:free,invoice_id:exp.id},timeout);
    check(reopened.payment.id===expiring.payment.id && reopened.payment.code===expiring.payment.code && reopened.payment.expiresAt===expiring.payment.expiresAt && (await one("SELECT COUNT(*) n FROM payment_intents WHERE invoice_id=?",[exp.id])).n===1 && (await one("SELECT payment_deadline_at FROM invoices WHERE id=?",[exp.id])).payment_deadline_at===exp.payment_deadline_at && Date.parse(reopened.payment.expiresAt)<=Date.parse(exp.payment_deadline_at.replace(' ','T')+'Z'),"Reopening QR cannot extend the request or QR beyond its original deadline");
    await mutate("UPDATE invoices SET payment_deadline_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",[exp.id]);
    await assert.rejects(()=>pay(exp.id,129000,"too-late-direct"),/hết thời gian/);
    check((await one("SELECT COUNT(*) n FROM billing_payments WHERE invoice_id=?",[exp.id])).n===0,"Ledger rejects a zero-receipt change at deadline even before cleanup worker runs");
    await Promise.all([expirePlanChangeRequests(timeout),expirePlanChangeRequests(timeout)]);
    exp=await one("SELECT * FROM invoices WHERE id=?",[exp.id]);
    check(exp.status==='void' && exp.void_reason==='payment_timeout' && (await one("SELECT COUNT(*) n FROM payment_intents WHERE invoice_id=? AND status='pending'",[exp.id])).n===0,"Timeout atomically voids request and every pending QR, including reopened QR");
    data=await billing(timeout);
    check(data.subscription.plan_id===free && data.reservations[0].id===fallback.id && !data.pending_plan,"Timeout restores previous free reservation and retains current package");
    check((await one("SELECT COUNT(*) n FROM audit_logs WHERE store_id=? AND action='subscription_change_expired'",[timeout])).n===1 && (await one("SELECT COUNT(*) n FROM notifications WHERE store_id=? AND event_key=?",[timeout,`billing:change-expired:${exp.id}`])).n===1,"Repeated cleanup produces one audit event and one expiry notification");
    const retry=await confirm(timeout,await preview(timeout,atelier));
    check(retry.invoiceId!==exp.id && (await one("SELECT status FROM invoices WHERE id=?",[exp.id])).status==='void',"A new selection after timeout issues a new request without reviving the old QR");
    await mutate("REPLACE INTO platform_integrations(provider,webhook_secret,api_key,enabled,created_by) VALUES('sepay',?,?,1,?)",[`secret-${key}`,`api-${key}`,person.insertId]);
    const cancelledEvent={id:`cancelled-webhook-${key}`,content:cancelReq.payment.code,transferAmount:129000,transferType:'in',accountNumber:'123456789'};
    await assert.rejects(()=>processWebhook(JSON.stringify(cancelledEvent),cancelledEvent,new Headers({'x-api-key':`api-${key}`})),/hủy/);
    check((await one("SELECT COUNT(*) n FROM billing_payments WHERE invoice_id=?",[cancelReq.invoiceId])).n===0,"Transfer to manually cancelled QR never activates service and is kept for reconciliation");
    const lateEvent={id:`timeout-webhook-${key}`,content:expiring.payment.code,transferAmount:129000,transferType:'in',accountNumber:'123456789'};
    await assert.rejects(()=>processWebhook(JSON.stringify(lateEvent),lateEvent,new Headers({'x-api-key':`api-${key}`})),/hủy/);
    check((await one("SELECT processed,error_message FROM sepay_webhook_events WHERE provider_event_id=?",[lateEvent.id])).processed===0 && (await one("SELECT COUNT(*) n FROM billing_payments WHERE invoice_id=?",[exp.id])).n===0,"Late transfer to expired request is recorded for reconciliation and cannot activate a package");

    const hold=await store(free), holdReq=await confirm(hold,await preview(hold,studio));
    await pay(holdReq.invoiceId,1000,"hold-partial");
    await mutate("UPDATE invoices SET payment_deadline_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?",[holdReq.invoiceId]);
    await expirePlanChangeRequests(hold);
    check((await one("SELECT status,paid FROM invoices WHERE id=?",[holdReq.invoiceId])).status==='open' && (await billing(hold)).pending_plan.paid===1000,"Partial receipts protect change invoices from timeout");
    await pay(holdReq.invoiceId,128000,"hold-rest");
    await expirePlanChangeRequests(hold);
    check((await one("SELECT status FROM invoices WHERE id=?",[holdReq.invoiceId])).status==='paid',"Protected partial invoice can settle after deadline; paid coverage is never expired");

    const renewal=await store(studio), renewalReq=await confirm(renewal,await preview(renewal,studio));
    const renewalInv=await one("SELECT * FROM invoices WHERE id=?",[renewalReq.invoiceId]);
    await mutate("UPDATE payment_intents SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE id=?",[renewalReq.payment.id]);
    await assert.rejects(()=>pay(renewalReq.invoiceId,129000,"expired-renewal"),/hết thời gian/);
    await owner("workspace/billing/start","POST",{plan_id:studio,invoice_id:renewalReq.invoiceId},renewal,404);
    await Promise.all([expirePlanChangeRequests(renewal),expirePlanChangeRequests(renewal)]);
    check(renewalInv.purpose==='renewal' && (await one("SELECT status,void_reason FROM invoices WHERE id=?",[renewalReq.invoiceId])).void_reason==='payment_timeout' && (await one("SELECT status FROM payment_intents WHERE id=?",[renewalReq.payment.id])).status==='cancelled',"Unpaid renewal expires atomically with its QR and cannot be reopened");
    check((await billing(renewal)).pending_plan===null && (await one("SELECT COUNT(*) n FROM invoices WHERE store_id=?",[renewal])).n===1,"Refresh and worker leave expired renewal closed until explicit new confirmation");
    const renewEvent={id:`renew-webhook-${key}`,content:renewalReq.payment.code,transferAmount:129000,transferType:'in',accountNumber:'123456789'};
    await assert.rejects(()=>processWebhook(JSON.stringify(renewEvent),renewEvent,new Headers({'x-api-key':`api-${key}`})),/hủy/);
    check((await one("SELECT COUNT(*) n FROM billing_payments WHERE invoice_id=?",[renewalReq.invoiceId])).n===0,"Expired renewal transfer is retained for reconciliation without activating service");
    const renewed=await confirm(renewal,await preview(renewal,studio));
    const restarted=await owner("workspace/billing/start","POST",{plan_id:studio,invoice_id:renewed.invoiceId},renewal);
    check(renewed.invoiceId!==renewalReq.invoiceId && renewed.payment.code!==renewalReq.payment.code && Date.parse(renewed.payment.expiresAt)>Date.now()+9*60000 && restarted.payment.id===renewed.payment.id,"Explicit continuation creates one new session and subsequent reopen reuses it");
    await pay(renewed.invoiceId,129000,"renewed-paid");
    check((await one("SELECT status FROM invoices WHERE id=?",[renewed.invoiceId])).status==='paid',"New session settles without reviving the expired invoice");
    const boundary=await store(free), boundaryReq=await confirm(boundary,await preview(boundary,studio));
    await mutate("UPDATE invoices SET payment_deadline_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",[boundaryReq.invoiceId]);
    await mutate("UPDATE subscriptions SET access_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND),trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE store_id=?",[boundary]);
    await refreshBillingAccess(boundary);
    data=await billing(boundary);
    check(data.subscription.plan_id===free && data.subscription.status==='free' && data.store.status==='approved',"Expired change cannot prevent original free package from renewing at its boundary");
    const paused=await store(studio);
    await owner("workspace/billing/cancel","POST",{cancel:true},paused);
    const pausedReq=await confirm(paused,await preview(paused,atelier));
    await mutate("UPDATE invoices SET payment_deadline_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",[pausedReq.invoiceId]);
    await expirePlanChangeRequests(paused);
    check((await billing(paused)).subscription.cancel_at_period_end===1,"Timing out an unpaid change preserves an owner's prior stop-renewal choice");
    const raceExpiry=await store(free), raceExpiryReq=await confirm(raceExpiry,await preview(raceExpiry,studio));
    await mutate("UPDATE invoices SET payment_deadline_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",[raceExpiryReq.invoiceId]);
    const expiryRace=await Promise.allSettled([pay(raceExpiryReq.invoiceId,129000,'expiry-race'),expirePlanChangeRequests(raceExpiry)]);
    check(expiryRace[0].status==='rejected' && expiryRace[1].status==='fulfilled' && (await one("SELECT status,paid FROM invoices WHERE id=?",[raceExpiryReq.invoiceId])).status==='void' && (await one("SELECT COUNT(*) n FROM billing_payments WHERE invoice_id=?",[raceExpiryReq.invoiceId])).n===0,"Payment racing timeout cannot collect or activate an expired request");
    const webhookExpiry=await store(free), webhookExpiryReq=await confirm(webhookExpiry,await preview(webhookExpiry,studio));
    await mutate("UPDATE invoices SET payment_deadline_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",[webhookExpiryReq.invoiceId]);
    const beforeCleanupEvent={id:`timeout-precleanup-${key}`,content:webhookExpiryReq.payment.code,transferAmount:129000,transferType:'in',accountNumber:'123456789',transactionDate:new Date(Date.now()-30000).toISOString()};
    await assert.rejects(()=>processWebhook(JSON.stringify(beforeCleanupEvent),beforeCleanupEvent,new Headers({'x-api-key':`api-${key}`})),/hủy/);
    check((await one("SELECT status FROM invoices WHERE id=?",[webhookExpiryReq.invoiceId])).status==='void' && (await one("SELECT processed FROM sepay_webhook_events WHERE provider_event_id=?",[beforeCleanupEvent.id])).processed===0,"Late webhook commits timeout cleanup and reconciliation even when bank timestamp predates processing");

    if(process.argv.includes("--ui")) {
      const { chromium, expect }=await import("@playwright/test");
      const browser=await chromium.launch({headless:true});
      await mkdir(".local/plan-change-qa",{recursive:true});
      try {
        const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
        const errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
        await page.goto(origin+"/login");
        await page.locator("input[type=email]:visible").fill(email);
        await page.locator("input[type=password]:visible").fill(password);
        await page.getByRole("button",{name:"Đăng nhập",exact:true}).click();
        await page.waitForURL(/workspace|platform|admin/);
        // A free reserved cycle reproduces the reported locked-card scenario.
        const ui=await store(studio);
        await mutate("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'support')",[ui,outsider.insertId]);
        await confirm(ui,await preview(ui,free));
        await page.goto(origin+`/workspace/${ui}/billing`);
        const card=page.locator(".billing-plan-card").filter({has:page.getByRole("heading",{name:"Atelier đổi gói QA",exact:true})});
        await expect(card.getByRole("button")).toBeEnabled();
        await card.getByRole("button").click();
        const dialog=page.getByRole("dialog",{name:"Atelier đổi gói QA"});
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("259.000",{exact:false}).first()).toBeVisible();
        await page.screenshot({path:".local/plan-change-qa/desktop-preview.png"});
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        check(true,"Desktop package cards stay enabled with free reservation; preview opens and Escape closes it");
        await page.setViewportSize({width:390,height:844});
        const freeCard=page.locator(".billing-plan-card").filter({has:page.getByRole("heading",{name:"Miễn phí đổi gói QA",exact:true})});
        await freeCard.getByRole("button").click();
        const mobile=page.getByRole("dialog",{name:"Miễn phí đổi gói QA"});
        await expect(mobile.getByText("Đang vượt hạn mức gói đã chọn")).toBeVisible();
        await mobile.getByRole("button",{name:"Xác nhận chọn gói",exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({path:".local/plan-change-qa/mobile-preview.png"});
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"Mobile billing and scrollable confirmation fit viewport without horizontal overflow");
        await mobile.getByRole("button",{name:"Xác nhận chọn gói",exact:true}).click();
        await expect(mobile).toHaveCount(0);
        await expect(page.getByText(/Đã chọn kỳ miễn phí/)).toBeVisible();
        check(true,"Mobile confirmation persists selection and refreshes schedule");
        const uiRenew=await store(studio);
        await page.goto(origin+`/workspace/${uiRenew}/billing`);
        const renewalCard=page.locator('.billing-plan-card').filter({has:page.getByRole('heading',{name:'Studio đổi gói QA',exact:true})});
        await renewalCard.getByRole('button',{name:'Gia hạn / Thanh toán',exact:true}).click();
        await page.getByRole('dialog').getByRole('button',{name:'Xác nhận & thanh toán',exact:true}).click();
        const renewalModal=page.getByRole('dialog',{name:'Thanh toán gói dịch vụ',exact:true});
        await expect(renewalModal.getByRole('timer')).toBeVisible();
        const uiInv=(await billing(uiRenew)).pending_plan;
        const originalIntent=await one('SELECT * FROM payment_intents WHERE invoice_id=?',[uiInv.id]);
        await renewalModal.getByRole('button',{name:'Đóng',exact:true}).click();
        await page.setViewportSize({width:320,height:844});
        await page.reload();
        await renewalCard.getByRole('button',{name:'Tiếp tục thanh toán',exact:true}).click();
        await expect(renewalModal.getByText(originalIntent.reference_code,{exact:true})).toBeVisible();
        const resumedIntent=await one('SELECT * FROM payment_intents WHERE invoice_id=?',[uiInv.id]);
        check(originalIntent.id===resumedIntent.id && originalIntent.expires_at===resumedIntent.expires_at && (await one('SELECT COUNT(*) n FROM invoices WHERE store_id=?',[uiRenew])).n===1,"Reloading and resuming on mobile preserves one invoice/code/deadline");
        const remainingBefore=await renewalModal.getByRole('timer').innerText();
        await renewalModal.getByRole('button',{name:'Hủy thanh toán',exact:true}).click();
        const cancelDialog=page.getByRole('dialog',{name:'Hủy thanh toán?',exact:true});
        await expect(cancelDialog).toBeVisible();
        await page.waitForTimeout(1500);
        await cancelDialog.getByRole('button',{name:'Quay lại',exact:true}).click();
        const remainingAfter=await renewalModal.getByRole('timer').innerText();
        check(remainingAfter<remainingBefore,"Returning from cancellation confirmation never resets the visible countdown");
        await expect(renewalModal.getByText(originalIntent.reference_code,{exact:true})).toBeVisible();
        await renewalModal.getByRole('button',{name:'Đóng',exact:true}).click();
        await mutate('UPDATE payment_intents SET expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 6 SECOND) WHERE id=?',[originalIntent.id]);
        await renewalCard.getByRole('button',{name:'Tiếp tục thanh toán',exact:true}).click();
        await expect(renewalModal.getByRole('timer')).toBeVisible();
        await expect(renewalModal.getByRole('status')).toBeVisible({timeout:20000});
        await expect(renewalModal.getByRole('button',{name:'Tiếp tục tạo phiên mới',exact:true})).toBeEnabled({timeout:15000});
        check((await one('SELECT COUNT(*) n FROM payment_intents WHERE invoice_id=?',[uiInv.id])).n===1 && (await one('SELECT void_reason FROM invoices WHERE id=?',[uiInv.id])).void_reason==='payment_timeout',"Renewal countdown automatically cancels payment without creating a replacement");
        await page.screenshot({path:'.local/plan-change-qa/mobile-renewal-expired.png'});
        await renewalModal.getByRole('button',{name:'Tiếp tục tạo phiên mới',exact:true}).click();
        const restartPreview=page.getByRole('dialog',{name:'Studio đổi gói QA',exact:true});
        await expect(restartPreview).toBeVisible();
        await restartPreview.getByRole('button',{name:'Xác nhận & thanh toán',exact:true}).click();
        await expect(renewalModal.getByRole('timer')).toBeVisible();
        const newUiInvoice=(await billing(uiRenew)).pending_plan;
        const newUiIntent=await one('SELECT * FROM payment_intents WHERE invoice_id=?',[newUiInvoice.id]);
        check(newUiInvoice.id!==uiInv.id && newUiIntent.reference_code!==originalIntent.reference_code && (await one('SELECT COUNT(*) n FROM invoices WHERE store_id=?',[uiRenew])).n===2,"Continue-new-session action confirms original plan and creates exactly one replacement");
        await renewalModal.getByRole('button',{name:'Hủy thanh toán',exact:true}).click();
        await cancelDialog.getByRole('button',{name:'Xác nhận hủy thanh toán',exact:true}).click();
        await expect(cancelDialog).toHaveCount(0);
        await page.reload();
        await expect(page.locator('.table-scroll').getByText('Đã hủy',{exact:true})).toBeVisible();
        check((await billing(uiRenew)).pending_plan===null && (await one('SELECT COUNT(*) n FROM invoices WHERE store_id=?',[uiRenew])).n===2,"Manual cancellation of new session persists without automatic replacement");
        await page.screenshot({path:'.local/plan-change-qa/mobile-payment-cancelled.png'});
        await page.setViewportSize({width:390,height:844});
        const uiTimeout=await store(free);
        const uiRequest=await confirm(uiTimeout,await preview(uiTimeout,studio));
        await mutate("UPDATE invoices SET payment_deadline_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 SECOND) WHERE id=?",[uiRequest.invoiceId]);
        await page.goto(origin+`/workspace/${uiTimeout}/billing`);
        await page.locator('.table-scroll').getByRole('button',{name:'Thanh toán',exact:true}).click();
        const paymentDialog=page.getByRole('dialog',{name:'Thanh toán gói dịch vụ'});
        await expect(paymentDialog.getByRole('timer')).toBeVisible();
        await page.screenshot({path:'.local/plan-change-qa/mobile-payment-countdown.png'});
        await expect(paymentDialog.getByRole('status')).toBeVisible({timeout:15000});
        await expect(paymentDialog.getByAltText('Mã QR thanh toán')).toHaveCount(0);
        await page.screenshot({path:'.local/plan-change-qa/mobile-payment-expired.png'});
        await paymentDialog.getByRole('button',{name:'Đóng',exact:true}).click();
        await expect(page.getByText('Hết hạn thanh toán',{exact:true})).toBeVisible();
        check(true,"Mobile QR counts down, hides expired QR and automatically updates invoice without a reload");
        check(errors.length===0,"Package-change UI has no uncaught browser errors");
      } finally { await browser.close(); }
    }
    console.log(`${checks} package-change checks passed`);
  } finally {
    for(const sid of fixtures) {
      await mutate("DELETE bp FROM billing_payments bp JOIN invoices i ON i.id=bp.invoice_id WHERE i.store_id=?",[sid]);
      for(const table of ["email_outbox","notifications","trial_claims","account_trial_claims","subscriptions","store_memberships","payment_intents","audit_logs","invoices"]) await mutate(`DELETE FROM ${table} WHERE store_id=?`,[sid]);
      await mutate("DELETE FROM stores WHERE id=?",[sid]);
    }
    for(const plan of plans) { await mutate("DELETE FROM plan_versions WHERE plan_id=?",[plan]); await mutate("DELETE FROM plans WHERE id=?",[plan]); }
    for(const uid of [person.insertId,outsider.insertId]) { await mutate("DELETE FROM sessions WHERE user_id=?",[uid]); await mutate("DELETE FROM users WHERE id=?",[uid]); }
    await mutate("DELETE FROM platform_settings WHERE setting_key='billing_bank'");
    for(const bank of savedBank) await mutate("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES(?,?,?)",[bank.setting_key,bank.setting_value,bank.updated_by]);
    await mutate("DELETE FROM platform_integrations WHERE provider='sepay'");
    for(const c of savedCredentials) await mutate("INSERT INTO platform_integrations(provider,webhook_secret,api_key,enabled,created_by) VALUES('sepay',?,?,?,?)",[c.webhook_secret,c.api_key,c.enabled,c.created_by]);
    await mutate("DELETE FROM sepay_webhook_events WHERE provider_event_id IN (?,?,?,?)",[`timeout-webhook-${key}`,`renew-webhook-${key}`,`timeout-precleanup-${key}`,`cancelled-webhook-${key}`]);
  }
}); }
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
