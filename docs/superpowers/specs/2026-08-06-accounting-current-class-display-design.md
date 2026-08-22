# Hiển thị tên lớp và giáo viên trong bảng Công nợ

## Mục tiêu

Thay cột **Lớp hiện tại** trên trang Tài chính/Công nợ từ mã tài liệu Firestore khó nhận biết sang nhãn thân thiện theo định dạng `Tên lớp - Tên giáo viên`, ví dụ `A1 - Cô Lan`.

## Hiện trạng và nguyên nhân gốc

`StudentFinanceWorkspace` nhận `classes` và đã tạo bảng tra cứu từ `classId` sang tên lớp. Tuy nhiên, `Finance` tải danh sách lớp và giáo viên nhưng không truyền chúng vào `StudentFinanceWorkspace`. Prop `classes` vì thế dùng giá trị mặc định là mảng rỗng, khiến cột rơi về nhánh dự phòng và hiển thị `currentClassId`.

## Phương án đã chọn

Tận dụng dữ liệu tham chiếu mà `Finance` đã tải sẵn:

- Truyền cả `classes` và `teachers` từ `Finance` xuống `StudentFinanceWorkspace`.
- Trong `StudentFinanceWorkspace`, tạo map theo ID lớp và dùng helper hiện có `formatClassNameWithTeacher` để tạo nhãn thống nhất với các phần khác của trang Tài chính.
- Không thêm API, không đọc Firestore theo từng dòng và không thay đổi read model công nợ.

Phương án này có phạm vi nhỏ nhất, không phát sinh request mới và tái sử dụng quy tắc định dạng đã có của dự án.

## Luồng dữ liệu

1. `Finance` tải resource `classes` và `teachers` qua kênh `finance` khi tab Công nợ hoạt động.
2. `Finance` truyền hai danh sách này vào `StudentFinanceWorkspace`.
3. `StudentFinanceWorkspace` tạo `classLabelById` bằng `formatClassNameWithTeacher`.
4. Mỗi dòng tra `row.currentClassId` trong map và hiển thị nhãn đã định dạng.

## Quy tắc hiển thị và lỗi dữ liệu

- Có lớp và giáo viên: hiển thị `Tên lớp - Tên giáo viên`.
- Có lớp và `teacherId` nhưng không tìm thấy tên giáo viên: dùng hành vi sẵn có của helper, hiển thị `Tên lớp - GV`.
- Có lớp nhưng không gán giáo viên: hiển thị tên lớp.
- Không có `currentClassId`, hoặc ID không còn tồn tại trong danh sách tham chiếu: hiển thị `Không xác định`.
- Không hiển thị ID Firestore cho người dùng trong mọi trường hợp.

## Kiểm thử

- Test tích hợp `Finance.studentWorkspace.test.tsx` phải thất bại trước khi sửa và chứng minh `Finance` truyền đúng `classes` cùng `teachers` vào workspace.
- Test component `StudentFinanceWorkspace.test.tsx` xác nhận cột hiển thị `CSE 301 - Cô Lan` và không hiển thị `c1`.
- Test component xác nhận ID lớp không tìm thấy được thay bằng `Không xác định`, không bị lộ ra giao diện.
- Chạy riêng hai file test liên quan, sau đó chạy typecheck và bộ test hồi quy phù hợp.

## Ngoài phạm vi

- Không thay đổi cấu trúc dữ liệu Firestore hoặc read model `AccountingStudentSummary`.
- Không đổi bộ lọc mã lớp trong yêu cầu này.
- Không thay đổi cách đặt tên lớp hoặc hồ sơ giáo viên.
