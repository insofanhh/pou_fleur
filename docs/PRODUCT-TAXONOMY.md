# Danh mục và thành phần hoa

- `/workspace/{storeId}/categories` quản lý hai loại dữ liệu qua hai tab. Chủ cửa hàng, quản trị viên và quản lý có quyền quản lý như danh mục cũ.
- Trong thêm/sửa sản phẩm, chọn “Tạo danh mục mới” hoặc “Tạo thành phần hoa mới” để tạo ngay và tự chọn kết quả, giữ nguyên các trường sản phẩm đang nhập.
- Một sản phẩm có một danh mục và nhiều thành phần hoa. Nội dung nhập cũ được giữ trong “Thành phần khác”; không tự tách chuỗi cũ vì tên nguyên liệu có thể chứa dấu phẩy.
- Mỗi cửa hàng có danh sách riêng. Tên/đường dẫn trùng trong cùng loại bị từ chối. Không xoá mục đang được dùng; đổi tên thành phần tự cập nhật nội dung sản phẩm liên quan trong cùng transaction.
- `products.flowers` tiếp tục phục vụ trang bán hàng; `product_flower_components` lưu lựa chọn có cấu trúc và `flower_other` lưu phần nhập thêm. Gửi danh sách ID qua API để máy chủ kiểm tra và tính nội dung, không tin chuỗi từ trình duyệt.

## Cập nhật database

Migration chỉ thêm bảng/cột, không thay đổi nội dung sản phẩm cũ. `db:setup` / migration SaaS cũng chạy migration này.

Local có backup và kiểm tra phục hồi:

```powershell
node --env-file=.env.local scripts/migrate-local-product-taxonomy.mjs
```

Production: sao lưu và kiểm tra phục hồi trước, sau đó chạy migration một lần trước khi triển khai code:

```powershell
node --env-file=.env.tidb.local scripts/setup-product-taxonomy.mjs --production-backup-verified
```

Chạy `npm run test:onboarding` để kiểm tra API, phân tách cửa hàng, dữ liệu cũ, tạo nhanh và giao diện desktop/mobile trên database tạm; không gửi mail ra ngoài.
