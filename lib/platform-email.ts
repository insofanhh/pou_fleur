import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool, query, mutate } from "./db";
import { HttpError } from "./auth";
import { withSystem } from "./tenant";
import {
  templateSchema,
  campaignSchema,
  reviewVersion,
  validateTemplate,
} from "./email-admin";
import {
  emailConfiguration,
  verifySMTP,
  safeMailError,
  processAllStoreEmails,
} from "./email";
import { processIdentityMail } from "./identity-mail";
import { emailHTML, interpolateEmail } from "./email-content";
import defaults from "./email-defaults.json";

const cid = z.coerce.number().int().positive();
const campaignInput = campaignSchema.extend({
  segment: z.enum(["all", "owners", "trialing"]).default("all"),
});
const systemFilter =
  "(LEFT(template_key,13)='subscription_' OR LEFT(template_key,6)='store_')";
const history = `SELECT CONCAT('account-',id) id,template_key,kind,recipient,subject,status,1 attempts,last_error,created_at,sent_at FROM identity_mail
  UNION ALL SELECT CONCAT('store-',id) id,template_key,kind,recipient,subject,status,attempts,last_error,created_at,sent_at FROM email_outbox WHERE ${systemFilter}`;
const required: Record<string, string[]> = {
  account_welcome: ["account_url"],
  account_password_reset: ["reset_url"],
  store_registration_pending: ["store_name", "workspace_url"],
  store_approved: ["store_name", "workspace_url"],
};
function validate(
  t: z.infer<typeof templateSchema>,
  kind: string,
  key: string,
) {
  validateTemplate(t, kind);
  const original = defaults.find((v) => v.key === key);
  const allowed = new Set(
    (original?.subject + "\n" + original?.body)
      .match(/{{\s*[a-z_]+\s*}}/g)
      ?.map((v) => v.replace(/[{}\s]/g, "")),
  );
  const text = t.subject + "\n" + t.body;
  for (const [, v] of text.matchAll(/{{\s*([a-z_]+)\s*}}/g))
    if (kind === "transactional" && !allowed.has(v))
      throw new HttpError(400, "Biến không có dữ liệu cho mẫu này: " + v);
  const essentials =
    required[key] ||
    (key.startsWith("subscription_")
      ? [
          "plan_name",
          "billing_url",
          ...(original?.body.includes("{{invoice_reference}}")
            ? ["invoice_reference"]
            : []),
          ...(original?.body.includes("{{invoice_period_end}}")
            ? ["invoice_period_end"]
            : []),
          ...["invoice_period_start", "invoice_due_date", "trial_days"].filter(
            (v) => original?.body.includes("{{" + v + "}}"),
          ),
        ]
      : []);
  // Suspension and trial expiry have no plan_name data in their original copy.
  for (const v of essentials.filter((v) => allowed.has(v)))
    if (!new RegExp("{{\\s*" + v + "\\s*}}").test(text))
      throw new HttpError(400, "Mẫu cần giữ biến {{" + v + "}}.");
  if (kind === "transactional" && !t.active)
    throw new HttpError(400, "Email nghiệp vụ hệ thống phải luôn được bật.");
}
async function audience(
  b: z.infer<typeof campaignInput>,
  c: { execute: Function },
) {
  const clauses = ["u.active=1", "u.marketing_consent=1"],
    args: any[] = [];
  if (b.segment !== "all")
    clauses.push(
      "EXISTS(SELECT 1 FROM stores s " +
        (b.segment === "trialing"
          ? "JOIN subscriptions sub ON sub.store_id=s.id AND sub.status='trialing' "
          : "") +
        "WHERE s.owner_id=u.id)",
    );
  if (b.customerId) {
    clauses.push("u.id=?");
    args.push(b.customerId);
  }
  if (b.birthdayMonth) {
    clauses.push("MONTH(u.birthday)=?");
    args.push(b.birthdayMonth);
  }
  const [rows]: any = await c.execute(
    "SELECT u.id,u.name,u.email FROM users u WHERE " +
      clauses.join(" AND ") +
      " ORDER BY u.id LIMIT 501",
    args,
  );
  if (rows.length > 500)
    throw new HttpError(
      400,
      "Tối đa 500 tài khoản mỗi chương trình. Hãy thu hẹp nhóm nhận.",
    );
  return rows as { id: number; name: string; email: string }[];
}
function values(b: z.infer<typeof campaignInput>, name: string) {
  return {
    customer_name: name,
    store_name: "Fleurious Platform",
    store_url: process.env.APP_ORIGIN || "",
    campaign_name: b.name,
    campaign_message: b.message,
    promotion_code: b.promotionCode,
    event_date: b.eventDate,
  };
}

