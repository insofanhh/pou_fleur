# Phân tích hoạt động cửa hàng

## Nghiên cứu và phạm vi

- [Shopify sales reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report): theo dõi giá trị đơn, sản phẩm và kênh bán; phân biệt bán hàng với tiền thực nhận. Áp dụng nguyên tắc phân biệt chỉ số; cách ghi nhận riêng của Fleurious được ghi rõ trên màn hình.
- [Floranext Product Category Report](https://support.floranext.com/kb/article/42-product-category-report/): số lượng và giá trị bán theo sản phẩm/danh mục, lọc theo ngày đặt hoặc ngày giao. Áp dụng bảng sản phẩm, danh mục và bảng khối lượng giao theo ngày giao riêng.
- [Floranext Marketing Report](https://support.floranext.com/kb/article/47-marketing-report/): khoảng thời gian và báo cáo có thể xuất. Bổ sung bộ lọc ngày, kỳ đối chiếu và CSV theo ngày.

UI dùng cùng `stat-card`, `dashboard-panel`, `panel-heading`, `revenue-chart` với tổng quan. Bảng có vùng cuộn riêng trên mobile; biểu đồ dài có thể cuộn và chọn từng ngày bằng chuột, bàn phím hoặc chạm.

## Cách tính

- Khoảng ngày bao gồm cả ngày đầu/cuối, theo giờ Hà Nội. Tối đa 366 ngày; kỳ trước có cùng số ngày và kết thúc trước ngày bắt đầu kỳ hiện tại.
- Báo cáo chính lấy nhóm đơn **tạo trong kỳ**, trạng thái và số dư **hiện tại**, không phải báo cáo luân chuyển tiền theo ngày thu. Số liệu cũ có thể đổi khi cập nhật trạng thái hoặc thu/hoàn tiền sau kỳ.
- Doanh thu đã giao = tổng `total` các đơn hiện đã giao, gồm phí giao và giảm giá. Không khẳng định lợi nhuận hoặc doanh thu kế toán.
- Giá trị đơn = tổng `total` đơn không hủy. Giá trị đơn trung bình = giá trị đơn / số đơn không hủy, có gồm phí giao.
- Tiền đã thu ròng = tổng thu - hoàn trong sổ thu chi của nhóm đơn. Đơn cũ không có phiếu thu chỉ dùng `total` khi trạng thái lưu là đã thanh toán. Nếu có sổ thu chi, số dư 0 vẫn được ưu tiên.
- Công nợ = tổng `max(total - balance, 0)` của đơn không hủy. Tiền cần hoàn = tiền còn giữ của đơn hủy, cộng tiền thu vượt tổng đơn của các đơn khác.
- Sổ thu chi được gộp theo đơn trước khi nối; không nối trực tiếp sản phẩm và phiếu thu vào phép cộng giá trị đơn.
- Trạng thái thanh toán tính từ số dư, loại đơn hủy khỏi bộ đếm. Đơn miễn phí được tính đã thanh toán.
- Tiến trình đơn và kênh tiếp nhận bao gồm cả đơn hủy để giữ tổng số đơn nhất quán.
- Giá trị sản phẩm/danh mục = giá dòng sản phẩm × số lượng, trước giảm giá cấp đơn, chưa gồm phí giao; không tính đơn hủy. Không gọi chỉ số này là doanh thu thuần. Danh mục lấy phân loại hiện tại của sản phẩm; thiết kế riêng hoặc sản phẩm đã xóa được gom vào chưa phân loại.
- Lịch giao lấy đơn có **ngày giao trong kỳ**, kể cả tạo trước kỳ; loại đơn hủy, hiển thị 7 ngày nhiều đơn nhất. Không suy ra giao đúng hạn khi chưa có mốc giao thực tế đầy đủ.
- CRM là ảnh chụp toàn bộ hồ sơ hiện tại. Tương tác là số sự kiện, không phải người dùng duy nhất hoặc tỷ lệ chuyển đổi.

Chưa thêm lợi nhuận/giá vốn, hao hụt hoa, ROAS, tỷ lệ khách quay lại: cần lịch sử giá vốn/tồn hoa, chi phí quảng cáo, nhận diện khách và định nghĩa đủ tin cậy trước khi triển khai.

## Kiểm thử

- `node --import tsx scripts/test-store-analytics.ts`: SQL thật trên các bảng TEMPORARY của kết nối MySQL local; không sửa bảng hiện có. Kiểm tra phân tách tenant, biên ngày, kỳ trước, nhiều phiếu thu, hoàn tiền, đơn hủy, đơn cũ và miễn phí, danh mục/sản phẩm, lịch giao và dữ liệu rỗng. Sinh fixture tại `.local/analytics-fixture.json`.
- `node scripts/test-store-analytics-ui.mjs`: Chromium và WebKit, API được mock bằng fixture, không gửi đơn/thanh toán/email; kiểm tra số liệu, bộ lọc, CSV, biểu đồ, focus không nháy, lỗi/thử lại, dữ liệu rỗng và 1440/1024/390/320px.
- `npm run typecheck` và production build.
