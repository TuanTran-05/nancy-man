# Thiết kế: Gom nhóm thông tin học sinh & tài chính (Student 360)

- **Ngày**: 2026-07-18
- **Trạng thái**: Đã duyệt (design)
- **Phạm vi**: Cụm 1 + Cụm 2 + Cụm 3 (frontend-only, không đổi API)

## Bối cảnh & vấn đề

Thông tin của **một học sinh** hiện bị xé lẻ ở nhiều nơi, khiến muốn xem trọn vẹn phải qua nhiều thao tác và mất ngữ cảnh danh sách:

- `/students` → `StudentDetailModal`: chỉ hồ sơ (DOB, giới tính, lớp, liên hệ, đổi trạng thái, chuyển lớp).
- `/students/:id/report` (`StudentAdminReport`, admin-only): điểm danh + tài chính (tab riêng, timeline, KPI) — phải **rời trang** từ modal.
- `/accounting/students` (`AccountingStudents`, admin/accounting): bảng thanh toán/nợ read-only, tách biệt.
- Cột "Học phí" + "Điểm TB" trên `/students`: tóm tắt.
- `/admin/finance-report` → `StudentPaymentSection` → `StudentPaymentDetail`: **modal chi tiết tài chính per-student thứ ba**.

Đếm thao tác để admin xem đủ 1 học sinh (hồ sơ + học vụ + tài chính): Sidebar → Students → click → modal → "Báo cáo chi tiết" → chuyển trang → tab Điểm danh → tab Tài chính ≈ **5 bước, mất ngữ cảnh**. Trong khi các component hiển thị đã tồn tại sẵn, chỉ đang đặt ở các route/surface tách rời.

## Mục tiêu & nguyên tắc

- **Học sinh là "hub"**: một chỗ duy nhất `/students/:studentId` hiển thị hồ sơ → học vụ → tài chính; click 1 lần từ danh sách là thấy tất cả.
- **Giữ nguyên toàn bộ API**: tái dùng `fetchStudentAdminReport`, read-channel `students` / `accounting-students`, và các endpoint mutate hiện có. Không thêm/sửa backend.
- **Tái dùng component sẵn có**: `StudentAttendanceReportTab`, `StudentFinanceReportTab`, `StudentReportKpis`, `StudentReportTimelineStrip`, `StudentReportFilters`, `StudentFormModal`, `StudentStatusModal`, `StudentTransferModal`, `StudentDeleteModal`.
- **Trình bày**: trang đầy đủ (không dùng modal/drawer cho 360) — đủ chỗ cho timeline/biểu đồ báo cáo vốn rộng.

## Kiến trúc route

| Route | Trước | Sau |
|---|---|---|
| `/students/:studentId` | *(không có)* | **Trang 360 mới** (`StudentProfilePage`) — allowedRoles: `admin`, `teacher`, `office`, `accounting` |
| `/students/:studentId/report` | admin-only report | **redirect** → `/students/:studentId` (giữ link cũ sống) |
| `/accounting/students` | bảng riêng | **redirect** → `/students` |

Lưu ý thứ tự khai báo route: `/students` và `/students/:studentId` phải không xung đột với `/students/:studentId/report` (report khai báo trước hoặc dùng redirect tường minh).

## Cụm 1 — Trang 360 (`StudentProfilePage`)

Thay `StudentAdminReport` bằng page mới có cấu trúc:

### Header
- Avatar + tên + badge trạng thái (`StudentStatusBadge`) + mã HS.
- Nút back dùng `navigate(-1)` để giữ vị trí cuộn của danh sách.
- **Hành động nhanh**: Sửa / Đổi trạng thái / Chuyển lớp / Xoá — render lại các modal thao tác sẵn có ngay trong page, gọi đúng endpoint cũ. Hiển thị hành động theo quyền (ví dụ Xoá chỉ admin, Chuyển lớp chỉ `hasFullAcademicAccess`).

### Tabs (ẩn/hiện theo vai trò — phương án "phân quyền theo năng lực")

| Tab | Nội dung | Vai trò thấy |
|---|---|---|
| **Tổng quan** | Nội dung `StudentDetailModal` hiện tại: DOB, giới tính, lớp, liên hệ, ngày nhập học, trạng thái đăng nhập phụ huynh | admin, office, teacher, accounting |
| **Học vụ** | `StudentReportTimelineStrip` + `StudentReportFilters` + `StudentReportKpis` (phần điểm danh) + `StudentAttendanceReportTab` | admin, office, teacher (khớp `canUseAcademicRecords`) |
| **Tài chính** | KPI tài chính + `StudentFinanceReportTab` (sổ học phí + biên lai) | admin, accounting |

