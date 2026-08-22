# Thiết kế ngày bắt đầu làm và thâm niên nhân sự

## Mục tiêu

Bổ sung vào modal hồ sơ nhân sự của Admin Dashboard hai thông tin chỉ đọc:

- **Bắt đầu làm:** ngày tạo tài khoản nhân sự.
- **Thâm niên:** khoảng thời gian theo lịch từ ngày tạo tài khoản đến ngày hiện tại, hiển thị đủ năm, tháng và ngày.

Áp dụng cho mọi vai trò nhân sự: `teacher`, `level_manager`, `office` và `accounting`.

## Phạm vi

Trong phạm vi:

- Lưu ngày tạo tài khoản mới vào `users.createdAt`.
- Backfill `users.createdAt` cho tài khoản cũ từ `Firebase Auth UserRecord.metadata.creationTime`.
- Đưa `createdAt` vào projection `admin-dashboard-summary`.
- Hiển thị ngày bắt đầu và thâm niên trong `StaffProfileModal`.
- Hỗ trợ tiếng Việt, tiếng Anh và kiểm thử đầy đủ.

Ngoài phạm vi:

- Chỉnh sửa thủ công ngày bắt đầu.
- Dùng `allowed_teachers.addedAt` làm ngày thay thế.
- Lưu kết quả thâm niên dẫn xuất vào Firestore.
- Hiển thị hai trường mới ngoài modal hồ sơ nhân sự của Admin Dashboard.

## Phương án đã chọn

`users.createdAt` là nguồn dữ liệu chuẩn sau khi được khởi tạo từ Firebase Auth:

1. Tài khoản mới ghi `metadata.creationTime` vào `users/{uid}` ngay trong luồng tạo tài khoản.
2. Tài khoản cũ được backfill một lần bằng script quản trị đọc Firebase Auth theo trang.
3. Dashboard tiếp tục đọc projection Firestore hiện có, không gọi Firebase Auth khi mở modal.

Phương án này giữ request dashboard nhanh và cung cấp contract ổn định cho frontend.

Các phương án không chọn:

- Tra Firebase Auth mỗi lần tải dashboard: chính xác nhưng chậm và tăng độ phức tạp.
- Backfill trong request đọc: trộn luồng đọc với ghi và khó kiểm soát lỗi vận hành.

## Mô hình dữ liệu và contract

Document `users/{uid}` có thêm trường:

```ts
createdAt: string; // ISO 8601 UTC, ví dụ 2023-07-15T03:20:10.000Z
```

Quy tắc dữ liệu:

- Ưu tiên `UserRecord.metadata.creationTime`.
- Nếu luồng tạo mới không nhận được thời điểm hợp lệ, dùng thời điểm server hiện tại dưới dạng ISO UTC.
- `createdAt` là bất biến khi cập nhật hồ sơ, đổi mật khẩu, chặn hoặc mở chặn.
- Backfill chỉ bổ sung document thiếu `createdAt`; không ghi đè giá trị đã có.

`projectedTeacherDoc` và `AdminStaffProfile` bổ sung:

```ts
createdAt?: string;
```

Projection trả trường này cho cả bốn vai trò và không làm lộ thêm trường nội bộ.

## Luồng dữ liệu

```text
Firebase Auth createUser
  -> UserRecord.metadata.creationTime
  -> users/{uid}.createdAt
  -> admin-dashboard-summary
  -> AdminStaffProfile.createdAt
  -> StaffProfileModal
  -> định dạng ngày và tính thâm niên
```

Tài khoản cũ:

```text
Firebase Auth listUsers theo trang
  -> đọc users/{uid}
  -> bỏ qua document đã có createdAt
  -> ghi metadata.creationTime cho document đang thiếu
  -> báo cáo tổng kết
```

## Backfill tài khoản hiện có

Script quản trị:

- Mặc định dry-run; chỉ ghi khi có `--apply`.
- Phân trang Firebase Auth đến khi hết `pageToken`.
- Chỉ xét document có vai trò `teacher`, `level_manager`, `office` hoặc `accounting`.
- Bỏ qua tài khoản không có document Firestore, ngoài phạm vi, thiếu hoặc sai `creationTime`, hoặc đã có `createdAt`.
- Ghi theo batch dưới giới hạn Firestore.
- Báo các bộ đếm `scanned`, `eligible`, `wouldUpdate` hoặc `updated`, `alreadySet`, `missingUserDoc`, `outOfScopeRole`, `missingCreationTime` và `errors`.
- Lỗi đọc trang Auth hoặc commit batch làm script thoát với exit code khác `0`.
- Chạy lại an toàn vì không ghi đè `createdAt`.

## Quy tắc tính thâm niên

Tách logic thành helper thuần:

```ts
type StaffTenure = {
  years: number;
  months: number;
  days: number;
};

function calculateStaffTenure(createdAt: string | undefined, asOf: Date): StaffTenure | null;
```

Quy tắc:

1. Chuyển `createdAt` và `asOf` thành ngày lịch tại `Asia/Ho_Chi_Minh`.
2. Bỏ giờ, phút, giây và mili giây.
3. Tính theo lịch thành năm, tháng và ngày; không chia tổng số ngày cho 365 hoặc 30.
4. Trả số nguyên không âm và luôn giữ đủ ba đơn vị.
5. Trả `null` nếu ngày thiếu, sai định dạng hoặc nằm trong tương lai.
6. Tính lại khi modal render; database chỉ lưu ngày gốc.

## Thiết kế giao diện

Trong `StaffProfileModal`, thêm một hàng ngay sau thẻ số điện thoại:

- **Bắt đầu làm:** biểu tượng lịch, giá trị `dd/MM/yyyy`.
- **Thâm niên:** biểu tượng đồng hồ, giá trị đủ năm, tháng, ngày.

Bố cục:

- Từ breakpoint `sm`: hai thẻ nằm cạnh nhau.
- Màn hình nhỏ: hai thẻ xếp dọc.
- Luôn hiển thị với mọi vai trò, độc lập với khối lớp phụ trách hoặc vai trò hệ thống.
- Nếu ngày thiếu hoặc không hợp lệ, cả hai giá trị hiển thị fallback theo ngôn ngữ hiện tại.

Copy i18n:

| Ý nghĩa | Tiếng Việt | Tiếng Anh |
|---|---|---|
| Ngày bắt đầu | Bắt đầu làm | Start date |
| Thâm niên | Thâm niên | Seniority |
| Giá trị | `{years} năm {months} tháng {days} ngày` | `{years} years {months} months {days} days` |
| Fallback | Chưa có dữ liệu | Not available |

Luôn hiển thị đơn vị bằng `0`, ví dụ `0 năm 2 tháng 5 ngày`.

## Xử lý lỗi và trường hợp biên

- Ngày tương lai hoặc sai định dạng: helper trả `null`, modal không throw.
- Auth không còn document `users`: migration bỏ qua và tăng `missingUserDoc`.
- Vai trò ngoài phạm vi: không thay đổi.
- Tài khoản cũ thiếu metadata: không suy đoán từ `allowed_teachers.addedAt`.
- Lỗi batch: script báo lỗi để có thể sửa nguyên nhân và chạy lại.
- Tài khoản mới thiếu metadata bất thường: dùng thời điểm server của request tạo tài khoản.

## Chiến lược kiểm thử

Unit test helper với `asOf` cố định:

- Cùng ngày: `0 năm 0 tháng 0 ngày`.
- Đúng ngày kỷ niệm.
- Khoảng có đủ năm, tháng và ngày.
- Tháng có số ngày khác nhau và năm nhuận.
- UTC chuyển sang ngày kế tiếp tại `Asia/Ho_Chi_Minh`.
- Ngày tương lai, chuỗi rỗng và chuỗi sai trả `null`.

API và dữ liệu:

- Tạo tài khoản lưu `createdAt` từ `metadata.creationTime`.
- Metadata không hợp lệ dùng ISO time của server.
- Projection trả `createdAt` trong `staff` và alias `teachers`, không lộ trường nội bộ.
- Migration dry-run không ghi; `--apply` chỉ ghi document thiếu; phân trang và chạy lại an toàn.

Giao diện:

- Modal giáo viên hiển thị đúng hai trường.
- Modal `level_manager`, `office` và `accounting` cũng hiển thị.
- Copy tiếng Việt và tiếng Anh đúng.
- Dữ liệu thiếu hoặc sai hiển thị fallback.
- Danh sách lớp và vai trò hệ thống không hồi quy.

Xác minh toàn cục:

- Chạy test mục tiêu cho staff account management, read API, helper ngày và Admin Dashboard modal.
- Chạy TypeScript typecheck.
- Chạy production build.

## Tiêu chí nghiệm thu

1. Tài khoản nhân sự mới có `users.createdAt` tương ứng ngày tạo Firebase Auth.
2. Script dry-run báo đúng thay đổi và `--apply` backfill an toàn cho tài khoản cũ.
3. Dashboard projection cung cấp `createdAt` cho cả bốn vai trò.
4. Modal hiển thị đúng ngày `dd/MM/yyyy` và thâm niên đủ năm, tháng, ngày.
5. Phép tính dùng ngày lịch tại `Asia/Ho_Chi_Minh`.
6. Dữ liệu thiếu hoặc không hợp lệ không làm modal lỗi.
7. Desktop, mobile, tiếng Việt và tiếng Anh đều hoạt động.
8. Test mục tiêu, typecheck và build thành công.
