# Trải nghiệm Free và một lượt dùng thử gói trả phí

Chính sách ngày 20/10/2026 thay thế cơ chế tự cấp Khởi đầu và một lượt discovery trước đây.

| Gói | Kỳ sử dụng | Lượt dùng thử |
| --- | --- | --- |
| Trải nghiệm, ID 4 | Miễn phí không giới hạn ngày | Không tiêu lượt |
| Khởi đầu / Studio / Atelier, ID 1–3 | Trial N ngày nếu còn lượt, sau đó thanh toán theo tháng | Một lượt chung theo tài khoản |
| Paid plan không mở trial / tài khoản đã dùng lượt | Nhận đủ tiền mới cấp kỳ | Không cấp thêm |

N lấy từ `trial_days` do platform cấu hình, không hardcode 30. Lưu snapshot phiên bản gói, ngày thử, giá, hạn mức khi đăng ký/chọn trial. Chờ duyệt chỉ giữ lượt; duyệt thành công mới bắt đầu thời gian. Đổi cấu hình không sửa quyền đã giữ. Preview không ghi hóa đơn/gửi email/tiêu lượt. Offer cũ phải xem lại khi cấu hình thay đổi. Đăng ký chọn gói nào nhận gói đó; bỏ `plan_id` mặc định Trải nghiệm.

Mỗi tài khoản/email/số điện thoại vẫn chỉ mở một cửa hàng. Trial theo owner user ID; Google/password của cùng user dùng chung lịch sử. Mọi trial mới dùng bucket `discovery`. Bất kỳ claim cũ `starter` hoặc `discovery`, kể cả đã hết hạn, đều ngăn nhận thêm lượt. Hai quyền đã cấp theo chính sách cũ vẫn giữ lịch, số ngày, giá. Pending approval dùng đúng bucket/version cũ. Từ chối/đóng đăng ký chưa bắt đầu giải phóng reservation theo luồng hiện có. Owner row lock chống nhận hai lượt đồng thời.

## Hạn mức và UI

Free mặc định: 10 sản phẩm đang bán, 1 nhân sự hoạt động (gồm owner), 100 MB, 50 email cửa hàng/tháng, 10 lượt AI/tháng. Platform sửa được tên và mọi hạn mức; server giữ giá/ngày thử bằng 0. Đây là giới hạn sử dụng tính năng hiện có, chưa có bộ bật/tắt riêng từng chức năng. Free cũ cũng giữ snapshot, không tự đổi quota khi sửa danh mục. Email hệ thống không tiêu quota store; email đơn hàng/marketing có tiêu quota. Tháng email/AI theo lịch Hà Nội, không reset khi đổi gói. AI quota 0 chặn chat mới nhưng giữ lịch sử/nhắc việc đã lưu.

`/start` giữ ba card paid và dòng “Tiếp tục với gói dùng thử” ở dưới để chọn Free, kèm giải thích “0 VNĐ, không giới hạn ngày”. Mặc định Free. Workspace chỉ có ba card paid, không có `billing-free-choice` hoặc nút chọn Free. `billing-current` phản ánh gói thực tế; chỉ hiện Trải nghiệm khi đã được cấp Free. Platform quản lý đủ bốn gói bằng nút lưu chung.

## Chuyển gói, hóa đơn, đóng băng

- Free → trial paid: bắt đầu khi xác nhận nếu còn lượt. Đổi gói/quay về Free không cấp lại lượt.
- Free → paid: nhận đủ tiền thì nâng ngay; chưa trả/thu một phần vẫn giữ Free.
- Tự hạ về Free khi hết quyền paid/trial mà chưa thanh toán đủ, hoặc ngừng gia hạn rồi hết kỳ. Kỳ đã mua/trial đã giữ được kích hoạt trước khi xét hết hạn. Chụp phiên bản Free mới nhất lúc chuyển; giữ dữ liệu khi vượt quota, chặn tạo thêm; không xóa dữ liệu. Marketplace tiếp tục hiển thị cửa hàng. API ghi/checkout, truy cập billing và worker đều áp dụng chuyển gói, không phụ thuộc cron.
- Free không phát sinh hóa đơn tháng, ngừng gia hạn, nhắc 5/1 ngày hay đóng băng vì hết kỳ.
- Không đóng băng cửa hàng vì paid/trial hết hạn; chuyển Free và gửi một thông báo/email đổi gói, ghi audit. Không tạo hóa đơn Free hoặc reset lượt thử/counter email/AI. Hóa đơn cũ, công nợ và tiền thu một phần giữ nguyên để đối soát/thanh toán. Thu đủ hóa đơn còn hiệu lực thì áp dụng paid ngay; hóa đơn/QR đã hủy hoặc timeout vẫn phải đối soát theo quy tắc cũ.
- QR chờ cần thanh toán/hủy rõ ràng trước khi đổi lựa chọn. Không xóa thu một phần/công nợ bằng trial hoặc Free. Giữ hạn 10 phút và ledger chống trùng. Tiền vào mã đã hủy/hết hạn để platform đối soát.
- Khóa thủ công của platform không được tháo bằng Free/trial/thanh toán.

