# Gói dịch vụ, dùng thử, hóa đơn và đóng băng

> Chính sách hiện hành: [EXPERIENCE-PLAN.md](EXPERIENCE-PLAN.md). Hết quyền paid/trial chưa trả đủ hoặc ngừng gia hạn rồi hết kỳ sẽ tự chuyển Trải nghiệm, không đóng băng vì billing. Các mô tả đóng băng/hết thử và gia hạn gói 0 đồng bên dưới là hành vi cũ; khóa thủ công vẫn được giữ.

## Kỳ dùng thử trước kỳ tháng

- Đăng ký mới chụp phiên bản gói, giá tháng đầu, hạn mức và số ngày thử. Cửa hàng chờ duyệt không bị trừ ngày. Khi được duyệt/tự duyệt mới bắt đầu N ngày, mỗi ngày 24 giờ.
- Trang mở cửa hàng cho chọn một trong ba gói, xem giá/ngày thử/hạn mức trước khi gửi. Nếu ưu đãi thay đổi lúc form đang mở, server từ chối bản cũ và form tải lại danh mục để người dùng xem trước khi gửi lại.
- `trialing` là Đang dùng thử; khác với `free` là gói miễn phí. Không tạo khoản phải trả ngay lúc duyệt nếu có N ngày thử. Giá tháng 0 vẫn tiếp tục miễn phí sau thử; 0 ngày thử với gói có phí phải trả tiền mới vận hành được.
- Cấu hình thử tăng/giảm/tắt chỉ áp dụng đăng ký mới. Đã chờ duyệt/đang thử giữ ưu đãi đã cấp. Mỗi store một lượt; đổi gói, duyệt lại, mở băng không cấp lại.
- Một nguồn quyền sử dụng dựa vào mốc UTC chính xác, hiển thị giờ Việt Nam. Khoảng hiệu lực là `[start,end)`, hết hạn ngay tại end. Các trường DATE cũ chỉ phục vụ tương thích; store cũ giữ quy tắc ngày cuối kỳ bao gồm hết ngày.
- Thanh toán sớm tạo kỳ đã trả tiếp theo, vẫn giữ nguyên thử đến hết hạn. Đến mốc đó mới chuyển sang kỳ tháng và quyền lợi của gói đã chọn.
- Thanh toán sau khi hết quyền sử dụng bắt đầu đủ một tháng từ lúc nhận đủ tiền, không tính thời gian đóng băng. Cộng tháng lịch theo ngày neo và giờ Việt Nam, có xử lý ngày 29–31/năm nhuận.
- Hóa đơn giữ kỳ dự kiến (`starts_at/ends_at`) riêng với kỳ thực tế sau thu đủ (`effective_start_at/effective_end_at`); không sửa giá/chứng từ đã phát hành khi danh mục gói thay đổi.
- Đổi gói có hiệu lực sau kỳ hiện tại và các kỳ đã thu tiền trước đó. Kỳ 0 đồng chưa bắt đầu có thể thay; kỳ đã thu tiền được giữ nguyên. Preview hiển thị giá, ngày áp dụng và cảnh báo quota; xác nhận kiểm tra lại phiên bản/trạng thái để tránh giá cũ hoặc xung đột webhook. Có thể thay hóa đơn tương lai chưa thu bằng gói khác; QR/lịch nhắc cũ bị hủy. Đã thu một phần hoặc còn công nợ lịch sử phải xử lý trước. Worker không tự thay gói store đã chọn. Chi tiết chính sách và nghiên cứu: [PLAN-CHANGES.md](PLAN-CHANGES.md).
- Hạn mức hiện có gồm sản phẩm active, nhân sự active và dung lượng file. Chúng là số đối tượng/dung lượng đang có, không reset theo tháng và không xóa dữ liệu khi hết thử. Hạn mức của phiên bản đã cấp được dùng cả trong UI và API quota.

## Nhắc hạn và đóng băng

Cron `/api/email/worker` hiện chạy hằng ngày lúc 02:00 UTC (09:00 Việt Nam). Worker tạo hóa đơn trong cửa sổ còn tối đa 5 ngày và nhắc 5/1 ngày một lần cho mỗi hóa đơn. Giờ gửi thực tế phụ thuộc lượt chạy worker, không cam kết đúng từng giây trước hạn. Có thể gọi endpoint bằng scheduler ngoài thường xuyên hơn với Bearer CRON_SECRET; không cần đổi logic billing.

