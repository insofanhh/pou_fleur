import { z } from "zod";
import { currentUser, ghostContext, HttpError } from "./auth";
import { pool } from "./db";
import { withSystem } from "./tenant";

export async function recordActivity(body: unknown) {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Vui lòng đăng nhập.");
  const { store_id: sid } = z
    .object({ store_id: z.number().int().positive().optional() })
    .strict()
    .parse(body);
  // Support sessions must not make a customer/store appear active.
  if (await ghostContext()) return { ok: true };
  return withSystem(async () => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      if (sid) {
        const [members]: any = await c.execute(
          "SELECT user_id FROM store_memberships WHERE store_id=? AND user_id=? AND status='active'",
          [sid, user.id],
        );
        if (!members.length)
          throw new HttpError(403, "Bạn không thuộc cửa hàng này.");
      }
      await c.execute(
        "INSERT INTO account_activity(user_id,last_seen_at) VALUES(?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE last_seen_at=IF(last_seen_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 60 SECOND),UTC_TIMESTAMP(),last_seen_at)",
        [user.id],
      );
      if (sid)
        await c.execute(
          "INSERT INTO workspace_activity(store_id,user_id,last_seen_at) VALUES(?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE last_seen_at=IF(last_seen_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 60 SECOND),UTC_TIMESTAMP(),last_seen_at)",
          [sid, user.id],
        );
      await c.commit();
      return { ok: true };
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  });
}
