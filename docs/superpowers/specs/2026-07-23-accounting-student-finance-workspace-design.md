# Thiết kế: Accounting Student Finance Workspace

- **Ngày:** 2026-07-23
- **Trạng thái:** Đã duyệt từng phần trong trao đổi; chờ review bản spec đã ghi
- **Phạm vi:** Enrollment chuẩn theo khóa, danh sách tài chính lấy học sinh làm trung tâm, thống kê buổi học tối thiểu cho Accounting, backfill và rollout

## 1. Bối cảnh

EduTrack đã có Student 360, lịch sử lớp/khóa suy luận từ attendance và ledger, cùng màn hình Finance vận hành ledger/receipt/payment. Tuy nhiên trải nghiệm Accounting vẫn bị chia giữa `/students` và `/tuition`, trong khi profile tài chính không cho Accounting chọn khóa cũ và backend cố ý không trả attendance cho vai trò này.

Hệ quả:

- Bảng Finance hiện lấy ledger làm đơn vị, nên học sinh chưa có ledger không xuất hiện.
- Trạng thái học sinh là trạng thái hiện tại toàn cục, không phải trạng thái của từng khóa.
- Lịch sử khóa dựa trên bằng chứng attendance/ledger, chưa có enrollment chuẩn.
- Accounting không thể xem số buổi học thật.
- Bộ lọc lớp/khóa nằm trong tab Học vụ mà Accounting không được thấy.
- Endpoint `accounting-students` có thể cắt ledger theo cap, khiến tổng công nợ trên directory không bảo đảm đầy đủ.

Spec này mở rộng các thiết kế đã triển khai:

- `docs/superpowers/specs/2026-07-18-student-360-consolidation-design.md`
- `docs/superpowers/specs/2026-07-17-student-report-course-filters-design.md`
- `docs/superpowers/specs/2026-07-18-excused-absence-refund-design.md`

Quyết định “frontend-only, không đổi API” của Student 360 không còn áp dụng cho phần Accounting trong spec này. Các route và component Student 360 vẫn được tái sử dụng.

## 2. Mục tiêu

Accounting phải hoàn thành trong một luồng:

1. Xem toàn bộ học sinh, kể cả chưa có ledger.
2. Xem học sinh đã học những lớp và khóa nào.
3. Xem trạng thái enrollment của từng khóa.
4. Xem `Đã tham gia X/Y buổi đã diễn ra` và phân rã vắng/tạm nghỉ.
5. Xem học phí, giảm, đã đóng, còn nợ và trạng thái thanh toán từng khóa.
6. Xem tổng công nợ toàn lịch sử.
7. Biết enrollment nào chính xác và enrollment nào do backfill suy luận.
8. Mở đúng profile và đúng khóa mà không mất ngữ cảnh danh sách khi quay lại.

## 3. Ngoài phạm vi

- Cho Accounting xem calendar hoặc attendance từng ngày.
- Cho Accounting sửa attendance, student status hoặc enrollment.
- Thay đổi nguyên tắc tính ledger, receipt, PayOS hoặc sibling scholarship.
- Xóa `students.classId`, `students.enrollmentStatus`, `courseJoins` hoặc `leavePeriods`.
- Tự động phát sinh ledger chỉ vì người dùng mở màn hình.
- Thay thế các tab Phiếu thu, Thanh toán online, Chi phí hoặc Báo cáo.

## 4. Quyết định nghiệp vụ đã khóa

1. “Học được mấy buổi” hiển thị dưới dạng `Đã tham gia X/Y buổi đã diễn ra`.
2. `X = present + late`.
3. `Y` là mọi scheduled/makeup session đã diễn ra trong thời gian enrollment, bao gồm phiên rơi vào thời gian tạm nghỉ; loại trừ ngày trước `joinedAt`, tương lai, holiday và cancelled session.
4. Số buổi tạm nghỉ được hiển thị riêng và không được coi là đã tham gia.
5. Trạng thái enrollment chuẩn gồm:
   - `trial`
   - `active`
   - `on_leave`
   - `completed`
   - `transferred`
   - `dropped`
