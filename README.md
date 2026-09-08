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

Yêu cầu Node.js >=20.9 và MySQL >=8.

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
- Tải ảnh JPG/PNG/WebP, giới hạn 5 MB và kiểm tra chữ ký định dạng.
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

Chưa thực hiện kiểm thử tương tác/ảnh chụp trong trình duyệt. Bố cục có CSS responsive cho desktop/tablet/mobile. Có các WebMCP tool tìm hoa/thêm giỏ khi trình duyệt hỗ trợ; chưa xác minh bằng context WebMCP thực tế.

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

Lệnh verify kiểm tra đúng TiDB, chứng chỉ TLS, 16 bảng, các bộ đếm dữ liệu mẫu, mật khẩu admin, JSON aggregation và khóa bản ghi trong transaction. Không in host, username hay mật khẩu.

Trên Vercel, import repository, chọn Next.js, Node.js 22.x, nhánh main, Install Command npm ci, Build Command npm run build và để Output Directory mặc định. Khi VERCEL=1, build dùng .next; production cục bộ vẫn dùng .next-production. Không chạy seed trong Build Command.

Thêm MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE=fleur_store, MYSQL_SSL=true và APP_ORIGIN=https://<domain-thực-tế> vào Environment Variables của Production. APP_ORIGIN phải khớp chính xác URL đang truy cập và không có dấu / cuối. Không dùng tiền tố NEXT_PUBLIC_ cho thông tin database. ADMIN_EMAIL/ADMIN_PASSWORD chỉ dùng khi seed, không cần đưa lên Vercel runtime.

Các bước cấu hình này không tự tạo project hoặc triển khai lên tài khoản Vercel. Upload vẫn dùng filesystem cục bộ; cần chuyển API upload sang Blob/object storage trước khi dùng chọn file trên Vercel. Các ảnh mẫu trong public/images và ảnh URL HTTPS vẫn dùng được.

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
