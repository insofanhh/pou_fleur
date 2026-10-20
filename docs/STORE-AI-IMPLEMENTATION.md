# Trợ lý AI DeepSeek cho Fleurious

## Phạm vi đang có

- Workspace → Trợ lý AI (`/workspace/[store]/ai`), chỉ owner/admin/manager/support của Khởi đầu (ID 1), Studio (ID 2) và Atelier (ID 3). Editor/customer và store chờ duyệt/đóng băng bị chặn ở backend.
- Hội thoại riêng theo store, tài khoản và vai trò; tra sản phẩm, khách, đơn, lịch/ghi chú, analytics, việc cần chú ý và cơ hội CRM theo quy tắc. Mỗi số liệu có nguồn và thời điểm. Doanh thu dùng đúng định nghĩa analytics hiện có, không tự suy ra lợi nhuận.
- Tạo nháp hoặc xem trước đơn, ghi chú lịch, nhắc việc và ticket báo lỗi. Chỉ nút xác nhận thực hiện ghi. Không cung cấp tool xác nhận thanh toán/hoàn tiền, thay vai trò, đổi gói, gửi chiến dịch, SQL hay sửa hệ thống.
- Đơn AI dùng cùng dịch vụ tạo đơn thủ công, kiểm tra giá/tồn kho/lịch giao/quyền và idempotency. Ghi đơn + action + audit trong một transaction; khởi tạo `pending`/`unpaid`, tái sử dụng email/outbox/QR hiện có.
- Platform → Cấu hình: lưu/đổi/xóa key DeepSeek, bật/tắt, chọn model, giới hạn output, kiểm tra kết nối; tiếp nhận báo lỗi đã được nhân viên xác nhận. Store có cấu hình kiến thức và bật/tắt riêng.
- Khởi đầu mặc định 50 lượt/tháng, Studio 300, Atelier 1.500; admin chỉnh qua Danh mục gói dịch vụ. Hạn mức theo phiên bản gói đã cấp, làm mới đầu tháng Hà Nội. Succeeded + running còn lease chiếm lượt; lỗi không tính lượt. Input/output token và tên/trạng thái tool được ghi nhận, không log payload tool. Các tác vụ nhắc đã lưu không cần gọi mô hình hoặc tiêu thụ lượt.
- Nhắc việc có người nhận, giờ cụ thể và tùy chọn liên kết đơn. Worker kiểm tra lại quyền, gói, hạn sử dụng, ngày/khung giao và trạng thái đơn; hủy nhắc lỗi thời. Claim, outbox và trạng thái nhắc cùng transaction; mỗi generation chỉ có một notification. Inbox giữ đầy đủ nội dung; push dùng lời nhắc chung để tránh lộ liên hệ khách trên màn hình khóa.

## Cấu hình và triển khai

1. Chạy `npm run db:ai` ở local; migration chỉ thêm bảng, chạy lại được. Migration SaaS tổng cũng gọi migration AI.
2. Remote/TiDB: backup và xác minh khôi phục trước, sau đó `npm run db:ai:tidb -- --production-backup-verified`. Không seed lại database hoặc đổi đơn/thanh toán cũ. Chạy trước khi triển khai code sử dụng bảng mới.
3. Máy chủ cần `CREDENTIAL_ENCRYPTION_KEY` tối thiểu 32 ký tự ngẫu nhiên, ổn định; nếu chưa có sẽ dùng `CRON_SECRET` đủ dài. AES-256-GCM với nonce riêng cho mỗi lần lưu. Đổi master cần nhập lại DeepSeek key. Không đổi master độc lập giữa các instance cùng database.
4. DeepSeek API key chỉ nhập ở Platform → Cấu hình, không đặt trong biến `NEXT_PUBLIC_*`, env provider hoặc gửi qua chat. API trả về metadata cấu hình, không trả ciphertext/key. Chọn `deepseek-flash` làm mặc định; model `deepseek-v4-pro` là lựa chọn bổ sung theo quyền tài khoản DeepSeek. Dùng nút Kiểm tra kết nối sau khi lưu key.
5. Bật trợ lý sau khi kết nối thành công. Chạy thử trên store Khởi đầu/Studio/Atelier trước khi mở rộng. Tắt AI không ảnh hưởng UI đơn/CRM/thanh toán đang có.

## Vercel Hobby và lịch nhắc nền

Không thêm cron mỗi phút vào `vercel.json`: project dùng Hobby và worker Vercel hiện có chạy hằng ngày. Worker email hằng ngày đã tích hợp xử lý nhắc bù, nhưng không bảo đảm nhắc sát giờ.

Để nhắc mỗi phút khi đóng website, cấu hình scheduler ngoài gọi:

- GET `https://www.fleurious.store/api/ai/reminders`
- Header `Authorization: Bearer <CRON_SECRET>` của production (tối thiểu 32 ký tự); giữ trong kho secret của scheduler, không đặt query string.
- Chu kỳ 1 phút, retry khi nhận lỗi; request lặp không nhân đôi thông báo.

Endpoint không nhận store hoặc người nhận từ scheduler và không dùng DeepSeek key. Không có credential scheduler trong repository; kết nối scheduler production là bước cấu hình hạ tầng riêng. Chưa được cấu hình scheduler mỗi phút thì không giới thiệu tính năng nhắc sát giờ như đã hoạt động.

## Kiểm thử

### Khởi đầu có AI (20/10/2026)

