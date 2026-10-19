import { emailAllowance } from "./email-policy";
import { normalizeStorePhone, reserveStoreRegistration, storeRegistrationAvailability } from "./store-registration";
import { analyticsPeriod, loadStoreAnalytics } from "./store-analytics";
import { APP_TIME_ZONE } from "./regional";
import { hanoiDateKey, parseDateTime } from "./date-time";
import { goongSearchLocation } from "./goong-config";
import { platformEmails } from "./platform-email";
import { manualOrdersAPI } from "./manual-orders";
import { activateApprovedStore, advanceBilling, prepareSubscriptionInvoice, recordInvoicePayment, reconcileBilling, captureRegistrationPlan, extendStoreTrial, accessEndSQL, previewSubscriptionChange, subscriptionChangeToken, expirePlanChangeRequests, accountTrialAvailability, trialBucket, previewAccountTrial, reserveAccountTrial } from "./billing";
import { displayLabel } from "./display-labels";
import { recordOrderPayment, changePaymentMethod, setOrderPaymentBalance } from "./order-payments";
import { orderStates } from "./order-workflow";
import { reschedule } from "./operations";
import { orderList } from "./order-list";
import { orderPaymentStatusSQL } from "./order-payment-state";
import { broadcast } from "./broadcasts";
import { platformUsers, startGhost, stopGhost } from "./platform-users";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { query, mutate, pool } from "./db";
import {
  currentUser,
  HttpError,
  digest,
  throttle,
  requirePermission,
} from "./auth";
import { tenantId, withStore, withSystem } from "./tenant";
import {
  setStoreApprovalRequired,
  storeApprovalRequired,
} from "./platform-settings";
import {
  storeBy,
  publicStore,
  platformActor,
  storeOwner,
  membership,
  storeAudit,
  distanceKm,
  quota,
  jsonValue,
} from "./stores";
import defaults from "./email-defaults.json";
import { changeOrder, calculate } from "./commerce";
import { endpointHash } from "./domain-events";
import { activeBank, platformBank, createIntent, vietQrUrl } from "./sepay";
import { enqueueStoreLifecycleEmail } from "./email";

