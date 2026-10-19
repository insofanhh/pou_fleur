import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "./db";
import { HttpError } from "./auth";
import { recordOrderPayment } from "./order-payments";
import { withStore, withSystem } from "./tenant";
import { recordInvoicePayment, expirePlanChangeRequests } from "./billing";
import { parseDateTime } from "./date-time";

export type BankConfig = {
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  enabled: boolean;
  sepay_enabled: boolean;
  auto_confirm_status: string;
};

export function transferCode(kind: "order" | "subscription", id: number) {
  return `FLR-${kind === "order" ? "ORD" : "SUB"}-${id}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function vietQrUrl(bank: BankConfig, amount: number, code: string) {
  const params = new URLSearchParams({ amount: String(Math.round(amount)), addInfo: code, accountName: bank.account_holder });
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bank_code)}-${encodeURIComponent(bank.account_number)}-compact2.png?${params}`;
}

export type SepayCredentials = { webhook_secret: string; api_key: string; enabled: boolean };

export async function sepayCredentials(c?: any): Promise<SepayCredentials | null> {
  const runner = c || pool;
  const [rows]: any = await runner.execute("SELECT webhook_secret,api_key,enabled FROM platform_integrations WHERE provider='sepay' LIMIT 1");
  return rows[0] || null;
}

export async function activeBank(storeId: number, c?: any): Promise<BankConfig | null> {
  const runner = c || pool;
  const [rows]: any = await runner.execute("SELECT bank_code,bank_name,account_number,account_holder,enabled,sepay_enabled,auto_confirm_status FROM store_bank_accounts WHERE store_id=? AND enabled=1", [storeId]);
  return rows[0] || null;
}

// Subscription fees go to the platform, never to the merchant's own account.
export async function platformBank(c?: any, includeDisabled = false): Promise<BankConfig | null> {
  const [rows]: any = await (c || pool).execute("SELECT setting_value FROM platform_settings WHERE setting_key='billing_bank'");
  const bank = rows[0] ? JSON.parse(rows[0].setting_value) : null;
  return bank && (bank.enabled || includeDisabled) ? bank : null;
}

export async function createIntent(c: any, storeId: number, kind: "order" | "subscription", ownerId: number, amount: number, orderId: number | null, invoiceId: number | null, bank: BankConfig, validUntil?: string) {
  if (kind === "subscription") {
    // Serialize requests on the invoice, and reuse its immutable payment session.
    const [invoices]: any = await withStore(storeId, () => c.execute("SELECT id,status FROM invoices WHERE store_id=? AND id=? FOR UPDATE", [storeId, invoiceId]));
    if (invoices[0]?.status !== "open") throw new HttpError(409, "Hóa đơn không còn chờ thanh toán.");
    const [existing]: any = await withStore(storeId, () => c.execute("SELECT * FROM payment_intents WHERE store_id=? AND invoice_id=? AND kind='subscription' ORDER BY id DESC LIMIT 1 FOR UPDATE", [storeId, invoiceId]));
    if (existing[0]) {
      const intent = existing[0];
      if (intent.status !== "pending") throw new HttpError(409, "Yêu cầu thanh toán đã đóng.");
      const qr = typeof intent.qr_payload === "string" ? JSON.parse(intent.qr_payload) : intent.qr_payload;
      const savedBank = { ...bank, bank_code: qr.bankCode, account_number: qr.accountNumber, account_holder: qr.accountHolder };
      return { id: intent.id, code: intent.reference_code, amount, expiresAt: intent.expires_at.replace(" ", "T") + "Z", qrUrl: vietQrUrl(savedBank, amount, intent.reference_code), bank: savedBank };
    }
  }
  const code = transferCode(kind, kind === "order" ? orderId! : invoiceId!);
  const payload = JSON.stringify({ bankCode: bank.bank_code, accountNumber: bank.account_number, accountHolder: bank.account_holder, amount, addInfo: code });
  const [r]: any = await withStore(storeId, () => c.execute("INSERT INTO payment_intents(order_id,invoice_id,kind,reference_code,amount,expires_at,qr_payload) VALUES(?,?,?,?,?,LEAST(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE),COALESCE(?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE))),?)", [orderId, invoiceId, kind, code, amount, validUntil || null, payload]));
  const [rows]: any = await withStore(storeId, () => c.execute("SELECT expires_at FROM payment_intents WHERE id=?", [r.insertId]));
  return { id: r.insertId, code, amount, expiresAt: rows[0].expires_at.replace(" ","T")+"Z", qrUrl: vietQrUrl(bank, amount, code), bank };
}

