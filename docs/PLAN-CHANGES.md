# Đổi gói khi cửa hàng đang sử dụng dịch vụ

## Nghiên cứu và lựa chọn cho Fleurious

Nguồn chính thức đối chiếu ngày 19/10/2026:

- [Stripe — Prorations](https://docs.stripe.com/billing/subscriptions/prorations): đổi ngay giữa kỳ cần tính phần thời gian còn lại; tránh cấp credit cho thời gian chưa trả tiền. Khoản giảm không mặc nhiên được hoàn tiền.
- [Stripe — Pending updates](https://docs.stripe.com/billing/subscriptions/pending-updates): chỉ áp dụng thay đổi có thu phí khi thanh toán thành công.
- [Chargebee — Proration](https://www.chargebee.com/docs/billing/2.0/subscriptions/proration): tính phần sử dụng còn lại và cách xử lý credit tùy tình trạng thu tiền của hóa đơn.
- [Chargebee — Change subscription plan](https://www.chargebee.com/docs/2.0/subscriptions/articles-and-faq/can-i-change-the-plan-of-an-existing-subscription-on-behalf-of-the-customer-.html): phân biệt thay đổi ngay và thay đổi cuối kỳ.

Fleurious chọn **đổi cuối thời gian đã cấp**, cho cả nâng và hạ gói. Đây là chính sách sản phẩm triển khai lần này, không phải yêu cầu bắt buộc của nhà cung cấp. Không có nâng gói ngay giữa kỳ, proration, ví credit hoặc hoàn tiền tự động. Phù hợp cơ chế chuyển khoản SePay hiện tại và giữ chính sách trial-first đã triển khai. UI nêu rõ trước khi cửa hàng xác nhận.

## Quy tắc

**Cập nhật 19/10/2026:** đổi gói trả phí vẫn không cấp lại trial; tài khoản có thể chủ động đăng ký lượt discovery còn lại theo [chính sách onboarding và discovery](ACCOUNT-TRIALS.md). Trial đã giữ được bảo toàn khi chọn kỳ trả phí tiếp theo.

1. Owner chọn bất kỳ gói đang mở bán, kể cả khi đang thử, đang trả phí hoặc có kỳ miễn phí đặt trước. Chỉ thẻ tương ứng hiển thị trạng thái đã chọn/đã trả; không khóa toàn bộ danh mục.
2. Preview hiển thị gói cũ/mới, giá hóa đơn thực tế, đã thu, cần thu, thời điểm bắt đầu/kết thúc, hạn mức mới và mức sử dụng vượt hạn. Preview chạy transaction rollback, không lưu hóa đơn/QR/email/lịch thay đổi.
3. Kỳ 0 đồng chưa bắt đầu có thể thay thế. Hóa đơn tương lai chưa thu có thể thay: void hóa đơn, hủy QR và lịch nhắc đang chờ trong cùng transaction. Chỉ xem trước không hủy gì.
4. Không xóa/void kỳ đã thu tiền. Nếu đã trả trước, gói khác bắt đầu sau **kỳ cuối đã trả**. Có thể nối tiếp nhiều kỳ mua thật; chọn lại gói cuối đã trả không tạo thêm hóa đơn hoặc thu tiền lần hai. Chọn lại gói đó cũng bỏ lựa chọn miễn phí/chưa thu nằm sau nó.
5. Hóa đơn đã thu một phần hoặc công nợ lịch sử không được đổi sang gói khác bằng cách bỏ tiền đã thu. UI trả thông báo cần xử lý hóa đơn trước. Không tự quy đổi khoản này thành credit.
6. Gói có phí chỉ được giữ kỳ khi nhận đủ tiền qua ledger chung SePay/thủ công. Worker không ghi đè gói cửa hàng đã chọn. Chưa đủ tiền không rút quyền hiện tại; hết quyền mà chưa đủ thì đóng băng theo billing cũ.
7. Giữ nguyên hạn dùng thử đã cấp, không dùng số ngày thử của gói đích để cấp lại. Thanh toán sau hạn mua đủ tháng từ thời điểm nhận đủ tiền; giữ cả kỳ dự kiến và kỳ thực tế.
8. Hạ gói không xóa sản phẩm, nhân sự, file hay dữ liệu cũ. Quota của gói mới có hiệu lực tại ranh giới; chặn thêm đối tượng/dung lượng vượt hạn. Preview cảnh báo theo mức dùng hiện tại; mức dùng có thể tăng/giảm trước khi chuyển.
9. Xác nhận dùng fingerprint trạng thái subscription, store, phiên bản gói và hóa đơn; kiểm tra dưới khóa store cùng với webhook. Giá/hạn/tiền thay đổi hoặc báo giá quá 15 phút thì yêu cầu xem lại. Hai yêu cầu đồng thời không cùng xác nhận báo giá đã cũ.
10. Mọi xác nhận chọn gói ghi audit trong cùng transaction. Đóng băng thủ công bởi platform không bị mở bởi thao tác đổi gói. Xác nhận kỳ miễn phí hoặc thanh toán thành công mới bật lại gia hạn đã ngừng; yêu cầu đổi gói còn chờ tiền giữ lựa chọn ngừng gia hạn trước đó.

## Thời hạn thanh toán yêu cầu đổi gói

- Hóa đơn có `purpose=plan_change` và giá lớn hơn 0 có đúng 10 phút từ khi xác nhận để nhận khoản thanh toán đầu tiên. `payment_deadline_at` tách khỏi `due_at` của kỳ dịch vụ; mở lại QR không kéo dài thời hạn. Preview 15 phút là thời gian xem báo giá, không phải thời gian thanh toán.
- Chưa nhận tiền tại hạn: chuyển hóa đơn sang `void`, lý do `payment_timeout`; hủy mọi QR đang chờ và email nhắc liên quan, ghi audit/thông báo một lần. Nếu yêu cầu đã thay một kỳ miễn phí đặt trước, khôi phục đúng kỳ đó khi còn hiệu lực. Giữ gói và quyền sử dụng hiện có; không tự bật gia hạn đã bị chủ store ngừng.
- Đã thu một phần hoặc toàn bộ: không tự hủy. Khoản một phần vẫn có thể thu tiếp sau hạn; thu đủ mới cấp gói. Hóa đơn `renewal` không có thời hạn tự hủy này. QR gia hạn có phiên 10 phút, hết phiên có thể tạo QR mới, hóa đơn/ledger được giữ.
- Kiểm tra hạn dưới khóa store khi tạo QR, thanh toán, đọc billing và vận hành cửa hàng, cùng worker định kỳ. UI đếm ngược theo giờ server, cập nhật 5 giây khi chờ; khi về 0 tự yêu cầu đồng bộ, ẩn QR và hiển thị hết hạn. Đóng modal vẫn tiếp tục đồng bộ yêu cầu chờ.
- SePay xử lý hết hạn trước giao dịch tài chính bằng transaction riêng để lỗi tiếp nhận không rollback thao tác hủy. Ledger kiểm tra lại tại thời điểm xử lý. Tiền tới yêu cầu đã hết hạn (kể cả webhook đến trễ với thời điểm ngân hàng trước hạn) vào đối soát, không tự khôi phục yêu cầu hoặc cấp gói. Tiền nhận trước hạn đã ghi ledger được bảo toàn khi quá hạn.
- VietQR/chuyển khoản không thể ngăn ngân hàng nhận tiền sau hạn. UI ẩn QR và backend ngừng tự áp dụng yêu cầu; platform xử lý khoản đến muộn trong Giao dịch cần đối soát.
- Cron hiện chạy hằng ngày: việc ghi trạng thái khi không ai truy cập phụ thuộc lượt worker; tính hợp lệ thanh toán luôn được kiểm tra theo hạn thật, không chờ cron. Có thể dùng scheduler ngoài gọi worker thường xuyên hơn khi cần dọn trạng thái nền sát từng phút.

Giao dịch preview/xác nhận sử dụng `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` cho đúng một transaction, kết hợp khóa store/subscription và hóa đơn. Tránh gap lock của MySQL khi hai store chưa có hóa đơn cùng tạo bản xem trước; không thay đổi isolation của các request khác trong pool. Dùng cú pháp tương thích [TiDB SET TRANSACTION](https://docs.pingcap.com/tidbcloud/sql-statement-set-transaction/), không yêu cầu bật cú pháp shared lock/noop vốn không được TiDB hỗ trợ mặc định.

## Ví dụ

- Thử đến 25/10, đã đặt kỳ Khởi đầu 0đ: chọn Studio tạo hóa đơn Studio bắt đầu 25/10; kỳ miễn phí chưa bắt đầu bị thay sau khi xác nhận.
- Studio đã trả tới 25/11: chọn Atelier bắt đầu 25/11. Nếu còn một kỳ Studio trả trước tới 25/12, Atelier bắt đầu 25/12.
- Atelier đang có 15 nhân sự, đổi sang gói giới hạn 10: giữ 15 nhân sự; từ ngày áp dụng không thể thêm nhân sự cho đến khi giảm mức dùng hoặc nâng gói.

## Kiểm thử

Chỉ chạy trên database QA `fleur_saas_test`, port `3310`, ứng dụng QA production port `3005`:

```powershell
npm run test:plan-changes -- --ui
npm run test:timeout-migration
npm run test:trial-billing -- --ui
npm run test:billing
npm run test:saas
npm test
```

Migration mới thêm `purpose`, `payment_deadline_at`, `void_reason`, `fallback_invoice_id` vào invoices. Chạy `migrate-saas.mjs` sau backup/restore được xác minh. Một lần backfill chỉ phân loại yêu cầu đổi sang gói khác nằm ở kỳ tương lai còn chờ thanh toán, lấy hạn từ thời gian tạo + 10 phút; không đổi giá, số tiền thu hay ledger. Hóa đơn gia hạn/công nợ cũ giữ mặc định `renewal`. Local dùng `node --env-file=.env.local scripts/migrate-local-trial.mjs` để backup, restore thử và đối chiếu trước/sau. Chưa push/deploy trong lần cập nhật này.

Backfill tính hạn theo epoch của `created_at` để không lệch múi giờ khi MySQL local dùng giờ Việt Nam. Migration `plan-change-timeout-utc-v2` sửa các yêu cầu chưa thu đã có trước v1, kể cả khi kết nối migration đổi từ giờ Việt Nam sang UTC. Không thay hạn của yêu cầu mới hoặc khoản đã thu tiền.

Kết quả QA ngày 19/10/2026: 49 kiểm tra đổi gói/hết hạn (có UI desktop/mobile, thanh toán chạy đồng thời với hết hạn và webhook đến muộn), 4 kiểm tra migration múi giờ, 53 trial-first, 30 billing tương thích, 55 assertion SaaS và 5 CRM/email đều qua. `npm test`, build production và `git diff --check` qua. Các bài thử thanh toán dùng ledger kiểm thử/webhook giả lập, không chuyển tiền hoặc gửi email thật. Ảnh QA nằm trong `.local/plan-change-qa/`.
