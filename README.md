# Fleur — Next.js + MySQL

Website bán hoa bằng Next.js App Router, React, TypeScript và MySQL 8. Giao diện tiếng Việt trắng/đen, phong cách tối giản; cửa hàng và workspace quản trị dùng chung database.

## Xem bản đang chạy

- Cửa hàng: http://127.0.0.1:3001
- Dashboard: http://127.0.0.1:3001/admin
- Đăng nhập: http://127.0.0.1:3001/login
- Email quản trị: giá trị ADMIN_EMAIL trong .env.local (mặc định admin@fleur.local).
- Mật khẩu quản trị: giá trị ADMIN_PASSWORD trong .env.local. Được tạo ngẫu nhiên khi thiết lập, không có mật khẩu mặc định công khai. File này bị loại khỏi Git.

MySQL fleur_store đã được tạo trên máy hiện tại. Dữ liệu ban đầu có 6 sản phẩm, 4 danh mục, 2 sự kiện và 2 bài viết. Không tạo đơn hàng hay khách hàng giả trên dashboard.

## Chạy trên máy

Yêu cầu Node.js 22.x hoặc mới hơn và MySQL >=8.

1. Cài thư viện: npm ci
2. Copy .env.example thành .env.local; đặt tài khoản MySQL và ADMIN_PASSWORD ít nhất 12 ký tự.
3. Tạo database và dữ liệu: npm run db:setup
4. Chạy phát triển: npm run dev -- --port 3001
5. Đặt APP_ORIGIN đúng URL thực tế, ví dụ http://127.0.0.1:3001. Cơ chế chống CSRF chỉ chấp nhận origin này.
6. Build production: npm run build
7. Chạy production: npm run start -- --port 3001

Tài khoản quản trị chỉ được tạo nếu email chưa tồn tại. Đổi ADMIN_PASSWORD trong .env.local sau lần seed không tự đổi mật khẩu người dùng đã có; dùng màn hình đổi mật khẩu hoặc quy trình đặt lại mật khẩu.

## Chức năng cửa hàng

- Trang chủ, danh mục, tìm kiếm theo tên/loài hoa, bộ lọc dịp, mức giá và sắp xếp.
- Chi tiết hoa, kích thước S/M/L, giá tương ứng, số lượng, tồn kho, hướng dẫn chăm sóc.
- Giỏ hàng và yêu thích lưu trên trình duyệt của thiết bị.
- Mã ưu đãi, phí giao hàng, checkout khách vãng lai hoặc người đã đăng nhập.
- Ngày/khung giờ giao, thông tin người đặt/người nhận, thiệp viết tay, ghi chú.
- COD: đơn mới chờ xác nhận; ghi nhận thanh toán khi giao hoàn thành.
- Đăng ký/đăng nhập/đăng xuất, hồ sơ, địa chỉ mặc định, ngày sinh, lựa chọn tiếp thị, đổi mật khẩu.
- Lịch sử đơn, huỷ đơn phù hợp trạng thái, tra cứu đơn bằng mã + email.
- Tin tức, sự kiện, liên hệ, câu hỏi thường gặp, chính sách, quyền riêng tư, trang lỗi và metadata.

## Workspace quản trị

- Tổng quan sử dụng số liệu thật: doanh thu đã giao, đơn hàng, khách hàng, sản phẩm, biểu đồ 14 ngày.
- CRUD sản phẩm/danh mục/khuyến mãi/sự kiện/tin tức. Ẩn nội dung để bảo toàn dữ liệu đơn hàng.
- Tải ảnh JPG/PNG/WebP, giới hạn 4 MB mỗi ảnh và kiểm tra chữ ký định dạng.
- Xem chi tiết và chuyển trạng thái đơn theo luồng hợp lệ; huỷ đơn hoàn tồn kho và hoàn lượt ưu đãi.
- Quản lý users, khoá tài khoản và phân quyền theo 5 vai trò.
- CRM: tự tạo hồ sơ khi đăng ký/đặt hàng; phân nhóm, lịch sử mua hàng, chi tiêu, ngày sinh, ghi chú, lịch hẹn chăm sóc, trạng thái công việc, xuất CSV.
- Yêu cầu hỗ trợ, nhật ký thao tác và cấp liên kết đặt lại mật khẩu sau xác minh thủ công.