const id = z.coerce.number().int().positive();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
const text = z.string().trim().min(1).max(160);
const role = z.enum(["admin", "manager", "editor", "support"]);
export const defaultSettings = {
  shipping: 35000,
  free_shipping: 1000000,
  open: true,
  lead_minutes: 120,
  advance_days: 90,
  capacity: 20,
  slots: ["09:00–12:00", "12:00–15:00", "15:00–18:00", "18:00–20:00"],
  closed_dates: [],
  timezone: APP_TIME_ZONE,
};
export const defaultTheme = {
  template: "minimal",
  accent: "#171717",
  background: "#ffffff",
  font: "system",
  hero: "Hoa cho những điều không thể nói.",
  story: "Một chút hoa. Một ngày thật khác.",
};
const themeSchema = z.object({
  template: z.enum(["minimal", "editorial", "garden", "atelier", "modern"]),
  accent: z.string().regex(/^#[\da-fA-F]{6}$/),
  background: z.string().regex(/^#[\da-fA-F]{6}$/),
  font: z.enum(["system", "serif", "sans", "mono"]),
  hero: text,
  story: z.string().max(1000),
});
const settingsSchema = z.object({
  shipping: z.number().int().min(0).max(1000000),
  free_shipping: z.number().int().min(0).max(100000000),
  open: z.boolean(),
  lead_minutes: z.number().int().min(0).max(10080),
  advance_days: z.number().int().min(1).max(365),
  capacity: z.number().int().min(1).max(1000),
  slots: z
    .array(
      z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d–(?:[01]\d|2[0-3]):[0-5]\d$/)
        .refine((s) => s.slice(0, 5) < s.slice(6)),
    )
    .min(1)
    .max(12),
  closed_dates: z.array(day).max(366),
  timezone: z.literal(APP_TIME_ZONE),
});
async function signedIn() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Vui lòng đăng nhập.");
  return u;
}
const resultOK = { ok: true };
export async function saasAPI(
  path: string[],
  method: string,
  b: any,
  url: URL,
  fingerprint = "local",
): Promise<any | undefined> {
  const key = path.join("/");
  if (key === "billing/plans" && method === "GET") {
    const user = await currentUser();
    const trials = user ? await accountTrialAvailability(user.id) : null;
    const plans = await query<any[]>("SELECT p.id,p.name,p.monthly_price,p.limits,p.trial_days,(SELECT MAX(id) FROM plan_versions v WHERE v.plan_id=p.id) offer_version_id FROM plans p WHERE p.active=1 ORDER BY p.id");
    return plans.map(p=>({...p, limits: (() => { const limits = typeof p.limits === "string" ? JSON.parse(p.limits) : p.limits || {}; if (!Number.isFinite(Number(limits.email_sends))) limits.email_sends = Number(p.id) === 1 ? 100 : Number(p.id) === 2 ? 1000 : 5000; return limits; })(),
      // Starter is automatically granted during first-store registration;
      // only the shared discovery entitlement is selectable from here.
      starter_onboarding_trial: Number(p.id) === 1,
      registration_trial_available: Number(p.trial_days)>0 && !trials?.claims.some((t:any)=>t.bucket===trialBucket(p.id)),
      trial_available: Number(p.id) !== 1 && Number(p.trial_days)>0 && !trials?.claims.some((t:any)=>t.bucket===trialBucket(p.id)),
    }));
  }
  if (path[0] === "workspace") {
    const manual = await manualOrdersAPI(path.slice(1), method, b, url);
    if (manual !== undefined) return manual;
  }
  if (key === "auth/ghost/stop" && method === "POST")
    return withSystem(stopGhost);
  if (key === "workspace/broadcasts" && method === "POST") return broadcast(b);
  if (key === "workspace/order-list" && method === "GET") return orderList(url);
  if (key === "stores/cart-info" && method === "GET") {
    const slugs = z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80),
      )
      .max(100)
      .parse((url.searchParams.get("slugs") || "").split(",").filter(Boolean));
    return slugs.length
      ? query(
          "SELECT slug,name FROM stores WHERE status='approved' AND slug IN (" +
            slugs.map(() => "?").join(",") +
            ")",
          slugs,
        )
      : [];
  }
  if (key === "stores" && method === "GET") {
    const q = z
      .string()
      .max(100)
      .parse(url.searchParams.get("q") || "");
    const rows = await query<any[]>(
      `SELECT * FROM stores WHERE status='approved' AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.store_id=stores.id AND (${accessEndSQL()}>UTC_TIMESTAMP() OR EXISTS(SELECT 1 FROM invoices i WHERE i.store_id=stores.id AND i.status='paid' AND i.effective_start_at<=UTC_TIMESTAMP() AND i.effective_end_at>UTC_TIMESTAMP()) OR EXISTS(SELECT 1 FROM account_trial_claims t WHERE t.store_id=stores.id AND t.starts_at<=UTC_TIMESTAMP() AND t.ends_at>UTC_TIMESTAMP()))) AND name LIKE ? ORDER BY id DESC LIMIT 100`,
      ["%" + q + "%"],
    );
    const lat = Number(url.searchParams.get("lat")),
      lng = Number(url.searchParams.get("lng"));
    const located =
      url.searchParams.has("lat") &&
      url.searchParams.has("lng") &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180;
    return rows
      .map((s) => ({
        ...publicStore({
          ...s,
          settings: jsonValue(s.settings),
          theme: jsonValue(s.theme),
        }),
        distance:
          located && s.lat !== null && s.lng !== null
            ? distanceKm(lat, lng, s.lat, s.lng)
            : null,
      }))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  if (key === "stores/mine" && method === "GET")
    return (await signedIn()).memberships;
  if (key === "stores/registration" && method === "GET") {
    const u = await signedIn();
    const c = await pool.getConnection();
    try {
      const { identities: _, ...availability } = await storeRegistrationAvailability(c, u.id);
      return availability;
    } finally { c.release(); }
  }
  if (key === "stores" && method === "POST") {
    const u = await signedIn();
    await throttle("create-store:" + u.id, 5);
    const approvalRequired = await storeApprovalRequired();
    const v = z
      .object({
        name: text,
        slug: z
          .string()
          .min(3)
          .max(80)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .refine((s) => !/^\d+$/.test(s), "Đường dẫn không được chỉ gồm số"),
        address: z.string().min(10).max(500),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
        phone: z.string().trim().max(30).refine(value => !!normalizeStorePhone(value), "Số điện thoại không hợp lệ."),
        plan_id: id.default(1),
        offer_version_id: id.optional(),
      })
      .parse(b);
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await reserveStoreRegistration(c, u.id, v.phone);
      const [r]: any = await c.execute(
        "INSERT INTO stores(slug,name,owner_id,status,address,lat,lng,phone,settings,theme) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          v.slug,
          v.name,
          u.id,
          approvalRequired ? "pending" : "approved",
          v.address,
          v.lat ?? null,
          v.lng ?? null,
          v.phone,
          JSON.stringify(defaultSettings),
          JSON.stringify(defaultTheme),
        ],
      );
      await c.execute("UPDATE store_registration_claims SET store_id=? WHERE user_id=? AND store_id IS NULL", [r.insertId, u.id]);
      await c.execute(
        "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,'owner')",
        [r.insertId, u.id],
      );
      await c.execute(
        "INSERT INTO subscriptions(store_id,plan_id,status) VALUES(?,1,'free')",
        [r.insertId],
      );
      await captureRegistrationPlan(c, r.insertId, v.plan_id, v.offer_version_id);
      await withStore(r.insertId, async () => {
        for (const t of defaults.filter(t=>t.key.startsWith("order_")||t.key.startsWith("crm_")))
          await c.execute(
            "INSERT INTO email_templates(template_key,name,kind,subject,body) VALUES(?,?,?,?,?)",
            [
              t.key,
              t.name,
              t.kind,
              t.key.startsWith("subscription_") || t.key.startsWith("store_") ? t.subject : t.subject.replaceAll("Fleurious", v.name),
              t.key.startsWith("subscription_") || t.key.startsWith("store_") ? t.body : t.body.replaceAll("Fleurious", v.name),
            ],
          );
      });
      if (!approvalRequired) await activateApprovedStore(c, r.insertId);
      await withStore(r.insertId, () => enqueueStoreLifecycleEmail(c, r.insertId, approvalRequired ? "store_registration_pending" : "store_approved"));
      const [createdStore]: any = await c.execute("SELECT s.status,sub.status subscription_status FROM stores s JOIN subscriptions sub ON sub.store_id=s.id WHERE s.id=?",[r.insertId]);
      await c.commit();
      return {
        id: r.insertId,
        slug: v.slug,
        status: createdStore[0].status,
        requiresPayment: createdStore[0].subscription_status === "awaiting_payment",
      };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  if (key === "store" && method === "GET") {
    const s = await storeBy(tenantId());
    const u = await currentUser();
    if (
      s.status !== "approved" &&
      !u?.memberships?.some((m) => m.store_id === s.id)
    )
      throw new HttpError(404, "Cửa hàng chưa mở.");
    return { ...publicStore(s), bank: await activeBank(s.id) };
  }
  if (key === "workspace/settings") {
    await storeOwner();
    const s = await storeBy(tenantId());
    if (method === "GET")
      return { ...s, bank: await activeBank(s.id), features: { goong: !!process.env.GOONG_API_KEY, sepay: !!process.env.SEPAY_WEBHOOK_SECRET } };
    if (method === "PATCH") {
      const v = z
        .object({
          name: text,
          description: z.string().max(3000),
          address: z.string().min(10).max(500),
          phone: z.string().max(30),
          lat: z.number().min(-90).max(90).nullable(),
          lng: z.number().min(-180).max(180).nullable(),
          radius_km: z.number().min(1).max(200),
          settings: settingsSchema,
          version: id,
          bank: z.object({ bank_code: z.string().trim().min(2).max(40), bank_name: z.string().trim().min(2).max(120), account_number: z.string().regex(/^\d{4,30}$/), account_holder: z.string().trim().min(2).max(160), enabled: z.boolean(), sepay_enabled: z.boolean(), auto_confirm_status: z.enum(["confirmed","preparing","ready"]) }).nullable().optional(),
        })
        .parse(b);
      const r = await mutate(
        "UPDATE stores SET name=?,description=?,address=?,phone=?,lat=?,lng=?,radius_km=?,settings=?,version=version+1 WHERE id=? AND version=?",
        [
          v.name,
          v.description,
          v.address,
          v.phone,
          v.lat,
          v.lng,
          v.radius_km,
          JSON.stringify(v.settings),
          s.id,
          v.version,
        ],
      );
      if (!r.affectedRows)
        throw new HttpError(409, "Thông tin đã thay đổi. Hãy tải lại.");
      if (v.bank) {
        await mutate("INSERT INTO store_bank_accounts(bank_code,bank_name,account_number,account_holder,enabled,sepay_enabled,auto_confirm_status) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE bank_code=VALUES(bank_code),bank_name=VALUES(bank_name),account_number=VALUES(account_number),account_holder=VALUES(account_holder),enabled=VALUES(enabled),sepay_enabled=VALUES(sepay_enabled),auto_confirm_status=VALUES(auto_confirm_status)", [v.bank.bank_code,v.bank.bank_name,v.bank.account_number,v.bank.account_holder,v.bank.enabled?1:0,v.bank.sepay_enabled?1:0,v.bank.auto_confirm_status]);
      }
      await storeAudit(s.owner_id, "settings", "stores", String(s.id));
      return resultOK;
    }
  }
  if (key === "payment-intents" && method === "GET") {
    const code = z.string().regex(/^FLR-(ORD|SUB)-\d+-[A-Z0-9]+$/).parse(url.searchParams.get("code") || "");
    const rows = await query<any[]>("SELECT p.*,o.reference order_reference FROM payment_intents p LEFT JOIN orders o ON o.id=p.order_id WHERE p.reference_code=?", [code]);
    if (!rows[0]) throw new HttpError(404, "Không tìm thấy mã thanh toán.");
    return { ...rows[0], expired: parseDateTime(rows[0].expires_at, "utc").getTime() < Date.now() };
  }
  if (key === "workspace/submit" && method === "POST") {
    await storeOwner();
    const s = await storeBy(tenantId());
    if (!["draft", "rejected"].includes(s.status))
      throw new HttpError(409, "Cửa hàng không ở trạng thái gửi duyệt.");
    if (!s.address || !s.phone || s.lat === null || s.lng === null)
      throw new HttpError(
        400,
        "Bổ sung địa chỉ, điện thoại và tọa độ cửa hàng trước khi gửi duyệt.",
      );
    await mutate(
      "UPDATE stores SET status='pending',version=version+1 WHERE id=? AND status=?",
      [s.id, s.status],
    );
    return resultOK;
  }
  if (path[0] === "workspace" && path[1] === "theme") {
    const actor = await storeOwner(),
      s = await storeBy(tenantId());
    if (method === "GET")
      return {
        published: s.theme,
        draft: s.draft_theme || s.theme,
        versions: await query(
          "SELECT id,theme,created_at FROM theme_versions WHERE store_id=? ORDER BY id DESC LIMIT 20",
          [s.id],
        ),
      };
    if (method === "POST" || method === "PATCH") {
      const theme = themeSchema.parse(b.theme);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        if (path[2] === "publish") {
          await c.execute(
            "INSERT INTO theme_versions(store_id,theme,actor_id) VALUES(?,?,?)",
            [s.id, JSON.stringify(s.theme), actor.id],
          );
          await c
            .execute(
              "UPDATE stores SET theme=?,draft_theme=NULL,version=version+1 WHERE id=? AND version=?",
              [JSON.stringify(theme), s.id, id.parse(b.version)],
            )
            .then(([r]: any) => {
              if (!r.affectedRows)
                throw new HttpError(
                  409,
                  "Giao diện đã thay đổi. Tải lại trước khi xuất bản.",
                );
            });
        } else
          await c.execute("UPDATE stores SET draft_theme=? WHERE id=?", [
            JSON.stringify(theme),
            s.id,
          ]);
        await c.commit();
        return resultOK;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    }
  }
  if (key === "workspace/team" && method === "GET") {
    await requirePermission("users");
    return {
      members: await query(
        "SELECT u.id,u.name,u.email,m.role,m.status FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=?",
        [tenantId()],
      ),
      invitations: await query(
        "SELECT id,email,role,status,expires_at FROM invitations WHERE store_id=? ORDER BY id DESC",
        [tenantId()],
      ),
    };
  }
  if (key === "workspace/team/invite" && method === "POST") {
    const u = await storeOwner();
    await quota("staff");
    const v = z.object({ email: z.email().toLowerCase(), role }).parse(b);
    const token = randomBytes(32).toString("hex");
    await mutate(
      "INSERT INTO invitations(store_id,email,role,token_hash,expires_at) VALUES(?,?,?,?,DATE_ADD(NOW(),INTERVAL 2 DAY))",
      [tenantId(), v.email, v.role, digest(token)],
    );
    await storeAudit(u.id, "invite", "memberships", v.email);
    return { url: "/join?token=" + token };
  }
  if (key === "invitations/accept" && method === "POST") {
    const u = await signedIn(),
      token = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(b.token);
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [rs]: any = await c.execute(
        "SELECT * FROM invitations WHERE token_hash=? AND status='pending' AND expires_at>NOW() FOR UPDATE",
        [digest(token)],
      );
      const v = rs[0];
      if (!v || v.email !== u.email)
        throw new HttpError(
          403,
          "Lời mời không hợp lệ hoặc không dành cho email của bạn.",
        );
      await withStore(v.store_id, () => quota("staff"));
      await c.execute(
        "INSERT INTO store_memberships(store_id,user_id,role) VALUES(?,?,?) ON DUPLICATE KEY UPDATE role=IF(role='owner',role,VALUES(role)),status='active'",
        [v.store_id, u.id, v.role],
      );
      await c.execute("UPDATE invitations SET status='accepted' WHERE id=?", [
        v.id,
      ]);
      await c.commit();
      return { storeId: v.store_id };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  if (
    path[0] === "workspace" &&
    path[1] === "team" &&
    path[2] &&
    method === "PATCH"
  ) {
    const u = await storeOwner(),
      target = id.parse(path[2]),
      v = z.object({ role, status: z.enum(["active", "revoked"]) }).parse(b);
    const [m] = await query<any[]>(
      "SELECT role FROM store_memberships WHERE store_id=? AND user_id=?",
      [tenantId(), target],
    );
    if (!m || m.role === "owner" || target === u.id)
      throw new HttpError(403, "Không thể thay đổi chủ cửa hàng tại đây.");
    await mutate(
      "UPDATE store_memberships SET role=?,status=? WHERE store_id=? AND user_id=?",
      [v.role, v.status, tenantId(), target],
    );
    await storeAudit(u.id, "membership", "users", String(target));
    return resultOK;
  }
  if (key === "workspace/billing" && method === "GET") {
    const owner = await storeOwner();
    await advanceBilling(tenantId());
    const usage = (await query<any[]>(
      "SELECT (SELECT COUNT(*) FROM products WHERE active=1) products,(SELECT COUNT(*) FROM store_memberships WHERE store_id=? AND status='active') staff,(SELECT COALESCE(SUM(size),0) FROM assets) storage_bytes",
      [tenantId()],
    ))[0];
    const emailUsage = await emailAllowance(pool,tenantId());
    return {
      server_now: new Date().toISOString(),
      account_trials: await accountTrialAvailability(owner.id),
      store_trials: await query("SELECT t.*,v.name plan_name FROM account_trial_claims t JOIN plan_versions v ON v.id=t.plan_version_id WHERE t.store_id=? AND t.ends_at>UTC_TIMESTAMP() ORDER BY t.starts_at",[tenantId()]),
      subscription: (
        await query<any[]>(
          `SELECT s.*,COALESCE(v.name,p.name) name,COALESCE(v.limits,p.limits) limits,COALESCE(v.monthly_price,p.monthly_price) monthly_price,${accessEndSQL('s')} expires_at,GREATEST(0,CEIL(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),${accessEndSQL('s')})/86400)) days_remaining,GREATEST(0,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),${accessEndSQL('s')})) seconds_remaining FROM subscriptions s JOIN plans p ON p.id=s.plan_id LEFT JOIN plan_versions v ON v.id=s.plan_version_id WHERE s.store_id=?`,
          [tenantId()],
        )
      )[0],
      invoices: await query(
        "SELECT * FROM invoices WHERE store_id=? ORDER BY id DESC",
        [tenantId()],
      ),
      scheduled: (await query<any[]>("SELECT i.*,v.plan_id FROM invoices i LEFT JOIN plan_versions v ON v.id=i.plan_version_id WHERE i.store_id=? AND i.status='paid' AND i.effective_start_at>UTC_TIMESTAMP() ORDER BY i.effective_start_at LIMIT 1",[tenantId()]))[0] || null,
      reservations: await query("SELECT i.*,v.plan_id FROM invoices i LEFT JOIN plan_versions v ON v.id=i.plan_version_id WHERE i.store_id=? AND i.status='paid' AND i.effective_start_at>UTC_TIMESTAMP() ORDER BY i.effective_start_at",[tenantId()]),
      pending_plan: (await query<any[]>("SELECT i.*,v.plan_id FROM invoices i LEFT JOIN plan_versions v ON v.id=i.plan_version_id WHERE i.store_id=? AND i.status='open' ORDER BY i.due_date,i.id LIMIT 1",[tenantId()]))[0] || null,
      plans: await query("SELECT id,name,monthly_price,limits,active,trial_days FROM plans WHERE active=1"),
      store: publicStore(await storeBy(tenantId())),
      usage: {
        products: Number(usage?.products || 0),
        staff: Number(usage?.staff || 0),
        storage_mb: Number(usage?.storage_bytes || 0) / 1048576,
        email_sends: emailUsage.used,
      },
    };
  }
  if (key === "workspace/billing/cancel" && method === "POST") {
    const u = await storeOwner();
    const cancel = z.boolean().parse(b.cancel), sid = tenantId();
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [sid]);
      if (cancel) {
        const [paidFuture]: any = await c.execute("SELECT id FROM invoices WHERE store_id=? AND status='paid' AND amount>0 AND effective_start_at>UTC_TIMESTAMP() LIMIT 1",[sid]);
        if (paidFuture.length) throw new HttpError(409,"Kỳ tiếp theo đã thanh toán. Vui lòng liên hệ platform để xử lý trước khi ngừng gia hạn.");
        const [future]: any = await c.execute("SELECT i.id,i.paid FROM invoices i JOIN subscriptions sub ON sub.store_id=i.store_id WHERE i.store_id=? AND (i.status='open' OR (i.status='paid' AND i.amount=0 AND i.activated_at IS NULL)) AND (COALESCE(i.starts_at,i.period_start)>=COALESCE(sub.access_ends_at,sub.trial_ends_at,sub.current_period_end,sub.period_end) OR sub.status='awaiting_payment') FOR UPDATE", [sid]);
        if (future.some((i: any) => Number(i.paid) > 0)) throw new HttpError(409, "Hóa đơn kỳ tiếp theo đã thu một phần. Vui lòng liên hệ platform xử lý trước khi ngừng gia hạn.");
        for (const i of future) {
          await c.execute("UPDATE invoices SET status='void' WHERE id=?", [i.id]);
          await c.execute("UPDATE payment_intents SET status='cancelled' WHERE invoice_id=? AND status='pending'", [i.id]);
          await c.execute("UPDATE email_outbox SET status='cancelled',last_error='RENEWAL_CANCELLED' WHERE dedupe_key IN (?,?) AND status IN ('pending','failed')", [`subscription_renewal_5d:${i.id}`, `subscription_renewal_1d:${i.id}`]);
        }
      }
      await c.execute("UPDATE subscriptions SET cancel_at_period_end=?,version=version+1 WHERE store_id=?", [cancel ? 1 : 0, sid]);
      await c.commit();
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
    await storeAudit(
      u.id,
      "subscription_cancel",
      "subscriptions",
      String(tenantId()),
    );
    return resultOK;
  }
  if (key === "workspace/billing/preview" && method === "POST") {
    const owner = await storeOwner();
    const v = z.object({ plan_id: id, trial: z.boolean().default(false) }).parse(b), sid = tenantId();
    await expirePlanChangeRequests(sid);
    const c = await pool.getConnection();
    try {
      // Store locks serialize financial writes. RC avoids cross-tenant empty
      // invoice-range gap locks; this setting applies to this transaction only.
      await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await c.beginTransaction();
      const [stores]: any = await c.execute("SELECT status FROM stores WHERE id=? FOR UPDATE", [sid]);
      if (!["approved", "suspended"].includes(stores[0]?.status)) throw new HttpError(409, "Cửa hàng chưa được duyệt.");
      const preview = v.trial ? await previewAccountTrial(c,sid,v.plan_id,owner.id) : await previewSubscriptionChange(c, sid, v.plan_id);
      await c.rollback();
      return preview;
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  }
  if (key === "workspace/billing/start" && method === "POST") {
    const owner = await storeOwner();
    const v = z.object({ plan_id: id, invoice_id: id.optional(), trial: z.boolean().default(false), quote_token: z.string().length(64).optional(), quote_expires_at: z.number().optional() }).parse(b);
    const sid = tenantId();
    await expirePlanChangeRequests(sid);
    const c = await pool.getConnection();
    try {
      await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await c.beginTransaction();
      const [plans]: any = await c.execute("SELECT * FROM plans WHERE id=? AND active=1", [v.plan_id]);
      const plan = plans[0];
      if (!plan) throw new HttpError(404, "Gói dịch vụ không tồn tại.");
      const [storeRows]: any = await c.execute("SELECT status,billing_suspended FROM stores WHERE id=? FOR UPDATE", [sid]);
      if (!["approved", "suspended"].includes(storeRows[0]?.status)) throw new HttpError(409, "Cửa hàng chưa được duyệt.");
      if (v.trial) {
        if (v.invoice_id) throw new HttpError(400,"Dùng thử không nhận mã hóa đơn thanh toán.");
        const trial = await reserveAccountTrial(c,sid,v.plan_id,owner.id,v.quote_token,v.quote_expires_at);
        await c.commit();
        return trial;
      }
      if (v.quote_token && (!v.quote_expires_at || v.quote_expires_at < Date.now() || v.quote_token !== await subscriptionChangeToken(c, sid, v.plan_id))) throw new HttpError(409, "Giá gói, kỳ sử dụng hoặc thanh toán đã thay đổi. Vui lòng xem lại trước khi xác nhận.");
      let inv: any;
      if (v.invoice_id) {
        const [rows]: any = await c.execute("SELECT * FROM invoices WHERE store_id=? AND id=? AND status='open' AND paid<amount FOR UPDATE", [sid, v.invoice_id]);
        inv = rows[0];
        if (!inv) throw new HttpError(404, "Không tìm thấy hóa đơn cần thanh toán.");
      } else inv = await prepareSubscriptionInvoice(c, sid, v.plan_id);
      let payment = null;
      if (inv.status === "open") {
        const bank = await platformBank(c);
        if (!bank) throw new HttpError(409, "Nền tảng chưa cấu hình tài khoản nhận phí dịch vụ. Vui lòng liên hệ admin platform.");
        payment = { ...await createIntent(c, sid, "subscription", owner.id, Number(inv.amount) - Number(inv.paid), null, inv.id, bank, inv.purpose === "plan_change" && Number(inv.paid) === 0 ? inv.payment_deadline_at : undefined), purpose: inv.purpose, paymentDeadlineAt: inv.payment_deadline_at };
      }
      if (inv.purpose !== "plan_change" || inv.status === "paid") await c.execute("UPDATE subscriptions SET version=version+IF(cancel_at_period_end=1,1,0),cancel_at_period_end=0 WHERE store_id=?", [sid]);
      await c.execute("INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,'subscription_plan_selected','invoices',?,?)", [owner.id,String(inv.id),JSON.stringify({ plan_id:v.plan_id,invoice_id:inv.id,amount:inv.amount,starts_at:inv.effective_start_at || inv.starts_at,ends_at:inv.effective_end_at || inv.ends_at })]);
      await c.commit();
      return { ok: true, invoiceId: inv.id, payment };
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  }
  if (key === "workspace/automations" && method === "GET") {
    await requirePermission("emails");
    return {
      rules: await query("SELECT * FROM crm_automations ORDER BY id DESC"),
      templates: await query(
        "SELECT id,name FROM email_templates WHERE kind='marketing' AND active=1",
      ),
    };
  }
  if (
    key === "workspace/automations" &&
    (method === "POST" || method === "PATCH")
  ) {
    const u = await requirePermission("email_templates");
    const v = z
      .object({
        name: text,
        trigger_name: z.enum(["aftercare", "birthday", "winback"]),
        template_id: id,
        delay_days: z.number().int().min(1).max(365),
        message: z.string().min(2).max(6000),
        active: z.boolean(),
      })
      .parse(b);
    const [t] = await query<any[]>(
      "SELECT id FROM email_templates WHERE id=? AND kind='marketing'",
      [v.template_id],
    );
    if (!t)
      throw new HttpError(
        400,
        "Template không thuộc store hoặc không phải marketing.",
      );
    if (method === "POST")
      await mutate(
        "INSERT INTO crm_automations(name,trigger_name,template_id,delay_days,message,active) VALUES(?,?,?,?,?,?)",
        [
          v.name,
          v.trigger_name,
          v.template_id,
          v.delay_days,
          v.message,
          v.active ? 1 : 0,
        ],
      );
    else
      await mutate(
        "UPDATE crm_automations SET name=?,trigger_name=?,template_id=?,delay_days=?,message=?,active=? WHERE id=?",
        [
          v.name,
          v.trigger_name,
          v.template_id,
          v.delay_days,
          v.message,
          v.active ? 1 : 0,
          id.parse(b.id),
        ],
      );
    await storeAudit(u.id, "automation", "crm", String(b.id || "new"));
    return resultOK;
  }
  if (key === "workspace/analytics" && method === "GET") {
    await requirePermission("overview");
    const from = day.parse(
        url.searchParams.get("from") ||
          hanoiDateKey(Date.now() - 30 * 86400000),
      ),
      to = day.parse(
        url.searchParams.get("to") || hanoiDateKey(),
      );
    try { analyticsPeriod(from, to); }
    catch (e) { throw new HttpError(400, (e as Error).message); }
    return loadStoreAnalytics(from, to, tenantId(), query);
  }
  if (key === "workspace/calendar" && method === "GET") {
    await requirePermission("orders");
    const from = day.parse(url.searchParams.get("from")),
      to = day.parse(url.searchParams.get("to"));
    if (
      to < from ||
      new Date(to).getTime() - new Date(from).getTime() > 62 * 86400000
    )
      throw new HttpError(400, "Chọn tối đa 62 ngày.");
    return {
      orders: await query(
        "SELECT o.*," + orderPaymentStatusSQL() + " payment_status,(SELECT u.name FROM users u WHERE u.id=o.created_by) creator_name,(SELECT COALESCE(SUM(IF(p.kind='collect',p.amount,-p.amount)),0) FROM order_payments p WHERE p.order_id=o.id) collected,(SELECT JSON_ARRAYAGG(JSON_OBJECT('name',product_name,'quantity',quantity,'size',size,'price',price,'line_type',line_type,'description',description,'image',image)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o WHERE o.delivery_date BETWEEN ? AND ? ORDER BY o.delivery_date,o.delivery_slot,o.id",
        [from, to],
      ),
      notes: await query(
        "SELECT * FROM calendar_notes WHERE day BETWEEN ? AND ? ORDER BY id",
        [from, to],
      ),
    };
  }
  if (key === "workspace/calendar/notes" && method === "POST") {
    const u = await requirePermission("orders"),
      v = z
        .object({
          title: text,
          content: z.string().max(3000),
          color: z.enum([
            "#555555",
            "#a34b40",
            "#96731b",
            "#3c7665",
            "#4f6395",
          ]),
          day,
        })
        .parse(b);
    await mutate(
      "INSERT INTO calendar_notes(title,content,color,day,author_id) VALUES(?,?,?,?,?)",
      [v.title, v.content, v.color, v.day, u.id],
    );
    return resultOK;
  }
  if (
    path[0] === "workspace" &&
    path[1] === "calendar" &&
    path[2] === "notes" &&
    path[3] &&
    method === "DELETE"
  ) {
    await requirePermission("orders");
    await mutate("DELETE FROM calendar_notes WHERE id=?", [id.parse(path[3])]);
    return resultOK;
  }
  if (path[0] === "workspace" && path[1] === "orders" && path[2]) {
    const actor = await requirePermission("orders"),
      orderId = id.parse(path[2]);
    if (path[3] === "status" && method === "PATCH") {
      const v = z
        .object({
          status: z.enum(orderStates),
          version: id,
          reason: z.string().trim().max(500).optional(),
          date: day.optional(),
          slot: z.string().trim().min(1).max(30).optional(),
        })
        .parse(b);
      return changeOrder(orderId, v.status, actor.id, false, v.version, v);
    }
    if (path[3] === "payment-method" && method === "PATCH") {
      const member = await membership();
      if (!["owner", "admin", "manager"].includes(member.role))
        throw new HttpError(
          403,
          "Bạn không có quyền đổi phương thức thanh toán.",
        );
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        await changePaymentMethod(c, orderId, actor.id, b);
        await c.commit();
        return resultOK;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    }
    if (path[3] === "reschedule" && method === "PATCH")
      return reschedule(orderId, actor.id, b);
    if (path[3] === "timeline" && method === "GET")
      return {
        events: await query(
          "SELECT * FROM order_status_events WHERE order_id=? ORDER BY id",
          [orderId],
        ),
        payments: await query(
          "SELECT * FROM order_payments WHERE order_id=? ORDER BY id",
          [orderId],
        ),
      };
    if (path[3] === "assignment" && ["GET", "PATCH"].includes(method)) {
      const [order] = await query<any[]>(
        "SELECT o.assigned_to,o.tags,o.version,u.name assigned_name FROM orders o LEFT JOIN users u ON u.id=o.assigned_to WHERE o.id=?",
        [orderId],
      );
      if (!order) throw new HttpError(404, "Không tìm thấy đơn.");
      if (method === "GET")
        return {
          ...order,
          staff: await query(
            "SELECT m.user_id id,u.name FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=? AND m.status='active' AND u.active=1 ORDER BY u.name,m.user_id",
            [tenantId()],
          ),
        };
      const assignee = b.assigned_to === null ? null : id.parse(b.assigned_to);
      // An existing inactive assignee may be kept while editing labels, but
      // assigning someone new requires an active account in this store.
      if (assignee && assignee !== order.assigned_to) {
        const [m] = await query<any[]>(
          "SELECT m.user_id FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=? AND m.user_id=? AND m.status='active' AND u.active=1",
          [tenantId(), assignee],
        );
        if (!m) throw new HttpError(400, "Nhân sự không thuộc cửa hàng.");
      }
      const tags = z
        .array(z.string().trim().min(1).max(30))
        .max(6)
        .parse(b.tags);
      const r = await mutate(
        "UPDATE orders SET assigned_to=?,tags=?,version=version+1 WHERE id=? AND version=?",
        [assignee, JSON.stringify(tags), orderId, id.parse(b.version)],
      );
      if (!r.affectedRows)
        throw new HttpError(409, "Đơn đã thay đổi, hãy tải lại.");
      return resultOK;
    }
    if (path[3] === "payment-status" && method === "PATCH") {
      await storeOwner();
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const result = await setOrderPaymentBalance(c, orderId, actor.id, b);
        await c.commit();
        return result;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    }
    if (path[3] === "payment" && method === "POST") {
      await storeOwner();
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        await recordOrderPayment(c, orderId, actor.id, b);
        await c.commit();
        return resultOK;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    }
  }
  if (path[0] === "orders" && path[2] === "reorder" && method === "POST") {
    const u = await signedIn();
    const [o] = await withSystem(() =>
      query<any[]>("SELECT * FROM orders WHERE id=? AND user_id=?", [
        id.parse(path[1]),
        u.id,
      ]),
    );
    if (!o || o.status !== "delivered")
      throw new HttpError(409, "Chỉ có thể đặt lại đơn đã giao.");
    return withStore(o.store_id, async () => {
      const s = await storeBy(o.store_id);
      const custom = await query<any[]>(
        "SELECT id FROM order_items WHERE order_id=? AND line_type='custom'",
        [o.id],
      );
      if (custom.length)
        throw new HttpError(
          409,
          "Đơn có thiết kế riêng. Vui lòng liên hệ cửa hàng để được báo giá lại.",
        );
      const items = await query<any[]>(
        "SELECT product_id productId,quantity,size FROM order_items WHERE order_id=?",
        [o.id],
      );
      const c = await pool.getConnection();
      try {
        const quote = await calculate(c, { items, code: "" });
        return { store: publicStore(s), items, quote };
      } finally {
        c.release();
      }
    });
  }
  if (key === "inbox" && method === "GET") {
    const u = await signedIn();
    return query(
      "SELECT n.id,n.store_id,n.title,n.body,n.href,n.read_at,n.created_at FROM notifications n WHERE n.user_id=? AND (n.href NOT LIKE '/workspace/%' OR EXISTS(SELECT 1 FROM store_memberships m WHERE m.store_id=n.store_id AND m.user_id=n.user_id AND m.status='active')) ORDER BY n.id DESC LIMIT 100",
      [u.id],
    );
  }
  if (key === "inbox/read" && method === "POST") {
    const u = await signedIn();
    await mutate(
      "UPDATE notifications SET read_at=NOW() WHERE user_id=? AND id=?",
      [u.id, id.parse(b.id)],
    );
    return resultOK;
  }
  if (key === "notification-preferences") {
    const u = await signedIn();
    if (method === "GET")
      return (
        (
          await query<any[]>(
            "SELECT * FROM notification_preferences WHERE user_id=? AND store_id=?",
            [u.id, tenantId()],
          )
        )[0] || { marketing: 0, push: 0 }
      );
    if (method === "PATCH") {
      const v = z
        .object({ marketing: z.boolean(), push: z.boolean() })
        .parse(b);
      await mutate(
        "INSERT INTO notification_preferences(user_id,store_id,marketing,push) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE marketing=VALUES(marketing),push=VALUES(push)",
        [u.id, tenantId(), v.marketing ? 1 : 0, v.push ? 1 : 0],
      );
      await mutate("UPDATE customers SET marketing_consent=? WHERE email=?", [
        v.marketing ? 1 : 0,
        u.email,
      ]);
      if (v.marketing)
        await mutate("DELETE FROM email_suppressions WHERE email=?", [u.email]);
      return resultOK;
    }
  }
  if (key === "push" && method === "POST") {
    const u = await signedIn();
    const s = z
      .object({
        endpoint: z.url().startsWith("https://"),
        keys: z.object({
          p256dh: z.string().min(20).max(200),
          auth: z.string().min(10).max(100),
        }),
      })
      .parse(b);
    const host = new URL(s.endpoint).hostname;
    if (
      ![
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].some((h) => host === h || host.endsWith("." + h))
    )
      throw new HttpError(400, "Push endpoint không được hỗ trợ.");
    await mutate(
      "INSERT INTO push_subscriptions(user_id,endpoint_hash,subscription) VALUES(?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),subscription=VALUES(subscription)",
      [u.id, endpointHash(s.endpoint), JSON.stringify(s)],
    );
    return resultOK;
  }
  if (key === "push" && method === "DELETE") {
    const u = await signedIn();
    await mutate("DELETE FROM push_subscriptions WHERE user_id=?", [u.id]);
    return resultOK;
  }
  if (key === "analytics" && method === "POST") {
    const v = z
      .object({
        event_key: z.uuid(),
        name: z.enum([
          "store_view",
          "product_view",
          "add_to_cart",
          "checkout_start",
        ]),
      })
      .parse(b);
    await throttle("analytics:" + fingerprint + ":" + tenantId(), 2000);
    await mutate(
      "INSERT IGNORE INTO analytics_events(store_id,event_key,name) VALUES(?,?,?)",
      [tenantId(), v.event_key, v.name],
    );
    return resultOK;
  }
  if (path[0] === "goong" && method === "GET") {
    if (path.length !== 2 || !["search", "detail"].includes(path[1]))
      throw new HttpError(404, "Không tìm thấy dịch vụ địa chỉ.");
    await throttle("maps:" + fingerprint, 200);
    const apiKey = process.env.GOONG_API_KEY;
    if (!apiKey)
      throw new HttpError(
        503,
        "Gợi ý địa chỉ chưa được cấu hình. Bạn vẫn có thể nhập địa chỉ thủ công.",
      );
    const target = path[1] === "detail" ? "Place/Detail" : "Place/AutoComplete";
    const upstream = new URL("https://rsapi.goong.io/" + target);
    upstream.searchParams.set("api_key", apiKey);
    if (path[1] === "detail")
      upstream.searchParams.set(
        "place_id",
        z.string().min(1).max(300).parse(url.searchParams.get("place_id")),
      );
    else {
      upstream.searchParams.set(
        "input",
        z.string().min(2).max(200).parse(url.searchParams.get("input")),
      );
      upstream.searchParams.set("location", goongSearchLocation(url.searchParams.get("lat"), url.searchParams.get("lng")));
      // Bias suggestions toward Hanoi by default without restricting other cities.
    }
    const response = await fetch(upstream, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new HttpError(502, "Chưa thể tìm địa chỉ.");
    const payload = await response.json();
    if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS")
      throw new HttpError(
        502,
        "Dịch vụ địa chỉ chưa khả dụng. Vui lòng thử lại sau.",
      );
    return payload;
  }
  if (path[0] === "platform") return platformAPI(path.slice(1), method, b, url);
}

async function platformAPI(path: string[], method: string, b: any, url: URL) {
  const actor = await platformActor();
  return withSystem(async () => {
    const key = path.join("/");
    if (key === "sepay/credentials" && method === "GET") {
      const rows: any = await query("SELECT enabled,created_at,updated_at,RIGHT(webhook_secret,4) secret_last4,RIGHT(api_key,4) api_last4 FROM platform_integrations WHERE provider='sepay'");
      return { webhookUrl: new URL("/api/sepay/webhook", process.env.APP_ORIGIN || url.origin).toString(), configured: !!rows[0], ...rows[0] };
    }
    if (key === "sepay/credentials" && method === "POST") {
      const webhookSecret = "flr_whsec_" + randomBytes(32).toString("base64url");
      const apiKey = "flr_sepay_" + randomBytes(32).toString("base64url");
      await mutate("INSERT INTO platform_integrations(provider,webhook_secret,api_key,enabled,created_by) VALUES('sepay',?,?,1,?) ON DUPLICATE KEY UPDATE webhook_secret=VALUES(webhook_secret),api_key=VALUES(api_key),enabled=1,created_by=VALUES(created_by)", [webhookSecret, apiKey, actor.id]);
      return { webhookUrl: new URL("/api/sepay/webhook", process.env.APP_ORIGIN || url.origin).toString(), webhookSecret, apiKey, warning: "Chỉ hiển thị credential đầy đủ lần này. Hãy lưu vào SePay ngay." };
    }
    if (key === "sepay/credentials/disable" && method === "POST") {
      await mutate("UPDATE platform_integrations SET enabled=0 WHERE provider='sepay'");
      return resultOK;
    }
    if (key === "config" && method === "PATCH") {
      if (b.billingBank !== undefined) {
        const bank = z.object({ bank_code: z.string().trim().min(2).max(40), bank_name: z.string().trim().min(2).max(120), account_number: z.string().regex(/^\d{4,30}$/), account_holder: z.string().trim().min(2).max(160), enabled: z.boolean() }).parse(b.billingBank);
        await mutate("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('billing_bank',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)", [JSON.stringify({ ...bank, sepay_enabled: true, auto_confirm_status: "confirmed" }), actor.id]);
        return resultOK;
      }
      const required = z.boolean().parse(b.storeApprovalRequired);
      await setStoreApprovalRequired(required, actor.id);
      return { ok: true, storeApprovalRequired: required };
    }
    if (key === "overview" && method === "GET")
      return {
        stats: (
          await query<any[]>(
            "SELECT (SELECT COUNT(*) FROM stores) stores,(SELECT COUNT(*) FROM stores WHERE status='pending') pending,(SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM orders) orders_count,(SELECT COALESCE(SUM(total),0) FROM orders WHERE status='delivered') gmv,(SELECT COALESCE(SUM(amount),0) FROM billing_payments) collected,(SELECT COUNT(*) FROM subscriptions WHERE status IN ('active','free','trialing')) subscriptions",
          )
        )[0],
        revenue: await query(
          "SELECT DATE(created_at) day,COUNT(*) orders_count,SUM(IF(status='delivered',total,0)) gmv FROM orders GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30",
        ),
        plans: await query("SELECT * FROM plans"),
      };
    if (path[0] === "emails") return platformEmails(path.slice(1), method, b, actor.id);
    if (key === "stores" && method === "GET")
      return query(
        "SELECT s.id,s.slug,s.name,s.owner_id,s.status,s.version,s.address,s.phone,s.created_at,u.email owner_email,sub.status subscription_status,p.name plan,(SELECT COUNT(*) FROM orders o WHERE o.store_id=s.id) orders_count,(SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.store_id=s.id AND status='delivered') gmv,(SELECT COUNT(*) FROM customers c WHERE c.store_id=s.id) customers,(SELECT MAX(created_at) FROM orders o WHERE o.store_id=s.id) last_order FROM stores s JOIN users u ON u.id=s.owner_id LEFT JOIN subscriptions sub ON sub.store_id=s.id LEFT JOIN plans p ON p.id=sub.plan_id ORDER BY s.id DESC",
      );
    if (path[0] === "stores" && path[1]) {
      const sid = id.parse(path[1]);
      if (path[2] === "ghost" && path.length === 3 && method === "POST")
        return startGhost(actor.id, null, b, sid);
      if (method === "GET") {
        await expirePlanChangeRequests(sid);
        const store = await storeBy(sid);
        return {
          store,
          account_trials: await accountTrialAvailability(store.owner_id),
          tasks: await query(
            "SELECT * FROM merchant_tasks WHERE store_id=? ORDER BY id DESC",
            [sid],
          ),
          subscription: (
            await query<any[]>("SELECT sub.*,v.name plan_name,v.monthly_price,v.limits,cl.trial_days original_trial_days,cl.started_at original_trial_start,cl.ends_at granted_trial_end FROM subscriptions sub LEFT JOIN plan_versions v ON v.id=sub.plan_version_id LEFT JOIN trial_claims cl ON cl.store_id=sub.store_id WHERE sub.store_id=?", [sid])
          )[0],
          invoices: await query(
            "SELECT * FROM invoices WHERE store_id=? ORDER BY id DESC",
            [sid],
          ),
          audit: await query(
            "SELECT * FROM audit_logs WHERE store_id=? ORDER BY id DESC LIMIT 100",
            [sid],
          ),
        };
      }
      if (path[2] === "status" && method === "PATCH") {
        const status = z
            .enum(["approved", "rejected", "suspended", "closed"])
            .parse(b.status),
          reason = z.string().trim().min(5).max(1000).parse(b.reason),
          s = await storeBy(sid);
        const allowed: Record<string, string[]> = {
          pending: ["approved", "rejected"],
          approved: ["suspended", "closed"],
          suspended: ["approved", "closed"],
          rejected: ["closed"],
          draft: ["closed"],
        };
        if (!allowed[s.status]?.includes(status))
          throw new HttpError(409, "Chuyển trạng thái cửa hàng không hợp lệ.");
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          await c
            .execute(
              "UPDATE stores SET status=?,billing_suspended=0,suspension_reason=?,version=version+1 WHERE id=? AND version=? AND status=?",
              [status, status === "suspended" ? reason : null, sid, id.parse(b.version), s.status],
            )
            .then(([r]: any) => {
              if (!r.affectedRows)
                throw new HttpError(409, "Cửa hàng đã thay đổi.");
            });
          if (status === "approved") {
            await activateApprovedStore(c, sid);
            await reconcileBilling(c, sid);
            const [updated]: any = await c.execute("SELECT status FROM stores WHERE id=?", [sid]);
            if (updated[0].status !== "approved" && s.status !== "pending") throw new HttpError(409, "Cửa hàng còn công nợ quá hạn hoặc gói đã hết hạn. Vui lòng xử lý hóa đơn/gia hạn trước khi mở lại.");
            if (s.status === "pending") await enqueueStoreLifecycleEmail(c, sid, "store_approved");
          }
          if (["rejected","closed"].includes(status)) await c.execute("DELETE FROM account_trial_claims WHERE store_id=? AND starts_at IS NULL",[sid]);
          if (status === "closed") {
            const [obligations]: any = await c.execute(
              "SELECT (SELECT COUNT(*) FROM orders WHERE store_id=? AND status NOT IN ('delivered','cancelled')) active_orders,(SELECT COUNT(*) FROM invoices WHERE store_id=? AND status='open' AND paid<amount) invoices,(SELECT COUNT(*) FROM orders o WHERE o.store_id=? AND o.status='cancelled' AND (SELECT COALESCE(SUM(IF(p.kind='collect',p.amount,-p.amount)),0) FROM order_payments p WHERE p.order_id=o.id AND p.store_id=?)>0) refunds",
              [sid, sid, sid, sid],
            );
            if (
              obligations[0].active_orders ||
              obligations[0].invoices ||
              obligations[0].refunds
            )
              throw new HttpError(
                409,
                "Cần hoàn tất đơn đang mở, hoàn tiền và công nợ trước khi đóng cửa hàng. Có thể tạm đình chỉ để ngưng nhận đơn mới.",
              );
          }
          await c.execute(
            "INSERT INTO audit_logs(store_id,user_id,action,entity,entity_id) VALUES(?,?,?,?,?)",
            [sid, actor.id, status + ": " + reason, "stores", String(sid)],
          );
          await c.execute(
            "INSERT INTO notifications(store_id,user_id,event_key,title,body,href) VALUES(?,?,?,?,?,?)",
            [
              sid,
              s.owner_id,
              "store:" + sid + ":" + (s.version + 1),
              status === "suspended" ? "Cửa hàng đã tạm đóng băng" : "Trạng thái cửa hàng: " + displayLabel("store", status),
              reason,
              "/workspace/" + sid + "/billing",
            ],
          );
          await c.commit();
          return resultOK;
        } catch (e) {
          await c.rollback();
          throw e;
        } finally {
          c.release();
        }
      }
      if (path[2] === "tasks" && method === "POST") {
        const v = z
          .object({
            title: text,
            note: z.string().max(3000),
            due_date: day.nullable(),
          })
          .parse(b);
        await mutate(
          "INSERT INTO merchant_tasks(store_id,title,note,due_date) VALUES(?,?,?,?)",
          [sid, v.title, v.note, v.due_date],
        );
        return resultOK;
      }
      if (path[2] === "tasks" && path[3] && method === "PATCH") {
        await mutate(
          "UPDATE merchant_tasks SET status=? WHERE store_id=? AND id=?",
          [z.enum(["open", "done"]).parse(b.status), sid, id.parse(path[3])],
        );
        return resultOK;
      }
      if (path[2] === "trial-extension" && method === "POST") {
        const v = z.object({days:z.number().int().min(1).max(90),reason:z.string().trim().min(5).max(500),version:id}).parse(b);
        const c = await pool.getConnection();
        try { await c.beginTransaction(); const result = await extendStoreTrial(c,sid,v.days,v.reason,actor.id,v.version); await c.commit(); return result; }
        catch(e) { await c.rollback(); throw e; } finally { c.release(); }
      }
      if (path[2] === "subscription" && method === "PATCH") {
        const v = z
          .object({
            plan_id: id,
            status: z.enum([
              "free",
              "active",
              "past_due",
              "restricted",
              "cancelled",
            ]),
            period_end: day.nullable(),
            version: id,
          })
          .parse(b);
        const [p] = await query<any[]>(
          "SELECT id FROM plans WHERE id=? AND active=1",
          [v.plan_id],
        );
        if (!p) throw new HttpError(400, "Gói dịch vụ không tồn tại.");
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [sid]);
          const [current]: any = await c.execute("SELECT * FROM subscriptions WHERE store_id=? FOR UPDATE", [sid]);
          if (current[0]?.billing_policy === 1 || current[0]?.trial_started_at) throw new HttpError(409,"Kỳ sử dụng được quản lý qua hóa đơn. Với dùng thử, hãy dùng thao tác Gia hạn dùng thử.");
          const [r]: any = await c.execute(
            "UPDATE subscriptions SET plan_id=?,status=?,period_end=?,current_period_end=?,trial_started_at=NULL,trial_ends_at=NULL,version=version+1 WHERE store_id=? AND version=?",
            [v.plan_id, v.status, v.period_end, v.period_end, sid, v.version],
          );
          if (!r.affectedRows) throw new HttpError(409, "Gói đã thay đổi.");
          await reconcileBilling(c, sid);
          await c.commit();
        } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
        await mutate(
          "INSERT INTO audit_logs(store_id,user_id,action,entity,entity_id) VALUES(?,?,?,?,?)",
          [sid, actor.id, "subscription", "stores", String(sid)],
        );
        return resultOK;
      }
    }
    if (key === "invoices" && method === "GET") {
      await expirePlanChangeRequests();
      return query(
        "SELECT i.*,s.name store_name FROM invoices i JOIN stores s ON s.id=i.store_id ORDER BY id DESC LIMIT 500",
      );
    }
    if (key === "invoices/generate" && method === "POST") {
      await advanceBilling();
      return resultOK;
    }
    if (
      path[0] === "invoices" &&
      path[1] &&
      path[2] === "void" &&
      method === "POST"
    ) {
      const invoice = id.parse(path[1]),
        reason = z.string().trim().min(5).max(500).parse(b.reason),
        c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [lookup]: any = await c.execute("SELECT store_id FROM invoices WHERE id=?", [invoice]);
        if (lookup[0]) await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [lookup[0].store_id]);
        const [rows]: any = await c.execute(
          "SELECT * FROM invoices WHERE id=? FOR UPDATE",
          [invoice],
        );
        const i = rows[0];
        if (!i) throw new HttpError(404, "Không có hóa đơn.");
        if (i.paid > 0)
          throw new HttpError(409, "Hóa đơn đã thu tiền không thể hủy.");
        if (i.status !== "void") {
          await c.execute("UPDATE invoices SET status='void' WHERE id=?", [
            invoice,
          ]);
          await c.execute(
            "INSERT INTO audit_logs(store_id,user_id,action,entity,entity_id) VALUES(?,?,?,?,?)",
            [
              i.store_id,
              actor.id,
              "void: " + reason,
              "invoices",
              String(invoice),
            ],
          );
          await c.execute("UPDATE payment_intents SET status='cancelled' WHERE invoice_id=? AND status='pending'", [invoice]);
          await c.execute("UPDATE email_outbox SET status='cancelled',last_error='INVOICE_VOID' WHERE store_id=? AND dedupe_key IN (?,?,?) AND status IN ('pending','failed')", [i.store_id, `subscription_renewal_5d:${invoice}`, `subscription_renewal_1d:${invoice}`, `subscription_suspended:${invoice}`]);
          await reconcileBilling(c, i.store_id);
        }
        await c.commit();
        return resultOK;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    }
    if (
      path[0] === "invoices" &&
      path[1] &&
      path[2] === "payment" &&
      method === "POST"
    ) {
      const v = z
          .object({
            amount: z.number().int().positive(),
            reference: z.string().min(5).max(100),
          })
          .parse(b),
        invoice = id.parse(path[1]);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        await recordInvoicePayment(c, invoice, v.amount, v.reference, actor.id);
        await c.commit();
        return resultOK;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    }
    if (key === "plans" && method === "GET") {
      const rows = await query<any[]>("SELECT p.id,p.name,p.monthly_price,p.limits,p.active,p.trial_days,(SELECT COUNT(*) FROM subscriptions sub JOIN stores s ON s.id=sub.store_id WHERE sub.plan_id=p.id AND s.status='pending' AND sub.billing_policy=1) pending_offers,(SELECT COUNT(*) FROM subscriptions sub WHERE sub.plan_id=p.id AND sub.status='trialing') trialing_stores FROM plans p");
      return rows.map((p:any) => { const limits = typeof p.limits === "string" ? JSON.parse(p.limits) : p.limits || {}; if (!Number.isFinite(Number(limits.email_sends))) limits.email_sends = Number(p.id) === 1 ? 100 : Number(p.id) === 2 ? 1000 : 5000; return { ...p, limits }; });
    }
    if (path[0] === "plans" && path[1] && method === "PATCH") {
      const v = z
        .object({
          name: text,
          monthly_price: z.number().int().min(0).max(100000000),
          limits: z.object({
            products: z.number().int().min(1).max(100000),
            staff: z.number().int().min(1).max(10000),
            storage_mb: z.number().int().min(1).max(1000000),
            email_sends: z.number().int().min(1).max(1000000),
          }),
          trial_days: z.number().int().min(0).max(90).default(14),
        })
        .parse(b);
      const planId = id.parse(path[1]);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows]: any = await c.execute("SELECT id FROM plans WHERE id=? FOR UPDATE",[planId]);
        if (!rows.length) throw new HttpError(404,"Gói dịch vụ không tồn tại.");
        const trialDays = v.trial_days;
        await c.execute("UPDATE plans SET name=?,monthly_price=?,limits=?,trial_days=? WHERE id=?", [v.name,v.monthly_price,JSON.stringify(v.limits),trialDays,planId]);
        await c.execute("INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at,actor_id) VALUES(?,?,?,?,?,UTC_TIMESTAMP(),?)",[planId,v.name, v.monthly_price,JSON.stringify(v.limits),trialDays,actor.id]);
        await c.commit();
      } catch(e) { await c.rollback(); throw e; } finally { c.release(); }
      return resultOK;
    }
    if (path[0] === "users")
      return platformUsers(path.slice(1), method, b, url, actor);
    if (key === "config" && method === "GET")
      return {
        smtp: !!process.env.SMTP_HOST,
        google: !!process.env.GOOGLE_CLIENT_ID,
        goong: !!process.env.GOONG_API_KEY,
        push: !!process.env.VAPID_PRIVATE_KEY,
        storeApprovalRequired: await storeApprovalRequired(),
        billingBank: await platformBank(undefined, true),
        paymentIssues: await query("SELECT provider_event_id,error_message,received_at FROM sepay_webhook_events WHERE processed=0 AND error_message IS NOT NULL ORDER BY id DESC LIMIT 30"),
      };
    throw new HttpError(404, "Không tìm thấy chức năng nền tảng.");
  });
}
