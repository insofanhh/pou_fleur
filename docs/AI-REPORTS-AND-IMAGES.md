# Báo cáo và ô nhập trợ lý AI

## Khoảng ngày và số liệu

- “N ngày gần nhất” gồm hôm nay tại Hà Nội và N−1 ngày trước. Ngày hôm nay chưa kết thúc. Backend chuẩn hóa các yêu cầu rõ ràng, không ghi đè khoảng ngày cụ thể hoặc mốc thời gian khác do người dùng chỉ định.
- Báo cáo đơn giản không lấy hoặc gửi số liệu kỳ trước cho model. `comparePrevious` chỉ có hiệu lực khi nội dung yêu cầu có ý so sánh rõ ràng. Hai kỳ có tổng độc lập.
- Dùng chung phép tính với trang Phân tích: đơn theo ngày tạo, trạng thái và số dư hiện tại; lịch giao theo ngày giao. Không gọi tiền thu ròng của nhóm đơn là dòng tiền theo ngày thu, không suy ra lợi nhuận.
- Card tiếng Việt có các phần Tổng quan, Chỉ số khác, Sản phẩm, Kênh tiếp nhận, Lịch giao; nội dung có khung cuộn giới hạn. Card cũ có dữ liệu kỳ trước cho phép bật xem so sánh, mặc định ẩn.
- Link nguồn giữ `from` và `to`; trang Phân tích đọc và xác thực các tham số này, cả khi chuyển trang ở phía trình duyệt.

## Ô chat và ảnh

- Chung một composer cho trang AI và chat nhanh: nút ảnh, bộ câu hỏi mẫu, nội dung, gửi. Câu hỏi mẫu chỉ điền nội dung để người dùng sửa, không tự gửi.
- Enter gửi, Shift+Enter xuống dòng, giữ IME khi nhập tiếng Việt. Escape đóng bộ câu hỏi trước khi thu gọn chat.
- Một ảnh mỗi tin nhắn. Chọn JPG/PNG/WebP tối đa 8 MB; trình duyệt giải mã và chuyển thành JPEG cạnh dài tối đa 1280px, tối đa 512 KB. Có xem trước và xóa; gửi lỗi giữ ảnh và nội dung để thử lại.
- Server kiểm tra độ dài, base64 chuẩn và chữ ký định dạng; chỉ tăng giới hạn body cho endpoint chat, tối đa 750.000 byte. Các endpoint khác vẫn tối đa 100.000 byte.
- Theo [tài liệu DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/), dùng `deepseek-flash` với `user.content` gồm text và `image_url`. Model khác tắt chọn ảnh và bị chặn ở server, vẫn chat chữ bình thường.
- Ảnh được gửi tới DeepSeek khi người dùng gửi tin, lưu trong JSON card của tin nhắn người dùng tại database; không tạo ảnh public hoặc dùng API tải ảnh sản phẩm. Quyền đọc theo cửa hàng, người dùng, vai trò và hội thoại hiện có. Xóa hội thoại xóa cả ảnh trong tin nhắn.
- Các lượt tiếp theo giữ ảnh trong ngữ cảnh 10 tin nhắn gần nhất. Một tin kèm ảnh tính một lượt AI như chat chữ; phát lại cùng requestId không tính trùng. Không coi ảnh chuyển khoản là xác nhận thu tiền; các hành động vẫn cần bước xác nhận hiện có.

## Kiểm thử

- `npm run test:ai:report`: ngày Hà Nội, giao năm/năm nhuận, hai kỳ có số đơn và tiền khác nhau, kiểm tra ảnh và nội dung gửi provider.
- `npm run test:ai:report:ui`, `npm run test:ai:composer:ui`, `npm run test:ai:widget`: Chromium/WebKit, desktop/mobile, API được giả lập, không gửi dữ liệu hoặc email thật.
- `scripts/test-ai-inprocess.ts`: API/auth/tenant/SQL thật trên database QA `fleur_saas_test` cổng 3310; chỉ transport DeepSeek được giả lập. Kiểm tra kỳ 7 ngày khi model gửi sai ngày bắt đầu, so sánh tự thêm, ảnh/hội thoại riêng tư, idempotency, quota, model không hỗ trợ ảnh và các luồng hành động hiện có.