6. Danh sách gồm mọi hồ sơ. Mặc định hiển thị `trial`, `active`, `on_leave`; các trạng thái khác qua bộ lọc.
7. Một dòng học sinh hiển thị trạng thái thanh toán khóa hiện tại và tổng công nợ toàn lịch sử.
8. Khóa chưa có ledger vẫn xuất hiện với `missing_ledger` và nút tạo ledger thủ công.
9. Accounting chỉ đọc session summary, không nhận raw attendance rows.
10. Admin và Office được sửa/xác nhận enrollment; Accounting chỉ đọc.
11. Enrollment backfill chưa xác nhận hiển thị nhãn “Dữ liệu suy luận”.
12. Tab Học phí hiện tại được thay bằng danh sách Học sinh có phần mở rộng ledger theo khóa.
13. Giữ thao tác tạo ledger theo lớp/toàn bộ và thao tác tạo ledger riêng cho một khóa.
14. Thứ tự mặc định: quá hạn → còn nợ → chưa tạo học phí → đã thanh toán → tên.
15. Reset Course tự tạo enrollment khóa mới cho roster hiện hành và giữ trạng thái `active`, `on_leave` hoặc `trial`.

## 5. Kiến trúc tổng thể

Hệ thống có ba lớp dữ liệu:

1. **Nguồn chuẩn enrollment:** `student_course_enrollments`.
2. **Nguồn chuẩn tài chính và học vụ hiện hữu:** `course_fee_ledgers`, `receipts`, `payment_requests`, `attendance`, `class_sessions`, `classes`, `students`.
3. **Read model danh sách:** `accounting_student_summaries`, có thể rebuild hoàn toàn từ các nguồn chuẩn.

Danh sách `/tuition` đọc read model để phân trang, lọc và sắp xếp hiệu quả. Phần mở rộng và Student 360 đọc dữ liệu chuẩn để trả course summaries. Không gọi chi tiết cho mọi học sinh khi tải trang đầu.

## 6. Collection enrollment chuẩn

### 6.1 Document identity

Collection:

```text
student_course_enrollments/{enrollmentId}
```

`enrollmentId` được tạo bởi helper duy nhất:

```ts
makeStudentCourseEnrollmentId(studentId, classId, termStart)
```

ID là tuple đã encode của `studentId`, `classId`, `termStart`. Code không được parse ngược document ID; mọi truy vấn dùng field.

Không dùng `termId = current` làm identity vì sau Reset Course, “current” trỏ sang khóa mới. `termStart` là khóa ổn định qua archival.

### 6.2 Schema

```ts
export type CourseEnrollmentStatus =
  | 'trial'
  | 'active'
  | 'on_leave'
  | 'completed'
  | 'transferred'
  | 'dropped';

export type CourseEnrollmentSource = 'system' | 'backfill' | 'manual';
export type CourseEnrollmentConfidence = 'confirmed' | 'inferred';

export interface StudentCourseEnrollment {
  id: string;
  studentId: string;
  classId: string;
  termStart: string; // YYYY-MM-DD
  termEnd: string | null; // null khi khóa chưa chốt
  status: CourseEnrollmentStatus;
  joinedAt: string; // YYYY-MM-DD
  endedAt: string | null; // ngày kết thúc thực tế của membership
  statusReason: string | null;

  source: CourseEnrollmentSource;
  confidence: CourseEnrollmentConfidence;
  statusChangedAt: string;
  statusChangedBy: string;
  confirmedAt?: string;
  confirmedBy?: string;

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}
```

### 6.3 Invariants

- Chỉ có tối đa một enrollment cho một tuple `(studentId, classId, termStart)`.
- Một student chỉ có tối đa một enrollment mở với status `trial|active|on_leave`.
- Enrollment mở có `endedAt = null`.
- Enrollment đóng `completed|transferred|dropped` phải có `endedAt`.
- `joinedAt <= endedAt` khi `endedAt` tồn tại.
- `termEnd` là biên khóa; `endedAt` là biên membership và hai giá trị không bắt buộc bằng nhau.
- Writer không được sửa enrollment `source=manual` hoặc `confidence=confirmed` bằng suy luận tự động.
- Mọi manual correction bắt buộc có lý do và audit before/after.
- Writer nghiệp vụ mới tạo `source=system`, `confidence=confirmed`.

