# Thiết kế thay logo trung tâm qua URL

## Mục tiêu

Thay mọi hình logo trung tâm hiện tại bằng logo Thiên Uy English Center từ URL:

`https://i.postimg.cc/5NPyBH5z/8f924ba5-ebef-4ae7-837e-808057d68243.png`

Chỉ thay hình ảnh nhận diện. Giữ nguyên chữ “EduTrack”, kích thước hiển thị, vị trí, hiệu ứng và bố cục hiện có.

## Phạm vi

Logo mới được dùng trực tiếp qua URL ở năm vị trí:

1. Logo trên thanh điều hướng bên (`src/app/Sidebar.tsx`).
2. Logo góc màn hình đăng nhập (`src/pages/login/Login.tsx`).
3. Logo trên màn hình tải React (`src/components/common/LoadingScreen.tsx`).
4. Logo trên màn hình tải ban đầu trong `index.html`.
5. Logo trên trang bảo trì (`src/pages/common/MaintenancePage.tsx`).

File `public/maintenance-logo.png` không còn được giao diện tham chiếu sau thay đổi. Không xóa file trong phạm vi công việc này để tránh một thao tác phá hủy không cần thiết.

## Phương án kỹ thuật

Các component React dùng một hằng số URL thương hiệu dùng chung để tránh lặp chuỗi và giúp lần thay logo tiếp theo chỉ cần sửa một nơi. `index.html` dùng trực tiếp cùng URL vì màn hình tải này xuất hiện trước khi ứng dụng React được khởi tạo và không thể nhập module TypeScript của ứng dụng.

Mỗi thẻ `img` giữ nguyên các lớp CSS hiện tại. Thuộc tính `alt` mô tả logo được cập nhật thành “Thiên Uy English Center” hoặc “Thiên Uy English Center Logo” tùy ngữ cảnh.

## Hành vi lỗi

Nếu dịch vụ Postimg hoặc kết nối mạng không tải được ảnh, trình duyệt hiển thị nội dung `alt`; ứng dụng vẫn tiếp tục hoạt động. Không thêm cơ chế tải lại hoặc ảnh dự phòng vì người dùng đã chọn URL bên ngoài làm nguồn duy nhất.

## Kiểm thử và tiêu chí hoàn tất

- Cả năm vị trí dùng đúng URL mới.
- Không còn tham chiếu đến URL logo Postimg cũ hoặc `/maintenance-logo.png` trong mã giao diện.
- Chữ, kích thước, vị trí, hiệu ứng và bố cục hiện có không thay đổi.
- Kiểm thử trang bảo trì được cập nhật theo nguồn ảnh mới.
- Typecheck, kiểm thử liên quan và build đều thành công.
- Kiểm tra nhanh giao diện xác nhận logo hiển thị đúng ở các trạng thái chính.