| Vai trò  | Quyền                                                                |
| -------- | -------------------------------------------------------------------- |
| Admin    | Toàn bộ, gồm users, phân quyền và nhật ký                            |
| Manager  | Tổng quan, sản phẩm, danh mục, đơn, khuyến mãi, sự kiện, CRM, hỗ trợ |
| Editor   | Tin tức và sự kiện                                                   |
| Support  | Đơn hàng, CRM và hỗ trợ                                              |
| Customer | Tài khoản cá nhân và đơn của chính mình                              |

Quyền được kiểm tra tại API, không chỉ ẩn menu. Phiên đăng nhập dùng cookie HttpOnly/SameSite, token phiên được băm. Mật khẩu dùng scrypt với salt riêng. Các truy vấn có dữ liệu người dùng đều được tham số hoá. Checkout tính lại giá ở máy chủ, khoá các hàng tồn kho trong transaction và có khoá chống tạo trùng đơn.

## Kiểm tra

- npm run typecheck
- npm run build
- npm test (cần server chạy tại APP_ORIGIN và database test/local).

Bộ kiểm tra tích hợp tạo các bản ghi QA riêng, xác thực HTTP/API, phân quyền, checkout, tranh chấp tồn kho, huỷ đơn, CRM và phiên đăng nhập, sau đó dọn dữ liệu thử theo ID/email riêng. Không chạy bộ này trên database kinh doanh nếu không muốn có thao tác QA trong nhật ký.

Đã kiểm tra giao diện email admin trong trình duyệt desktop; chưa kiểm thử toàn bộ giao diện cửa hàng. Bố cục có CSS responsive cho desktop/tablet/mobile. Có các WebMCP tool tìm hoa/thêm giỏ khi trình duyệt hỗ trợ; chưa xác minh bằng context WebMCP thực tế.

## Vercel + TiDB Cloud

Kết nối database trong ứng dụng và script seed hỗ trợ TLS qua MYSQL_SSL=true, xác minh chứng chỉ máy chủ và yêu cầu TLS 1.2 trở lên. Pool dùng tối đa 5 kết nối mỗi instance, giữ tối đa 2 kết nối nhàn rỗi và timeout nhàn rỗi 5 giây.

Tạo file .env.tidb.local riêng (bị loại khỏi Git) với các biến:

```dotenv
MYSQL_HOST=<host trong TiDB Connect>
MYSQL_PORT=4000
MYSQL_USER=<username đầy đủ trong TiDB Connect>
MYSQL_PASSWORD=<mật khẩu database>
MYSQL_DATABASE=fleur_store
MYSQL_SSL=true
ADMIN_EMAIL=admin@fleur.local
ADMIN_PASSWORD=<mật khẩu riêng tối thiểu 12 ký tự>
```

Chạy:

```sh
npm run db:setup:tidb
npm run db:verify:tidb
```

Lệnh setup kiểm tra cấu hình trước khi kết nối, không cho phép fallback sang MySQL cục bộ hoặc ghi vào database hệ thống (sys/mysql/information_schema/performance_schema/metrics_schema). Script tạo schema bằng CREATE TABLE IF NOT EXISTS; dữ liệu mẫu và admin được ghi trong transaction. Khi seed một database trống, ID danh mục được tra theo slug thay vì giả định bắt đầu từ 1. Chạy lại không đặt lại mật khẩu admin đã tồn tại.

Lệnh verify kiểm tra đúng TiDB, chứng chỉ TLS, 20 bảng, các bộ đếm dữ liệu mẫu, mật khẩu admin, JSON aggregation và khóa bản ghi trong transaction. Không in host, username hay mật khẩu.

Trên Vercel, import repository, chọn Next.js, Node.js 22.x, nhánh main, Install Command npm ci, Build Command npm run build và để Output Directory mặc định. Khi VERCEL=1, build dùng .next; production cục bộ vẫn dùng .next-production. Không chạy seed trong Build Command.

Thêm MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE=fleur_store, MYSQL_SSL=true và APP_ORIGIN=https://<domain-thực-tế> vào Environment Variables của Production. APP_ORIGIN phải khớp chính xác URL đang truy cập và không có dấu / cuối. Không dùng tiền tố NEXT_PUBLIC_ cho thông tin database. ADMIN_EMAIL/ADMIN_PASSWORD chỉ dùng khi seed, không cần đưa lên Vercel runtime.

