# Thiết kế cơ chế xác nhận kết khóa và khóa Office

**Ngày:** 2026-07-18
**Trạng thái:** Đã duyệt để triển khai ngày 2026-07-19
**Phạm vi:** Class Detail, Office Academic, Zalo course-closing notifications, Reset Course

## 1. Bối cảnh

Luồng hiện tại xem một lớp là sẵn sàng gửi ngay khi mọi học sinh đang học đã có nhận xét cuối khóa. Office có thể gửi nhận xét và học phí mà không cần một hành động xác nhận rõ ràng từ giáo viên. Nếu giáo viên vẫn đang chỉnh sửa, hoặc ngày khóa bị thay đổi trước khi gửi xong, thông báo và dữ liệu khóa mới có thể bị gắn sai kỳ.

`Reset Course` hiện cũng không kiểm tra toàn bộ thông báo kết khóa đã gửi xong trước khi thay đổi ngày lớp, lưu term cũ và tạo ledger khóa mới. Vì vậy một lần reset sớm có thể khiến dữ liệu nhận xét, log gửi và học phí không còn cùng một kỳ.

## 2. Mục tiêu

1. Chỉ mở quyền gửi thông báo kết khóa cho Office sau khi giáo viên phụ trách đã lưu đủ nhận xét cuối khóa và xác nhận rõ ràng.
2. Admin có thể xác nhận thay giáo viên, nhưng bắt buộc nhập lý do và phải có audit.
3. Mọi thay đổi ảnh hưởng tới snapshot đã xác nhận phải tự động làm xác nhận mất hiệu lực.
4. Sau khi nhận xét của một học sinh đã gửi, không cho sửa hoặc xóa nhận xét cuối khóa đó.
5. Chỉ cho phép Reset Course khi mọi học sinh đang học đã hoàn thành toàn bộ thông báo bắt buộc hoặc đã được Admin miễn gửi.
6. Không cho bất kỳ vai trò nào bypass điều kiện Reset Course.
7. Dùng một định danh khóa ổn định để không phụ thuộc vào ngày và tránh log khóa cũ bị tính cho khóa mới.
8. Bảo vệ quy tắc tại backend; disable nút trên UI chỉ là phản hồi giao diện, không phải hàng rào bảo mật.

## 3. Quyết định nghiệp vụ đã chốt

- Học sinh bắt buộc là học sinh thỏa `isRequiredAcademicEvaluationStudent`: không archived và enrollment status chuẩn hóa là `active`.
- Các quy tắc active/current/final dùng `isRequiredAcademicEvaluationStudent`, `isCurrentAcademicCourseRecord` và `selectFinalEvaluation` từ `shared/academic.ts`; quy tắc hạng dùng `isRankedEvaluation` từ `shared/evaluationRank.ts`.
- Một lớp chỉ sẵn sàng xác nhận khi mọi học sinh bắt buộc có nhận xét `final` của khóa hiện tại.
- Sau khi xác nhận, các thay đổi sau làm xác nhận mất hiệu lực:
  - tạo, sửa hoặc xóa nhận xét cuối khóa hiện tại chưa gửi;
  - thay đổi tập học sinh bắt buộc;
  - thay đổi ngày bắt đầu hoặc ngày kết thúc khóa;
  - fingerprint lưu trên lớp không còn khớp snapshot backend vừa tính.
- Sau khi thông báo nhận xét của một học sinh gửi thành công, API từ chối sửa/xóa nhận xét cuối khóa tương ứng.
- Một học sinh hoàn tất khi:
  - nhận xét cuối khóa đúng phiên bản đã gửi;
  - học phí khóa tiếp theo đã gửi;
  - thông báo hạng đã gửi nếu nhận xét có hạng được `isRankedEvaluation` công nhận;
  - hoặc học sinh đã được Admin miễn các thông báo còn thiếu.
