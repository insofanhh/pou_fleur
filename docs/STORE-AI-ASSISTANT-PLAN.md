# Kế hoạch trợ lý AI cho workspace cửa hàng Fleurious

Ngày lập: 19/10/2026. Phần nền DeepSeek và hành động có xác nhận đã triển khai ngày 20/10/2026; phạm vi, cấu hình scheduler Hobby và kiểm thử tại [STORE-AI-IMPLEMENTATION.md](STORE-AI-IMPLEMENTATION.md). Các mục nâng cao trong kế hoạch dưới đây là hướng phát triển, không phải toàn bộ tính năng đã phát hành. Nhà cung cấp được chốt là DeepSeek theo yêu cầu của chủ dự án; các tham chiếu OpenAI bên dưới là nghiên cứu kiến trúc trước quyết định này.

## 1. Mục tiêu và phạm vi

Xây dựng trợ lý cho chủ cửa hàng và nhân viên: hỗ trợ lên đơn, tra cứu vận hành, ghi chú, nhắc việc, phân tích cảnh báo, đề xuất chăm sóc khách hàng và gửi báo lỗi tới nền tảng.

Giai đoạn đầu phục vụ người dùng đã đăng nhập workspace. Chatbot tư vấn cho khách mua hàng ngoài storefront là sản phẩm mở rộng riêng, có phiên đăng nhập, quyền truy cập, dữ liệu và công cụ riêng.

Các nguyên tắc:

- AI diễn giải yêu cầu và lựa chọn chức năng; backend quyết định quyền, tính tiền, kiểm tra trạng thái và ghi dữ liệu.
- Dữ liệu đơn, thanh toán và báo cáo lấy trực tiếp từ các dịch vụ hiện có; không huấn luyện mô hình để ghi nhớ dữ liệu giao dịch.
- Thao tác ghi phải có bản xem trước và xác nhận có phạm vi rõ ràng. Không dùng lời xác nhận chung từ cuộc hội thoại cũ để duyệt một thao tác mới.
- Nhắc việc chạy bằng quy tắc và tác vụ nền bền vững. Tắt cửa sổ chat không làm mất lịch nhắc.
- Không cấp SQL tùy ý, shell, khả năng sửa code hay truy cập bí mật cho mô hình.
- Trả lời có liên kết tới dữ liệu và thời điểm truy xuất. Không có dữ liệu thì nói rõ giới hạn.

## 2. Cơ sở hiện có trong dự án

| Thành phần | Tái sử dụng | Phần cần bổ sung |
| --- | --- | --- |
| Tenant và phân quyền | `lib/tenant.ts`, `lib/auth.ts`, store memberships | Kiểm tra ở từng tool, lịch sử chat và xác nhận hành động |
| Tạo đơn thủ công | `lib/manual-orders.ts`: quote, draft/version, idempotency, transaction | Adapter công cụ AI gọi dịch vụ chung |
| Tiến trình và thanh toán | Order workflow, payment ledger, SePay, QR | Card xem trước, xác nhận theo quyền, làm mới trạng thái sau thao tác |
| Báo cáo | `lib/store-analytics.ts`, quy ước trong STORE-ANALYTICS.md | Tool truy vấn phạm vi cố định và giải thích có nguồn |
| Lịch và ghi chú | Workspace calendar, calendar_notes | Nhắc việc có người phụ trách, hạn và trạng thái |
| CRM | Khách hàng, lịch sử mua, inquiries, consent | Scoring giải thích được, danh sách việc chăm sóc |
| Thông báo | Domain outbox, inbox, email, push | Lịch nhắc, xử lý quá hạn, chống lặp và phân tuyến |
| Gói dịch vụ | Plans, limits, trial và billing lifecycle | Quyền AI, quota, sổ sử dụng và chi phí |
| Audit | Lịch sử thao tác | Action ID, nguồn AI, người xác nhận, actor thật khi ghost |

Qua kiểm tra cấu hình repository, `vercel.json` hiện chỉ khai báo worker hằng ngày. Không kết luận đây là toàn bộ scheduler thực tế trên production; cần kiểm tra hạ tầng khi triển khai. Cấu hình này riêng lẻ chưa đủ cho nhắc trước giờ giao.

