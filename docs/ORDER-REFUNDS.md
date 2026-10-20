# Hoàn tiền đơn đã hủy

## Quyết định nghiệp vụ

- Hủy đơn và hoàn tiền là hai thao tác độc lập. Hủy đơn xử lý tồn kho/khuyến mãi như trước; ghi hoàn tiền không trả tồn kho thêm lần nữa và không đổi trạng thái giao hàng.
- Danh sách tại `/workspace/[storeId]/refunds`, sau Danh sách đơn hàng trong Vận hành hằng ngày. Các vai trò có quyền đọc đơn xem được; chỉ chủ cửa hàng ghi nhận hoàn tiền, đồng nhất quyền tài chính hiện tại.
- Đơn đã hủy có số dư sổ thu tiền dương tự vào danh sách, kể cả mới thu một phần. Còn cần hoàn = thu + điều chỉnh có dấu − hoàn thực tế. Không dùng tổng giá trị đơn làm số tiền hoàn.
- Hỗ trợ ghi hoàn toàn bộ hoặc từng phần. Đã hoàn đủ cần số dư bằng 0 và đã có giao dịch hoàn thực tế. Điều chỉnh trạng thái nhập nhầm không được tính là giao dịch hoàn.
- Đơn cũ có nhãn đã thu nhưng thiếu sổ giao dịch hiển thị Cần đối soát. Chủ cửa hàng kiểm tra tiền thực nhận, dùng phần điều chỉnh thanh toán trong chi tiết đơn để xác lập số dư đúng trước khi hoàn. Không tự tạo chứng từ thu từ nhãn trạng thái.
- Ghi nhận **tiền đã trả cho khách bằng chuyển khoản/tiền mặt**. Không gọi API chuyển tiền ra ngân hàng và không gửi email tuyên bố một giao dịch ngân hàng đang xử lý đã thành công. SePay hiện dùng nhận tiền vào; chưa có tích hợp hoàn tiền tự động.
- Chi tiết đơn chỉ có sửa thanh toán ghi nhầm, dùng nút Lưu thanh toán cho chủ cửa hàng. Phương thức thanh toán hiển thị chỉ đọc trong Giá & thanh toán cho mọi vai trò có quyền xem đơn; lưu điều chỉnh không đổi phương thức đã chọn khi tạo đơn. Không còn chế độ ghi nhận thu/hoàn tiền thực tế hoặc bộ chọn mục đích. Ghi hoàn thực tế nằm tại Hoàn tiền; lớp sổ giao dịch cũng từ chối hoàn đơn chưa hủy để các API cũ không bỏ qua điều kiện này. Thu tiền khi tạo đơn và thu qua SePay giữ nguyên.
- Lưu số tiền, phương thức, người thực hiện, thời điểm, mã giao dịch và ghi chú trong sổ giao dịch/lịch sử/audit. Mã giao dịch bên ngoài là tùy chọn; nếu nhập, hệ thống chặn dùng lại trong cùng cửa hàng. Nên nhập mã ngân hàng để đối soát.
- Tiền trả về tại đây là khoản thực hoàn cho khách; chính sách phí hủy/giữ cọc chưa được bổ sung. Không giả lập khoản giữ lại thành một giao dịch hoàn.

## Tính nhất quán và an toàn

- Transaction khóa cửa hàng rồi đơn, cùng thứ tự với SePay và đổi trạng thái. Kiểm tra đơn còn bị hủy, phiên bản còn đúng, số tiền nguyên dương và không vượt số dư tại thời điểm ghi.
- UUID yêu cầu giữ nguyên khi gửi lại cùng nội dung; retry thành công không trừ tiền hai lần. Gửi lại khác nội dung bị từ chối. Kiểm tra retry trước version để retry sau khi lưu vẫn thành công.
- Chặn dùng lại mã giao dịch hoàn đã nhập; khóa cửa hàng bảo vệ cả khi hai đơn ghi cùng mã đồng thời.
- Hủy QR còn chờ khi ghi nhận hoàn. Cập nhật sổ thu/hoàn và trạng thái thanh toán trong cùng transaction. Báo cáo, danh sách, chi tiết dùng chung dữ liệu sổ; không lưu trạng thái hoàn riêng dễ lệch.
- Nếu đơn được khôi phục/điều chỉnh/hoàn bởi người khác trong lúc modal mở, version thay đổi khiến lần lưu cũ bị từ chối. Đóng modal, làm mới và kiểm tra lại trước khi ghi.
- Không gọi gửi tiền hay gửi email từ GET/refresh. Danh sách giữ nội dung khi làm mới nền, có tìm kiếm, lọc, phân trang và lịch sử đã hoàn.
- Chưa có chứng từ đính kèm, gửi yêu cầu/duyệt hoàn nhiều cấp hay kết nối nhà cung cấp hoàn tiền. Nếu thêm API hoàn tự động, cần các trạng thái yêu cầu/đang xử lý/thành công/thất bại và webhook đối soát; chỉ ghi giảm số dư khi xác nhận kết quả thành công.

## Nguồn nghiên cứu

- [Shopify: Refunding orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/refunding-orders): phân biệt hủy và hoàn, hoàn toàn bộ/từng phần, lịch sử giao dịch.
- [Shopify: Manual payments](https://help.shopify.com/en/manual/payments/manual-payments): thanh toán thủ công được thực hiện ngoài hệ thống và ghi nhận lại.
- [Stripe: Refunds](https://docs.stripe.com/refunds): chỉ hoàn số tiền đã thu, tổng hoàn không vượt khoản thu, phân biệt trạng thái xử lý của nhà cung cấp. Áp dụng nguyên tắc đối soát; hệ thống hiện không tích hợp Stripe.

## Kiểm thử

- `npm run test:refunds`: SQL thật trên các bảng fixture trong database QA local; phân loại, đối soát, thu/hoàn từng phần, tenant, retry, version và hai kết nối hoàn đồng thời.
- `npm run test:refunds:e2e`: trình duyệt Chromium/WebKit + API + SQL thật trên app QA cổng 3005 và database `fleur_saas_test` cổng 3310, tắt email thật. Tạo đơn, hủy, hoàn từng phần/toàn bộ, lịch sử, báo cáo, quyền truy cập, mobile.
- Hồi quy sửa thanh toán ghi nhầm và điều hướng workspace; TypeScript và build production.