### 6.4 Quan hệ với student document

- `students.classId` và `students.enrollmentStatus` tiếp tục là projection trạng thái hiện tại cho các luồng cũ.
- Mọi mutation hiện tại phải cập nhật student projection và enrollment trong cùng transaction khi có thể.
- `courseJoins` và `leavePeriods` tiếp tục làm nguồn eligibility cho session calculations.
- Enrollment collection là nguồn chuẩn cho membership/status theo khóa.

## 7. State transitions

| Trigger | Enrollment nguồn | Enrollment đích |
|---|---|---|
| Tạo trial | — | tạo `trial`, mở |
| Duyệt trial | `trial` | đổi `active` |
| Bắt đầu tạm nghỉ | `active` | đổi `on_leave` |
| Quay lại học | `on_leave` | đổi `active` |
| Nghỉ học | `trial|active|on_leave` | đổi `dropped`, đặt `endedAt` |
| Chuyển lớp | enrollment mở | đổi `transferred`, đặt `endedAt`; tạo enrollment lớp đích |
| Reset Course | enrollment khóa cũ | đổi `completed`, chốt `termEnd/endedAt`; tạo enrollment khóa mới |
| Hoàn thành khóa không tiếp tục | enrollment mở | đổi `completed`, đặt `endedAt` |
| Admin/Office correction | bất kỳ | áp dụng giá trị hợp lệ, `source=manual`, `confidence=confirmed` |

Khi Reset Course:

- `active` tạo enrollment mới `active`.
- `on_leave` tạo enrollment mới `on_leave`.
- `trial` tạo enrollment mới `trial`.
- `dropped`, `transferred`, `completed` không được mang sang khóa mới.

Khi chuyển lớp, status ở lớp đích giữ `trial`, `active` hoặc `on_leave` tương ứng trạng thái hiện tại.

## 8. Backfill

### 8.1 Evidence

Backfill đọc:

- `students.classId`, lifecycle và enrollment status hiện tại.
- `courseJoins`.
- Non-voided attendance.
- Course fee ledgers.
- Class current term và `class.terms[]`.

### 8.2 Course reconstruction

Tái sử dụng `buildClassTerms`, `findTermForDate` và các nguyên tắc evidence gate hiện có.

Một historical enrollment chỉ được tạo khi xác định được class và term bounds. Bằng chứng không map được vào term không bị tự đoán; được ghi vào manifest review.

### 8.3 joinedAt

Thứ tự:

1. `courseJoins` khớp `classId + termStart`.
2. Ngày attendance không void sớm nhất trong term.
3. `termStart` nếu chỉ có ledger hoặc current class evidence.

Mục 2 và 3 tạo `confidence=inferred`.

### 8.4 status và endedAt

- Current class/current term dùng lifecycle và enrollment status hiện tại.
- Historical term kết thúc trước enrollment sau được suy luận `completed`.
- Nếu enrollment lớp đích bắt đầu trước `termEnd` của enrollment nguồn, enrollment nguồn được suy luận `transferred` với `endedAt = joinedAt` của enrollment đích.
- Current enrollment của student đã nghỉ được suy luận `dropped` từ status timestamp.
- Trường hợp còn lại được tạo `completed` với `confidence=inferred`.

### 8.5 Script guarantees

- Dry-run mặc định.
- Deterministic, idempotent.
- Không ghi đè manual/confirmed record.
- Live mode yêu cầu đường dẫn manifest dry-run đã duyệt.
- Manifest gồm planned creates, skips, conflicts, unresolved evidence, status distribution và checksum.
- Sau live backfill phải rebuild toàn bộ `accounting_student_summaries`.

## 9. Accounting read model

Collection:

```text
accounting_student_summaries/{studentId}
```

Đây là derived data, không phải source of truth.