// The caller must authenticate with platformActor before entering this service.
export async function platformEmails(
  path: string[],
  method: string,
  body: any,
  actor: number,
) {
  return withSystem(async () => {
    const audit = async (action: string, target: number) =>
      mutate(
        "INSERT INTO platform_audit_logs(actor_id,action,metadata) VALUES(?,?,?)",
        [actor, action, JSON.stringify({ id: target })],
      );
    if (!path.length && method === "GET") {
      const [templates, messages, campaigns, customers, stats] =
        await Promise.all([
          query("SELECT * FROM platform_email_templates ORDER BY kind DESC,id"),
          query(
            `SELECT * FROM (${history}) h ORDER BY created_at DESC,id DESC LIMIT 200`,
          ),
          query(
            "SELECT c.*,(SELECT COUNT(*) FROM identity_mail m WHERE m.campaign_id=c.id AND m.status='sent') sent_count,(SELECT COUNT(*) FROM identity_mail m WHERE m.campaign_id=c.id AND m.status='pending') pending_count FROM platform_email_campaigns c ORDER BY id DESC LIMIT 50",
          ),
          query(
            "SELECT id,name,email,marketing_consent FROM users WHERE active=1 AND marketing_consent=1 ORDER BY id DESC LIMIT 1000",
          ),
          query(
            `SELECT status,COUNT(*) count FROM (${history}) h GROUP BY status`,
          ),
        ]);
      return {
        templates: (templates as any[]).map((t) => {
          const original = defaults.find((d) => d.key === t.template_key);
          return {
            ...t,
            variables: [
              ...new Set(
                ((original?.subject || "") + "\n" + (original?.body || ""))
                  .match(/{{\s*[a-z_]+\s*}}/g)
                  ?.map((v) => v.replace(/[{}\s]/g, "")),
              ),
            ],
          };
        }),
        messages,
        campaigns,
        customers,
        stats,
        configuration: emailConfiguration(),
        audienceSegments: [
          ["all", "Tất cả tài khoản đồng ý nhận tin"],
          ["owners", "Chủ cửa hàng đồng ý nhận tin"],
          ["trialing", "Chủ cửa hàng đang dùng thử"],
        ],
      };
    }
    if (path[0] === "templates" && ["POST", "PATCH"].includes(method)) {
      const b = templateSchema.parse(body);
      let id: number;
      if (method === "PATCH") {
        id = cid.parse(path[1]);
        const [t] = await query<any[]>(
          "SELECT * FROM platform_email_templates WHERE id=?",
          [id],
        );
        if (!t) throw new HttpError(404, "Không tìm thấy mẫu email.");
        validate(b, t.kind, t.template_key);
        const version = cid.parse(body.version);
        const r = await mutate(
          "UPDATE platform_email_templates SET name=?,subject=?,body=?,active=?,version=version+1 WHERE id=? AND version=?",
          [b.name, b.subject, b.body, b.active, id, version],
        );
        if (!r.affectedRows)
          throw new HttpError(409, "Mẫu đã thay đổi. Hãy làm mới rồi sửa lại.");
      } else {
        validate(b, "marketing", "");
        id = (
          await mutate(
            "INSERT INTO platform_email_templates(template_key,name,kind,subject,body,active) VALUES(?,?,'marketing',?,?,?)",
            [
              "platform_" + randomBytes(12).toString("hex"),
              b.name,
              b.subject,
              b.body,
              b.active,
            ],
          )
        ).insertId;
      }
      await audit("platform_email_template_saved", id);
      const [t] = await query<any[]>(
        "SELECT version FROM platform_email_templates WHERE id=?",
        [id],
      );
      return { ok: true, id, version: t.version };
    }
    if (method !== "POST")
      throw new HttpError(405, "Thao tác email không hỗ trợ.");
    if (path[0] === "verify") {
      try {
        return await verifySMTP();
      } catch (e) {
        throw new HttpError(
          400,
          "Không kết nối được SMTP: " + safeMailError(e),
        );
      }
    }
    if (path[0] === "process") {
      const deadline = Date.now() + 45000;
      const a = await processIdentityMail(),
        b = await processAllStoreEmails(deadline);
      return { processed: a.processed + b.processed };
    }
    if (["message", "retry"].includes(path[0])) {
      const match = /^(account|store)-(\d+)$/.exec(path[1] || "");
      if (!match) throw new HttpError(404, "Không tìm thấy email.");
      const id = cid.parse(match[2]),
        table = match[1] === "account" ? "identity_mail" : "email_outbox";
      const [m] = await query<any[]>(
        `SELECT * FROM ${table} WHERE id=?${match[1] === "store" ? " AND " + systemFilter : ""}`,
        [id],
      );
      if (!m) throw new HttpError(404, "Không tìm thấy email hệ thống.");
      if (path[0] === "message")
        return {
          subject: m.subject,
          html: emailHTML(
            m.template_key === "account_password_reset"
              ? "Nội dung khôi phục mật khẩu được ẩn để bảo vệ tài khoản."
              : m.body,
          ),
        };
      if (m.status !== "failed" || m.template_key === "account_password_reset")
        throw new HttpError(
          400,
          "Chỉ thử lại thư bị từ chối rõ ràng. Liên kết mật khẩu cần được yêu cầu mới.",
        );
      await mutate(
        `UPDATE ${table} SET status='pending',last_error=NULL${table === "email_outbox" ? ",attempts=0,next_attempt_at=NOW()" : ""} WHERE id=? AND status='failed'`,
        [id],
      );
      await audit("platform_email_retried", id);
      return { ok: true };
    }
    if (path[0] === "cancel-campaign") {
      const id = cid.parse(path[1]);
      await mutate(
        "UPDATE identity_mail SET status='cancelled',last_error='CANCELLED_BY_PLATFORM' WHERE campaign_id=? AND status IN ('pending','failed')",
        [id],
      );
      await audit("platform_email_campaign_cancelled", id);
      return { ok: true };
    }
    if (["preview-campaign", "campaigns"].includes(path[0])) {
      const b = campaignInput.parse(body),
        c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [templates]: any = await c.execute(
          "SELECT * FROM platform_email_templates WHERE id=? AND active=1 AND kind='marketing' FOR UPDATE",
          [b.templateId],
        );
        const t = templates[0];
        if (!t) throw new HttpError(400, "Chọn mẫu chương trình đang bật.");
        const people = await audience(b, c),
          tv = reviewVersion([t.subject, t.body, t.active]),
          av = reviewVersion(people);
        if (path[0] === "preview-campaign") {
          await c.commit();
          return {
            count: people.length,
            recipients: people,
            subject: interpolateEmail(
              t.subject,
              values(b, people[0]?.name || "bạn"),
            ),
            html: emailHTML(
              interpolateEmail(t.body, values(b, people[0]?.name || "bạn")),
              "https://example.com/unsubscribe",
            ),
            templateVersion: tv,
            audienceVersion: av,
          };
        }
        if (!people.length)
          throw new HttpError(
            400,
            "Không có tài khoản phù hợp đã đồng ý nhận tin.",
          );
        const cfg = emailConfiguration();
        if (!cfg.enabled || !cfg.ready)
          throw new HttpError(400, "SMTP hệ thống chưa sẵn sàng.");
        if (
          body.templateVersion !== tv ||
          body.audienceVersion !== av ||
          JSON.stringify(body.recipientIds) !==
            JSON.stringify(people.map((p) => p.id))
        )
          throw new HttpError(
            409,
            "Nội dung hoặc danh sách người nhận đã đổi. Hãy xem trước lại.",
          );
        const signature = JSON.stringify(b);
        const [existing]: any = await c.execute(
          "SELECT id,audience FROM platform_email_campaigns WHERE request_key=?",
          [b.requestKey],
        );
        if (existing[0]) {
          if (existing[0].audience !== signature)
            throw new HttpError(409, "Yêu cầu đã được dùng với nội dung khác.");
          await c.commit();
          return { ok: true, id: existing[0].id };
        }
        const [r]: any = await c.execute(
          "INSERT INTO platform_email_campaigns(request_key,name,template_id,audience,recipient_count,created_by) VALUES(?,?,?,?,?,?)",
          [b.requestKey, b.name, t.id, signature, people.length, actor],
        );
        for (const p of people)
          await c.execute(
            "INSERT INTO identity_mail(user_id,template_key,dedupe_key,kind,campaign_id,recipient,subject,body,unsubscribe_token) VALUES(?,?,?,'marketing',?,?,?,?,?)",
            [
              p.id,
              t.template_key,
              `campaign:${r.insertId}:${p.id}`,
              r.insertId,
              p.email,
              interpolateEmail(t.subject, values(b, p.name))
                .replace(/[\r\n]/g, " ")
                .slice(0, 240),
              interpolateEmail(t.body, values(b, p.name)),
              randomBytes(32).toString("hex"),
            ],
          );
        await c.execute(
          "INSERT INTO platform_audit_logs(actor_id,action,metadata) VALUES(?,'platform_email_campaign_queued',?)",
          [actor, JSON.stringify({ id: r.insertId, count: people.length })],
        );
        await c.commit();
        return { ok: true, id: r.insertId, queued: people.length };
      } catch (e) {
        await c.rollback();
        if ((e as any).code === "ER_DUP_ENTRY")
          throw new HttpError(
            409,
            "Yêu cầu đang xử lý. Hãy làm mới chương trình.",
          );
        throw e;
      } finally {
        c.release();
      }
    }
    throw new HttpError(404, "Không tìm thấy chức năng email.");
  });
}
