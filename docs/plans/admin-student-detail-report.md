# Kế hoạch triển khai báo cáo chi tiết học sinh dành cho Admin

> Trạng thái: Sẵn sàng triển khai  
> Phạm vi: frontend, read API, domain logic, dữ liệu học phí, phân quyền và kiểm thử  
> Route dự kiến: `/students/:studentId/report`

## 1. Mục tiêu

Cho phép admin mở profile một học sinh, bấm **Báo cáo chi tiết** và xem:

- Thông tin học sinh, lớp hiện tại và lịch sử lớp liên quan.
- Tỷ lệ đi học; số buổi có mặt, vắng, vắng có phép, đi muộn và chưa điểm danh.
- Bảng điểm danh theo buổi, lớp và khoảng ngày.
- Tổng học phí phát sinh, giảm/miễn, đã đóng và còn nợ.
- Những kỳ đã đóng, đóng một phần, chưa đóng hoặc quá hạn.
- Lịch sử phiếu thu của từng kỳ.

MVP là màn hình chỉ đọc. Chỉnh điểm danh, thu tiền, hủy phiếu, gửi nhắc phí và xuất PDF/Excel nằm ngoài phạm vi.

## 2. Quyết định kiến trúc

### Trang báo cáo riêng

CTA trong popup điều hướng tới `/students/:studentId/report`. Không mở rộng popup vì báo cáo cần bảng dài, bộ lọc, phân trang, responsive và URL có thể tải lại.

### Admin-only ở ba lớp

1. CTA chỉ render khi `profile?.role === 'admin'`.
2. Route dùng `ProtectedRoute requiredRole="admin"`.
3. Read API kiểm tra user context và trả `403` cho vai trò khác.

Không dùng `hasFullAcademicAccess` cho CTA vì biến hiện tại bao gồm cả office.

### Tổng hợp dữ liệu ở server

Frontend không tự đọc nhiều collection. Server chịu trách nhiệm kiểm tra quyền, validate khoảng ngày, query dữ liệu, gọi domain functions có unit test và trả DTO đã project an toàn.

## 3. Giao diện

### CTA trong profile

- Tiêu đề: `Báo cáo chi tiết`.
- Mô tả: `Điểm danh, tỷ lệ chuyên cần và tình trạng học phí`.
- Toàn bộ ô có thể click, có hover, focus-visible và dùng được bằng bàn phím.
- Không thay đổi các nút sửa, xóa, đổi trạng thái và chuyển lớp hiện có.

### Header báo cáo

- Nút quay lại.
- Ảnh, họ tên, mã học sinh và badge trạng thái.
- Lớp hiện tại, giáo viên, ngày nhập học và liên hệ.
- Bộ lọc kỳ hiện tại, 30 ngày, 90 ngày, năm hiện tại và khoảng tùy chọn.

### KPI

1. Tỷ lệ đi học.
2. Số buổi có mặt.
3. Số buổi vắng.
4. Số lần đi muộn.
5. Tổng học phí phải đóng.
6. Số tiền còn nợ.

Hiển thị thêm coverage `x/y buổi đã có kết quả`, số kỳ còn nợ, số kỳ quá hạn và cảnh báo dữ liệu thiếu.

### Tab điểm danh

Bộ lọc theo khoảng ngày, lớp và trạng thái. Bảng gồm ngày, lớp, loại buổi, trạng thái, phút đi muộn, có phép/không phép và ghi chú an toàn nếu projection cho phép.

### Tab học phí

Summary gồm tổng phát sinh, giảm/miễn, đã đóng, còn nợ, số kỳ chưa hoàn tất và số kỳ quá hạn.

Bảng gồm kỳ, lớp, phải đóng, giảm/miễn, đã đóng, còn nợ, hạn đóng và trạng thái. Mỗi ledger có thể mở lịch sử receipt gồm số phiếu, ngày thu, số tiền, phương thức, trạng thái và nguồn.

## 4. Nghiệp vụ điểm danh

### Buổi học hợp lệ

Một buổi được tính khi:

- Thuộc lớp liên quan đến học sinh trong khoảng đang xem.
- Nằm trong thời gian lớp/kỳ và không trước ngày nhập học nếu có.
- Không ở tương lai theo `Asia/Ho_Chi_Minh`.
- Không phải ngày nghỉ hoặc session `cancelled`.
- Là ngày học theo `weeklySessions`/`daysOfWeek`, hoặc session `makeup`.

Ưu tiên `class_sessions`, fallback về lịch tuần. Gộp theo `classId + date` để không đếm trùng session thực tế và lịch dự kiến.

### Ánh xạ trạng thái

- `present`: có mặt.
- `late`: có đi học nhưng đi muộn.
- `absent + permission`: vắng có phép.
- `absent` không permission: vắng không phép.
- Có buổi hợp lệ nhưng thiếu attendance: chưa điểm danh.
- `isVoided === true`: bỏ qua.

### Công thức

```text
attended = present + late
markedSessions = present + late + absent
expectedSessions = tổng buổi hợp lệ
attendanceRate = expectedSessions > 0
  ? attended / expectedSessions * 100
  : null
```

