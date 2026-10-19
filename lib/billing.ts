import { formatDateTime, parseDateTime } from "./date-time";
import { emailAllowance } from "./email-policy";
import { query, pool } from "./db";
import { withSystem } from "./tenant";
import { HttpError } from "./auth";
import { systemTemplate } from "./system-email";
import { interpolateEmail } from "./email-content";
import { formatMoney } from "./money";
import type { PoolConnection } from "mysql2/promise";
import { createHash } from "node:crypto";

// Anniversary billing, including months shorter than the anchor day.
export function nextBillingDate(
  start: string,
  anchor = Number(start.slice(8, 10)),
) {
  const d = new Date(start.slice(0, 10) + "T00:00:00Z");
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
  last.setUTCDate(Math.min(anchor, last.getUTCDate()));
  return last.toISOString().slice(0, 10);
}
async function today(c: PoolConnection) {
  const [rows]: any = await c.execute(
    "SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') day",
  );
  return rows[0].day as string;
}
async function subscription(c: PoolConnection, sid: number) {
  await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [sid]);
  const [rows]: any = await c.execute(
    "SELECT * FROM subscriptions WHERE store_id=? FOR UPDATE",
    [sid],
  );
  if (!rows[0]) throw new HttpError(409, "Cửa hàng chưa có gói dịch vụ.");
  // Lock tenant state, not the joined catalog: two stores switching in opposite
  // directions must not exclusively lock each other's current package.
  const sub = rows[0];
  const [plans]: any = await c.execute(
    "SELECT name,monthly_price,trial_days FROM plans WHERE id=?",
    [sub.plan_id],
  );
  const v = sub.plan_version_id
    ? await versionPlan(c, sub.plan_version_id)
    : null;
  return {
    ...sub,
    name: v?.name ?? plans[0]?.name,
    monthly_price: v?.monthly_price ?? plans[0]?.monthly_price,
    trial_days: plans[0]?.trial_days,
  };
}
async function invoice(
  c: PoolConnection,
  sid: number,
  plan: any,
  start: string,
  end: string,
  due: string,
  key = `cycle:${start}`,
): Promise<any> {
  const [version]: any = await c.execute(
    "SELECT id FROM plan_versions WHERE plan_id=? ORDER BY id DESC LIMIT 1",
    [plan.plan_id],
  );
  await c.execute(
    "INSERT INTO invoices(store_id,period_key,plan_name,amount,paid,status,due_date,period_start,period_end,plan_version_id) VALUES(?,?,?,?,0,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
    [
      sid,
      key,
      plan.name,
      plan.monthly_price,
      Number(plan.monthly_price) === 0 ? "paid" : "open",
      due,
      start,
      end,
      version[0]?.id || null,
    ],
  );
  const [rows]: any = await c.execute(
    "SELECT * FROM invoices WHERE store_id=? AND period_key=? FOR UPDATE",
    [sid, key],
  );
  if (rows[0]?.status === "void")
    return invoice(
      c,
      sid,
      plan,
      start,
      end,
      due,
      `${key.split(":r")[0]}:r${rows[0].id}`,
    );
  return rows[0];
}
async function notice(
  c: PoolConnection,
  sid: number,
  key: string,
  title: string,
  body: string,
) {
  await c.execute(
    "INSERT IGNORE INTO notifications(store_id,user_id,event_key,title,body,href) SELECT id,owner_id,?,?,?,CONCAT('/workspace/',id,'/billing') FROM stores WHERE id=?",
    [key, title, body, sid],
  );
}
async function mail(c: PoolConnection, i: any, key: string) {
  const [owners]: any = await c.execute(
    "SELECT s.name store_name,u.name owner_name,u.email FROM stores s JOIN users u ON u.id=s.owner_id WHERE s.id=?",
    [i.store_id],
  );
  const owner = owners[0];
  if (!owner?.email) return;
  const template = await systemTemplate(c,key);
  const values = {
    ...owner,
    plan_name: i.plan_name,
    invoice_reference: `INV-${i.id}`,
    invoice_amount: formatMoney(
      Math.max(
        0,
        i.amount - (key === "subscription_payment_received" ? 0 : i.paid),
      ),
    ),
    invoice_due_date:
      i.due_at || i.due_date
        ? formatBillingTime(i.due_at || stamp(i.due_date))
        : "",
    invoice_period_start: i.period_start ? formatBillingTime(stamp(i.period_start)) : "",
    invoice_period_end: i.period_end
      ? formatBillingTime(stamp(i.period_end))
      : "",
    trial_days: String(i.trial_days || ""),
    billing_url:
      (process.env.APP_ORIGIN || "").replace(/\/$/, "") +
      `/workspace/${i.store_id}/billing`,
  };
  await c.execute(
    "INSERT IGNORE INTO email_outbox(store_id,dedupe_key,template_key,kind,recipient,subject,body) VALUES(?,?,?,'transactional',?,?,?)",
    [
      i.store_id,
      `${key}:${i.id}`,
      key,
      owner.email,
      interpolateEmail(template.subject, values)
        .replace(/[\r\n]/g, " ")
        .slice(0, 240),
      interpolateEmail(template.body, values),
    ],
  );
}

// Canonical access instants are UTC. Legacy DATE periods remain inclusive.
export const accessEndSQL = (alias = "sub") =>
  `COALESCE(${alias}.access_ends_at,${alias}.trial_ends_at,DATE_ADD(COALESCE(${alias}.current_period_end,${alias}.period_end),INTERVAL 1 DAY))`;
const stamp = (value: string) =>
  value.slice(0, 19).replace("T", " ").padEnd(19, " 00:00:00");
const instant = (value: string) =>
  Date.parse(stamp(value).replace(" ", "T") + "Z");
const sqlStamp = (date: Date) =>
  date.toISOString().slice(0, 19).replace("T", " ");
const addDays = (value: string, days: number) =>
  sqlStamp(new Date(instant(value) + days * 86400000));
export function nextBillingInstant(start: string, anchor?: number) {
  // Use the merchant-facing Vietnam calendar, while persisting UTC instants.
  const local = new Date(instant(start) + 7 * 3600000);
  const day = anchor || local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0),
  ).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return sqlStamp(new Date(local.getTime() - 7 * 3600000));
}
async function clock(c: PoolConnection) {
  const [rows]: any = await c.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%d %H:%i:%s') time",
  );
  return rows[0].time as string;
}
function endOf(sub: any): string | null {
  return (
    sub.access_ends_at ||
    sub.trial_ends_at ||
    (sub.current_period_end || sub.period_end
      ? addDays(sub.current_period_end || sub.period_end, 1)
      : null)
  );
}
async function versionPlan(c: PoolConnection, versionId: number) {
  let [rows]: any = await c.execute(
    "SELECT *,plan_id FROM plan_versions WHERE id=?",
    [versionId],
  );
  // Versions are immutable. Normally a snapshot read needs no catalog lock.
  // A just-created ID obtained by a locking read can be newer than the MySQL
  // transaction snapshot; use a current read only in that case (also TiDB-safe).
  if (!rows[0])
    [rows] = await c.execute(
      "SELECT *,plan_id FROM plan_versions WHERE id=? FOR UPDATE",
      [versionId],
    );
  if (!rows[0])
    throw new HttpError(409, "Không tìm thấy phiên bản gói đã cam kết.");
  return { ...rows[0], version_id: rows[0].id };
}

