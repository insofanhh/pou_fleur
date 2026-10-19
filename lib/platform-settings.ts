import { query, mutate, pool } from "./db";
import { activateApprovedStore } from "./billing";
import { enqueueStoreLifecycleEmail } from './email';

const STORE_APPROVAL_KEY = "store_approval_required";

export async function storeApprovalRequired() {
  const [setting] = await query<any[]>(
    "SELECT setting_value FROM platform_settings WHERE setting_key=?",
    [STORE_APPROVAL_KEY],
  );
  return setting ? String(setting.setting_value) === "1" : false;
}

export async function setStoreApprovalRequired(
  required: boolean,
  actorId: number,
) {
  await mutate(
    "INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES(?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)",
    [STORE_APPROVAL_KEY, required ? "1" : "0", actorId],
  );
  if (required)
    await mutate(
      "UPDATE stores SET status='pending',version=version+1 WHERE status='draft'",
    );
  else {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [stores]: any = await c.execute(
        "SELECT id FROM stores WHERE status IN ('draft','pending') FOR UPDATE",
      );
      for (const store of stores) {
        await c.execute(
          "UPDATE stores SET status='approved',version=version+1 WHERE id=?",
          [store.id],
        );
        await activateApprovedStore(c, store.id);
        await enqueueStoreLifecycleEmail(c,store.id,'store_approved');
      }
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  return required;
}