- Cả ba tier được dùng cùng luồng AI theo vai trò. Mặc định: Khởi đầu 50, Studio 300, Atelier 1.500 lượt/tháng. Platform → Danh mục gói dịch vụ có trường Lượt AI / tháng cho cả ba gói, từ 0 đến 100.000. Đặt 0 chặn chat mới, vẫn xem được lịch sử và nhận nhắc việc đã lưu.
- Lượt dùng chung cho nhân sự trong store, làm mới đầu tháng Hà Nội. Đổi gói không xóa lượt đã dùng trong tháng; thất bại provider và gửi lại cùng requestId không bị tính thêm. Phiên bản gói đã cấp giữ quota cũ khi admin đổi catalog, tương tự các hạn mức khác.
- `starter-ai-allowance-v1` chuyển một lần các quota Khởi đầu thiếu hoặc 0 do UI cũ bắt buộc thành 50 ở catalog và các phiên bản đã cấp. Giữ giá, ngày dùng thử, kỳ hạn, hóa đơn và quota khác; giữ quota AI dương tùy chỉnh. Marker ngăn chạy lại ghi đè số 0 admin chủ động đặt sau cập nhật.
- Local đã chạy `npm run db:ai:starter`, có bản sao các hàng bị ảnh hưởng trong `.local/backups/`. Chưa chạy thay đổi này trên TiDB. Trước khi đưa code mới lên production, sao lưu đầy đủ và thử khôi phục rồi chạy `node --env-file=.env.tidb.local scripts/migrate-starter-ai.mjs --production-backup-verified`. Chạy migration trước khi cho admin thao tác quota bằng UI mới. `db:ai`, `db:ai:tidb` và migration SaaS đầy đủ cũng bao gồm bước này.
- Kiểm thử: 12 kiểm tra migration; 48 kiểm tra API với handler thật, auth/tenant/SQL/database QA thật và provider giả lập; 32 AI unit; 17 UI cấu hình/đăng ký/billing; 78 UI widget Chromium/WebKit. `npm test` và build production `.local/starter-ai-release` thành công. Không gửi SMTP/push thật trong QA; email đơn được xác minh qua outbox.
- `npm run test:ai:inprocess` chạy handler trong request context Next, không mở server: yêu cầu env QA `MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=3310`, `MYSQL_DATABASE=fleur_saas_test`, user QA tương ứng. Ghi chú, nhắc việc, đơn hàng và fixture đều được dọn sau test. Đây là integration trong tiến trình, không phải kiểm thử HTTP deployment hay gọi DeepSeek thật mới.

- `npm run test:ai`: policy/role, date/quota Hà Nội, schema chống chèn tenant, tenant SQL, encryption/tamper, provider normal/tool/malformed/HTTP errors/network/finish truncation. Không gọi API tính phí.
- `npm run test:ai:integration`: chỉ QA DB `fleur_saas_test` port 3310, app QA dùng cùng DB và `EMAIL_ENABLED=false`. Khởi chạy QA server bằng preload `--import ./scripts/test-ai-provider-mock.mjs` trong `NODE_OPTIONS` (file tự từ chối DB khác). `CRON_SECRET` và master encryption của QA chỉ dùng giá trị giả, không chép key thật. Preload không được import bởi code ứng dụng.
- `node --env-file=.env.local --import tsx scripts/test-ai-live.ts`: gọi DeepSeek thật và có phí API nhỏ; đọc cấu hình đã mã hóa tại local, tạo/xóa fixture trong QA port 3310 và app thật port 3006. App QA phải chạy cùng master encryption với local, không preload mock, không bật SMTP/push thật. Không dùng script này với app production.
- Ảnh/report tại `.local/ai-qa/`, không commit dữ liệu QA hay key. Kiểm tra email xác minh outbox, không gửi tới khách thật.

### Kết quả xác minh ngày 20/10/2026

- Bản build production cuối và `npm test` thành công; 29 kiểm tra AI unit thành công.
- 36 kiểm tra API/UI trên app QA development thành công, gồm desktop và chiều rộng 360/390/768 px. Kiểm tra SQL tenant và domain events trên database QA cũng thành công.
- 6 kiểm tra DeepSeek thật thành công, gồm nguồn dữ liệu, xem trước và xác nhận note/đơn; không gửi email tới khách thật.
- 4 kiểm tra cấu hình trực tiếp trên database QA thành công sau bản build cuối: key được mã hóa và không trả về API, xóa key tự tắt AI, chặn bật AI khi chưa có key, audit không lưu key. Fixture được dọn và cấu hình QA được khôi phục.
- Chưa chạy lại bộ API/UI trên bản production cuối sau các sửa nhỏ về Ghost và xóa key: bộ phê duyệt tự động vẫn chặn khởi chạy server QA với lý do `blocked by policy`, kể cả sau khi người dùng cho phép chạy ở localhost với database riêng và tắt email/push thật. Không coi kết quả development trước đó là xác nhận bộ regression production cuối.
- Chưa chạy migration trên TiDB, chưa push/deploy và chưa nối scheduler production mỗi phút.

Đây là nền vận hành với hành động có xác nhận. Fine-tuning, embeddings/tài liệu tải lên, dự đoán doanh số, giám sát lỗi tự động toàn hệ thống, quy tắc cảnh báo tùy chỉnh/giờ yên lặng và báo cáo định kỳ nâng cao là các bước tiếp theo trong kế hoạch, chưa được quảng bá là đã có. Chất lượng mô hình cần đánh giá thêm trên tình huống thực tế; kiểm thử tích hợp không phải bảo đảm AI luôn chọn đúng công cụ.

Tham chiếu API chính thức: [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/), [Tool calls](https://api-docs.deepseek.com/guides/tool_calls/), [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/).