// Called inside registration's transaction; pending merchants retain this offer.
export async function captureRegistrationPlan(
  c: PoolConnection,
  sid: number,
  planId = 1,
  expectedVersion?: number,
) {
  const [owners]: any = await c.execute(
    "SELECT owner_id FROM stores WHERE id=? FOR UPDATE",
    [sid],
  );
  const ownerId = owners[0]?.owner_id;
  await c.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [ownerId]);
  const [plans]: any = await c.execute(
    "SELECT * FROM plans WHERE id=? AND active=1 FOR UPDATE",
    [planId],
  );
  if (!plans[0]) throw new HttpError(404, "Gói dịch vụ không tồn tại.");
  const [versions]: any = await c.execute(
    "SELECT id FROM plan_versions WHERE plan_id=? ORDER BY id DESC LIMIT 1",
    [planId],
  );
  if (!versions[0])
    throw new HttpError(409, "Gói chưa có phiên bản. Vui lòng chạy migration.");
  if (expectedVersion && Number(versions[0].id) !== expectedVersion)
    throw new HttpError(
      409,
      "Ưu đãi gói đã thay đổi. Vui lòng xem lại giá và số ngày thử trước khi đăng ký lại.",
    );
  // Plan 1 is the first-store onboarding trial. Its duration is the current
  // platform-configured value; the selected plan version and day count are
  // snapshotted so later catalog edits do not change a pending registration.
  let days = Number(plans[0].trial_days || 0);
  if (days > 0) {
    await c.execute(
      "INSERT IGNORE INTO account_trial_claims(user_id,bucket,store_id,plan_id,plan_version_id,trial_days) VALUES(?,?,?,?,?,?)",
      [ownerId, trialBucket(planId), sid, planId, versions[0].id, days],
    );
    const [claims]: any = await c.execute(
      "SELECT * FROM account_trial_claims WHERE user_id=? AND bucket=? FOR UPDATE",
      [ownerId, trialBucket(planId)],
    );
    if (Number(claims[0]?.store_id) !== sid) days = 0;
  }
  await c.execute(
    "UPDATE subscriptions SET plan_id=?,plan_version_id=?,registration_plan_version_id=?,trial_days_granted=?,billing_policy=1,status='pending_activation' WHERE store_id=?",
    [planId, versions[0].id, versions[0].id, days, sid],
  );
}

export const trialBucket = (planId: number) =>
  Number(planId) === 1 ? "starter" : "discovery";
export async function accountTrialAvailability(
  userId: number,
  runner: any = pool,
) {
  return withSystem(async () => {
    const [claims]: any = await runner.execute(
      "SELECT t.*,p.name plan_name FROM account_trial_claims t LEFT JOIN plan_versions p ON p.id=t.plan_version_id WHERE t.user_id=? ORDER BY t.claimed_at",
      [userId],
    );
    const discoveryClaim = claims.find((claim: any) => claim.bucket === "discovery");
    return {
      // Starter is an automatic onboarding entitlement, not a selectable
      // workspace trial. Only the shared discovery entitlement is available
      // for self-service trial selection.
      total: 1,
      available: discoveryClaim ? 0 : 1,
      discovery_available: !discoveryClaim,
      claims,
    };
  });
}

// Scheduled trials never overlap paid coverage or replace an active entitlement.
async function activateAccountTrial(
  c: PoolConnection,
  sid: number,
  time: string,
) {
  await subscription(c, sid);
  const [rows]: any = await c.execute(
    "SELECT * FROM account_trial_claims WHERE store_id=? AND activated_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY starts_at",
    [sid, time, time],
  );
  for (const claim of rows) {
    const sub = await subscription(c, sid);
    if (sub.access_started_at && sub.access_started_at >= claim.ends_at) {
      await c.execute(
        "UPDATE account_trial_claims SET activated_at=UTC_TIMESTAMP() WHERE user_id=? AND bucket=?",
        [claim.user_id, claim.bucket],
      );
      continue;
    }
    await c.execute(
      "UPDATE subscriptions SET plan_id=?,plan_version_id=?,registration_plan_version_id=?,trial_days_granted=?,active_trial_bucket=?,billing_policy=1,status='trialing',trial_started_at=?,trial_ends_at=?,access_started_at=?,access_ends_at=?,current_period_start=DATE(?),current_period_end=DATE(?),period_end=DATE(?),version=version+1 WHERE store_id=?",
      [
        claim.plan_id,
        claim.plan_version_id,
        claim.plan_version_id,
        claim.trial_days,
        claim.bucket,
        claim.starts_at,
        claim.ends_at,
        claim.starts_at,
        claim.ends_at,
        claim.starts_at,
        claim.ends_at,
        claim.ends_at,
        sid,
      ],
    );
    await c.execute(
      "UPDATE account_trial_claims SET activated_at=UTC_TIMESTAMP() WHERE user_id=? AND bucket=?",
      [claim.user_id, claim.bucket],
    );
    await c.execute(
      "INSERT IGNORE INTO trial_claims(store_id,trial_days,started_at,ends_at) VALUES(?,?,?,?)",
      [sid, claim.trial_days, claim.starts_at, claim.ends_at],
    );
    const plan = await versionPlan(c, claim.plan_version_id);
    await notice(
      c,
      sid,
      `trial:start:${claim.user_id}:${claim.bucket}`,
      "Đã bắt đầu dùng thử",
      `Gói ${plan.name} được dùng thử ${claim.trial_days} ngày. Hết hạn lúc ${formatBillingTime(claim.ends_at)}.`,
    );
    await mail(
      c,
      {
        id: `trial-${claim.user_id}-${claim.bucket}`,
        store_id: sid,
        plan_name: plan.name,
        amount: plan.monthly_price,
        paid: 0,
        due_date: claim.ends_at,
        period_start: claim.starts_at,
        period_end: claim.ends_at,
        trial_days: claim.trial_days,
      },
      "subscription_trial_started",
    );
  }
}

