> Tài liệu lịch sử. Chính sách hai nhóm lượt dưới đây đã được thay thế bởi [Trải nghiệm Free và một lượt paid trial](EXPERIENCE-PLAN.md) ngày 20/10/2026. Chỉ dùng để đối chiếu quyền cũ đã cấp.

# Chính sách dùng thử theo tài khoản

Chính sách cập nhật ngày 20/10/2026. Gói Khởi đầu là quyền onboarding cố định
cho cửa hàng đầu tiên; tài khoản chỉ còn một lượt trải nghiệm có thể tự chọn
cho các gói còn lại.

## Đánh giá và nghiên cứu

Tách onboarding khỏi trial khám phá giúp mọi tài khoản mới có cùng điểm bắt đầu
N ngày theo cấu hình của gói Khởi đầu, trong khi lượt dùng chung cho các gói nâng cao vẫn tạo động lực trải
nghiệm nhưng không cho phép thử lần lượt mọi gói hoặc mở thêm store để nhận lại
ưu đãi. Nên theo dõi tỷ lệ bắt đầu/kết thúc thử, mua sau thử, nâng gói và chi
phí phục vụ; không suy ra hiệu quả chuyển đổi khi chưa có dữ liệu.

Nguồn chính thức đối chiếu ngày 19/10/2026:

