import { query, mutate } from "./db";

const STORE_APPROVAL_KEY = "store_approval_required";

export async function storeApprovalRequired() {
  const [setting] = await query<any[]>(
    "SELECT setting_value FROM platform_settings WHERE setting_key=?",
    [STORE_APPROVAL_KEY],
  );
  return setting ? String(setting.setting_value) === "1" : false;
}

export async function setStoreApprovalRequired(required: boolean, actorId: number) {
  await mutate(
    "INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES(?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)",
    [STORE_APPROVAL_KEY, required ? "1" : "0", actorId],
  );
  await mutate(
    required
      ? "UPDATE stores SET status='pending' WHERE status='draft'"
      : "UPDATE stores SET status='approved' WHERE status IN ('draft','pending')",
  );
  return required;
}