## 3. Giao diện và trải nghiệm

- Desktop: nút Trợ lý AI trên workspace; mở panel cạnh phải có thể thu gọn/mở rộng. Không đè các thao tác quan trọng trong modal đơn hàng.
- Mobile: màn hình chat riêng, chiều cao theo viewport thực tế, xử lý bàn phím và safe area; không chồng thanh điều hướng dưới.
- Trang tổng quan có card Việc cần chú ý: đơn sắp giao, trễ hẹn, chưa phân công, công nợ, ghi chú đến hạn. Đây là dữ liệu vận hành có thể xem cả khi AI lỗi.
- Nhóm gợi ý: Lên đơn / Báo cáo / Nhắc việc / Khách hàng / Hỗ trợ hệ thống.
- Khi đang xem đơn, chỉ đính kèm đơn đang chọn nếu người dùng thấy rõ ngữ cảnh; chuyển trang không âm thầm thay đối tượng của một hành động đang chờ xác nhận.
- Kết quả dạng card đơn, bản nháp, bảng số liệu, biểu đồ, note, nhắc việc; mỗi card có link mở màn hình gốc.
- Hiển thị tiến trình: đang tìm dữ liệu, cần bổ sung, chờ xác nhận, đang xử lý, thành công, thất bại hoặc cần kiểm tra kết quả.
- Dừng sinh câu trả lời không đồng nghĩa hủy một giao dịch đã ghi nhận. Khi mất kết nối phải tra cứu trạng thái action, không tự chốt lại.
- Hội thoại mặc định riêng theo nhân viên trong cửa hàng. Việc chia sẻ hội thoại phải chủ động và được kiểm tra lại quyền khi mở.

## 4. Luồng tạo đơn bằng chat

Ví dụ: “Lên đơn bó hồng 500 nghìn cho chị Lan, giao chiều mai tại Cầu Giấy, lời nhắn Chúc mừng sinh nhật.”

1. Phân tích dữ liệu và hiển thị các trường đã hiểu. Phân biệt sản phẩm catalog với thiết kế riêng và ngân sách; không tự gán sản phẩm chỉ vì giá gần bằng.
2. Tìm khách hiện có theo tên/số điện thoại/email trong đúng store. Nếu trùng tên hoặc số dùng chung thì yêu cầu chọn hồ sơ đúng.
3. Hỏi gộp thông tin bắt buộc còn thiếu: người nhận, điện thoại, địa chỉ, ngày/khung giờ, sản phẩm/số lượng và phương thức thanh toán.
4. Phân giải ngày tương đối theo giờ Hà Nội và hiển thị lại ngày cụ thể. Nếu chỉ nói buổi chiều, chọn khung giờ store có hỗ trợ thay vì bịa một giờ giao.
5. Gợi ý địa chỉ bằng Goong hiện có. Không đoán tọa độ hoặc tự chọn địa chỉ mơ hồ.
6. Tạo draft, gọi quote của luồng đơn thủ công. Backend kiểm tra giá, tồn nếu có quản lý, lịch giao, ưu đãi, phí giao riêng, hạn mức gói và quyền điều chỉnh giá.
7. Hiển thị bản xem trước: khách đặt/nhận, sản phẩm, lịch và địa chỉ giao, lời nhắn, phí, giảm giá, tổng phải thu và người phụ trách. Các dữ liệu AI suy đoán phải được đánh dấu hoặc yêu cầu xác nhận.
8. Nhân viên sửa trực tiếp trên card hoặc mở form tạo đơn đầy đủ; xác nhận bằng nút Chốt đơn.
9. Chốt qua cùng dịch vụ đơn thủ công hiện có với quote token, draft version và idempotency key. Kiểm tra lại quyền, store và dữ liệu ở thời điểm commit.
10. Trả mã đơn thật và link chi tiết. Với chuyển khoản, sử dụng phiên QR hiện có; không tạo phiên mới mỗi lần mở lại chat/modal.
11. Email và thông báo đi qua outbox hiện có và hạn mức mail hiện hành. Không gửi thêm email do AI tự gọi một luồng khác.

