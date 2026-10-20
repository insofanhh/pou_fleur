export const emailVariables = {
  account_url: "Trang tài khoản",
  reset_url: "Liên kết đặt lại mật khẩu",
  invoice_period_start: "Ngày bắt đầu kỳ sử dụng",
  trial_days: "Số ngày dùng thử được cấp",
  owner_name: "Tên chủ cửa hàng",
  plan_name: "Tên gói dịch vụ",
  invoice_reference: "Mã hóa đơn dịch vụ",
  invoice_amount: "Số tiền cần thanh toán",
  invoice_due_date: "Hạn thanh toán",
  invoice_period_end: "Ngày hết hạn gói",
  billing_url: "Trang gia hạn gói",
  store_name: "Tên cửa hàng",
  customer_name: "Tên khách hàng",
  order_reference: "Mã đơn hàng",
  order_items: "Danh sách hoa",
  order_total: "Tổng thanh toán",
  fulfillment_method: "Hình thức nhận hoa",
  pickup_location: "Địa điểm nhận tại cửa hàng",
  picked_up_at: "Thời điểm đã nhận hoa",
  payment_method: "Phương thức thanh toán",
  cod_payer: "Người thanh toán COD",
  cod_outstanding: "COD còn phải thu",
  order_status: "Trạng thái hiện tại",
  previous_status: "Trạng thái trước",
  recipient_name: "Người nhận hoa",
  delivery_address: "Địa chỉ giao",
  delivery_date: "Ngày giao",
  delivery_slot: "Khung giờ giao",
  tracking_url: "Trang tra cứu",
  campaign_name: "Tên chương trình",
  campaign_message: "Nội dung chương trình",
  promotion_code: "Mã ưu đãi",
  event_date: "Thời gian sự kiện",
  store_url: "Đường dẫn cửa hàng",
  workspace_url: "Đường dẫn workspace",
  approval_status: "Trạng thái duyệt",
};
export const orderStatusNames: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  preparing: "Đang chuẩn bị",
  ready: "Sẵn sàng giao",
  shipping: "Đang giao",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
};
export const demoEmailValues: Record<string, string> = {
  fulfillment_method: "Khách lấy tại cửa hàng",
  pickup_location: "Fleurious · Hà Nội",
  picked_up_at: "20/10/2026 15:00",
  account_url: "https://example.com/account",
  reset_url: "https://example.com/reset-password?token=demo",
  invoice_period_start: "25/10/2026",
  trial_days: "14",
  owner_name: "An",
  plan_name: "Studio",
  invoice_reference: "INV-1024",
  invoice_amount: "299.000 VNĐ",
  invoice_due_date: "25/10/2026",
  invoice_period_end: "25/11/2026",
  billing_url: "https://example.com/workspace/1/billing",
  store_name: "Fleurious",
  customer_name: "An",
  order_reference: "FL20260908DEMO",
  order_items: "Pure Poetry · M × 1 · 897.000 VNĐ",
  order_total: "932.000 VNĐ",
  payment_method: "Chuyển khoản ngân hàng",
  cod_payer: "Người đặt hoa trả tiền",
  cod_outstanding: "500.000 VNĐ",
  order_status: "Đang chuẩn bị",
  previous_status: "Đã xác nhận",
  recipient_name: "Minh",
  delivery_address: "12 Nguyễn Huệ, TP. Hà Nội",
  delivery_date: "20/10/2026",
  delivery_slot: "09:00–12:00",
  tracking_url: "https://example.com/track-order",
  campaign_name: "Một ngày thật đẹp",
  campaign_message:
    "Fleurious gửi bạn một lời chúc và những thiết kế hoa mới nhất.",
  promotion_code: "FLEUR10",
  event_date: "20/10/2026",
  store_url: "https://example.com/s/fleur",
  workspace_url: "https://example.com/workspace/1",
  approval_status: "Đã duyệt",
};
export function interpolateEmail(
  source: string,
  values: Record<string, string>,
) {
  return source.replace(/{{\s*([a-z_]+)\s*}}/g, (_, key) => values[key] ?? "");
}
export function escapeEmail(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function emailHTML(body: string, unsubscribeUrl?: string, senderName = 'Fleurious', storeName?: string) {
  // Inline styles also work in email clients that do not load workspace CSS.
  const storeLabel = storeName
    ? `<div class="store-workspace-label" style="margin-top:8px;font-size:13px;font-weight:400;line-height:1.5;letter-spacing:normal;color:#9a9aa2;overflow-wrap:anywhere">${escapeEmail(storeName + "'s workspace")}</div>`
    : "";
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><table role="presentation" style="width:100%;padding:32px 12px"><tr><td align="center"><table role="presentation" style="width:100%;max-width:600px;background:#fff;border-radius:20px"><tr><td style="padding:36px"><div style="margin-bottom:32px"><div style="font-size:38px;font-weight:700;letter-spacing:-2px">${escapeEmail(storeName ? "Fleurious" : senderName)}</div>${storeLabel}</div><div style="font-size:16px;line-height:1.8;overflow-wrap:anywhere">${escapeEmail(body).replace(/\n/g, "<br>")}</div><hr style="margin:32px 0;border:0;border-top:1px solid #e5e5e5"><p style="font-size:12px;color:#666">Fleurious · Hoa cho những điều không thể nói.</p>${unsubscribeUrl ? `<p style="font-size:12px"><a style="color:#666" href="${escapeEmail(unsubscribeUrl)}">Hủy nhận email chương trình</a></p>` : ""}</td></tr></table></td></tr></table></body></html>`;
}
