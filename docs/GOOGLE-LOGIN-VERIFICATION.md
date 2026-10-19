# Google yêu cầu xác minh thiết bị

Màn hình “Verify it’s you”, chọn số trong ứng dụng Gmail, là Google Prompt/kiểm tra bảo mật của tài khoản Google. Nó khác màn hình cấp quyền cho ứng dụng OAuth và không phải mã xác minh của Fleurious.

Đã kiểm tra `app/api/auth/google/route.ts`:

- Chỉ xin `openid email profile`.
- Dùng `prompt=select_account` để chọn tài khoản, không dùng `prompt=consent`, `max_age=0` hoặc tham số ép xác thực lại.
- Có PKCE, state, nonce, cookie OAuth 10 phút và kiểm tra ID token/email đã xác minh.
- Sau đăng nhập thành công, Fleurious cấp session cookie và bản ghi session 7 ngày (`lib/auth.ts`), không yêu cầu Google xác minh mỗi lần tải trang.

Không thể kết luận chính xác tín hiệu rủi ro Google dựa vào từ một ảnh. Google giải thích việc bật/chặn/xóa cookie có thể khiến thiết bị đã tin cậy vẫn phải xác minh. Trình duyệt/phiên riêng tư hoặc môi trường trình duyệt khác nhau cũng không nên được coi là cùng một phiên đăng nhập.

## Cách xử lý

1. Đăng nhập bằng Safari/Chrome thông thường trên thiết bị cá nhân; giữ phiên đăng nhập Google trong chính trình duyệt dùng mở Fleurious. Tránh chế độ riêng tư hoặc tự xóa dữ liệu web sau mỗi lần dùng.
2. Cho phép lưu cookie của Google. Nếu Google đưa ra lựa chọn “Don't ask again on this computer”, chọn trên thiết bị cá nhân tin cậy. Không cần tắt xác minh hai bước hay tắt toàn bộ bảo vệ riêng tư của trình duyệt.
3. Kiểm tra hoạt động bảo mật và danh sách thiết bị trong Google Account. Có thể cấu hình passkey để thao tác xác minh thuận tiện hơn; quyết định có yêu cầu xác minh hay không vẫn thuộc Google.
4. Dùng một hostname chuẩn cho production. Cấu hình `APP_ORIGIN=https://www.fleurious.store`, callback OAuth chính xác `https://www.fleurious.store/api/auth/google`, chuyển domain phụ sang domain chuẩn. Cookie session hiện là host-only; chuyển giữa apex/www hoặc domain Vercel cũ có thể khiến Fleurious yêu cầu đăng nhập lại. Điều này không tự chứng minh là nguyên nhân của thử thách bảo mật Google.

Không thay `prompt=none` để “bỏ xác minh”: Google sẽ trả lỗi nếu chưa có phiên/đồng ý phù hợp. Không bỏ state, nonce, PKCE hoặc xác minh ID token để giảm số bước.

Nguồn chính thức:

- [Google: thiết bị tin cậy và cookie](https://support.google.com/accounts/answer/2544838).
- [Google: Sign in with Google prompts](https://support.google.com/accounts/answer/7026266?hl=en).
- [Google OIDC: scope và prompt](https://developers.google.com/identity/openid-connect/openid-connect).

# Ô ngày trên iPhone

`DateInput` giữ input native nhận giá trị ISO, min/max/required và mở bộ chọn ngày của hệ điều hành. Phần chữ nhìn thấy dùng `dd/mm/yyyy` / `mm/yyyy` / ngày giờ cố định, căn giữa theo chiều dọc; không phụ thuộc chuỗi ngày dài trong shadow tree của iOS.

Có placeholder khi trống, nút xóa cho trường không bắt buộc, focus, label truy cập, reset form và trạng thái disabled. Áp dụng cho Kanban/bảng đơn, lịch, analytics, checkout, tạo đơn, sinh nhật, CRM và các editor ngày/giờ.

Kiểm thử bằng Chromium và WebKit với locale vi-VN, timezone Mỹ, thao tác touch, 414/390/375/320px; không có quyền điều khiển iPhone thật trong môi trường này. WebKit trên desktop không mô phỏng toàn bộ UI picker của iOS. Cần kiểm tra lại trên thiết bị sau khi bản sửa được triển khai.
