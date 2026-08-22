# Thiết kế bộ lọc lịch khi tạo học sinh

**Ngày:** 2026-07-24
**Trạng thái:** Chờ người dùng duyệt đặc tả
**Phạm vi:** Modal thêm học sinh tại khu vực quản lý học sinh

## 1. Bối cảnh

Khi thêm học sinh, Admin hoặc Office hiện chọn lớp từ một danh sách chỉ hiển thị tên lớp và giáo viên. Người thao tác phải nhớ hoặc mở nơi khác để kiểm tra lịch học trước khi chọn đúng lớp.

Dữ liệu lớp đang tồn tại ở hai dạng:

- dạng hiện tại: `weeklySessions`, mỗi buổi có `dayOfWeek`, `startTime`, `endTime` và phòng học;
- dạng cũ: `daysOfWeek`, `startTime` và chuỗi `schedule`.

Helper `getWeeklyClassSessions` trong `shared/classSchedule.ts` đã chuẩn hóa cả hai dạng thành danh sách buổi học thống nhất.

## 2. Mục tiêu

1. Khi thêm học sinh, Admin hoặc Office có thể lọc lớp theo thứ trong tuần.
2. Người dùng có thể lọc tiếp theo giờ bắt đầu chính xác, ví dụ `17:30`.
3. Khi chọn cả thứ và giờ, lớp chỉ khớp nếu cùng một buổi học thỏa cả hai điều kiện.
4. Mỗi lựa chọn lớp hiển thị lịch học cùng tên lớp và giáo viên để người dùng xác nhận trước khi lưu.
5. Lớp dùng dữ liệu lịch mới và dữ liệu lịch cũ đều được lọc đúng.
6. Luồng sửa học sinh và dữ liệu gửi lên API không thay đổi.

## 3. Giao diện

Trong modal thêm học sinh, ngay phía trên ô chọn lớp, thêm hai ô chọn:

- `Tất cả các thứ`: các lựa chọn từ Thứ 2 đến Chủ nhật;
- `Tất cả giờ bắt đầu`: danh sách giờ bắt đầu duy nhất lấy từ các lớp có thể chọn, sắp xếp tăng dần theo định dạng `HH:mm`.

Hai ô nằm trên cùng một hàng ở màn hình đủ rộng và xuống hai hàng trên màn hình hẹp. Bộ lọc chỉ xuất hiện khi thêm học sinh, không xuất hiện khi sửa học sinh.

Ô chọn lớp tiếp tục dùng control `select` hiện có. Mỗi lựa chọn có dạng:

```text
Tên lớp - Giáo viên - Thứ 3 17:30-19:00, Thứ 5 17:30-19:00
```

Nếu không có lớp phù hợp, ô chọn lớp chỉ hiển thị lựa chọn vô hiệu hóa `Không có lớp phù hợp`.

## 4. Hành vi lọc

Trạng thái bộ lọc là cục bộ trong `StudentFormModal`:

```ts
type DayFilter = 'all' | number;
type StartTimeFilter = 'all' | string;
```

Quy tắc:

1. Không chọn bộ lọc: giữ nguyên danh sách `sortedClasses`.
2. Chỉ chọn thứ: lớp khớp nếu có ít nhất một buổi vào thứ đã chọn.
3. Chỉ chọn giờ: lớp khớp nếu có ít nhất một buổi bắt đầu đúng giờ đã chọn.
4. Chọn cả hai: lớp khớp nếu có ít nhất một buổi có đồng thời đúng thứ và đúng giờ.
5. So sánh giờ theo giá trị chuẩn `HH:mm`; giờ không hợp lệ hoặc trống không tạo lựa chọn lọc.
6. Thứ hoặc giờ không có lịch hợp lệ không làm modal lỗi; lớp đó chỉ không khớp với bộ lọc tương ứng.

Ví dụ: lớp có Thứ 2 lúc `17:30` và Thứ 3 lúc `18:30` không được xem là khớp với bộ lọc Thứ 3 + `17:30`.

Khi thay đổi bộ lọc:

- nếu lớp đang chọn vẫn còn trong kết quả, giữ nguyên lựa chọn;
- nếu lớp đang chọn không còn khớp, đặt `formData.classId` về rỗng;
- không thay đổi khối lớp đã nhập thủ công khi xóa lựa chọn lớp do bộ lọc;
- khi đóng rồi mở lại modal thêm học sinh, bộ lọc trở về `Tất cả`.

## 5. Kiến trúc và dữ liệu

Tạo một helper thuần, dành riêng cho bộ lọc chọn lớp của học sinh, trong `src/lib/classes`. Helper nhận một lớp, bộ lọc thứ và bộ lọc giờ, gọi `getWeeklyClassSessions` để lấy các buổi đã chuẩn hóa và trả về `boolean`.