- Chỉ Admin được miễn gửi, bắt buộc có lý do và audit.
- Mọi vai trò đang có quyền reset (`admin`, `office`, `accounting`) đều bị chặn nếu lớp chưa hoàn tất. Admin không có nút force reset; Admin phải xử lý miễn gửi trước.

## 4. Hiện trạng liên quan

- `ClassStudentsTab` đã phân tách học sinh đang học và nhận xét của từng học sinh; đây là vị trí đặt khối xác nhận.
- `Academic` hiện mở hành động gửi dựa trên `isEvaluationComplete`, chưa có phê duyệt của giáo viên.
- Luồng gửi học phí đơn lẻ có kiểm tra đủ nhận xét, nhưng gửi nhận xét và bulk job chưa có khóa phê duyệt dùng chung.
- Hành động gửi hạng hiện có thể chạy độc lập với trạng thái đủ nhận xét; hành vi này phải được đưa vào cùng khóa kết khóa.
- `handleResetCourse` hiện cập nhật ngày lớp trước khi archive nhận xét và tạo ledger, đồng thời chưa kiểm tra trạng thái gửi hoàn tất.
- Firestore Rules đã cấm client ghi trực tiếp vào `classes`, `students` và `evaluations`; toàn bộ mutation mới tiếp tục đi qua API server.

## 5. Mô hình dữ liệu

### 5.1 Định danh khóa hiện tại

Bổ sung vào document lớp:

```ts
currentCourseId: string;
```

`currentCourseId` là ID ổn định của một vòng khóa, không thay đổi khi ngày khóa được điều chỉnh. ID chỉ đổi khi Reset Course thành công. Với lớp cũ chưa có ID, endpoint xác nhận hoặc migration sẽ tạo ID trước khi cho phép gửi theo cơ chế mới.

### 5.2 Trạng thái kết khóa lưu trên lớp

```ts
type CourseClosingApprovalStatus = 'approved' | 'invalidated';

interface CourseClosingState {
  courseId: string;
  termStart: string;
  termEnd: string;
  approval?: {
    status: CourseClosingApprovalStatus;
    source: 'teacher' | 'admin' | 'migration';
    approvedAt: string;
    approvedBy: string;
    approvedByRole: 'teacher' | 'admin' | 'system';
    adminReason?: string;
    rosterFingerprint: string;
    evaluationFingerprint: string;
    invalidatedAt?: string;
    invalidatedBy?: string;
    invalidatedReason?: CourseClosingInvalidationReason;
  };
  exemptions?: CourseClosingExemption[];
}

interface CourseClosingExemption {
  studentId: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}
```

`courseClosing.courseId` phải bằng `currentCourseId`. `termStart` và `termEnd` là snapshot ngày tại lần xác nhận gần nhất; chúng không thay thế ngày thật trên lớp.

`CourseClosingInvalidationReason` là mã hữu hạn phục vụ UI và audit:

- `FINAL_EVALUATION_CHANGED`
- `REQUIRED_ROSTER_CHANGED`
- `COURSE_DATES_CHANGED`
- `APPROVAL_FINGERPRINT_MISMATCH`

### 5.3 Fingerprint

Backend tạo SHA-256 từ chuỗi canonical, không nhận fingerprint từ client:

- roster fingerprint: `courseId`, `startDate`, `endDate`, danh sách student ID bắt buộc đã sort;
- evaluation fingerprint: với từng student ID đã sort, ghép `studentId`, final evaluation ID và Firestore document update time.

Firestore document update time được ưu tiên hơn trường `updatedAt` để tránh timestamp client hoặc dữ liệu legacy không đồng nhất.

### 5.4 Bằng chứng gửi

Log Zalo mới của luồng kết khóa bổ sung:

```ts
courseId: string;
evaluationId?: string;
evaluationVersion?: string;
```

