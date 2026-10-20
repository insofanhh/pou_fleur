import { z } from "zod";
import { query } from "./db";
import { HttpError } from "./auth";
import { analyticsPeriod } from "./store-analytics";
import { sessionExpirySQL } from "./billing";

// Trusted platform scope only; the calling route checks platformActor first.
const invoiceSelect = `SELECT i.*,s.name store_name,s.slug store_slug,u.email owner_email,
  COALESCE(v.plan_id,(SELECT p.id FROM plans p WHERE p.name=i.plan_name ORDER BY p.id LIMIT 1)) plan_id,
  GREATEST(i.amount-i.paid,0) balance,
  COALESCE(i.due_at,CONVERT_TZ(DATE_ADD(i.due_date,INTERVAL 1 DAY),'+07:00','+00:00')) due_instant,
  ${sessionExpirySQL("i")} session_expires_at
  FROM invoices i JOIN stores s ON s.id=i.store_id JOIN users u ON u.id=s.owner_id LEFT JOIN plan_versions v ON v.id=i.plan_version_id`;
const state = `CASE WHEN b.status='void' THEN IF(b.void_reason='payment_timeout','payment_timeout','void')
  WHEN b.status='paid' THEN IF(b.plan_id=4,'free','paid')
  WHEN b.status='open' AND b.balance>0 AND b.due_instant<=UTC_TIMESTAMP() THEN 'overdue'
  WHEN b.status='open' AND b.paid>0 THEN 'partially_paid' ELSE b.status END`;

function decorate(row: any) {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const timedOut =
    Number(row.paid) === 0 &&
    ((row.purpose === "plan_change" &&
      row.payment_deadline_at &&
      row.payment_deadline_at <= now) ||
      (row.session_expires_at && row.session_expires_at <= now));
  return {
    ...row,
    can_pay: row.status === "open" && Number(row.balance) > 0 && !timedOut,
    can_void: row.status === "open" && Number(row.paid) === 0,
  };
}
export async function loadPlatformInvoices(url: URL) {
  const f = z
    .object({
      q: z.string().trim().max(190),
      status: z.enum([
        "all",
        "open",
        "partially_paid",
        "overdue",
        "paid",
        "free",
        "void",
        "payment_timeout",
      ]),
      plan: z.coerce.number().int().min(0).max(100000),
      from: z.string(),
      to: z.string(),
      page: z.coerce.number().int().min(1).max(100000),
      sort: z.enum(["newest", "oldest", "due", "balance"]),
    })
    .parse({
      q: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "all",
      plan: url.searchParams.get("plan") || 0,
      from: url.searchParams.get("from") || "",
      to: url.searchParams.get("to") || "",
      page: url.searchParams.get("page") || 1,
      sort: url.searchParams.get("sort") || "newest",
    });
  if (f.from || f.to) {
    try {
      analyticsPeriod(f.from, f.to);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  }
  const where: string[] = [],
    args: any[] = [];
  if (f.q) {
    const plain = f.q.replace(/^HD-0*/i, "");
    where.push(
      "(b.store_name LIKE ? OR b.owner_email LIKE ? OR b.plan_name LIKE ? OR b.period_key LIKE ? OR CAST(b.id AS CHAR)=? OR EXISTS(SELECT 1 FROM billing_payments bp WHERE bp.invoice_id=b.id AND bp.reference LIKE ?))",
    );
    args.push(...Array(4).fill("%" + f.q + "%"), plain, "%" + f.q + "%");
  }
  if (f.plan) {
    where.push("b.plan_id=?");
    args.push(f.plan);
  }
  if (f.status === "open") where.push("b.status='open'");
  else if (f.status === "partially_paid")
    where.push("b.status='open' AND b.paid>0 AND b.balance>0");
  else if (f.status !== "all") {
    where.push(`${state}=?`);
    args.push(f.status);
  }
  if (f.from) {
    where.push("b.created_at>=? AND b.created_at<DATE_ADD(?,INTERVAL 1 DAY)");
    args.push(f.from, f.to);
  }
  const base = `FROM (${invoiceSelect}) b${where.length ? " WHERE " + where.map((s) => "(" + s + ")").join(" AND ") : ""}`;
  const sort = {
    newest: "b.id DESC",
    oldest: "b.id ASC",
    due: "(b.status='open' AND b.balance>0) DESC,b.due_instant ASC,b.id DESC",
    balance: "IF(b.status='open',b.balance,0) DESC,b.id DESC",
  }[f.sort];
  const [totals, plans] = await Promise.all([
    query<any[]>(
      `SELECT COUNT(*) total,COALESCE(SUM(b.amount),0) amount,COALESCE(SUM(b.paid),0) paid,COALESCE(SUM(IF(b.status='open',b.balance,0)),0) outstanding,SUM(${state}='overdue') overdue ${base}`,
      args,
    ),
    query<any[]>("SELECT id,name FROM plans ORDER BY id"),
  ]);
  const total = Number(totals[0].total),
    page = Math.min(f.page, Math.max(1, Math.ceil(total / 20)));
  const rows = await query<any[]>(
    `SELECT b.*,${state} display_status ${base} ORDER BY ${sort} LIMIT 20 OFFSET ${(page - 1) * 20}`,
    args,
  );
  return {
    rows: rows.map(decorate),
    summary: totals[0],
    plans,
    total,
    page,
    page_size: 20,
    filters: { ...f, page },
    server_now: new Date().toISOString(),
  };
}
export async function platformInvoiceDetail(id: number) {
  const [invoice] = await query<any[]>(
    `SELECT b.*,${state} display_status FROM (${invoiceSelect}) b WHERE b.id=?`,
    [id],
  );
  if (!invoice) throw new HttpError(404, "Không có hóa đơn.");
  const payments = await query<any[]>(
    "SELECT bp.id,bp.reference,bp.amount,bp.created_at,bp.received_at,u.name actor_name FROM billing_payments bp LEFT JOIN users u ON u.id=bp.actor_id WHERE bp.invoice_id=? ORDER BY bp.id DESC",
    [id],
  );
  return { invoice: decorate(invoice), payments };
}
