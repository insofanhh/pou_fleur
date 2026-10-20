import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { migrateExperiencePlan } from "./experience-plan-schema.mjs";
assert(process.env.MYSQL_HOST === "127.0.0.1" && process.env.MYSQL_PORT === "3310", "Local QA only");
const db="fleur_experience_migration_"+randomBytes(5).toString("hex");
const c=await mysql.createConnection({host:"127.0.0.1",port:3310,user:"root",dateStrings:true});
let checks=0;const check=(v,label)=>{assert(v,label);checks++;console.log("PASS",label);};
const rows=async(sql,args=[]) => (await c.query(sql,args))[0];
const decode=v=>typeof v==='string'?JSON.parse(v):v;
try{
 await c.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);await c.query(`USE ${db}`);
 // Rehearse the exact migration with unrelated catalog and business snapshots.
 await c.query("CREATE TABLE plans(id INT PRIMARY KEY,name VARCHAR(160),monthly_price INT,limits JSON,active BOOLEAN,trial_days INT)");
 await c.query("CREATE TABLE plan_versions(id INT AUTO_INCREMENT PRIMARY KEY,plan_id INT,name VARCHAR(160),monthly_price INT,limits JSON,trial_days INT,effective_at DATETIME)");
 await c.query("CREATE TABLE schema_migrations(version VARCHAR(100) PRIMARY KEY)");
 await c.query("CREATE TABLE business_snapshot(id INT PRIMARY KEY,trial_end DATETIME,amount INT)");
 await c.query("INSERT INTO plans VALUES(1,'Khởi đầu',139000,'{\"products\":30}',1,23),(2,'Studio',299000,'{\"products\":300}',1,7),(3,'Atelier',599000,'{\"products\":1000}',1,0)");
 await c.query("INSERT INTO business_snapshot VALUES(1,'2026-12-31 12:00:00',139000)");
 const old=JSON.stringify(await rows("SELECT * FROM plans ORDER BY id")),business=JSON.stringify(await rows("SELECT * FROM business_snapshot"));
 check(!(await migrateExperiencePlan(c)).skipped,"First migration adds Free tier");
 const [free]=await rows("SELECT * FROM plans WHERE id=4");
 check(free.monthly_price===0&&free.trial_days===0&&free.active===1,"Free has zero price and no timed trial");
 check(decode(free.limits).ai_messages===10&&decode(free.limits).email_sends===50,"Free has explicit bounded AI and email quotas");
 check(JSON.stringify(await rows("SELECT * FROM plans WHERE id<>4 ORDER BY id"))===old&&JSON.stringify(await rows("SELECT * FROM business_snapshot"))===business,"Existing paid catalog and business dates/money are untouched");
 check((await rows("SELECT * FROM plan_versions WHERE plan_id=4")).length===1,"Migration captures initial immutable offer version");
 await c.query("UPDATE plans SET limits='{\"ai_messages\":0,\"products\":3}' WHERE id=4");
 check((await migrateExperiencePlan(c)).skipped,"Repeated migration is a no-op");
 check((await rows("SELECT * FROM plan_versions WHERE plan_id=4")).length===1&&decode((await rows("SELECT limits FROM plans WHERE id=4"))[0].limits).ai_messages===0,"Rerun preserves platform edits and intentional zero AI quota");
 await c.query("DELETE FROM schema_migrations WHERE version='experience-plan-v1'");
 await assert.rejects(()=>migrateExperiencePlan(c),/occupied/);checks++;
 check((await rows("SELECT * FROM plans WHERE id=4"))[0].name===free.name,"Occupied ID without marker is rejected without overwriting catalog");
 console.log(`${checks} Experience migration checks passed`);
}finally{await c.query(`DROP DATABASE IF EXISTS ${db}`);await c.end();}