Các bước cấu hình này không tự tạo project hoặc triển khai lên tài khoản Vercel. Upload dùng Vercel Blob khi có BLOB_STORE_ID (kết nối OIDC của Vercel) hoặc BLOB_READ_WRITE_TOKEN. Trên Vercel, kết nối một public Blob store với project và môi trường Production rồi redeploy; API không ghi vào filesystem của Vercel. Khi chạy local không có cấu hình Blob, ảnh được lưu tại storage/uploads. Các ảnh mẫu trong public/images và ảnh URL HTTPS vẫn dùng được.

Kiểm tra seed trên database QA cục bộ, được tạo và dọn tự động:

```sh
npm run test:setup
```

## Triển khai Docker

Có Dockerfile và compose.yaml cho Node.js + MySQL 8.4 với volume lưu database/ảnh upload.

Tạo file .env dành cho Docker Compose (không commit):

- MYSQL_PASSWORD: mật khẩu riêng của tài khoản database ứng dụng
- MYSQL_ROOT_PASSWORD: mật khẩu root MySQL
- ADMIN_EMAIL và ADMIN_PASSWORD
- APP_ORIGIN: URL chính thức của website

Chạy docker compose up --build -d. Website ở cổng 3000. Đặt reverse proxy HTTPS cho môi trường public và APP_ORIGIN phải khớp chính xác URL public. Database chỉ nằm trên mạng nội bộ Compose; ảnh upload và dữ liệu được lưu ở volume. Cấu hình Docker đã được cung cấp nhưng chưa chạy trong môi trường hiện tại.

## Cấu hình cần hoàn tất trước khi kinh doanh

- Font: CSS ưu tiên SF Pro Display/SF Pro Text local, có system fallback. Không kèm file font Apple. SF Pro Icons chỉ khai báo local; icon giao diện hiện dùng Lucide SVG. Bổ sung webfont/glyph được phép sử dụng nếu cần SF chính xác trên mọi thiết bị.
- Thay ảnh minh hoạ, tên thương hiệu, thông tin sản phẩm, phạm vi giao, pháp nhân và chính sách bằng thông tin cửa hàng thật. ASSET-CREDITS.md lưu nguồn ảnh.
- Đang hỗ trợ COD. Chưa kết nối nhà cung cấp thanh toán trực tuyến, webhook hay hoàn tiền tự động.
- Chưa kết nối SMTP/SMS: đơn hàng không tự gửi email. Yêu cầu quên mật khẩu đi vào danh sách hỗ trợ; admin xác minh chủ sở hữu rồi cấp liên kết một lần, có hạn 30 phút. Không chia sẻ link nếu chưa xác minh.
- CRM là module nội bộ; lịch chăm sóc nằm trong dashboard. Chưa đồng bộ với dịch vụ CRM bên ngoài hoặc tự gửi chiến dịch.
- Có API giới hạn tốc độ theo email/token; khi public nên bổ sung giới hạn theo IP tại reverse proxy, giám sát, backup và chính sách lưu dữ liệu.
- Danh sách admin/CRM hiện lấy tối đa 500 đơn gần nhất; thêm phân trang server khi dữ liệu lớn.
- Trang hiện đặt noindex để tránh index dữ liệu demo; cập nhật robots metadata khi mở bán.
- Sites không hỗ trợ kết nối MySQL TCP của ứng dụng này. Mã nguồn được giữ đúng Next.js + MySQL và hiện chạy local; chưa xuất bản URL public.

## Cấu trúc

- app/: layout, trang động, metadata, API routes.
- components/: cửa hàng, tài khoản, quản trị, context giỏ hàng.
- lib/db.ts: connection pool và catalog.
- lib/auth.ts: phiên, mật khẩu, phân quyền, giới hạn thử.
- lib/commerce.ts: tính giá, transaction đặt/huỷ/chuyển trạng thái đơn.
- lib/admin.ts: schema và thao tác quản trị.
- scripts/setup-db.mjs: khởi tạo MySQL và dữ liệu.
- scripts/smoke.mjs: kiểm thử tích hợp.
- public/images/: ảnh minh hoạ đã tải.
- storage/uploads/: ảnh do quản trị viên tải lên, được phục vụ qua route /uploads/.

## Email đơn hàng & chương trình CRM (Gmail SMTP)

Mở /admin/emails hoặc chọn **Email & chương trình** trong Workspace.