```ts
export type AccountingPaymentStatus =
  | 'overdue'
  | 'partial'
  | 'unpaid'
  | 'missing_ledger'
  | 'paid'
  | 'waived';

export interface AccountingStudentSummary {
  studentId: string;
  studentName: string;
  studentNameNormalized: string;
  studentCode: string;
  searchTokens: string[];

  studentLifecycle: string;
  currentClassId: string | null;
  currentEnrollmentId: string | null;
  currentEnrollmentStatus: CourseEnrollmentStatus | null;
  currentCoursePaymentStatus: AccountingPaymentStatus;

  classCount: number;
  courseCount: number;
  totalPaid: number;
  totalOutstanding: number;
  overdueCourseCount: number;
  priorityRank: 0 | 1 | 2 | 3;

  sourceVersion: number;
  rebuiltAt: FirebaseFirestore.Timestamp;
}
```

`priorityRank`:

- `0`: có bất kỳ khoản quá hạn.
- `1`: có bất kỳ khoản còn nợ chưa quá hạn.
- `2`: current enrollment chưa có ledger.
- `3`: không còn khoản cần xử lý.

Summary phải tồn tại cho mọi student record, kể cả không có enrollment hoặc ledger.

`searchTokens` chỉ chứa prefix đã normalize của từng từ trong tên và mã học sinh. Không đưa phone/contact vào read model.

`sourceVersion` là version nguyên của thuật toán rebuild. Mỗi lần thay đổi cách tính summary phải tăng hằng số version; repair job rebuild mọi document có version cũ.

## 10. Summary rebuild và consistency

Một service idempotent:

```ts
rebuildAccountingStudentSummary(db, studentId)
```

đọc student, enrollments và toàn bộ ledgers của student rồi ghi một summary hoàn chỉnh.

Các flow sau yêu cầu rebuild:

- Tạo/update/void ledger.
- Post/void receipt.
- PayOS paid/reconcile/manual resolution.
- Student creation/import/admission.
- Status change, transfer, delete/archive.
- Reset Course.
- Manual enrollment correction.

Canonical transaction không bị rollback chỉ vì summary rebuild hậu kỳ thất bại. Rebuild chạy qua post-commit trigger/outbox hiện có và được retry. Một repair job định kỳ tìm summary thiếu, stale hoặc sai `sourceVersion`.

Profile luôn đọc canonical data. Chỉ danh sách phụ thuộc read model.

Health document:

```text
accounting_student_summary_health/current
```

lưu `studentCount`, `summaryCount`, `sourceVersion`, `repairBacklog`, `checkedAt`. Feature flag và list API dùng document này để phát hiện dataset chưa đầy đủ mà không quét toàn collection trong mỗi request.

## 11. API contracts

### 11.1 Danh sách

Read channel mới:

```text
accounting-student-finance
```

Roles: `admin`, `accounting`.

Query:

```ts
type AccountingStudentFinanceQuery = {
  cursor?: string;
  limit?: number; // default 50, max 100
  search?: string;
  classId?: string;
  lifecycleScope?: 'current' | 'all';
  enrollmentStatus?: CourseEnrollmentStatus;
  paymentStatus?: AccountingPaymentStatus;
};
```

Response:

```ts
type AccountingStudentFinancePage = {
  rows: AccountingStudentSummary[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
  };
  dataIncomplete: boolean;
  generatedAt: string;
};
```

Không có search: order theo `priorityRank`, `studentNameNormalized`, document ID.

Có search: normalize query, dùng `array-contains` trên `searchTokens`, sau đó vẫn order theo priority/name. Search phải áp dụng trước pagination và tìm trên toàn dataset.

### 11.2 Course summaries

Mở rộng `StudentTimelineSegment` bằng enrollment view không chứa dữ liệu tài chính:

```ts
export interface StudentCourseEnrollmentView {
  id: string;
  status: CourseEnrollmentStatus;
  joinedAt: string;
  endedAt: string | null;
  source: CourseEnrollmentSource;
  confidence: CourseEnrollmentConfidence;
}

export interface StudentTimelineSegment {
  // existing fields
  enrollment: StudentCourseEnrollmentView | null;
}
```

