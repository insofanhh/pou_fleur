# Theo dõi và thu COD

## Quy tắc

- Nguồn tạo đơn, phương thức đặt hàng và trạng thái thanh toán là ba thông tin độc lập. Đơn Website chọn COD bắt đầu ở trạng thái chưa thanh toán.
- Đơn giao cho chính người đặt có người trả tiền là người đặt. Đơn quà tặng phải chọn người đặt hoặc người nhận trả tiền. Nếu người nhận trả, người đặt phải xác nhận đã thông báo và người nhận đồng ý. Người đặt trả tiền phải thống nhất thanh toán với cửa hàng trước khi giao quà.
- `orders.cod_payer` lưu trách nhiệm thanh toán; `cod_recipient_consent_at` lưu thời điểm người đặt xác nhận người nhận đồng ý trả tiền. Đơn quà tặng cũ không được tự suy đoán người trả; giao diện nhắc xác nhận. Bản ghi nhận tiền không thay đổi `orders.payment_method`.
- Chủ cửa hàng dùng **Xác nhận đã thu COD** trong chi tiết đơn để ghi tiền thực nhận (tiền mặt hoặc chuyển khoản), mã tham chiếu và ghi chú. Cho phép thu từng phần; không vượt số dư còn thiếu. **Lưu thanh toán** là sửa số tiền ghi nhầm, không phải một khoản thu/hoàn thực tế.
- Khi chuyển đơn COD còn thiếu tiền sang Đã giao, phải chọn thu đủ, thu thêm một phần hoặc chưa nhận thêm tiền. Khoản thu và chuyển trạng thái dùng chung giao dịch database; lỗi ở bất kỳ bước nào đều rollback. Nhân viên có quyền đơn hàng được giao khi chưa nhận tiền nhưng chỉ chủ cửa hàng được ghi thu. Khôi phục đơn hủy phải làm trước khi xác nhận tiền mới.
- Đơn đã giao còn thiếu tiền vẫn được cảnh báo, có bộ lọc riêng và thông báo cho cửa hàng. Giao hàng không tự làm đơn thành đã thanh toán.
- Hủy đơn chưa thu tiền không phát sinh hoàn tiền. Hủy đơn đã thu một phần/toàn bộ đưa số dư vào danh sách Hoàn tiền hiện có.

## Chống ghi trùng

API `POST /api/workspace/orders/:id/cod` yêu cầu phiên bản đơn, UUID yêu cầu và xác nhận thực nhận. Khóa cửa hàng rồi khóa đơn theo cùng thứ tự với SePay. Yêu cầu lặp cùng UUID/nội dung trả thành công mà không ghi thêm tiền; sửa nội dung của UUID đã dùng bị từ chối. Phiên bản cũ, giao dịch tham chiếu đã dùng, đơn của tenant khác, đơn hủy, đơn không phải COD và số tiền vượt dư đều bị chặn.

Sau khi ghi thu, các QR đang chờ của đơn bị hủy để tránh thanh toán theo số tiền cũ. Chuyển khoản đến muộn vào QR đã hủy phải được đối soát; không tự ghi thêm khoản thu vượt tiền. Đơn cũ có nhãn đã thanh toán/thu một phần nhưng không có sổ giao dịch cần đối soát trước khi thu mới.

## Hiển thị và báo cáo

- Nhãn phương thức và số COD còn phải thu xuất hiện ở danh sách, thẻ Kanban, chi tiết và thẻ đơn trong lịch. Lịch có số đơn COD cần thu từng ngày.
- Khi đơn COD đã thanh toán, ẩn nhãn COD, nhắc xác nhận người trả và thao tác thu tiền. Giữ trạng thái Đã thanh toán; phương thức gốc vẫn lưu để đối soát. Nếu sửa ghi nhầm về chưa thanh toán/thu một phần, phần COD hiển thị lại theo khoản còn thiếu.
- Bộ lọc: COD, chuyển khoản, COD còn phải thu, COD đã giao chưa thu đủ. Bảng theo dõi ở danh sách/Bảng xử lý đơn và báo cáo là số dư của **toàn bộ đơn hiện tại**, không chỉ trang kết quả.
- Khung theo dõi ở danh sách/Bảng xử lý đơn có hai cụm số liệu, tự xếp dọc trên màn hình nhỏ; ẩn khi cả hai khoản đều bằng 0. Đã giao chưa thu đủ là một phần của COD còn phải thu, không cộng hai số lại.
- Báo cáo **Thực thu trong kỳ** lấy giao dịch `collect` theo `received_at` lưu UTC, giới hạn theo ngày Hà Nội. Gồm đơn tạo trước kỳ, không cộng sửa ghi nhầm (`correction`), không trừ hoàn tiền. Giá trị thu ròng và nghĩa vụ hoàn vẫn ở báo cáo hiện có; không đồng nhất hai chỉ số.
- Email xác nhận đơn/cập nhật đơn có phần thông tin COD do hệ thống bổ sung, kể cả template cũ. Biến `cod_payer` và `cod_outstanding` có thể dùng trong template. Vẫn đi qua hàng đợi, cấu hình mail và hạn mức hiện có.

## Phạm vi đối soát đơn vị giao hàng

Chỉ xác nhận thu khi cửa hàng đã thực nhận tiền. Trường hợp khách đã trả đơn vị giao hàng nhưng tiền chưa bàn giao, dùng kết quả **Chưa nhận thêm tiền vào cửa hàng**, giữ cảnh báo và ghi chú người giữ tiền. Chưa tích hợp sổ đối soát hoặc API hãng vận chuyển; đây là phần mở rộng cần thiết nếu cửa hàng sử dụng dịch vụ thu hộ. Bàn giao tiền thu hộ sau này phải là sự kiện đối soát, không ghi nhận khách thanh toán hai lần.

## Migration và kiểm thử

Migration cộng thêm `cod_payer` và `cod_recipient_consent_at` nullable, có thể chạy lặp, không thay đổi đơn cũ. Được nối vào migration SaaS và có lệnh `db:cod`, `db:cod:tidb`. Migration remote đòi hỏi kiểm tra backup trước khi dùng cờ `--production-backup-verified`.

`npm run test:cod:e2e` sử dụng riêng ứng dụng QA tại localhost:3005, MySQL localhost:3310/database `fleur_saas_test`. Dữ liệu fixture được dọn theo store. Kiểm tra Chromium/WebKit, API, sổ giao dịch, phân quyền, tenant, concurrency, giao quà, thanh toán, hủy/hoàn, email outbox và mốc ngày Hà Nội. Không chuyển tiền hoặc gửi email thật.

Kết quả QA ngày 20/10/2026: build production và typecheck đạt; 80 kiểm tra COD thực tế (gồm bố cục và ẩn/hiện khung theo dõi trên Chromium/WebKit), 28 kiểm tra giao diện checkout, 30 kiểm tra hoàn tiền thực tế, 16 kiểm tra sửa thanh toán thực tế, 28 kiểm tra giao diện sửa thanh toán và 58 kiểm tra SQL thanh toán/hoàn tiền đạt. Migration chạy lặp thành công trên QA; chưa áp dụng production. Kiểm tra nội dung email ở outbox, không xác nhận giao thư qua SMTP thật.
