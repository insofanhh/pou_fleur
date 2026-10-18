# Cài đặt và phát hành Fleur SaaS

Ngày cập nhật: 18/10/2026. Runtime được kiểm tra: Node 20.19.5, Next 16.4.2, MySQL 8.0.30. Nên dùng một bản Node LTS còn được hỗ trợ khi đưa lên production.

## Các không gian

| URL | Chức năng |
| --- | --- |
| `/` | Marketplace, địa chỉ người nhận, danh sách/bản đồ store |
| `/s/{slug}` | Storefront của store |
| `/start` | Tạo store nháp bằng tài khoản người dùng |
| `/workspace/{id}` | Dashboard riêng theo membership |
| `/workspace/{id}/board` | Kanban đơn hàng |
| `/workspace/{id}/calendar` | Lịch giao và ghi chú nội bộ |
| `/workspace/{id}/theme` | Chọn mẫu, lưu nháp, xuất bản, khôi phục bản trước |
| `/workspace/{id}/automations` | Chăm sóc sau giao, sinh nhật, khách lâu chưa quay lại |
| `/platform` | Console tổng cho `platform_admin` |
| `/account/orders` | Lịch sử đơn ở mọi store và đặt lại đơn đã giao |
| `/cart` | Tổng hợp các giỏ theo store trên thiết bị |
| `/inbox` | Hộp thư, consent và cài đặt push theo store |

Các URL cũ như `/shop`, `/product/{slug}`, `/admin` vẫn trỏ đến store Fleur có ID 1. Trang `/` trở thành marketplace. Vai trò cũ được chuyển thành membership tại Fleur; admin đầu tiên là owner. Không tự cấp quyền platform dựa trên email hoặc quyền store cũ.

## Cài mới

1. Chạy `npm ci` và tạo `.env.local` từ `.env.example`.
2. Điền MySQL, `ADMIN_EMAIL`, `ADMIN_PASSWORD` và `APP_ORIGIN` đúng origin đang chạy.
3. Chạy `npm run db:setup`. Lệnh tạo dữ liệu Fleur ban đầu và schema SaaS.
4. Chạy `npm run dev`. Mở `/s/fleur` hoặc `/`.
5. Cấp quyền nền tảng riêng cho tài khoản đã tồn tại:

```powershell
node --env-file=.env.local scripts/platform-admin.mjs --email=YOUR_EMAIL
```

Thêm `--revoke` để thu hồi quyền. Lệnh không đổi mật khẩu và không suy quyền từ tên email. Không đặt mật khẩu hoặc khóa riêng trong lệnh/chat/Git.

Nếu tài khoản chưa tồn tại, thêm `--create`: script tạo mật khẩu ngẫu nhiên, lưu riêng vào `.local/platform-admin-credentials.txt` và không in mật khẩu ra log. Trên máy này đã tạo tài khoản local `adminfleur@platform.com`, cấp quyền platform và kiểm tra đăng nhập/API console thành công. File thông tin đăng nhập bị loại khỏi Git; chưa tạo tài khoản này trên TiDB production.

Store mới bắt đầu ở trạng thái nháp. Owner nhập thông tin, tọa độ, cấu hình giao, sản phẩm và giao diện, rồi gửi duyệt. Platform duyệt thì store mới xuất hiện công khai và nhận đơn. Store tạm dừng hoặc hết quyền nhận đơn vẫn xử lý được đơn cũ.

## Nâng cấp database đang có

Không chạy seed lại production để thay cho migration. Sao lưu, thử restore trên database riêng, đối chiếu dữ liệu và thử migration ở staging trước.

```powershell
# MySQL local
npm run db:saas

# TiDB, chỉ sau khi đã kiểm tra backup/restore
npm run db:saas:tidb -- --production-backup-verified
```

Migration có thể chạy lại, không ghi đè template email đã tùy chỉnh. Dữ liệu cũ thuộc Fleur. Unique slug, mã giảm giá và email CRM được chuyển sang unique trong store; identity của người dùng vẫn dùng chung toàn nền tảng. Thêm chỉ mục cho đơn theo ngày/trạng thái, sản phẩm và outbox.

Trên máy phát triển hiện tại, `scripts/migrate-local-saas.mjs` đã tạo backup trong `.local/backups`, thử restore ở MySQL cổng 3310, đối chiếu fingerprint và mới nâng cấp MySQL local. `.local` không được commit.

Rollback sau khi đã có nhiều store cần khôi phục **cả database và phiên bản ứng dụng tương ứng**, hoặc forward-fix. Không đưa code một store cũ chạy trên database đã có nhiều store, vì code cũ không lọc tenant.

## Vercel và TiDB

