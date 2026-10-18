# Fleurious — kế hoạch 3 gói thuê bao tháng và dùng thử

Ngày lập: 18/10/2026. Trạng thái: đề xuất sản phẩm và thiết kế triển khai; chưa thay đổi giá, thuê bao hoặc cơ sở dữ liệu đang chạy.

## 1. Cơ sở và phạm vi

Ảnh người dùng cung cấp ước tính: shop mới 30–90 đơn/tháng, nhỏ 90–210, trung bình 210–450, lớn 450–900, chuyên online 600–1.500+. Chưa có nguồn khảo sát hoặc chi phí vận hành thực tế đi kèm. Dùng các khoảng này để thiết kế phân khúc thử nghiệm; không coi là thống kê thị trường đã xác minh.

Mô hình đề xuất: **mỗi store một thuê bao**, đúng 3 gói công khai, thu trước từng tháng theo ngày kích hoạt của store. Một người sở hữu nhiều store có các kỳ và hóa đơn riêng. Không bổ sung gói miễn phí vĩnh viễn cho đăng ký mới; dùng thử có thời hạn thay thế. Quyền lợi legacy được xử lý riêng, không biến thành gói công khai thứ tư.

Giá dưới đây là đề xuất thử nghiệm, chưa phải giá đã áp dụng hoặc kết luận về lợi nhuận. Trước phát hành cần chốt cách hiển thị thuế/phí và tổng tiền thanh toán. Không tính thêm phần trăm giá trị đơn hoa trong bản đầu.

## 2. Nghiên cứu và bài học áp dụng

