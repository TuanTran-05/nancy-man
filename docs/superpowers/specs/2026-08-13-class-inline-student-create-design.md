# Thiết kế: Thêm nhanh học sinh ngay trong trang lớp

**Ngày:** 2026-08-13  
**Trạng thái:** Đã duyệt phương án, chờ duyệt tài liệu

## Mục tiêu

Cho phép Admin, Office và Teacher mở biểu mẫu thêm học sinh ngay trong trang chi tiết lớp. Trang không được chuyển sang `/students`; lớp đang xem được chọn sẵn và cố định cho thao tác thêm nhanh.

## Hiện trạng

- `ClassHeader` chỉ hiện nút khi `!isAdmin && !isArchived`. Vì vậy Admin bị loại bằng một điều kiện phủ định khó thể hiện đúng quyền nghiệp vụ.
- Source và test hiện tại cho thấy Office đã được phép thấy nút, dù môi trường người dùng đang xem không thể hiện như vậy.
- `ClassDetail` xử lý nút bằng cách điều hướng sang `/students` và truyền `classId` trong router state.
- `Students` đọc router state rồi gọi `useStudentActionModals().openCreate({ classId })` để mở modal với lớp được chọn sẵn.
- API tạo học sinh đã cho phép `admin`, `office` và `teacher`; không cần thay đổi phân quyền backend.

## Trải nghiệm đã duyệt

1. Nút “Thêm học sinh” xuất hiện trong vùng thao tác đầu trang lớp cho Admin, Office và Teacher.
2. Nút tiếp tục bị ẩn khi lớp đã lưu trữ (`archived`). Trạng thái lớp khác giữ nguyên hành vi hiện tại.
3. Khi bấm nút, URL vẫn là `/classes/:classId` và tab đang xem không đổi.
4. Modal thêm học sinh hiện có mở ngay trên trang lớp.
5. Lớp hiện tại được hiển thị dưới dạng giá trị cố định trong luồng thêm nhanh. Người dùng không thể vô tình chọn lớp khác; muốn thêm vào lớp khác thì mở lớp đó hoặc dùng trang Students.
6. Khi tạo thành công, modal đóng và roster/số lượng học sinh của lớp được tải lại ngay tại chỗ.

## Thiết kế kỹ thuật

### Quyền hiển thị

`ClassHeader` nhận prop `canAddStudent` thay vì suy luận quyền thêm học sinh từ `!isAdmin`. `ClassDetail` tính prop này bằng danh sách vai trò được phép: `admin`, `office`, `teacher`. `isAdmin` vẫn được giữ riêng cho những thông tin chỉ Admin được xem, ví dụ tiền lương theo buổi.

### Modal thêm nhanh

Tái sử dụng `useStudentActionModals` và `StudentFormModal`; không tạo một quy trình lưu học sinh thứ hai. Controller `openCreate` được mở rộng để nhận chế độ cố định lớp cùng `classId`.

Trong chế độ cố định lớp, `StudentFormModal`:

- không hiển thị bộ lọc lịch học và dropdown chọn lớp;
- hiển thị tên lớp hiện tại dưới dạng chỉ đọc;
- vẫn gửi `formData.classId` qua đúng `/api/v1/students/create`;
- giữ nguyên camera, upload ảnh, validation, cảnh báo lớp đã kết khóa và thông báo lỗi/thành công.

`ClassDetail` khởi tạo modal với duy nhất `classData` hiện tại, do đó không cần tải toàn bộ danh sách lớp và giáo viên chỉ để phục vụ thao tác nhanh.

### Làm mới dữ liệu

`useClassData` công khai callback `refreshStudents` hiện có. `ClassDetail` truyền callback này vào `useStudentActionModals.onChanged`. Sau khi API tạo thành công, roster được tải lại chủ động; sự kiện invalidation `students` từ backend tiếp tục đóng vai trò đồng bộ dự phòng.

### Điều hướng cũ

Handler trong `ClassDetail` không còn gọi `navigate('/students', ...)`. Cơ chế đọc `location.state.classId` trong `Students` được giữ để tương thích với các điểm gọi khác hoặc router state cũ; nó không còn được dùng bởi nút trong trang lớp.

## Xử lý lỗi và trường hợp biên

- Lớp archived: không hiện nút.
- Lớp đã kết khóa: tiếp tục đi qua `useClosedCourseJoin`; không bỏ qua xác nhận hiện tại.
- Tạo thất bại: modal ở lại, hiển thị toast lỗi và không thay đổi roster.
- Đóng modal: dừng camera, xóa dữ liệu form và mở lại vẫn chọn đúng lớp hiện tại.

## Kiểm thử

- `ClassHeader`: Admin, Office và Teacher có `canAddStudent=true` đều thấy nút; `archived` không thấy nút.
- `StudentActionModals`: `openCreate` với lớp cố định mở modal, hiển thị đúng tên lớp và không có dropdown chọn lớp.
- Luồng trang lớp: bấm nút gọi controller modal với `classData.id`, không gọi điều hướng sang `/students`.
- Tạo thành công: request giữ đúng `classId`, gọi `refreshStudents` và đóng modal.
- Chạy các test hiện có của `ClassHeader`, `StudentActionModals`, `useClassData`, sau đó chạy typecheck/build liên quan.

## Ngoài phạm vi

- Không thay đổi API, schema học sinh hoặc quyền backend.
- Không thay đổi công cụ điểm danh và báo cáo ngày của Admin/Office.
- Không thêm import Excel vào trang lớp.
- Không thay đổi luồng sửa, chuyển lớp, đổi trạng thái hoặc xóa học sinh.
