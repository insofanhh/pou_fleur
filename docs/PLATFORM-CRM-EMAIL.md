# CRM cửa hàng và email nền tảng

## Phạm vi quản lý

- **Khách hàng & CRM** tại `/workspace/:storeId/crm`: hồ sơ, phân nhóm, sinh nhật, lịch sử đơn, ghi chú, lịch chăm sóc và xuất CSV như ban đầu. Owner/admin/manager/support có quyền CRM. Mọi thao tác ràng buộc cửa hàng. Thông báo “Khách hàng mới” mở CRM.
- **Email & chương trình** tại `/platform/emails`: chỉ admin platform sửa mẫu hệ thống, tạo chương trình, xem lịch sử và kiểm tra SMTP. Audience là tài khoản đồng ý nhận tin, chủ cửa hàng hoặc chủ cửa hàng đang dùng thử. Không lấy danh bạ khách của store làm audience platform.
- Store giữ mục Email & chương trình và Chăm sóc tự động. Sáu mẫu trong ảnh (hậu mãi, sinh nhật, sự kiện, ưu đãi, xác nhận đơn, cập nhật trạng thái) sửa độc lập theo store.
- Mục “Tích hợp & hàng đợi” cũ vẫn bỏ khỏi điều hướng; cấu hình thanh toán ở `/platform/config`.

## Mẫu và thời điểm gửi

| Template | Trigger |
|---|---|
| account_welcome | Tạo tài khoản mật khẩu hoặc tài khoản Google mới; đăng nhập/liên kết không gửi lại |
| account_password_reset | Yêu cầu khôi phục; liên kết 30 phút, không lộ trong lịch sử admin |
| store_registration_pending | Đăng ký store ở chế độ chờ duyệt |
| store_approved | Duyệt thủ công hoặc tự duyệt, gồm tắt cơ chế duyệt cho các yêu cầu đang chờ |
| subscription_trial_reserved | Đăng ký thêm lượt trải nghiệm, ghi ngày bắt đầu/kết thúc đã giữ chỗ |
| subscription_trial_started | Quyền dùng thử bắt đầu, gồm đăng ký đầu tiên khi được duyệt |
| subscription_registered | Thanh toán đủ hóa đơn gói đầu tiên, hoặc gói miễn phí được xác nhận |
| subscription_payment_received | Nhận đủ tiền; ghi kỳ đã trả, không nói gói tương lai đang có hiệu lực |
| subscription_change_confirmed | Thanh toán đổi gói thành công, ghi ngày hiệu lực tương lai |
| subscription_changed | Đến thời điểm kích hoạt gói trả phí khác |
| subscription_renewed | Thanh toán đủ kỳ gia hạn cùng gói |
| subscription_renewal_5d / subscription_renewal_1d | Nhắc hóa đơn chưa trả trước hạn 5 ngày / 1 ngày; không gửi bù cả hai mốc |
| subscription_trial_expired / subscription_suspended | Hết dùng thử hoặc quá hạn thanh toán và tạm đóng băng |
| platform_news | Mẫu chương trình nền tảng; admin xem trước audience rồi chủ động gửi |

16 mẫu platform nằm trong `platform_email_templates`. Admin sửa nội dung, có kiểm tra biến phù hợp, biến nghiệp vụ bắt buộc và phiên bản để tránh ghi đè cập nhật khác. Email nghiệp vụ thiết yếu luôn bật; mẫu marketing có thể tắt. Các mẫu system cũ trong từng store được giữ để bảo toàn dữ liệu nhưng không còn là nguồn nội dung hệ thống.

Email tạo cùng transaction với nghiệp vụ; rollback không để lại thư thành công. Dedupe key ngăn xếp hàng trùng khi retry. Thư đã xếp hàng giữ nội dung tại thời điểm tạo. Migration không phát lại welcome/duyệt cho tài khoản hoặc cửa hàng cũ.

## Đánh giá custom template qua SMTP chung

