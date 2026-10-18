import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "./db";
import { HttpError } from "./auth";
import { recordOrderPayment } from "./order-payments";
import { withStore } from "./tenant";

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

export async function createIntent(c: any, storeId: number, kind: "order" | "subscription", ownerId: number, amount: number, orderId: number | null, invoiceId: number | null, bank: BankConfig) {
  const code = transferCode(kind, kind === "order" ? orderId! : invoiceId!);
  const payload = JSON.stringify({ bankCode: bank.bank_code, accountNumber: bank.account_number, accountHolder: bank.account_holder, amount, addInfo: code });
  const [r]: any = await c.execute("INSERT INTO payment_intents(store_id,order_id,invoice_id,kind,reference_code,amount,expires_at,qr_payload) VALUES(?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE),?)", [storeId, orderId, invoiceId, kind, code, amount, payload]);
  return { id: r.insertId, code, amount, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), qrUrl: vietQrUrl(bank, amount, code), bank };
}

export function verifyWebhook(raw: string, headers: Headers, credentials?: SepayCredentials | null) {
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
  return { eventId, amount: Math.round(amount), code: match[0].toUpperCase(), providerReference: String(body.referenceCode ?? body.transactionCode ?? eventId) };
}

export async function processWebhook(raw: string, body: any, headers: Headers) {
  const credentials = await sepayCredentials();
  if (!verifyWebhook(raw, headers, credentials)) throw new HttpError(401, "API key hoặc chữ ký SePay không hợp lệ.");
  const parsed = parseWebhook(body);
  const hash = createHash("sha256").update(raw).digest("hex");
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [exists]: any = await c.execute("SELECT processed FROM sepay_webhook_events WHERE provider_event_id=? OR payload_hash=? FOR UPDATE", [parsed.eventId, hash]);
    if (exists.length && exists[0].processed) { await c.commit(); return { ok: true, duplicate: true }; }
    if (!exists.length) await c.execute("INSERT INTO sepay_webhook_events(provider_event_id,payload_hash) VALUES(?,?)", [parsed.eventId, hash]);
    const [intents]: any = await c.execute("SELECT * FROM payment_intents WHERE reference_code=? FOR UPDATE", [parsed.code]);
    const intent = intents[0];
    if (!intent) throw new HttpError(404, "Mã thanh toán không tồn tại.");
    if (intent.status === "paid") { await c.execute("UPDATE sepay_webhook_events SET processed=1,processed_at=NOW() WHERE provider_event_id=?", [parsed.eventId]); await c.commit(); return { ok: true, duplicate: true }; }
    if (new Date(intent.expires_at).getTime() < Date.now()) throw new HttpError(409, "Mã thanh toán đã hết hạn.");
    if (parsed.amount < intent.amount - intent.paid_amount) throw new HttpError(409, "Số tiền chuyển chưa đủ.");
    if (intent.kind === "order") {
      const [owners]: any = await c.execute("SELECT owner_id FROM stores WHERE id=?", [intent.store_id]);
      await withStore(intent.store_id, () => recordOrderPayment(c, intent.order_id, owners[0]?.owner_id || 1, { kind: "collect", amount: intent.amount - intent.paid_amount, method: "bank", reference: parsed.providerReference }));
      const [bankRows]: any = await c.execute("SELECT sepay_enabled,auto_confirm_status FROM store_bank_accounts WHERE store_id=? AND enabled=1", [intent.store_id]);
      if (bankRows[0]?.sepay_enabled) await c.execute("UPDATE orders SET status=IF(status IN ('pending','confirmed'),?,status),confirmed_at=IF(?='confirmed',COALESCE(confirmed_at,NOW()),confirmed_at) WHERE id=? AND status<>'cancelled'", [bankRows[0].auto_confirm_status, bankRows[0].auto_confirm_status, intent.order_id]);
      await c.execute("UPDATE payment_intents SET paid_amount=amount,status='paid',paid_at=NOW(),provider_reference=? WHERE id=?", [parsed.providerReference, intent.id]);
    } else {
      const [invRows]: any = await c.execute("SELECT * FROM invoices WHERE id=? FOR UPDATE", [intent.invoice_id]);
      const inv = invRows[0];
      if (!inv) throw new HttpError(404, "Hóa đơn dịch vụ không tồn tại.");
      await c.execute("INSERT INTO billing_payments(invoice_id,reference,amount,actor_id) VALUES(?,?,?,?)", [inv.id, parsed.providerReference, intent.amount - intent.paid_amount, 1]);
      await c.execute("UPDATE invoices SET paid=paid+?,status=IF(paid+? >= amount,'paid','open') WHERE id=?", [intent.amount - intent.paid_amount, intent.amount - intent.paid_amount, inv.id]);
      await c.execute("UPDATE subscriptions SET status='active',period_end=DATE_ADD(COALESCE(period_end,CURDATE()),INTERVAL 1 MONTH),version=version+1 WHERE store_id=?", [intent.store_id]);
      await c.execute("UPDATE payment_intents SET paid_amount=amount,status='paid',paid_at=NOW(),provider_reference=? WHERE id=?", [parsed.providerReference, intent.id]);
    }
    await c.execute("UPDATE sepay_webhook_events SET processed=1,processed_at=NOW() WHERE provider_event_id=?", [parsed.eventId]);
    await c.commit();
    return { ok: true, code: parsed.code };
  } catch (e) { await c.rollback(); try { await c.execute("UPDATE sepay_webhook_events SET error_message=? WHERE provider_event_id=?", [String((e as Error).message).slice(0, 500), parsed.eventId]); } catch {} throw e; } finally { c.release(); }
}
