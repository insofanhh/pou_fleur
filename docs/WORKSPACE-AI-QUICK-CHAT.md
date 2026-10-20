# Chat nhanh trong workspace

## Kế hoạch và phạm vi

1. Gắn nút chat cố định góc phải dưới vào shell workspace, giữ nguyên khi chuyển mục. Chỉ hiện với chủ cửa hàng, quản trị, quản lý, hỗ trợ; backend tiếp tục kiểm tra Khởi đầu/Studio/Atelier, trạng thái cửa hàng và hạn mức.
2. Mở panel gọn với câu hỏi gợi ý, hội thoại mới, lịch sử riêng, quota và đường dẫn mở trang AI đầy đủ đúng hội thoại. Dùng lại component chat, API và bước xác nhận hành động hiện có.
3. Chỉ tải UI chat và truy vấn AI khi mở lần đầu. Thu gọn giữ bản nháp, hội thoại, yêu cầu đang chạy; ngừng polling khi ẩn. Phản hồi về khi thu gọn có dấu báo mới trên nút.
4. Desktop dùng panel bên phải; mobile dùng panel co theo visualViewport/bàn phím, safe area và thanh điều hướng. Hỗ trợ Escape, nhãn truy cập, trả focus về nút, giảm chuyển động theo hệ điều hành.
5. Kiểm thử tương tác và hồi quy AI; rà bố cục Chromium/WebKit, production build, không tác động dữ liệu/thanh toán/email thật trong UI QA.

## Quy tắc dữ liệu

- Shell tạo lại widget khi đổi cửa hàng, tài khoản hoặc vai trò. Không lưu bản nháp/nội dung hội thoại vào localStorage hoặc sessionStorage. Bản nháp giữ trong phiên shell hiện tại; tải lại trang thì bản nháp mất, hội thoại đã gửi vẫn có trong lịch sử máy chủ.
- Sử dụng `api()` chung để gắn tenant header; không lấy dữ liệu trang hiện tại hay thông tin khách đang xem gửi sang AI tự động.
- Không tạo đơn/ghi chú/nhắc việc khi mới có đề xuất. Vẫn phải xem trước và bấm xác nhận; idempotency và phân quyền do API hiện có bảo vệ.
- Gói không hỗ trợ AI hoặc cửa hàng đóng băng hiển thị lý do và đường dẫn gói dịch vụ. Khởi đầu có mặc định 50 lượt AI/tháng, có thể chỉnh trong Platform. AI bị tắt/hết quota không gửi được bằng cả nút lẫn Enter.
- Panel là dialog không modal: desktop vẫn thao tác được nội dung trang phía sau. Thứ tự lớp dưới menu mobile và các modal đơn hàng/thanh toán; không tự đóng khi click ra ngoài để tránh mất ngữ cảnh.

## Kiểm thử

`node scripts/test-ai-widget-ui.mjs` chạy Chromium và WebKit trên app local đang có (mặc định 3000), chặn và giả lập toàn bộ API. Kiểm tra lazy loading, lỗi/retry, giữ bản nháp qua điều hướng, thu gọn khi gửi, báo phản hồi mới, lịch sử, mở rộng cùng hội thoại, xác nhận hành động, quyền/gói/quota, đổi tài khoản và bố cục 320/360/390/768/1440px. Bàn phím được mô phỏng bằng visualViewport resize, không thay thế kiểm thử trên điện thoại thật.

Ảnh và report nằm trong `.local/ai-widget-qa/` (không commit). Đây là kiểm thử UI với API giả lập, không phải một lần kiểm thử DeepSeek thật mới. Backend/provider dùng lại luồng đã kiểm thử ở `docs/STORE-AI-IMPLEMENTATION.md`.

Kết quả ngày 20/10/2026: 76 kiểm tra UI trên Chromium/WebKit thành công, `npm test` thành công và 29 kiểm tra AI unit thành công. Build production `.local/ai-widget-release` thành công. Chưa xác minh trực tiếp bàn phím trên iPhone/Android thật; kiểm tra WebKit và visualViewport mô phỏng đã qua.