1. Chuẩn bị Preview/Staging với database và Blob riêng, không dùng dữ liệu ghi của production để kiểm thử.
2. Trên Vercel, giữ Functions region gần TiDB, ví dụ Singapore nếu cluster ở Singapore.
3. Điền các biến MySQL từ `.env.example`; TiDB dùng `MYSQL_SSL=true`. Đặt `APP_ORIGIN` đúng origin của môi trường, không có dấu `/` cuối.
4. Kết nối Public Blob dành riêng cho Fleur với prefix **BLD**. Ứng dụng không dùng token `BLOB_*` của dự án khác. Ảnh mới được lưu dưới `stores/{storeId}/products/`.
5. Chạy migration vào staging, deploy branch này, kiểm thử checkout/quyền/upload bằng tài khoản staging.
6. Backup/restore drill cho production; chạy migration production trước khi mở phiên bản SaaS. Chỉ mở onboarding khi deploy mới đã chạy tốt.
7. Build command: `npm run build`. Framework: Next.js. Không đặt `FLEUR_DIST_DIR` trên Vercel; biến đó chỉ phục vụ chạy các bản kiểm thử local riêng biệt.

Chưa thực hiện migration hoặc deploy bản SaaS lên TiDB/Vercel production trong đợt này.

## Google

Điền `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` ở server. Authorized redirect URI là:

```text
https://YOUR_DOMAIN/api/auth/google
```

Khi thiếu cấu hình, form không hiện nút đăng nhập Google. OIDC dùng state, nonce, PKCE và kiểm tra ID token/email verified. Email đã có mật khẩu không tự được liên kết với Google chỉ vì trùng email: đăng nhập trước rồi chọn liên kết trong tài khoản.

Platform admin vào `/platform`; owner/admin/manager vào workspace, editor vào tin tức, support vào Kanban. `next` nội bộ được giữ cho luồng mua hàng; route quản trị vẫn kiểm tra quyền phía server.

## Goong

- `GOONG_API_KEY`: REST key, chỉ có ở server.
- `NEXT_PUBLIC_GOONG_MAPTILES_KEY`: Maptiles key, giới hạn domain của website tại nhà cung cấp.
- Điền hai biến trên trong `.env.local` ở thư mục gốc. Không đặt REST key vào biến `NEXT_PUBLIC_*`. Khởi động lại `npm run dev` sau khi đổi key. Trên Vercel, thêm cùng hai biến vào Settings → Environment Variables cho môi trường cần dùng rồi redeploy; Maptiles key được đóng gói khi build.
- Trong Cấu hình store, nhập ít nhất 3 ký tự vào Địa chỉ rồi chọn gợi ý để tự điền vĩ độ/kinh độ. Sửa địa chỉ sẽ xóa tọa độ cũ; có thể nhập tọa độ thủ công. Bấm Lưu cấu hình để lưu vị trí cửa hàng.
- Tìm địa chỉ dùng proxy server; bản đồ tải SDK khi mở map. GPS chỉ được gọi khi người dùng bấm dùng vị trí.
- Lưu vị trí giao trên thiết bị để sắp xếp store. Khoảng cách hiển thị là đường chim bay, không phải quãng đường giao thực tế.
- Thiếu key hoặc SDK lỗi vẫn dùng được danh sách store và địa chỉ nhập tay.
- Checkout có autocomplete địa chỉ khi có REST key. Chọn gợi ý gửi tọa độ để server kiểm tra bán kính; sửa nội dung địa chỉ sẽ xóa tọa độ cũ. Khi nhập tay, cửa hàng cần xác nhận khả năng giao, không coi địa chỉ đó đã được geocode. Chưa có sửa pin bản đồ trong checkout.