- Đơn mới: tự xếp hàng email xác nhận với mã đơn, danh sách hoa, số tiền, người nhận và lịch giao.
- Chuyển trạng thái hợp lệ: tự xếp hàng email báo trạng thái trước/sau, gồm cả khách tự hủy đơn.
- Admin và Manager được tạo/chỉnh sửa/bật/tắt mẫu. Support xem lịch sử và gửi chương trình CRM nhưng không sửa mẫu; Editor và Customer không có quyền truy cập.
- Có 6 mẫu ban đầu: xác nhận đơn, trạng thái đơn, hậu mãi, sinh nhật, sự kiện, ưu đãi/tri ân. Có thể thêm mẫu CRM riêng, sửa tên/tiêu đề/nội dung và xem trước dữ liệu minh họa. Nội dung là văn bản có biến, được escape khi tạo HTML.
- CRM gửi theo nhóm, một khách cụ thể hoặc tháng sinh nhật, tối đa 500 khách/chương trình. Xem trước nội dung và danh sách người nhận trước khi gửi; thay đổi mẫu/danh sách làm mất hiệu lực bản xem trước.
- Các chương trình CRM được nhân viên chủ động gửi. Chưa tự gửi vào ngày sinh nhật hoặc khi hoàn thành công việc CRM.
- Mỗi email CRM gửi riêng đến khách đồng ý nhận tin và có liên kết hủy đăng ký. Danh sách hủy được kiểm tra lại ngay trước khi gửi; checkbox tại checkout không tự xóa danh sách hủy. Thông báo giao dịch không phụ thuộc consent tiếp thị.
- Hàng đợi lưu trong cùng transaction với đơn hàng; checkout không chờ SMTP. Nội dung email đã xếp hàng được giữ nguyên khi sửa mẫu sau đó. SMTP từ chối tạm thời được thử lại sau 5 phút, tối đa 5 lần; lỗi không xác định sau khi gửi hoặc worker bị gián đoạn được đánh dấu **Cần kiểm tra SMTP**, không tự gửi lại để tránh trùng.
- “SMTP đã tiếp nhận” nghĩa là máy chủ SMTP chấp nhận thư, chưa xác nhận khách đã nhận trong inbox. Chưa tích hợp theo dõi mở thư, bounce hoặc delivery webhook.
- Nhật ký hiện 200 email và 50 chương trình gần nhất. Có nút thử lại thư thất bại, xử lý hàng đợi và hủy phần chương trình chưa gửi. Thư đang gửi có thể đã được SMTP tiếp nhận trước khi thao tác hủy hoàn tất.

### Migration

Với database đang có dữ liệu, chạy migration bổ sung trước khi deploy code:

```sh
npm run db:email
# Hoặc TiDB với .env.tidb.local:
npm run db:email:tidb
```

Migration thêm email_templates, email_campaigns, email_outbox, email_suppressions; không gửi email và không ghi đè mẫu đã sửa. Tổng schema hiện có 20 bảng. Lệnh db:setup cũng tạo các bảng email cho cài đặt mới.

### Bật Gmail trên Vercel