Thanh toán: ảnh chụp, lời nhắn “khách đã chuyển” hoặc nội dung AI không phải chứng cứ xác nhận giao dịch. Webhook đã xác thực hoặc owner xác nhận thu tiền theo luồng hiện có mới thay đổi sổ tiền. Không cho AI xác nhận thanh toán tự động trong bản đầu.

Các tình huống phải xử lý: hai người chốt đồng thời; giá thay đổi sau xem trước; hết tồn/slot; đổi quyền khi đang chat; store đóng băng; request timeout sau commit; người dùng bấm xác nhận nhiều lần; nháp đã sửa ở tab khác.

## 5. Tra cứu số liệu và báo cáo

Hỗ trợ câu hỏi: “Tuần này đã giao bao nhiêu đơn?”, “Ngày mai có những đơn nào chưa phân công?”, “Công nợ của chị Lan?”, “Kênh nào có nhiều đơn hủy nhất trong tháng?”.

- Công cụ gọi cùng dịch vụ báo cáo với UI. Không cho AI tự dựng truy vấn SQL để tính lại các định nghĩa.
- Mỗi báo cáo nêu khoảng ngày, múi giờ, bộ lọc ngày tạo/ngày giao, thời điểm cập nhật và link danh sách liên quan.
- Giữ đúng định nghĩa hiện hành: doanh thu đơn đã giao, giá trị đơn, tiền đã thu ròng, công nợ và tiền cần hoàn là các chỉ số khác nhau.
- Báo cáo hiện có lấy nhóm đơn tạo trong kỳ và trạng thái/số dư hiện tại. Không gọi đó là báo cáo tiền thu theo ngày; muốn báo cáo dòng tiền phải bổ sung truy vấn theo ngày giao dịch ledger.
- So sánh với kỳ trước cùng độ dài; nếu mẫu ít hoặc kỳ trước bằng 0 thì không tạo nhận định phần trăm gây hiểu nhầm.
- Không suy luận lợi nhuận khi chưa có dữ liệu giá vốn, chi phí và hao hụt.
- Truy vấn có giới hạn khoảng ngày/số dòng, phân trang và ngân sách thực thi. Số liệu lớn tổng hợp ở backend trước khi đưa cho mô hình.
- Trả dữ liệu có cấu trúc cho UI vẽ biểu đồ/bảng. Không để mô hình tự sinh HTML/JavaScript thực thi trong dashboard.

## 6. Ghi chú, nhắc việc và cảnh báo

Phân biệt: note lịch ghi thông tin; task có người phụ trách/hạn/trạng thái; reminder có lịch gửi. Có thể tạo chúng từ một yêu cầu nhưng không coi mọi note là một lịch nhắc.

Luồng: AI đề xuất nội dung + đối tượng + người nhận + thời gian → người dùng xác nhận → lưu task/reminder → worker xử lý đúng hạn → gửi thông báo → người dùng hoàn tất/hoãn/bỏ qua.

| Quy tắc mẫu đề xuất, store được tùy chỉnh | Kiểm tra trước khi gửi | Thao tác |
| --- | --- | --- |
| Trước khung giờ giao 60 phút, đơn chưa sẵn sàng | Lịch giao mới nhất; đơn không hủy/đã giao | Mở đơn, phân công, hoãn nhắc |
| Hết khung giao mà chưa hoàn tất | Khung giao có giờ kết thúc xác định | Cảnh báo quản lý, đánh dấu xử lý |
| Đơn sắp giao chưa có người phụ trách | Membership còn hoạt động | Chọn người phụ trách |
| Đơn chuyển khoản chưa thu đủ | Số dư ledger, không dựa status cũ | Mở thanh toán; không tự hủy đơn |
| Note/task đến hạn | Chưa hoàn thành, chưa bị xóa | Hoàn tất hoặc đổi hạn |
| Giá trị đơn/đơn hủy biến động | Kỳ so sánh hợp lệ và đủ mẫu | Mở báo cáo, xem đơn liên quan |
| Mail/webhook lỗi lặp lại | Có log thật, loại lỗi rõ ràng | Mở lỗi, báo nền tảng |

