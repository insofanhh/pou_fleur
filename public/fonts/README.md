Các tên font trong CSS: SF Pro Display, SF Pro Text, SF Pro Icons.
Hiện dùng local() để không phát tán font của Apple; thiết bị không có font sẽ dùng system font.
Nếu có webfont được phép sử dụng, đặt tại đây và thêm URL tương ứng vào @font-face trong app/globals.css. Lucide cung cấp icon giao diện mặc định; thay bằng glyph SF Pro Icons khi có bộ font và bảng ánh xạ hợp lệ.
