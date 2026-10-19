# Kế hoạch kỳ dùng thử trước kỳ tháng

Trạng thái: đã triển khai trên local. Hành vi vận hành và hướng dẫn migration/kiểm thử nằm trong BILLING-LIFECYCLE.md. Đây là bản kế hoạch làm cơ sở triển khai.

## 1. Quy tắc nền tảng

**Cập nhật 19/10/2026:** quy tắc số lượt theo store bên dưới được thay bằng [chính sách onboarding theo `trial_days` cấu hình và một lượt discovery theo tài khoản](ACCOUNT-TRIALS.md). Giữ nguyên các quy tắc snapshot, thời gian, hóa đơn và bảo toàn thanh toán.

- Một cửa hàng có tối đa một lượt dùng thử, không phải một lượt cho mỗi gói. Đổi gói, duyệt lại hoặc mở băng không cấp lượt mới.
- Khi đăng ký thành công, lưu phiên bản gói và số ngày dùng thử đã giới thiệu cho cửa hàng. Store chờ duyệt giữ ưu đãi này dù cấu hình thay đổi sau đó.
- Chỉ bắt đầu đếm khi cửa hàng được duyệt và có quyền vận hành workspace; chế độ tự duyệt bắt đầu ngay khi đăng ký thành công. Giao dịch duyệt lặp không đổi mốc.
- Nếu đủ điều kiện và N > 0: kỳ hiện tại là dùng thử N ngày, không tạo kỳ tháng song song và không tạo khoản phải trả ngay lúc duyệt.
- Nếu N = 0 và gói có phí: duyệt xong chờ thanh toán, chưa được vận hành; kỳ tháng bắt đầu khi nhận đủ tiền. Không cấp miễn phí một tháng rồi coi là nợ.
- Gói giá tháng bằng 0 khác với dùng thử. Hết thử vẫn có thể tiếp tục miễn phí nếu giá tháng của chính sách áp dụng là 0. Muốn thu tiền sau thử phải cấu hình giá tháng lớn hơn 0.
- Phân biệt nhãn: Chờ duyệt, Đang dùng thử, Chờ thanh toán, Đang sử dụng, Hết hạn, Đã hủy. Đóng băng thủ công là trạng thái quản trị độc lập với trạng thái thanh toán.

## 2. Tính thời gian

Lưu mốc UTC chính xác đến giây, hiển thị và tính tháng lịch theo Asia/Ho_Chi_Minh. Một ngày dùng thử bằng 24 giờ.

```text
trial_start = thời điểm được duyệt lần đầu
trial_end   = trial_start + N * 24 giờ
có quyền dùng thử khi trial_start <= now < trial_end

Thanh toán đủ trước hoặc đúng trial_end:
  paid_start = trial_end
Thanh toán đủ sau trial_end:
  paid_start = thời điểm nhận đủ tiền
paid_end = paid_start cộng 1 tháng lịch
```

Ví dụ: duyệt 19/10/2026 lúc 10:00, thử 14 ngày → hết thử 02/11/2026 lúc 10:00. Trả tiền 30/10 → tháng đầu từ 02/11 đến 02/12. Trả tiền 05/11 lúc 15:00 → tháng đầu từ 05/11 lúc 15:00 đến 05/12 lúc 15:00; không thu tiền cho ba ngày bị đóng băng.

- Trả sớm: ghi nhận kỳ đã thanh toán kế tiếp, vẫn hiển thị kỳ dùng thử hiện tại đến đúng hạn. Không xóa trial khi vừa nhận tiền.
- Gia hạn một kỳ trả phí còn hiệu lực: nối tiếp cuối kỳ hiện tại. Trả sau khi đã hết quyền sử dụng: bắt đầu đủ một tháng từ lúc thanh toán đủ, không backdate vào thời gian bị khóa.
- Ngày neo tháng là ngày bắt đầu kỳ trả phí đầu tiên. Ngày 31 chuyển tới ngày cuối tháng ngắn, tháng sau quay về ngày 31; không cộng cố định 30 ngày.
- Số ngày còn lại = ceil((end - now) / 24 giờ), tối thiểu 0; dưới một ngày hiển thị giờ còn lại và mốc hết hạn cụ thể.
- Thời điểm nhận tiền lấy từ giao dịch ngân hàng đã xác minh, không từ dữ liệu client. Webhook đến chậm vẫn áp dụng theo giao dịch gốc; đối soát thủ công lưu rõ thời điểm hiệu lực và người xác nhận.

## 3. Admin thay đổi ngày dùng thử

Mặc định, thay đổi cấu hình chỉ áp dụng cho đăng ký mới sau khi lưu. Không tính lại ngày hết hạn từ plans.trial_days ở mỗi lần tải trang.