export function verifyWebhook(raw: string, headers: Headers, credentials?: SepayCredentials | null) {
  if (credentials && !credentials.enabled) throw new HttpError(503, "Webhook SePay đang bị vô hiệu hóa.");
  const secret = credentials?.webhook_secret || process.env.SEPAY_WEBHOOK_SECRET;
  const apiKey = credentials?.api_key;
  if (!credentials?.enabled && !process.env.SEPAY_WEBHOOK_SECRET && process.env.NODE_ENV === "production") throw new HttpError(503, "Webhook SePay chưa được tạo trong Platform.");
  const suppliedApiKey = headers.get("x-api-key") || headers.get("x-sepay-api-key") || headers.get("authorization")?.replace(/^(?:Bearer|Api-Key|Apikey)\s+/i, "");
  if (apiKey && suppliedApiKey && suppliedApiKey === apiKey) return true;
  if (!secret) return false;
  const supplied = headers.get("x-sepay-signature") || headers.get("x-signature") || headers.get("authorization")?.replace(/^HMAC\s+/i, "") || "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(supplied.replace(/^sha256=/i, "").trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseWebhook(body: any) {
  const amount = Number(body.transferAmount ?? body.amount ?? body.amount_in ?? 0);
  const direction = String(body.transferType ?? body.type ?? "in").toLowerCase();
  const eventId = String(body.id ?? body.referenceCode ?? body.reference ?? "");
  const content = String(body.content ?? body.description ?? body.code ?? "");
  if (!eventId || !Number.isFinite(amount) || amount <= 0 || !["in", "incoming", "credit"].includes(direction)) throw new HttpError(400, "Dữ liệu giao dịch SePay không hợp lệ.");
  const match = content.match(/FLR-(?:ORD|SUB)-\d+-[A-Z0-9]+/i);
  if (!match) throw new HttpError(400, "Không tìm thấy mã thanh toán Fleurious.");
  let receivedAt: string | undefined;
  if (body.transactionDate) {
    const value = String(body.transactionDate);
    const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : value.replace(' ', 'T') + '+07:00');
    if (!Number.isFinite(date.getTime())) throw new HttpError(400,"Thời điểm giao dịch không hợp lệ.");
    receivedAt = date.toISOString().slice(0,19).replace('T',' ');
  }
  return { eventId, receivedAt, amount: Math.round(amount), code: match[0].toUpperCase(), providerReference: String(body.referenceCode ?? body.transactionCode ?? eventId) };
}

