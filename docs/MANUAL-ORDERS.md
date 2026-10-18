# Đơn hàng thủ công — hướng dẫn và vận hành

Ngày cập nhật: 18/10/2026. Bản đầu hỗ trợ đơn giao tận nơi, nhập từ điện thoại/Zalo/mạng xã hội/tại cửa hàng. Nhận tại store, giữ tồn cho nháp và payment link thuộc giai đoạn mở rộng trong [plan](MANUAL-ORDERS-PLAN.md).

## Sử dụng

1. Vào workspace store → Kanban / Đơn hàng → **Tạo đơn hàng**. Từ lịch có **Tạo đơn ngày này**, từ hồ sơ CRM có **Tạo đơn cho khách**.
2. Chọn khách trong CRM hoặc nhập tên, điện thoại; email tùy chọn. Nếu điện thoại dùng chung thì chọn hồ sơ đúng hoặc xác nhận tạo hồ sơ riêng. Trùng email yêu cầu chọn khách đã có; không tự gộp.
3. Chọn sản phẩm, size và số lượng; có thể thêm thiết kế riêng, yêu cầu và ảnh tham khảo. Thiết kế riêng không xuất bản ra catalog, không theo dõi tồn nguyên liệu.
4. Chọn giao tặng/giao cho tôi, ngày, slot, địa chỉ và lời nhắn. Store có cấu hình tọa độ yêu cầu tọa độ người nhận để kiểm tra bán kính; bản đầu có input vĩ độ/kinh độ nhập tay.
5. Chọn mã ưu đãi hoặc giảm thủ công, phí giao riêng nếu được cấp quyền. Lý do giảm giá/sửa phí giao là tùy chọn; sửa giá riêng của sản phẩm catalog vẫn cần lý do. Chủ store có thể ghi nhận tiền mặt/chuyển khoản đã nhận, một phần hoặc đủ; không phải chức năng tự trừ tiền hay xác minh chuyển khoản. Mã tham chiếu/biên nhận có thể để trống: máy chủ tự tạo mã nội bộ `CASH-<mã đơn>` hoặc `BANK-<mã đơn>` khi lưu đơn. Nếu tự nhập mã, dùng từ 5 đến 100 ký tự. Mã do hệ thống tạo không phải mã xác nhận từ ngân hàng.
6. Nhập phân công, tag và ghi chú nội bộ. **Tính giá & rà soát** rồi **Tạo đơn hàng** / **Tạo và xác nhận**. Thành công mở chi tiết đơn ở Kanban.

**Lưu nháp** cho phép thiếu thông tin nhưng chưa giữ tồn/slot, chưa ghi doanh thu, chưa gửi email hoặc tạo khách CRM. Nháp có tiền đã nhận bị từ chối: cần tạo đơn để khoản tiền được ghi vào sổ giao dịch. Mở lại từ **Đơn nháp**; hai người sửa cùng lúc được bảo vệ bằng version. Nháp cũ được cảnh báo sau 7 ngày, chỉ lưu trữ bằng thao tác chủ động.

Form không lưu thông tin khách vào localStorage. Mất mạng giữ nguyên nội dung; retry cùng yêu cầu trả lại cùng đơn. Nếu báo thay đổi giá, cần rà soát lại trước khi chốt.

## Quyền mặc định

| Thao tác | Owner | Admin / Manager | Support |
| --- | --- | --- | --- |
| Nháp, tạo đơn chờ xác nhận, thiết kế riêng | Có | Có | Có |
| Tạo và xác nhận ngay | Có | Có | Không |
| Ghi đè giá catalog, giảm thủ công, phí giao riêng | Có | Có | Không |
| Thiết kế riêng giá 0, có lý do | Có | Có | Không |
| Thu và hoàn tiền | Có | Không | Không |

Editor và người mua không được tạo đơn. Ghost dùng quyền của user store; đơn lưu created_by là user được hỗ trợ và adjustment.ghost ghi actor thật, target và hash phiên. Kiểm tra phiên/membership được thực hiện lại khi chốt, không chỉ khi mở form.

## Tính nhất quán

