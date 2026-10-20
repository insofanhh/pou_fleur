import { z } from "zod";
import { randomUUID } from "node:crypto";
import { query, mutate } from "./db";
import { tenantId } from "./tenant";
import { HttpError } from "./auth";
import { aiArea, requireAI } from "./ai-access";
import { noteInput, reminderInput, issueInput, validDay, redactAISecrets } from "./ai-policy";
import { manualInput, manualOrdersAPI } from "./manual-orders";
import { analyticsPeriod } from "./store-analytics";
import { loadAIReport, requestsReportComparison, resolveAIReportRange } from "./ai-report-data";
import { hanoiDateKey } from "./date-time";
import { orderPaymentStatusSQL } from "./order-payment-state";
import { jsonValue, storeBy } from "./stores";
import { orderStateLabel } from "./order-fulfillment";
import type { AITool } from "./ai-provider";

export type AICard = { type: string; title: string; href?: string; data?: any; actionId?: string; status?: string; result?: any };
const empty = z.object({}).strict();
const search = z.object({ q: z.string().trim().min(1).max(100) }).strict();
const range = z.object({ from: validDay, to: validDay }).strict();
const orderFields = z.object({
  fulfillmentMethod: z.enum(["delivery", "pickup"]).optional(),
  customerId: z.number().int().positive().nullable().optional(), customerName: z.string().max(100).optional(), email: z.string().max(190).optional(), phone: z.string().max(30).optional(),
  deliveryMode: z.enum(["self", "gift"]).optional(), recipientName: z.string().max(100).optional(), recipientPhone: z.string().max(30).optional(), address: z.string().max(500).optional(),
  deliveryDate: z.string().max(10).optional(), deliverySlot: z.string().max(30).optional(), placeId: z.string().max(300).optional(),
  message: z.string().max(500).optional(), internalNotes: z.string().max(2000).optional(), salesChannel: z.enum(["phone", "zalo", "social", "in_person", "other"]).optional(),
  shipping: z.number().int().min(0).max(1000000).optional(), collectMethod: z.enum(["cash", "bank"]).optional(),
  items: z.array(z.object({ type: z.enum(["catalog", "custom"]), productId: z.number().int().positive().optional(), name: z.string().max(160).optional(), description: z.string().max(1000).optional(), quantity: z.number().int().min(1).max(30), size: z.enum(["S", "M", "L"]).optional(), price: z.number().int().min(1).max(100000000).optional() }).strict()).max(30).optional(),
  saveAsDraft: z.boolean().default(false),
}).strict();
const schemas = {
  search_products: search, search_customers: search,
  list_orders: range.extend({ q: z.string().max(100).default(""), status: z.enum(["pending", "confirmed", "preparing", "ready", "shipping", "delivered", "cancelled"]).optional() }).strict(),
  get_order: z.object({ id: z.number().int().positive() }).strict(),
  get_calendar: range, get_store_metrics: range.extend({ comparePrevious: z.boolean().default(false) }).strict(),
  get_attention: empty, get_customer_opportunities: empty,
  search_address: search, resolve_address: z.object({ placeId: z.string().min(1).max(300) }).strict(),
  get_order_options: empty, prepare_order: orderFields,
  prepare_note: noteInput, prepare_reminder: reminderInput, prepare_issue_report: issueInput,
  search_help: empty,
};
const definitions: [keyof typeof schemas, string, string][] = [
  ["search_products", "Tìm sản phẩm đang bán theo tên, trả ID và giá catalog. Không đoán ID hoặc giá.", "orders"],
  ["search_customers", "Tìm khách của cửa hàng theo tên/số điện thoại/email. Nhiều kết quả phải hỏi chọn; chỉ sử dụng liên hệ đã xác định.", "crm"],
  ["list_orders", "Tra đơn theo ngày giao hoặc ngày nhận tại quầy (tối đa 62 ngày), trạng thái và tên/mã đơn. Tối đa 20 kết quả, xem trang gốc nếu nhiều hơn.", "orders"],
  ["get_order", "Xem chi tiết một đơn thực tế theo ID đã biết.", "orders"],
  ["get_calendar", "Lịch giao và note theo ngày Hà Nội, tối đa 62 ngày.", "orders"],
  ["get_store_metrics", "Báo cáo nhóm đơn tạo trong đúng kỳ from–to (gồm cả hai ngày), trạng thái/số dư hiện tại. Không phải dòng tiền theo ngày thu. comparePrevious mặc định false; chỉ bật khi người dùng yêu cầu so sánh kỳ trước cùng độ dài.", "overview"],
  ["get_attention", "Đơn chưa phân công, trễ khung giao, công nợ và sự cố gửi mail có dữ liệu thật. Chỉ đề xuất, chưa thay đổi đơn.", "orders"],
  ["get_customer_opportunities", "Cơ hội CRM theo dữ kiện: VIP/trung thành/lâu chưa quay lại, yêu cầu chưa giải quyết. Không dự đoán xác suất mua; không gửi tiếp thị.", "crm"],
  ["search_address", "Gợi ý địa chỉ bằng Goong. Hỏi người dùng chọn khi có nhiều địa chỉ.", "orders"],
  ["resolve_address", "Lấy địa chỉ chuẩn và tọa độ từ placeId Goong, không tự bịa tọa độ.", "orders"],
  ["get_order_options", "Lấy khung giờ, ngày nghỉ, nhân viên và các lựa chọn giao hoa thực tế của store.", "orders"],
  ["prepare_order", "Chuẩn bị xem trước đơn CHƯA THU TIỀN, CHƯA CHỐT; không tự xác nhận. Thu thập thông tin trước. saveAsDraft=true để lưu thông tin còn thiếu qua xác nhận và mở form. Catalog không truyền price; custom phải rõ tên và giá. Phí giao chỉ do nhân viên chỉ định, không tự đoán. fulfillmentMethod=pickup là khách nhận ngay tại cửa hàng, luôn chỉ lưu nháp để nhân viên xác nhận bàn giao và thu tiền trong form.", "orders"],
  ["prepare_note", "Chuẩn bị note lịch chờ người dùng bấm xác nhận. Note không phải nhắc việc.", "orders"],
  ["prepare_reminder", "Chuẩn bị nhắc việc có hạn chờ xác nhận. dueAt phải là ISO có UTC offset; mặc định giờ Hà Nội +07:00. Người nhận mặc định chính người đang đăng nhập.", "orders"],
  ["prepare_issue_report", "Chuẩn bị ticket gửi admin platform, dựa lỗi người dùng mô tả, không khẳng định đã sửa lỗi. Không chứa khóa/token/mật khẩu.", "orders"],
  ["search_help", "Hướng dẫn hệ thống, giới hạn quyền và chức năng trợ lý.", "orders"],
];
export function aiTools(actor: { role: string }) {
  return definitions.filter(([, , area]) => {
    try { aiArea(actor, area); return true; } catch { return false; }
  }).map(([name, description]) => ({ type: "function", function: { name, description, parameters: z.toJSONSchema(schemas[name], { target: "draft-7", io: "input" }) } }) as AITool);
}
async function goong(path: string, param: string, value: string) {
  if (!process.env.GOONG_API_KEY) throw new HttpError(503, "Goong chưa được cấu hình; hãy hoàn thiện địa chỉ trong form tạo đơn.");
  const u = new URL("https://rsapi.goong.io/" + path);
  u.searchParams.set("api_key", process.env.GOONG_API_KEY); u.searchParams.set(param, value);
  if (param === "input") u.searchParams.set("location", "21.0278,105.8342");
  const r = await fetch(u, { signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!r.ok) throw new HttpError(502, "Gợi ý địa chỉ chưa khả dụng.");
  const d = await r.json();
  if (!["OK", "ZERO_RESULTS"].includes(d.status)) throw new HttpError(502, "Chưa xác minh được địa chỉ Goong.");
  return d;
}
function period(v: { from: string; to: string }, max = 62) {
  const p = analyticsPeriod(v.from, v.to);
  if (p.days > max) throw new HttpError(400, `Chọn tối đa ${max} ngày.`);
}
export async function workspaceAttention(actor: { role: string }) {
  aiArea(actor, "orders");
  const day = hanoiDateKey();
  const orders = await query<any[]>("SELECT o.id,o.reference,o.customer_name,o.delivery_date,o.delivery_slot,o.status,o.assigned_to," + orderPaymentStatusSQL() + " payment_status FROM orders o WHERE o.status NOT IN ('delivered','cancelled') AND o.delivery_date<=DATE_ADD(?,INTERVAL 1 DAY) ORDER BY o.delivery_date,o.delivery_slot,o.id LIMIT 60", [day]);
  const now = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }).slice(0, 5);
  const cards: any[] = [];
  for (const o of orders) {
    const date = String(o.delivery_date).slice(0, 10), end = o.delivery_slot?.match(/(\d{2}:\d{2})$/)?.[1];
    const reasons = [!o.assigned_to ? "Chưa phân công" : "", date < day || (date === day && end && end < now) ? "Quá khung giờ giao" : "", o.payment_status !== "paid" ? "Chưa thu đủ tiền" : ""].filter(Boolean);
    if (reasons.length) cards.push({ ...o, reasons, href: `/workspace/${tenantId()}/board?order=${o.id}` });
  }
  const mail = ["owner", "admin", "manager"].includes(actor.role) ? await query<any[]>("SELECT COUNT(*) count FROM email_outbox WHERE status='failed'") : [];
  return { orders: cards.slice(0, 25), truncated: orders.length >= 60, failedEmails: Number(mail[0]?.count || 0), asOf: new Date().toISOString() };
}
async function prepare(kind: string, payload: any, preview: any, ctx: { actor: any; conversationId: string; runId: string }, cards: AICard[]) {
  const [old] = await query<any[]>("SELECT id FROM ai_action_drafts WHERE run_id=? AND kind=?", [ctx.runId, kind]);
  if (old) throw new HttpError(409, "Mỗi lượt chỉ chuẩn bị một hành động cùng loại. Hãy xem lại card trước khi yêu cầu hành động tiếp theo.");
  const id = randomUUID();
  await mutate("INSERT INTO ai_action_drafts(id,user_id,conversation_id,run_id,kind,payload,preview,expires_at) VALUES(?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))", [id, ctx.actor.id, ctx.conversationId, ctx.runId, kind, JSON.stringify(payload), JSON.stringify(preview)]);
  cards.push({ type: kind, title: preview.title, data: preview, actionId: id, status: "pending" });
  return { actionId: id, preview, state: "Chờ người dùng bấm nút xác nhận trên card. Chưa thực hiện hành động." };
}
export async function executeAITool(name: string, args: unknown, ctx: { actor: any; conversationId: string; runId: string; requestText?: string; reportToday?: string }, cards: AICard[]): Promise<any> {
  const def = definitions.find(d => d[0] === name);
  if (!def) throw new HttpError(400, "Chức năng AI không được hỗ trợ.");
  const current = await requireAI(); // Recheck membership and entitlement for every tool.
  aiArea(current.actor, def[2]);
  const v: any = schemas[def[0]].parse(args);
  const url = new URL("https://fleur.invalid");
  const source = (title: string, href: string, data: any) => {
    cards.push({ type: "source", title, href, data });
    return { ...data, source: href, asOf: new Date().toISOString() };
  };
  if (name === "search_products" || name === "search_customers") {
    url.searchParams.set("q", v.q);
    const rows = await manualOrdersAPI([name === "search_products" ? "order-products" : "order-customers"], "GET", {}, url);
    return { items: rows, source: `/workspace/${tenantId()}/${name === "search_products" ? "products" : "crm"}` };
  }
  if (name === "get_order_options") return manualOrdersAPI(["manual-orders", "options"], "GET", {}, url);
  if (name === "get_order") {
    const o = await manualOrdersAPI(["manual-orders", String(v.id)], "GET", {}, url);
    return source("Đơn " + o.reference, `/workspace/${tenantId()}/board?order=${o.id}`, { order: { id: o.id, reference: o.reference, customer_name: o.customer_name, recipient_name: o.recipient_name, phone: o.phone, recipient_phone: o.recipient_phone, address: o.address, delivery_date: o.delivery_date, delivery_slot: o.delivery_slot, total: o.total, payment_status: o.payment_status, collected: o.collected, status: orderStateLabel(o), fulfillment_method: o.fulfillment_method, picked_up_at: o.picked_up_at, pickup_location_snapshot: o.pickup_location_snapshot, items: o.items } });
  }
  if (name === "list_orders") {
    period(v);
    const rows = await query<any[]>("SELECT o.id,o.reference,o.customer_name,o.total,o.status,o.fulfillment_method,o.picked_up_at,o.delivery_date,o.delivery_slot," + orderPaymentStatusSQL() + " payment_status FROM orders o WHERE o.delivery_date BETWEEN ? AND ? AND (?='' OR o.reference LIKE ? OR o.customer_name LIKE ?)" + (v.status ? " AND o.status=?" : "") + " ORDER BY o.delivery_date,o.delivery_slot,o.id LIMIT 20", [v.from, v.to, v.q, "%" + v.q + "%", "%" + v.q + "%", ...(v.status ? [v.status] : [])]);
    return source("Đơn theo ngày giao", `/workspace/${tenantId()}/orders`, { from: v.from, to: v.to, items: rows.map(o => ({...o, status: orderStateLabel(o)})), limit: 20 });
  }
  if (name === "get_calendar") {
    period(v);
    return source("Lịch giao và ghi chú", `/workspace/${tenantId()}/calendar`, { from: v.from, to: v.to, orders: await query("SELECT id,reference,customer_name,delivery_date,delivery_slot,status FROM orders WHERE delivery_date BETWEEN ? AND ? AND status<>'cancelled' AND fulfillment_method<>'pickup' ORDER BY delivery_date,delivery_slot LIMIT 50", [v.from, v.to]), notes: await query("SELECT title,content,day,color FROM calendar_notes WHERE day BETWEEN ? AND ? ORDER BY day LIMIT 30", [v.from, v.to]) });
  }
  if (name === "get_store_metrics") {
    const dates = resolveAIReportRange(ctx.requestText || "", v, ctx.reportToday);
    period(dates, 93);
    const compare = v.comparePrevious && (ctx.requestText === undefined || requestsReportComparison(ctx.requestText));
    const data = await loadAIReport(dates.from, dates.to, tenantId(), query, compare);
    return source("Phân tích hoạt động", `/workspace/${tenantId()}/analytics?from=${dates.from}&to=${dates.to}`, data);
  }
  if (name === "get_attention") return source("Việc cần chú ý", `/workspace/${tenantId()}/board`, await workspaceAttention(current.actor));
  if (name === "get_customer_opportunities") {
    const customers = await query<any[]>("SELECT c.id,c.name,c.segment,c.marketing_consent,(SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status='delivered') delivered_orders,(SELECT MAX(o.delivery_date) FROM orders o WHERE o.customer_id=c.id AND o.status='delivered') last_delivery FROM customers c WHERE c.segment IN ('vip','loyal','inactive') OR (SELECT MAX(o.delivery_date) FROM orders o WHERE o.customer_id=c.id AND o.status='delivered')<DATE_SUB(CURDATE(),INTERVAL 60 DAY) ORDER BY c.id DESC LIMIT 15");
    const inquiries = await query<any[]>("SELECT id,name,created_at FROM inquiries WHERE status='new' ORDER BY created_at LIMIT 10");
    return source("Cơ hội chăm sóc khách hàng", `/workspace/${tenantId()}/crm`, { customers: customers.map(c => ({ ...c, reason: c.segment === "vip" ? "Khách được phân loại VIP" : c.segment === "loyal" ? "Khách được phân loại trung thành" : "Có lịch sử mua cần rà soát chăm sóc; kiểm tra lần mua gần nhất", marketingAllowed: !!c.marketing_consent })), inquiries, note: "Gợi ý theo quy tắc, không phải xác suất mua. Không tự gửi tiếp thị; cần kiểm tra consent trong CRM." });
  }
  if (name === "search_address") { const d = await goong("Place/AutoComplete", "input", v.q); return { items: (d.predictions || []).slice(0, 5).map((p: any) => ({ placeId: p.place_id, description: p.description })) }; }
  if (name === "resolve_address") { const d = await goong("Place/Detail", "place_id", v.placeId); return { placeId: v.placeId, address: d.result?.formatted_address, location: d.result?.geometry?.location }; }
  if (name === "prepare_order") {
    const { saveAsDraft, placeId, ...fields } = v;
    const b = manualInput.parse({ ...fields, collectAmount: 0, initialStatus: "pending", assignedTo: current.actor.id });
    // Catalog prices must always come from the shared pricing service.
    for (const item of b.items) if (item.type === "catalog") delete item.price;
    if (placeId && b.fulfillmentMethod !== "pickup") {
      const d = await goong("Place/Detail", "place_id", placeId), p = d.result;
      if (!p?.geometry?.location) throw new HttpError(400, "Chưa xác định được tọa độ giao hoa.");
      b.address = p.formatted_address; b.deliveryLat = p.geometry.location.lat; b.deliveryLng = p.geometry.location.lng;
    }
    if (b.customerId) {
      const [c] = await query<any[]>("SELECT id,name,phone,email FROM customers WHERE id=?", [b.customerId]);
      if (!c) throw new HttpError(404, "Khách không thuộc cửa hàng.");
      b.customerName = c.name; b.phone = c.phone || b.phone; b.email = c.email || "";
    }
    if (saveAsDraft || b.fulfillmentMethod === "pickup") return prepare("order_draft", b, { title: "Lưu nháp đơn hàng", order: b, note: b.fulfillmentMethod === "pickup" ? "Đơn khách nhận ngay chỉ được lưu nháp. Mở form để ghi nhận thanh toán và trực tiếp xác nhận đã bàn giao hoa." : "Chưa chốt đơn, chưa thu tiền hoặc gửi email. Mở form để hoàn thiện sau khi lưu." }, ctx, cards);
    const store = await storeBy(tenantId());
    if (!b.customerName || !b.phone || b.address.length < 10 || !b.deliveryDate || !b.deliverySlot || (b.deliveryMode === "gift" && (!b.recipientName || !b.recipientPhone))) throw new HttpError(400, "Cần đủ tên/SĐT người đặt, người nhận (nếu gửi tặng), địa chỉ, ngày và khung giao. Hỏi thông tin thiếu hoặc chuẩn bị nháp.");
    if (store.lat !== null && store.lng !== null && b.deliveryLat === undefined) throw new HttpError(400, "Cần chọn địa chỉ Goong để xác định tọa độ; có thể lưu nháp và hoàn thiện trong form.");
    const quote = await manualOrdersAPI(["manual-orders", "quote"], "POST", b, url);
    return prepare("order", { ...b, quoteToken: quote.token, idempotencyKey: randomUUID() }, { title: "Xác nhận tạo đơn", order: b, quote, note: "Đơn chờ xác nhận, chưa thu tiền. Giá và lịch được kiểm tra lại khi chốt." }, ctx, cards);
  }
  if (name === "prepare_note") return prepare("note", v, { title: "Xác nhận lưu ghi chú", ...v }, ctx, cards);
  if (name === "prepare_reminder") {
    const due = Date.parse(v.dueAt);
    if (due < Date.now() + 30000 || due > Date.now() + 366 * 86400000) throw new HttpError(400, "Giờ nhắc phải sau hiện tại ít nhất 30 giây và trong vòng 366 ngày.");
    const assigned = v.assignedTo || current.actor.id;
    if (assigned !== current.actor.id && !["owner", "admin", "manager"].includes(current.actor.role)) throw new HttpError(403, "Bạn chỉ được tạo nhắc việc cho chính mình.");
    const [m] = await query<any[]>("SELECT m.user_id,u.name FROM store_memberships m JOIN users u ON u.id=m.user_id WHERE m.store_id=? AND m.user_id=? AND m.status='active' AND m.role IN ('owner','admin','manager','support') AND u.active=1", [tenantId(), assigned]);
    if (!m) throw new HttpError(400, "Người nhận nhắc không còn quyền quản lý đơn tại store.");
    let order: any = null;
    if (v.orderId) {
      [order] = await query<any[]>("SELECT id,reference,status,delivery_date,delivery_slot FROM orders WHERE id=?", [v.orderId]);
      if (!order || ["cancelled", "delivered"].includes(order.status)) throw new HttpError(409, "Đơn không tồn tại hoặc đã kết thúc.");
    }
    return prepare("reminder", { ...v, assignedTo: assigned, orderDay: order?.delivery_date || null, orderSlot: order?.delivery_slot || null }, { title: v.title, content: v.content, dueAt: v.dueAt, assignedName: m.name, orderReference: order?.reference }, ctx, cards);
  }
  if (name === "prepare_issue_report") {
    const p = { ...v, title: redactAISecrets(v.title), content: redactAISecrets(v.content) };
    return prepare("issue", p, { ...p, note: "Gửi báo lỗi đến admin platform; chưa có thay đổi hệ thống." }, ctx, cards);
  }
  return { help: "Tra cứu và lên đơn theo quyền hiện tại. Chốt đơn/note/nhắc việc phải bấm xác nhận. Thu/hoàn tiền, hủy/khôi phục, đổi trạng thái hoặc phương thức thanh toán thực hiện trong chi tiết đơn. Chat không tự gửi chiến dịch. Số tiền theo VNĐ, ngày theo Hà Nội. Gói Trải nghiệm/Khởi đầu/Studio/Atelier; hết quota vẫn xem được dữ liệu và nhắc việc đã lưu." };
}