| Nhóm cửa hàng | 14 → 7 ngày | 14 → 30 ngày | Đổi về 0 ngày |
| --- | --- | --- | --- |
| Đăng ký mới sau cập nhật | Nhận 7 ngày | Nhận 30 ngày | Không dùng thử |
| Đã đăng ký, đang chờ duyệt | Giữ 14 ngày, bắt đầu khi duyệt | Giữ 14 ngày | Giữ 14 ngày |
| Đang dùng thử | Giữ hạn đã cấp | Giữ hạn đã cấp | Giữ hạn đã cấp |
| Đã hết thử hoặc đang trả phí | Không đổi | Không đổi | Không đổi |

Admin cần cấp thêm ngày cho store hiện hữu thì dùng thao tác riêng **Gia hạn dùng thử**, không gắn với nút lưu danh mục gói:

- Chọn cửa hàng đang dùng thử, nhập số ngày cộng thêm và lý do; xem trước hạn cũ/hạn mới rồi xác nhận. Không hỗ trợ rút ngắn hàng loạt trong phiên bản đầu.
- Chỉ áp dụng cho store đang trial và chưa có tiền thu cho kỳ chuyển đổi. Đã thu một phần hoặc toàn bộ: chuyển sang xử lý billing riêng, không tự dời kỳ đã thu.
- Hủy hóa đơn tương lai chưa thu, QR còn chờ và lịch nhắc cũ; tạo bản thay thế theo hạn mới, giữ lịch sử và giá đã cam kết. Thao tác có khóa chống áp dụng lặp và audit.
- Không tự mở lại store hết thử, không thay đổi đóng băng thủ công. Nếu muốn tặng thêm cho store đã hết thử cần một chính sách cấp quyền riêng sau này.

UI danh mục gói hiển thị rõ: “Số ngày dùng thử áp dụng cho đăng ký mới. Cửa hàng đã đăng ký giữ quyền lợi đã được cấp.” Hiển thị số store chờ duyệt/đang thử được giữ chính sách cũ.

## 4. Giá, hạn mức và đổi gói

- Lưu bản chụp ưu đãi gồm phiên bản, ngày thử, hạn mức thử và giá tháng đầu sau thử ngay khi đăng ký. Không để cập nhật số ngày vô tình thay giá hoặc quyền lợi của store đang dùng.
- Giá tháng đầu sau thử theo bản cam kết; thay giá kỳ sau cần chính sách thông báo và áp dụng riêng, không sửa hóa đơn đã phát hành.
- Đổi gói trong thời gian thử không cấp lại ngày thử. Bản đầu cho phép chọn gói sẽ dùng sau thử; kỳ thử vẫn dùng gói/quyền lợi đã cấp, gói mới và giá được xác nhận trên hóa đơn kỳ tới.
- Ba hạn mức hiện có là sản phẩm đang bán, nhân sự hoạt động và dung lượng file. Đây là số đối tượng/dung lượng hiện hữu, không reset theo tháng và không xóa khi hết thử. Hạn mức số đơn theo kỳ chưa thuộc danh mục gói hiện tại.
- Nếu chuyển sang gói có hạn mức thấp hơn dữ liệu đang có: giữ dữ liệu, chặn tạo thêm đối tượng vượt hạn mức; giải thích trước khi xác nhận gói. Không làm mất lịch sử đơn.

## 5. Hóa đơn, SePay và hết hạn

- Có thể lưu chứng từ dùng thử 0 đồng với loại riêng nếu cần đối chiếu; không ghi là tiền đã thu, không tính vào doanh thu trả phí.
- Phát hành hóa đơn chuyển sang tháng trả phí trước 5 ngày hết thử; thử dưới 5 ngày thì phát hành khi bắt đầu. Giá và phiên bản gói được chụp trên hóa đơn.
- Hóa đơn ghi rõ kỳ dự kiến, hạn thanh toán và quy tắc: trả sau khi hết thử thì kỳ thực tế tính từ lúc nhận đủ tiền. Lưu kỳ dự kiến và kỳ thực tế riêng để không âm thầm sửa chứng từ đã phát hành.
- Chuyển khoản qua SePay là nhận thanh toán, không phải tự động trích tiền ngân hàng hằng tháng.
- Trả một phần chưa kích hoạt kỳ tháng. Nhắc số còn thiếu; đến hạn vẫn khóa nếu chưa trả đủ. Thu đủ mới cấp quyền, xử lý giao dịch và cấp kỳ trong cùng transaction.
- Hết thử chưa trả đủ: chặn vận hành, ẩn marketplace và nhận đơn mới; vẫn xem workspace, lịch sử, xuất dữ liệu theo quyền hiện có và thanh toán được. Giữ dữ liệu, không tự hủy đơn đang xử lý.
- Không coi tháng tương lai chưa sử dụng là nợ dịch vụ đã cung cấp. Cho phép từ chối gia hạn; hóa đơn chưa thu có thể hủy theo quy tắc hiện có. Hóa đơn đã thu một phần phải được đối soát trước khi hủy.
- Thanh toán đủ chỉ mở băng do billing; store bị admin đóng băng vẫn giữ nguyên và thấy rõ lý do.
- QR hết hiệu lực 10 phút không làm mất tiền thật đã chuyển: webhook vẫn đối chiếu mã hóa đơn còn hiệu lực. Tiền đến hóa đơn đã hủy/thay thế hoặc không khớp phải vào danh sách cần đối soát, không tự cấp trùng kỳ.
- Khóa chống trùng theo giao dịch, hóa đơn và lần áp dụng kỳ. Kiểm tra hết hạn và nhận tiền đồng thời phải dùng khóa bản ghi chung.

