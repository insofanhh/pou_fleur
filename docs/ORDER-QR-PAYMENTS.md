# Thanh toán QR đơn hàng

- QR đơn hàng có hạn 5 phút từ khi tạo; QR gói dịch vụ giữ thời hạn riêng 10 phút.
- Ngân hàng trong cấu hình được chọn theo danh mục BIN VietQR, tên được suy ra từ BIN. Nguồn: https://api.vietqr.io/v2/banks và https://www.vietqr.io/qr-dong.
- Đích nhận tiền được chụp lại vào phiên QR. Thay đổi ngân hàng/số tài khoản sẽ đóng phiên cũ, không thay ngân hàng trên lịch sử thanh toán.
- Khi hết hạn hoặc khách xác nhận hủy, đơn chuyển khoản đang chờ/chờ xác nhận và chưa nhận tiền sẽ chuyển sang `cancelled`. Tồn kho và lượt khuyến mãi được trả lại một lần. Không tạo bút toán thu/hoàn tiền.
- Kiểm tra sổ thu tiền và trạng thái cũ dưới khóa giao dịch trước khi hủy. Đơn có tiền nhận, COD, nhận tại quầy hoặc đã vào khâu chuẩn bị/giao hàng không bị tự hủy; QR hết hạn thì đóng riêng phiên và nhân viên đối soát.
- Khách dùng cookie checkout hoặc tài khoản sở hữu đơn để xem/hủy. Nhân viên có quyền đơn hàng được xem và hủy QR đơn thủ công của cửa hàng mình. Mã đơn/email không đủ quyền hủy.
- Webhook đến sau hạn hoặc sau hủy bị từ chối và ghi lỗi đối soát; không tự khôi phục đơn, không coi việc từ chối webhook là ngân hàng đã hoàn tiền. Nếu khách đã chuyển thực tế, cửa hàng phải kiểm tra giao dịch và xử lý thủ công.
- Đóng/mở trang không gia hạn. Checkout giữ mã phiên trong sessionStorage và đọc trạng thái thật từ server khi mở lại.

## Chạy nền trên production

Vercel Hobby chỉ cho cron hằng ngày, không đáp ứng việc cập nhật database mỗi phút: https://vercel.com/docs/cron-jobs/usage-and-pricing.

Thiết lập một scheduler ngoài gọi **GET `/api/payments/worker` mỗi phút**, header `Authorization: Bearer <CRON_SECRET>`. Dùng cùng `CRON_SECRET` tối thiểu 32 ký tự đang cấu hình trên server, không đưa secret vào URL hay mã nguồn. Endpoint trả số phiên xử lý, giới hạn 200 phiên/lượt. Giám sát HTTP lỗi và tăng tần suất/năng lực khi số phiên quá lớn.

Khi chưa có scheduler, QR vẫn hết hiệu lực đúng thời hạn ở server/webhook; hủy đơn và hoàn tồn kho được thực hiện khi khách polling, mở danh sách/dashboard/lịch/tra cứu hoặc khi worker hằng ngày chạy. Không cam kết database đổi trạng thái đúng phút nếu mọi trình duyệt đã đóng. Lịch mỗi phút có độ trễ cập nhật tối đa khoảng một chu kỳ, không thay đổi hạn nhận tiền 5 phút.

Không cần migration mới: dùng `payment_intents`, `orders`, `order_payments` và các bảng tồn kho/sự kiện hiện có.

## Kiểm thử

Chỉ chạy với MySQL QA `127.0.0.1:3310/fleur_saas_test`, tắt EMAIL_ENABLED/PUSH_ENABLED.

- `node --import tsx scripts/test-billing-inprocess.ts order-qr`
- `node --import tsx scripts/test-billing-inprocess.ts store-sepay`
- `node --import tsx scripts/test-billing-inprocess.ts plan-changes`
- `node scripts/test-order-qr-ui.mjs` với app QA tại `127.0.0.1:3005`.