- Trial 2–4 ngày: phát hành khi bắt đầu; không gửi nhắc 5 ngày, chỉ nhắc trong cửa sổ 1 ngày. Trial 1 ngày gộp hạn vào email bắt đầu, không gửi dồn thư nhắc.
- Thư có thể chỉnh trong Email & chương trình: bắt đầu thử, hết thử, nhắc 5/1 ngày, đóng băng và xác nhận nhận tiền. SMTP/EMAIL_ENABLED và scheduler cần cấu hình để gửi thật.
- Hết hạn chưa trả đủ: chặn vận hành/upload/đơn mới; giữ workspace đọc, lịch sử và thanh toán. Marketplace lọc mốc hết hạn ngay cả khi cron chưa chạy. Các API ghi/checkout kiểm tra mốc thật và kỳ đã trả trước, không chờ cron.
- Hóa đơn chuyển đổi sau thử là yêu cầu thanh toán cho dịch vụ tương lai, không phải nợ đã sử dụng. Trong lúc kỳ hiện tại còn hiệu lực, hóa đơn tương lai chưa thu không rút quyền hiện tại. Công nợ lịch sử của store cũ tiếp tục được đối chiếu.
- Nhận tiền một phần chưa cấp tháng. Thu đủ mới cấp kỳ một lần và mở lại đóng băng do billing; không mở đóng băng thủ công.
- Ngừng gia hạn hủy hóa đơn tương lai chưa thu/QR và cả kỳ 0 đồng đã đặt trước. Nếu kỳ sau đã thu tiền, cần platform xử lý trước. Store có thể chọn gói/thanh toán lại để tiếp tục.

## Gia hạn dùng thử trong platform

Platform → Cửa hàng → Chi tiết → Gói dịch vụ:

- Xem ngày đã cấp, phiên bản ưu đãi, hạn hiện tại. Form gia hạn có số ngày cộng thêm, lý do và hạn mới để xem trước.
- Chỉ áp dụng khi đang thử, tối đa 90 ngày mỗi thao tác/365 ngày tổng. Không rút ngắn thử và không tự cấp lại store đã hết thử.
- Từ chối nếu kỳ sau đã nhận tiền. Kỳ 0 đồng chưa bắt đầu không phải tiền đã thu, vẫn có thể thay thế.
- Vô hiệu hóa hóa đơn chưa thu/QR/lịch nhắc cũ, phát hành bản thay theo hạn mới, giữ giá và gói đã chọn; ghi audit chi tiết và thông báo store. Version chống cộng ngày lặp khi gửi lại.
- Form sửa subscription chung không được xóa thử hoặc ghi đè kỳ đã quản lý qua hóa đơn. Store cũ vẫn giữ form tương thích; không tự chuyển dữ liệu cũ sang chính sách thử mới.

## SePay và đối soát

- Platform → Cấu hình → Ngân hàng nhận phí dịch vụ dùng để thu phí platform. Tài khoản ngân hàng merchant chỉ nhận tiền đơn hoa.
- Credential webhook tạo/copy trong Platform. Credential tắt không nhận webhook.
- QR còn 10 phút để hiển thị. Với hóa đơn dịch vụ, giao dịch thật đến sau lúc QR hết hạn vẫn được đối chiếu nếu hóa đơn còn hiệu lực; không bỏ tiền vì hết thời gian hiển thị QR.
- Nhận từng phần hoặc nhận đủ qua SePay và thủ công dùng chung ledger. Webhook có thời điểm giao dịch ngân hàng hợp lệ dùng thời điểm đó; không lấy mốc từ trình duyệt. Thu đủ mới áp dụng tháng.
- Provider event/reference chống nhận trùng, cùng khóa store/subscription/invoice để tránh đua với worker. Kỳ tương lai đã trả giữ nguyên hạn thử; thanh toán lại không cộng tháng hai lần.
- Tiền thừa, tiền đến QR/hóa đơn đã hủy hoặc giao dịch mới gửi vào QR đã thanh toán vào **Giao dịch cần đối soát** trong Cấu hình. Không tự cộng thêm kỳ hoặc ghi mất khoản tiền này. Platform xác minh ngân hàng trước khi xử lý thủ công.
- Hóa đơn có tiền đã thu không được hủy. Lịch nhắc còn chờ bị hủy sau thanh toán, hủy hóa đơn, đổi gói hoặc gia hạn thử.
- Yêu cầu đổi gói có phí chưa nhận tiền tự hết hạn sau 10 phút; hóa đơn gia hạn và khoản đã thu một phần được giữ. Deadline thay gói độc lập với hạn kỳ sử dụng/phiên QR. Tiền tới yêu cầu hết hạn đi vào đối soát; không tự kích hoạt. Chi tiết tại [PLAN-CHANGES.md](PLAN-CHANGES.md).
- SePay là chuyển khoản có webhook xác nhận, không tự trích tiền tài khoản hằng tháng.

