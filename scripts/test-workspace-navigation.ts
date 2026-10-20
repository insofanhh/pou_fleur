import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { pool, query, mutate } from "../lib/db";
import { withSystem } from "../lib/tenant";
import { passwordHash } from "../lib/auth";

const origin=process.env.TEST_ORIGIN!, key=randomUUID().slice(0,8), password="Navigation-QA-2026-Only";
let checks=0;
const check=(value:unknown,label:string)=>{assert(value,label);checks++;console.log('PASS',label);};
function client(){let cookie='';return async(path:string,sid:number,status=200,body?:any)=>{
 const r=await fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json','x-fleur-store':String(sid),cookie},body:body?JSON.stringify(body):undefined});
 if(r.headers.get('set-cookie'))cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const d=await r.json();assert.equal(r.status,status,path+': '+JSON.stringify(d));return d;
};}
async function main(){return withSystem(async()=>{
 const users:number[]=[],stores:number[]=[];
 const one=async(sql:string,args:any[]=[])=> (await query<any[]>(sql,args))[0];
 const person=async()=>{const email=`navigation-${key}-${users.length}@example.test`,api=client();const r=await mutate('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)',['Navigation QA',email,passwordHash(password)]);users.push(r.insertId);await api('auth/login',1,200,{email,password});return {id:r.insertId,api};};
 const store=async(owner:number)=>{const r=await mutate("INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,?,?,'approved','{}','{}')",[`navigation-${key}-${stores.length}`,'Navigation QA',owner]);stores.push(r.insertId);await mutate("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')",[r.insertId,owner]);await mutate("INSERT INTO subscriptions(store_id,plan_id,status,billing_policy,access_started_at,access_ends_at) VALUES(?,2,'active',1,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))",[r.insertId]);return r.insertId;};
 try{
  const owner=await person(), other=await person(),staff=await person(),sid=await store(owner.id),otherSid=await store(other.id);
  await mutate("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'manager')",[sid,staff.id]);
  const summary=()=>owner.api('workspace/navigation-summary',sid);
  await client()('workspace/navigation-summary',sid,401);
  await staff.api('workspace/navigation-summary',sid,403);
  await other.api('workspace/navigation-summary',sid,403);
  check(true,'Summary requires authenticated owner of the requested store');
  let result=await summary();
  check(result.billing.pending_invoices===0&&result.billing.days_remaining===null,'Paid store outside five-day window has no warning');
  await mutate('UPDATE subscriptions SET access_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 DAY) WHERE store_id=?',[sid]);
  result=await summary();check(result.billing.days_remaining===3,'Paid access warns with server-calculated three days remaining');
  await mutate("UPDATE subscriptions SET status='trialing',trial_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),access_ends_at=NULL WHERE store_id=?",[sid]);
  result=await summary();check(result.billing.days_remaining===1,'Trial access uses its own expiry');
  await mutate('UPDATE subscriptions SET trial_ends_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE store_id=?',[sid]);
  result=await summary();check(result.billing.days_remaining===0,'Expired access is reported without automatic fallback mutation');
  await mutate("UPDATE subscriptions SET plan_id=4,status='free',access_ends_at=NULL,trial_ends_at=NULL WHERE store_id=?",[sid]);
  result=await summary();check(result.billing.days_remaining===null,'Indefinite Experience plan never gets an expiry warning');
  const invoice=async(storeId:number,tag:string,status='open',paid=0,purpose='renewal',deadline:string|null=null,amount=100)=>{
   const r=await mutate('INSERT INTO invoices(store_id,period_key,plan_name,amount,paid,status,due_date,purpose,payment_deadline_at) VALUES(?,?,?,?,?,?,CURDATE(),?,?)',[storeId,tag,'Studio',amount,paid,status,purpose,deadline]);return r.insertId;
  };
  await invoice(otherSid,'other');
  await invoice(sid,'renewal');await invoice(sid,'partial','open',10);
  await invoice(sid,'paid','paid',100);await invoice(sid,'void','void');await invoice(sid,'zero','open',0,'renewal',null,0);
  await invoice(sid,'expired-change','open',0,'plan_change','2000-01-01 00:00:00');
  await invoice(sid,'expired-partial','open',10,'plan_change','2000-01-01 00:00:00');
  result=await summary();check(result.billing.pending_invoices===3,'Count includes real unpaid/partial balances, excludes paid, void, zero and expired uncollected requests');
  check((await other.api('workspace/navigation-summary',otherSid)).billing.pending_invoices===1,'Invoice counts are isolated by store');
  await mutate("UPDATE subscriptions SET plan_id=2,status='active',access_ends_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 DAY) WHERE store_id=?",[sid]);
  const prepaid=await invoice(sid,'prepaid','paid',100);
  await mutate('UPDATE invoices i JOIN subscriptions s ON s.store_id=i.store_id SET i.effective_start_at=s.access_ends_at,i.effective_end_at=DATE_ADD(s.access_ends_at,INTERVAL 1 MONTH) WHERE i.id=?',[prepaid]);
  check((await summary()).billing.days_remaining===null,'Already-paid next period suppresses unnecessary expiry warning');
  await mutate("UPDATE invoices SET status='void' WHERE id=?",[prepaid]);
  await mutate("UPDATE stores SET status='suspended',billing_suspended=0,suspension_reason='Navigation QA manual freeze' WHERE id=?",[sid]);
  const snapshot=async()=>{
   const data:any={};for(const table of ['stores','subscriptions','invoices','account_trial_claims','trial_claims','email_outbox','notifications','audit_logs','payment_intents'])data[table]=await query(`SELECT * FROM ${table} WHERE ${table==='stores'?'id':'store_id'}=? ORDER BY 1`,[sid]);
   data.billing_payments=await query('SELECT bp.* FROM billing_payments bp JOIN invoices i ON i.id=bp.invoice_id WHERE i.store_id=? ORDER BY bp.id',[sid]);
   return createHash('sha256').update(JSON.stringify(data)).digest('hex');
  };
  const before=await snapshot();await summary();await summary();
  check(before===await snapshot(),'Repeated menu reads preserve store, subscription, invoices, payments, trials, mail, notifications and audit');
  check((await one('SELECT status,suspension_reason FROM stores WHERE id=?',[sid])).status==='suspended','Manual freeze is preserved and owner can still see billing notice');
  console.log(`${checks} workspace navigation API checks passed`);
 }finally{
  for(const sid of stores){for(const table of ['invoices','subscriptions','store_memberships'])await mutate(`DELETE FROM ${table} WHERE store_id=?`,[sid]);await mutate('DELETE FROM stores WHERE id=?',[sid]);}
  for(const uid of users){await mutate('DELETE FROM sessions WHERE user_id=?',[uid]);await mutate('DELETE FROM users WHERE id=?',[uid]);}
 }
});}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