Thiết kế chống lặp bằng rule + entity + mốc nhắc + version lịch. Đổi lịch làm vô hiệu tác vụ cũ. Retry kiểm tra trạng thái và quyền người nhận; không tiếp tục gửi cho nhân viên đã rời store. Thông báo push trên màn hình khóa mặc định không chứa địa chỉ/điện thoại khách.

Có giờ yên lặng và mức ưu tiên; các ngoại lệ khẩn cấp được chủ store cấu hình. Cảnh báo cần xác nhận đã đọc/đã xử lý và chuyển cấp khi quá hạn, không spam đến tất cả nhân viên.

Hạ tầng đề xuất: scheduler quét tác vụ đến hạn mỗi phút khi môi trường cho phép, worker có khóa claim, retry/backoff, hàng đợi lỗi, khả năng xử lý bù sau downtime. Không cam kết push đến thiết bị chính xác tuyệt đối vì còn phụ thuộc mạng và quyền thông báo. Kênh inbox là bản ghi bền vững.

## 7. Khách hàng tiềm năng

- Nguồn: inquiries, đơn cũ, lịch sử mua lặp lại, ngày kỷ niệm khách tự cung cấp, chiến dịch và tương tác mà hệ thống thực sự thu thập được.
- Bản đầu dùng quy tắc dễ giải thích: yêu cầu tư vấn chưa phản hồi, từng mua nhiều lần, giá trị mua cao, khách lâu chưa quay lại, dịp đã lưu sắp đến.
- Mỗi gợi ý có dữ kiện, thời điểm cập nhật, lý do ưu tiên và hành động chăm sóc. Chưa có đủ dữ liệu thì ghi rõ, không bịa xác suất chốt đơn.
- Phân biệt khách tiềm năng, khách trung thành và khách cần chăm sóc; không gom mọi người vào một nhãn.
- Chỉ truy cập dữ liệu của store; không lấy khách của store khác làm nguồn gợi ý.
- Phát hiện cơ hội không đồng nghĩa đồng ý tiếp thị. Gửi chiến dịch phải kiểm tra marketing consent và quyền gửi ở backend.
- Bản đầu AI soạn nội dung nháp; nhân viên duyệt trước khi gửi. Gửi hàng loạt cần màn hình xác nhận đối tượng, số người nhận, hạn mức và nội dung.
- Chỉ thêm chấm điểm dự đoán sau khi có dữ liệu kết quả để kiểm định, tránh tự khẳng định dự đoán là chính xác.

## 8. Báo lỗi hệ thống

Hai nguồn: nhân viên chủ động báo lỗi trong chat và hệ thống monitoring phát hiện lỗi thật.

- “Tôi không tạo được đơn” → lấy request/trace ID, trang, thời điểm, mã lỗi đã lọc và bước thao tác; cho người dùng xem thông tin trước khi gửi ticket.
- Lỗi tự động: webhook thất bại, outbox tồn quá lâu, tỷ lệ API lỗi, worker ngừng hoạt động. Quy tắc monitoring quyết định phát hiện; AI tóm tắt và nhóm sự cố.
- Store chỉ xem lỗi liên quan store mình và hướng xử lý phù hợp. Platform xem sự cố tổng, phiên bản deploy và các store ảnh hưởng khi được phân quyền.
- Không gửi khóa API, cookie, token, chuỗi kết nối, full request chứa dữ liệu khách hoặc raw stack có bí mật vào mô hình.
- AI nêu giả thuyết có mức độ bằng chứng; không báo đã sửa nếu chưa có kết quả thực thi. Không tự sửa production, đổi env hay deploy.
- Theo dõi ticket mới/đang xử lý/đã giải quyết và thông báo kết quả về store.

## 9. Phân quyền và an toàn thao tác

Quyền hiệu lực = quyền người dùng hiện tại ∩ chức năng gói ∩ cấu hình AI store ∩ danh sách công cụ được phép. AI không bổ sung quyền cho tài khoản.

