"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bot, Plus, LoaderCircle, Trash2, Bell, Settings, MessageSquare, TriangleAlert, ChevronDown } from "lucide-react";
import { api, useShop } from "./context";
import Link from "./routing";
import { formatDateTime, formatDate } from "@/lib/date-time";
import { orderLabels, displayLabel } from "@/lib/display-labels";
import { aiReportLabels, aiMoneyKeys, formatAIMetric, isAIAnalyticsReport } from "@/lib/ai-report";
import { manualSalesChannels, paymentMethods } from "@/lib/order-workflow";
import AIAnalyticsReport from "./ai-analytics-report";
import AIChatComposer from "./ai-chat-composer";
import { safeAIImageURL, type AIImage } from "@/lib/ai-image-policy";

const labels: Record<string, string> = { order: "Thông tin đơn", quote: "Giá hiện tại", summary: "Tổng quan", previous: "Kỳ trước", period: "Khoảng thời gian", products: "Sản phẩm", sources: "Kênh tiếp nhận", deliveries: "Giao hoa", items: "Danh sách", orders: "Đơn hàng", notes: "Ghi chú", customers: "Khách hàng", inquiries: "Yêu cầu hỗ trợ", from: "Từ ngày", to: "Đến ngày", title: "Tiêu đề", content: "Nội dung", day: "Ngày", dueAt: "Giờ nhắc", assignedName: "Người nhận", orderReference: "Mã đơn", customerName: "Khách đặt", customer_name: "Khách đặt", recipientName: "Người nhận", recipient_name: "Người nhận", recipientPhone: "SĐT người nhận", recipient_phone: "SĐT người nhận", phone: "Điện thoại", email: "Email", address: "Địa chỉ", deliveryDate: "Ngày giao", delivery_date: "Ngày giao", deliverySlot: "Khung giờ", delivery_slot: "Khung giờ", deliveryMode: "Hình thức giao", message: "Lời nhắn", internalNotes: "Ghi chú nội bộ", name: "Tên", product_name: "Sản phẩm", quantity: "Số lượng", size: "Kích cỡ", price: "Đơn giá", total: "Tổng tiền", subtotal: "Tiền sản phẩm", shipping: "Phí giao", discount: "Giảm giá", revenue: "Doanh thu", collected: "Đã thu", outstanding: "Còn phải thu", status: "Trạng thái", payment_status: "Thanh toán", reference: "Mã đơn", count: "Số lượng", reasons: "Cần chú ý", failedEmails: "Email lỗi", asOf: "Cập nhật lúc", note: "Lưu ý", definition: "Cách tính", segment: "Phân nhóm", reason: "Căn cứ", delivered_orders: "Đơn đã giao", last_delivery: "Lần giao gần nhất", marketingAllowed: "Đồng ý tiếp thị", page: "Trang gặp lỗi" };
const hidden = new Set(["token", "quoteToken", "expiresAt", "expires_at", "customerId", "productId", "assignedTo", "placeId", "deliveryLat", "deliveryLng", "color", "id", "source", "href", "limit", "truncated", "separateContact", "code", "discountType", "discountValue", "adjustmentReason", "tags", "initialStatus", "collectAmount", "collectMethod", "paymentReference", "saveAsDraft", "type", "line_type", "image", "marketing_consent"]);
Object.assign(labels, aiReportLabels, { created_at: "Ngày tạo", description: "Mô tả", warnings: "Cảnh báo", paymentMethod: "Phương thức thanh toán" });
function Value({ value, name = "", depth = 0 }: { value: any; name?: string; depth?: number }) {
  if (value === null || value === undefined || value === "" || depth > 5) return null;
  if (typeof value !== "object") {
    let text = String(value);
    if (aiMoneyKeys.has(name) && Number.isFinite(Number(value))) text = formatAIMetric(name, value);
    else if (typeof value === "boolean") text = value ? "Có" : "Không";
    else if (/dueAt|asOf/.test(name)) text = formatDateTime(value, "utc");
    else if (name === "created_at") text = formatDateTime(value);
    else if (/date|Date|^day$|last_delivery|^from$|^to$|previousFrom|previousTo/.test(name)) text = formatDate(value);
    else if (name === "status" || name === "payment_status") text = orderLabels[text] || text;
    else if (name === "segment") text = displayLabel("segment", text);
    else if (["sales_channel", "salesChannel"].includes(name)) text = manualSalesChannels[text] || (text === "website" ? "Website" : "Khác");
    else if (name === "creation_source") text = text === "manual" ? "Thủ công" : "Website";
    else if (["payment_method", "paymentMethod", "method"].includes(name)) text = paymentMethods[text] || (text === "cash" ? "Tiền mặt" : "Khác");
    else if (name === "deliveryMode") text = value === "self" ? "Giao cho khách" : "Gửi hoa tới người khách thương";
    else if (typeof value === "number") text = value.toLocaleString("vi-VN");
    return <span>{text}</span>;
  }
  if (Array.isArray(value)) return value.length ? <div className="ai-data-list">{value.slice(0, 20).map((v, i) => <div className="ai-data-item" key={i}><Value value={v} depth={depth + 1} name={name} /></div>)}</div> : <span>Chưa có dữ liệu</span>;
  return <dl className="ai-data">{Object.entries(value).filter(([k, v]) => !hidden.has(k) && v !== null && v !== "" && (typeof v !== "object" || Object.keys(v as object).length)).map(([k, v]) => <div key={k}><dt>{labels[k] || k.replaceAll("_", " ")}</dt><dd><Value value={v} name={k} depth={depth + 1} /></dd></div>)}</dl>;
}
function safeHref(href: unknown): href is string { return typeof href === "string" && /^\/(?:workspace|admin)\//.test(href) && !href.includes("\\"); }
export default function WorkspaceAI({ compact = false, active = true, onThreadChange, onReply, onWorkingChange }: { compact?: boolean; active?: boolean; onThreadChange?: (id: string) => void; onReply?: () => void; onWorkingChange?: (working: boolean) => void }) {
  const { toast } = useShop();
  const historyId = useId();
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [image, setImage] = useState<AIImage | null>(null), [imageBusy, setImageBusy] = useState(false);
  const [access, setAccess] = useState<any>(null), [error, setError] = useState(""), [threads, setThreads] = useState<any[]>([]), [thread, setThread] = useState(""), [messages, setMessages] = useState<any[]>([]), [text, setText] = useState(""), [busy, setBusy] = useState(false), [acting, setActing] = useState(""), [tab, setTab] = useState("chat"), [reminders, setReminders] = useState<any[]>([]), [attention, setAttention] = useState<any>(null), [settings, setSettings] = useState<any>(null);
  const bottom = useRef<HTMLDivElement>(null), mounted = useRef(true), threadRef = useRef("");
  const refresh = useCallback(async () => {
    const a = await api("workspace/ai"); if (!mounted.current) return; setAccess(a);
    if (a.allowed && a.operational) {
      const [t, r, n] = await Promise.all([api("workspace/ai/conversations"), compact ? [] : api("workspace/ai/reminders"), compact ? null : api("workspace/ai/attention")]);
      if (mounted.current) { setThreads(t); setReminders(r); setAttention(n); }
    }
  }, [compact]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active) return;
    void refresh().catch(e => { if (mounted.current) setError(e.message); });
    const id = threadRef.current;
    if (id && !busy && !acting) {
      setOpening(true);
      void api("workspace/ai/conversations/" + id).then(r => { if (mounted.current && threadRef.current === id) setMessages(r.messages); })
        .catch(e => { if (mounted.current) setError(e.message); })
        .finally(() => { if (mounted.current && threadRef.current === id) setOpening(false); });
    }
    // Resume only on visibility changes, without replacing an in-flight request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, active]);
  useEffect(() => { onThreadChange?.(thread); }, [thread, onThreadChange]);
  useEffect(() => { onWorkingChange?.(busy || opening || imageBusy || !!acting); }, [busy, opening, imageBusy, acting, onWorkingChange]);
  useEffect(() => {
    if (compact) return;
    const id = new URL(location.href).searchParams.get("conversation");
    if (id && /^[a-f0-9-]{36}$/i.test(id)) void open(id);
    // A conversation link selects the initial thread; normal chat state stays local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);
  useEffect(() => { if (!active) return; const box = bottom.current?.parentElement; box?.scrollTo({ top: box.scrollHeight, behavior: "instant" }); }, [messages, busy, active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh().catch(() => {}); }, 30000);
    return () => clearInterval(timer);
  }, [refresh, active]);
  async function open(id: string) {
    if (busy || imageBusy || acting) return; setHistoryOpen(false); threadRef.current = id; setThread(id); setMessages([]); setError(""); setOpening(true);
    try { const r = await api("workspace/ai/conversations/" + id); if (mounted.current && threadRef.current === id) setMessages(r.messages); } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current && threadRef.current === id) setOpening(false); }
  }
  async function send() {
    if (busy || opening || imageBusy || acting || (!text.trim() && !image) || !access?.allowed || !access.operational || !access.enabled || access.used >= access.limit) return;
    const id = thread || crypto.randomUUID(), prompt = text.trim() || "Hãy đọc ảnh này và hỗ trợ tôi xử lý nội dung.", attached = image; threadRef.current = id; setThread(id); setBusy(true); setError(""); setText(""); setImage(null);
    setMessages(m => [...m, { id: "sending", role: "user", content: prompt, cards: attached ? [{ type: "image", data: attached }] : [] }]);
    try {
      const r = await api("workspace/ai/chat", "POST", { conversationId: id, requestId: crypto.randomUUID(), message: prompt, ...(attached ? { images: [attached] } : {}) });
      if (mounted.current) { setMessages(r.messages); onReply?.(); void refresh().catch(() => {}); }
    } catch (e) { if (mounted.current) { setError((e as Error).message); setText(prompt); setImage(attached); setMessages(m => m.filter(x => x.id !== "sending")); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function action(id: string, cancel: boolean) {
    setActing(id); setError("");
    try { const r = await api("workspace/ai/actions/" + id, "POST", { cancel }); if (!mounted.current) return; toast(r.cancelled ? "Đã hủy đề xuất" : r.result?.message || "Đã thực hiện hành động"); const m = await api("workspace/ai/conversations/" + thread); if (!mounted.current) return; setMessages(m.messages); void refresh().catch(() => {}); }
    catch (e) { setError((e as Error).message); } finally { setActing(""); }
  }
  function newConversation() {
    threadRef.current = ""; setThread(""); setMessages([]); setImage(null); setError(""); setHistoryOpen(false);
    if (compact) promptInput.current?.focus({ preventScroll: true });
  }
  const history = <aside id={historyId} className="panel ai-history" aria-label="Lịch sử hội thoại" hidden={compact && !historyOpen}>
    {!compact && <><button className="button secondary" disabled={busy || opening || imageBusy || !!acting} onClick={newConversation}><Plus size={16} />Hội thoại mới</button><p className="small">Hội thoại riêng của bạn</p></>}
    {!threads.length && <p className="ai-history-empty">Chưa có hội thoại. Bắt đầu bằng một câu hỏi bên dưới.</p>}
    {threads.map(t => <div className="ai-thread" key={t.id}><button className={thread === t.id ? "active" : ""} aria-current={thread === t.id ? "true" : undefined} title={t.title} disabled={busy || opening || imageBusy || !!acting} onClick={() => void open(t.id)}>{t.title}</button><button title="Xóa hội thoại" aria-label={"Xóa " + t.title} disabled={busy || opening || imageBusy || !!acting} onClick={async () => { if (!confirm("Xóa hội thoại này?")) return; try { await api("workspace/ai/conversations/" + t.id, "DELETE"); if (thread === t.id) { setThread(""); threadRef.current = ""; setMessages([]); } await refresh(); } catch (e) { setError((e as Error).message); } }}><Trash2 size={14} /></button></div>)}
  </aside>;
  if (!access) return <div className="ai-quick-loading"><p role="status" className={error ? "error" : "empty"}>{error || "Đang tải trợ lý AI…"}</p>{error && <button className="button secondary" onClick={() => { setError(""); void refresh().catch(e => setError(e.message)); }}>Thử lại</button>}</div>;
  const usagePercent = access.limit > 0 ? Math.min(100, Math.max(0, access.used / access.limit * 100)) : 0;
  const usageLabel = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(usagePercent) + "%";
  const usageDescription = `Đã dùng ${access.used}/${access.limit} lượt AI trong tháng${access.limit > 0 ? "" : " · Chưa có hạn mức AI"}`;
  return <div className={"workspace-ai" + (compact ? " ai-compact" : "")} data-no-fade-in>
    {!compact && <div className="section-heading"><div><span className="eyebrow">Fleurious · DeepSeek</span><h1><Bot size={27} /> Trợ lý AI</h1><p className="small">Tra cứu vận hành, hỗ trợ lên đơn, ghi chú và nhắc việc cho cửa hàng.</p></div><div className="ai-quota"><strong>{access.used}/{access.limit}</strong><span>Lượt AI · {access.month}</span></div></div>}
    {compact && <div className="ai-quick-quota">
      <span className="ai-plan-name" title={access.plan}>{access.plan}</span>
      <div className="ai-quick-usage" title={usageDescription} data-level={usagePercent >= 100 ? "full" : usagePercent >= 80 ? "near" : "normal"}>
        <div className="ai-quota-track" role="progressbar" aria-label="Lượt AI đã sử dụng" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usagePercent} aria-valuetext={`${usageLabel} · ${usageDescription}`}>
          <span style={{ width: `${usagePercent}%` }} />
        </div>
        <strong>{usageLabel}</strong>
      </div>
    </div>}
    {(!access.allowed || !access.operational) ? <section className="panel"><h3>Trợ lý chưa khả dụng</h3><p>{access.reason}</p><Link className="button" href="/admin/billing">Xem gói & hóa đơn</Link></section> : <>
      {!access.enabled && <p className="notice">Kết nối trò chuyện đang tắt. Kiểm tra cấu hình cửa hàng hoặc liên hệ admin platform. Bạn vẫn có thể theo dõi nhắc việc và việc cần chú ý.</p>}
      {!compact && <nav className="ai-tabs" aria-label="Chức năng trợ lý">{[["chat", "Hội thoại", MessageSquare], ["attention", "Việc cần chú ý", TriangleAlert], ["reminders", "Nhắc việc", Bell], ...(["owner", "admin", "manager"].includes(access.actorRole) ? [["settings", "Cấu hình", Settings]] : [])].map(([key, title, Icon]: any) => <button key={key} className={tab === key ? "active" : ""} onClick={async () => { setTab(key); if (key === "settings") try { setSettings(await api("workspace/ai/settings")); } catch (e) { setError((e as Error).message); } }}><Icon size={16} />{title}</button>)}</nav>}
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "chat" && <div className="ai-layout">
        {compact ? <div className="ai-history-section"><div className="ai-conversation-tools"><button className="ai-history-toggle" aria-expanded={historyOpen} aria-controls={historyId} onClick={() => setHistoryOpen(v => !v)}><MessageSquare size={16} /><span>Hội thoại gần đây</span><span className="ai-thread-count">{threads.length}</span><ChevronDown size={15} /></button><button className="ai-new-conversation" aria-label="Hội thoại mới" title="Hội thoại mới" disabled={busy || opening || imageBusy || !!acting} onClick={newConversation}><Plus size={19} /></button></div>{history}</div> : <details className="ai-history-wrap" open><summary>Hội thoại gần đây ({threads.length})</summary>{history}</details>}
        <section className="panel ai-chat" aria-label="Hội thoại trợ lý">
          <div className="ai-messages" role="log" aria-live="polite">{opening && <p role="status">Đang mở hội thoại…</p>}{!opening && !messages.length && <div className="ai-welcome"><Bot size={34} /><h3>Hôm nay bạn cần hỗ trợ gì?</h3><p>{compact ? "Tra cứu đơn, xem số liệu hoặc nhờ AI hỗ trợ lên đơn. Bạn luôn xác nhận trước mỗi thay đổi." : "AI lấy dữ liệu từ cửa hàng theo quyền của bạn. Mọi thay đổi đều có bước xem trước và xác nhận."}</p><div className="ai-suggestions">{["Những đơn nào đang cần chú ý?", "Báo cáo hoạt động trong 7 ngày gần nhất", "Hỗ trợ tôi lên một đơn mới", "Tìm khách hàng cần chăm sóc"].map(s => <button key={s} onClick={() => { setText(s); if (compact) { setHistoryOpen(false); promptInput.current?.focus({ preventScroll: true }); } }}>{compact ? ({ "Những đơn nào đang cần chú ý?": "Đơn cần chú ý", "Báo cáo hoạt động trong 7 ngày gần nhất": "Báo cáo 7 ngày", "Hỗ trợ tôi lên một đơn mới": "Lên đơn mới", "Tìm khách hàng cần chăm sóc": "Chăm sóc khách hàng" }[s]) : s}</button>)}</div></div>}{messages.map(m => <article className={"ai-message " + m.role} key={m.id}><strong>{m.role === "user" ? "Bạn" : "Fleurious AI"}</strong><p>{String(m.content).split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2,-2)}</strong> : part)}</p>{(m.cards || []).map((c: any, i: number) => c.type === "image" ? (m.role === "user" && safeAIImageURL(c.data?.dataUrl) ? <figure className="ai-message-image" key={i}><img src={c.data.dataUrl} alt="Ảnh đã gửi cho trợ lý" /><figcaption>{c.data.name}</figcaption></figure> : null) : <section className="ai-result" key={c.actionId || i}><div className="flex-between"><h4>{c.title}</h4>{c.actionId && <span className="tag">{c.status === "done" ? "Đã thực hiện" : c.status === "cancelled" ? "Đã hủy" : "Chờ xác nhận"}</span>}</div>{isAIAnalyticsReport(c.data) ? <AIAnalyticsReport data={c.data} /> : <details open={!!c.actionId}><summary>Xem thông tin</summary><Value value={c.data} /></details>}{c.actionId && c.status === "pending" && <div className="button-row"><button className="button" disabled={!!acting || busy} onClick={() => void action(c.actionId, false)}>{acting === c.actionId ? "Đang xử lý…" : "Xác nhận"}</button><button className="button secondary" disabled={!!acting || busy} onClick={() => void action(c.actionId, true)}>Hủy đề xuất</button></div>}{c.result?.message && <p>{c.result.message}</p>}{safeHref(c.result?.href || c.href) && <Link href={c.result?.href || c.href} className="ai-source">Mở trang chi tiết →</Link>}</section>)}</article>)}{busy && <p role="status" className="ai-working"><LoaderCircle size={17} /> Đang kiểm tra dữ liệu và soạn phản hồi…</p>}<div ref={bottom} /></div>
          {access.used >= access.limit && <p className="notice" role="status">Đã dùng hết lượt AI trong tháng. Bạn có thể xem lại hội thoại hoặc kiểm tra gói dịch vụ.</p>}<AIChatComposer text={text} setText={setText} image={image} setImage={setImage} inputRef={promptInput} disabled={busy || opening || !!acting || !access.enabled || access.used >= access.limit} imageEnabled={access.imageInput === true} busy={busy} send={() => void send()} onFocus={() => { if (compact) setHistoryOpen(false); }} onReading={setImageBusy} onError={setError} />
        </section>
      </div>}
      {tab === "attention" && <section className="panel"><h3>Việc cần chú ý</h3><p className="small">Dữ liệu vận hành thực tế, không sử dụng lượt AI · {attention?.asOf && formatDateTime(attention.asOf)}</p>{attention?.orders?.length ? attention.orders.map((o: any) => <article className="ai-attention" key={o.id}><div><strong>{o.reference} · {o.customer_name}</strong><p>{formatDate(o.delivery_date)} · {o.delivery_slot}</p><div className="button-row">{o.reasons.map((r: string) => <span className="tag" key={r}>{r}</span>)}</div></div><Link className="button secondary" href={o.href}>Xem đơn</Link></article>) : <p>Chưa có đơn cần chú ý trong khoảng theo dõi.</p>}{attention?.failedEmails > 0 && <p className="notice">Có {attention.failedEmails} email lỗi. Kiểm tra tại <Link href="/admin/emails">Email & chương trình</Link>.</p>}</section>}
      {tab === "reminders" && <section className="panel"><h3>Nhắc việc</h3><p className="small">Nhờ AI tạo nhắc việc trong hội thoại và bấm xác nhận. Thông báo được gửi vào hộp thư hệ thống; nhận đẩy khi đã bật quyền.</p>{reminders.length ? reminders.map(r => <article className="ai-attention" key={r.id}><div><strong>{r.title}</strong><p>{r.content}</p><small>{formatDateTime(r.due_at, "utc")} · {r.assigned_name} · {{ scheduled: "Đã lên lịch", notified: "Đã thông báo", done: "Hoàn thành", cancelled: "Đã hủy" }[r.status as string] || r.status}</small></div>{["scheduled", "notified"].includes(r.status) && <div className="button-row">{[["done", "Hoàn thành"], ["snooze", "Nhắc sau 15 phút"], ["cancel", "Hủy"]].map(([a, title]) => <button className="button secondary" key={a} disabled={!!acting} onClick={async () => { setActing(r.id); try { await api("workspace/ai/reminders/" + r.id, "PATCH", { action: a, generation: r.generation }); await refresh(); } catch (e) { setError((e as Error).message); } finally { setActing(""); } }}>{title}</button>)}</div>}</article>) : <p>Chưa có nhắc việc.</p>}</section>}
      {tab === "settings" && settings && <form className="panel" key={settings.version} onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); setActing("settings"); try { await api("workspace/ai/settings", "PATCH", { knowledge: String(f.get("knowledge")), enabled: f.get("enabled") === "on", version: settings.version }); setSettings(await api("workspace/ai/settings")); await refresh(); toast("Đã lưu cấu hình trợ lý"); } catch (e) { setError((e as Error).message); } finally { setActing(""); } }}><h3>Kiến thức cửa hàng</h3><p className="small">Bổ sung phong cách tư vấn, quy trình và thông tin cửa hàng. Giá, tồn kho và phân quyền luôn lấy từ hệ thống.</p><label className="field">Thông tin tham khảo<textarea name="knowledge" rows={8} maxLength={6000} defaultValue={settings.knowledge} /></label><label className="platform-user-check"><input name="enabled" type="checkbox" defaultChecked={!!settings.enabled} />Bật trò chuyện AI cho cửa hàng</label><button className="button" disabled={!!acting}>{acting ? "Đang lưu…" : "Lưu cấu hình"}</button></form>}
    </>}
  </div>;
}