- Nhận xét và hạng phải gắn với `evaluationId` cùng `evaluationVersion` hiện hành.
- Học phí phải gắn với `courseId` hiện hành.
- Log thành công của khóa cũ, nhận xét cũ hoặc phiên bản cũ không được tính vào completion hiện tại.
- Mọi projection dùng cho read model, đặc biệt `projectedZaloNotificationDoc`, phải giữ nguyên `courseId`, `evaluationId` và `evaluationVersion`; không được làm rơi evidence rồi suy ra lại từ ngày hoặc payload khác.

### 5.5 Snapshot term đã lưu trữ

`terms` là mảng inline trên class document, không phải subcollection. Khi reset thành công, mỗi archived term phải giữ toàn bộ snapshot lịch đang được lưu có chủ đích và bổ sung identity/state của khóa:

```ts
interface ArchivedClassTerm {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  holidays: string[];
  weeklySessions: WeeklyClassSession[];
  daysOfWeek: number[];
  courseId: string;
  courseClosing?: CourseClosingState;
  resetOperationId: string;
}
```

`term.id` vẫn là định danh term độc lập và `evaluations.termId` tiếp tục trỏ tới nó; không dùng `courseId` làm `term.id`. `courseId` cũ được lưu ở field riêng. Khóa mới nhận `currentCourseId` mới và không kế thừa approval hay exemptions của khóa cũ.

## 6. Read model và state machine

Tạo helper server dùng chung `computeCourseClosingSnapshot`. Helper nhận class và các document liên quan, sau đó trả về read model canonical:

```ts
type CourseClosingStatus =
  | 'no_required_students'
  | 'missing_evaluations'
  | 'ready_for_approval'
  | 'stale'
  | 'approved'
  | 'sending'
  | 'completed';

interface CourseClosingSnapshot {
  courseId: string;
  status: CourseClosingStatus;
  approvalValid: boolean;
  requiredStudentCount: number;
  finalEvaluationCount: number;
  evaluationSentCount: number;
  rankRequiredCount: number;
  rankSentCount: number;
  tuitionSentCount: number;
  exemptStudentCount: number;
  exemptions: CourseClosingExemption[];
  lockedEvaluationIds: string[];
  missingEvaluationStudentIds: string[];
  pendingEvaluationStudentIds: string[];
  pendingRankStudentIds: string[];
  pendingTuitionStudentIds: string[];
  staleReason?: CourseClosingInvalidationReason;
  approvedAt?: string;
  approvedBy?: string;
  approvedByRole?: string;
}
```

State được derive, không tin một cờ `completed` lưu sẵn:

1. Không có học sinh bắt buộc: `no_required_students`; không cho approve hoặc reset theo luồng kết khóa.
2. Còn thiếu final evaluation: `missing_evaluations`.
3. Đủ final evaluation nhưng chưa có approval: `ready_for_approval`.
4. Có approval nhưng fingerprint/date/course ID không khớp: `stale`.
5. Approval hợp lệ và chưa có bằng chứng gửi: `approved`.
6. Approval hợp lệ và đã gửi một phần: `sending`.
7. Mọi requirement đã gửi hoặc được miễn: `completed`.

Một exemption đang hoạt động làm toàn bộ requirement còn thiếu của student đó được coi là đã xử lý cho đúng `courseId`. Các bằng chứng gửi đã có vẫn được giữ trong số liệu.

`lockedEvaluationIds` chứa đúng final evaluation ID đã có evaluation notice thành công cho current course/version. UI dùng danh sách này để khóa edit/delete; backend vẫn tự kiểm tra log trước mutation.

## 7. API và quyền

### 7.1 Đọc snapshot kết khóa

`GET /api/v1/classes/course-closing-status?classId=<id>`

Quy tắc:

- `teacher`: chỉ đọc lớp mình phụ trách;
- `admin` và `office`: đọc mọi lớp được phép nhìn thấy;
- role khác: `403`;
- response là `CourseClosingSnapshot` canonical do backend tính tại thời điểm request;
- `ClassDetail` dùng endpoint này thay vì tự suy luận completion từ class document;
- sau approve, exemption hoặc mutation liên quan, client refetch endpoint để hiển thị trạng thái mới.

Office Academic không gọi endpoint theo từng lớp; `readOfficeAcademic` gắn snapshot tương ứng vào mỗi `AcademicSummary` trong cùng read model hiện tại.

Kênh realtime `course-closing` phải được khai báo đồng bộ ở server và client: union server, union `RealtimeEventKey` trong `useInvalidationRefresh`, cùng `ROLE_ALLOWED_CHANNELS` cho `teacher`, `admin`, `office` và `accounting`. Registry client phải có test để tránh trạng thái server publish được nhưng client không thể subscribe.

### 7.2 Xác nhận kết khóa

`POST /api/v1/classes/approve-course-closing`

Body:

```ts
{
  classId: string;
  reason?: string;
}
```

Quy tắc:

- role `teacher`: phải là `teacherId` hiện tại của lớp; không cần reason;
- role `admin`: được xác nhận thay; reason sau trim là bắt buộc;
- role khác: `403`;
- backend tự tải class, active roster và current final evaluations;
- nếu không có học sinh bắt buộc: `409 COURSE_CLOSING_NO_REQUIRED_STUDENTS`;
- nếu thiếu final evaluation: `409 COURSE_CLOSING_EVALUATIONS_INCOMPLETE`;
- endpoint tạo `currentCourseId` cho lớp legacy nếu chưa có;
- endpoint tính fingerprint và lưu approval cùng audit;
- thao tác idempotent nếu cùng actor và cùng fingerprint đã được approve.

### 7.3 Miễn gửi

`POST /api/v1/classes/exempt-course-closing-student`

Body:

```ts
{
  classId: string;
  studentId: string;
  reason: string;
}
```

Quy tắc:

- chỉ `admin`;
- reason bắt buộc;
- student phải thuộc current required roster của class;
- class phải có approval hợp lệ; Admin không thể dùng exemption để bỏ qua bước giáo viên xác nhận;
- exemption được scope theo `currentCourseId`;
- thao tác ghi audit, không xóa log gửi đã tồn tại;
- endpoint trả snapshot mới để UI cập nhật ngay.

### 7.4 Invalidation

Tạo helper mutation dùng chung `invalidateCourseClosingApproval`, được gọi sau mutation thành công đối với:

- create/update/delete final evaluation của current course;
- thay đổi `classId`, enrollment status hoặc lifecycle làm tập required roster đổi;
- thay đổi `startDate` hoặc `endDate`.

Fingerprint re-check trong mọi guard vẫn là hàng rào authoritative nếu một mutation path cũ chưa gọi invalidation helper.

### 7.5 Khóa sửa nhận xét đã gửi

Trước update/delete final evaluation, backend tìm log nhận xét thành công khớp `courseId`, `evaluationId` và version hiện tại.

- Nếu có: trả `409 EVALUATION_ALREADY_SENT_LOCKED` và không ghi dữ liệu.
- Midterm evaluation không bị khóa bởi quy tắc này.
- Final evaluation được Admin miễn gửi nhưng chưa thực gửi vẫn có thể sửa; thao tác sửa sẽ làm approval mất hiệu lực.

## 8. Khóa gửi của Office

Mọi đường gửi kết khóa phải gọi cùng một guard server trước khi liên hệ Zalo:

- `handleNotifyEvaluation`;
- `handleNotifyRankAchievement`;
- `handleNotifyTuitionNotice`;
- `handleBulkNotificationJob` cho `evaluation`, `rank_achievement`, `tuition_notice`.

Guard yêu cầu:

1. `currentCourseId` khớp;
2. approval tồn tại và hợp lệ;
3. fingerprint hiện tại khớp;
4. student thuộc current required roster và chưa được miễn;
5. dependency theo student hợp lệ:
   - tuition chỉ gửi sau khi evaluation notice hợp lệ đã gửi;
   - rank chỉ gửi nếu current final evaluation có ranked value;
6. request chưa có bằng chứng gửi hợp lệ tương ứng.

Đối với bulk job, guard cấp lớp chạy trước khi tạo job. Mỗi item vẫn resolve current student/evaluation canonical để chống dữ liệu thay đổi hoặc payload giả mạo trong lúc job chạy.

Nội dung Zalo phải lấy từ final evaluation và class canonical ở server. Client chỉ gửi identity/intent cần thiết; `finalGrade`, comment, rank, course dates và tuition context không được dùng làm source of truth.

## 9. Reset Course

`handleResetCourse` phải gọi `computeCourseClosingSnapshot` trước bất kỳ domain write nào của một operation mới. Guard và việc xoay class được re-check trong transaction trên class document; evaluations không bị ép vào transaction đó.

Request reset bổ sung `operationId` dạng UUID. Reset modal tạo một ID cho mỗi lần submit và giữ nguyên ID đó khi retry sau timeout. Archived term lưu `resetOperationId`; nếu server nhận lại cùng `operationId`, handler trả kết quả đã tạo thay vì archive term hoặc tạo ledger lần hai.

- Nếu snapshot không phải `completed`, trả HTTP `409` với:

```ts
{
  success: false;
  errorCode: 'COURSE_CLOSING_INCOMPLETE';
  error: string;
  courseClosing: CourseClosingSnapshot;
}
```

- Không role nào bypass guard.
- Class dates, terms, evaluations và ledgers phải không thay đổi khi guard từ chối.
- Khi guard cho phép:
  1. trong transaction nhỏ trên class document, re-check snapshot, append đúng một archived term inline có `resetOperationId`, giữ `name`, `holidays`, `weeklySessions`, `daysOfWeek`, dates, old `courseId` và old `courseClosing`;
  2. trong cùng transaction, cập nhật ngày khóa, tạo `currentCourseId` mới và xóa current approval/exemptions;
  3. sau transaction, gọi `archiveCurrentCourseEvaluations` theo cơ chế batch 450 hiện có, nhưng làm nó idempotent: chỉ gắn các evaluation thuộc khóa cũ chưa trỏ tới archived term đó, bỏ qua evaluation của khóa mới và record đã archive;
  4. tạo ledger khóa mới bằng logic ID xác định/idempotent hiện có;
  5. ghi audit và realtime events.

Không đặt giới hạn số evaluation để nhét toàn bộ archive vào một transaction. Nếu một bước sau transaction thất bại, retry cùng `operationId` phải tìm archived term trước khi guard khóa mới, chạy lại phần archive/ledger còn thiếu và không append term, rotate course hoặc tạo ledger lần hai. `term.id` có thể được tạo ổn định theo operation nhưng vẫn phải là term ID riêng, không đồng nhất với old `courseId`.

## 10. Giao diện

### 10.1 Class Detail / Students

Thêm khối `CourseClosingApprovalPanel` phía trên roster:

- số final evaluation / required students;
- trạng thái hiện tại và lý do stale nếu có;
- thông tin người/thời gian xác nhận;
- nút xác nhận chỉ enable khi snapshot là `ready_for_approval` hoặc `stale` và lớp không archived/paused;
- modal xác nhận hiển thị class dates, student count và cảnh báo thay đổi sẽ thu hồi approval;
- Admin bắt buộc nhập reason;
- office chỉ xem, không được xác nhận;
- final evaluation đã gửi ẩn hoặc disable edit/delete với tooltip rõ ràng.

Admin hiện không thấy Students tab trong `ClassDetailTabs`; tab sẽ được mở cho Admin để thực hiện xác nhận thay theo quyền đã chốt.

### 10.2 Office Academic