Tự hạ về Free ghi audit trực tiếp, không sinh hóa đơn. Các lịch hạ Free đã xác nhận từ phiên bản cũ vẫn được giữ: bản ghi giá trị 0 dùng để audit, mốc cuối là mốc kỹ thuật; worker muộn vẫn áp dụng. Subscription Free có `access_ends_at/current_period_end/period_end = NULL`. UI/email hiển thị không giới hạn ngày, không gửi biên nhận thu tiền 0 đồng. Khóa billing cũ được tháo khi chuyển Free, khóa thủ công của platform được giữ.

## Migration và phát hành

`experience-plan-v1` chỉ thêm ID 4, phiên bản đầu và marker. Không tự chuyển store cũ sang Free, sửa hóa đơn/tiền/ngày đã cấp. ID 4 có sẵn nhưng thiếu marker thì dừng kiểm tra, không ghi đè. Chạy lặp giữ quota platform đã chỉnh.

Local: `npm run db:experience`; cũng được gọi sau AI trong `db:saas`. Production: backup, diễn tập restore trên bản sao, kiểm tra ID 4 trống và paid IDs đúng; sau đó `npm run db:experience:tidb -- --production-backup-verified` **trước khi deploy code**. Không seed/reset lại dữ liệu, không chạy migration trong request. Thay đổi này chưa triển khai production.

## Đánh giá và nghiên cứu

Free giới hạn giúp tiệm nhỏ dùng lâu dài; trial paid để khám phá gói cao hơn. Theo dõi chi phí email/AI trên mỗi Free store hoạt động, tỷ lệ Free → trial → paid, quota chạm trần và tỷ lệ gia hạn. Không tính Free/trial là doanh thu. Một lượt là quyết định sản phẩm Fleurious, không phải chuẩn bắt buộc. Chưa có xác minh danh tính để phát hiện tuyệt đối một người dùng nhiều tài khoản.

[Stripe – Trial offers](https://docs.stripe.com/billing/subscriptions/trials) tách giá/thời gian ưu đãi và giá sau thử, không tính trial vào MRR. [Shopify – Đổi gói](https://help.shopify.com/en/manual/your-account/manage-billing/managing-your-bills/billing-plan-changes) nhấn mạnh cần thể hiện thời điểm áp dụng và ảnh hưởng kỳ đang dùng. Fleurious giữ nâng ngay sau thanh toán, hạ cuối kỳ và không tự thu tiền; không tích hợp Stripe trong lần này.

## Kiểm thử

Env: MySQL local `127.0.0.1:3310`, database `fleur_saas_test`, tài khoản QA. Không dùng production.

- `test:experience:migration`: thêm, chạy lặp, giữ dữ liệu và chặn xung đột ID.
- `test:experience`: API đăng ký/duyệt, Free, trial, quota/email và đổi gói.
- `test:billing:inprocess -- account-trials`: lượt mới và quyền cũ.
- `test:billing:inprocess -- plan-changes`: hóa đơn, QR/SePay, hết hạn, concurrency, nâng/hạ.
- `test:billing:inprocess -- trial-billing`: snapshot, chu kỳ, nhắc 5/1 ngày, SMTP giả lập.
- `test:ai:inprocess`, `test:ai:plans:ui`, `test:email`, `npm test`, production build.

API runner dùng handler Next thật với auth/cookie/tenant/SQL, không mở server QA. Workers SMTP/push tắt; AI dùng provider giả lập. UI dùng Playwright với API fixtures trên app local. Không xác nhận inbox, ngân hàng hoặc DeepSeek thật bằng các test này.

Kết quả kiểm thử trước cập nhật tự chuyển Free: migration 9, Experience API 35, account trials 45, plan changes 62, trial billing 48, AI integration 51, AI unit 32, UI 24, email 44, timeout migration 6 kiểm tra đều đạt. `npm test` (TypeScript, tenant, ảnh/upload) và build production đều thành công. UI kiểm tra desktop 1440px, mobile 390/360px và hóa đơn Free không có hạn thanh toán. Database local đã sao lưu, diễn tập restore rồi migration; hash dữ liệu subscriptions/invoices/payments/trial claims không đổi. Production chưa migration hoặc deploy.

Kiểm thử cập nhật tự chuyển Free: Experience API 47, account trials 45, plan changes 62, trial billing 48, AI integration 51, UI 25 đều đạt; `npm test` và production build đạt. Bao gồm hủy gia hạn giữ hết kỳ, quá hạn/partial payment, khôi phục paid sau thu đủ, hóa đơn legacy thiếu version, không hạ sớm quyền đã mua, chạy đồng thời không trùng audit/email, tháo khóa billing cũ và giữ khóa thủ công. Email đóng băng/nhắc hạn cũ còn pending/failed được hủy khi fallback. Free không phát sinh hóa đơn mới, dữ liệu hiện có và lịch sử trial giữ nguyên.