export async function previewAccountTrial(
  c: PoolConnection,
  sid: number,
  planId: number,
  actor: number,
) {
  return withSystem(async () => {
    if (Number(planId) === 1)
      throw new HttpError(
        409,
        "Gói Khởi đầu được cấp tự động theo số ngày admin cấu hình khi mở cửa hàng đầu tiên; không đăng ký lại dùng thử từ workspace.",
      );
    const sub = await subscription(c, sid),
      time = await clock(c);
    const [stores]: any = await c.execute(
      "SELECT owner_id,status,billing_suspended FROM stores WHERE id=?",
      [sid],
    );
    if (Number(stores[0]?.owner_id) !== Number(actor))
      throw new HttpError(403, "Chỉ chủ cửa hàng được đăng ký dùng thử.");
    if (
      !["approved", "suspended"].includes(stores[0].status) ||
      (stores[0].status === "suspended" && !stores[0].billing_suspended)
    )
      throw new HttpError(
        409,
        "Cửa hàng chưa được duyệt hoặc đang bị platform đóng băng.",
      );
    await c.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [actor]);
    // The owner row serializes claims across stores. Do not lock claims of a
    // different store: its billing request may already hold a catalog lock.
    const [claims]: any = await c.execute(
      "SELECT * FROM account_trial_claims WHERE user_id=?",
      [actor],
    );
    if (claims.some((t: any) => t.bucket === trialBucket(planId)))
      throw new HttpError(
        409,
        "Tài khoản đã dùng hoặc đang giữ lượt thử của nhóm gói này. Khởi đầu có 1 lượt; các gói còn lại dùng chung 1 lượt.",
      );
    const [plans]: any = await c.execute(
      "SELECT v.* FROM plans p JOIN plan_versions v ON v.id=(SELECT MAX(id) FROM plan_versions WHERE plan_id=p.id) WHERE p.id=? AND p.active=1 FOR UPDATE",
      [planId],
    );
    const plan = plans[0];
    if (!plan || Number(plan.trial_days) <= 0)
      throw new HttpError(409, "Gói này hiện không mở dùng thử.");
    const [invoices]: any = await c.execute(
      "SELECT * FROM invoices WHERE store_id=? AND status<>'void' ORDER BY id FOR UPDATE",
      [sid],
    );
    if (
      invoices.some(
        (i: any) =>
          i.status === "open" &&
          (Number(i.paid) > 0 ||
            ((i.starts_at || i.period_start || "") < time &&
              (!endOf(sub) ||
                (i.starts_at || i.period_start || "") < endOf(sub)!))),
      )
    )
      throw new HttpError(
        409,
        "Cần xử lý hóa đơn đã thu một phần hoặc công nợ cũ trước khi dùng thử.",
      );
    const retained = invoices.filter(
      (i: any) =>
        i.status === "paid" &&
        Number(i.amount) > 0 &&
        i.effective_end_at > time,
    );
    const start = [
      time,
      endOf(sub) || time,
      ...retained.map((i: any) => i.effective_end_at),
      ...claims
        .filter(
          (t: any) =>
            Number(t.store_id) === sid && !t.activated_at && t.ends_at,
        )
        .map((t: any) => t.ends_at),
    ]
      .sort()
      .at(-1)!;
    const [usage]: any = await c.execute(
      "SELECT (SELECT COUNT(*) FROM products WHERE store_id=? AND active=1) products,(SELECT COUNT(*) FROM store_memberships WHERE store_id=? AND status='active') staff,(SELECT COALESCE(SUM(size),0)/1048576 FROM assets WHERE store_id=?) storage_mb",
      [sid, sid, sid],
    );
    const token = createHash("sha256")
      .update(JSON.stringify({ sub, store: stores[0], claims, plan, invoices }))
      .digest("hex");
    return {
      token,
      trial: true,
      plan_id: planId,
      plan_version_id: plan.id,
      plan_name: plan.name,
      current_plan: sub.name,
      trial_days: Number(plan.trial_days),
      starts_at: start,
      ends_at: addDays(start, Number(plan.trial_days)),
      amount: 0,
      paid: 0,
      amount_due: 0,
      monthly_price: Number(plan.monthly_price),
      limits:
        typeof plan.limits === "string" ? JSON.parse(plan.limits) : plan.limits,
      usage: { ...usage[0], email_sends: (await emailAllowance(c,sid)).used },
      retained,
      expires_at: Date.now() + 15 * 60000,
    };
  });
}

export async function reserveAccountTrial(
  c: PoolConnection,
  sid: number,
  planId: number,
  actor: number,
  token?: string,
  expiresAt?: number,
) {
  return withSystem(async () => {
    const offer = await previewAccountTrial(c, sid, planId, actor);
    if (!token || !expiresAt || expiresAt < Date.now() || token !== offer.token)
      throw new HttpError(
        409,
        "Ưu đãi, lượt thử hoặc kỳ sử dụng đã thay đổi. Vui lòng xem lại trước khi xác nhận.",
      );
    const [replace]: any = await c.execute(
      "SELECT * FROM invoices WHERE store_id=? AND (status='open' OR (status='paid' AND amount=0 AND activated_at IS NULL)) FOR UPDATE",
      [sid],
    );
    for (const i of replace) {
      await c.execute(
        "UPDATE invoices SET status='void',void_reason='trial_selected' WHERE id=?",
        [i.id],
      );
      await c.execute(
        "UPDATE payment_intents SET status='cancelled' WHERE invoice_id=? AND status='pending'",
        [i.id],
      );
      await cancelReminders(c, sid, i.id, "ACCOUNT_TRIAL_SELECTED");
    }
    await c.execute(
      "INSERT INTO account_trial_claims(user_id,bucket,store_id,plan_id,plan_version_id,trial_days,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?)",
      [
        actor,
        trialBucket(planId),
        sid,
        planId,
        offer.plan_version_id,
        offer.trial_days,
        offer.starts_at,
        offer.ends_at,
      ],
    );
    await c.execute(
      "INSERT INTO audit_logs(store_id,user_id,action,entity,entity_id,detail) VALUES(?,?,'account_trial_reserved','subscriptions',?,?)",
      [sid, actor, String(sid), JSON.stringify(offer)],
    );
    await notice(
      c,
      sid,
      `trial:reserved:${actor}:${trialBucket(planId)}`,
      "Đã đăng ký lượt dùng thử",
      `Gói ${offer.plan_name}: ${formatBillingTime(offer.starts_at)} → ${formatBillingTime(offer.ends_at)}. Không tự trích tiền; gia hạn cần thanh toán.`,
    );
    await mail(c,{id:`trial-${actor}-${trialBucket(planId)}`,store_id:sid,plan_name:offer.plan_name,amount:0,paid:0,trial_days:offer.trial_days,period_start:offer.starts_at,period_end:offer.ends_at},"subscription_trial_reserved");
    await activateAccountTrial(c, sid, await clock(c));
    await reconcileBilling(c, sid);
    return {
      ok: true,
      trial: true,
      starts_at: offer.starts_at,
      ends_at: offer.ends_at,
    };
  });
}
async function createInvoice(
  c: PoolConnection,
  sid: number,
  plan: any,
  start: string,
  end: string,
  due: string,
  key: string,
): Promise<any> {
  const [versions]: any = plan.version_id
    ? [[{ id: plan.version_id }]]
    : await c.execute(
        "SELECT id FROM plan_versions WHERE plan_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE",
        [plan.plan_id],
      );
  await c.execute(
    "INSERT INTO invoices(store_id,period_key,plan_name,amount,paid,status,due_date,period_start,period_end,starts_at,ends_at,due_at,plan_version_id) VALUES(?,?,?,?,0,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
    [
      sid,
      key,
      plan.name,
      plan.monthly_price,
      Number(plan.monthly_price) === 0 ? "paid" : "open",
      due.slice(0, 10),
      start.slice(0, 10),
      end.slice(0, 10),
      start,
      end,
      due,
      versions[0]?.id || null,
    ],
  );
  const [rows]: any = await c.execute(
    "SELECT * FROM invoices WHERE store_id=? AND period_key=? FOR UPDATE",
    [sid, key],
  );
  if (rows[0].status === "void")
    return createInvoice(
      c,
      sid,
      plan,
      start,
      end,
      due,
      `${key.split(":r")[0]}:r${rows[0].id}`,
    );
  return rows[0];
}
async function activatePaidCoverage(
  c: PoolConnection,
  sid: number,
  time: string,
) {
  const sub = await subscription(c, sid);
  const [periods]: any = await c.execute(
    "SELECT * FROM invoices WHERE store_id=? AND status='paid' AND applied_at IS NOT NULL AND activated_at IS NULL AND effective_start_at<=? AND effective_end_at>? ORDER BY effective_end_at DESC LIMIT 1 FOR UPDATE",
    [sid, time, time],
  );
  const i = periods[0];
  if (!i) return;
  // Never downgrade an already longer entitlement when a delayed webhook arrives.
  if (!endOf(sub) || i.effective_end_at >= endOf(sub)!) {
    const plan = i.plan_version_id
      ? await versionPlan(c, i.plan_version_id)
      : null;
    const local = new Date(instant(i.effective_start_at) + 7 * 3600000);
    const anchor =
      endOf(sub) === i.effective_start_at &&
      (!plan || Number(plan.plan_id) === Number(sub.plan_id))
        ? sub.billing_anchor_day || local.getUTCDate()
        : local.getUTCDate();
    await c.execute(
      "UPDATE subscriptions SET plan_id=?,plan_version_id=COALESCE(?,plan_version_id),status=?,active_trial_bucket=NULL,trial_started_at=NULL,trial_ends_at=NULL,access_started_at=?,access_ends_at=?,current_period_start=DATE(?),current_period_end=DATE(?),period_end=DATE(?),billing_anchor_day=?,cancel_at_period_end=0,version=version+1 WHERE store_id=?",
      [
        plan?.plan_id || sub.plan_id,
        i.plan_version_id,
        Number(i.amount) === 0 ? "free" : "active",
        i.effective_start_at,
        i.effective_end_at,
        i.effective_start_at,
        i.effective_end_at,
        i.effective_end_at,
        anchor,
        sid,
      ],
    );
    if(plan && Number(plan.plan_id)!==Number(sub.plan_id))
      await mail(c,{...i,period_start:i.effective_start_at,period_end:i.effective_end_at},"subscription_changed");
  }
  await c.execute(
    "UPDATE invoices SET activated_at=UTC_TIMESTAMP() WHERE id=?",
    [i.id],
  );
}