`AcademicSummary` nhận thêm `courseClosing: CourseClosingSnapshot`.

Hiển thị một trong các nhãn:

- `Chờ giáo viên nhập nhận xét`;
- `Chờ giáo viên xác nhận`;
- `Xác nhận đã mất hiệu lực`;
- `Đã xác nhận — có thể gửi`;
- `Đang gửi`;
- `Đã hoàn tất`.

Tất cả action gửi theo lớp và theo student bị disable nếu approval không hợp lệ. Quy tắc này áp dụng cho cả bốn mode của `runBatch`: `evaluation`, `rank`, `tuition` và `both`; `both` không được trở thành đường bypass. Quy tắc cũng áp dụng cả rank, khắc phục việc rank hiện có thể gửi độc lập trước khi lớp được duyệt.

Admin có action `Miễn gửi` trên student row, mở modal bắt buộc reason. Office chỉ xem trạng thái và lý do exemption.

### 10.3 Reset Course

`useClassDetailMisc` hiển thị `ApiError.message` và `ApiError.data.errorCode` thật từ API thay vì luôn dùng toast chung. Ví dụ:

> Chưa thể Reset Course: còn 2 học sinh chưa gửi học phí và 1 học sinh chưa gửi hạng.

Reset modal hiển thị snapshot completion trước khi submit để người dùng hiểu nút sẽ bị chặn; backend vẫn là nguồn quyết định cuối cùng.

## 11. Lỗi nghiệp vụ

- `COURSE_CLOSING_EVALUATIONS_INCOMPLETE`
- `COURSE_CLOSING_NO_REQUIRED_STUDENTS`
- `COURSE_CLOSING_NOT_APPROVED`
- `COURSE_CLOSING_STALE`
- `COURSE_CLOSING_INCOMPLETE`
- `COURSE_CLOSING_STUDENT_EXEMPT`
- `EVALUATION_ALREADY_SENT_LOCKED`

API trả `409` cho xung đột trạng thái, `403` cho sai quyền, `400` cho payload/reason không hợp lệ và `404` cho class/student/evaluation không tồn tại.

## 12. Audit và quan sát

Ghi audit cho:

- teacher approval;
- Admin approval thay và reason;
- approval invalidation cùng reason code;
- Admin exemption cùng reason;
- reset bị từ chối do chưa hoàn tất;
- reset thành công cùng old/new course ID.

Không ghi số điện thoại hoặc nội dung nhận xét đầy đủ vào metadata audit mới. Structured server logs dùng `errorCode` và class/course ID để hỗ trợ điều tra.

## 13. Migration và tương thích dữ liệu cũ

Tạo migration idempotent, có dry-run, để:

1. gán `currentCourseId` cho lớp hiện tại chưa có;
2. xác định active roster và selected current final evaluation bằng helper dùng chung;
3. liên kết log current course hiện có với course ID mới khi có đủ bằng chứng;
4. liên kết evaluation log với current evaluation chỉ khi timestamp chứng minh evaluation không được sửa sau khi gửi;
5. đánh dấu record không đủ bằng chứng là cần Admin xem xét, không tự tính completed.

Chính sách rollout:

- lớp legacy đã chứng minh gửi đủ mọi requirement được migration approval source `migration` và giữ trạng thái completed;
- lớp đã gửi một phần giữ các bằng chứng hợp lệ nhưng phải được teacher/Admin approve trước khi gửi phần còn lại;
- log mơ hồ không bị xóa; Admin giải quyết bằng quy trình miễn gửi có reason nếu không thể gửi lại an toàn;
- migration không gửi Zalo, không reset lớp và không tạo ledger.

## 14. Kiểm thử

### 14.1 Unit