export async function processWebhook(raw: string, body: any, headers: Headers) {
  const credentials = await sepayCredentials();
  if (!verifyWebhook(raw, headers, credentials)) throw new HttpError(401, "API key hoặc chữ ký SePay không hợp lệ.");
  const parsed = parseWebhook(body);
  const hash = createHash("sha256").update(raw).digest("hex");
  // Commit timeout cleanup separately: a rejected late transfer must not roll
  // back expiration. The ledger checks the same deadline again under its lock.
  await withSystem(async () => {
    const [rows]: any = await pool.execute("SELECT store_id FROM payment_intents WHERE reference_code=? AND kind='subscription'", [parsed.code]);
    if (rows[0]) await expirePlanChangeRequests(rows[0].store_id);
  });
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [exists]: any = await c.execute("SELECT processed FROM sepay_webhook_events WHERE provider_event_id=? OR payload_hash=? FOR UPDATE", [parsed.eventId, hash]);
    if (exists.length && exists[0].processed) { await c.commit(); return { ok: true, duplicate: true }; }
    if (!exists.length) await c.execute("INSERT INTO sepay_webhook_events(provider_event_id,payload_hash) VALUES(?,?)", [parsed.eventId, hash]);
    const [lookup]: any = await c.execute("SELECT store_id FROM payment_intents WHERE reference_code=?", [parsed.code]);
    if (lookup[0]) await c.execute("SELECT id FROM stores WHERE id=? FOR UPDATE", [lookup[0].store_id]);
    const [intents]: any = await c.execute("SELECT * FROM payment_intents WHERE reference_code=? FOR UPDATE", [parsed.code]);
    const intent = intents[0];
    if (!intent) throw new HttpError(404, "Mã thanh toán không tồn tại.");
    const qr = typeof intent.qr_payload === "string" ? JSON.parse(intent.qr_payload) : intent.qr_payload;
    if (body.accountNumber && String(body.accountNumber) !== String(qr.accountNumber)) throw new HttpError(409, "Tài khoản nhận tiền không khớp mã thanh toán.");
    if (!["pending", "paid"].includes(intent.status)) throw new HttpError(409, "Mã thanh toán đã bị hủy.");
    if (intent.status === "paid") {
      if (intent.kind === "subscription") throw new HttpError(409,"Mã này đã thanh toán. Giao dịch mới cần đối soát, không cộng thêm kỳ tự động.");
      await c.execute("UPDATE sepay_webhook_events SET processed=1,processed_at=NOW() WHERE provider_event_id=?", [parsed.eventId]); await c.commit(); return { ok: true, duplicate: true };
    }
    if (intent.kind === "order" && parseDateTime(intent.expires_at, "utc").getTime() < Date.now()) throw new HttpError(409, "Mã thanh toán đã hết hạn.");
    if (intent.kind === "order" && parsed.amount < intent.amount - intent.paid_amount) throw new HttpError(409, "Số tiền chuyển chưa đủ.");
    if (intent.kind === "order") {
      const [owners]: any = await c.execute("SELECT owner_id FROM stores WHERE id=?", [intent.store_id]);
      await withStore(intent.store_id, () => recordOrderPayment(c, intent.order_id, owners[0]?.owner_id || 1, { kind: "collect", amount: intent.amount - intent.paid_amount, method: "bank", reference: parsed.providerReference }));
      const [bankRows]: any = await c.execute("SELECT sepay_enabled,auto_confirm_status FROM store_bank_accounts WHERE store_id=? AND enabled=1", [intent.store_id]);
      if (bankRows[0]?.sepay_enabled) await c.execute("UPDATE orders SET status=IF(status IN ('pending','confirmed'),?,status),confirmed_at=IF(?='confirmed',COALESCE(confirmed_at,NOW()),confirmed_at) WHERE id=? AND status<>'cancelled'", [bankRows[0].auto_confirm_status, bankRows[0].auto_confirm_status, intent.order_id]);
      await c.execute("UPDATE payment_intents SET paid_amount=amount,status='paid',paid_at=NOW(),provider_reference=? WHERE id=?", [parsed.providerReference, intent.id]);
    } else {
      await recordInvoicePayment(c, intent.invoice_id, parsed.amount, parsed.providerReference, 1, parsed.receivedAt);
      const [invoices]: any = await c.execute("SELECT status FROM invoices WHERE id=?",[intent.invoice_id]);
      await c.execute("UPDATE payment_intents SET paid_amount=LEAST(amount,paid_amount+?),status=?,paid_at=IF(?='paid',UTC_TIMESTAMP(),paid_at),provider_reference=? WHERE id=?", [parsed.amount,invoices[0].status === 'paid' ? 'paid' : 'pending',invoices[0].status,parsed.providerReference,intent.id]);
    }
    await c.execute("UPDATE sepay_webhook_events SET processed=1,processed_at=NOW() WHERE provider_event_id=?", [parsed.eventId]);
    await c.commit();
    return { ok: true, code: parsed.code };
  } catch (e) { await c.rollback(); try { await c.execute("INSERT INTO sepay_webhook_events(provider_event_id,payload_hash,error_message) VALUES(?,?,?) ON DUPLICATE KEY UPDATE error_message=VALUES(error_message)", [parsed.eventId,hash,String((e as Error).message).slice(0,500)]); } catch {} throw e; } finally { c.release(); }
}