- [Stripe free trials](https://docs.stripe.com/billing/subscriptions/trials/free-trials): kỳ thử có mốc riêng, nhắc hạn và lựa chọn tạm dừng khi thiếu phương thức thanh toán; cảnh báo trial không yêu cầu thanh toán có thể bị lạm dụng bằng tài khoản giả.
- [Chargebee Trial Management](https://www.chargebee.com/docs/billing/2.0/subscriptions/trial_periods): kỳ thử độc lập giá/chu kỳ thanh toán; đổi gói có các quy tắc tính lại ngày khác nhau. Fleurious chủ động giữ mốc đã cam kết thay vì tính lại thời gian thử khi đổi gói.

Không có chuẩn chung bắt buộc mọi SaaS phải cho một hoặc hai lượt. Hai nhóm lượt bên dưới là quyết định sản phẩm của Fleurious, không phải quy định của Stripe/Chargebee. Không tích hợp Stripe hoặc trích tiền tự động trong thay đổi này.

## Quy tắc

| Nhóm | Quyền trên tài khoản | Gói áp dụng |
| --- | --- | --- |
| `starter` | Tự động một lần, theo `plans.trial_days` | Gói mặc định ID 1 (Khởi đầu), kể cả đổi tên hoặc giá |
| `discovery` | 1 lượt dùng chung, có thể chọn | Tất cả gói còn lại (Studio, Atelier…) |

- Khi đăng ký cửa hàng đầu tiên với gói Khởi đầu, hệ thống tự giữ số ngày `plans.trial_days` hiện tại và bắt đầu khi cửa hàng được duyệt (hoặc ngay khi chế độ tự duyệt hoàn tất). Người dùng không có nút đăng ký lại trial Khởi đầu trong workspace.
- Lượt `discovery` được chọn tối đa một lần cho mọi gói khác trên tất cả cửa hàng của chủ tài khoản. Một lượt đã giữ/đã dùng không được cấp lại khi đổi store, đổi gói, đổi tên/email tài khoản, duyệt lại hoặc mở băng.
- Nếu đăng ký trực tiếp gói khác, lượt `discovery` được xử lý theo cấu hình gói; quyền onboarding Khởi đầu vẫn chỉ phát sinh khi tài khoản đăng ký gói Khởi đầu lần đầu.
- Đăng ký store giữ lượt trong transaction và chốt phiên bản gói/ngày thử, nhưng chỉ đếm ngày khi được duyệt. Store khác của cùng tài khoản không được giữ cùng lượt. Từ chối/đóng store chưa bắt đầu sẽ trả lượt giữ; lượt đã bắt đầu không hoàn lại.
- Khi đăng ký từ workspace: xem trước giá sau thử, hạn mức, ngày bắt đầu/kết thúc, bảo toàn kỳ đã mua và cảnh báo vượt quota. Xác nhận mới giữ lượt; preview không ghi dữ liệu. Báo giá có hạn 15 phút, kiểm tra lại dưới khóa tài khoản và store.
- Khi đang dùng thử Khởi đầu hoặc kỳ miễn phí, xác nhận discovery sẽ đổi gói và hạn mức ngay. Lượt Khởi đầu kết thúc và không được hoàn lại; gói mới nhận đúng N ngày snapshot tính từ lúc xác nhận, không cộng phần thử cũ. Nếu đang hết quyền, cũng bắt đầu ngay. Nếu có thời gian đã trả tiền, discovery nối sau toàn bộ các kỳ đã mua, giữ nguyên sổ thanh toán. Lượt đã giữ không tự được chuyển sang gói khác hoặc cấp lại bằng cách hủy; UI nêu rõ trước xác nhận.
- Có thể dùng quyền onboarding và lượt `discovery` trên cùng store hoặc ở các store khác nhau; tổng là một quyền starter tự động và một lượt discovery theo owner. Nhân viên không có quyền đăng ký thử. Store bị platform đóng băng không được dùng lượt mới để vượt khóa.
- Có hóa đơn thu một phần hoặc công nợ lịch sử: yêu cầu xử lý trước. Hóa đơn tương lai chưa thu và kỳ miễn phí chưa bắt đầu được thay bằng lượt thử, hủy QR và nhắc liên quan cùng transaction. Không xóa ledger hoặc sửa kỳ đã nhận tiền.
- Ngày starter lấy từ `plans.trial_days` và được snapshot theo phiên bản gói tại đăng ký. Với discovery, ngày thử cũng là snapshot phiên bản gói tại đăng ký; một ngày bằng 24 giờ UTC. Thay ngày/giá/hạn mức chỉ áp dụng lượt đăng ký mới. 0 ngày tắt trial và không tiêu lượt. Cấu hình thay đổi khi đang preview yêu cầu xem lại.
- Trial được kích hoạt theo mốc đã đặt kể cả khi không có truy cập. Nếu quay lại sau khi toàn bộ kỳ thử đã qua, không cấp thêm ngày; hệ thống nhận diện gói đã thử và khóa do hết hạn.
- Gia hạn thử thủ công áp dụng cho kỳ đang thử; không cấp lại lượt. Chặn dời kỳ thử nếu có lượt thử tiếp theo đã đặt lịch hoặc đã nhận tiền kỳ tới.
- Chọn ngừng gia hạn ngừng kỳ trả phí tự động phát sinh theo billing hiện có; không hoàn lượt hay xóa trial đã giữ. Các lượt thử đã xác nhận vẫn theo lịch hiển thị.
- Hóa đơn sau thử dùng snapshot của chính gói thử, bắt đầu sau thử. Thanh toán sớm giữ quyền thử; thanh toán muộn đủ tiền mua một tháng từ thời điểm nhận đủ. Khóa bill/đối soát/SePay, hạn chờ đổi gói 10 phút, nhắc 5 ngày/1 ngày dùng chung logic hiện có. Kỳ thử 0 đồng không tính là tiền đã thu.
- Không tự trích tiền sau thử. Hết thử không thanh toán thì đóng băng vận hành, vẫn xem dữ liệu/thanh toán theo quyền. Hạ hạn mức giữ dữ liệu cũ và chặn tạo thêm vượt quota.

Giới hạn theo tài khoản không nhận diện tuyệt đối một cá nhân tạo nhiều tài khoản; chưa thêm xác minh danh tính, CAPTCHA hay yêu cầu thẻ ngân hàng trong bản này. Google/password cùng user ID dùng chung lịch sử lượt.

## Dữ liệu và triển khai

`account_trial_claims` có khóa chính `(user_id,bucket)`, snapshot plan/version/days, store và mốc UTC đã giữ. Khóa owner chống tranh lượt giữa các store; khóa store/subscription giữ nhất quán với hóa đơn/webhook. Bổ sung `subscriptions.active_trial_bucket` để biết kỳ thử hiện hành. `trial_claims` cũ được giữ cho tương thích/lịch sử; không dùng làm nguồn kiểm tra lượt của tài khoản nữa.

Migration `account-trials-v1` ghi nhận các lần thử cũ theo owner/nhóm, ưu tiên lịch sử sớm nhất, và giữ offer đang chờ duyệt. Các trial cũ đã cấp được giữ nguyên kể cả nhiều store từng cùng nhận một nhóm; không thu hồi quyền đã cấp, nhưng owner không được nhận lại nhóm đó. Khi admin đổi `trial_days`, giá trị mới chỉ áp dụng đăng ký starter/discovery mới; không kéo dài hoặc rút ngắn trial cũ. Không đổi thời gian/giá hóa đơn hoặc ledger khi migration.

Sửa lỗi xếp lịch ngày 20/10: khi kiểm tra quyền truy cập, discovery chưa bắt đầu và đang xếp sau một kỳ Khởi đầu còn hạn sẽ được đưa lên ngay, với đúng số ngày đã chốt. Không sửa lịch nếu có kỳ trả tiền còn hạn, công nợ/thu một phần, QR thanh toán đang chờ, store bị platform khóa hoặc toàn bộ cửa sổ thử đã qua. Hóa đơn gia hạn chưa thu và không có QR của lịch cũ được vô hiệu hóa cùng nhắc thanh toán; mail bắt đầu dùng thử có khóa chống gửi trùng. Không cần đổi schema cho bản sửa này.

Local: `node --env-file=.env.local scripts/migrate-local-trial.mjs` sao lưu, thử restore/migration hai lần và đối chiếu business data trước khi cập nhật. TiDB/production cần backup và restore drill rồi chạy migration SaaS theo quy trình hiện có trước khi deploy code; không tự deploy trong lần này.

## Kiểm thử

Chỉ dùng QA MySQL port 3310, `fleur_saas_test`, production snapshot port 3005:

```powershell
npm run test:account-trials -- --ui
npm run test:account-trials -- --db-only
npm run test:timeout-migration
npm run test:trial-billing -- --ui
npm run test:plan-changes -- --ui
npm run test:billing
npm run test:saas
npm test
```

Các bài thử dùng ngân hàng giả và SMTP mock, không chuyển tiền hoặc gửi mail thật. Ảnh QA: `.local/account-trial-qa/`.

Ngày 20/10, 41 kiểm tra trực tiếp database QA thành công với `--db-only`, gồm chuyển ngay, sửa lịch cũ, giữ N ngày snapshot, không reset khi tải lại, không gửi trùng mail, bảo toàn kỳ trả tiền/QR và tranh lượt đồng thời. Chế độ này không khởi chạy hoặc thay thế các kiểm thử HTTP/UI.