// Re-approval and legacy migration never restart a trial or a paid period.
export async function activateApprovedStore(c: PoolConnection, sid: number) {
  return withSystem(async () => {
    const sub = await subscription(c, sid);
    if (
      sub.access_started_at ||
      sub.trial_started_at ||
      (sub.current_period_start && sub.current_period_end)
    )
      return;
    const time = await clock(c);
    if (Number(sub.billing_policy) === 1) {
      // Waiting for a first payment is already an activation attempt, not a new offer.
      if (sub.status !== "pending_activation") return;
      const days = Number(sub.trial_days_granted || 0);
      const plan = await versionPlan(c, sub.registration_plan_version_id);
      const [owners]: any = await c.execute(
        "SELECT owner_id FROM stores WHERE id=?",
        [sid],
      );
      const ownerId = owners[0].owner_id,
        bucket = trialBucket(plan.plan_id);
      await c.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [ownerId]);
      if (days > 0) {
        await c.execute(
          "INSERT IGNORE INTO account_trial_claims(user_id,bucket,store_id,plan_id,plan_version_id,trial_days) VALUES(?,?,?,?,?,?)",
          [ownerId, bucket, sid, plan.plan_id, plan.version_id, days],
        );
        const [claims]: any = await c.execute(
          "SELECT * FROM account_trial_claims WHERE user_id=? AND bucket=? FOR UPDATE",
          [ownerId, bucket],
        );
        if (Number(claims[0]?.store_id) === sid && !claims[0].starts_at) {
          await c.execute(
            "UPDATE account_trial_claims SET starts_at=?,ends_at=? WHERE user_id=? AND bucket=?",
            [time, addDays(time, days), ownerId, bucket],
          );
          await activateAccountTrial(c, sid, time);
          return;
        }
      }
      await c.execute(
        "UPDATE subscriptions SET status='awaiting_payment',trial_days_granted=0,version=version+1 WHERE store_id=?",
        [sid],
      );
      const i = await createInvoice(
        c,
        sid,
        plan,
        time,
        nextBillingInstant(time),
        time,
        `initial:${sid}`,
      );
      if (i.status === "paid") await applyPaidInvoice(c, i);
      else await reconcileBilling(c, sid);
      return;
    }
    // Old stores retain their old rights; they are not retroactively enrolled.
    const day = sub.current_period_start || (await today(c)),
      end = sub.current_period_end || sub.period_end || nextBillingDate(day);
    await c.execute(
      "UPDATE subscriptions SET status='active',current_period_start=?,current_period_end=?,period_end=?,billing_anchor_day=DAY(?),version=version+1 WHERE store_id=?",
      [day, end, end, day, sid],
    );
    const [existing]: any = await c.execute(
      "SELECT id FROM invoices WHERE store_id=? AND status<>'void' LIMIT 1",
      [sid],
    );
    if (existing.length) {
      await c.execute(
        "UPDATE invoices SET period_start=COALESCE(period_start,?),period_end=COALESCE(period_end,?),applied_at=IF(status='paid',COALESCE(applied_at,UTC_TIMESTAMP()),applied_at) WHERE id=?",
        [day, end, existing[0].id],
      );
    } else {
      const i = await invoice(c, sid, sub, day, end, day);
      if (i.status === "paid")
        await c.execute(
          "UPDATE invoices SET applied_at=UTC_TIMESTAMP(),activated_at=UTC_TIMESTAMP() WHERE id=?",
          [i.id],
        );
    }
  });
}
export function formatBillingTime(value: string) {
  return formatDateTime(value, "utc");
}

