# SePay riêng cho cửa hàng

## Thiết lập

Chủ cửa hàng vào **Cấu hình cửa hàng**:

1. Điền ngân hàng, số tài khoản, tên chủ tài khoản; bật nhận chuyển khoản và lưu cấu hình.
2. Trong **Kết nối SePay**, chọn **Tạo kết nối SePay**. Có thể nhập API key webhook có sẵn (24–200 ký tự chữ, số, `-`, `_`), hoặc để trống để tạo khóa ngẫu nhiên. Khóa chỉ được hiển thị trong lần lưu này; hệ thống lưu SHA-256 và bốn ký tự cuối, không lưu khóa đầy đủ.
3. Trên SePay → Webhooks, tạo webhook sự kiện **Có tiền vào**, chọn đúng tài khoản ngân hàng, dán **Webhook URL** do cửa hàng cung cấp và chọn xác thực **API Key**. Dán API key vừa tạo. Đây là khóa xác thực webhook do hai bên thống nhất, không phải API token truy vấn tài khoản SePay.
4. Không bật lọc bỏ giao dịch không có mã nếu SePay chưa cấu hình nhận diện tiền tố `FLR`. Fleurious tự nhận diện mã đầy đủ trong `code`, `content` hoặc `description`, kể cả trường hợp ngân hàng bỏ dấu gạch ngang.
5. Bật **Tự động đối soát qua SePay**, chọn trạng thái đơn sau khi nhận tiền và bấm **Lưu cấu hình**. Trạng thái “Đã cấu hình” chỉ xác nhận đã có khóa; thời điểm giao dịch được xử lý gần nhất chỉ có sau khi nhận webhook hợp lệ.

URL có dạng `/api/sepay/webhook/stores/<storeId>`, được tạo từ `APP_ORIGIN`; production cần cấu hình đúng domain HTTPS. Không nhập URL bên ngoài vì đây là địa chỉ Fleurious nhận thông báo. Không tự thêm API key vào query string.

SePay gửi `Authorization: Apikey <khóa>`. Hướng dẫn gốc: [Tích hợp webhook SePay](https://docs.sepay.vn/tich-hop-webhooks.html).

## Phạm vi và an toàn giao dịch

- Chỉ chủ cửa hàng được đọc metadata và tạo/đổi/tắt kết nối. API đọc và storefront không trả khóa đầy đủ hoặc bản băm. Audit chỉ ghi hành động, không ghi khóa.
- API key chỉ hợp lệ với endpoint và đơn hàng của cửa hàng tương ứng. Không thanh toán hóa đơn dịch vụ platform qua webhook cửa hàng. Khi đã tạo khóa riêng (kể cả đang tắt), khóa chung platform không thể thay thế khóa cửa hàng.
- Các cửa hàng đang sử dụng webhook chung tiếp tục hoạt động cho đến khi chủ cửa hàng chủ động tạo kết nối riêng. Đổi API key có xác nhận và vô hiệu hóa khóa cũ ngay; cần cập nhật lại trên SePay. Tắt kết nối không ngăn khách chuyển khoản, nên cửa hàng cần đối soát thủ công trong thời gian tắt.
- Kiểm tra mã thanh toán, tài khoản nhận tiền trong QR, phiên còn hiệu lực, số tiền đủ và đơn chưa hủy trước khi ghi sổ. Giữ nguyên xử lý số tiền/phiên QR hiện có: tiền thiếu, chuyển muộn, sai mã hoặc đơn hủy cần đối soát thủ công; không tự hoàn tiền.
- Giao dịch dùng chung sổ thu tiền, khóa giao dịch theo cửa hàng và chống ghi nhận lặp. Mã sự kiện được phân vùng theo cửa hàng; retry đồng thời không tạo hai phiếu thu. Khi thu đủ, cập nhật trạng thái thanh toán và trạng thái xử lý đã cấu hình; đơn nhận tại quầy đã hoàn tất không bị chuyển lùi trạng thái.
- `SEPAY_WEBHOOK_ENABLED=false` vẫn tắt toàn bộ endpoint webhook. Kết nối của từng cửa hàng có công tắc riêng; không phụ thuộc khóa SePay của platform.

## Migration và kiểm thử

Migration `store-sepay-v1` chỉ tạo bảng `store_sepay_integrations` và thêm marker; không sửa dữ liệu tài khoản ngân hàng, đơn hàng hay cấu hình platform hiện có. Đã chạy trên local, QA và TiDB production ngày 20/10/2026. Trước khi chạy production đã sao lưu và khôi phục kiểm tra đủ 72 bảng, diễn tập migration hai lần; kiểm tra sau migration xác nhận dữ liệu cũ, tài khoản ngân hàng và credential platform được giữ nguyên. Bản sao lưu và báo cáo giữ tại `.local/`, không đưa vào Git. Migration không tự tạo khóa hoặc bật SePay cho cửa hàng.

- Local: `npm run db:sepay:store`.
- TiDB: sao lưu và kiểm tra khôi phục trước, rồi `npm run db:sepay:store:tidb -- --production-backup-verified`. Chạy migration trước khi triển khai code mới.
- `npm run test:sepay:store`: yêu cầu `MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=3310`, `MYSQL_DATABASE=fleur_saas_test`. Chạy handler Next thật và SQL, chặn mọi gọi mạng bên ngoài, tự dọn fixture.
- `npm run test:sepay:store:ui`: app local cổng 3000, mọi API được giả lập; kiểm tra tạo/đổi/tắt khóa, che khóa, tải lại và bố cục Chromium/WebKit ở 320, 390, 1440px.
- Hồi quy `test:sepay`, `test:tenant` và `scripts/test-billing-inprocess.ts plan-changes` trên QA. Không chuyển tiền ngân hàng thật trong bộ kiểm thử.
