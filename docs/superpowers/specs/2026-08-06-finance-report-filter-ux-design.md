# Thiết kế làm rõ bộ lọc Báo cáo quỹ

Ngày: 2026-08-06

Trạng thái: Đã được người dùng duyệt ngày 2026-08-06

## 1. Mục tiêu

Làm rõ hai khái niệm đang bị đặt gần nhau trên tab **Báo cáo quỹ**:

- **Khoảng báo cáo** quyết định giao dịch nào được đưa vào báo cáo.
- **Cách tổng hợp** quyết định cùng tập giao dịch đó được chia thành từng ngày hay gộp theo tháng.

Thay đổi phải sửa lỗi múi giờ của preset **Quý này**, thêm đường tắt xem đúng một ngày, tránh hiển thị một preset như đã áp dụng khi báo cáo bên dưới vẫn thuộc kỳ cũ, và giữ lựa chọn cách tổng hợp sau khi tải lại.

## 2. Phạm vi

### Trong phạm vi

- Đổi phân cấp và nội dung nhãn trong `ReportTab`.
- Thêm preset **Hôm nay**.
- Tự tải báo cáo khi chọn một preset nhanh.
- Giữ luồng nhập tay `Từ ngày`, `Đến ngày`, sau đó bấm **Xem báo cáo**.
- Sửa cách tính preset ngày theo lịch địa phương, không chuyển qua UTC.
- Giữ lựa chọn cách tổng hợp khi đổi hoặc tải khoảng báo cáo.
- Đóng modal chi tiết cũ khi khoảng nhập hoặc khoảng đã tải thay đổi.
- Bổ sung kiểm thử hồi quy cho preset, trạng thái áp dụng và lựa chọn cách tổng hợp.

### Ngoài phạm vi

- Thay đổi API hoặc cách backend tính tổng thu, tổng chi và số dư.
- Thay đổi bảng chi tiết giao dịch, phân trang hoặc quyền truy cập.
- Tự tải khi người dùng đang gõ ngày thủ công.
- Thiết kế lại toàn bộ trang Tài chính hoặc thay đổi hệ màu, font, điều hướng.

## 3. Các phương án đã cân nhắc

### Phương án A: Preset nhanh tự tải báo cáo

Khi bấm **Hôm nay**, **Tháng này**, **Tháng trước**, **Quý này**, **Năm nay** hoặc **Năm trước**, giao diện cập nhật hai ô ngày và tải đúng khoảng đó ngay lập tức.

Ưu điểm:

- Một thao tác cho hành động có chủ đích rõ ràng.
- Không còn trạng thái preset sáng nhưng dữ liệu chưa áp dụng.
- Phù hợp kỳ vọng phổ biến của bộ lọc nhanh.

Nhược điểm:

- Mỗi lần bấm preset tạo một request.
- Cần cho handler tải báo cáo nhận khoảng ngày tường minh để không đọc state cũ của React.

### Phương án B: Preset chỉ điền ngày, trạng thái áp dụng hiển thị riêng

Giữ nút **Xem báo cáo** cho mọi thay đổi, nhưng preset chỉ sáng khi `reportRange` khớp với hai ô ngày và hiện nhãn **Chưa áp dụng** khi đang lệch.

Ưu điểm:

- Không tạo request ngoài ý muốn.
- Thay đổi kỹ thuật nhỏ hơn.

Nhược điểm:

- Vẫn cần hai thao tác cho preset nhanh.
- Người dùng có thể tiếp tục quên bấm **Xem báo cáo**.

### Phương án C: Bỏ preset, chỉ giữ hai ô ngày

Ưu điểm là giao diện ít điều khiển hơn, nhưng làm chậm các tác vụ kế toán lặp lại. Phương án này bị loại.

### Lựa chọn

Chọn **Phương án A**. Ngày nhập tay vẫn cần nút **Xem báo cáo** để tránh gọi API khi người dùng chưa nhập xong.

## 4. Thiết kế giao diện

### 4.1 Khoảng báo cáo

Đặt nhãn nhóm **Khoảng báo cáo** phía trên các preset. Thứ tự preset:

1. Hôm nay
2. Tháng này
3. Tháng trước
4. Quý này
5. Năm nay
6. Năm trước

Hai ô `Từ ngày` và `Đến ngày` giữ nguyên thứ tự, nhãn và nút **Xem báo cáo**. Preset chỉ dùng màu đang chọn khi:

- Hai ô ngày khớp preset.
- `reportRange` khớp preset.
- Báo cáo hiện tại không phải dữ liệu cũ của một khoảng khác.

Trong lúc request preset đang chạy, các preset và nút tải bị vô hiệu hóa bằng trạng thái loading hiện có. Nếu tải thất bại, hai ô ngày giữ giá trị người dùng vừa chọn, preset không được hiển thị như đã áp dụng và dữ liệu cũ tiếp tục có cảnh báo tải lại.

### 4.2 Cách tổng hợp

Đổi nhãn nhóm thành **Cách tổng hợp**. Hai lựa chọn hiển thị:

- **Từng ngày**: một dòng cho mỗi ngày có ít nhất một giao dịch đã ghi sổ.
- **Gộp theo tháng**: một dòng cho mỗi tháng có ít nhất một giao dịch đã ghi sổ.