export async function reconcileBilling(c: PoolConnection, sid: number) {
  return withSystem(async () => {
    const time = await clock(c);
    await activateAccountTrial(c, sid, time);
    await activatePaidCoverage(c, sid, time);
    const sub = await subscription(c, sid);
    const [stores]: any = await c.execute("SELECT * FROM stores WHERE id=?", [
      sid,
    ]);
    const store = stores[0];
    if (!["approved", "suspended"].includes(store.status)) return;
    const expiry = endOf(sub);
    const expired = !!expiry && expiry <= time;
    const [debts]: any = await c.execute(
      "SELECT * FROM invoices WHERE store_id=? AND status='open' AND paid<amount AND COALESCE(due_at,DATE_ADD(due_date,INTERVAL 1 DAY))<=? ORDER BY due_date,id LIMIT 1",
      [sid, time],
    );
    // Trial/paid entitlement is the source of truth, never a future unpaid invoice.
    const restricted =
      expired ||
      sub.status === "awaiting_payment" ||
      sub.status === "cancelled" ||
      (!expiry && debts.length) ||
      (Number(sub.billing_policy) === 0 && debts.length);
    if (restricted) {
      const reason = sub.trial_ends_at
        ? "Thời gian dùng thử đã hết. Vui lòng thanh toán để tiếp tục sử dụng cửa hàng."
        : "Gói dịch vụ chưa được thanh toán hoặc đã hết hạn. Vui lòng thanh toán để khôi phục cửa hàng.";
      const status =
        sub.status === "cancelled" || (sub.cancel_at_period_end && expired)
          ? "cancelled"
          : sub.status === "awaiting_payment"
            ? "awaiting_payment"
            : "restricted";
      if (sub.status !== status)
        await c.execute(
          "UPDATE subscriptions SET status=?,version=version+1 WHERE store_id=?",
          [status, sid],
        );
      if (store.status === "approved") {
        await c.execute(
          "UPDATE stores SET status='suspended',billing_suspended=1,suspension_reason=?,version=version+1 WHERE id=?",
          [reason, sid],
        );
        await notice(
          c,
          sid,
          `billing:freeze:${sid}:${expiry || "initial"}`,
          "Cửa hàng đã tạm đóng băng",
          reason,
        );
        const i = debts[0];
        await mail(
          c,
          i || {
            id: `expired-${sid}-${expiry}`,
            store_id: sid,
            plan_name: sub.name,
            amount: sub.monthly_price,
            paid: 0,
            due_date: expiry || time,
            period_end: expiry || time,
          },
          sub.trial_ends_at
            ? "subscription_trial_expired"
            : "subscription_suspended",
        );
      }
    } else if (expiry && expiry > time) {
      if (["restricted", "past_due"].includes(sub.status))
        await c.execute(
          "UPDATE subscriptions SET status=?,version=version+1 WHERE store_id=?",
          [
            sub.trial_ends_at
              ? "trialing"
              : Number(sub.monthly_price) === 0
                ? "free"
                : "active",
            sid,
          ],
        );
      if (store.status === "suspended" && store.billing_suspended) {
        await c.execute(
          "UPDATE stores SET status='approved',billing_suspended=0,suspension_reason=NULL,version=version+1 WHERE id=?",
          [sid],
        );
        await notice(
          c,
          sid,
          `billing:restore:${sid}:${sub.version}`,
          "Cửa hàng đã được khôi phục",
          "Thanh toán đã được xử lý. Cửa hàng có thể hoạt động trở lại.",
        );
      }
    }
  });
}
async function applyPaidInvoice(
  c: PoolConnection,
  i: any,
  receivedAt?: string,
) {
  if (i.applied_at) return;
  const sub = await subscription(c, i.store_id),
    time = receivedAt || (await clock(c));
  let start = i.starts_at || (i.period_start ? stamp(i.period_start) : time);
  // Paying after access has expired buys a full month from the actual receipt.
  if (start < time) start = time;
  const keptAnniversary =
    start === (i.starts_at || stamp(i.period_start || time));
  const end =
    keptAnniversary && i.ends_at
      ? i.ends_at
      : nextBillingInstant(
          start,
          keptAnniversary ? sub.billing_anchor_day || undefined : undefined,
        );
  await c.execute(
    "UPDATE invoices SET effective_start_at=?,effective_end_at=?,applied_at=UTC_TIMESTAMP() WHERE id=? AND applied_at IS NULL",
    [start, end, i.id],
  );
  await c.execute(
    "UPDATE subscriptions SET cancel_at_period_end=0 WHERE store_id=?",
    [i.store_id],
  );
  await cancelReminders(c, i.store_id, i.id, "INVOICE_SETTLED");
  await activatePaidCoverage(c, i.store_id, await clock(c));
  const settled={...i,period_start:start,period_end:end};
  await mail(c, settled, "subscription_payment_received");
  const [previous]: any=await c.execute("SELECT COUNT(*) n FROM invoices WHERE store_id=? AND id<>? AND applied_at IS NOT NULL",[i.store_id,i.id]);
  await mail(c,settled,i.purpose === "plan_change" ? "subscription_change_confirmed" : Number(previous[0].n) ? "subscription_renewed" : "subscription_registered");
  await notice(
    c,
    i.store_id,
    `billing:paid:${i.id}`,
    `Đã thanh toán hóa đơn INV-${i.id}`,
    `Kỳ đã thanh toán: ${formatBillingTime(start)} → ${formatBillingTime(end)}.`,
  );
}
export async function recordInvoicePayment(
  c: PoolConnection,
  invoiceId: number,
  amount: number,
  reference: string,
  actor: number,
  receivedAt?: string,
) {
  return withSystem(async () => {
    const [initial]: any = await c.execute(
      "SELECT store_id FROM invoices WHERE id=?",
      [invoiceId],
    );
    if (!initial[0]) throw new HttpError(404, "Không có hóa đơn.");
    await subscription(c, initial[0].store_id);
    const [rows]: any = await c.execute(
      "SELECT * FROM invoices WHERE id=? FOR UPDATE",
      [invoiceId],
    );
    const i = rows[0];
    const [existing]: any = await c.execute(
      "SELECT invoice_id,amount FROM billing_payments WHERE reference=?",
      [reference],
    );
    if (existing[0]) {
      if (
        Number(existing[0].invoice_id) !== invoiceId ||
        Number(existing[0].amount) !== amount
      )
        throw new HttpError(409, "Mã giao dịch đã dùng.");
      return { duplicate: true };
    }
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      i.status !== "open" ||
      Number(i.paid) + amount > Number(i.amount)
    )
      throw new HttpError(
        409,
        "Hóa đơn không thể thanh toán hoặc số tiền vượt công nợ.",
      );
    const time = await clock(c);
    if (
      i.purpose === "plan_change" &&
      Number(i.paid) === 0 &&
      i.payment_deadline_at &&
      i.payment_deadline_at <= time
    )
      throw new HttpError(
        409,
        "Yêu cầu đổi gói đã hết thời gian thanh toán. Giao dịch đến muộn cần platform đối soát, không tự kích hoạt gói.",
      );
    if (
      receivedAt &&
      (receivedAt > time ||
        instant(receivedAt) < parseDateTime(i.created_at).getTime() - 86400000)
    )
      throw new HttpError(409, "Thời điểm nhận tiền không hợp lệ.");
    const paid = Number(i.paid) + amount;
    await c.execute(
      "INSERT INTO billing_payments(invoice_id,reference,amount,actor_id,received_at) VALUES(?,?,?,?,?)",
      [invoiceId, reference, amount, actor, receivedAt || time],
    );
    await c.execute("UPDATE invoices SET paid=?,status=? WHERE id=?", [
      paid,
      paid === Number(i.amount) ? "paid" : "open",
      invoiceId,
    ]);
    if (paid === Number(i.amount)) {
      const [last]: any = await c.execute(
        "SELECT MAX(received_at) received_at FROM billing_payments WHERE invoice_id=?",
        [invoiceId],
      );
      await applyPaidInvoice(c, { ...i, paid }, last[0].received_at);
    }
    await reconcileBilling(c, i.store_id);
    return { duplicate: false };
  });
}
export async function prepareSubscriptionInvoice(
  c: PoolConnection,
  sid: number,
  planId: number,
  allowPlanChange = true,
) {
  return withSystem(async () => {
    await expirePendingPlanChanges(c, sid);
    await activateAccountTrial(c, sid, await clock(c));
    const sub = await subscription(c, sid),
      time = await clock(c);
    const [futureTrials]: any = await c.execute(
      "SELECT * FROM account_trial_claims WHERE store_id=? AND activated_at IS NULL AND ends_at>? ORDER BY ends_at DESC LIMIT 1",
      [sid, time],
    );
    if (!allowPlanChange && futureTrials[0])
      planId = Number(futureTrials[0].plan_id);
    const [open]: any = await c.execute(
      "SELECT * FROM invoices WHERE store_id=? AND status='open' AND paid<amount ORDER BY due_date,id LIMIT 1 FOR UPDATE",
      [sid],
    );
    let replaceUnpaid = false;
    let fallbackInvoiceId: number | null = null;
    if (open[0]) {
      if (open[0].plan_version_id) {
        const oldPlan = await versionPlan(c, open[0].plan_version_id);
        if (Number(oldPlan.plan_id) !== Number(planId)) {
          if (!allowPlanChange) return open[0];
          const expiry = endOf(sub);
          replaceUnpaid =
            Number(open[0].paid) === 0 &&
            ((expiry && expiry > time && open[0].starts_at >= expiry) ||
              (Number(sub.billing_policy) === 1 &&
                (!!sub.trial_ends_at || sub.status === "awaiting_payment")));
          if (!replaceUnpaid)
            throw new HttpError(
              409,
              "Hóa đơn đã thu một phần hoặc có công nợ cũ. Hãy xử lý hóa đơn đó trước khi đổi gói.",
            );
          await c.execute("UPDATE invoices SET status='void' WHERE id=?", [
            open[0].id,
          ]);
          fallbackInvoiceId = open[0].fallback_invoice_id || null;
          await c.execute(
            "UPDATE payment_intents SET status='cancelled' WHERE invoice_id=? AND status='pending'",
            [open[0].id],
          );
          await cancelReminders(c, sid, open[0].id, "PLAN_CHANGED");
        }
      }
      if (!replaceUnpaid) return open[0];
    }
    const [scheduled]: any = await c.execute(
      "SELECT * FROM invoices WHERE store_id=? AND status='paid' AND effective_start_at>? ORDER BY effective_start_at FOR UPDATE",
      [sid, time],
    );
    for (const i of scheduled)
      i.scheduled_plan_id = i.plan_version_id
        ? (await versionPlan(c, i.plan_version_id)).plan_id
        : null;
    if (scheduled.length && !allowPlanChange) return scheduled[0];
    // Zero-value reservations are replaceable; cash-paid service is never voided.
    // A new choice starts after the last cash-paid period, without losing money.
    const paidFuture = scheduled.filter(
      (i: any) => Number(i.amount) > 0 || Number(i.paid) > 0,
    );
    const lastPaid = paidFuture.at(-1);
    const freeFuture = scheduled.filter(
      (i: any) => Number(i.amount) === 0 && Number(i.paid) === 0,
    );
    const sameFree = freeFuture.find(
      (i: any) => Number(i.scheduled_plan_id) === Number(planId),
    );
    if (sameFree) return sameFree;
    const [plans]: any = await c.execute(
      "SELECT *,id plan_id FROM plans WHERE id=? AND active=1 FOR UPDATE",
      [planId],
    );
    if (!plans[0]) throw new HttpError(404, "Gói dịch vụ không tồn tại.");
    for (const i of freeFuture) {
      fallbackInvoiceId = i.id;
      await c.execute(
        "UPDATE invoices SET status='void',void_reason='plan_replaced' WHERE id=?",
        [i.id],
      );
      await cancelReminders(c, sid, i.id, "PLAN_CHANGED");
    }
    // Selecting the last prepaid package again removes a replaceable later choice.
    if (lastPaid && Number(lastPaid.scheduled_plan_id) === Number(planId))
      return lastPaid;
    const samePlan = Number(planId) === Number(sub.plan_id);
    const plan =
      samePlan &&
      (sub.trial_ends_at || sub.status === "awaiting_payment") &&
      sub.registration_plan_version_id
        ? await versionPlan(c, sub.registration_plan_version_id)
        : plans[0];
    const expiry = endOf(sub);
    // All package changes take effect after current access, including trials.
    const [trials]: any = await c.execute(
      "SELECT * FROM account_trial_claims WHERE store_id=? AND activated_at IS NULL AND ends_at>? ORDER BY ends_at DESC LIMIT 1",
      [sid, time],
    );
    const upcomingTrial = trials[0];
    const start = [
      time,
      expiry || time,
      lastPaid?.effective_end_at || time,
      upcomingTrial?.ends_at || time,
    ]
      .sort()
      .at(-1)!;
    const invoicePlan =
      upcomingTrial && Number(upcomingTrial.plan_id) === Number(planId)
        ? await versionPlan(c, upcomingTrial.plan_version_id)
        : plan;
    const end = nextBillingInstant(
      start,
      samePlan ? sub.billing_anchor_day || undefined : undefined,
    );
    const i = await createInvoice(
      c,
      sid,
      invoicePlan,
      start,
      end,
      start,
      `cycle:${start}`,
    );
    if (
      !samePlan &&
      !(upcomingTrial && Number(upcomingTrial.plan_id) === Number(planId)) &&
      i.status === "open"
    ) {
      await c.execute(
        "UPDATE invoices SET purpose='plan_change',payment_deadline_at=COALESCE(payment_deadline_at,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE)),fallback_invoice_id=? WHERE id=?",
        [fallbackInvoiceId, i.id],
      );
      const [changed]: any = await c.execute(
        "SELECT * FROM invoices WHERE id=?",
        [i.id],
      );
      return changed[0];
    }
    // Free renewals also wait for the boundary; no monthly overlap with trial.
    if (i.status === "paid") {
      await applyPaidInvoice(c, i);
      await reconcileBilling(c, sid);
    }
    return i;
  });
}