`StudentFormModal` chịu trách nhiệm:

- giữ trạng thái hai bộ lọc;
- tạo danh sách giờ bắt đầu duy nhất từ `sortedClasses`;
- tạo danh sách lớp đã lọc bằng helper thuần;
- render nhãn lịch đã bản địa hóa cho từng lựa chọn;
- xóa `classId` khi người dùng đổi bộ lọc và lựa chọn hiện tại không còn hợp lệ.

Không thay đổi:

- kiểu `Class`;
- dữ liệu form học sinh;
- payload tạo/cập nhật học sinh;
- API hoặc Firestore;
- cách sắp xếp lớp theo giáo viên rồi tên lớp.

## 6. Bản địa hóa

Thêm khóa dịch tiếng Việt và tiếng Anh trong nhóm `students.modal` cho:

- nhãn lọc theo thứ;
- nhãn lọc theo giờ bắt đầu;
- lựa chọn tất cả;
- thông báo không có lớp phù hợp.

Nhãn thứ trong tuần dùng đúng thứ tự và ngôn ngữ hiện có của ứng dụng. Không hard-code chuỗi tiếng Việt trong component.

## 7. Xử lý lỗi và trường hợp biên

- `weeklySessions` rỗng hoặc thiếu: helper dùng lịch legacy qua `getWeeklyClassSessions`.
- Lớp không có lịch hợp lệ: vẫn xuất hiện khi chưa lọc, nhưng không xuất hiện sau khi áp dụng thứ hoặc giờ.
- Nhiều buổi cùng giờ: giờ bắt đầu chỉ xuất hiện một lần trong bộ lọc.
- Nhiều buổi cùng thứ: lớp chỉ xuất hiện một lần trong danh sách lớp.
- Danh sách lớp thay đổi khi modal đang mở: kết quả lọc được tính lại từ props mới.
- Lớp được chọn biến mất khỏi danh sách: lựa chọn được xóa trước khi gửi form.

## 8. Kiểm thử

### 8.1 Unit

Kiểm thử helper bằng dữ liệu thật, không mock:

- không có bộ lọc thì lớp khớp;
- lọc đúng và sai theo thứ;
- lọc đúng và sai theo giờ bắt đầu;
- kết hợp thứ và giờ phải khớp trên cùng một buổi;
- hỗ trợ `weeklySessions`;
- hỗ trợ lịch legacy;
- lịch thiếu hoặc không hợp lệ không gây lỗi.

### 8.2 Component

Mở modal thêm học sinh và kiểm tra:

- hai bộ lọc được hiển thị;
- danh sách giờ được loại trùng và sắp xếp;
- chọn thứ hoặc giờ cập nhật danh sách lớp;
- chọn cả hai điều kiện cho kết quả đúng;
- đổi bộ lọc xóa lớp đã chọn nếu lớp không còn phù hợp;
- nhãn lựa chọn lớp hiển thị lịch học;
- trạng thái không có kết quả được hiển thị;
- modal sửa học sinh không hiển thị bộ lọc.

### 8.3 Regression

- tạo học sinh vẫn gửi đúng `classId`;
- chọn lớp vẫn tự điền khối lớp như hiện tại;
- test hiện có của `StudentActionModals` vẫn pass;
- typecheck và build toàn dự án pass.

## 9. Tiêu chí nghiệm thu

1. Admin hoặc Office mở modal thêm học sinh và lọc được theo một thứ bất kỳ.
2. Danh sách giờ chỉ gồm các giờ bắt đầu thực tế của lớp và được sắp xếp tăng dần.
3. Kết hợp thứ và giờ không tạo kết quả khớp chéo giữa hai buổi khác nhau.
4. Danh sách lớp sau lọc vẫn theo thứ tự giáo viên rồi tên lớp.
5. Mỗi lựa chọn lớp hiển thị tên lớp, giáo viên và lịch học.
6. Không thể lưu nhầm `classId` đã bị loại khỏi kết quả lọc.
7. Lịch lớp mới và legacy đều hoạt động.
8. Luồng sửa học sinh không thay đổi.
9. Unit test, component test, typecheck và build liên quan đều pass.

## 10. Ngoài phạm vi

- Thay `select` bằng combobox hoặc bảng tìm kiếm nâng cao.
- Lọc theo khoảng giờ, buổi sáng/chiều/tối, phòng học hoặc khối lớp.
- Áp dụng bộ lọc cho chuyển lớp, nhập học thử hoặc các màn hình khác.
- Thay đổi cấu trúc lịch lớp, API hoặc dữ liệu Firestore.