**Có thể và phù hợp với SaaS này.** [Postmark Templates API](https://postmarkapp.com/developer/api/templates-api) tách template/model khỏi From đã xác minh. [Amazon SES tenants](https://docs.aws.amazon.com/ses/latest/dg/tenants.html) mô tả tài nguyên dùng chung cùng theo dõi uy tín theo tenant. Đây là cơ sở thiết kế; hệ thống hiện vẫn dùng SMTP, chưa tích hợp SES/Postmark.

- Store sửa subject/body, dùng biến cho phép, xem trước và bật/tắt mẫu riêng. Mẫu đơn bắt buộc mã đơn; mẫu trạng thái cần trạng thái mới. HTML nhập được escape thành văn bản.
- From là địa chỉ SMTP đã xác thực của nền tảng; tên hiển thị “Tên cửa hàng qua Fleurious”. Nội dung đơn có đúng store, mã đơn và đường dẫn tra cứu. Store không tùy ý giả địa chỉ gửi hoặc đọc mật khẩu SMTP.
- Marketing kiểm tra consent/suppression lúc xếp hàng và lúc gửi, kèm liên kết hủy đăng ký và header one-click. Consent platform và từng store độc lập.
- Chương trình phải xem trước đúng mẫu/audience; backend kiểm tra hash trước khi gửi, tối đa 500 người/lần, chống gửi trùng và cho hủy phần chưa gửi.

[Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en) nhấn mạnh xác thực người gửi, uy tín gửi và hủy đăng ký marketing. Gmail SMTP dùng được ở giai đoạn hiện tại nhưng các store chia sẻ giới hạn/uy tín tài khoản gửi. Khi tăng quy mô, nên dùng dịch vụ transactional có bounce/complaint và cô lập tenant/stream; không cần thay giao diện chỉnh mẫu.

## Hạn mức và vận hành

SMTP tập trung bằng `SMTP_*`, `APP_ORIGIN`, `EMAIL_ENABLED`. Admin chỉnh Email cửa hàng/tháng trong gói; store theo dõi tại Gói & hóa đơn. Hạn mức chốt theo phiên bản quyền lợi gói.

Email đơn và CRM/chăm sóc trừ hạn mức store. Email tài khoản, duyệt store, thuê bao và chương trình platform không trừ. Tháng theo lịch Việt Nam, làm mới 00:00 ngày 1. `sent`, `sending`, `uncertain` giữ chỗ; lỗi chắc chắn không chiếm hạn mức. Worker khóa store để tránh vượt hạn mức khi chạy song song. Hết hạn mức giữ thư chờ và kiểm tra lại ở lần chạy tiếp theo, sớm nhất sau một giờ. Không tự gửi lại thư có kết quả SMTP chưa rõ.

Identity mail nằm riêng trong `identity_mail`; store không đọc được thư tài khoản/reset link. Thư đơn/CRM và hệ thống liên quan store dùng tenant outbox để giữ transaction nghiệp vụ. Platform history chỉ đọc thư hệ thống và identity, không mở email khách của store.

Worker chạy sau nghiệp vụ và tại `GET /api/email/worker` với `Authorization: Bearer CRON_SECRET`. Nút kiểm tra SMTP chỉ xác thực kết nối. Cron hiện daily; hàng đợi lớn và thông báo sát thời điểm cần scheduler thường xuyên hơn phù hợp gói triển khai. SMTP tiếp nhận không đồng nghĩa chắc chắn vào inbox.

## Migration và kiểm thử

Local đã chạy `npm run db:saas`. Trước khi triển khai môi trường khác, chạy migration SaaS theo hướng dẫn database: thêm bảng platform email/cột identity mail, seed `INSERT IGNORE`; giữ template store và quyền lợi/ngày thử đã chốt. N vẫn lấy cấu hình gói.

- `npm test`: TypeScript, tenant SQL, ảnh và upload.
- `npm run test:email`: MySQL tạm, SMTP mô phỏng; rollback/dedupe, consent, retry, MIME, SMTP chung, quota và identity mail.
- `npm run test:onboarding`: database `fleur_onboarding_qa_*`, app cổng 3011, API + Chromium desktop/mobile; CRM isolation, sửa mẫu, chương trình platform, billing hooks, nhắc hạn và quota. Tự dừng app, xóa database thử và khôi phục cấu hình Next.
- Build production độc lập. `scripts/verify-smtp.ts` kiểm tra kết nối/xác thực SMTP thật, không gửi thư ra ngoài.

Kết quả kiểm thử 19/10/2026: 39 kiểm tra email; 30 kiểm tra onboarding/API/UI; 16 kiểm tra chương trình platform và billing worker đều thành công. `npm test`, build production và `git diff --check` thành công. Xác thực SMTP thật thành công; các ca gửi email dùng transport mô phỏng/MIME, không gửi thư tới khách hàng thật. Chưa kiểm chứng việc thư vào inbox qua nhà cung cấp bên ngoài. Luồng Google mới đã gắn cùng helper chào mừng trong transaction; không thực hiện đăng nhập Google thật trong QA vì không dùng credential OAuth của người dùng.