Admin, Office và Teacher nhận enrollment view theo scope học vụ hiện hữu. Chỉ Admin/Office nhận control sửa; Teacher chỉ đọc.

`StudentAdminReportResponse` đồng thời có course finance summaries cho Admin/Accounting:

```ts
export interface StudentCourseFinanceSummary {
  enrollment: StudentCourseEnrollmentView;
  termKey: string;
  className: string;
  termIndex: number;

  sessions: {
    attended: number;
    elapsed: number;
    absentExcused: number;
    absentUnexcused: number;
    onLeave: number;
    complete: boolean;
  };

  finance: {
    ledgerId: string | null;
    grossAmount: number;
    discount: number;
    netAmount: number;
    paid: number;
    outstanding: number;
    dueDate: string | null;
    status: AccountingPaymentStatus;
  };
}
```

`elapsed` tính scheduled/makeup sessions:

- từ `joinedAt`;
- đến giá trị nhỏ nhất trong today, `endedAt`, `termEnd` khi các giá trị tồn tại;
- loại holiday, cancelled và future;
- không loại session trong leave period;
- dedupe scheduled và makeup cùng ngày.

Attendance thật luôn thắng eligibility label. `attended = present + late`.

Với Accounting:

- `attendanceRows` vẫn là `[]`.
- `courseSummaries` có session aggregate.
- Không trả note attendance, teacher marker hoặc calendar row.

Với Office/Teacher:

- `courseSummaries` không chứa finance amount.
- Enrollment status được đọc từ `timeline[].enrollment`.
- Quyền xem attendance rows giữ nguyên như hiện tại.

Phần mở rộng trong danh sách gọi report theo student khi cần và cache trong vòng đời trang.

## 12. Enrollment mutation API

Manual correction đi qua API server, roles `admin|office`.

Input bắt buộc:

```ts
type UpdateCourseEnrollmentInput = {
  enrollmentId: string;
  status: CourseEnrollmentStatus;
  joinedAt: string;
  endedAt: string | null;
  statusReason: string;
};
```

Server:

- validate invariants;
- reject overlapping open enrollments;
- update enrollment;
- sync current student projection nếu record được sửa là current enrollment;
- ghi audit before/after;
- phát invalidation/rebuild event.

Accounting không có mutation control và API trả 403.

## 13. Frontend `/tuition`

### 13.1 Tabs

```text
Học sinh | Phiếu thu | Thanh toán online | Chi phí | Báo cáo
```

Key `ledgers` được thay bằng `students`. `students` là mặc định.

### 13.2 Toolbar

- Search tên/mã.
- Lọc lớp.
- Lọc lifecycle scope.
- Lọc enrollment status.
- Lọc payment status.
- Tạo ledger theo lớp.
- Tạo ledger toàn bộ.

Filter, search và active tab được lưu trong URL query.

### 13.3 Student row

- Mã và tên.
- Lớp/khóa hiện tại.
- Enrollment status hiện tại.
- Payment status khóa hiện tại.
- Tổng outstanding toàn lịch sử.
- Số lớp/số khóa.
- Expand.
- Mở profile.

Danh sách mặc định dùng `lifecycleScope=current`, tương ứng trial/active/on_leave.

### 13.4 Expanded row

Course summaries mới nhất trước. Mỗi course:

- class name, “Khóa N”, date range;
- enrollment status;
- badge “Dữ liệu suy luận” khi `confidence=inferred`;
- `Đã tham gia X/Y buổi đã diễn ra`;
- vắng phép, vắng không phép, tạm nghỉ;
- gross, discount, paid, outstanding, due date, payment status;
- `Tạo học phí` khi `ledgerId=null`;
- reminder/notice khi còn nợ và đủ điều kiện;
- mở đúng profile/course.

Mở rộng không tự tạo ledger và không gọi mutation.

### 13.5 Missing/stale states