| Nhóm hành động | Cách xử lý |
| --- | --- |
| Tra cứu | Tự thực hiện trong quyền hiện có; giới hạn dữ liệu tối thiểu |
| Tạo nháp/báo giá | Không phát sinh đơn, gửi mail hoặc ghi tiền; cho chỉnh sửa |
| Chốt đơn, lưu note, tạo reminder, cập nhật phân công | Xem trước và xác nhận nội dung cụ thể |
| Hủy/khôi phục đơn, chuyển lùi trạng thái | Dùng lý do, kiểm tra version và điều kiện nghiệp vụ hiện có |
| Thu/hoàn tiền | Bản đầu dẫn sang UI hiện có và giữ quyền owner |
| Gửi email/campaign, xuất nhiều dữ liệu, xóa dữ liệu | Chưa mở ở MVP; về sau phải có xác nhận riêng và quyền tương ứng |
| Đổi gói, tài khoản ngân hàng, webhook, quyền nhân viên | Ngoài phạm vi thao tác của AI bản đầu |

- Store ID và actor lấy từ session backend, không lấy giá trị do mô hình yêu cầu.
- Kiểm tra tenant và quyền cho từng tool, lần đọc lại lịch sử, tải file và lúc xác nhận; membership bị thu hồi phải có hiệu lực ngay.
- Nội dung khách, note, sản phẩm, tài liệu tải lên là dữ liệu không đáng tin, không có quyền thay đổi chỉ dẫn hệ thống.
- Xác nhận gắn action ID, payload hash, version, actor, store và hạn hiệu lực. Thay đổi nội dung phải xem trước lại.
- Audit giữ người yêu cầu/người xác nhận, tool, kết quả, các entity liên quan; ghost ghi cả actor thật và tài khoản được hỗ trợ.
- Không dùng kết quả tìm kiếm ngữ nghĩa hoặc cache nếu không bảo đảm store/role. Nội dung chat cũ cũng có thể chứa dữ liệu mà người dùng không còn quyền xem.

## 10. Kiến trúc và dữ liệu

Luồng chat: UI → xác thực workspace → kiểm tra hạn mức → bộ điều phối AI → công cụ backend có schema → dịch vụ nghiệp vụ hiện có → kết quả có cấu trúc → UI.

Luồng chủ động: thay đổi đơn/note → outbox/tác vụ bền vững → scheduler/worker → kiểm tra lại trạng thái và quyền → inbox/push/email. AI chỉ bổ sung giải thích khi cần.

Đề xuất Responses API với function calling và schema chặt; backend tự thực thi công cụ. Chọn model sau khi đánh giá trên dữ liệu tiếng Việt và tác vụ thật; lưu phiên bản cấu hình, không phụ thuộc một tên model cố định. Không cần dịch vụ agent có quyền máy tính hoặc code execution cho nghiệp vụ này.

Nhóm tool MVP:

- Đọc: search_products, search_customers, get_order, list_orders, get_calendar, get_store_metrics, search_help.
- Chuẩn bị: prepare_order_draft, quote_order, prepare_note, prepare_reminder.
- Ghi: confirm_order_action, confirm_note_action, confirm_reminder_action qua cổng xác nhận của backend; không để mô hình tự tạo bằng chứng người dùng đã duyệt.
- Hỗ trợ: prepare_issue_report, get_action_status.

Các endpoint và tên tool là đề xuất, cần chốt khi triển khai. Chỉ cung cấp tool cần thiết cho ngữ cảnh hiện tại.

| Nhóm bảng đề xuất | Nội dung |
| --- | --- |
| ai_conversations, ai_messages | Store, chủ hội thoại, nội dung tối thiểu, thời gian lưu |
| ai_runs, ai_tool_calls | Phiên bản prompt/model, latency, usage, trạng thái, lỗi đã lọc |
| ai_action_drafts | Payload có cấu trúc, version/hash, hạn duyệt, idempotency, kết quả |
| workspace_tasks, workspace_reminders | Entity, người phụ trách, due_at, trạng thái, lịch nhắc |
| store_alert_rules, store_alert_findings | Quy tắc, sự kiện phát hiện, mức độ, người xử lý, dedupe |
| ai_knowledge_documents | Nội dung được duyệt, phiên bản, nguồn và quyền đọc |
| ai_usage_ledger | Reservation/settlement, chu kỳ quota, token, chi phí, request ID |