| Nguồn chính thức | Quan sát | Áp dụng đề xuất cho Fleurious |
| --- | --- | --- |
| [Sapo — bảng giá](https://www.sapo.vn/bang-gia.html?source=omni) | Chia gói theo quy mô, nhân sự, kênh bán và tự động hóa; có dùng thử 7 ngày. Các sản phẩm/điều kiện thanh toán khác nhau cần so sánh riêng. | Phân tầng cả giá trị quản lý và mức sử dụng; không chỉ bán thêm số đơn. |
| [Floranext — pricing](https://floranext.com/pricing/) | Phần mềm chuyên ngành hoa kết hợp website, POS, quản lý cưới/sự kiện; công bố không thu hoa hồng trên đơn. | Website + vận hành đơn hoa là lõi. Quản lý báo giá cưới/sự kiện có thể là giá trị mở rộng sau này, chưa ghi là tính năng đã có. |
| [Shopify — free trial](https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/free-trial) | Có trải nghiệm các gói; hết trial mà chưa chọn gói trả phí thì tạm dừng store và giữ dữ liệu. | Hết trial dừng nhận đơn mới, vẫn hỗ trợ xử lý nghĩa vụ với đơn cũ. |
| [Stripe — billing cycle](https://docs.stripe.com/billing/subscriptions/billing-cycle) | Chu kỳ gắn với mốc thuê bao, có quy tắc tháng ngắn/ngày 31. | Tính tháng lịch từ ngày kích hoạt, không cộng cố định 30 ngày hoặc gom mọi store về ngày 1. |
| [Stripe — quản lý giá](https://docs.stripe.com/products-prices/manage-prices) | Giá được tạo thành đối tượng riêng; đổi số tiền tạo giá mới, giá lưu trữ vẫn phục vụ thuê bao cũ. | Phiên bản gói bất biến và lưu giá/quyền lợi đã mua; admin không sửa ngược hóa đơn/kỳ đã thanh toán. |
| [Stripe — free trials](https://docs.stripe.com/billing/subscriptions/trials/free-trials) | Có cách xử lý riêng khi trial kết thúc mà chưa có phương thức thanh toán. | Tách trial khỏi hóa đơn trả phí, nhắc trước hạn và không tự tạo công nợ cho người chỉ đăng ký dùng thử. |
| [Google — giới hạn Gmail](https://support.google.com/mail/answer/22839?hl=en) | Gmail cá nhân giới hạn gửi thư và có thể tạm dừng gửi khi vượt ngưỡng. | Không lấy một tài khoản Gmail cá nhân làm năng lực gửi marketing được cam kết cho toàn bộ SaaS. |

Các mức giá và chính sách Fleurious trong tài liệu là suy luận thiết kế từ nhu cầu và code hiện có, không phải chính sách của các nhà cung cấp trên. Tham khảo Stripe về mô hình nghiệp vụ không đồng nghĩa chọn Stripe làm cổng thu tiền.

## 3. Ba gói đề xuất

| Hạng mục | Khởi đầu | Studio — gợi ý | Atelier |
| --- | --- | --- | --- |
| Phân khúc chính | Shop mới/nhỏ, khoảng 30–210 đơn/tháng | Shop trung bình/lớn, khoảng 210–900 đơn/tháng | Shop online lớn, khoảng 600–1.500+ đơn/tháng |
| Giá thử nghiệm / store / tháng | **199.000đ** | **399.000đ** | **799.000đ** |
| Đơn hợp lệ / kỳ thuê bao | 300 | 1.000 | 3.000 |
| Sản phẩm đang bán | 100 | 500 | 1.500 |
| Nhân sự, gồm chủ store | 3 | 10 | 30 |
| Dung lượng ảnh/file | 1 GB | 5 GB | 15 GB |
| CRM hồ sơ, ghi chú, lịch sử mua | Có | Có | Có |
| Quy tắc CRM tự động đang bật | 1 | 5 | 20 |
| Email marketing / kỳ, tách thư đơn hàng | 500 | 2.000 | 10.000 |
| Phân tích | Doanh thu, đơn, sản phẩm | Thêm kênh bán, phân khúc khách, so sánh kỳ | Thêm cohort/khách quay lại và báo cáo chuyên sâu khi triển khai xong |
| Dùng thử mặc định | 14 ngày | 14 ngày | 14 ngày |
| Giới hạn đơn trong toàn trial | 100 | 250 | 500 |
| Email marketing trong toàn trial | 50 | 100 | 200 |

Khoảng quy mô chồng nhau có chủ đích: store chọn theo số người làm việc và nhu cầu CRM, không bắt nâng cấp chỉ vì đạt một số doanh thu. Dư địa 300/1.000/3.000 đơn hỗ trợ tháng cao điểm của ngành hoa. Gói lớn không có nghĩa đã hỗ trợ nhiều chi nhánh chung tồn kho; bản đầu vẫn một workspace/store.

Tất cả gói có: storefront, 5 template hiện có và tùy biến màu/font, sản phẩm/album, giỏ/checkout, đơn thủ công, Kanban, lịch giao, phân công/role, thu/hoàn, email xác nhận/trạng thái đơn, PWA và thông báo vận hành. Không giới hạn số hồ sơ khách đã lưu hoặc khóa lịch sử đơn theo gói. Báo cáo/tính năng chưa có phải đánh dấu dự kiến, chỉ bật quyền trả phí khi đã kiểm thử và sẵn sàng.

Email marketing chỉ công bố là quyền lợi sử dụng khi hạ tầng gửi đã đáp ứng hạn mức; bản phát hành thu phí không được quảng cáo số lượt gửi chưa cung cấp được. Chi phí SMS/Zalo hoặc cổng thanh toán không nằm trong cam kết hiện tại.

## 4. Đăng ký, ngày bắt đầu và gia hạn

### 4.1. Định nghĩa đăng ký thành công

- Tạo tài khoản, mở trang checkout hoặc upload ảnh chuyển khoản chưa kích hoạt tháng trả phí.
- Gói trả phí bắt đầu khi thanh toán đủ được xác nhận và transaction kích hoạt hoàn tất; với phương án hiện có là admin xác nhận khoản thu. Store cần được duyệt trước khi bắt đầu thời gian bán thật.
- Tạo store ở trạng thái nháp cho phép cấu hình trước. Sau khi store được duyệt, owner chọn bắt đầu dùng thử hoặc thanh toán gói. Không tự trừ ngày trial trong thời gian chờ duyệt.
- Đăng ký dùng thử thành công bắt đầu đồng hồ trial, không bắt đầu chu kỳ tính phí.
- Thanh toán trong trial: mặc định đặt lịch tháng trả phí bắt đầu ngay sau trial; có lựa chọn kích hoạt ngay và hiển thị rõ trial kết thúc sớm. Lưu ngày có hiệu lực đã chọn trên checkout/hóa đơn; không âm thầm mất ngày dùng thử.

### 4.2. Quy tắc tháng

- Kích hoạt 18/10/2026 10:00 → kỳ đầu `[18/10/2026 10:00, 18/11/2026 10:00)` theo giờ Việt Nam.
- Kích hoạt 31/01/2027 → 28/02/2027 → 31/03/2027. Năm nhuận dùng 29/02. Tính từ anchor gốc; không tính nối từ ngày đã bị rút xuống 28 để tránh lệch tất cả các tháng sau.
- Lưu UTC bằng timestamp đầy đủ, hiển thị `Asia/Ho_Chi_Minh`. Không chỉ lưu `DATE` cho thời điểm hết quyền.
- Gia hạn sớm nối từ cuối kỳ đang có, không đặt lại từ ngày chuyển tiền. Chỉ khi tái kích hoạt sau giai đoạn tạm ngưng mới tạo mốc tháng mới theo thời điểm kích hoạt thực tế.
- Quota đơn/email reset theo kỳ thuê bao, không phải mùng 1. Dung lượng, sản phẩm và nhân sự là số đang sử dụng, không reset mỗi tháng.

### 4.3. Thu tiền và công nợ

Bản đầu kế thừa chuyển khoản và xác nhận thu tiền trong platform. “Gia hạn hàng tháng” là tạo kỳ/hóa đơn và nhắc thanh toán; không đồng nghĩa tự trừ tiền. Thanh toán tự động chỉ mở khi có cổng hỗ trợ, tài khoản merchant và người dùng đồng ý lưu phương thức/ủy quyền thanh toán.

Hóa đơn gia hạn được tạo trước hạn 7 ngày, có hiệu lực cho kỳ kế tiếp và đến hạn tại đầu kỳ đó. Nếu store đã chọn ngừng gia hạn, không tạo hóa đơn kỳ mới; hóa đơn tương lai chưa thu phải được hủy theo chính sách, không làm hủy kỳ hiện tại. Khoản trả trước được gắn đúng kỳ, không biến thành thu nhập đơn hoa.

| Tình huống | Cách xử lý đề xuất |
| --- | --- |
| Đã trả đủ | Kích hoạt/đặt lịch một lần; retry không cộng thêm tháng |
| Trả thiếu | Ghi khoản thu, báo còn thiếu; chưa kích hoạt gói mới |
| Giao dịch trùng | Đối chiếu mã giao dịch, số tiền, store và hóa đơn; không ghi thu lần hai |
| Thừa tiền/sai nội dung | Đưa vào đối soát, không tự gán cho store khác |
| Chậm gia hạn trong 7 ngày | `past_due`, có grace 7 ngày cho gói trả phí; trả đủ tiếp tục kỳ theo anchor cũ |
| Hết grace | `suspended`, dừng nhận đơn mới và marketing; vẫn xử lý đơn cũ và thu/hoàn |
| Trả tiền sau khi đã tạm ngưng | Tạo báo giá tái kích hoạt đủ tháng từ thời điểm kích hoạt; đối soát/hủy hóa đơn cũ chưa thu phù hợp, không cộng chồng phí thời gian chưa cung cấp dịch vụ |
| Hóa đơn cũ đã thu một phần | Giữ sổ thu; chuyển thành khoản được khấu trừ hoặc hoàn qua đối soát, không xóa tiền đã nhận |

Ngừng gia hạn giữ quyền đến cuối kỳ đã trả, có thể bật lại trước hạn. Tái kích hoạt sau ngừng không cấp trial mới. Hoàn phí SaaS và hủy hóa đơn là luồng riêng, có lý do, khoản tiền và lịch sử; không sửa trực tiếp `paid` để giả lập hoàn tiền.

## 5. Chính sách dùng thử từng gói

Admin cấu hình theo từng phiên bản gói: `trial_enabled`, `trial_days` (mặc định 14, đề xuất cho phép 1–30), giới hạn đơn/email, khả năng cho bán thật và nội dung CTA. Tắt trial dùng cờ riêng, không coi giá tháng bằng 0 là trial. Chỉnh chính sách chỉ áp dụng lượt bắt đầu mới; trial đang chạy giữ snapshot đã nhận.

- Dùng thử có đầy đủ tính năng của gói, với quota tiêu hao trial được công bố trước. Không yêu cầu thẻ ở bản đầu.
- Mặc định **một đợt trial cho một merchant/billing account trên toàn bộ 3 gói**, đồng thời kiểm tra store đã dùng trial. Có thể chọn gói bất kỳ hoặc đổi gói trong cửa sổ trial nhưng không kéo dài `trial_end`, không reset số đã dùng.
- Nếu quota/tài nguyên đã dùng vượt gói trial thấp hơn, yêu cầu xử lý phần vượt hoặc giữ gói hiện tại. Không tự xóa dữ liệu.
- Xác thực email/Google identity trước khi nhận trial; liên kết chủ sở hữu/store dùng để kiểm tra lịch sử. Không chỉ dựa vào IP để chặn các cửa hàng dùng chung mạng.
- Admin có thể gia hạn/tặng trial riêng cho store kèm lý do, hạn kết thúc và audit. Mặc định không tự nhận một lượt mới cho từng gói vì có thể bị nối thành 42 ngày.
- Nhắc trước hết hạn 3 ngày, 1 ngày và tại thời điểm hết hạn; nếu trial ngắn thì chỉ gửi các mốc còn phù hợp. Dedupe theo đợt trial và mốc nhắc.
- Hết trial chưa trả tiền → `trial_expired`: không tạo công nợ/tự trừ tiền, không tự chuyển thành gói trả phí. Dừng nhận đơn mới, giữ giao diện quản lý và dữ liệu để nâng cấp/xuất dữ liệu.
- Trong trial cho phát hành store bán thật khi đã duyệt. Vì vậy phải tiếp tục cho hoàn tất đơn đã nhận, gửi thông báo trạng thái và hoàn tiền sau khi trial hết.

Có thể bật chế độ nhiều đợt trial trong tương lai nhưng phải là chính sách riêng có tổng thời gian tối đa. Không mặc định cho thử lại mỗi khi đổi gói hoặc đổi chủ store.

## 6. Đo mức sử dụng và xử lý vượt hạn mức

### 6.1. Định nghĩa tránh sai số

- Đơn tính khi tạo thành công một đơn thật trên web hoặc thủ công, gồm cả Chờ xác nhận. Nháp, lỗi transaction, demo được tách riêng không tính. Đặt lại thành đơn mới có tính.
- Một `order_id` chỉ tiêu thụ quota một lần ở kỳ tạo đơn. Hủy/hoàn tiền không tự trả lại quota để tránh tạo/hủy lặp; khôi phục, chuyển Kanban hoặc đổi lịch không tính thêm. Trường hợp spam/nhập sai có điều chỉnh usage bởi admin, kèm lý do.
- Giữ nguyên nguyên tắc tồn kho của đơn hủy/khôi phục: **quota SaaS là chỉ số khác tồn kho và lượt khuyến mãi**.
- Lượt gửi marketing tính theo người nhận hợp lệ, có consent, được giữ chỗ khi enqueue. Suppression không tính; retry không trừ lại. Thất bại chắc chắn trước khi nhà cung cấp nhận có thể hoàn lượt một lần; trạng thái gửi chưa xác định phải đối soát để tránh gửi trùng.
- Email đơn hàng/trạng thái, thông báo tài khoản và hóa đơn SaaS là thư giao dịch, không trừ ngân sách marketing; có hàng đợi ưu tiên và hạn mức kỹ thuật chống lạm dụng riêng.
- Dung lượng tính byte file thực thuộc store, không tính số lần cùng một ảnh được tham chiếu. Xóa file phải kiểm tra ảnh còn dùng bởi sản phẩm/đơn; không xóa snapshot của đơn cũ để ép giảm dung lượng.
- Seats tính chủ store + thành viên active + lời mời còn giữ chỗ. Tăng quota sản phẩm/upload/nhân sự phải kiểm tra cả activate/restore/import, không chỉ tạo mới.

### 6.2. Chính sách cao điểm

Gói trả phí cảnh báo ở 80% và 100% quota đơn; cho thêm buffer mặc định 20% trong kỳ, công bố rõ ở trang gói. Quota hiệu dụng tương ứng 360/1.200/3.600; không tự tính tiền vượt mức. Sau buffer, dừng **tạo đơn mới**, gợi ý nâng gói hoặc yêu cầu platform cấp thêm hạn mức có thời hạn. Trial không có buffer mặc định.

Không chặn đang làm/giao/hoàn tiền của đơn đã nhận. Checkout kiểm tra/giữ quota nguyên tử trước khi xác nhận đơn hoặc khởi tạo thu tiền; nhiều request đồng thời không vượt quota. Khách chỉ thấy store tạm chưa nhận đơn, không thấy chi tiết nợ SaaS của merchant.

Marketing hết quota thì hoãn chiến dịch và báo owner; không làm nghẽn email đơn hàng. Sản phẩm/seats/dung lượng vượt sau hạ gói thì giữ tài nguyên cũ, chặn tăng mới tương ứng. Nâng gói giữa kỳ tăng trần tổng, không cộng thành một kỳ quota thứ hai.

Các trường buffer, ngưỡng cảnh báo và override theo store đều chỉnh được trong platform. Hạn mức gói không được dùng thay sức chứa lịch giao, tồn kho hoặc giới hạn API Goong; đó là các kiểm tra độc lập.

## 7. Đổi gói và thay đổi giá

### 7.1. Owner đổi gói

- Nâng gói giữa kỳ: xem trước phần chênh phải trả theo thời gian còn lại, trả đủ mới nhận quyền mới; giữ nguyên ngày gia hạn và số usage đã tiêu thụ.
- Với kỳ cũ đã thanh toán đủ, chênh lệch dự kiến = `(giá mới - giá kỳ hiện tại) × thời gian còn lại / tổng thời gian kỳ`, làm tròn đến đồng tại thời điểm báo giá. Không dùng 30 ngày cố định. Báo giá hết hạn phải tính lại.
- Kỳ cũ còn nợ hoặc đang có điều chỉnh: đối soát trước, không tự tạo credit trên tiền chưa thực thu. Nhiều yêu cầu nâng gói đồng thời chỉ một yêu cầu được chốt theo version.
- Hạ gói có hiệu lực từ kỳ kế tiếp, hiển thị chênh hạn mức và tài nguyên cần điều chỉnh. Mọi dữ liệu cũ vẫn giữ; tính năng tự động bị mất quyền phải dừng tạo việc mới đúng ngày hiệu lực. Được hủy yêu cầu hạ gói trước mốc đó.
- Đổi gói/hủy gia hạn không xóa lịch sử hoặc làm reset trial. Bản đầu không hỗ trợ chuyển tiền/quota tùy tiện giữa store.

### 7.2. Admin chỉnh gói

- `/platform/plans`: 3 thẻ gói + bảng so sánh, form cùng UI hệ thống. Chỉnh tên/mô tả, giá VND, thứ tự, badge, các quota, cờ tính năng đã được hỗ trợ và chính sách trial.
- Trạng thái cấu hình: nháp → xuất bản → lưu trữ. Mỗi thay đổi thương mại xuất bản tạo `plan_version` bất biến. Cho xem diff, ngày hiệu lực, số store chịu ảnh hưởng và preview trang gói trước khi phát hành.
- Mặc định giá/quyền mới áp dụng đăng ký mới. Store đang trả phí giữ phiên bản đã mua. Muốn chuyển các thuê bao cũ phải tạo lịch áp dụng riêng, đề xuất báo trước ít nhất 30 ngày và hiệu lực tại kỳ đủ điều kiện tiếp theo; hiển thị giá mới và quyền ngừng gia hạn.
- Không đổi tiền của kỳ đã trả hoặc hóa đơn đã phát hành. Quote đang mở được giữ giá đến hết thời hạn ngắn đã công bố; hết hạn tính lại. Lưu trữ gói chặn đăng ký mới nhưng không tự hủy các thuê bao hiện tại.
- Admin không xóa gói đã có phát sinh. Rollback bằng phiên bản/lịch mới, giữ audit. Tặng thời gian/thêm quota cho một store dùng override có hạn, không sửa giá gói chung thành 0.
- Quyền tài chính là của owner thực và admin platform theo thao tác. Phiên Ghost chỉ xem billing, không mua/hủy/đổi gói thay merchant; platform dùng action riêng có ghi actor và lý do.

## 8. Các màn hình và luồng bổ sung

| Màn hình | Nội dung chính |
| --- | --- |
| `/pricing` | Ba gói, tháng theo ngày kích hoạt, quyền lợi, trial X ngày đọc từ server, buffer/quota, bảng so sánh, FAQ. Không hardcode giá trong UI. |
| Onboarding store | Tạo nháp → cấu hình → duyệt → chọn gói → trial hoặc thanh toán; có thể quay lại cấu hình trước khi bắt đầu đồng hồ. |
| Checkout dịch vụ | Store mua, phiên bản gói, số tiền cuối, kỳ bắt đầu/kết thúc, dùng thử còn lại, điều khoản gia hạn, phương thức và tình trạng xác nhận thanh toán. |
| Workspace → Gói & thanh toán | Gói hiện tại, trial đếm ngày, ngày gia hạn, usage/buffer, hóa đơn/sổ thu, nâng/hạ gói, hủy yêu cầu thay đổi, ngừng/tiếp tục gia hạn. |
| `/platform/plans` | Chỉnh 3 gói, trial, quota, tính năng, preview/diff, lịch xuất bản, lịch sử phiên bản. |
| `/platform/subscriptions` | Tìm theo store/owner/gói/trạng thái, trial sắp hết, kỳ sắp tới, quá hạn, mức sử dụng; action gia hạn/tặng quota/đặt lịch đổi/đối soát với lý do. |
| Platform → Hóa đơn | Kỳ chính xác start/end, loại mua mới/gia hạn/nâng gói, số tiền/đã thu/còn thiếu, ghi thu, hoàn/credit và thông tin đối soát. |
| Platform → Phân tích thuê bao | Funnel trial → trả phí, MRR, thu thực tế, nợ, churn, nâng/hạ gói, mức sử dụng và chi phí theo store. |

Giữ layout quản trị hiện có để chuyển menu không tải lại toàn trang hoặc mất vị trí sidebar. Mobile dùng thẻ dọc, thanh tiến độ usage và sticky CTA khi cần; không ép bảng nhiều cột tràn màn hình.

## 9. Kiến trúc dự kiến và khoảng thiếu của code hiện tại

Code có `plans`, `subscriptions`, `invoices`, `billing_payments`, API sửa gói và worker chuyển quá hạn. Seed hiện tại: Khởi đầu 0đ, Studio 299.000đ, Atelier 599.000đ. Đây là cấu hình mẫu trong mã nguồn, chưa phải báo cáo phân bố thuê bao production.

Khoảng thiếu đã kiểm tra:

1. `subscriptions.period_end` chỉ là DATE; chưa có anchor/start/trial/snapshot/lịch thay đổi.
2. `platform/invoices/generate` tạo theo `YYYY-MM` chung; không phục vụ chu kỳ từng store, nâng gói và kích hoạt giữa tháng.
3. Đọc giá/quota bằng join trực tiếp `plans`; admin sửa có thể làm quyền lợi thuê bao cũ đổi ngay.
4. Platform có API sửa giá/hạn mức nhưng chưa có màn hình quản lý gói đầy đủ. Workspace hiện chủ yếu xem và liên hệ admin để đổi gói.
5. Helper quota hiện tập trung seats/storage; cần rà soát đường tạo/sửa/activate sản phẩm và bổ sung đo đơn/marketing, xử lý đồng thời.
6. Trạng thái thu tiền và access còn đơn giản; không nên chỉ sửa `status='active'` là coi đã mua đủ tháng.

| Dữ liệu | Hướng mở rộng |
| --- | --- |
| `plans` | Mã gói ổn định, metadata hiển thị, phiên bản công khai hiện tại, trạng thái xuất bản. |
| `plan_versions` | Giá/currency/interval, quota, features, trial policy, ngày hiệu lực, actor; bất biến sau xuất bản. |
| `subscriptions` | ID riêng, store/billing account, version gói, UTC anchor, current period, trial, scheduled change/cancel, trạng thái; một subscription hiện hành/store. |
| `subscription_periods` | Start/end thực tế, loại trial/paid, snapshot quyền và giá, quan hệ hóa đơn; không suy ngược lịch sử từ gói hiện tại. |
| `subscription_changes`, `trial_claims` | Lịch đổi/hủy, eligibility trial dùng chung merchant, lý do admin, thời điểm đã áp dụng. |
| `usage_events`, `usage_counters` | Sổ usage idempotent theo store/period/metric/entity, counter transaction và khả năng đối chiếu lại từ sổ. |
| `subscription_overrides` | Quyền tặng thêm theo store, từ/đến, lý do/actor, không sửa dữ liệu gói gốc. |
| `invoices`, invoice lines | Snapshot bên mua/gói/giá/quota, loại hóa đơn, service start/end, adjustments; unique theo subscription/period/purpose/change, thay cho chỉ `YYYY-MM`. |
| Payments/refunds/credits | Tách thu phí SaaS khỏi `order_payments`; mã giao dịch và event provider duy nhất, lưu trạng thái đối soát. |

Tách service quyền sử dụng (`entitlements`) khỏi giao diện. Mọi API nhạy cảm kiểm tra role + store + trạng thái thuê bao + quyền gói tại server. Danh sách bảng tenant trong `lib/tenant.ts` phải cập nhật cho các bảng mới; bảng global plans chỉ platform được ghi.

Worker tạo kỳ/hóa đơn, nhắc hạn và áp dụng thay đổi theo deadline UTC; chạy lặp hoặc dừng giữa chừng không phát sinh hai lần. Quyền hết hạn phải được kiểm tra ngay trên request, không lệ thuộc cron có chạy đúng giây. Thông báo qua outbox, không giữ transaction đợi SMTP.

Billing service cần xác minh số tiền/currency/reference/store trước kích hoạt. Nếu tích hợp cổng: verify webhook, dedupe và kiểm tra thứ tự sự kiện; không tin redirect “thành công” trên trình duyệt. Dùng adapter để thay cổng thu tiền mà giữ logic kỳ/quyền/đối soát.

## 10. Analytics để điều chỉnh 3 gói

- Theo dõi số đơn hợp lệ mỗi kỳ và rolling 30 ngày, P50/P90/P95 theo nhóm quy mô. Quota áp dụng theo kỳ; báo cáo rolling dùng để gợi ý gói chứ không sửa hóa đơn.
- Usage đơn/seats/storage/email; tỷ lệ store chạm 80%, 100%, buffer và số lần checkout bị chặn. Khảo sát lý do nâng/hạ/hủy để tránh trần đơn làm mất khách vào dịp lễ.
- Trial funnel: store được duyệt → bắt đầu trial → đăng sản phẩm → có đơn thật đầu tiên → đăng ký trả phí. Conversion cohort dùng nhóm trial đã đủ thời gian quan sát, không trộn các trial còn đang chạy.
- Tách MRR theo giá thuê bao trả phí thực của store, excluding trial/legacy free; báo cáo `past_due` thành nhóm rủi ro riêng. MRR dự kiến không phải tiền thực thu; GMV đơn hoa là chỉ số khác.
- Đo thu SaaS thực nhận, refunds/credits, churn, doanh thu mở rộng do nâng gói; phân biệt hủy có lịch với đã hết quyền.
- Đo chi phí DB, compute, ảnh/lưu lượng Blob, Goong, email và hỗ trợ. Đánh giá sau 30–60 ngày pilot; điều chỉnh chỉ qua phiên bản gói, không sửa lịch sử.

## 11. Migration và lộ trình thực hiện

### P0 — quy tắc và dữ liệu hiện hữu

Chốt cấu hình đề xuất, chính sách trial/overage/đối soát; kiểm kê thuê bao/hóa đơn/quota thực. Backup và thử restore. Tạo báo cáo riêng cho thuê bao hiện có bị thiếu start/end hoặc trạng thái không khớp tiền; không đoán ngày bắt đầu hay áp phí mới hàng loạt.

### P1 — engine và migration

Mở rộng schema chạy lại an toàn; snapshot legacy, dựng calendar-month engine, trial, invoice purpose, payment/credit, scheduled changes, metering và entitlement. Giữ endpoint tương thích trong lúc chuyển. Tắt generator `YYYY-MM` cho subscription đã chuyển sang engine mới để không thu trùng.

### P2 — giao diện và đăng ký hoàn chỉnh

Làm `/pricing`, onboarding và checkout dịch vụ, `/platform/plans`, quản lý thuê bao, Workspace billing, reminder/template và analytics cơ bản. Kế thừa chuyển khoản xác nhận. Các khả năng quảng cáo trong bảng gói phải có enforcement + UI + kiểm thử tương ứng trước khi thu phí.

### P3 — đối soát tự động và báo cáo nâng cao

Tích hợp cổng sau khi chọn nhà cung cấp/tài khoản thực; automation/report nâng cao, cost attribution và theo dõi chất lượng email. Không bật tự trừ tiền khi chưa có phương thức hỗ trợ và đồng ý rõ ràng của merchant.

### P4 — pilot rồi phát hành

Pilot một nhóm store với dữ liệu/quota thật, xem checkout bị chặn và ngày gia hạn. Legacy free giữ quyền hiện có qua snapshot/override nội bộ; các gói paid cũ giữ giá/quyền đã có đến lịch chuyển được thông báo. Không tự chuyển tất cả store đang free sang trial sắp hết. Rollback bằng feature flag và giữ sổ thu/kỳ đã tạo; không xóa dữ liệu tài chính mới.

## 12. Tiêu chí nghiệm thu

1. Có đúng 3 gói công khai; mọi giá/quota/thời gian trial lấy từ cấu hình platform, owner không thể sửa qua request.
2. Admin lưu nháp/xuất bản/rollback phiên bản có audit/version; thay đổi gói không sửa invoice và kỳ paid cũ.
3. Signup paid ngày bất kỳ đủ tháng; đúng ngày 29/30/31, tháng 2/năm nhuận và giờ hết quyền; không drift anchor hoặc cộng 30 ngày.
4. Trial bắt đầu đúng thao tác kích hoạt sau duyệt; chuyển gói không reset thời gian/usage; hai request không nhận được hai trial.
5. Hết trial không tạo nợ; chưa có tiền không active; paid trước trong trial hoặc gia hạn sớm giữ đủ thời gian đã được xác nhận.
6. Invoice, thanh toán, webhook/worker chạy trùng vẫn chỉ kích hoạt một kỳ. Thu thiếu/thừa/sai store/currency được đối soát đúng.
7. Grace, hết grace, hủy cuối kỳ, bật lại gia hạn và tái kích hoạt muộn không thu trùng hay cấp miễn phí vô hạn.
8. Nâng gói tính chênh đúng, chỉ nhận quyền khi paid; hạ gói đúng kỳ, không xóa file/nhân sự/CRM và không reset usage.
9. Web/manual/reorder/import/activate/upload/invite đều kiểm tra quyền và quota; concurrency ở đơn cuối, seat cuối, upload cuối không vượt giới hạn.
10. Hủy/khôi phục đơn không trừ lại quota SaaS hoặc làm sai tồn kho/ưu đãi. Đơn cũ vẫn giao/thu/hoàn/tra cứu khi thuê bao hết hạn.
11. Campaign mất quyền/hết quota dừng tạo lượt mới, retries không trừ thêm; email giao dịch và unsubscribe vẫn hoạt động.
12. Trial reminder, invoice reminder và cảnh báo usage dedupe đúng; worker chậm không kéo dài quyền khi API kiểm tra.
13. Owner nhiều store không dùng quota/thuê bao chéo; role staff/Ghost không đăng ký hoặc hủy trả phí trái quyền; platform actions có audit.
14. Pricing, checkout và Workspace/Platform billing qua kiểm tra desktop/mobile 360/390px; giữ sidebar, focus và không có overflow ngang.
15. Migration chạy lại không đổi tổng thu/đơn cũ; các store legacy không bị tính tiền hoặc hết quyền ngoài ý muốn. Build và regression SaaS/đơn/tenant cùng đạt.

## 13. Cấu hình khởi điểm để triển khai

Đề xuất dùng bộ 199k/399k/799k, 300/1.000/3.000 đơn, trial 14 ngày mỗi gói, một đợt/merchant, buffer paid 20%, grace 7 ngày, thu tiền qua chuyển khoản xác nhận ở bản đầu. Đây là các giá trị mặc định có thể đổi trong admin bằng chính sách phiên bản đã nêu.

Các mục còn cần quyết định trước khi phát hành thương mại: tổng giá và cách hiển thị thuế/phí, phương thức/cổng thu tiền thực tế, năng lực gửi marketing, thời gian giữ dữ liệu sau tạm ngưng và đối tượng chuyển giá legacy. Trong thời gian chờ chính sách lưu trữ, không tự xóa dữ liệu; mọi đơn/công nợ/hoàn tiền chưa giải quyết phải được bảo toàn.