export async function expirePendingPlanChanges(c: PoolConnection, sid: number) {
  return withSystem(async () => {
    await subscription(c, sid);
    const time = await clock(c);
    const [rows]: any = await c.execute(
      "SELECT * FROM invoices WHERE store_id=? AND purpose='plan_change' AND status='open' AND paid=0 AND payment_deadline_at<=? FOR UPDATE",
      [sid, time],
    );
    for (const i of rows) {
      await c.execute(
        "UPDATE invoices SET status='void',void_reason='payment_timeout' WHERE id=?",
        [i.id],
      );
      await c.execute(
        "UPDATE payment_intents SET status='cancelled' WHERE invoice_id=? AND status='pending'",
        [i.id],
      );
      await cancelReminders(c, sid, i.id, "PLAN_CHANGE_EXPIRED");
      if (i.fallback_invoice_id) {
        // Restore only the zero-value reservation displaced by this request.
        await c.execute(
          "UPDATE invoices SET status='paid',void_reason=NULL WHERE id=? AND store_id=? AND status='void' AND void_reason='plan_replaced' AND amount=0 AND paid=0 AND effective_end_at>?",
          [i.fallback_invoice_id, sid, time],
        );
      }
      await c.execute(
        "INSERT INTO audit_logs(store_id,action,entity,entity_id,detail) VALUES(?,'subscription_change_expired','invoices',?,?)",
        [
          sid,
          String(i.id),
          JSON.stringify({
            deadline: i.payment_deadline_at,
            fallback_invoice_id: i.fallback_invoice_id,
          }),
        ],
      );
      await notice(
        c,
        sid,
        `billing:change-expired:${i.id}`,
        "Yêu cầu đổi gói đã hết hạn",
        `Chưa nhận được thanh toán cho ${i.plan_name} trong 10 phút. Lựa chọn đổi gói đã được hủy, quyền sử dụng đã cấp được giữ nguyên.`,
      );
    }
    return rows.length;
  });
}

