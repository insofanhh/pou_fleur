// Run with --env-file=.env.local. Reads only encrypted AI config locally;
// all fixtures and writes use the isolated QA database/server on port 3006.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { passwordHash } from "../lib/auth";
import { pool } from "../lib/db";
import { hanoiDateKey } from "../lib/date-time";
const origin = "http://127.0.0.1:3006";
async function main() {
const local = await mysql.createConnection({ host: process.env.MYSQL_HOST || "127.0.0.1", port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || "root", password: process.env.MYSQL_PASSWORD || "", database: process.env.MYSQL_DATABASE || "fleur_store" });
const qa = await mysql.createConnection({ host: "127.0.0.1", port: 3310, user: "root", database: "fleur_saas_test", dateStrings: true });
const one = async (sql: string, args: any[] = []) => ((await qa.execute(sql, args))[0] as any[])[0];
let cookie = "", sid = 0, uid = 0, checks = 0;
const saved = await one("SELECT * FROM platform_settings WHERE setting_key='deepseek_ai'");
async function api(path: string, method = "GET", body?: any) {
  const r = await fetch(origin + "/api/" + path, { method, headers: { cookie, origin, "content-type": "application/json", "x-fleur-store": String(sid || 1) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.headers.get("set-cookie")) cookie = r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  const data = await r.json(); assert.equal(r.status, 200, data.error); return data;
}
function check(value: unknown, label: string) { assert(value, label); console.log("PASS LIVE", label); checks++; }
async function chat(message: string) { return api("workspace/ai/chat", "POST", { message, conversationId: randomUUID(), requestId: randomUUID() }); }
try {
  const [configs]: any = await local.execute("SELECT setting_value FROM platform_settings WHERE setting_key='deepseek_ai'");
  assert(configs[0], "Save DeepSeek config locally first");
  const value = typeof configs[0].setting_value === "string" ? configs[0].setting_value : JSON.stringify(configs[0].setting_value);
  await qa.execute("REPLACE INTO platform_settings(setting_key,setting_value) VALUES('deepseek_ai',?)", [value]);
  const suffix = randomUUID().slice(0, 8), email = `ai-live-${suffix}@example.test`, password = "AI-Live-QA-Only-2026";
  const [user]: any = await qa.execute("INSERT INTO users(name,email,password_hash) VALUES('AI Live QA',?,?)", [email, passwordHash(password)]); uid = user.insertId;
  const settings = { open: true, shipping: 30000, free_shipping: 1000000, slots: ["08:00-10:00", "14:00-16:00"], capacity: 50, lead_minutes: 0, advance_days: 30, closed_dates: [] };
  const [store]: any = await qa.execute("INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,'Live AI QA',?,'approved',?,'{}')", ["ai-live-" + suffix, uid, JSON.stringify(settings)]); sid = store.insertId;
  await qa.execute("INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')", [sid, uid]);
  const version = await one("SELECT id FROM plan_versions WHERE plan_id=2 ORDER BY id DESC LIMIT 1");
  await qa.execute("INSERT INTO subscriptions(store_id,plan_id,status,plan_version_id,billing_policy,trial_started_at,trial_ends_at,access_ends_at) VALUES(?,2,'trialing',?,1,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY))", [sid, version.id]);
  await api("auth/login", "POST", { email, password });
  const attention = await chat("Kiểm tra những đơn đang cần chú ý của cửa hàng và số email gửi lỗi. Lấy dữ liệu thực tế, không tạo thay đổi.");
  check(attention.messages.at(-1).cards.some((c: any) => c.title === "Việc cần chú ý"), "Real model calls attention tool and returns sourced card");
  const date = hanoiDateKey();
  const note = await chat(`Tạo bản xem trước ghi chú trên lịch ngày ${date}: tiêu đề 'Chuẩn bị hoa cưới QA', nội dung 'Kiểm tra giấy gói và hoa trắng'. Chưa lưu, chờ tôi bấm nút xác nhận.`);
  const action = note.messages.at(-1).cards.find((c: any) => c.type === "note");
  check(action?.status === "pending" && (await one("SELECT COUNT(*) n FROM calendar_notes WHERE store_id=?", [sid])).n === 0, "Real model prepares note without writing before confirmation");
  await api("workspace/ai/actions/" + action.actionId, "POST", {});
  check((await one("SELECT COUNT(*) n FROM calendar_notes WHERE store_id=?", [sid])).n === 1, "Real AI note confirmed through server action gateway");
  const metrics = await chat(`Báo cáo hoạt động cửa hàng từ ${date} đến ${date}. Hãy lấy số liệu trực tiếp từ công cụ báo cáo, không suy đoán lợi nhuận.`);
  check(metrics.messages.at(-1).cards.some((c: any) => c.title === "Phân tích hoạt động"), "Real model retrieves analytics from established backend definitions");
  const tomorrow = hanoiDateKey(Date.now() + 86400000);
  const order = await chat(`Chuẩn bị bản xem trước tạo đơn với thiết kế riêng (không phải sản phẩm catalog) tên 'Bó hoa thử AI', giá 200000 VNĐ, số lượng 1. Người đặt và nhận chính khách: Nguyễn QA, SĐT 0901234567. Giao cho khách tại 123 Đường Hoa, Hà Nội, ngày ${tomorrow}, khung 14:00-16:00. Phí giao do tôi chỉ định 15000 VNĐ. Không có email, không lời nhắn, chưa thu tiền, chưa xác nhận đơn. Địa chỉ của store chưa cài tọa độ nên không bắt buộc Goong. Tôi muốn xem card đề xuất để bấm xác nhận sau.`);
  await mkdir(".local/ai-qa", { recursive: true }); await writeFile(".local/ai-qa/live-order-debug.json", JSON.stringify(order, null, 2));
  const orderAction = order.messages.at(-1).cards.find((c: any) => c.type === "order");
  check(orderAction?.data?.quote?.total === 215000 && (await one("SELECT COUNT(*) n FROM orders WHERE store_id=?", [sid])).n === 0, "Real model prepares order with exact backend price and no premature order");
  await api("workspace/ai/actions/" + orderAction.actionId, "POST", {});
  const created = await one("SELECT total,status,payment_status FROM orders WHERE store_id=?", [sid]);
  check(created.total === 215000 && created.status === "pending" && created.payment_status === "unpaid", "Real AI order confirmation creates pending unpaid order");
  await mkdir(".local/ai-qa", { recursive: true });
  await writeFile(".local/ai-qa/live-report.json", JSON.stringify({ checks, provider: "DeepSeek live", model: JSON.parse(value).model, completedAt: new Date().toISOString() }));
  console.log(`${checks} live AI checks passed`);
} finally {
  if (sid) {
    for (const table of ["ai_tool_calls", "ai_messages", "ai_action_drafts", "ai_runs", "ai_conversations", "order_status_events", "order_payments", "order_items", "payment_intents", "orders", "calendar_notes", "customers", "email_outbox", "notifications", "domain_outbox", "audit_logs", "subscriptions", "invoices", "store_memberships"]) await qa.execute(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
    await qa.execute("DELETE FROM stores WHERE id=?", [sid]);
  }
  if (uid) { await qa.execute("DELETE FROM sessions WHERE user_id=?", [uid]); await qa.execute("DELETE FROM users WHERE id=?", [uid]); }
  await qa.execute("DELETE FROM platform_settings WHERE setting_key='deepseek_ai'");
  if (saved) await qa.execute("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('deepseek_ai',?,?)", [saved.setting_value, saved.updated_by]);
  await local.end(); await qa.end(); await pool.end();
}

}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