Tái sử dụng calendar_notes, notifications, email/domain outbox và audit thay vì tạo hệ thông báo riêng. Có thể cần bảng/field ticket nếu luồng hỗ trợ hiện tại không đáp ứng.

Kho kiến thức ban đầu: hướng dẫn Fleurious, chính sách giao/đổi hủy, catalog và quy trình store. Dùng tìm kiếm cơ bản cho tập nhỏ; chỉ thêm embeddings/vector store khi đo được nhu cầu. Tìm kiếm nào cũng phải tách tenant ở backend.

## 11. “Train AI” và bảo vệ dữ liệu

Ba lớp kiến thức: hướng dẫn nền tảng; nội dung store đã duyệt; dữ liệu vận hành trực tiếp. Cập nhật sản phẩm/giá/đơn không cần train lại.

Store có thể sửa quy trình, giọng điệu, quy tắc tư vấn và các nội dung kiến thức trong phạm vi cho phép; không thể ghi đè phân quyền hoặc quy định thanh toán. Các sửa đổi được lưu phiên bản và có trạng thái nháp/đang áp dụng.

Fine-tuning chỉ xem xét sau khi có bộ đánh giá và nhiều ví dụ chất lượng, nếu chứng minh được cải thiện một tác vụ ổn định. Không dùng nó để lưu số dư, tồn kho hoặc dữ liệu khách cập nhật liên tục.

Chỉ gửi dữ liệu tối thiểu ra nhà cung cấp; tổng hợp báo cáo trước, che thông tin liên hệ khi không cần. API key chỉ ở server, mã hóa nếu cấu hình trong platform, không trả về browser hoặc prompt.

OpenAI công bố dữ liệu API mặc định không dùng để train nếu khách hàng không opt in. Tuy nhiên không đồng nghĩa không lưu dữ liệu: chính sách lưu trữ phụ thuộc endpoint và chế độ tài khoản. Cần đánh giá retention, sử dụng store:false khi phù hợp, và không coi store:false là cam kết zero retention.

Đặt thời hạn lưu hội thoại/log, xóa hoặc xuất dữ liệu theo quyền và chính sách đã chốt. Log audit nghiệp vụ và transcript chat có mục đích/thời hạn khác nhau. Không tự dùng hội thoại của store để huấn luyện chung.

## 12. Cấu hình platform, store và gói dịch vụ

Platform / AI & tự động hóa:

- Bật/tắt theo store/gói; kill switch toàn cục hoặc từng tool.
- Model/provider được phép, prompt phiên bản, giới hạn đầu vào/đầu ra, số lần gọi tool và thời gian mỗi lượt.
- Hạn mức, chi phí dự kiến/thực tế, lỗi, latency, chất lượng, hàng đợi và mức sử dụng theo store.
- Quản lý kho hướng dẫn nền tảng; bộ tình huống đánh giá; triển khai prompt/model theo nhóm nhỏ và rollback.
- Xem thông tin chẩn đoán đã che dữ liệu; đọc nội dung chat riêng chỉ theo quyền hỗ trợ rõ ràng và có audit.

Store / Cấu hình trợ lý:

- Quy trình/kiến thức, vai trò được dùng, ngưỡng cảnh báo, người nhận, giờ yên lặng, mẫu báo cáo đầu ngày.
- Số lượt/credit đã dùng, hạn mức và lịch sử hành động.
- Chỉ cho giảm quyền AI so với quyền hệ thống; không cho store vượt giới hạn gói hoặc bảo vệ nền tảng.

Gợi ý đóng gói, chưa chốt giá hoặc quota:

