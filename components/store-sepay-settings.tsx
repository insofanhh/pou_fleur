"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { api, useShop } from "./context";
import { formatDateTime } from "@/lib/date-time";

type Config = { configured: boolean; enabled?: boolean; webhookUrl: string; api_last4?: string; last_received_at?: string };
export default function StoreSepaySettings() {
  const { toast } = useShop();
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState("");
  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"credentials" | "disable" | null>(null);
  const load = useCallback(async () => {
    try { setConfig(await api("workspace/sepay/credentials")); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast("Đã sao chép."); }
    catch { toast("Không thể sao chép. Hãy chọn và sao chép nội dung trong ô."); }
  }
  async function save(action: "credentials" | "disable") {
    setBusy(true);
    try {
      const result = await api("workspace/sepay/" + action, "POST", action === "credentials" ? { ...(inputKey.trim() ? { apiKey: inputKey.trim() } : {}), replace: !!config?.configured } : {});
      setNewKey(result.apiKey || ""); setInputKey(""); setShowKey(false); setConfirmAction(null);
      await load();
      toast(action === "disable" ? "Đã tắt webhook SePay của cửa hàng." : "Đã lưu API key. Sao chép URL và khóa sang SePay để hoàn tất kết nối.");
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="store-sepay-settings" aria-label="Kết nối SePay cửa hàng">
    <div className="flex-between"><h4>Kết nối SePay</h4>{config && <span className="tag">{config.configured ? config.enabled ? "Đã cấu hình" : "Đã tắt" : "Chưa cấu hình"}</span>}</div>
    <p className="small">Nhận thông báo chuyển khoản cho đơn của cửa hàng. Tại SePay → Webhooks, chọn Có tiền vào, đúng tài khoản ngân hàng và xác thực API Key. Sao chép URL và khóa dưới đây sang SePay, sau đó bật đối soát và lưu cấu hình cửa hàng.</p>
    {error && <div role="alert" className="notice">{error} <button type="button" className="button secondary" onClick={load}>Thử lại</button></div>}
    {!config && !error && <p className="small">Đang tải kết nối SePay…</p>}
    {config && <>
      <label className="field">Webhook URL<input type="url" readOnly value={config.webhookUrl} onFocus={e => e.currentTarget.select()} /></label>
      <button type="button" className="button secondary" onClick={() => copy(config.webhookUrl)}><Copy size={14} /> Sao chép URL</button>
      {config.configured && <p className="small">API key: ••••{config.api_last4}. {config.last_received_at ? `Giao dịch được xử lý gần nhất: ${formatDateTime(config.last_received_at, "utc")}.` : "Chưa ghi nhận giao dịch qua webhook này."}</p>}
      <label className="field">API key webhook (tùy chọn)<input type="password" autoComplete="new-password" value={inputKey} onChange={e => setInputKey(e.target.value)} minLength={24} maxLength={200} pattern="[A-Za-z0-9_-]+" placeholder="Để trống để hệ thống tạo khóa mới" disabled={busy} /></label>
      <p className="small">Khóa tự nhập cần 24–200 ký tự gồm chữ, số, dấu gạch ngang hoặc gạch dưới. Đây là khóa xác thực webhook, không phải API token truy vấn tài khoản SePay.</p>
      <div className="store-sepay-actions">
        <button type="button" className="button secondary" disabled={busy || (!!inputKey.trim() && !/^[A-Za-z0-9_-]{24,200}$/.test(inputKey.trim()))} onClick={() => config.configured ? setConfirmAction("credentials") : void save("credentials")}>{config.configured ? "Đổi API key" : "Tạo kết nối SePay"}</button>
        {config.enabled && <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmAction("disable")}>Tắt kết nối</button>}
      </div>
      {confirmAction && <div className="notice" role="alert"><p>{confirmAction === "disable" ? "Tắt kết nối sẽ ngừng nhận thanh toán tự động qua webhook này. Khách vẫn có thể chuyển khoản; bạn cần đối soát thủ công." : "Đổi API key sẽ vô hiệu hóa khóa cũ ngay. Cần cập nhật khóa mới trên SePay để tiếp tục nhận thanh toán tự động."}</p><div className="store-sepay-actions"><button type="button" className="button" disabled={busy} onClick={() => save(confirmAction)}>Xác nhận</button><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmAction(null)}>Quay lại</button></div></div>}
      {newKey && <div className="notice" role="status"><p><strong>API key mới — chỉ hiển thị trong lần lưu này</strong></p><label className="field">API key vừa lưu<input readOnly type={showKey ? "text" : "password"} value={newKey} onFocus={e => e.currentTarget.select()} /></label><div className="store-sepay-actions"><button type="button" className="button secondary" onClick={() => copy(newKey)}><Copy size={14} /> Sao chép API key</button><button type="button" className="button secondary" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "Ẩn API key" : "Hiện API key"}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button><button type="button" className="button secondary" onClick={() => setNewKey("")}>Đã lưu khóa</button></div><p className="small">Tại SePay chọn xác thực API Key và nhập khóa này. SePay sẽ gửi Authorization: Apikey &lt;khóa&gt;. Hệ thống không hiển thị lại khóa sau khi tải lại trang.</p></div>}
      <p className="small"><a href="https://docs.sepay.vn/tich-hop-webhooks.html" target="_blank" rel="noreferrer">Hướng dẫn cấu hình webhook SePay</a>. Không bật “bỏ qua giao dịch không có mã” nếu SePay chưa nhận diện tiền tố FLR. Hệ thống tự kiểm tra mã đầy đủ trong nội dung chuyển khoản.</p>
    </>}
  </section>;
}
