# Tổng quan platform

## Giao diện và phạm vi

Thứ tự menu: Tổng quan → Cửa hàng & Merchant CRM → Danh mục gói dịch vụ → Email & chương trình → Hóa đơn dịch vụ → Tài khoản → Cấu hình.

Tổng quan dùng cùng hệ thống KPI card, panel, bộ lọc ngày và bảng của Overview/Analytics cửa hàng. Bộ lọc ngày có mốc 7/30/90 ngày, hoặc khoảng tùy chọn tối đa 366 ngày, theo giờ Hà Nội. Biểu đồ cho phép chọn chỉ số và ngày; bảng có phân trang 10 dòng, tìm kiếm và mở modal cửa hàng bằng icon thao tác chung.

- KPI: cửa hàng, tài khoản, phí SaaS thực thu, MRR hiện tại, đơn tạo trong kỳ, GMV đơn đã giao, tài khoản có hoạt động trong 30 ngày, cửa hàng chạm hạn mức.
- Phân bổ cửa hàng theo gói, số cửa hàng trả phí và MRR.
- Cảnh báo: chờ duyệt, hết kỳ trong 5 ngày, hóa đơn quá hạn, đóng băng thủ công, không hoạt động 14 ngày, email lỗi/chưa rõ kết quả, webhook chưa xử lý, lỗi AI 24 giờ và ticket chưa giải quyết.
- Bảng hạn mức mỗi cửa hàng: sản phẩm đang bán, nhân sự hoạt động (gồm chủ cửa hàng), dung lượng tài sản MB, email và lượt AI trong tháng lịch Hà Nội. Dùng hạn mức **phiên bản đã cấp** giống billing cửa hàng; từ 80% màu vàng, hết/vượt màu đỏ. Email hệ thống không trừ hạn mức email cửa hàng.
- Bảng cửa hàng nổi bật: đơn, GMV và phí SaaS đã thu, xếp theo GMV trong kỳ.
- Bảng hoạt động tài khoản: email, vai trò và cửa hàng, ngày đăng ký, lần tương tác gần nhất và trạng thái. Không xuất mật khẩu, token hoặc cấu hình tích hợp.

Đổi cửa sổ rồi quay lại không tải lại báo cáo. Khi lọc/làm mới hoặc gặp lỗi tạm thời, kết quả trước vẫn hiển thị; có trạng thái cập nhật/lỗi riêng.

## Định nghĩa số liệu

| Số liệu | Cách tính |
| --- | --- |
| Phí SaaS thực thu | Tổng sổ `billing_payments` trong kỳ, kể cả nhiều lần trả một hóa đơn. Ưu tiên `received_at` UTC chuyển sang ngày Hà Nội; bản ghi cũ thiếu trường này dùng `created_at`. Không cộng đơn hoa. |
| MRR hiện tại | Tổng giá tháng của phiên bản gói ở cửa hàng đã duyệt, subscription active và còn quyền sử dụng. Loại gói Free, dùng thử và store bị đóng băng. Đây là giá trị gói định kỳ hiện tại, không phải doanh thu thực nhận hoặc MRR lịch sử. |
| Đơn/GMV | Đơn được tạo trong khoảng ngày chọn. GMV chỉ cộng các đơn hiện có trạng thái đã giao; đơn hủy không được cộng. Số đơn gồm cả đơn hủy. Không phải GMV theo ngày giao. |
| Hạn mức | Snapshot hiện tại; email/AI theo tháng lịch, độc lập bộ lọc ngày. AI bao gồm lượt thành công và lượt đang chạy còn lease, đồng bộ với cơ chế giữ hạn mức của billing. |
| Hoạt động tài khoản | Lần điều hướng hoặc tương tác thực khi website hiển thị. Cập nhật tối đa một lần/phút. Refresh auth, polling và thao tác hỗ trợ Ghost không làm tăng chỉ số. Tài khoản đã xóa/khóa không được tính vào KPI hoạt động 30 ngày. |
| Hoạt động cửa hàng | Mốc mới nhất của tương tác workspace, thao tác audit do thành viên (không phải platform admin) thực hiện, hoặc đơn mới. Loại tác vụ billing tự động. Không đồng nghĩa cửa hàng đang online. |

Các KPI hiện tại không bị biến thành snapshot quá khứ khi chọn khoảng ngày. GET báo cáo không chạy đối soát gói, tạo hóa đơn hoặc gửi mail. Gói đã hết quyền nhưng chưa được worker đồng bộ có nhãn cảnh báo; quota vẫn thể hiện snapshot đang lưu để có thể đối soát.

## Research và hướng bổ sung

[Stripe Billing Analytics](https://docs.stripe.com/billing/subscriptions/analytics) phân biệt MRR, tiền thu, subscriber, trial và usage. Thiết kế áp dụng nguyên tắc tách chỉ số, đồng thời công khai quy tắc MRR riêng của Fleurious (loại store đóng băng và quyền hết hạn).

[ChartMogul All Subscribers](https://help.chartmogul.com/article/214-chart-all-subscribers) và [Cohort analysis](https://help.chartmogul.com/article/161-cohort-analysis) là tham khảo cho phân nhóm Free/trial/paid và theo dõi duy trì sử dụng. Chưa hiển thị churn, chuyển đổi dùng thử, LTV hoặc cohort lịch sử vì snapshot hiện tại không đủ để tính đúng. Bước sau cần ghi sự kiện bắt đầu/kết thúc trial, chuyển gói, chuyển trả phí và snapshot MRR theo ngày; sau đó mới bổ sung churn/retention, funnel đăng ký → duyệt → hoạt động → trả phí.

Phiên bản này tổng hợp hạn mức của các cửa hàng rồi lọc/phân trang phía server. Khi số lượng store lớn, cần bảng tổng hợp usage và index/profile truy vấn, thay vì quét toàn bộ danh mục ở mỗi lần mở báo cáo. Health là số lỗi đang ghi nhận, chưa phải kiểm tra trực tiếp trạng thái SMTP/DeepSeek/ngân hàng. Chưa có dữ liệu hoạt động trước khi triển khai sẽ ghi “Chưa ghi nhận”, không backfill thời điểm giả.

## Migration và kiểm thử

Migration cộng thêm, chạy lại an toàn: `account_activity` và `workspace_activity`, lưu UTC DATETIME với khóa ngoại cascade. `workspace_activity` được bảo vệ tenant SQL; ghi nhận cần đăng nhập và membership active của đúng store. Không cần thêm cấu hình môi trường.

- Local: `npm run db:platform-overview`.
- Production/TiDB: backup và kiểm tra khôi phục trước; `npm run db:platform-overview:tidb -- --production-backup-verified` **trước khi phát hành code**.
- API/SQL QA: đặt biến kết nối tới `fleur_saas_test`, cổng 3310, rồi `npm run test:platform-overview`. Runner dùng handler/auth/SQL thật, chặn mạng ngoài và worker gửi mail.
- UI QA: app local đang chạy, `npm run test:platform-overview:ui`. Chặn toàn bộ API bằng fixture, không ghi nghiệp vụ; kiểm tra 1440/768/390/360px, bộ chọn ngày, icon modal, bộ lọc, phân trang và quay lại cửa sổ. Ảnh/report ở `.local/platform-overview-qa` (không commit).

Local đã áp dụng migration. Production chưa thay đổi.