- **Tab mặc định** theo vai trò; hỗ trợ query `?tab=overview|academic|finance` để deep-link (finance report trỏ thẳng tab Tài chính).
- Nếu vai trò không có quyền với `?tab` được yêu cầu → fallback về tab mặc định của vai trò đó.

### Nạp dữ liệu
- Nhận `student` qua navigation state (từ danh sách) để hiển thị header tức thì.
- Khi mở URL trực tiếp / refresh: tự `fetchStudentAdminReport({ studentId })` (đã trả `student` + `timeline` + finance + attendance); bổ sung trường hồ sơ còn thiếu (DOB/giới tính/liên hệ/phụ huynh) từ channel `students` hoặc `accounting-students` tùy vai trò.
- Sau mỗi thao tác mutate, page refetch để cập nhật (thay cho cơ chế realtime invalidation của danh sách).

### Kết quả
- Click 1 lần từ danh sách → vào thẳng page (bỏ modal trung gian).
- `StudentDetailModal` **nghỉ hưu**.

## Cụm 2 — Một danh bạ học sinh duy nhất

- Giữ `Students.tsx` làm **directory dùng chung**; thêm `accounting` vào allowedRoles của `/students`.
- **Cột theo vai trò**: accounting thấy cột *Thanh toán / Nợ* (nguồn `accounting-students`), ẩn GPA và các hành động ngoài quyền; admin giữ nguyên. Mọi hàng bấm vào → `/students/:id`.
- **Nguồn dữ liệu không đổi API**: admin/teacher/office đọc channel `students`; accounting đọc channel `accounting-students`. Component tự chọn nguồn theo role → không đụng backend.
- `AccountingStudents.tsx` nghỉ hưu (thành redirect); sidebar accounting đổi mục *Học sinh* trỏ `/students`.

## Cụm 3 — Gom tài chính admin quanh trang 360

- `StudentPaymentSection` (trong `/admin/finance-report`): hàng học sinh **điều hướng `/students/:id?tab=finance`** thay vì mở modal → **bỏ `StudentPaymentDetail` modal** (chi tiết tài chính per-student chỉ còn 1 surface).
- `/admin/finance-report` = **báo cáo vĩ mô**: KPI + charts + danh sách thanh toán drill-down vào trang 360.
- Thêm link tường minh từ finance-report → **workspace vận hành `/tuition`** (thu/chi/receipt/ledger). `/tuition` giữ nguyên vai trò công cụ tác nghiệp.

## Nghỉ hưu / dọn dẹp

- Xoá `StudentDetailModal` (nội dung → tab Tổng quan).
- Xoá `StudentPaymentDetail` trong `StudentPaymentSection`.
- `AccountingStudents` → redirect.
- `StudentAdminReport` → nội dung chuyển vào `StudentProfilePage`; route report cũ redirect.

## Ngoài phạm vi (không đụng lần này — Cụm 4)

- `<Reports embedded>` ở đầu `/students`.
- Route `/reports`, `/academic`.
- Teachers / Classes / Teacher-attendance / Availability dùng chung giữa admin & office (đã là chia sẻ hợp lý).

## Kiểm thử

- Test mới `StudentProfilePage`: render tab đúng theo từng vai trò; deep-link `?tab=`; fallback tab khi thiếu quyền; nạp dữ liệu khi mở URL trực tiếp.
- Test redirect: `/students/:id/report` → `/students/:id`; `/accounting/students` → `/students`.
- Cập nhật/di dời test hiện có của `StudentDetailModal`, `StudentAdminReport`.
- Test `StudentPaymentSection`: click hàng điều hướng `/students/:id?tab=finance` (thay cho mở modal).
- Test `Students` directory: cột & hành động đúng theo vai trò (đặc biệt accounting).

## Rủi ro / điểm cần xác minh

- **Quyền đọc channel `students` của accounting**: nếu accounting không được đọc → dùng nguồn `accounting-students` cho role này (đã tính ở Cụm 2, không cần đổi API).
- Các modal thao tác khi đặt trong page phải cập nhật state sau mutate — page chủ động refetch.
- Deep-link `?tab=finance` từ finance-report cần `row.id` là `studentId` hợp lệ để điều hướng.

## Thứ tự triển khai

**Cụm 1 → Cụm 2 → Cụm 3**. Mỗi cụm là một bước có thể kiểm thử độc lập; Cụm 1 là nền móng vì Cụm 2 & 3 đều trỏ về trang 360.