1. Bật xác minh 2 bước cho Gmail, tạo [Mật khẩu ứng dụng](https://myaccount.google.com/apppasswords). Dùng mật khẩu ứng dụng, không dùng mật khẩu đăng nhập Gmail. Một số tài khoản tổ chức có thể không cho phép tạo mật khẩu ứng dụng; xem [hướng dẫn Google](https://support.google.com/mail/answer/185833?hl=vi).
2. Điền cấu hình dưới đây vào **Vercel → Settings → Environment Variables → Production**:

```dotenv
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<địa chỉ Gmail gửi>
SMTP_PASSWORD=<mật khẩu ứng dụng>
SMTP_FROM_EMAIL=<cùng địa chỉ Gmail gửi>
SMTP_FROM_NAME=Fleur
APP_ORIGIN=https://poufleur.vercel.app
CRON_SECRET=<chuỗi ngẫu nhiên ít nhất 32 ký tự>
```

3. Redeploy. Vào **Email & chương trình → Kiểm tra kết nối** để kiểm tra DNS/TLS/xác thực mà không gửi thư. Việc kiểm tra kết nối thành công không đảm bảo mọi địa chỉ From được Gmail chấp nhận.
4. Đặt một đơn thử bằng địa chỉ bạn kiểm soát; kiểm tra **Lịch sử gửi**, hộp thư đến và spam. Khi bật gửi, các email đang chờ cũng sẽ được xử lý.
5. Preview và Development nên giữ EMAIL_ENABLED=false, hoặc dùng tài khoản/hộp thư thử riêng. Không đặt mật khẩu vào code hay biến NEXT_PUBLIC_.

File .env.smtp.local riêng đã được chuẩn bị trên máy hiện tại, bị loại khỏi Git. Có thể điền SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL để kiểm tra kết nối bằng:

```sh
npm run smtp:verify
```

File này không tự được Next.js hoặc Vercel nạp. Để chạy app cục bộ, chép các biến SMTP sang .env.local và khởi động lại server; để deploy, đặt biến trong Vercel như trên. Giữ APP_ORIGIN đúng URL đang chạy; Vercel yêu cầu HTTPS. Nội dung file riêng và mật khẩu không được in trong API hay log lỗi SMTP.

### Xử lý hàng đợi

Next.js after() xử lý tối đa 20 email sau thao tác đặt hàng, đổi trạng thái, gửi chương trình hoặc thử lại. Mỗi lượt có giới hạn thời gian; chương trình lớn có thể còn email chờ.

vercel.json khai báo một cron mỗi ngày tại /api/email/worker, phù hợp gói Hobby, với tối đa 100 email trong giới hạn thời gian của một lượt. Endpoint cần Authorization: Bearer <CRON_SECRET>; Vercel tự gửi header khi cấu hình CRON_SECRET. Trên Hobby, cron không đảm bảo chạy đúng phút. Có thể nhấn **Xử lý hàng đợi** trong admin để tiếp tục ngay; muốn retry tự động thường xuyên cần scheduler gọi endpoint này hoặc lịch cron thường xuyên hơn trên gói hỗ trợ. Không xem nút gửi chương trình là bảo đảm toàn bộ 500 email được gửi tức thì.

Tham khảo: [Nodemailer SMTP](https://nodemailer.com/smtp), [Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

### Kiểm thử email

- npm run test:email: 21 kiểm tra renderer, nội dung MIME, transaction, chống trùng khi nhiều worker, consent, suppression, SMTP lỗi và retry trên database QA cục bộ tự tạo/dọn. Dùng transport giả lập, không gửi thư ra ngoài.
- npm test: có kiểm tra phân quyền email, mẫu và xem trước CRM.
- TEST_EMAIL_CAMPAIGNS=1 bật thêm kiểm tra gửi chương trình/hủy đăng ký. Chỉ chạy với server QA đã cấu hình SMTP_HOST=fleur-mail-test.invalid, SMTP_FROM_EMAIL=qa-sender@example.test và tài khoản thử; không dùng SMTP thật. Đã chạy đủ 100 kiểm tra tích hợp trên MySQL local và TiDB bằng SMTP giả lập.
- Đã kiểm tra màn hình mẫu, bản xem trước và form chương trình trong trình duyệt desktop. Chưa xác minh giao diện email bên trong Gmail/Outlook hoặc gửi Gmail thật do chưa có mật khẩu ứng dụng.

### Album ảnh sản phẩm

- Admin hỗ trợ 1 ảnh đại diện và tối đa 11 ảnh album, tải nhiều file cùng lúc, đổi thứ tự, chọn ảnh làm đại diện và xóa khỏi album. File JPG/PNG/WebP tối đa 4 MB; mỗi file được gửi riêng để nằm dưới giới hạn request của Vercel Functions. [Tài liệu upload Vercel Blob](https://vercel.com/docs/vercel-blob/server-upload).
- Tên thiết kế tự tạo slug không dấu khi thêm mới. Slug của sản phẩm cũ được giữ nguyên khi đổi tên; có nút tạo lại hoặc sửa thủ công.
- Chạy `npm run db:gallery` cho database local, `npm run db:gallery:tidb` cho TiDB trước khi deploy code mới. Migration chỉ thêm cột JSON gallery nếu chưa có, không ghi đè ảnh cũ. Lệnh setup database cũng tích hợp migration này.
- Trang chi tiết có ảnh chính, hàng thumbnail, nút trước/sau, phím trái/phải và vuốt ngang trên điện thoại. Sản phẩm một ảnh không hiện điều khiển thừa.
- Xóa ảnh trong form chỉ bỏ liên kết khỏi sản phẩm, không xóa file khỏi kho Blob để tránh ảnh đang được dùng ở nơi khác.
