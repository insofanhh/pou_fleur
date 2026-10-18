# Fleur SaaS — Phạm vi và biên bản kiểm thử

Ngày: 18/10/2026. Branch triển khai: `codex/saas-platform`.

Đây là bản SaaS lõi đã chạy và kiểm thử local, chưa phải xác nhận mọi tiêu chí mở rộng P0–P8 trong bản thiết kế gốc đã hoàn thành. Chưa migration TiDB hoặc deploy Vercel production. Hướng dẫn cấu hình/phát hành nằm tại [SAAS-SETUP.md](SAAS-SETUP.md); thiết kế và nguồn nghiên cứu tại [SAAS-PLATFORM-PLAN.md](SAAS-PLATFORM-PLAN.md).

## Chức năng đã triển khai

Bổ sung đơn thủ công: đã có [hướng dẫn và phạm vi](MANUAL-ORDERS.md). Kiểm thử trên production build local với database `fleur_saas_test` port 3310: **34 kiểm tra API và 14 kiểm tra UI** đạt, gồm tồn/slot đồng thời, pool DB, tiền cọc/hoàn/rollback, tenant, Ghost và mobile 360/390px. `npm test` và build production đạt. Bộ hồi quy SaaS **55**, kiểm tra SQL tenant thật, **5** luồng CRM/queue/billing, platform users/Ghost **31**, UI chung **57** và các workflow CRUD/Ghost desktop/mobile đạt. Email test chỉ kiểm tra outbox với `EMAIL_ENABLED=false`, không gửi SMTP/push thật. Local đã backup, restore, chạy migration lại hai lần trên bản khôi phục và đối chiếu fingerprint nghiệp vụ trước/sau; TiDB/Vercel production chưa thay đổi.

| Nhóm | Hành vi hiện có |
| --- | --- |
| Identity và quyền | Tài khoản chung, membership/role riêng mỗi store, quyền platform riêng, lời mời, redirect theo role/ngữ cảnh, khôi phục mật khẩu một lần và vô hiệu hóa session cũ |
| Google | OIDC với state/nonce/PKCE, kiểm tra email xác minh, liên kết tài khoản mật khẩu qua phiên đăng nhập; thiếu key thì ẩn nút |
| Marketplace | Homepage danh sách store đã duyệt, tìm/sắp theo vị trí, danh sách/bản đồ Goong, fallback khi thiếu key hoặc lỗi SDK |
| Onboarding | Tạo store nháp, cấu hình/sản phẩm/giao diện, gửi duyệt, platform duyệt/tạm dừng/đóng store theo điều kiện |
| Cách ly dữ liệu | Tenant context trên server; SQL parser gắn store cho bảng commerce/CRM/email/assets, thiếu context bị từ chối; API kiểm tra membership và quyền |
| Commerce | Giỏ/yêu thích/mã ưu đãi riêng store, trang tổng các giỏ, quote server, kiểm tra giá/tồn/slot và chống tạo đơn trùng; lịch sử nhiều store, hủy và đặt lại |
| Checkout | Gửi tặng mặc định hoặc giao cho tôi, giữ lời nhắn ở cả hai, không lặp tên/SĐT khi tự nhận; autocomplete địa chỉ khi có Goong key |
| Vận hành | Bảng đơn và Kanban có phân trang/bộ lọc, cập nhật khi focus và mỗi 30 giây khi tab đang hiện; drawer chi tiết, version chống ghi đè, giao việc/tag và đổi lịch |
| Lịch | Tháng/tuần/lịch trình, số đơn theo ngày giao, ghi chú màu, danh sách và chi tiết đơn trong ngày |
| Tiền đơn hoa | Sổ thu/hoàn riêng, chống ghi trùng giao dịch; giao thành công không tự chuyển sang đã thu tiền |
| Dashboard | Thống kê store, console platform với tổng quan/store/hóa đơn/users/tình trạng tích hợp và queue; CRM merchant và việc chăm sóc |
| CRM | Email template theo store, automation sau giao/sinh nhật/khách lâu chưa quay lại; consent, suppression, giới hạn tần suất và chống trùng |
| Thông báo | Inbox, toast vận hành, sự kiện trạng thái đơn, cấu hình Web Push, preference theo store, thu hồi quyền được kiểm tra lại |
| Chương trình store | Gửi inbox/push cho khách đã mua thành công và đồng ý marketing; kiểm tra consent lần nữa trước phân phối, giới hạn 1 lần/7 ngày/khách và 1.000 người/lần gửi |
| Giao diện | Năm bố cục Minimal/Editorial/Garden/Atelier/Modern, đổi font/màu/nội dung, lưu nháp/xuất bản/lịch sử/khôi phục |
| PWA | Manifest/icon/service worker/offline fallback, thanh điều hướng mobile; không cache API/trang riêng tư hoặc phát lại checkout offline |
| Billing SaaS | Plan/quota/subscription, hóa đơn tháng, ghi nhận thu thủ công, hủy hóa đơn chưa thu, grace và hạn chế đơn mới khi nợ; trả hết/hủy nợ hợp lệ thì phục hồi |
| Upload | Blob riêng prefix BLD, đường dẫn theo store và records assets; không sử dụng Blob của dự án khác |

