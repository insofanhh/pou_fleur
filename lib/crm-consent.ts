import { z } from "zod";
import { HttpError } from "./auth";
import { pool } from "./db";
import { tenantId } from "./tenant";

// The caller must require the store's CRM permission before recording consent.
export async function updateCustomerMarketingConsent(
  id: number,
  actorId: number,
  body: unknown,
) {
  const b = z
    .object({
      consent: z.boolean(),
      previousConsent: z.boolean(),
      confirmed: z.boolean().default(false),
      note: z.string().trim().max(500).default(""),
    })
    .parse(body);
  if (b.consent && !b.confirmed)
    throw new HttpError(
      400,
      "Cần xác nhận khách đã đồng ý nhận tiếp thị từ cửa hàng.",
    );
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows]: any = await c.execute(
      "SELECT id,email,marketing_consent FROM customers WHERE id=? FOR UPDATE",
      [id],
    );
    const customer = rows[0];
    if (!customer)
      throw new HttpError(404, "Không tìm thấy khách hàng trong cửa hàng.");
    const previous = !!customer.marketing_consent;
    if (previous !== b.previousConsent)
      throw new HttpError(
        409,
        "Trạng thái tiếp thị đã thay đổi. Hãy tải lại hồ sơ khách hàng.",
      );
    if (b.consent && !customer.email)
      throw new HttpError(400, "Khách chưa có email để nhận tiếp thị.");
    if (previous === b.consent) {
      await c.commit();
      return { ok: true };
    }
    await c.execute("UPDATE customers SET marketing_consent=? WHERE id=?", [
      b.consent ? 1 : 0,
      id,
    ]);
    if (customer.email) {
      // Scope preferences explicitly; account/platform preferences stay independent.
      await c.execute(
        "INSERT INTO notification_preferences(user_id,store_id,marketing,push) SELECT id,?,?,0 FROM users WHERE email=? ON DUPLICATE KEY UPDATE marketing=VALUES(marketing)",
        [tenantId(), b.consent ? 1 : 0, customer.email],
      );
      if (b.consent)
        await c.execute("DELETE FROM email_suppressions WHERE email=?", [
          customer.email,
        ]);
      else
        await c.execute(
          "INSERT IGNORE INTO email_suppressions(email) VALUES(?)",
          [customer.email],
        );
    }
    if (!b.consent)
      await c.execute(
        "UPDATE email_outbox SET status='cancelled',last_error='CONSENT_WITHDRAWN' WHERE customer_id=? AND kind='marketing' AND status IN ('pending','failed')",
        [id],
      );
    const description =
      (b.consent
        ? "Ghi nhận thủ công: khách đã đồng ý nhận tiếp thị từ cửa hàng."
        : "Ghi nhận thủ công: ngừng nhận tiếp thị từ cửa hàng.") +
      (b.note ? "\n" + b.note : "");
    await c.execute(
      "INSERT INTO crm_notes(customer_id,author_id,content) VALUES(?,?,?)",
      [id, actorId, description],
    );
    await c.execute(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,'marketing_consent','crm',?,?)",
      [
        actorId,
        String(id),
        JSON.stringify({
          source: "manual",
          previous,
          consent: b.consent,
          confirmed: b.confirmed,
          note: b.note,
        }),
      ],
    );
    await c.commit();
    return { ok: true };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
