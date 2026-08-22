# Thiết kế giao diện modal Tạo công nợ

## Mục tiêu

Modal Tạo công nợ phải xuất hiện gần đầu màn hình ngay khi mở và vẫn dễ thao tác khi dữ liệu xem trước dài. Người dùng không phải cuộn xuống giữa trang để tìm tiêu đề hoặc nút xác nhận.

## Phạm vi

- Chỉ thay đổi bố cục và khả năng cuộn của `GenerateLedgersDialog`.
- Không thay đổi API, dữ liệu xem trước, logic tạo công nợ hoặc nội dung bản dịch.
- Giữ nguyên các trạng thái đang tải, sẵn sàng, lỗi và hoàn tất một phần.

## Bố cục

- Lớp phủ chiếm toàn bộ viewport và canh modal gần mép trên với khoảng trống an toàn.
- Modal dùng bố cục cột, chiều cao tối đa theo viewport và không tự cuộn toàn khối.
- Header chứa tiêu đề, không cuộn theo danh sách.
- Vùng nội dung giữa cuộn dọc độc lập; bao gồm tiến trình, lỗi, các thẻ tổng quan, bảng lớp, cảnh báo công nợ trùng và lỗi xử lý.
- Footer chứa nút Đóng và Tạo công nợ, luôn hiển thị ở đáy modal.
- Header và footer có đường phân cách nhẹ để người dùng nhận biết vùng cố định.

## Responsive và khả năng đọc

- Modal giữ chiều rộng tối đa hiện tại trên desktop.
- Các thẻ tổng quan tự chuyển từ một cột trên màn hình nhỏ sang nhiều cột trên màn hình rộng.
- Bảng được đặt trong vùng cuộn ngang riêng để không làm modal rộng hơn viewport.
- Chuỗi định danh dài trong cảnh báo trùng được ngắt dòng để không gây tràn ngang.

## Hành vi và kiểm thử

- Khi mở modal, tiêu đề phải hiện ở vùng đầu viewport.
- Với danh sách dài, chỉ vùng nội dung giữa có thanh cuộn; footer vẫn nhìn thấy.
- Nút Tạo công nợ vẫn bị vô hiệu hóa theo điều kiện hiện tại.
- Kiểm thử component xác nhận cấu trúc vùng header, nội dung cuộn và footer; sau đó chạy typecheck, test liên quan và build.