| Gói | Phạm vi gợi ý |
| --- | --- |
| Cơ bản | Hướng dẫn, tra cứu, tạo nháp, nhắc việc vận hành cơ bản, quota AI nhỏ |
| Tăng trưởng | Lên đơn bằng chat có xác nhận, báo cáo so sánh, note/task, cảnh báo tùy chỉnh, quota lớn hơn |
| Cao cấp | Phân tích cơ hội CRM, cảnh báo nâng cao, báo cáo tự động và nhiều cấu hình hơn |

Không buộc cửa hàng phải mua AI để giữ quyền truy cập dữ liệu đơn, thông báo thanh toán, hoặc nhắc việc đã cam kết trong gói hiện hữu. Chốt lại quyền lợi thực tế trước khi phát hành.

Hạn mức có hai lớp: đơn vị dễ hiểu cho store và ngân sách token/chi phí nội bộ. Lượt thành công được tính theo một yêu cầu nghiệp vụ, không phải từng tool call. Retry hoặc lỗi hệ thống không bị trừ hai lần; chi phí provider vẫn được ghi nội bộ.

Quota phải reserve/settle nguyên tử để nhiều nhân viên không vượt giới hạn; gắn chu kỳ dịch vụ đang áp dụng. Dùng thử lấy N ngày từ gói, không hardcode 30 ngày; đổi gói tuân theo nâng ngay/hạ cuối kỳ và không mở lại quota bằng cách đóng/mở chat. Khi nâng giữa kỳ, điều chỉnh phần quyền lợi theo chính sách công bố và giữ sổ đã dùng, tránh cấp lại lặp.

Store đóng băng không dùng AI để tạo/sửa đơn; vẫn có đường truy cập billing/hỗ trợ theo chính sách. Hạ gói không xóa dữ liệu lịch sử nhưng dừng tạo hành động ngoài quyền lợi mới. AI hết quota không làm dừng các nhắc việc vận hành không cần mô hình.

Chưa chốt chi phí khi chưa có workload. Đo input/output token, số lượt, tỷ lệ nhiều bước, chi phí retrieval/queue/lưu trữ, model và tỷ giá để đề xuất giá. Không quảng bá AI không giới hạn.

## 13. Lộ trình theo cổng nghiệm thu

| Giai đoạn | Đầu ra | Điều kiện chuyển tiếp |
| --- | --- | --- |
| 0. Chuẩn hóa | Danh mục tools/quyền, định nghĩa chỉ số, dữ liệu thử, thiết kế UI, chính sách dữ liệu/quota | Chốt phạm vi MVP, scheduler và tiêu chí đánh giá |
| 1. Trợ lý đọc dữ liệu | Hướng dẫn, tra đơn/lịch/CRM theo quyền, hỏi báo cáo, liên kết nguồn, log/usage | Không rò tenant, số liệu khớp UI, lỗi provider không ảnh hưởng workspace |
| 2. Hành động có xác nhận | Tạo nháp, quote, chốt đơn qua dịch vụ cũ; note/task/reminder | Kiểm thử idempotency, race, version, thu hồi quyền, email/QR không trùng |
| 3. Theo dõi chủ động | Scheduler bền vững, nhắc giao, quá hạn, báo cáo đầu ngày, xử lý cảnh báo | Đổi lịch/hủy/hoàn tất không nhận nhắc sai; retry/downtime được kiểm chứng |
| 4. CRM và vận hành nâng cao | Gợi ý khách hàng, cảnh báo biến động, tổng hợp sự cố, cấu hình gói đầy đủ | Có đánh giá chất lượng gợi ý, consent, quota và giới hạn chi phí |
| 5. Mở rộng tùy nhu cầu | Nhập giọng nói/ảnh, tối ưu model, chatbot khách mua riêng | Chứng minh lợi ích và ngân sách qua pilot |

Triển khai qua feature flag và một nhóm store thử nghiệm; có cơ chế tắt AI độc lập mà đơn/CRM/thanh toán vẫn hoạt động. Chỉ đưa lên gói trả phí sau khi đo chất lượng và chi phí thực tế. Không ước lượng lịch bàn giao chắc chắn trước khi chốt hạ tầng và phạm vi.

## 14. Kiểm thử và tiêu chí bàn giao đề xuất

