# Khách nhận ngay tại cửa hàng

Trong tạo đơn thủ công → Nhận hoa & lời nhắn, chọn **Khách nhận ngay tại cửa hàng**. Không có lựa chọn hẹn đến lấy.

- Kênh tiếp nhận vẫn độc lập với hình thức nhận hoa. Đơn có thể đến từ tại cửa hàng, Zalo hoặc điện thoại.
- Không yêu cầu địa chỉ người nhận, tọa độ, ngày hay khung giờ giao; phí giao luôn bằng 0 ở server. Cửa hàng vẫn phải được duyệt, đang mở và còn quyền tạo đơn theo gói.
- Chỉ hoàn tất sau khi người có quyền xác nhận khách đã nhận hoa. Lưu `fulfillment_method=pickup`, thời điểm bàn giao `picked_up_at` và bản chụp tên/địa chỉ/điện thoại cửa hàng. Trạng thái dữ liệu `delivered` được hiển thị là **Đã nhận tại cửa hàng**; không ghi thời điểm vận chuyển.
- Có thể chọn Khách lẻ, không tạo hồ sơ CRM hoặc số điện thoại giả; cần thanh toán đủ. Khách có tên/SĐT được ghi nợ khi chủ cửa hàng nhập lý do ít nhất 5 ký tự. Quyền ghi nhận thu tiền vẫn dành cho chủ cửa hàng.
- Tồn kho, giá, ưu đãi, sổ thu tiền và tạo đơn nằm cùng giao dịch. Gửi lại yêu cầu không tạo trùng đơn hoặc thu trùng. Nháp không giữ hàng hay ghi nhận tiền; mở lại phải xác nhận bàn giao mới.
- Hủy đơn đã thu tiền đưa khoản còn giữ vào danh sách Hoàn tiền. Hoàn tiền dùng chung sổ giao dịch, không chuyển tiền tự động. Đơn nhận ngay không chuyển qua bước vận chuyển hoặc đổi lịch giao.
- Danh sách, Kanban, lịch và chi tiết có nhãn nhận tại cửa hàng. Có bộ lọc hình thức nhận hoa. Báo cáo doanh thu gồm đơn hoàn tất tại quầy; tải giao hàng và COD giao hàng không tính các đơn này. Báo cáo có tổng đơn, doanh thu và công nợ tại quầy riêng.
- Email xác nhận/cập nhật dùng `order_pickup_confirmation` và `order_pickup_status`, giữ hệ thống gửi mail và hạn mức theo gói. Khách không có email sẽ không được xếp hàng gửi. AI chỉ chuẩn bị nháp nhận ngay, không tự xác nhận thu tiền hoặc bàn giao.

## Database và triển khai

Migration `order-pickup-v1` thêm ba cột vào `orders` và hai template email cho các cửa hàng. Các đơn hiện có mặc định là `delivery`; không suy luận từ kênh tiếp nhận hoặc sửa lại lịch sử đơn cũ. Migration có thể chạy lại và không ghi đè template đã tùy chỉnh.

App local và app QA có thể dùng hai database khác nhau. Nếu `/board`, `/orders` hoặc `/analytics` trả lỗi 500 sau khi cập nhật code, kiểm tra migration trên database mà `.env.local` trỏ tới. Chạy `npm run db:pickup:local` để sao lưu, khôi phục kiểm tra trên MySQL QA cổng 3310, thử chạy lặp migration rồi bổ sung cả schema COD và pickup vào database local. Script chỉ chấp nhận máy chủ local, giữ lại bản sao lưu và báo cáo tại `.local/`.

Chạy migration trước khi triển khai code sử dụng các cột mới. Với TiDB production: sao lưu và kiểm tra khôi phục trước, sau đó chạy `npm run db:pickup:tidb -- --production-backup-verified`. Migration `order-pickup-v1` đã chạy thành công trên production ngày 20/10/2026, sau khi sao lưu và khôi phục kiểm tra đủ 72 bảng, diễn tập migration hai lần. Kiểm tra sau migration xác nhận dữ liệu cũ và template tùy chỉnh được giữ nguyên, đủ ba cột và hai template pickup cho mọi cửa hàng. Bản sao lưu và báo cáo được giữ tại `.local/`, không đưa vào Git. Kiểm thử tạo đơn và gửi mail giả lập chạy trên database QA; không tạo đơn thử trên production.

## Kiểm thử

`npm run test:pickup:e2e` yêu cầu app QA tại `http://localhost:3005`, database kiểm thử nói trên, tắt email/push thật. Bộ kiểm thử tạo và dọn fixture riêng, kiểm tra API/SQL cùng thao tác thực tế trên Chromium và WebKit, gồm màn hình 320–1440px. Chạy thêm hồi quy COD, hoàn tiền, sửa thanh toán và AI khi thay đổi luồng này.
