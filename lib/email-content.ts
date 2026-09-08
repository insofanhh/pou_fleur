export const emailVariables = {
  customer_name: "Tên khách hàng",
  order_reference: "Mã đơn hàng",
  order_items: "Danh sách hoa",
  order_total: "Tổng thanh toán",
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
};
export const orderStatusNames: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  preparing: "Đang chuẩn bị",
  shipping: "Đang giao",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
};
export const demoEmailValues: Record<string, string> = {
  customer_name: "An",
  order_reference: "FL20260908DEMO",
  order_items: "Pure Poetry · M × 1 · 897.000 ₫",
  order_total: "932.000 ₫",
  order_status: "Đang chuẩn bị",
  previous_status: "Đã xác nhận",
  recipient_name: "Minh",
  delivery_address: "12 Nguyễn Huệ, TP. Hà Nội",
  delivery_date: "20/10/2026",
  delivery_slot: "09:00–12:00",
  tracking_url: "https://example.com/track-order",
  campaign_name: "Một ngày thật đẹp",
  campaign_message:
    "Fleur gửi bạn một lời chúc và những thiết kế hoa mới nhất.",
  promotion_code: "FLEUR10",
  event_date: "20/10/2026",
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
export function emailHTML(body: string, unsubscribeUrl?: string) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><table role="presentation" style="width:100%;padding:32px 12px"><tr><td align="center"><table role="presentation" style="width:100%;max-width:600px;background:#fff;border-radius:20px"><tr><td style="padding:36px"><div style="font-size:38px;font-weight:700;letter-spacing:-2px;margin-bottom:32px">fleur®</div><div style="font-size:16px;line-height:1.8;overflow-wrap:anywhere">${escapeEmail(body).replace(/\n/g, "<br>")}</div><hr style="margin:32px 0;border:0;border-top:1px solid #e5e5e5"><p style="font-size:12px;color:#666">Fleur · Hoa cho những điều không thể nói.</p>${unsubscribeUrl ? `<p style="font-size:12px"><a style="color:#666" href="${escapeEmail(unsubscribeUrl)}">Hủy nhận email chương trình</a></p>` : ""}</td></tr></table></td></tr></table></body></html>`;
}
