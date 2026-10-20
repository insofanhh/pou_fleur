# Hóa đơn dịch vụ của platform

## Tra cứu và đối soát

- Tìm theo mã `HD-xxxxxx`/ID, cửa hàng, email chủ cửa hàng, tên gói, kỳ hoặc mã giao dịch trong sổ thu tiền.
- Bộ lọc gói, trạng thái, khoảng **ngày tạo hóa đơn** theo Hà Nội (tối đa 366 ngày). Bỏ trống cả hai ngày để xem toàn bộ.
- Sắp xếp mới/cũ, hạn thanh toán gần nhất hoặc công nợ cao nhất. Phân trang server 20 dòng; bỏ giới hạn 500 hóa đơn của màn hình cũ. Tổng hợp tính trên toàn bộ kết quả lọc.
- Tag gói: Khởi đầu xanh dương, Studio tím, Atelier vàng, Trải nghiệm xanh lá. Dùng ID của **phiên bản hóa đơn**, không suy từ gói cửa hàng đang dùng. Hóa đơn cũ thiếu phiên bản chỉ xác định gói khi tên khớp catalog; còn lại dùng màu trung tính.
- Trạng thái có nhãn và màu riêng: chờ, thu một phần, quá hạn, đã thanh toán, miễn phí, đã hủy, hết hạn thanh toán.
- Bổ sung mã hóa đơn, email, ngày tạo, còn phải thu; kỳ dự kiến/đã xác nhận, ngày hết hạn và hạn phiên thanh toán.
- Icon thao tác mở modal chi tiết, ghi nhận tiền hoặc hủy. Modal có tổng tiền, kỳ sử dụng, thời điểm áp dụng và lịch sử thu tiền: mã giao dịch, thời gian nhận, số tiền. Bảng cuộn trong khung trên mobile; bộ chọn ngày dùng DateInput chung.

## Định nghĩa và bảo toàn nghiệp vụ

“Đang chờ” lọc mọi hóa đơn open, gồm thu một phần/quá hạn. “Thu một phần” lọc open có `0 < paid < amount`, kể cả đã quá hạn. “Quá hạn” là open còn nợ và đã qua due_at; hóa đơn cũ dùng cuối ngày due_date theo Hà Nội. Nếu vừa quá hạn vừa thu một phần, tag chính là Quá hạn, có ghi chú đã thu một phần. Hết hạn phiên thanh toán là void_reason `payment_timeout`, phân biệt với công nợ quá hạn còn mở.

“Đã thu” là tổng `invoices.paid` của các hóa đơn phù hợp, không phải tiền nhận trong khoảng ngày tạo. “Còn phải thu” chỉ cộng số còn thiếu của hóa đơn open; hóa đơn void không còn là công nợ phải thu. Lịch sử thu tiền lấy từ `billing_payments` và giữ thời gian UTC/Hà Nội đúng loại trường. Hóa đơn Free hiển thị miễn phí, không có hạn thanh toán giả.

Ghi nhận thủ công tiếp tục dùng `recordInvoicePayment`: kiểm tra quyền platform, mã giao dịch chống trùng, không nhận vượt số còn nợ, giữ quy tắc hết hạn phiên, thanh toán đủ mới kích hoạt/đổi gói và bảo toàn đóng băng thủ công. Không sửa số đã thu trực tiếp từ giao diện. Hóa đơn đã thu tiền hoặc đã xác nhận (kể cả Free/đặt trước giá 0) không được hủy bằng thao tác platform này. Hủy hóa đơn open chưa nhận tiền cần lý do, giữ audit và đóng QR đang chờ.

GET danh sách vẫn chạy cơ chế hủy phiên hết hạn hiện có. Không gọi đồng bộ toàn bộ kỳ/thông báo gia hạn khi chỉ thay bộ lọc; nút “Đồng bộ hóa đơn & trạng thái” là thao tác riêng. Kết quả cũ vẫn hiển thị khi làm mới/lỗi tạm thời; focus cửa sổ không refetch danh sách.

## Research

[Stripe Dashboard Search](https://docs.stripe.com/dashboard/search) hỗ trợ tra cứu invoice theo số, email và trạng thái. [Chargebee Invoice Overview](https://www.chargebee.com/docs/billing/2.0/invoices-credit-notes-and-quotes/invoice-overview) phân tách bộ lọc khách hàng, hóa đơn và giao dịch. [Chargebee outstanding payments](https://www.chargebee.com/docs/billing/2.0/kb/billing/is-it-possible-to-have-a-list-of-outstanding-payments) tham khảo cho tra cứu công nợ. Từ đó chọn các mục thực dụng: tìm mã giao dịch, công nợ còn lại, quá hạn, tổng hợp theo bộ lọc, chi tiết sổ thu và phân trang.

Chưa bổ sung hoàn tiền/credit note hoặc hóa đơn thuế: cần ledger và quy tắc nghiệp vụ riêng, không thể thực hiện bằng sửa trạng thái hóa đơn đang dùng. CSV có thể bổ sung sau với cùng bộ lọc server và phân quyền, giới hạn dung lượng và chống công thức trong dữ liệu xuất.

## Kiểm thử

Không cần migration/env mới cho thay đổi này.

- `npm run test:platform-invoices`: kết nối riêng `fleur_saas_test`, cổng 3310. Kiểm tra handler/auth/SQL, tổng hợp, snapshot, legacy, thời gian Hà Nội, hơn 500 hóa đơn, mã giao dịch và thanh toán/hủy.
- `npm run test:platform-invoices:ui`: app local; API được thay bằng fixture, không gọi ngân hàng/SMTP hay ghi dữ liệu thật. Kiểm tra tìm/lọc, tag, modal, thao tác, lỗi tạm thời, focus và bố cục 1440/768/390/360px.
- Ảnh/report: `.local/platform-invoices-qa` (ignored).
