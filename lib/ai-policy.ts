import { z } from "zod";

// Plan IDs are stable product identities; display names are editable.
export const aiPlanAllowed = (planId: number) => [1, 2, 3, 4].includes(Number(planId));
export const defaultAIAllowance = (planId: number) => Number(planId) === 4 ? 10 : Number(planId) === 1 ? 50 : Number(planId) === 2 ? 300 : Number(planId) === 3 ? 1500 : 0;
// Missing legacy quotas get the tier default. An explicit zero disables new
// requests; malformed persisted values fail closed rather than granting quota.
export function aiAllowance(planId: number, limits: { ai_messages?: unknown } | null | undefined) {
  if (!aiPlanAllowed(planId)) return 0;
  if (limits?.ai_messages == null) return defaultAIAllowance(planId);
  const count = Number(limits.ai_messages);
  return Number.isSafeInteger(count) && count >= 0 && count <= 100000 ? count : 0;
}
export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  model: z.enum(["deepseek-flash", "deepseek-v4-pro"]).default("deepseek-flash"),
  maxOutputTokens: z.number().int().min(256).max(3000).default(1400),
  apiKey: z.string().trim().min(12).max(250).regex(/^[A-Za-z0-9_\-]+$/).optional(),
  removeKey: z.boolean().default(false),
});
export const validDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, "Ngày không hợp lệ.");
export const noteInput = z.object({ title: z.string().trim().min(1).max(160), content: z.string().max(3000).default(""), day: validDay, color: z.enum(["#555555", "#a34b40", "#96731b", "#3c7665", "#4f6395"]).default("#4f6395") }).strict();
export const reminderInput = z.object({ title: z.string().trim().min(1).max(160), content: z.string().max(1500).default(""), dueAt: z.string().datetime({ offset: true }), orderId: z.number().int().positive().nullable().default(null), assignedTo: z.number().int().positive().nullable().default(null) }).strict();
export const issueInput = z.object({ title: z.string().trim().min(5).max(160), content: z.string().trim().min(10).max(2000), page: z.string().max(200).regex(/^\/(?!\/)/).default("/admin/overview") }).strict();
export const aiMonth = (time = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date(time));
export const normalizeAICurrency = (s: string) => s.replace(/([\d.,])\s*[₫đ](?=[\s.,;:!?)]|$)/gi, "$1 VNĐ");
export const redactAISecrets = (s: string) => s
  .replace(/\b(?:sk-|flr_sepay_|flr_whsec_)[A-Za-z0-9_-]{8,}/g, "[đã ẩn khóa]")
  .replace(/\b(?:Bearer|Api-Key)\s+[A-Za-z0-9_.-]+/gi, "[đã ẩn xác thực]")
  .replace(/((?:password|api[_-]?key|token|secret|cookie|MYSQL_PASSWORD)\s*[=:]\s*)[^\s,;]+/gi, "$1[đã ẩn]");