- active/on-leave/archived roster selection;
- current final evaluation selection;
- roster/evaluation fingerprint ổn định với input đã sort;
- fingerprint đổi khi roster, dates hoặc evaluation version đổi;
- snapshot Firestore dùng chung trong test luôn có `updateTime.toDate()` xác định và transaction mock hỗ trợ cùng kiểu read/write mà production helper sử dụng;
- rank requirement;
- exemption completion;
- state machine và pending student lists;
- legacy log matching.

### 14.2 API

- teacher owner approve thành công;
- teacher không sở hữu class bị từ chối;
- Admin thiếu reason bị từ chối, có reason thành công;
- approval bị từ chối khi thiếu final evaluation;
- create/update/delete final evaluation invalidates approval;
- update/delete sent final evaluation bị khóa;
- student lifecycle và class date mutation làm approval stale;
- single evaluation/rank/tuition và bulk job đều bị khóa trước approval;
- payload giả mạo không thay thế canonical evaluation/date/fee;
- Office read projection giữ đủ `courseId`, `evaluationId`, `evaluationVersion` để evidence không bị rơi;
- Admin exemption quyền và audit;
- reset incomplete trả `409` và không có write phụ;
- reset completed archive state, rotate course ID, clear approval và tạo ledger một lần;
- retry reset không tạo term/ledger trùng;
- reset với hơn 500 evaluation vẫn archive theo nhiều batch 450;
- archived term inline giữ `name`, `holidays`, `weeklySessions`, `daysOfWeek` và evaluation tiếp tục trỏ tới `term.id` độc lập.

### 14.3 UI

- approval panel counts và trạng thái;
- teacher/Admin/office permission rendering;
- Admin reason validation;
- edit/delete lock badge;
- Office class/student send buttons disable/enable đúng snapshot;
- rank và batch mode `both` không bypass approval;
- exemption modal chỉ hiện với Admin;
- reset toast hiển thị chi tiết từ API;
- client realtime registry cho phép bốn role liên quan subscribe `course-closing`.

### 14.4 Tích hợp

Luồng chuẩn:

1. teacher lưu final evaluation cuối cùng;
2. teacher approve;
3. Office gửi evaluation, rank nếu có và tuition;
4. snapshot chuyển completed;
5. Reset Course thành công;
6. khóa mới có course ID mới và Office bị khóa lại.

Luồng lỗi:

- sửa nhận xét trước khi gửi làm stale;
- thay đổi ngày làm stale;
- Zalo fail giữ trạng thái sending/incomplete;
- Admin exemption hoàn tất student không thể nhận;
- reset trong mọi trạng thái chưa completed đều không thay đổi dữ liệu;
- lỗi sau khi class đã rotate được retry cùng `operationId` để hoàn tất archive nhiều batch và ledger mà không nhân đôi term.

## 15. Tiêu chí nghiệm thu

1. Không có API gửi kết khóa nào gửi thành công khi approval không hợp lệ.
2. Không thể Reset Course khi còn bất kỳ requirement chưa gửi/chưa exempt.
3. Không thể sửa/xóa final evaluation đã gửi.
4. Thay đổi roster, current final evaluation hoặc dates làm approval mất hiệu lực ngay ở read model và tại backend guard.
5. Mọi notification mới được gắn đúng `currentCourseId`; evaluation/rank được gắn đúng version.
6. UI của giáo viên và Office phản ánh cùng một snapshot backend.
7. Dữ liệu legacy được migration theo chính sách bảo thủ, không tự gửi hoặc reset.
8. Test unit, API, UI và integration liên quan đều pass.

## 16. Ngoài phạm vi

- Force reset bỏ qua completion.
- Cho Office tự xác nhận hoặc tự miễn gửi.
- Cho sửa nhận xét đã gửi hoặc xây dựng luồng gửi bản đính chính.
- Thay đổi template/nội dung Zalo ngoài việc lấy dữ liệu canonical.
- Thiết kế lại toàn bộ ledger hoặc cơ chế thu học phí.
- Mở Firestore client write cho các collection liên quan.
