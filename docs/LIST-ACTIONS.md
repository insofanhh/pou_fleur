# Thao tác trong danh sách

Các danh sách dùng `TableAction` và `TableActions` trong `components/table-actions.tsx`, với style tập trung tại `app/table-actions.css`.

- Cột có thao tác đặt tiêu đề **Thao tác**, `scope="col"` và class `table-actions-heading`.
- Nút dùng icon Lucide 15px kèm nhãn tiếng Việt, màu đen, khoảng cách icon/nhãn 6px. Giữ nhãn Ghost theo giao diện hiện tại.
- Mỗi nút có tooltip, focus bàn phím rõ ràng; trạng thái disabled giữ nguyên theo quyền và trạng thái xử lý của từng chức năng.
- Nhóm thao tác cho phép xuống hàng. Vùng bấm cao ít nhất 32px desktop và 44px mobile. Bảng rộng cuộn trong khung, không kéo rộng toàn trang.
- Nút mặc định `type="button"`. Các nút xác nhận trong form dùng `type="submit"`, giữ validation của form.
- Đúng ngữ nghĩa: icon mắt cho xem, bút cho sửa, mắt gạch cho ẩn, thùng rác cho xoá, dấu kiểm cho duyệt/xử lý, vòng quay cho mở lại/thử lại/khôi phục, bông tuyết cho đóng băng và QR cho thanh toán.

## Phạm vi rà soát

Workspace: sản phẩm, tin tức, sự kiện, khuyến mãi, yêu cầu hỗ trợ, danh mục, thành phần hoa, CRM, danh sách đơn, hóa đơn, nhân sự, quy tắc chăm sóc và ghi chú lịch.

Platform: người dùng, cửa hàng, hóa đơn, chương trình email và lịch sử email. Các danh sách email dùng cùng component với workspace.

Lịch sử mua hàng trong tài khoản khách cũng dùng cùng mẫu cho Đặt lại và Huỷ đơn. Bảng thống kê, nhật ký, lời mời và các báo cáo chỉ đọc không tạo thêm thao tác nghiệp vụ.

## Kiểm tra

`npm run test:actions:ui` kiểm tra icon, nhãn, màu, chiều cao nút, tiêu đề cột và không tràn trang trên Chromium desktop/mobile và WebKit mobile. Kiểm tra nút sửa, chi tiết đơn, xử lý hỗ trợ, thanh toán hóa đơn, xem email, validation và submit form thu/hủy hóa đơn. Tất cả API được giả lập; không thay đổi dữ liệu hoặc gửi email thật.