## 6. Nhắc hạn và giao diện

- Email/thông báo trước 5 ngày, trước 1 ngày, hết thử, nhận tiền và mở lại do thanh toán. Nhãn phân biệt hết dùng thử với hết kỳ trả phí.
- Trial ngắn không gửi bù mọi mốc đã qua: 2–4 ngày chỉ nhắc khi bắt đầu và mốc 1 ngày; trial 1 ngày gộp vào thông báo bắt đầu. Không gửi nhiều email nhắc cùng thời điểm.
- Đã trả đủ: bỏ nhắc thanh toán, hiển thị “Đã thanh toán kỳ tiếp theo, bắt đầu …”. Đổi hạn bằng thao tác được phép thì lập lại lịch nhắc theo phiên bản hạn mới và hủy lịch cũ.
- Workspace hiển thị tên gói, loại kỳ, ngày bắt đầu/kết thúc, còn lại, giá tháng sau thử, hạn mức và hóa đơn. Platform hiển thị thêm số ngày đã cấp, phiên bản chính sách và lịch sử thay đổi.
- Worker xử lý hàng đợi; các API vận hành kiểm tra quyền theo mốc thời gian thật. Không dựa riêng vào cron hằng ngày để đóng băng đúng hạn. Cần scheduler đủ thường xuyên cho nhắc hạn và cập nhật marketplace; UI đọc dữ liệu đã đối chiếu để tránh trạng thái cũ.

## 7. Dữ liệu và chuyển đổi hệ thống hiện có

- Tận dụng plan_versions và trial_claims, bổ sung snapshot lúc đăng ký, trạng thái trialing/chờ kích hoạt, mốc chính xác cho các kỳ và kỳ trả phí đã đặt trước.
- Dùng một nguồn tính quyền sử dụng chung cho duyệt store, workspace, hóa đơn, checkout, hạn mức, worker và webhook; bỏ chỗ suy luận từ giá 0 hoặc trộn NOW() với CURDATE().
- Sửa đường admin chỉnh subscription: không được xóa trial vô tình hoặc cấp mới lượt thử qua việc sửa ngày kỳ.
- Migration chạy dry-run, phân loại store chờ duyệt, trial đã biết mốc, miễn phí cũ, đã trả tiền, có hóa đơn mở/thu một phần và đóng băng thủ công.
- Store trial có dữ liệu xác thực: giữ mốc đã cấp. Store đã trả tiền: giữ toàn bộ tiền và kỳ đã mua. Store miễn phí cũ không tự bị rút xuống số ngày thử mới; lập danh sách để admin quyết định trước khi chuyển.
- Không reset toàn bộ store thành N ngày từ ngày migration. Hóa đơn sai do logic cũ chỉ hủy khi chưa thu và có dấu vết; tiền đã thu cần đối soát, không xóa hoặc sửa ledger.
- Chưa tự động chuyển dữ liệu local/production trong giai đoạn lên kế hoạch này.

## 8. Thứ tự thực hiện và tiêu chí nghiệm thu

1. Chốt trạng thái, chính sách snapshot và chuẩn thời gian; chuẩn bị migration có dry-run.
2. Sửa đăng ký/duyệt để cấp trial trước, tách free plan và trial, sửa hàm kiểm tra quyền chung.
3. Sửa hóa đơn, chuyển đổi trial sang tháng, trả sớm/muộn/một phần, SePay và đóng băng.
4. Đồng bộ UI store/platform, hạn mức, mail, thông báo và lịch nhắc; thêm thao tác gia hạn trial riêng.
5. Chạy kiểm thử DB/API/UI trên môi trường tách biệt, sau đó đối chiếu dữ liệu cũ trước khi chuyển đổi.

Các ca bắt buộc: N=0/1/3/14/30; chờ duyệt nhiều ngày; duyệt lặp; cấu hình tăng/giảm/tắt trial với từng nhóm store; trả trước/đúng/sau hạn; webhook trễ/lặp/đồng thời cron; trả thiếu/thu đủ; QR hết hạn; hóa đơn thay thế; đổi gói không reset trial; hạn mức theo kỳ; 28/29/30/31 và năm nhuận; hết hạn đúng giây; nhắc 5/1 ngày không trùng; đóng băng thủ công không tự mở; dữ liệu và hóa đơn cũ không mất.

## Tham khảo

- Stripe về tách ưu đãi thử với giá định kỳ: https://docs.stripe.com/billing/subscriptions/trials
- Stripe về mốc chu kỳ theo tháng lịch: https://docs.stripe.com/billing/subscriptions/billing-cycle

Tham khảo mô hình billing, không đề xuất thay SePay hoặc tích hợp Stripe cho dự án này.