## Migration và dữ liệu cũ

Schema bổ sung snapshot đăng ký, mốc access UTC, kỳ dự kiến/thực tế trên hóa đơn, thời điểm nhận tiền, trạng thái áp dụng kỳ và audit JSON. Không sửa ngày hay ledger của store hiện hữu. Trường `billing_policy=0` giữ quyền cũ; đăng ký mới dùng `billing_policy=1`.

```powershell
# Local: backup đầy đủ, restore sang MySQL QA 3310, chạy migration hai lần,
# so hash ngày kỳ/hóa đơn/tiền/đơn/sản phẩm rồi mới thêm schema vào DB local.
node --env-file=.env.local scripts/migrate-local-trial.mjs
npm run db:trial-report
```

Báo cáo chỉ đọc phân loại store cũ cần giữ paid period, trial đã có, quyền miễn phí cũ và ưu đãi pending chưa có snapshot. Không tự reset tất cả thành N ngày từ ngày migration. Cửa hàng miễn phí cũ không bị rút xuống N ngày mới.

Production: backup/restore và đối chiếu trước, chạy `scripts/migrate-saas.mjs --production-backup-verified` bằng môi trường production; xem báo cáo chỉ đọc trước khi chạy đối chiếu billing. Không chạy file local migration vào TiDB. Không có push/deploy hoặc thay đổi TiDB trong lần triển khai local này.

## Kiểm thử

Dùng riêng `MYSQL_DATABASE=fleur_saas_test`, `MYSQL_PORT=3310`, TEST_ORIGIN trỏ app production QA.

```powershell
npm test
npm run test:trial-billing -- --ui
npm run test:billing
npm run test:saas
node --import tsx scripts/test-saas-events.ts
```

Bộ mới kiểm tra snapshot ngày/giá/quota, duyệt lại, thử 0/1/3/7/14/30 ngày, trả sớm/muộn/một phần, kỳ trả trước, đổi gói, gia hạn thử, hủy hóa đơn/QR, nhắc hạn, SePay trễ/trùng/thừa, đóng băng thủ công, miễn phí sau thử và UI desktop/mobile. SMTP dùng sender giả; không chuyển khoản hay gửi mail thử thật.

Kết quả local ngày 19/10/2026: 33 kiểm tra trial theo tài khoản (có UI mobile), 53 kiểm tra trial-first (có UI), 49 kiểm tra đổi gói/hết hạn, 30 kiểm tra billing tương thích, 55 assertion SaaS, 5 kiểm tra CRM/email/domain events đều qua. `npm test`, build production và `git diff --check` qua. Migration local đã có backup, restore và chạy lặp trên bản sao; hash các giá trị kinh doanh trước/sau không đổi. Các trial cũ giữ nguyên kỳ đã cấp; đăng ký mới áp dụng onboarding Khởi đầu theo `trial_days` cấu hình và một lượt discovery. API gói trên app local 3000 trả HTTP 200 và đủ ba gói.
# Cập nhật số lượt dùng thử

Từ 19/10/2026 áp dụng [chính sách onboarding và discovery theo tài khoản](ACCOUNT-TRIALS.md): Khởi đầu tự động theo số ngày admin cấu hình cho cửa hàng đầu tiên, cộng một lượt dùng chung cho các gói khác. Các quy tắc snapshot, hóa đơn, nhắc hạn và đối soát trong tài liệu này vẫn được giữ.

Chính sách hiện hành từ 20/10/2026: [Trải nghiệm Free và một lượt paid trial](EXPERIENCE-PLAN.md) thay thế tự cấp Khởi đầu. Các kết quả và chính sách hai nhóm lượt ở trên là lịch sử; giữ nguyên quyền cũ đã cấp.
