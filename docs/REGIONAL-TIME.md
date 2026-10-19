# Hà Nội và ngày giờ hệ thống

- Cấu hình chung nằm trong `lib/regional.ts`: nhãn **Hà Nội (UTC+7)**, mã IANA hợp lệ `Asia/Ho_Chi_Minh`. Không dùng `Asia/Hanoi` vì không phải mã IANA.
- Ngày giao, ngày sinh, hạn công việc là ngày lịch, không chuyển sang ngày UTC.
- Pool MySQL/TiDB đặt session `+07:00` khi khởi tạo kết nối. `NOW()`, `CURDATE()`, các báo cáo theo ngày và chuỗi TIMESTAMP đọc ra đều theo Hà Nội; không phụ thuộc timezone của Vercel hay máy chạy ứng dụng. Không cập nhật timezone toàn DB/server, không viết lại lịch sử.
- DATETIME của billing, hạn QR và `order_payments.received_at` đã được lưu UTC từ trước. Giữ UTC khi tính hết hạn; khi hiển thị dùng `formatDateTime(value, "utc")`. Các DATETIME nghiệp vụ khác (lời mời, chương trình khuyến mãi) dùng giờ Hà Nội. Không cộng 7 giờ vào dữ liệu đã có offset.
- UI dùng `lib/date-time.ts`. Trường nhận tiền `datetime-local` luôn nhập theo giờ Hà Nội và gửi ISO UTC. Không dùng timezone thiết bị để chuyển đổi.
- Hạn mức email đặt lại lúc 00:00 ngày đầu tháng ở Hà Nội; `quota_at` giữ UTC, các timestamp cũ được quy về UTC trước khi so sánh.
- Bản đồ mặc định: `21.0278, 105.8342` tại Hà Nội. Gợi ý Goong ưu tiên Hà Nội khi chưa có vị trí; vị trí người dùng chọn được ưu tiên khi có. Không giới hạn bán kính tìm kiếm toàn quốc.
- Trên production cần deploy phiên bản mới để pool được khởi tạo lại. Những DATETIME nghiệp vụ cũ từng ghi ở timezone khác cần đối chiếu dữ liệu trước khi chuyển đổi; không thể suy ra timezone nguồn chỉ từ một chuỗi SQL không có offset.

Kiểm tra: `npm run test:regional`, `node --env-file=.env.local --import tsx scripts/test-regional-db.ts`, `npm run test:regional:ui`.

Tham khảo: [IANA zone.tab](https://github.com/eggert/tz/blob/main/zone.tab), [Goong Place AutoComplete](https://document.goong.io/tutorial-Places.html).