// Also used before webhook processing so expiration survives a rejected receipt.
export async function expirePlanChangeRequests(sid?: number): Promise<number> {
  if (!sid)
    return withSystem(async () => {
      const rows = await query<any[]>(
        "SELECT DISTINCT store_id FROM invoices WHERE purpose='plan_change' AND status='open' AND paid=0 AND payment_deadline_at<=UTC_TIMESTAMP()",
      );
      let count = 0;
      for (const row of rows)
        count += await expirePlanChangeRequests(row.store_id);
      return count;
    });
  const c = await pool.getConnection();
  try {
    await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await c.beginTransaction();
    const expired = await expirePendingPlanChanges(c, sid);
    if (expired) await refreshBillingAccess(sid, c);
    await c.commit();
    return expired;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

// The fingerprint is checked under the same store lock as webhook settlement.
// Preview uses a rolled-back transaction: no invoice, email, QR or schedule persists.
export async function subscriptionChangeToken(
  c: PoolConnection,
  sid: number,
  planId: number,
) {
  return withSystem(async () => {
    const sub = await subscription(c, sid);
    const [plans]: any = await c.execute(
      "SELECT * FROM plans WHERE id=? AND active=1 FOR UPDATE",
      [planId],
    );
    if (!plans[0]) throw new HttpError(404, "Gói dịch vụ không tồn tại.");
    const [versions]: any = await c.execute(
      "SELECT id FROM plan_versions WHERE plan_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [planId],
    );
    const [invoices]: any = await c.execute(
      "SELECT id,status,paid,amount,plan_version_id,starts_at,ends_at,effective_start_at,effective_end_at,activated_at,purpose,payment_deadline_at FROM invoices WHERE store_id=? AND status<>'void' ORDER BY id FOR UPDATE",
      [sid],
    );
    const [stores]: any = await c.execute(
      "SELECT status,version FROM stores WHERE id=? FOR UPDATE",
      [sid],
    );
    const [trials]: any = await c.execute(
      "SELECT * FROM account_trial_claims WHERE store_id=? ORDER BY bucket",
      [sid],
    );
    const time = await clock(c);
    return createHash("sha256")
      .update(
        JSON.stringify({
          sub,
          plan: plans[0],
          version: versions[0]?.id,
          invoices,
          trials,
          store: stores[0],
          expired: !!endOf(sub) && endOf(sub)! <= time,
        }),
      )
      .digest("hex");
  });
}

export async function previewSubscriptionChange(
  c: PoolConnection,
  sid: number,
  planId: number,
) {
  return withSystem(async () => {
    const token = await subscriptionChangeToken(c, sid, planId);
    const sub = await subscription(c, sid);
    const i = await prepareSubscriptionInvoice(c, sid, planId);
    const target = await versionPlan(c, i.plan_version_id);
    const [usage]: any = await c.execute(
      "SELECT (SELECT COUNT(*) FROM products WHERE store_id=? AND active=1) products,(SELECT COUNT(*) FROM store_memberships WHERE store_id=? AND status='active') staff,(SELECT COALESCE(SUM(size),0)/1048576 FROM assets WHERE store_id=?) storage_mb",
      [sid, sid, sid],
    );
    const [retained]: any = await c.execute(
      "SELECT id,plan_name,effective_start_at,effective_end_at FROM invoices WHERE store_id=? AND status='paid' AND amount>0 AND effective_start_at>UTC_TIMESTAMP() ORDER BY effective_start_at",
      [sid],
    );
    return {
      token,
      plan_id: Number(target.plan_id),
      plan_name: target.name,
      limits:
        typeof target.limits === "string"
          ? JSON.parse(target.limits)
          : target.limits,
      amount: Number(i.amount),
      paid: Number(i.paid),
      amount_due: Math.max(0, Number(i.amount) - Number(i.paid)),
      starts_at: i.effective_start_at || i.starts_at,
      ends_at: i.effective_end_at || i.ends_at,
      current_plan: sub.name,
      trial_ends_at: sub.trial_ends_at,
      usage: { ...usage[0], email_sends: (await emailAllowance(c,sid)).used },
      retained,
      already_reserved: i.status === "paid" && Number(i.amount) > 0,
      purpose: i.purpose,
      payment_deadline_at: i.payment_deadline_at,
      expires_at: Date.now() + 15 * 60000,
    };
  });
}
async function cancelReminders(
  c: PoolConnection,
  sid: number,
  invoiceId: number,
  reason: string,
) {
  await c.execute(
    "UPDATE email_outbox SET status='cancelled',last_error=? WHERE store_id=? AND dedupe_key IN (?,?,?) AND status IN ('pending','failed')",
    [
      reason,
      sid,
      `subscription_renewal_5d:${invoiceId}`,
      `subscription_renewal_1d:${invoiceId}`,
      `subscription_suspended:${invoiceId}`,
    ],
  );
}
export async function extendStoreTrial(
  c: PoolConnection,
  sid: number,
  days: number,
  reason: string,
  actor: number,
  version: number,
) {
  return withSystem(async () => {
    const sub = await subscription(c, sid),
      time = await clock(c);
    if (sub.version !== version)
      throw new HttpError(409, "Gói đã thay đổi. Vui lòng tải lại.");
    if (
      sub.status !== "trialing" ||
      !sub.trial_ends_at ||
      sub.trial_ends_at <= time
    )
      throw new HttpError(409, "Chỉ gia hạn cửa hàng đang dùng thử.");
    if (Number(sub.trial_days_granted) + days > 365)
      throw new HttpError(
        409,
        "Tổng thời gian dùng thử không được vượt quá 365 ngày.",
      );
    const [scheduledTrials]: any = await c.execute(
      "SELECT user_id FROM account_trial_claims WHERE store_id=? AND activated_at IS NULL AND starts_at IS NOT NULL AND ends_at>UTC_TIMESTAMP() LIMIT 1",
      [sid],
    );
    if (scheduledTrials.length)
      throw new HttpError(
        409,
        "Đã có lượt dùng thử tiếp theo được đặt lịch. Không thể dời hạn làm chồng lấn kỳ đã xác nhận.",
      );
    const [invoices]: any = await c.execute(
      "SELECT * FROM invoices WHERE store_id=? AND status<>'void' AND (starts_at>=? OR effective_start_at>=?) FOR UPDATE",
      [sid, sub.trial_ends_at, sub.trial_ends_at],
    );
    if (
      invoices.some(
        (i: any) =>
          Number(i.paid) > 0 || (i.status === "paid" && Number(i.amount) > 0),
      )
    )
      throw new HttpError(
        409,
        "Kỳ tiếp theo đã có thanh toán. Cần đối soát trước khi thay đổi ngày.",
      );
    const end = addDays(sub.trial_ends_at, days);
    for (const i of invoices) {
      await c.execute("UPDATE invoices SET status='void' WHERE id=?", [i.id]);
      await c.execute(
        "UPDATE payment_intents SET status='cancelled' WHERE invoice_id=? AND status='pending'",
        [i.id],
      );
      await cancelReminders(c, sid, i.id, "TRIAL_EXTENDED");
    }
    await c.execute(
      "UPDATE subscriptions SET trial_ends_at=?,access_ends_at=?,current_period_end=DATE(?),period_end=DATE(?),trial_days_granted=COALESCE(trial_days_granted,0)+?,version=version+1 WHERE store_id=?",
      [end, end, end, end, days, sid],
    );
    await c.execute(
      "UPDATE trial_claims SET ends_at=? WHERE store_id=? AND started_at=?",
      [end, sid, sub.trial_started_at],
    );
    await c.execute(
      "UPDATE account_trial_claims SET ends_at=?,trial_days=trial_days+? WHERE store_id=? AND starts_at=? AND activated_at IS NOT NULL",
      [end, days, sid, sub.trial_started_at],
    );
    if (invoices.length) {
      const old = invoices[0];
      const plan = old.plan_version_id
        ? await versionPlan(c, old.plan_version_id)
        : await versionPlan(c, sub.registration_plan_version_id);
      const replacement = await createInvoice(
        c,
        sid,
        plan,
        end,
        nextBillingInstant(end),
        end,
        `cycle:${end}`,
      );
      if (replacement.status === "paid") await applyPaidInvoice(c, replacement);
    }
    await c.execute(
      "INSERT INTO audit_logs(store_id,user_id,action,entity,entity_id,detail) VALUES(?,?,'trial_extend','subscriptions',?,?)",
      [
        sid,
        actor,
        String(sid),
        JSON.stringify({
          days,
          previous_end: sub.trial_ends_at,
          new_end: end,
          reason,
        }),
      ],
    );
    await notice(
      c,
      sid,
      `trial:extend:${sid}:${version}`,
      "Đã gia hạn dùng thử",
      `Cộng thêm ${days} ngày. Hết hạn mới: ${formatBillingTime(end)}. ${reason}`,
    );
    return { ok: true, previous_end: sub.trial_ends_at, trial_ends_at: end };
  });
}

// Used by writes/checkout too, so expiration does not depend on a cron tick.
export async function refreshBillingAccess(
  sid: number,
  connection?: PoolConnection,
) {
  return withSystem(async () => {
    const c = connection || (await pool.getConnection());
    try {
      if (!connection) await c.beginTransaction();
      await expirePendingPlanChanges(c, sid);
      await activateAccountTrial(c, sid, await clock(c));
      await activatePaidCoverage(c, sid, await clock(c));
      const sub = await subscription(c, sid),
        time = await clock(c);
      if (
        endOf(sub) &&
        endOf(sub)! <= time &&
        !sub.cancel_at_period_end &&
        sub.status !== "cancelled" &&
        Number(sub.monthly_price) === 0
      )
        await prepareSubscriptionInvoice(c, sid, sub.plan_id, false);
      await reconcileBilling(c, sid);
      const [rows]: any = await c.execute(
        "SELECT status,suspension_reason FROM stores WHERE id=?",
        [sid],
      );
      if (!connection) await c.commit();
      return rows[0];
    } catch (e) {
      if (!connection) await c.rollback();
      throw e;
    } finally {
      if (!connection) c.release();
    }
  });
}

// Retry-safe worker; API guards enforce exact expiry independently of scheduler.
export async function advanceBilling(onlyStoreId?: number) {
  return withSystem(async () => {
    const stores = await query<any[]>(
      "SELECT id FROM stores WHERE status IN ('approved','suspended')" +
        (onlyStoreId ? " AND id=?" : ""),
      onlyStoreId ? [onlyStoreId] : [],
    );
    let reminders = 0;
    for (const { id: sid } of stores) {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        await activateApprovedStore(c, sid);
        await expirePendingPlanChanges(c, sid);
        const time = await clock(c);
        await activateAccountTrial(c, sid, time);
        await activatePaidCoverage(c, sid, time);
        const sub = await subscription(c, sid),
          expiry = endOf(sub);
        const days = expiry
          ? Math.ceil((instant(expiry) - instant(time)) / 86400000)
          : null;
        if (
          !sub.cancel_at_period_end &&
          sub.status !== "cancelled" &&
          days !== null &&
          days <= 5
        )
          await prepareSubscriptionInvoice(c, sid, sub.plan_id, false);
        const [due]: any = await c.execute(
          "SELECT *,CEIL(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),COALESCE(due_at,DATE_ADD(due_date,INTERVAL 1 DAY)))/86400) days_until FROM invoices WHERE store_id=? AND status='open' AND paid<amount",
          [sid],
        );
        for (const i of due) {
          if (i.purpose === "plan_change" && Number(i.paid) === 0) continue;
          // Send the nearest outstanding reminder only, never backfill all missed marks.
          const n = Number(i.days_until);
          if (n <= 0 || n > 5) continue;
          const key =
            n <= 1 ? "subscription_renewal_1d" : "subscription_renewal_5d";
          if (
            sub.trial_started_at &&
            n > 1 &&
            Number(sub.trial_days_granted) < 5
          )
            continue;
          if (
            sub.trial_started_at &&
            n <= 1 &&
            Number(sub.trial_days_granted) <= 1
          )
            continue;
          const [prior]: any = await c.execute(
            "SELECT id FROM email_outbox WHERE store_id=? AND dedupe_key=?",
            [sid, `${key}:${i.id}`],
          );
          await mail(
            c,
            {
              ...i,
              plan_name: sub.trial_ends_at
                ? `${i.plan_name} (kết thúc dùng thử)`
                : i.plan_name,
            },
            key,
          );
          await notice(
            c,
            sid,
            `${key}:${i.id}`,
            sub.trial_ends_at
              ? "Thời gian dùng thử sắp kết thúc"
              : "Gói dịch vụ sắp đến hạn",
            `Thanh toán hóa đơn INV-${i.id} trước ${formatBillingTime(i.due_at || stamp(i.due_date))}.`,
          );
          if (!prior.length) reminders++;
        }
        await reconcileBilling(c, sid);
        await c.commit();
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    }
    return { ok: true, stores: stores.length, reminders };
  });
}
