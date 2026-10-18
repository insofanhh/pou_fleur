// Display labels only. Persisted keys and API values remain unchanged.
export const orderLabels: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  preparing: "Đang chuẩn bị",
  ready: "Sẵn sàng giao",
  shipping: "Đang giao",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
  rescheduled: "Đã đổi lịch giao",
  unpaid: "Chưa thanh toán",
  partially_paid: "Thu một phần",
  partially_refunded: "Hoàn một phần",
  paid: "Đã thanh toán",
  refunded: "Đã hoàn tiền",
};
const labels = {
  store: {
    draft: "Bản nháp",
    pending: "Chờ duyệt",
    approved: "Đã duyệt",
    rejected: "Đã từ chối",
    suspended: "Tạm đình chỉ",
    closed: "Đã đóng",
  },
  subscription: {
    free: "Miễn phí",
    active: "Đang hoạt động",
    past_due: "Quá hạn thanh toán",
    restricted: "Bị hạn chế",
    cancelled: "Đã hủy",
  },
  invoice: { open: "Chờ thanh toán", paid: "Đã thanh toán", void: "Đã hủy" },
  task: { open: "Chưa hoàn tất", done: "Đã hoàn tất" },
  notification: {
    pending: "Chờ xử lý",
    working: "Đang xử lý",
    done: "Đã xử lý",
  },
  email: {
    pending: "Chờ gửi",
    sending: "Đang gửi",
    sent: "Đã gửi",
    failed: "Gửi thất bại",
    uncertain: "Chưa xác định kết quả gửi",
    cancelled: "Đã hủy",
  },
  segment: {
    new: "Mới",
    loyal: "Thân thiết",
    vip: "VIP",
    inactive: "Cần kết nối lại",
    all: "Tất cả khách hàng",
  },
  interaction: {
    store_view: "Lượt xem cửa hàng",
    product_view: "Lượt xem sản phẩm",
    add_to_cart: "Thêm vào giỏ hàng",
    checkout_start: "Bắt đầu thanh toán",
  },
  role: {
    owner: "Chủ cửa hàng",
    admin: "Quản trị cửa hàng",
    manager: "Quản lý",
    editor: "Biên tập viên",
    support: "Chăm sóc khách hàng",
    customer: "Khách hàng",
    platform_admin: "Quản trị nền tảng",
  },
  member: { active: "Đang hoạt động", revoked: "Đã thu hồi" },
  invitation: {
    pending: "Chờ chấp nhận",
    accepted: "Đã chấp nhận",
    expired: "Đã hết hạn",
    revoked: "Đã thu hồi",
  },
  automation: {
    aftercare: "Sau khi giao hoa",
    birthday: "Đúng ngày sinh nhật",
    winback: "Lâu chưa quay lại",
  },
  limit: {
    products: "Sản phẩm",
    staff: "Nhân sự",
    storage_mb: "Dung lượng lưu trữ (MB)",
  },
  entity: {
    orders: "Đơn hàng",
    products: "Sản phẩm",
    categories: "Danh mục",
    promotions: "Khuyến mãi",
    events: "Sự kiện",
    news: "Tin tức",
    posts: "Tin tức",
    users: "Tài khoản",
    stores: "Cửa hàng",
    crm: "Chăm sóc khách hàng",
    inquiries: "Yêu cầu hỗ trợ",
    memberships: "Nhân sự cửa hàng",
    subscriptions: "Gói dịch vụ",
    invoices: "Hóa đơn",
    notifications: "Thông báo",
    email_templates: "Mẫu email",
    email_outbox: "Hàng đợi email",
    email_campaigns: "Chiến dịch email",
  },
};
export function displayLabel(kind: keyof typeof labels, value: string): string {
  const map: Record<string, string> = labels[kind];
  return map[value] || "Chưa xác định";
}
const auditLabels: Record<string, string> = {
  create: "Tạo mới",
  save: "Lưu thay đổi",
  update: "Cập nhật",
  archive: "Lưu trữ",
  settings: "Cập nhật cài đặt",
  invite: "Mời nhân sự",
  membership: "Cập nhật quyền nhân sự",
  subscription: "Cập nhật gói dịch vụ",
  subscription_cancel: "Cập nhật gia hạn gói dịch vụ",
  automation: "Cập nhật quy tắc chăm sóc",
  save_template: "Lưu mẫu email",
  retry: "Gửi lại email",
  cancel: "Hủy chiến dịch",
  queue_campaign: "Lên lịch chiến dịch",
  "manual:create": "Tạo đơn thủ công",
  "payment:collect": "Ghi nhận thu tiền",
  "payment:refund": "Ghi nhận hoàn tiền",
  "user:create": "Tạo tài khoản",
  "user:update": "Cập nhật tài khoản",
  "user:delete": "Xóa mềm tài khoản",
  "user:restore": "Khôi phục tài khoản",
  "ghost:start": "Bắt đầu Ghost",
  "ghost:stop": "Kết thúc Ghost",
  "ghost:request": "Thao tác trong phiên Ghost",
  reschedule: "Đổi lịch giao",
  broadcast: "Gửi thông báo chương trình",
  void: "Hủy hóa đơn",
  ...orderLabels,
  ...labels.store,
};
export function auditAction(value: string, entity?: string): string {
  if (entity === "orders" && orderLabels[value]) return orderLabels[value];
  if (entity === "stores" && value in labels.store)
    return displayLabel("store", value);
  if (auditLabels[value]) return auditLabels[value];
  // Some audit actions append a free-form reason after ": ". Preserve it verbatim.
  const separator = value.indexOf(": ");
  if (separator > 0 && auditLabels[value.slice(0, separator)])
    return auditLabels[value.slice(0, separator)] + value.slice(separator);
  return "Thao tác hệ thống";
}