1. Tenant: mọi công cụ, lịch sử, action, export, cache và retrieval bị chặn khi truy cập khác store. Không có ca rò dữ liệu trong bộ test và kiểm tra đối kháng; không coi đó là bảo đảm tuyệt đối cho mọi tình huống.
2. Role: owner/admin/manager/support/editor có đúng quyền; thu hồi membership trong lúc chat hoặc ghost không vượt quyền.
3. Orders: lặp xác nhận, refresh, retry và timeout sau commit vẫn đúng một đơn; giá/tổng bằng dịch vụ quote và dữ liệu đã chốt.
4. Payments: AI không tự xác nhận đã thu; webhook lặp không ghi thu hai lần; hủy đơn không làm mất số tiền cần hoàn.
5. Analytics: dữ liệu chuẩn đối chiếu với UI/ledger; đúng bộ lọc và ngày Hà Nội, ngày tương đối, thời điểm sát nửa đêm và khoảng so sánh.
6. Reminders: đóng browser vẫn chạy; đổi lịch/hủy/giao xong vô hiệu nhắc cũ; không gửi trùng khi worker retry; có cơ chế bù downtime.
7. Mail/push: template, store branding, đối tượng nhận, consent, hạn mức email và AI đúng; không nhân đôi mail do AI và nghiệp vụ cùng gửi.
8. Security: note/tài liệu chứa chỉ dẫn giả không vượt quyền; không có bí mật trong prompt/log; UI render nội dung an toàn.
9. Quota: nhiều nhân viên dùng đồng thời, hết hạn dùng thử, nâng/hạ gói, đóng băng, lỗi provider và retry không làm sai sổ.
10. UX: desktop/mobile, bàn phím, safe area, đọc màn hình, tải lại và chuyển trang; không trùng lỗi nháy hoặc reset dữ liệu đã từng xử lý.
11. AI quality: bộ tối thiểu đề xuất 100–150 tình huống tiếng Việt có cách nói tắt/mơ hồ, thiếu dữ liệu, ngoài quyền và ngoài phạm vi; đánh giá tool selection, độ chính xác và câu trả lời không có nguồn.
12. Mục tiêu pilot đề xuất: 100% số tiền ở card xác nhận khớp backend; 0 thao tác ghi không xác nhận trong bộ test; ít nhất 95% tác vụ hợp lệ trong bộ chuẩn hoàn tất hoặc hỏi đúng thông tin thiếu. Đây là mục tiêu cần đo, chưa phải kết quả đạt được.

Theo dõi thêm thời gian tạo đơn so với form, tỷ lệ người dùng sửa draft, cảnh báo bị bỏ qua/sai, tỷ lệ hoàn thành, độ trễ p50/p95 và chi phí mỗi tác vụ. Khi đổi prompt/model phải chạy lại bộ hồi quy.

## 15. Nguồn nghiên cứu

- Shopify Sidekick extensions: https://shopify.dev/docs/apps/build/sidekick — tham khảo phân tách dữ liệu/hành động và xác nhận thay đổi.
- Shopify Sidekick Pulse: https://help.shopify.com/en/manual/ai-powered-tools/sidekick/pulse — tham khảo gợi ý vận hành chủ động.
- OpenAI function calling: https://developers.openai.com/api/docs/guides/function-calling — công cụ có schema, thực thi ở ứng dụng.
- OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data — chính sách training và lưu trữ.
- OpenAI agent evaluations: https://developers.openai.com/api/docs/guides/agent-evals — đánh giá luồng công cụ và chất lượng.
- Vercel Cron usage: https://vercel.com/docs/cron-jobs/usage-and-pricing — tần suất và độ chính xác tùy gói.
- Vercel Cron management: https://vercel.com/docs/cron-jobs/manage-cron-jobs — concurrency, idempotency và xử lý lỗi.

Các thiết kế cho Fleurious trong tài liệu là đề xuất riêng dựa trên repository và các nguyên tắc nghiên cứu; không phải khẳng định các sản phẩm tham chiếu có toàn bộ luồng tương tự.