- Feature flag không được bật nếu số summary khác số student records sau full rebuild.
- Student creation/import phải tạo hoặc enqueue summary trước khi trả success.
- Nếu health marker báo summary thiếu hoặc repair backlog chưa rỗng, API trả `dataIncomplete=true`; UI hiện banner “Danh sách đang đồng bộ” và không tuyên bố tập kết quả là đầy đủ.
- Session summary `complete=false`: không trình bày X/Y như số chính xác; hiển thị cảnh báo dữ liệu chưa đầy đủ.
- Enrollment evidence không resolve: không bịa course; issue nằm trong migration manifest.
- API detail lỗi: expanded row có retry riêng, không làm mất danh sách.

## 14. Student 360

Accounting mặc định vào tab Finance.

Deep-link:

```text
/students/:studentId?tab=finance&classId={classId}&termKey={termKey}
```

Tab Finance render timeline và bộ lọc class/course, không phụ thuộc tab Academic. Với Accounting:

- Render course enrollment, session aggregate, ledger và receipt.
- Không render attendance calendar.
- Không render enrollment edit controls.

Với Admin/Office:

- Timeline segment có action xác nhận/sửa enrollment.
- Editor modal yêu cầu status, dates và reason.
- Office không được thấy finance amounts nếu capability hiện tại không cho phép.

## 15. Điều hướng và URL compatibility

Sidebar Accounting bỏ mục Học sinh, giữ Tài chính, Bảng lương, Hồ sơ.

Role-aware redirects:

- Accounting `/students` → `/tuition`.
- Accounting `/accounting/students` → `/tuition`.
- Các role hợp lệ khác vẫn dùng `/students`.
- `/students/:studentId` vẫn cho Accounting.

URL `/tuition` giữ:

- active tab;
- search;
- filters;
- page/cursor navigation state;
- expanded student ID.

Back từ profile phải khôi phục đúng danh sách và row mở rộng.

## 16. Realtime và cache

Thay đổi canonical phải invalidate:

- `accounting-student-finance`
- `finance-ledger`
- `finance-receipt`
- `parent-tuition` khi phù hợp
- `student-admin-report:{studentId}` hoặc cơ chế cache tương đương

Course detail cache được xóa cho đúng student khi nhận invalidation. Không xóa toàn bộ cache danh sách nếu chỉ một student thay đổi; refresh page hiện tại là mức tối đa chấp nhận được trong giai đoạn đầu.

## 17. Phân quyền và privacy

| Capability | Admin | Office | Accounting | Teacher | Student/Parent |
|---|---:|---:|---:|---:|---:|
| Đọc accounting list | Có | Không | Có | Không | Không |
| Đọc finance course summary | Có | Không | Có | Không | Không |
| Đọc academic attendance rows | Có | Có | Không | Theo scope | Theo luồng hiện hữu |
| Đọc aggregate session count trong finance | Có | Không | Có | Không | Không |
| Sửa/xác nhận enrollment | Có | Có | Không | Không | Không |

Hai collection mới không được client đọc trực tiếp. API dùng Admin SDK và role gate. Firestore rules từ chối client access trừ khi có yêu cầu quản trị riêng trong tương lai.

## 18. Indexes

Các composite index tối thiểu:

- `student_course_enrollments`: `studentId + termStart desc`
- `student_course_enrollments`: `classId + termStart + status`
- `accounting_student_summaries`: `priorityRank + studentNameNormalized + __name__`
- `accounting_student_summaries`: `currentClassId + priorityRank + studentNameNormalized`
- `accounting_student_summaries`: `currentEnrollmentStatus + priorityRank + studentNameNormalized`
- `accounting_student_summaries`: `currentCoursePaymentStatus + priorityRank + studentNameNormalized`
- Các biến thể filter kết hợp được thêm theo query thực tế và emulator/index diagnostics; không fallback sang client-side filtering.

## 19. Rollout