Đi muộn được tính là đi học. Vắng có phép vẫn nằm trong mẫu số. Buổi chưa điểm danh không được tự đổi thành vắng nhưng nằm trong mẫu số và phải có cảnh báo coverage. Khi không có buổi hợp lệ, UI hiển thị `Chưa đủ dữ liệu`, không hiển thị `0%`.

### Domain module

Tạo `shared/studentAttendanceReport.ts` với:

- `buildExpectedStudentSessions`.
- `mergeExpectedSessionsWithAttendance`.
- `calculateStudentAttendanceSummary`.
- `classifyStudentAttendanceRow`.

## 5. Nghiệp vụ học phí

### Nguồn chuẩn

- Ledger là nguồn công nợ.
- `paidTotal` là tổng đã ghi sổ.
- Receipt `posted` là khoản thu hợp lệ.
- Receipt `draft`/`void` và online payment chưa tạo receipt hợp lệ không được coi là đã thanh toán.

### Công thức đề xuất

```text
discount = max(discountTotal ?? 0, 0)
netAmount = max(amount - discount, 0)
paid = max(paidTotal, 0)
outstanding = max(netAmount - paid, 0)
```

Trước khi khóa công thức phải đối chiếu logic post receipt để xác nhận `amount` là gross hay net, tránh trừ giảm giá hai lần.

### Trạng thái dẫn xuất

1. `waived` nếu miễn toàn bộ.
2. `paid` nếu còn nợ bằng 0.
3. `overdue` nếu còn nợ, có `dueDate` và đã qua hạn.
4. `partial` nếu đã đóng một phần.
5. `unpaid` nếu chưa đóng và chưa quá hạn.
6. Cờ `due_date_missing` nếu còn nợ nhưng thiếu hạn đóng.

`overdue` chỉ là trạng thái hiển thị, không ghi đè field `status` canonical.

### Domain module

Tạo `shared/studentFinanceReport.ts` với:

- `calculateLedgerBalance`.
- `deriveLedgerDisplayStatus`.
- `calculateStudentFinanceSummary`.
- `formatLedgerPeriodKey`.

## 6. Thay đổi dữ liệu học phí

Bổ sung vào `CourseFeeLedger`:

```typescript
dueDate?: string; // YYYY-MM-DD
```

Field optional để tương thích dữ liệu cũ. Không dùng `tuitionReminderLastDueDate` làm hạn canonical.

Nếu rule hạn đóng đã được chốt, tạo:

- `scripts/backfill-course-fee-ledger-due-dates.ts`.
- `scripts/backfill-course-fee-ledger-due-dates.test.ts`.

Script phải mặc định dry-run, không ghi đè `dueDate` đã có, chia batch an toàn và có thể chạy lại.

## 7. API contract

Channel mới:

```text
student-admin-report
```

Request:

```typescript
interface StudentAdminReportParams {
  studentId: string;
  from?: string;
  to?: string;
  attendanceCursor?: string;
  attendanceLimit?: number; // default 100, max 200
}
```

Validation:

- `studentId` bắt buộc.
- Ngày đúng định dạng `YYYY-MM-DD` và `from <= to`.
- Khoảng ngày tối đa 366 ngày.
- Limit bị chặn server-side.

Response chính:

```typescript
interface StudentAdminReportResponse {
  student: SafeStudent;
  currentClass: StudentReportClass | null;
  relatedClasses: StudentReportClass[];
  attendanceSummary: {
    expectedSessions: number;
    markedSessions: number;
    present: number;
    absentWithPermission: number;
    absentWithoutPermission: number;
    late: number;
    unmarked: number;
    attendanceRate: number | null;
  };
  attendanceRows: StudentAttendanceReportRow[];
  attendancePage: { nextCursor: string | null; hasMore: boolean };
  financeSummary: {
    grossAmount: number;
    discountTotal: number;
    netAmount: number;
    paidTotal: number;
    outstandingTotal: number;
    unpaidTerms: number;
    overdueTerms: number;
    missingDueDateTerms: number;
  };
  ledgers: StudentLedgerReportRow[];
  receipts: StudentReceiptReportRow[];
  generatedAt: string;
}
```

Mã lỗi: `400` input sai, `401` chưa đăng nhập, `403` không phải admin, `404` không thấy học sinh, `500` lỗi tổng hợp.

## 8. Kế hoạch backend

### Router và reader

Sửa:

- `api/read/[channel].ts`.
- `server/api/read/handlers/readers.ts`.
- `server/api/lib/student/studentProjection.ts` nếu cần projection mới.

Thêm `readStudentAdminReport`:

1. Xác nhận admin.
2. Validate params.
3. Đọc và project student.
4. Query attendance theo `studentId` và khoảng ngày; loại void.
5. Xác định class ID từ student, attendance và ledger.
6. Đọc class metadata, holidays và class sessions.
7. Đọc ledger theo student.
8. Đọc receipts theo student hoặc ledger ID.
9. Chỉ đọc online payments nếu UI MVP thực sự sử dụng.
10. Tính summary bằng domain modules.
11. Trả DTO giới hạn field.

