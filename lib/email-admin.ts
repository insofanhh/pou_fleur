import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { pool, query, mutate } from "./db";
import { HttpError, requirePermission } from "./auth";
import {
  emailVariables,
  demoEmailValues,
  interpolateEmail,
  emailHTML,
} from "./email-content";
import {
  emailConfiguration,
  processEmails,
  verifySMTP,
  safeMailError,
} from "./email";

const reviewVersion = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const templateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  subject: z
    .string()
    .trim()
    .min(2)
    .max(240)
    .refine((v) => !/[\r\n]/.test(v), "Tiêu đề chỉ được có một dòng"),
  body: z.string().trim().min(10).max(15000),
  active: z.coerce.number().int().min(0).max(1),
});
const campaignSchema = z.object({
  requestKey: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  templateId: z.coerce.number().int().positive(),
  segment: z.enum(["all", "new", "loyal", "vip", "inactive"]).default("all"),
  customerId: z.coerce.number().int().positive().nullable().default(null),
  birthdayMonth: z.coerce
    .number()
    .int()
    .min(1)
    .max(12)
    .nullable()
    .default(null),
  message: z.string().trim().min(2).max(6000),
  promotionCode: z.string().trim().max(80).default(""),
  eventDate: z.string().trim().max(120).default(""),
});
function validateTemplate(
  t: z.infer<typeof templateSchema>,
  kind: string,
  key = "",
) {
  const combined = t.subject + "\n" + t.body;
  const known = Object.keys(emailVariables).filter((k) =>
    kind === "marketing"
      ? [
          "customer_name",
          "campaign_name",
          "campaign_message",
          "promotion_code",
          "event_date",
        ].includes(k)
      : !k.startsWith("campaign_") &&
        !["promotion_code", "event_date"].includes(k),
  );
  const without = combined.replace(/{{\s*([a-z_]+)\s*}}/g, (_, k) => {
    if (!known.includes(k)) throw new HttpError(400, "Biến không hỗ trợ: " + k);
    return "";
  });
  if (/[{}]/.test(without))
    throw new HttpError(400, "Biến cần có dạng {{customer_name}}.");
  if (kind === "transactional" && !/{{\s*order_reference\s*}}/.test(combined))
    throw new HttpError(400, "Email đơn hàng phải chứa {{order_reference}}.");
  if (key === "order_status" && !/{{\s*order_status\s*}}/.test(combined))
    throw new HttpError(400, "Mẫu cập nhật phải chứa {{order_status}}.");
}
async function audience(
  b: z.infer<typeof campaignSchema>,
  c: { execute: Function },
) {
  const where = [
    "c.marketing_consent=1",
    "NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE s.email=c.email)",
  ];
  const args: any[] = [];
  if (b.segment !== "all") {
    where.push("c.segment=?");
    args.push(b.segment);
  }
  if (b.customerId) {
    where.push("c.id=?");
    args.push(b.customerId);
  }
  if (b.birthdayMonth) {
    where.push("MONTH(c.birthday)=?");
    args.push(b.birthdayMonth);
  }
  const [rows] = await c.execute(
    "SELECT c.id,c.name,c.email FROM customers c WHERE " +
      where.join(" AND ") +
      " ORDER BY c.id LIMIT 501",
    args,
  );
  if (rows.length > 500)
    throw new HttpError(
      400,
      "Tối đa 500 khách mỗi chương trình. Hãy chọn một nhóm nhỏ hơn.",
    );
  return rows as { id: number; name: string; email: string }[];
}
function values(b: z.infer<typeof campaignSchema>, name: string) {
  return {
    customer_name: name,
    campaign_name: b.name,
    campaign_message: b.message,
    promotion_code: b.promotionCode,
    event_date: b.eventDate,
  };
}
export async function emailAdminRead() {
  await requirePermission("emails");
  const [templates, messages, campaigns, customers, stats] = await Promise.all([
    query("SELECT * FROM email_templates ORDER BY kind DESC,id"),
    query(
      "SELECT id,template_key,kind,recipient,subject,status,attempts,last_error,order_id,campaign_id,created_at,sent_at FROM email_outbox ORDER BY id DESC LIMIT 200",
    ),
    query(
      "SELECT c.*,(SELECT COUNT(*) FROM email_outbox m WHERE m.campaign_id=c.id AND m.status='sent') sent_count,(SELECT COUNT(*) FROM email_outbox m WHERE m.campaign_id=c.id AND m.status='pending') pending_count FROM email_campaigns c ORDER BY c.id DESC LIMIT 50",
    ),
    query(
      "SELECT id,name,email,segment,birthday,marketing_consent FROM customers ORDER BY id DESC LIMIT 1000",
    ),
    query("SELECT status,COUNT(*) count FROM email_outbox GROUP BY status"),
  ]);
  return {
    templates,
    messages,
    campaigns,
    customers,
    stats,
    configuration: emailConfiguration(),
    variables: emailVariables,
  };
}
export async function emailAdminAction(
  path: string[],
  method: string,
  body: unknown,
) {
  const actor = await requirePermission("emails");
  const action = path[0];
  if (action === "templates") {
    if (method !== "POST" && method !== "PATCH")
      throw new HttpError(405, "Thao tác không hỗ trợ.");
    await requirePermission("email_templates");
    const b = templateSchema.parse(body);
    let key = "";
    let id: number;
    if (method === "PATCH") {
      id = z.coerce.number().int().positive().parse(path[1]);
      const [t] = await query<any[]>(
        "SELECT * FROM email_templates WHERE id=?",
        [id],
      );
      if (!t) throw new HttpError(404, "Không tìm thấy mẫu.");
      validateTemplate(b, t.kind, t.template_key);
      await mutate(
        "UPDATE email_templates SET name=?,subject=?,body=?,active=? WHERE id=?",
        [b.name, b.subject, b.body, b.active, id],
      );
    } else {
      validateTemplate(b, "marketing");
      key = "crm_" + randomBytes(12).toString("hex");
      const r = await mutate(
        "INSERT INTO email_templates(template_key,name,kind,subject,body,active) VALUES(?,?,'marketing',?,?,?)",
        [key, b.name, b.subject, b.body, b.active],
      );
      id = r.insertId;
    }
    await mutate(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,'save_template','email_templates',?)",
      [actor.id, String(id)],
    );
    return { ok: true, id };
  }
  if (method !== "POST") throw new HttpError(405, "Thao tác không hỗ trợ.");
  if (action === "preview-template") {
    await requirePermission("email_templates");
    const b = templateSchema.parse(body);
    return {
      subject: interpolateEmail(b.subject, demoEmailValues),
      html: emailHTML(interpolateEmail(b.body, demoEmailValues)),
    };
  }
  if (action === "verify") {
    await requirePermission("email_templates");
    try {
      return await verifySMTP();
    } catch (e) {
      throw new HttpError(
        400,
        "Không kết nối được SMTP: " +
          safeMailError(e) +
          ". Kiểm tra cấu hình môi trường.",
      );
    }
  }
  if (action === "process") return processEmails();
  if (action === "message") {
    const id = z.coerce.number().int().positive().parse(path[1]);
    const [mail] = await query<any[]>(
      "SELECT subject,body FROM email_outbox WHERE id=?",
      [id],
    );
    if (!mail) throw new HttpError(404, "Không tìm thấy email.");
    return { subject: mail.subject, html: emailHTML(mail.body) };
  }
  if (action === "retry") {
    const id = z.coerce.number().int().positive().parse(path[1]);
    const result = await mutate(
      "UPDATE email_outbox SET status='pending',attempts=0,next_attempt_at=NOW(),last_error=NULL WHERE id=? AND status='failed'",
      [id],
    );
    if (!result.affectedRows)
      throw new HttpError(
        400,
        "Chỉ thử lại email bị SMTP từ chối. Email chưa rõ kết quả cần kiểm tra hộp thư SMTP trước.",
      );
    await mutate(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,'retry','email_outbox',?)",
      [actor.id, String(id)],
    );
    return { ok: true };
  }
  if (action === "cancel-campaign") {
    await requirePermission("crm");
    const id = z.coerce.number().int().positive().parse(path[1]);
    await mutate(
      "UPDATE email_outbox SET status='cancelled',last_error='CANCELLED_BY_STAFF' WHERE campaign_id=? AND status IN ('pending','failed')",
      [id],
    );
    await mutate(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,'cancel','email_campaigns',?)",
      [actor.id, String(id)],
    );
    return { ok: true };
  }
  if (action === "preview-campaign" || action === "campaigns") {
    await requirePermission("crm");
    const b = campaignSchema.parse(body);
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [templates] = await c.execute(
        "SELECT * FROM email_templates WHERE id=? AND kind='marketing' AND active=1 FOR UPDATE",
        [b.templateId],
      );
      const t = (templates as any[])[0];
      if (!t) throw new HttpError(400, "Chọn một mẫu CRM đang bật.");
      const customers = await audience(b, c);
      if (action === "preview-campaign") {
        await c.commit();
        return {
          count: customers.length,
          recipients: customers.map((v) => ({
            id: v.id,
            name: v.name,
            email: v.email,
          })),
          subject: interpolateEmail(
            t.subject,
            values(b, customers[0]?.name || "Khách hàng"),
          ),
          html: emailHTML(
            interpolateEmail(
              t.body,
              values(b, customers[0]?.name || "Khách hàng"),
            ),
          ),
          templateVersion: reviewVersion([t.subject, t.body, t.active]),
          audienceVersion: reviewVersion(customers),
        };
      }
      if (!customers.length)
        throw new HttpError(
          400,
          "Không có khách phù hợp đã đồng ý nhận email.",
        );
      const config = emailConfiguration();
      if (!config.enabled || !config.ready)
        throw new HttpError(
          400,
          "Hãy cấu hình SMTP và bật EMAIL_ENABLED trước khi gửi chương trình.",
        );
      // A reviewed audience and template version are required, preventing stale previews.
      const approved = z
        .object({
          recipientIds: z.array(z.number().int().positive()).max(500),
          templateVersion: z.string(),
          audienceVersion: z.string(),
        })
        .parse(body);
      if (
        JSON.stringify(approved.recipientIds) !==
          JSON.stringify(customers.map((v) => v.id)) ||
        reviewVersion([t.subject, t.body, t.active]) !==
          approved.templateVersion ||
        reviewVersion(customers) !== approved.audienceVersion
      )
        throw new HttpError(
          409,
          "Danh sách khách hoặc mẫu đã thay đổi. Hãy xem trước lại.",
        );
      const [existing] = await c.execute(
        "SELECT id,audience FROM email_campaigns WHERE request_key=?",
        [b.requestKey],
      );
      const signature = JSON.stringify(b);
      if ((existing as any[])[0]) {
        const previous = (existing as any[])[0];
        if (previous.audience !== signature)
          throw new HttpError(
            409,
            "Yêu cầu này đã được dùng cho nội dung khác.",
          );
        await c.commit();
        return { ok: true, id: previous.id };
      }
      const [result] = await c.execute(
        "INSERT INTO email_campaigns(request_key,name,template_id,audience,recipient_count,created_by) VALUES(?,?,?,?,?,?)",
        [
          b.requestKey,
          b.name,
          b.templateId,
          signature,
          customers.length,
          actor.id,
        ],
      );
      const id = (result as any).insertId;
      for (const customer of customers)
        await c.execute(
          "INSERT INTO email_outbox(dedupe_key,template_key,kind,recipient,customer_id,campaign_id,subject,body,unsubscribe_token) VALUES(?,?,'marketing',?,?,?,?,?,?)",
          [
            "campaign:" + id + ":" + customer.id,
            t.template_key,
            customer.email,
            customer.id,
            id,
            interpolateEmail(t.subject, values(b, customer.name))
              .replace(/[\r\n]/g, " ")
              .slice(0, 500),
            interpolateEmail(t.body, values(b, customer.name)),
            randomBytes(32).toString("hex"),
          ],
        );
      await c.execute(
        "INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES(?,'queue_campaign','email_campaigns',?)",
        [actor.id, String(id)],
      );
      await c.commit();
      return { ok: true, id, queued: customers.length };
    } catch (e) {
      await c.rollback();
      if ((e as { code?: string }).code === "ER_DUP_ENTRY")
        throw new HttpError(
          409,
          "Yêu cầu đang được xử lý. Hãy làm mới lịch sử chương trình.",
        );
      throw e;
    } finally {
      c.release();
    }
  }
  throw new HttpError(404, "Không tìm thấy chức năng email.");
}
