import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pool } from "./db";
import { HttpError } from "./auth";
import { storeOwner } from "./stores";
import { tenantId } from "./tenant";

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
export async function storeSepayCredentials(storeId: number, c: any = pool) {
  const [rows]: any = await c.execute(
    "SELECT api_key_hash,enabled FROM store_sepay_integrations WHERE store_id=?",
    [storeId],
  );
  return rows[0] as { api_key_hash: string; enabled: boolean } | undefined;
}

export function verifyStoreSepayKey(headers: Headers, credentials?: { api_key_hash: string; enabled: boolean }) {
  if (!credentials?.enabled) throw new HttpError(503, "SePay của cửa hàng chưa được cấu hình hoặc đã tắt.");
  const supplied = headers.get("authorization")?.match(/^Apikey\s+(\S+)$/i)?.[1];
  if (!supplied || supplied.length > 256) return false;
  const actual = Buffer.from(hashKey(supplied), "hex");
  const expected = Buffer.from(credentials.api_key_hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function storeSepayAPI(path: string, method: string, body: unknown, url: URL) {
  const actor = await storeOwner(), storeId = tenantId();
  const webhookUrl = new URL(`/api/sepay/webhook/stores/${storeId}`, process.env.APP_ORIGIN || url.origin).toString();
  if (path === "credentials" && method === "GET") {
    const [rows]: any = await pool.execute("SELECT enabled,api_last4,last_received_at,created_at,updated_at FROM store_sepay_integrations WHERE store_id=?", [storeId]);
    return { configured: !!rows[0], webhookUrl, ...rows[0] };
  }
  if (method !== "POST" || !["credentials", "disable"].includes(path))
    throw new HttpError(405, "Thao tác không được hỗ trợ.");
  const input = z.object({ apiKey: z.string().trim().min(24).max(200).regex(/^[A-Za-z0-9_-]+$/).optional(), replace: z.boolean().default(false) }).parse(body);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [storeId]);
    const existing = await storeSepayCredentials(storeId, c);
    let apiKey: string | undefined;
    if (path === "disable") {
      await c.execute("UPDATE store_sepay_integrations SET enabled=0,updated_by=? WHERE store_id=?", [actor.id, storeId]);
    } else {
      if (existing && !input.replace) throw new HttpError(409, "Đã có API key. Xác nhận đổi khóa sẽ vô hiệu hóa khóa cũ.");
      apiKey = input.apiKey || "flr_sepay_" + randomBytes(32).toString("base64url");
      await c.execute("INSERT INTO store_sepay_integrations(api_key_hash,api_last4,enabled,updated_by) VALUES(?,?,1,?) ON DUPLICATE KEY UPDATE api_key_hash=VALUES(api_key_hash),api_last4=VALUES(api_last4),enabled=1,updated_by=VALUES(updated_by)", [hashKey(apiKey), apiKey.slice(-4), actor.id]);
    }
    await c.execute("INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,?,?,?)", [actor.id, "sepay:" + (path === "disable" ? "disable" : existing ? "rotate" : "create"), "store_sepay_integrations", String(storeId)]);
    await c.commit();
    return { ok: true, webhookUrl, ...(apiKey ? { apiKey } : {}) };
  } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
}