## Môi trường kiểm thử

- Windows, Node 20.19.5, Next 16.4.2, MySQL 8.0.30, Chromium qua Playwright.
- Database QA riêng `fleur_saas_test`, localhost cổng 3310; bản production build test chạy cổng 3005.
- Release snapshot ở thư mục Temp ngoài OneDrive, cài `npm ci --ignore-scripts` vào node_modules thật, không dùng junction. Cách này tránh file lock OneDrive và giới hạn root của Turbopack.
- Không dùng database TiDB production, không gửi email hoặc Web Push ra ngoài. Các test SMTP sử dụng transport giả lập.
- Ảnh chụp UI và log local nằm trong `.local/screenshots`, `.local/final-integration.log`, `.local/final-ui.log`; thư mục này bị loại khỏi Git.

## Kết quả

| Kiểm tra | Kết quả |
| --- | --- |
| Clean install | `npm ci --ignore-scripts` thành công, audit không có lỗ hổng |
| Production build | `npm run build` với Turbopack mặc định thành công từ release snapshot sạch |
| `npm test` | TypeScript; 10 SQL parser cases và 3 fail-closed cases; 11 product image/swipe, 7 Blob isolation và 8 upload diagnostic checks đều đạt |
| API SaaS | 55 assertions đạt: tenant, scope, giỏ/checkout, slot đồng thời, idempotency, membership, trạng thái/đổi lịch, thu/hoàn, invoices, consent, inbox và recovery |
| SQL thật trên MySQL | Đạt các tình huống OR, subquery, mutation, LEFT JOIN, thiếu scope và system scope |
| Queue/CRM/billing | 5 kiểm tra đạt: automation chống trùng/tần suất, thu hồi consent email, inbox retry, thu hồi consent broadcast và hạn chế subscription sau grace |
| UI desktop/mobile | 57 assertions đạt: marketplace, giỏ theo store, quay lại checkout sau login, dashboard, Kanban drawer, lịch tháng/tuần/lịch trình, mobile overflow, checkout của cả 5 template, tương phản CTA Modern, PWA offline và console platform |
| Email | 21 kiểm tra renderer/MIME/transaction/concurrency/consent/suppression/retry đạt bằng transport giả; không gửi thư thật |
| Dependency audit | `npm audit --omit=dev`: 0 lỗ hổng |
| Admin được chỉ định | Đăng nhập và truy cập API console local thành công cho `adminfleur@platform.com` |
| Quản trị tài khoản và Ghost | 31 assertions API đạt; UI tạo/sửa/khóa/xóa mềm/khôi phục, lịch sử, Ghost/quay lại admin và bố cục 360px/390px đạt; hướng dẫn tại [PLATFORM-USERS.md](PLATFORM-USERS.md) |

Lần kiểm tra UI đầu phát hiện bài test đếm số ngày ngay sau click trước khi React cập nhật. Đã đổi sang assertion chờ đủ bảy ô ngày; UI và suite tích hợp được chạy lại. Không thêm sleep cố định để che lỗi.

