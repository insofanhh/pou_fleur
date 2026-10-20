import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool, query, mutate } from "../lib/db";
import { withSystem, withStore, scopedSQL } from "../lib/tenant";

assert(process.env.MYSQL_DATABASE === "fleur_saas_test" && process.env.MYSQL_PORT === "3310", "QA database only");
const origin = process.env.TEST_ORIGIN!;
const stamp = randomBytes(5).toString("hex"), users: number[] = [], stores: number[] = [];
let count = 0, serial = 0;
const check = (value: unknown, label: string) => { assert(value, label); count++; console.log("PASS", label); };
const one = async (sql: string, params: any[] = []) => (await query<any[]>(sql, params))[0];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function main() { return withSystem(async () => {
  const saved = await query<any[]>("SELECT * FROM platform_integrations WHERE provider='sepay'");
  try {
    const cookies: string[] = [];
    for (const role of ["owner", "owner", "support"]) {
      const person = await mutate("INSERT INTO users(name,email,password_hash) VALUES(?,?,'not-a-login')", ["SePay " + role, `sepay-${stamp}-${users.length}@example.test`]);
      users.push(person.insertId);
      const token = randomBytes(32).toString("hex");
      await mutate("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))", [person.insertId, hash(token)]);
      cookies.push("fleur_session=" + token);
    }
    for (const owner of users.slice(0, 2)) {
      const store = await mutate("INSERT INTO stores(slug,name,owner_id,status,address,settings,theme) VALUES(?,?,?,'approved','10 Phố Hoa, Hà Nội',?,'{}')", [`sepay-${stamp}-${owner}`, "SePay QA", owner, JSON.stringify({open:true})]);
      stores.push(store.insertId);
      await mutate("INSERT INTO subscriptions(store_id,plan_id,status,trial_ends_at,current_period_end) VALUES(?,3,'active',NULL,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))", [store.insertId]);
      await mutate("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')", [store.insertId, owner]);
      await mutate("INSERT INTO store_bank_accounts(store_id,bank_code,bank_name,account_number,account_holder,enabled,sepay_enabled,auto_confirm_status) VALUES(?,'TPB','TPBank','123456789','QA',1,1,'preparing')", [store.insertId]);
    }
    const [a, b] = stores;
    await mutate("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'support')", [a, users[2]]);
    const api = async (path: string, method = "GET", body?: any, store = a, who = 0, expected = 200) => {
      const response = await fetch(origin + "/api/" + path, {method,headers:{origin,cookie:cookies[who] || "", "content-type":"application/json","x-fleur-store":String(store)}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
      return result;
    };
    const endpoint = "workspace/sepay/credentials";
    const empty = await api(endpoint);
    check(!empty.configured && empty.webhookUrl === `${origin}/api/sepay/webhook/stores/${a}`, "Owner gets the canonical store-specific webhook URL");
    await api(endpoint, "GET", undefined, a, 2, 403);
    await api(endpoint, "POST", {}, a, 2, 403);
    await api(endpoint, "POST", {}, b, 0, 403);
    await api(endpoint, "GET", undefined, a, 99, 401);
    check(true, "Non-owner, other-store owner and anonymous access are rejected");
    await api(endpoint, "POST", {apiKey:"short"}, a, 0, 400);
    check(true, "Weak custom API keys are rejected");
    const created = await api(endpoint, "POST", {});
    let aKey = created.apiKey;
    const metadata = await api(endpoint);
    const stored = await one("SELECT * FROM store_sepay_integrations WHERE store_id=?", [a]);
    check(aKey.length > 40 && metadata.api_last4 === aKey.slice(-4) && stored.api_key_hash === hash(aKey) && !JSON.stringify(stored).includes(aKey), "Full generated key is returned once and only its hash is stored");
    check(!("apiKey" in metadata) && !("api_key_hash" in metadata) && !("webhook_secret" in metadata), "Read API returns masked metadata without credentials");
    const publicStore = await api("store");
    check(!JSON.stringify(publicStore).includes(aKey) && !JSON.stringify(publicStore).includes(stored.api_key_hash), "Public storefront exposes neither API key nor its hash");
    await api(endpoint, "POST", {}, a, 0, 409);
    check(true, "Changing an existing key requires explicit replacement");
    const bKey = "QA_sepay_custom_" + randomBytes(24).toString("hex");
    await api(endpoint, "POST", {apiKey:bKey}, b, 1);
    check((await api(endpoint, "GET", undefined, b, 1)).api_last4 === bKey.slice(-4), "A separate store can save its own custom webhook key");
    check(withStore(a, () => scopedSQL("SELECT * FROM store_sepay_integrations")).includes(String(a)), "Credential SQL is protected by tenant filtering");
    async function makeOrder(store = a, extra: { status?: string; kind?: string; amount?: number; expired?: boolean; pickup?: boolean } = {}) {
      serial++;
      const order = await mutate("INSERT INTO orders(store_id,reference,customer_name,email,phone,address,recipient_name,recipient_phone,delivery_date,delivery_slot,payment_method,status,subtotal,total,idempotency_key,fulfillment_method) VALUES(?,?,'QA','','0901234567','10 Phố Hoa','QA','0901234567',CURDATE(),'09:00–12:00','bank',?,100000,100000,?,?)", [store, `SEP-${stamp}-${serial}`, extra.status || "pending", randomUUID(), extra.pickup ? "pickup" : "delivery"]);
      const code = `FLR-${extra.kind === "subscription" ? "SUB" : "ORD"}-${order.insertId}-${randomBytes(3).toString("hex").toUpperCase()}`;
      await mutate("INSERT INTO payment_intents(store_id,order_id,kind,reference_code,amount,expires_at,qr_payload) VALUES(?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE),?)", [store, order.insertId, extra.kind || "order", code, extra.amount || 100000, extra.expired ? -1 : 10, JSON.stringify({accountNumber:"123456789"})]);
      return {id:order.insertId, code};
    }
    const payment = (order: {code:string}, extra: any = {}) => ({id:`sepay-${stamp}-${randomUUID()}`, referenceCode:`REF-${stamp}-${randomUUID()}`, transferType:"in", transferAmount:100000, accountNumber:"123456789", code:null, content:order.code.replaceAll("-", ""), ...extra});
    async function webhook(body: any, expected = 200, store = a, key = aKey, global = false) {
      const response = await fetch(origin + (global ? "/api/sepay/webhook" : `/api/sepay/webhook/stores/${store}`), {method:"POST",headers:{"content-type":"application/json",authorization:"Apikey " + key},body:JSON.stringify(body)});
      const result = await response.json();
      assert.equal(response.status, expected, `Webhook: ${JSON.stringify(result)}`);
      return result;
    }
    const order = await makeOrder(), event = payment(order);
    await webhook(event, 401, a, bKey);
    await webhook(event, 401, b, aKey);
    await webhook(event, 403, b, bKey);
    check((await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=?", [order.id])).n === 0, "Wrong keys and cross-store payloads cannot record money");
    await webhook({...event,accountNumber:"987654321"}, 409);
    await webhook({...event,accountNumber:null}, 400);
    await webhook({...event,transferAmount:99000}, 409);
    await webhook({...event,transferType:"out"}, 400);
    check((await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=?", [order.id])).n === 0, "Wrong bank, missing bank, insufficient amount and outgoing transfers cannot settle an order");
    await webhook(event);
    const settled = await one("SELECT status,payment_status FROM orders WHERE id=?", [order.id]);
    check(settled.status === "preparing" && settled.payment_status === "paid", "A valid compact-code TPBank webhook marks the order paid and advances configured status");
    check((await api(endpoint)).last_received_at, "Owner can see the last successfully processed transaction time");
    check((await webhook(event)).duplicate, "Retry returns success without collecting twice");
    await webhook({...event,id:randomUUID()});
    check((await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=?", [order.id])).n === 1, "The same bank transfer with a new event ID cannot duplicate the receipt");
    const simultaneous = await makeOrder(), sameEvent = payment(simultaneous);
    await Promise.all([webhook(sameEvent), webhook(sameEvent)]);
    check((await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=?", [simultaneous.id])).n === 1, "Concurrent retries serialize without duplicate receipts");
    const counter = await makeOrder(a, {status:"delivered",pickup:true});
    await webhook(payment(counter));
    check((await one("SELECT status,payment_status FROM orders WHERE id=?", [counter.id])).status === "delivered", "Payment for an immediate pickup does not regress its completed handoff status");
    const deposit = await makeOrder(a, {amount:70000});
    await mutate("INSERT INTO order_payments(store_id,order_id,amount,kind,reference,actor_id,method) VALUES(?,?,30000,'collect',?,?,'cash')", [a,deposit.id,`DEPOSIT-${stamp}`,users[0]]);
    await mutate("UPDATE orders SET payment_status='partially_paid' WHERE id=?", [deposit.id]);
    await webhook(payment(deposit,{transferAmount:70000}));
    check(Number((await one("SELECT SUM(amount) total FROM order_payments WHERE order_id=?",[deposit.id])).total) === 100000, "An order deposit and remaining QR receipt sum to the exact order total");
    const manual = await makeOrder();
    await mutate("UPDATE payment_intents SET status='paid',paid_amount=amount WHERE order_id=?", [manual.id]);
    await webhook(payment(manual));
    check((await one("SELECT COUNT(*) n FROM order_payments WHERE order_id=?",[manual.id])).n === 0, "A QR already closed by manual reconciliation does not create another receipt");
    const other = await makeOrder(b);
    await webhook(payment(other, {id:event.id}), 200, b, bKey);
    check((await one("SELECT payment_status FROM orders WHERE id=?", [other.id])).payment_status === "paid", "Event IDs are isolated across stores and do not swallow another store's transaction");
    const cancelled = await makeOrder(a, {status:"cancelled"});
    await webhook(payment(cancelled), 409);
    const expired = await makeOrder(a, {expired:true});
    await webhook(payment(expired), 409);
    const subscription = await makeOrder(a, {kind:"subscription"});
    await webhook(payment(subscription), 403);
    check(true, "Cancelled orders, expired sessions and platform subscription codes are rejected by the store webhook");
    const outstanding = await makeOrder();
    await mutate("UPDATE store_bank_accounts SET sepay_enabled=0 WHERE store_id=?", [a]);
    await webhook(payment(outstanding), 409);
    await mutate("UPDATE store_bank_accounts SET sepay_enabled=1 WHERE store_id=?", [a]);
    await mutate("UPDATE store_bank_accounts SET enabled=0 WHERE store_id=?", [a]);
    await webhook(payment(outstanding), 409);
    await mutate("UPDATE store_bank_accounts SET enabled=1 WHERE store_id=?", [a]);
    await api("workspace/sepay/disable", "POST", {});
    await webhook(payment(outstanding), 503);
    check(true, "Bank auto-reconciliation toggle and integration disable both stop automatic receipts");
    const old = aKey;
    aKey = (await api(endpoint, "POST", {replace:true})).apiKey;
    await webhook(payment(outstanding), 401, a, old);
    await webhook(payment(outstanding));
    check(true, "Rotating credentials revokes the old key and the new key resumes reconciliation");
    const globalKey = "QA_platform_" + randomBytes(24).toString("hex");
    await mutate("REPLACE INTO platform_integrations(provider,webhook_secret,api_key,enabled,created_by) VALUES('sepay','QA-secret',?,1,?)", [globalKey, users[0]]);
    const blocked = await makeOrder();
    await webhook(payment(blocked), 403, a, globalKey, true);
    check(true, "Platform webhook cannot bypass credentials configured for a store");
    await webhook(payment(blocked), 401, a, aKey, true);
    check(true, "Store API key cannot authenticate to the platform webhook");
    await mutate("DELETE FROM store_sepay_integrations WHERE store_id=?", [b]);
    const legacy = await makeOrder(b);
    await webhook(payment(legacy), 200, b, globalKey, true);
    check((await one("SELECT payment_status FROM orders WHERE id=?", [legacy.id])).payment_status === "paid", "Existing merchant integrations keep working until the owner configures a dedicated key");
    const malformed = await fetch(origin + `/api/sepay/webhook/stores/${a}`, {method:"POST",body:"{"});
    check(malformed.status === 400, "Malformed webhook JSON is rejected");
    const oversized = await fetch(origin + `/api/sepay/webhook/stores/${a}`, {method:"POST",body:"x".repeat(100001)});
    check(oversized.status === 413, "Oversized payloads are rejected");
    const invalidId = await fetch(origin + "/api/sepay/webhook/stores/invalid", {method:"POST",body:"{}"});
    check(invalidId.status === 400, "Invalid webhook store IDs are rejected");
    console.log(`PASS ${count} store SePay integration checks (real API handlers and SQL, no bank calls)`);
  } finally {
    for (const sid of stores) {
      for (const table of ["order_payments","order_status_events","order_items","payment_intents","orders","store_sepay_integrations","store_bank_accounts","audit_logs","store_memberships","subscriptions"]) await mutate(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
      await mutate("DELETE FROM stores WHERE id=?", [sid]);
      await mutate("DELETE FROM sepay_webhook_events WHERE provider_event_id LIKE ?", [`store:${sid}:%`]);
    }
    await mutate("DELETE FROM sepay_webhook_events WHERE provider_event_id LIKE ?", [`sepay-${stamp}-%`]);
    await mutate("DELETE FROM platform_integrations WHERE provider='sepay'");
    for (const c of saved) await mutate("INSERT INTO platform_integrations(provider,webhook_secret,api_key,enabled,created_by) VALUES('sepay',?,?,?,?)", [c.webhook_secret,c.api_key,c.enabled,c.created_by]);
    for (const uid of users) { await mutate("DELETE FROM sessions WHERE user_id=?", [uid]); await mutate("DELETE FROM users WHERE id=?", [uid]); }
  }
}); }
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
