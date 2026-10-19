import { createHash } from "node:crypto";
import { HttpError } from "./auth";

type Connection = { execute: (sql: string, values?: any[]) => Promise<any> };
type Identity = { kind: string; value: string };
export const registrationConflict =
  "Tài khoản, email hoặc số điện thoại này đã được dùng để mở cửa hàng. Mỗi tài khoản chỉ được mở một cửa hàng.";

export function normalizeStorePhone(value: string) {
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) return "";
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = "84" + digits.slice(1);
  if (!/^[1-9]\d{8,14}$/.test(digits)) return "";
  if (digits.startsWith("84") && !/^84[1-9]\d{8,9}$/.test(digits)) return "";
  return digits;
}
function identities(user: any, phone?: string): Identity[] {
  const result = [
    { kind: "account", value: String(user.id) },
    { kind: "email", value: String(user.email).trim().toLowerCase() },
  ];
  for (const value of new Set([user.phone, phone].filter(Boolean).map(normalizeStorePhone)))
    if (value) result.push({ kind: "phone", value });
  return result;
}
const identityHash = (identity: Identity) =>
  createHash("sha256").update(identity.kind + ":" + identity.value).digest("hex");

// Also check current contacts on older stores, including contacts edited after
// migration. Registration claims retain the original identity after later edits.
const phoneSQL = (column: string) => {
  const digits = `REGEXP_REPLACE(COALESCE(${column},''),'[^0-9]','')`;
  return `CASE WHEN ${digits} LIKE '00%' THEN SUBSTRING(${digits},3) WHEN ${digits} LIKE '0%' THEN CONCAT('84',SUBSTRING(${digits},2)) ELSE ${digits} END`;
};

export async function storeRegistrationAvailability(c: Connection, userId: number, phone?: string, lock = false) {
  const [users] = await c.execute(
    "SELECT id,email,phone FROM users WHERE id=? AND active=1" + (lock ? " FOR UPDATE" : ""),
    [userId],
  );
  const user = users[0];
  if (!user) throw new HttpError(401, "Vui lòng đăng nhập lại.");
  const keys = identities(user, phone);
  const phones = keys.filter(k => k.kind === "phone").map(k => k.value);
  const [stores] = await c.execute(
    `SELECT s.id,s.name,s.status,s.owner_id FROM stores s JOIN users u ON u.id=s.owner_id
     WHERE s.owner_id=? OR LOWER(TRIM(u.email))=?${phones.length ? ` OR ${phoneSQL("s.phone")} IN (${phones.map(() => "?").join(",")}) OR ${phoneSQL("u.phone")} IN (${phones.map(() => "?").join(",")})` : ""}
     ORDER BY (s.owner_id=?) DESC,s.id LIMIT 1`,
    [user.id, String(user.email).trim().toLowerCase(), ...phones, ...phones, user.id],
  );
  const [claims] = await c.execute(
    `SELECT identity_key FROM store_registration_claims WHERE identity_key IN (${keys.map(() => "?").join(",")}) LIMIT 1`,
    keys.map(identityHash),
  );
  const ownStore = stores[0]?.owner_id === user.id ? stores[0] : undefined;
  return {
    eligible: !stores.length && !claims.length,
    message: stores.length || claims.length ? registrationConflict : "",
    // Never disclose another account's store or contact details.
    store: ownStore ? { id: ownStore.id, name: ownStore.name, status: ownStore.status } : null,
    identities: keys,
  };
}

export async function reserveStoreRegistration(c: Connection, userId: number, phone: string) {
  const availability = await storeRegistrationAvailability(c, userId, phone, true);
  if (!availability.eligible) throw new HttpError(409, registrationConflict);
  // Unique keys, in a fixed order, arbitrate parallel registrations across
  // different accounts sharing an email/phone. The entire operation rolls back
  // together with the store, subscription and email outbox on any failure.
  for (const key of availability.identities.sort((a, b) => identityHash(a).localeCompare(identityHash(b)))) {
    try {
      await c.execute(
        "INSERT INTO store_registration_claims(identity_key,identity_type,user_id) VALUES(?,?,?)",
        [identityHash(key), key.kind, userId],
      );
    } catch (error: any) {
      if (error.code === "ER_DUP_ENTRY") throw new HttpError(409, registrationConflict);
      throw error;
    }
  }
}