Kiểm tra ảnh chụp phát hiện CTA Modern bị màu theme ghi đè. Đã áp dụng biến thể nút sáng, build lại và chạy lại toàn bộ 57 kiểm tra UI, gồm xác nhận màu chữ/nền CTA.

Các kết quả trên không thay thế kiểm thử tải hoặc đo latency production. Chưa có số p95/SLA được xác nhận.

## Backup, restore và migration local

Database cũ `fleur_store` trên cổng 3306 đã được backup, restore vào database riêng trên cổng 3310 và đối chiếu fingerprint trước migration. Sau migration, đối chiếu lại dữ liệu nguồn và chạy migration lần hai thành công.

- Backup local gần nhất, trước migration quản trị tài khoản/Ghost: `.local/backups/fleur_store-1792299009492.sql`.
- Database restore drill: `fleur_restore_1792299009492`.
- Fingerprint dữ liệu nghiệp vụ gần nhất: `2f83cbe624ae98a6fe4ec3a7dab753d87f1d8db3afa54ef98bda28414c758d00`.
- Báo cáo: `.local/migration-report.json`, `restoreVerified`, `migrationRerunVerified`, `sourceVerified` đều `true`.
- Fingerprint gần nhất đã bao gồm tài khoản platform tạo trong đợt SaaS trước; không thay đổi dữ liệu user/đơn trong migration Ghost.

Tài khoản platform local là `adminfleur@platform.com`. Mật khẩu ngẫu nhiên lưu tại `.local/platform-admin-credentials.txt`, không in log/chat và không commit. Chưa tạo tài khoản đó trên TiDB production.

## Cần cấu hình và xác minh trước khi mở production

1. Staging riêng với TiDB/Blob, backup/restore drill, migration và đối chiếu dữ liệu; xác minh các route cũ, tài khoản cũ, upload và checkout bằng dữ liệu staging.
2. Google client ID/secret và redirect URI: thử đăng nhập, hủy, callback lặp, liên kết account và thu hồi quyền bằng tài khoản Google thật.
3. Goong REST/Maptiles keys: thử địa chỉ thật, quyền GPS, bản đồ lỗi/quota và bán kính vùng giao. Địa chỉ nhập tay hiện vẫn cần merchant xác nhận; chưa có thao tác sửa pin hoặc tính phí theo tuyến đường.
4. VAPID/HTTPS: thử subscribe/unsubscribe, logout, thu hồi membership, push thật trên Android và iPhone đã thêm vào màn hình chính. Chromium local mới xác nhận PWA/offline fallback.
5. Xác minh SMTP sender và hộp thư thật khi bật EMAIL_ENABLED; bố trí scheduler thường xuyên hơn daily cron nếu cần queue/automation kịp thời.
6. Chốt gói/giá/quota/chính sách thu tiền trước khi tạo hóa đơn thực tế; giá trong seed chỉ minh họa.

## Phần mở rộng chưa triển khai đầy đủ

- Custom domain/subdomain, chuyển chủ store, MFA và xác minh email toàn bộ identity.
- Onboarding wizard nhiều bước; page builder kéo thả, editor logo/favicon và block tùy ý.
- Analytics daily rollup/backfill, báo cáo cohort nâng cao, export và đo tải/hiệu năng quy mô lớn.
- Trung tâm hội thoại hỗ trợ/ticket đầy đủ của platform.
- Cổng thu phí định kỳ thật, webhook đối soát, proration, credit note và hóa đơn điện tử. Hiện có base và thu thủ công.
- Siết quota storage/staff bằng giao dịch nguyên tử khi nhiều yêu cầu đồng thời; quota sản phẩm đã có kiểm tra nguyên tử.
- Worker cho lưu lượng lớn, campaign phân lô vượt 1.000 người và SLA thông báo. Daily cron hiện tại không đáp ứng yêu cầu xử lý liên tục.

Những mục này không được coi là đã nghiệm thu chỉ vì có trong bản kế hoạch. Phát hành nên theo staging/Fleur/store thử trước khi mở onboarding công khai.