Hai lựa chọn chỉ thay đổi bảng đang hiển thị từ response hiện có. Chúng không đổi khoảng báo cáo, không đổi ba thẻ tổng quan và không gọi API.

Lựa chọn hiện tại được giữ nguyên khi:

- Người dùng sửa ngày nhập tay.
- Người dùng chọn preset.
- Báo cáo mới tải thành công.
- Báo cáo tải thất bại.

### 4.3 Trạng thái chi tiết giao dịch

Modal chi tiết phải đóng khi khoảng nhập hoặc `reportRange` thay đổi. Việc đóng modal được xử lý bằng effect tường minh thay vì remount toàn bộ `ReportTabContent`, nhờ đó `breakdownMode` không bị đặt lại ngoài ý muốn.

## 5. Tính ngày theo lịch địa phương

Tách logic preset thành một helper thuần, nhận `Date` hiện tại và trả về các khoảng `YYYY-MM-DD`.

Quy tắc:

- Dùng `getFullYear()`, `getMonth()` và `getDate()` để lấy lịch địa phương.
- Không dùng `toISOString().slice(0, 10)` cho ngày được tạo bằng múi giờ địa phương.
- **Hôm nay**: từ hôm nay đến hôm nay.
- **Tháng này**: ngày đầu đến ngày cuối tháng hiện tại.
- **Tháng trước**: ngày đầu đến ngày cuối tháng trước.
- **Quý này**: ngày đầu quý hiện tại đến hôm nay.
- **Năm nay**: ngày 01/01 đến hôm nay.
- **Năm trước**: ngày 01/01 đến ngày 31/12 của năm trước.

Ví dụ tại Asia/Saigon ngày 06/08/2026:

- Hôm nay: `2026-08-06` đến `2026-08-06`.
- Quý này: `2026-07-01` đến `2026-08-06`.
- Năm nay: `2026-01-01` đến `2026-08-06`.

## 6. Luồng dữ liệu

### Chọn preset

1. `ReportTab` lấy khoảng từ helper preset.
2. Giao diện cập nhật `reportFrom` và `reportTo`.
3. `ReportTab` gọi handler với chính khoảng vừa chọn.
4. `Finance` gọi `fetchFinanceReport(from, to, { includeDaily: true })`.
5. Khi thành công, `report` và `reportRange` được cập nhật cùng khoảng.
6. Preset được hiển thị là đã áp dụng và bảng giữ cách tổng hợp người dùng đang chọn.

### Nhập ngày thủ công

1. Người dùng thay đổi một hoặc cả hai ô ngày.
2. Báo cáo cũ được đánh dấu không khớp qua `reportMatchesFilters` hiện có.
3. Các hành động mở chi tiết bị khóa.
4. Người dùng bấm **Xem báo cáo**.
5. Handler tải khoảng hiện có trong state và cập nhật `reportRange` khi thành công.

## 7. Nội dung đa ngôn ngữ

Bổ sung khóa cho cả tiếng Việt và tiếng Anh:

- `reportPeriod`: Khoảng báo cáo / Report period
- `today`: Hôm nay / Today
- `aggregationMode`: Cách tổng hợp / Group results
- `byDay`: Từng ngày / By day
- `byMonth`: Gộp theo tháng / Group by month

Các nhãn cũ đang được dùng ở nơi khác không được đổi nếu không thuộc `financePage`.

## 8. Kiểm thử

### Helper preset

- Hôm nay trả cùng ngày ở hai đầu.
- Tháng này và tháng trước xử lý đúng cuối tháng.
- Quý này tại múi giờ UTC+7 bắt đầu đúng ngày đầu quý.
- Năm nay tại thời điểm đầu ngày địa phương kết thúc đúng hôm nay.
- Chuyển năm ở tháng 1 trả tháng trước và năm trước chính xác.

### ReportTab

- Hiển thị nhãn **Khoảng báo cáo** và **Cách tổng hợp**.
- Bấm **Hôm nay** cập nhật hai ô và tải đúng một ngày.
- Bấm preset tải bằng khoảng tường minh, không dùng state cũ.
- Preset chỉ có trạng thái áp dụng khi `reportRange` khớp.
- Sửa ngày thủ công không tự gọi API.
- Chuyển sang **Gộp theo tháng**, sau đó đổi hoặc tải kỳ mới, lựa chọn vẫn được giữ.
- Modal chi tiết đang mở đóng khi khoảng thay đổi.

### Hồi quy

- Báo cáo vẫn yêu cầu `includeDaily: true`.
- Tổng quan và drill-down dùng đúng `reportRange` đã tải.
- Test frontend và backend tài chính hiện có tiếp tục đạt.
- Typecheck và build thành công.

## 9. Tiêu chí chấp nhận

1. Người dùng phân biệt được khoảng báo cáo với cách tổng hợp qua nhãn nhóm.
2. Có thể xem báo cáo của hôm nay bằng một lần bấm.
3. Preset không bao giờ hiển thị là đã áp dụng khi dữ liệu bên dưới thuộc kỳ khác.
4. Quý này ở Asia/Saigon không lấy thừa ngày cuối quý trước.
5. Cách tổng hợp không bị đặt lại sau khi chọn hoặc tải kỳ mới.
6. Ngày nhập tay không tự tạo request trước khi bấm **Xem báo cáo**.
7. Không thay đổi hợp đồng API và kết quả tính toán backend.