1. Thêm types, collections, indexes, rules và API đọc có fallback.
2. Cập nhật mọi writer tạo/đổi enrollment.
3. Deploy writers nhưng giữ UI cũ.
4. Chạy backfill dry-run.
5. Review manifest và giải quyết conflict nghiêm trọng.
6. Chạy backfill live.
7. Rebuild toàn bộ accounting summaries.
8. Đối chiếu mẫu với attendance, ledger và receipt.
9. Bật UI mới qua feature flag cho staging.
10. Chạy regression và acceptance.
11. Bật production cho Accounting.
12. Theo dõi stale summaries, unresolved evidence và API errors.
13. Sau thời gian ổn định mới bỏ menu Học sinh cho Accounting và kích hoạt redirect danh sách cũ.

Rollback UI chỉ tắt feature flag. Canonical enrollment documents và summaries được giữ; không xóa dữ liệu backfill trong rollback giao diện.

## 20. Testing

### 20.1 Domain

- Enrollment ID ổn định qua archival/reset.
- Invariant một open enrollment.
- Mọi state transition.
- Reset Course giữ active/on_leave/trial.
- Backfill deterministic và idempotent.
- Backfill không overwrite manual/confirmed.
- joinedAt/status/endedAt inference.
- attended và elapsed definitions.
- Makeup/cancel/holiday/future handling.
- Leave sessions nằm trong elapsed nhưng không nằm trong attended nếu không có attendance thật.

### 20.2 API và authorization

- Admin/Accounting đọc list.
- Office/Teacher/Student/Parent bị từ chối.
- Admin/Office mutate enrollment.
- Accounting mutate nhận 403.
- Accounting nhận course summaries nhưng không nhận raw attendance rows.
- Search/filter/sort áp dụng trước pagination.
- Student chưa ledger vẫn xuất hiện.
- Tổng outstanding không phụ thuộc cap ledger cũ.
- Audit before/after/reason.

### 20.3 Summary

- Rebuild từ zero, incremental invalidation và repair.
- Receipt post/void, PayOS paid/reconcile và ledger mutation làm summary hội tụ đúng.
- Summary stale không ảnh hưởng canonical profile.
- Missing summary được phát hiện và repair.

### 20.4 Frontend

- Tab Students mặc định.
- Filter/search/URL state.
- Default scope và priority order.
- Lazy expansion và cache.
- Missing ledger action.
- Inferred badge.
- Deep-link đúng course.
- Back khôi phục context.
- Incomplete sessions không hiện số thiếu như chính xác.
- Role-aware redirects và sidebar.

### 20.5 Regression

- Student 360.
- Course filters.
- Excused absence/refund estimate.
- Accounting directory.
- Ledger generation.
- Receipt post/void.
- PayOS webhook/reconcile/review.
- Reminder/notice.
- Admissions, transfer, status, delete/archive và Reset Course.
- Firestore rules, read authorization và realtime.

## 21. Acceptance criteria

Với một student có nhiều lớp, nhiều khóa, một khóa chưa ledger, một khóa đã đóng, một khóa còn nợ và một enrollment backfill:

- Student xuất hiện trong `/tuition` dù có khóa chưa ledger.
- Default priority đặt student đúng nhóm công nợ.
- Expanded row liệt kê đủ canonical enrollments theo thứ tự mới nhất.
- Mỗi khóa có trạng thái enrollment, X/Y sessions và finance status đúng.
- Backfilled enrollment có badge suy luận.
- Accounting không nhận raw attendance rows.
- Click student mở Finance tab.
- Click course chọn đúng class/term.
- Back giữ nguyên search/filter/expanded row.
- Admin/Office xác nhận enrollment và badge suy luận biến mất sau refresh.
- Receipt/PayOS update làm list summary hội tụ và profile canonical đúng ngay.

## 22. Phân rã triển khai

Thứ tự bắt buộc:

1. Domain types, enrollment repository và state transitions.
2. Tích hợp writers.
3. Backfill và summary rebuild.
4. Read APIs và privacy-safe course summaries.
5. Finance student-centric UI.
6. Student 360 course selection và enrollment editor.
7. Routing/sidebar/feature flag.
8. Full regression, staging reconciliation và production rollout.

Không triển khai UI mới trước khi writers, backfill và summary rebuild đã sẵn sàng.