Tham khảo API và cách tách key: [Goong JavaScript API](https://document.goong.io/tutorial-Javascript-Api.html), [Goong API Key](https://document.goong.io/tutorial-API-key.html).

## Email, CRM và worker

SMTP dùng cấu hình chung của nền tảng, template/outbox/consent của từng store tách riêng. Với Gmail dùng mật khẩu ứng dụng. Đặt `EMAIL_ENABLED=true` sau khi xác minh SMTP và địa chỉ gửi. Thông báo đơn được đưa vào outbox trong transaction tạo/cập nhật đơn; xử lý sau response để checkout không chờ SMTP.

Email khôi phục mật khẩu ở hàng đợi identity riêng; staff store không đọc được liên kết reset của người dùng.

CRM automation mặc định tạm dừng. Mỗi rule chọn template marketing và nội dung, rồi chủ store/quản lý bật sau khi kiểm tra. Giới hạn một email marketing/khách trong 7 ngày; kiểm tra consent và suppression lúc lên hàng đợi và lúc gửi. Người nhận quà không tự trở thành contact marketing.

Trong Chăm sóc tự động có form thông báo chương trình vào inbox/Web Push. Chỉ owner/admin/manager được gửi; người nhận phải đã mua thành công tại store và có consent. Tối đa một thông báo chương trình/khách trong 7 ngày, mỗi lần tối đa 1.000 khách. Worker kiểm tra lại consent trước phân phối; Web Push cần cấu hình VAPID và preference push của khách.

Worker: `GET /api/email/worker`, header `Authorization: Bearer CRON_SECRET`. Dùng secret ngẫu nhiên ít nhất 32 ký tự. Worker xử lý automation, email, inbox/push và chuyển trạng thái quá hạn SaaS. Không gọi từ frontend. `vercel.json` giữ lịch daily phù hợp cấu hình dự án hiện tại; để chăm sóc/queue được xử lý thường xuyên hơn, dùng lịch phù hợp gói Vercel hoặc scheduler gọi endpoint này. Gửi đơn hàng tức thời còn được kích hoạt sau mutation.

SMTP không đảm bảo exactly once khi mất ACK sau DATA. Email `uncertain` cần đối chiếu hộp thư trước khi gửi lại; ứng dụng không tự retry mù.

## PWA và Web Push

Manifest, icon, offline page và service worker đã có. Service worker không lưu cache các trang cá nhân/API/checkout; offline không tự đặt lại đơn. Mobile có điều hướng dưới; desktop giữ header/dashboard.

Sinh một cặp VAPID:

```powershell
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Lưu public key vào `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private key vào `VAPID_PRIVATE_KEY`, địa chỉ liên hệ vào `VAPID_SUBJECT=mailto:...`; redeploy. Chỉ xin quyền Notification sau khi bấm bật trong `/inbox`. Tùy chọn push/marketing tách theo store. Endpoint hết hiệu lực 404/410 được xóa; logout xóa đăng ký push phía server của tài khoản. Trên iPhone cần kiểm thử bản HTTPS đã thêm vào màn hình chính.

## Gói dịch vụ và thu phí

Có plan/quota, subscription, hóa đơn tháng, ledger ghi nhận thu thủ công, hủy cuối kỳ và grace 7 ngày sau hạn hóa đơn. Hóa đơn và mã giao dịch chống ghi trùng. Qua grace thì chặn nhận đơn mới, không xóa sản phẩm hay chặn hoàn tất đơn cũ.

Thanh toán hết hóa đơn quá hạn hoặc hủy hóa đơn chưa thu giúp phục hồi subscription bị chặn do nợ. Hóa đơn đã thu tiền không được hủy. Đóng store bị chặn khi còn đơn chưa hoàn tất, tiền cần hoàn hoặc hóa đơn chưa giải quyết; có thể đình chỉ để ngưng nhận đơn mới trong lúc xử lý.

Các giá Studio/Atelier trong seed là **giá minh họa để kiểm thử base**, không phải quyết định giá kinh doanh. Chưa có cổng thanh toán thuê bao, trích tiền tự động hay hóa đơn điện tử. Không bật thu phí khách thật trước khi chốt giá và quy trình đối soát. Hóa đơn đã tạo giữ snapshot tên gói/số tiền.

## Kiểm thử

`npm test` chạy TypeScript và các kiểm tra không cần database. Kiểm thử API/UI/queue chạy vào database **riêng** `fleur_saas_test` ở cổng **3310**, không dùng `.env.tidb.local`.

```powershell
$env:MYSQL_HOST='127.0.0.1'
$env:MYSQL_PORT='3310'
$env:MYSQL_USER='root'
$env:MYSQL_PASSWORD=''
$env:MYSQL_DATABASE='fleur_saas_test'
$env:MYSQL_SSL='false'
$env:EMAIL_ENABLED='false'
$env:APP_ORIGIN='http://127.0.0.1:3005'
$env:TEST_ORIGIN='http://127.0.0.1:3005'
# Khởi tạo MySQL test đang chạy sẵn, rồi tạo fixture:
# ADMIN_EMAIL=owner@example.test; ADMIN_PASSWORD=SaaS-Testing-2026-Only
node scripts/setup-saas.mjs
npx playwright install chromium
# Mở app test riêng bằng các env trên; build/start production trước suite UI.
npm run test:integration
```

Credentials fixture chỉ dành cho database test cô lập; không tạo tài khoản này ở production. Bộ test từ chối database/port không đúng. Ảnh kiểm tra nằm ở `.local/screenshots`.

## Bổ sung đơn thủ công

Xem [MANUAL-ORDERS.md](MANUAL-ORDERS.md) để migrate database hiện có, cấu hình cờ bật/tắt và chạy test. Local đã có backup/restore drill trước migration; TiDB phải làm backup/restore riêng rồi mới chạy `npm run db:manual-orders:tidb -- --production-backup-verified`. Không coi backup local là bản backup TiDB.
