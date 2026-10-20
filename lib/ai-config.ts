import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { query, mutate } from "./db";
import { HttpError } from "./auth";
import { aiConfigSchema } from "./ai-policy";
import { deepseekCompletion } from "./ai-provider";
import { z } from "zod";

type Config = { enabled: boolean; model: "deepseek-flash" | "deepseek-v4-pro"; maxOutputTokens: number; ciphertext?: string };
function encryptionKey() {
  const master = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.CRON_SECRET;
  if (!master || master.length < 32) throw new HttpError(503, "Máy chủ cần CREDENTIAL_ENCRYPTION_KEY hoặc CRON_SECRET tối thiểu 32 ký tự để bảo vệ API key.");
  return createHash("sha256").update("fleurious:deepseek:v1:" + master).digest();
}
export function sealAIKey(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return [iv.toString("base64url"), Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
export function openAIKey(value: string) {
  try {
    const [iv, data, tag] = value.split(".");
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8");
  } catch { throw new HttpError(503, "Không mở được API key đã lưu. Admin platform cần nhập lại key sau khi thay khóa mã hóa máy chủ."); }
}
export async function aiConfig(): Promise<Config> {
  const [row] = await query<any[]>("SELECT setting_value FROM platform_settings WHERE setting_key='deepseek_ai'");
  if (!row) return { enabled: false, model: "deepseek-flash", maxOutputTokens: 1400 };
  try {
    return z.object({ enabled: z.boolean(), model: aiConfigSchema.shape.model, maxOutputTokens: aiConfigSchema.shape.maxOutputTokens, ciphertext: z.string().optional() }).parse(typeof row.setting_value === "string" ? JSON.parse(row.setting_value) : row.setting_value);
  } catch { throw new HttpError(503, "Cấu hình AI chưa hợp lệ. Admin platform cần lưu lại cấu hình."); }
}
export async function publicAIConfig() {
  const c = await aiConfig();
  return { enabled: c.enabled, model: c.model, maxOutputTokens: c.maxOutputTokens, configured: !!c.ciphertext, encryptionReady: !!((process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.CRON_SECRET || "").length >= 32) };
}
export async function saveAIConfig(body: unknown, actor: number) {
  const v = aiConfigSchema.parse(body), old = await aiConfig();
  if (v.apiKey && v.removeKey) throw new HttpError(400, "Chọn nhập key mới hoặc xóa key.");
  const ciphertext = v.removeKey ? undefined : v.apiKey ? sealAIKey(v.apiKey) : old.ciphertext;
  const enabled = v.enabled && !v.removeKey;
  if (enabled && !ciphertext) throw new HttpError(400, "Nhập API key DeepSeek trước khi bật trợ lý.");
  const next: Config = { enabled, model: v.model, maxOutputTokens: v.maxOutputTokens, ...(ciphertext ? { ciphertext } : {}) };
  await mutate("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('deepseek_ai',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)", [JSON.stringify(next), actor]);
  await mutate("INSERT INTO platform_audit_logs(actor_id,action,metadata) VALUES(?,'ai:config',?)", [actor, JSON.stringify({ enabled, model: v.model, keyChanged: !!v.apiKey || v.removeKey })]);
  return publicAIConfig();
}
export async function testAIConnection() {
  const c = await aiConfig();
  if (!c.ciphertext) throw new HttpError(400, "Lưu API key trước khi kiểm tra kết nối.");
  const result = await deepseekCompletion(openAIKey(c.ciphertext), c.model, [{ role: "user", content: "Trả lời đúng một từ: OK" }], [], 64, AbortSignal.timeout(12000));
  return { ok: true, model: c.model, message: result.message.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}