- Giá và lịch được kiểm tra ở server. Store, sản phẩm và slot được bảo vệ trong transaction; các đơn tranh tồn/slot không thể vượt giới hạn.
- Chốt nguyên tử: đơn, dòng hàng, tồn, promotion usage, CRM, khoản thu, lịch sử và outbox. Lỗi một bước rollback toàn bộ.
- Có customer_id theo store, tách khỏi user_id. Nhập email của một tài khoản không tự đưa đơn vào lịch sử tài khoản đó. Bản đầu không có luồng xác minh nhận đơn thủ công về tài khoản người mua.
- Email tùy chọn: không có email thì hiển thị lý do bỏ qua; có email thì dùng template và outbox hiện tại. Xác nhận ngay gửi một confirmation, không gửi thêm email trạng thái trùng ở bước tạo.
- Không tự bật marketing consent. Automation/email campaign bỏ qua liên hệ thiếu email; CRM, lịch sử mua và báo cáo dùng customer_id.
- Sổ thu/hoàn độc lập với giao hàng. Hủy đơn đã cọc vẫn hiển thị tiền cần xử lý hoàn. Hủy chỉ hoàn tồn catalog; dòng custom không tác động tồn.
- Chủ store có thể chọn **Trạng thái thanh toán** trước: **Chưa thanh toán** đưa tiền nhận về 0; **Thanh toán một phần** yêu cầu nhập số tiền lớn hơn 0 và nhỏ hơn tổng; **Đã thanh toán** tự điền tổng khách phải trả từ máy chủ, gồm giảm giá và phí giao. Khi vẫn chọn Đã thanh toán, sửa giá/sản phẩm/ưu đãi/phí giao sẽ tính lại tiền nhận, không giữ tổng cũ. Nhập tiền trực tiếp cũng tự cập nhật trạng thái; nhập 0 trở về chưa thanh toán. Rà soát tính lại giá và tạo đơn vẫn kiểm tra giá trong giao dịch; trạng thái lưu dựa trên sổ thu tiền. Role không có quyền thu tiền chỉ xem trạng thái chưa thanh toán. Nháp vẫn chưa ghi nhận tiền; cần bỏ khoản thu trước khi lưu nháp.
- Đơn có thiết kế riêng không tự đặt lại bằng giá cũ: thông báo liên hệ cửa hàng để báo giá. Tạo nháp tự động từ đơn cũ/yêu cầu báo giá là phần mở rộng.
- Public order history không trả internal_notes, adjustment, hash yêu cầu hoặc thông tin nhân viên tạo.
- Báo cáo store có nguồn web/manual và kênh tiếp nhận. Số tiền thu lấy từ ledger, doanh thu giữ quy tắc đơn đã giao hiện tại.

## Setup và migration

Setup SaaS mới (`npm run db:setup`) đã gọi migration này. Với database hiện có, phải chạy migration trước khi phát hành code sử dụng customer_id/dòng custom.

Local có MySQL test riêng port 3310 và mysqldump tại đường dẫn Laragon hiện tại:

```powershell
npm run db:manual-orders
```

Lệnh backup database local vào `.local/backups`, khôi phục vào database tạm trên MySQL test, đối chiếu fingerprint, thử migration hai lần rồi mới áp dụng vào local. Giữ lại backup và report `.local/manual-migration-report.json`. Không in credentials hoặc nội dung khách ra terminal.

TiDB/remote: backup bằng công cụ của môi trường đó và thử khôi phục trước. Sau khi đã xác minh bản backup:

```powershell
npm run db:manual-orders:tidb -- --production-backup-verified
```

Migration thêm schema, chuyển email/product_id sang nullable và backfill customer_id cùng store. Không xóa đơn/dòng hàng/khách cũ. Không dùng script local Laragon cho production. Khi deploy phải quản lý migration trước và giữ ứng dụng tương thích trong thời gian chuyển phiên bản.

`MANUAL_ORDERS_ENABLED=false` tạm tắt trình tạo và nháp; danh sách đơn, xem đơn đã tạo, chuyển trạng thái, thu/hoàn tiền vẫn hoạt động. Không rollback bằng cách xóa schema hoặc dữ liệu manual đã phát sinh.

## Kiểm thử

Build production và bộ test nền phải qua. Suite mới từ chối chạy nếu database/port không phải môi trường test:

```powershell
$env:MYSQL_DATABASE='fleur_saas_test'
$env:MYSQL_PORT='3310'
$env:TEST_ORIGIN='http://127.0.0.1:3005'
# App tại TEST_ORIGIN phải chạy với cùng DB test và EMAIL_ENABLED=false.
npm run test:manual-orders
```

API kiểm tra nháp/version, custom/catalog, giá/slot, tồn và sức chứa đồng thời, retry, tiền cọc/hoàn/rollback, consent, liên kết CRM, nguồn báo cáo, tenant và Ghost. UI kiểm tra tạo → lưu nháp → mở lại → rà soát → chốt → chi tiết, các quyền support và bố cục 360/390px. Ảnh QA nằm ở `.local/manual-ui`.

Không gửi thử SMTP hoặc web push đến khách thật. Kiểm tra outbox không đồng nghĩa với đã gửi email qua Gmail hoặc triển khai TiDB/Vercel production.
