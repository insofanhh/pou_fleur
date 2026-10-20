import { query } from "./db";
import { membership, jsonValue } from "./stores";
import { tenantId } from "./tenant";
import { HttpError, permissions } from "./auth";
import { refreshBillingAccess, accessEndSQL } from "./billing";
import { aiPlanAllowed, aiMonth, aiAllowance } from "./ai-policy";

export async function aiEntitlement() {
  const actor = await membership();
  if (!["owner", "admin", "manager", "support"].includes(actor.role)) throw new HttpError(403, "Vai trò hiện tại chưa được dùng trợ lý vận hành.");
  const sid = tenantId();
  const access = await refreshBillingAccess(sid);
  const [sub] = await query<any[]>(`SELECT sub.plan_id,COALESCE(v.limits,p.limits) limits,p.name,sub.status,${accessEndSQL()} expires_at FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id LEFT JOIN plan_versions v ON v.id=sub.plan_version_id WHERE sub.store_id=?`, [sid]);
  const allowed = aiPlanAllowed(Number(sub?.plan_id));
  const limit = aiAllowance(Number(sub?.plan_id), jsonValue(sub?.limits || {}));
  const [usage] = await query<any[]>("SELECT COUNT(*) used FROM ai_runs WHERE month_key=? AND (status='succeeded' OR (status='running' AND lease_until>UTC_TIMESTAMP()))", [aiMonth()]);
  return { actor, allowed, operational: access.status === "approved" && ["active", "free", "trialing"].includes(sub?.status), plan: sub?.name || "", planId: Number(sub?.plan_id || 0), limit, used: Number(usage?.used || 0), month: aiMonth(), reason: !allowed ? "Gói dịch vụ hiện tại chưa hỗ trợ trợ lý AI." : access.status !== "approved" ? "Cửa hàng đang tạm đóng băng hoặc chờ duyệt. Vui lòng kiểm tra Gói & hóa đơn." : "" };
}
export async function requireAI() {
  const e = await aiEntitlement();
  if (!e.allowed || !e.operational) throw new HttpError(403, e.reason || "Gói dịch vụ chưa sẵn sàng.");
  return e;
}
export function aiArea(actor: { role: string }, area: string) {
  if (!permissions[actor.role]?.includes(area)) throw new HttpError(403, "Bạn không có quyền xem hoặc thay đổi mục này.");
}