### Query và hiệu năng

- Không đọc toàn collection.
- Query attendance theo student và date range.
- Phân trang bảng attendance.
- Chunk class/ledger ID theo giới hạn Firestore.
- Thêm composite index nếu emulator yêu cầu.
- Không cache dài hạn dữ liệu tài chính; có thể cache ngắn 10–15 giây.

## 9. Kế hoạch frontend

### Route và CTA

Sửa:

- `src/app/AnimatedRoutes.tsx`.
- `src/pages/common/Students.tsx`.
- `src/pages/common/components/students/StudentDetailModal.tsx`.

Props mới đề xuất:

```typescript
canViewAdminReport: boolean;
onOpenAdminReport: (studentId: string) => void;
```

### Trang và component mới

```text
src/pages/admin/StudentAdminReport.tsx
src/pages/admin/components/studentReport/StudentReportHeader.tsx
src/pages/admin/components/studentReport/StudentReportKpis.tsx
src/pages/admin/components/studentReport/StudentAttendanceReportTab.tsx
src/pages/admin/components/studentReport/StudentFinanceReportTab.tsx
src/pages/admin/components/studentReport/StudentLedgerReceipts.tsx
src/lib/api/studentAdminReportApi.ts
```

Trang phải có skeleton, refresh không xóa dữ liệu cũ, empty/error/404 state, retry, load more và layout responsive.

Thêm key `studentAdminReportPage` vào:

- `src/lib/i18n/locales/vi/pages.ts`.
- `src/lib/i18n/locales/en/pages.ts`.

## 10. Kiểm thử

### Unit test

Tạo:

- `shared/studentAttendanceReport.test.ts`.
- `shared/studentFinanceReport.test.ts`.

Điểm danh phải test có mặt, vắng, vắng có phép, đi muộn, chưa điểm danh, ngày nghỉ, buổi hủy, học bù, record void, trùng lịch, trước ngày nhập học, ngày tương lai và trường hợp không có buổi hợp lệ.

Học phí phải test paid, unpaid, partial, waived, discount, overdue, chưa tới hạn, thiếu dueDate, không tạo số dư âm và không trừ discount hai lần.

### API test

Mở rộng `api/read/action.test.ts`:

- Admin đọc thành công.
- Teacher, office, accounting và parent nhận `403`.
- Input sai nhận `400`; học sinh không tồn tại nhận `404`.
- Không rò rỉ credential.
- Học sinh chuyển lớp vẫn có lịch sử.
- Receipt draft/void không được tính là thanh toán.
- Pagination đúng contract.

### Component và E2E

- Mở rộng `StudentDetailModal.test.tsx` cho CTA và quyền.
- Tạo `src/pages/admin/StudentAdminReport.test.tsx`.
- Tạo `e2e/admin-student-report.spec.ts`.

## 11. Trình tự triển khai

### Phase 1 — Domain contract

- Xác nhận semantics `amount`/`discountTotal`.
- Xác nhận rule hạn đóng cho ledger theo khóa.
- Viết domain functions và unit tests.

### Phase 2 — API và phân quyền

- Thêm channel, reader, projection và query bounds.
- Viết authorization/API tests.
- Bổ sung Firestore index nếu cần.

### Phase 3 — dueDate

- Thêm field vào type và luồng tạo ledger.
- Backfill theo dry-run nếu rule nghiệp vụ đã chốt.

### Phase 4 — Frontend

- Thêm route admin-only và CTA.
- Tạo page, KPI, tabs, bộ lọc và phân trang.
- Thêm i18n và component tests.

### Phase 5 — QA

- Chạy format, typecheck, unit/API/component tests.
- Chạy E2E admin và authorization.
- Kiểm tra desktop/mobile và đối chiếu số liệu với màn hình tài chính.

## 12. Definition of Done

- Admin thấy CTA và mở được báo cáo đúng học sinh.
- Non-admin không thấy CTA và không gọi được route/API.
- Tỷ lệ chuyên cần loại ngày nghỉ và buổi hủy.
- Thiếu điểm danh không bị hiểu là vắng.
- Đi muộn và vắng có phép được phân loại riêng.
- Công nợ hiển thị đúng theo kỳ.
- Chỉ ledger có hạn đóng đã qua mới được gắn nhãn quá hạn.
- Receipt draft/void không được tính là khoản đã thu.
- Học sinh chuyển lớp vẫn xem được lịch sử.
- Có loading, empty, error, retry và mobile layout.
- Typecheck và toàn bộ test mục tiêu đều đạt.

## 13. Rủi ro và điểm cần chốt

1. `CourseFeeLedger.amount` là số trước hay sau giảm giá?
2. Hạn đóng của ledger theo khóa được tính theo rule nào?
3. Student hiện chỉ giữ `classId` hiện tại; MVP phải suy lịch sử lớp từ attendance và ledger.
4. Worktree đang có thay đổi chưa commit tại `StudentDetailModal.tsx` và test liên quan; implementation phải đọc diff và chỉnh chồng tối thiểu, không ghi đè thay đổi hiện hữu.

