# Tài khoản nền tảng và Ghost

Tại `/platform/users`, chỉ người có quyền quản trị nền tảng được tìm kiếm/lọc/phân trang, tạo, xem hồ sơ, sửa, khóa/mở khóa, cấp/thu hồi quyền platform, xóa mềm và khôi phục tài khoản. Quyền store nằm trong membership riêng, không được suy ra từ quyền platform.

Tạo hoặc đổi mật khẩu yêu cầu ít nhất 12 ký tự. Bỏ trống mật khẩu khi sửa để giữ nguyên. Thay email/mật khẩu/quyền hoặc khóa/xóa tài khoản thu hồi các phiên đăng nhập, token reset, luồng liên kết OAuth và đăng ký push của tài khoản đó.

Không được tự khóa, xóa hoặc thu hồi quyền quản trị của mình; thay đổi quyền được tuần tự hóa trong transaction. Tài khoản còn sở hữu store chưa đóng không thể xóa. Xóa mềm giữ user ID, đơn hàng và quan hệ store; email vẫn được giữ để tránh gán nhầm lịch sử cho tài khoản mới. Khôi phục đưa tài khoản về trạng thái khóa, không có quyền platform; mở khóa/cấp quyền là thao tác riêng sau đó.

## Ghost

1. Chọn **Ghost** ở tài khoản hoạt động không có quyền platform.
2. Nhập lý do hỗ trợ, chọn **Bắt đầu Ghost**.
3. Hệ thống chuyển đến homepage hoặc workspace phù hợp với membership của user. Thanh báo Ghost luôn có nút **Quay lại admin**.

Phiên Ghost tối đa 20 phút, gắn với đúng phiên admin gốc và được kiểm tra lại trên server. Quyền và dữ liệu thao tác là của user; không tự được quyền tại store khác. Không Ghost tài khoản platform, không mở phiên Ghost lồng nhau. Thay đổi tài khoản, mật khẩu, phân quyền/nhân sự, consent cá nhân và đăng ký push bị chặn trong phiên hỗ trợ. Google login/link cũng bị chặn.

Nếu hết hạn, user bị khóa, user được nâng thành platform admin, admin mất quyền hoặc phiên admin gốc bị thu hồi thì Ghost không còn dùng được. Hết hạn không tự chuyển thao tác đang dở thành thao tác của admin. Nút quay lại kiểm tra phiên gốc; nếu phiên đó bị thu hồi thì phải đăng nhập lại. Ghost sử dụng cookie trên trình duyệt nên áp dụng cho các tab dùng chung phiên; tab khác cập nhật danh tính khi được focus. Không bật thông báo push của user trên thiết bị hỗ trợ.

Nhật ký platform lưu admin thực, user đích, thời điểm và lý do bắt đầu/kết thúc; yêu cầu ghi dữ liệu trong Ghost có method/path để đối chiếu nhật ký nghiệp vụ. Không lưu mật khẩu, token hoặc toàn bộ request body vào nhật ký. Hồ sơ user hiển thị các sự kiện quản trị gần nhất.

Tại `/platform/stores`, nút **Ghost** ở cột **Thao tác** mở phiên bằng tài khoản chủ cửa hàng. Máy chủ tự xác định chủ hiện tại và kiểm tra membership `owner` đang hoạt động; không nhận tài khoản hoặc đường dẫn chuyển hướng từ client. Sau khi nhập lý do, chuyển thẳng tới workspace của store được chọn, kể cả khi chủ có nhiều store. **Quay lại admin** đưa về danh sách store. Nhật ký bắt đầu/kết thúc có thêm store ID; phiên được đối chiếu bằng hash, không lưu token gốc. Chủ bị khóa/xóa hoặc có quyền platform không thể được Ghost. Các giới hạn của Ghost tài khoản vẫn áp dụng. Tính năng này dùng các bảng hiện có, không cần migration bổ sung.

## Migration và kiểm thử

Chạy migration SaaS trước khi deploy phiên bản này. Migration bổ sung ba bảng độc lập, có thể chạy lại: `platform_user_states`, `platform_audit_logs`, `ghost_sessions`. Không đổi mật khẩu hoặc dữ liệu đơn cũ. Với production cần backup/restore drill và staging như [SAAS-SETUP.md](SAAS-SETUP.md).

Đã backup/restore và migration local ngày 18/10/2026, đối chiếu fingerprint dữ liệu cũ thành công; báo cáo riêng tại `.local/migration-report.json`. Chưa migration TiDB/deploy Vercel production.

Trên database QA `fleur_saas_test` cổng 3310, cấu hình `TEST_ORIGIN` trỏ app QA rồi chạy:

```sh
npm run test:platform-users
npm run test:platform-users:ui
npm run test:platform-store-ghost
```

Các suite được đưa vào `npm run test:integration`. API kiểm tra CRUD, quyền, version, thu hồi session, cookie Ghost, hết hạn và audit. UI thao tác CRUD/Ghost thật trên fixture QA và kiểm tra desktop/mobile. Suite Ghost store kiểm tra xác định chủ, chọn đúng workspace khi có nhiều store, quyền truy cập, audit và quay lại danh sách store. Các suite không gửi email/push ra ngoài.

Ghost từ danh sách store đã đạt 15 kiểm tra API/UI trên production build QA ngày 18/10/2026, gồm desktop 1440px và mobile 390px. Hồi quy Ghost tài khoản cũ đạt 31 assertions API và các workflow UI desktop/mobile; `npm test` và build production đạt. Ảnh kiểm tra: `.local/screenshots/store-ghost-*`.

Kết quả ngày 18/10/2026 trên production build QA: 31 assertions API và toàn bộ luồng UI mới đạt; suite hồi quy 55 API SaaS, SQL isolation, 5 queue/CRM/billing checks và 57 UI assertions cũng đạt. `npm test` và build Turbopack đạt. Log local: `.local/platform-users-final-integration.log`; ảnh desktop/mobile: `.local/screenshots/platform-users-*`.
