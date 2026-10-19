# Một tài khoản, một cửa hàng

- Kiểm tra ở server cho `POST /api/stores`; không dựa vào giao diện hay membership đang hoạt động. `owner_id` là chủ cửa hàng; nhân viên của cửa hàng khác vẫn có thể đăng ký cửa hàng riêng.
- Chặn nếu tài khoản, email chủ tài khoản, số điện thoại tài khoản hoặc số điện thoại đăng ký đã dùng mở cửa hàng. Email lấy từ tài khoản đã đăng nhập, trim và chuyển chữ thường. Không tự gộp dấu chấm/alias email của các nhà cung cấp khác nhau.
- Chuẩn hóa số điện thoại: bỏ khoảng trắng/dấu phân cách, `0…`, `+84…`, `0084…` và `84…` cùng một danh tính. Không xác minh quyền sở hữu số điện thoại bằng OTP trong thay đổi này.
- Tất cả trạng thái cửa hàng đều tính vào giới hạn, bao gồm chờ duyệt, bản nháp, đã duyệt và đóng băng. Đổi thông tin liên hệ không giải phóng danh tính đã đăng ký. Lưu hash SHA-256 có phân loại, không lặp lại email/điện thoại thô trong bảng claim.
- `store_registration_claims.identity_key` là khóa duy nhất. Khóa tài khoản và các claim nằm trong cùng transaction tạo store, gói, email outbox; hai request song song chỉ một request được commit. Đăng ký thất bại sẽ rollback claim để người dùng thử lại.
- Migration ghi nhận các cửa hàng cũ, chạy lại được; không xóa hay gộp các cửa hàng trùng có sẵn. Các thông tin đã bị đổi trước khi có lịch sử đăng ký không thể khôi phục từ dữ liệu hiện tại.
- `GET /api/stores/registration` yêu cầu đăng nhập, chỉ trả thông tin workspace nếu chính tài khoản là chủ. Không công khai tên, email, số điện thoại của cửa hàng thuộc tài khoản khác.
- `/start`: chủ cửa hàng đang chờ duyệt thấy trang chờ; chủ đã có cửa hàng thấy nút vào workspace; trùng liên hệ thấy thông báo chặn. Không cho gửi form nếu chưa kiểm tra được.

## Cập nhật cơ sở dữ liệu

Local:

```powershell
node --env-file=.env.local scripts/migrate-store-registration.mjs
```

Migration cũng được gọi bởi `scripts/saas-schema.mjs`. Trước khi deploy code lên production, cần chạy migration này trên đúng DB production. Script chặn DB từ xa mặc định; chỉ dùng `--production-backup-verified` sau khi đã xác minh bản sao lưu/khôi phục theo quy trình migration của dự án. Không chạy seed/reset dữ liệu để thêm bảng này.

## Kiểm thử

```powershell
node --env-file=.env.local scripts/test-platform-onboarding.mjs
```

Suite tạo DB local tạm riêng, tắt email ngoài, kiểm tra API/UI thực và xóa DB sau kiểm thử. Bao gồm trùng tài khoản/email/số điện thoại, số điện thoại khác định dạng, giữ claim sau đổi liên hệ, các trạng thái cửa hàng, rollback, request song song, quyền nhân viên, migration chạy lại, và giao diện Chromium/WebKit mobile.
