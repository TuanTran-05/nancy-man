# Khung schema PostgreSQL — di trú từ Firestore

Ngày: 2026-08-18
Trạng thái: bản thảo, chờ duyệt
Phạm vi: **chỉ thiết kế khung bảng**. Việc đổ dữ liệu, viết repository, và cutover nằm ở tài liệu khác.

## Bối cảnh và các quyết định đã chốt

| Quyết định | Chọn |
|---|---|
| Nền tảng | PostgreSQL, đóng gói Supabase self-hosted trên Ubuntu |
| Phạm vi di trú | Cả dữ liệu lẫn compute rời Vercel về Ubuntu |
| Mô hình schema | Quan hệ toàn bộ 67 collection |
| Đường đọc của client | API-only — client không chạm Postgres |
| Cutover | Một nhát, có cửa sổ bảo trì |

Nguồn: `firestore.rules` (67 `match`), `src/types/*.ts`, `shared/*.ts`.

---

## 1. Quy ước áp cho toàn bộ schema

### 1.1 Khoá chính

`id TEXT PRIMARY KEY`, **giữ nguyên document ID hiện có của Firestore**.

Lý do: mọi tham chiếu chéo giữa 67 collection đang là chuỗi ID. Giữ nguyên thì bước load không cần bảng ánh xạ ID cũ→mới, và không có cơ hội ánh xạ sai. Bản ghi tạo mới sau cutover dùng ID sinh từ `shared/idGenerator.ts` như hiện tại.

**Ngoại lệ có chủ ý — không bao giờ suy ID từ nội dung.** `student_course_enrollments` hiện lấy ID là base64 của bộ ba `[studentId, classId, termStart]`; `admin_class_tuition_summaries` lấy `${classId}__${termStart}`; `course_fee_ledgers` từng bị lệch giữa doc ID và chính trường `term` của nó. Đây là cùng một lỗi lặp lại ba lần: ID mang ngữ nghĩa thì khi ngữ nghĩa đổi, ID nói dối.

Quy ước mới: **ID là khoá thay thế vô nghĩa; tính duy nhất do `UNIQUE` constraint đảm bảo.**

```sql
id          TEXT PRIMARY KEY,
student_id  TEXT NOT NULL REFERENCES students(id),
class_id    TEXT NOT NULL REFERENCES classes(id),
term_start  DATE NOT NULL,
UNIQUE (student_id, class_id, term_start)
```

### 1.2 Kiểu thời gian

Code phân biệt rất kỹ hai loại (`isApiDateOnly` vs `isTimestamp` trong `shared/dateTimeFormat.ts`). Schema giữ nguyên sự phân biệt đó:

- `DATE` cho ngày lịch: `termStart`, `termEnd`, `joinedAt`, `date` của điểm danh, `dueDate`, `receivedDate`.
- `TIMESTAMPTZ` cho mốc thời gian: `createdAt`, `updatedAt`, `statusChangedAt`, `postedAt`.

Lưu ý di trú: 72 document `users` đang lưu `updatedAt` là Firestore `Timestamp` chứ không phải chuỗi ISO như type khai báo. Script transform phải nhận cả hai dạng.

Múi giờ lưu UTC; hiển thị theo `Asia/Ho_Chi_Minh` ở tầng ứng dụng, giữ nguyên hành vi `date-fns-tz` hiện tại.

### 1.3 Tiền

`NUMERIC(14,2)` cho mọi trường tiền. Không dùng `float` ở bất kỳ đâu.

Bảng nào có tiền thì có `currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND','USD'))` — `TuitionConfig` đã khai báo cả hai.

Ràng buộc dấu theo đúng luật nghiệp vụ trong `shared/wallet.ts`: **số tiền giao dịch ví luôn dương, chiều đi từ `type`**.

```sql
amount NUMERIC(14,2) NOT NULL CHECK (amount > 0)
```

### 1.4 Enum

Dùng `TEXT` + `CHECK (col IN (...))`, **không** dùng `CREATE TYPE ... AS ENUM`.

Lý do: schema này có hơn 40 tập giá trị, phần lớn đã đổi ít nhất một lần trong lịch sử repo. `CHECK` sửa được bằng một câu `ALTER TABLE`; native enum không xoá được giá trị và phải `ALTER TYPE`. Đổi lại là mất một chút tự tài liệu hoá — bù bằng cách đặt danh sách giá trị cạnh định nghĩa bảng trong Drizzle schema, sinh ra từ chính các hằng `as const` trong `shared/`.

### 1.5 Xoá mềm

Bỏ hẳn. Không có `deletedAt`, không có tombstone, không có cờ `isRevoked` đóng vai trò xoá.

Thay bằng: `ON DELETE RESTRICT` trên mọi khoá ngoại trỏ tới thực thể có tiền hoặc có lịch sử. Muốn xoá học sinh còn ledger thì database từ chối. Lịch sử ai xoá cái gì nằm ở `audit_logs`.

`isRevoked` được giữ lại nhưng chỉ mang đúng nghĩa của nó: **thu hồi quyền đăng nhập**, không phải xoá bản ghi.

### 1.6 Trường dẫn xuất

Không lưu thành cột. Chuyển thành `VIEW` hoặc `MATERIALIZED VIEW`:

| Đang lưu sẵn | Thành |
|---|---|
| `Class.studentCounts{total,active,trial,onLeave,dropped,promoted}` | `VIEW v_class_student_counts` |
| `Student.walletBalance` | `VIEW v_student_wallet_balance` (khai triển `computeWalletBalanceFromOpening`) |
| `CourseFeeLedger.paidTotal`, `discountTotal`, `siblingDiscountTotal` | `VIEW v_ledger_totals` từ `receipt_allocations` |
| `accounting_student_summaries` | `MATERIALIZED VIEW mv_accounting_student_summary` |
| `admin_class_tuition_summaries` | `MATERIALIZED VIEW mv_admin_class_tuition_summary` |

Hai materialized view giữ lại vì chúng phục vụ trang danh sách lớn cần độ trễ thấp; refresh theo lịch và sau ghi tiền, thay cho cơ chế outbox + health hiện tại.

`status` của ledger (`unpaid|partial|paid|waived`) vẫn là **cột thật**, vì `waived` là quyết định của con người chứ không suy ra được từ số tiền.

### 1.7 Bản sao tên

Mọi cột kiểu `*Name` copy từ bảng khác đều bị xoá: `SubstituteRequest.requestingTeacherName` / `substituteTeacherName` / `className`, `PrintRequest.teacherName` / `className`, `Submission.studentName`, `KnowledgeBankItem.uploadedByName` / `className`, `Receipt.createdByName` / `voidedByName`, `WalletTransaction.createdByName` / `approvedByName` / `voidedByName`.

API vẫn trả về chúng, lấy bằng `JOIN`. Hợp đồng với client không đổi.

**Ngoại lệ — snapshot có chủ đích được giữ.** `Invoice.studentSnapshot`, `classSnapshot`, `ledgerAmountSnapshot`, và `CourseClosingRecord.*Snapshot` không phải cache: chúng là bằng chứng pháp lý về trạng thái tại thời điểm phát hành. Chúng ở lại, dưới dạng cột thật hoặc `JSONB`, và **không** JOIN lại.

---

## 2. Sáu collection bị xoá, không port

| Collection | Vì sao biến mất |
|---|---|
| `student_code_registry` | Tồn tại chỉ để chống race khi cấp mã, bằng cách dùng chính mã làm doc ID. Thay bằng `UNIQUE (code_normalized)` trên `students`. |
| `student_profile_aliases` | Trỏ ID cũ sang ID chuẩn sau khi gộp. Trong Postgres, gộp là `UPDATE` mọi bảng con trong một transaction; không còn ID cũ để trỏ. |
| `student_profile_merge_journal` | Nhật ký gộp. Thay bằng `audit_logs`. |
| `student_profile_merge_runs` | Phiên chạy engine gộp. Không còn engine. |
| `student_identity_health` | Bộ quét phát hiện trùng/mồ côi. `UNIQUE` + `FOREIGN KEY` khiến trạng thái đó không xảy ra được. |
| `student_identity_health_runs` | Phiên chạy bộ quét. |
| `student_identity_health_conflicts` | Kết quả bộ quét. |
| `realtime_events` | 20 kênh tín hiệu invalidation. Thành `LISTEN/NOTIFY`; danh sách kênh và `roleScope` giữ nguyên trong `server/api/lib/realtime/events.ts`. |
| `accounting_student_summary_health` | Theo dõi sức khoẻ của một cache. Cache thành materialized view, refresh có transaction — không có trạng thái "lệch" để theo dõi. |
| `admin_class_tuition_health` | Như trên. |
| `system/connection-test` | Doc kiểm tra kết nối. Thay bằng health endpoint. |

Kèm theo đó, các trường bóng trên `students` bị xoá: `canonicalProfileId`, `requestedProfileId`, `redirected`, `placementStatus`, `mergedIntoStudentId`, `studentProfileState`.

**Điều kiện tiên quyết:** trước cutover, mọi hồ sơ trùng phải được gộp thật. Bước load sẽ fail ở `UNIQUE (code_normalized)` nếu còn sót — đó là hàng rào, không phải lỗi.

---

## 3. Khung bảng theo miền

Tổng: **62 bảng** + 5 view + 2 materialized view.

### 3.1 Danh tính và truy cập (11 bảng)

#### `users`
Tài khoản staff và tài khoản liên kết. Từ `UserProfile`.

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | TEXT PK | uid cũ |
| `email` | TEXT UNIQUE | NULL cho tài khoản không email |
| `display_name` | TEXT | |
| `bio` | TEXT | |
| `role` | TEXT NOT NULL | CHECK: teacher, student, parent, admin, accounting, office |
| `phone` | TEXT | Zalo OA |
| `student_id` | TEXT REFERENCES students(id) | chỉ role student/parent |
| `force_password_change` | BOOLEAN NOT NULL DEFAULT false | |
| `is_revoked` | BOOLEAN NOT NULL DEFAULT false | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Xoá khỏi bảng này: `classId`, `teacherId`, `faceImage`, `enrollmentStatus`, `statusChangedAt`, `blockedTeacher`, `blockedAt` — tất cả là bản sao từ `students` hoặc thuộc về `staff_email_access`.

#### `students`
Trung tâm của schema.

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | TEXT PK | |
| `code` | TEXT NOT NULL | mã đăng nhập |
| `code_normalized` | TEXT NOT NULL **UNIQUE** | **Ràng buộc chặn 59 mã trùng tận gốc** |
| `name` | TEXT NOT NULL | |
| `name_normalized` | TEXT NOT NULL | phục vụ tìm kiếm, có index GIN |
| `school_student_id` | TEXT | trường `studentId` cũ — đổi tên để hết nhập nhằng với FK |
| `dob` | DATE | |
| `contact` | TEXT | |
| `gender` | TEXT | CHECK: male, female, other |
| `grade` | SMALLINT | CHECK BETWEEN 1 AND 12 |
| `sibling_group_id` | TEXT | index; dùng cho học bổng anh chị em |
| `student_lifecycle` | TEXT NOT NULL | CHECK: pending, lead, trial, enrolled, archived |
| `admission_status` | TEXT | CHECK: pending, trial, accepted, rejected |
| `trial_review_status` | TEXT | CHECK: pending_sessions, pending_teacher_review, accepted, rejected |
| `trial_*` | | 6 cột trial giữ nguyên |
| `admitted_at` / `admitted_by` | TIMESTAMPTZ / TEXT | |
| `enrollment_date` | DATE | |
| `face_image_storage_path` | TEXT | |
| `is_revoked` | BOOLEAN NOT NULL DEFAULT false | |
| `created_at` / `updated_at` | TIMESTAMPTZ NOT NULL | |

**Bị chuyển đi khỏi bảng này:**
- `classId`, `teacherId` → suy từ `student_course_enrollments` đang mở. Học sinh có thể học nhiều lớp; một cột `classId` chưa bao giờ diễn tả nổi điều đó.
- `enrollmentStatus` → thuộc về từng enrollment, không thuộc về con người.
- `courseJoins[]` → `student_course_enrollments`.
- `leavePeriods[]` → `student_leave_periods`.
- `walletBalance`, `walletOpeningBalance`, `walletHistoryStartedAt` → `student_wallets`.
- `loginPasswordHash/Salt/Version`, `parentPassword*`, `forcePasswordChange`, `parentForcePasswordChange` → `student_auth_credentials`.
- `faceImage` (base64) → chỉ giữ `face_image_storage_path`. Base64 trong DB là lãng phí.

#### `student_auth_credentials`
Tách khỏi `students` để dữ liệu bí mật không đi kèm mọi truy vấn roster.

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `student_id` | TEXT PK REFERENCES students(id) ON DELETE CASCADE | |
| `student_password_hash` / `_salt` / `_version` | TEXT / TEXT / SMALLINT | version CHECK IN (1,2) — 1=SHA-256 legacy, 2=PBKDF2 |
| `student_force_password_change` | BOOLEAN NOT NULL DEFAULT false | |
| `parent_password_hash` / `_salt` / `_version` | | |
| `parent_force_password_change` | BOOLEAN NOT NULL DEFAULT false | |
| `updated_at` | TIMESTAMPTZ NOT NULL | |

**Đây là bảng khiến học sinh và phụ huynh không phải đặt lại mật khẩu khi cutover** — hash do code tự sinh, đi thẳng sang Postgres.

#### `staff_email_access` + hai view

Gộp `allowed_teachers` + `blocked_teachers` + `config/allowedStaff` thành **một bảng lưu trữ**, rồi dựng lại **hai view mang đúng tên cũ** để UI và repository vẫn thấy hai danh sách riêng.

```sql
CREATE TABLE staff_email_access (
  email          TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('allowed','blocked')),
  role           TEXT,                    -- chỉ có nghĩa khi allowed
  added_at       TIMESTAMPTZ,
  added_by_admin BOOLEAN,
  blocked_at     TIMESTAMPTZ,             -- chỉ có nghĩa khi blocked
  CONSTRAINT allowed_needs_role CHECK (status = 'blocked' OR role IS NOT NULL)
);

CREATE VIEW allowed_teachers AS
  SELECT email, role, added_at, added_by_admin
  FROM staff_email_access WHERE status = 'allowed';

CREATE VIEW blocked_teachers AS
  SELECT email, blocked_at
  FROM staff_email_access WHERE status = 'blocked';
```

**Bằng chứng cho quyết định này** (đã thảo luận và chốt 2026-08-18):

Code hiện tại xử lý hai collection như *một trạng thái*, không phải hai thực thể.

- Chặn — `staffAccountManagement.ts:572-576`: `set(blocked_teachers)` rồi `delete(allowed_teachers)`.
- Bỏ chặn — `:518-522`: `delete(blocked_teachers)` rồi `set(allowed_teachers)`.

Hai `await` rời nhau, **không transaction**. Lệnh hai fail thì email nằm ở cả hai danh sách hoặc không ở đâu.

Quyết định hơn: lúc đăng nhập, `shared/handlers/shared.ts:134-156` đọc **cả hai** rồi phân xử `if (blockedSnap.exists || existing.blockedTeacher === true) → revoked`. Luật ưu tiên đó tồn tại **chính vì** cả hai có thể cùng đúng.

Và có bản sao thứ ba: `users.blockedTeacher` + `users.blockedAt`. Cùng một sự thật ở ba nơi, login phải `OR` hai trong số đó.

Postgres **không** có ràng buộc nào diễn tả được "email này không được ở cả hai bảng" — hai bảng thì chỉ chặn được bằng trigger. Một bảng có cột `status` khiến mâu thuẫn đó không biểu diễn nổi.

Kết quả của thiết kế này:

- UI admin giữ nguyên hai tab "Danh sách cấp quyền" / "Danh sách chặn", đọc hai view — không phải sửa.
- Repository giữ hai hàm riêng.
- Chặn/bỏ chặn thành **một câu `UPDATE`**, hết chuyện hỏng giữa chừng.
- `users.blockedTeacher` và `users.blockedAt` **bị xoá** — hết bản sao thứ ba.

#### Còn lại trong miền này
`teacher_registration_requests`, `staff_account_requests`, `password_reset_requests`, `staff_password_reset_requests`, `student_progression_events`, `maintenance_flags` (từ `_maintenance`), `system_settings`.

`password_reset_requests` bỏ cột `studentName` (JOIN), giữ `student_id` FK và `phone_number`.

---

### 3.2 Học thuật (12 bảng)

#### `classes`

Giữ: `id`, `name`, `description`, `room`, `teacher_id` FK → `users`, `status` CHECK IN ('active','paused','archived'), `grade`, `salary_per_session` NUMERIC, `created_at`, `updated_at`.

**Chuyển đi:** `terms[]` → `class_terms`; `weeklySessions[]` → `class_term_weekly_sessions`; `holidays[]` → `class_holidays`; `studentCounts{}` → view; `courseClosing{}` → `course_closings`; `startDate`/`endDate`/`startTime`/`daysOfWeek`/`schedule`/`tuitionFee`/`currentCourseId` → thuộc về **kỳ học hiện tại**, không thuộc về lớp.

Đây là chuẩn hoá lớn nhất của miền học thuật: một `Class` hiện đang mang lẫn thuộc tính vĩnh viễn (tên, phòng, giáo viên) và thuộc tính của kỳ đang chạy (ngày bắt đầu, học phí, lịch tuần), rồi `terms[]` giữ bản sao của các kỳ cũ. Tách ra thì "kỳ hiện tại" chỉ là hàng có `term_end` lớn nhất.

#### `class_terms`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | TEXT PK | |
| `class_id` | TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT | |
| `course_id` | TEXT | định danh khoá do nghiệp vụ đặt |
| `name` | TEXT | |
| `term_start` | DATE NOT NULL | |
| `term_end` | DATE | NULL = đang mở |
| `tuition_fee` | NUMERIC(14,2) | |
| `start_time` | TIME | |
| `days_of_week` | SMALLINT[] | 0=CN … 6=T7 |
| `reset_operation_id` | TEXT | |
| | | CHECK (`term_end` IS NULL OR `term_end` >= `term_start`) |
| | | UNIQUE (`class_id`, `term_start`) |
| | | EXCLUDE ràng buộc chống hai kỳ chồng lấn cùng lớp (dùng `btree_gist`) |

Ràng buộc EXCLUDE là thứ Firestore không thể có, và nó chặn đúng lớp lỗi "term chồng nhau" từng gây ra ledger trùng.

#### Còn lại
`class_term_weekly_sessions` (day_of_week, start_time, end_time, room — FK → `class_terms`), `class_holidays` (term_id, holiday_date, UNIQUE), `class_sessions` (buổi dạy thật, kèm điểm danh giáo viên), `student_course_enrollments`, `student_leave_periods`, `attendance`, `evaluations`, `daily_reports`, `substitute_requests`, `teacher_attendance` (nếu tách khỏi `class_sessions`).

#### `student_course_enrollments` — bảng bản lề

Mọi bất biến trong `assertValidStudentCourseEnrollment()` chuyển thành `CHECK`:

```sql
CREATE TABLE student_course_enrollments (
  id                TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL REFERENCES students(id)   ON DELETE RESTRICT,
  class_id          TEXT NOT NULL REFERENCES classes(id)    ON DELETE RESTRICT,
  term_id           TEXT          REFERENCES class_terms(id) ON DELETE RESTRICT,
  term_start        DATE NOT NULL,
  term_end          DATE,
  status            TEXT NOT NULL
                    CHECK (status IN ('trial','active','on_leave',
                                      'completed','transferred','dropped')),
  joined_at         DATE NOT NULL,
  ended_at          DATE,
  status_reason     TEXT,
  source            TEXT NOT NULL CHECK (source IN ('system','backfill','manual')),
  confidence        TEXT NOT NULL CHECK (confidence IN ('confirmed','inferred')),
  status_changed_at TIMESTAMPTZ NOT NULL,
  status_changed_by TEXT NOT NULL,
  confirmed_at      TIMESTAMPTZ,
  confirmed_by      TEXT,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,

  UNIQUE (student_id, class_id, term_start),

  CONSTRAINT term_order      CHECK (term_end IS NULL OR term_end >= term_start),
  CONSTRAINT joined_in_term  CHECK (joined_at >= term_start
                                    AND (term_end IS NULL OR joined_at <= term_end)),
  CONSTRAINT open_has_no_end CHECK (
    (status IN ('trial','active','on_leave') AND ended_at IS NULL) OR
    (status IN ('completed','transferred','dropped') AND ended_at IS NOT NULL
     AND ended_at >= joined_at)),
  CONSTRAINT confirm_pair    CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL))
);
```

Điều đáng nói: hôm nay những luật này chỉ được kiểm ở tầng ứng dụng, nên bất kỳ script nào ghi thẳng đều đi vòng qua chúng — và đã đi vòng, nhiều lần. Đặt xuống DB thì không script nào lách được.

#### `attendance`

`UNIQUE (student_id, class_id, date)` — chặn điểm danh trùng. Thêm `enrollment_id` FK để buổi điểm danh gắn với đúng kỳ, xoá nhu cầu suy ngược kỳ từ ngày.

---

### 3.3 Bài tập và học liệu (9 bảng)

`assignments`, `assignment_questions`, `assignment_question_options`, `submissions`, `submission_quiz_answers`, `submission_assessment_answers`, `quiz_answers` (subcollection cũ `assignments/{id}/quiz_answers`), `knowledge_bank_items`, `curriculums`, `exam_bank`, `exam_templates`.

`Assignment.questions[]` tách ba tầng: assignment → question → option. `correct_answer` là `TEXT` trỏ tới `option.key`, có CHECK đảm bảo tồn tại (dùng trigger hoặc FK ghép `(question_id, key)`).

`Submission.examIntegrity{}` giữ nguyên là cột riêng lẻ (5 trường), không JSONB — chúng cố định và có truy vấn thống kê.

`Assignment.assessment` và `deliveryPolicy` là cấu hình lồng nhiều tầng, ít truy vấn → `JSONB`.

---

### 3.4 Tài chính (15 bảng)

Miền có ràng buộc chặt nhất, vì đây là chỗ đã mất tiền.

#### `course_fee_ledgers`

```sql
id                TEXT PRIMARY KEY,
student_id        TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
class_id          TEXT NOT NULL REFERENCES classes(id)  ON DELETE RESTRICT,
enrollment_id     TEXT          REFERENCES student_course_enrollments(id),
term_start        DATE,
term_end          DATE,
amount            NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
status            TEXT NOT NULL CHECK (status IN ('unpaid','partial','paid','waived')),
period_type       TEXT CHECK (period_type IN ('course','monthly')),
month             TEXT,
source            TEXT CHECK (source IN ('course','legacy_tuition')),
due_date          DATE,
...
UNIQUE (student_id, class_id, term_start)
```

`paidTotal`, `discountTotal`, `siblingDiscountTotal` **không còn là cột** — chúng là view tổng trên `receipt_allocations`. Đây là nguồn gốc trực tiếp của các đợt lệch số dư: ba con số chạy song song với chứng từ và không có gì buộc chúng khớp.

`UNIQUE (student_id, class_id, term_start)` là ràng buộc chặn ledger trùng — thay cho việc app phải tự dedupe theo bộ ba khi đọc.

Nhóm 14 cột `tuitionReminder*` / `tuitionNotice*` tách sang bảng `ledger_notice_log` (một hàng một lần gửi), thay vì đè lên nhau trong cùng document. Đếm số lần nhắc thành `COUNT(*)`.

#### `receipts` và `receipt_allocations`

`Receipt.allocations[]` → bảng con. Đây là bảng khiến `paidTotal` trở thành dẫn xuất được:

```sql
CREATE TABLE receipt_allocations (
  id              TEXT PRIMARY KEY,
  receipt_id      TEXT NOT NULL REFERENCES receipts(id) ON DELETE RESTRICT,
  ledger_id       TEXT NOT NULL REFERENCES course_fee_ledgers(id) ON DELETE RESTRICT,
  class_id        TEXT NOT NULL REFERENCES classes(id),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  discount_type   TEXT CHECK (discount_type IN ('none','first_prize','second_prize',
                                                'full_waiver','hardship','custom')),
  discount_amount NUMERIC(14,2) DEFAULT 0 CHECK (discount_amount >= 0),
  discount_percent NUMERIC(5,2),
  discount_reason TEXT,
  sibling_discount BOOLEAN NOT NULL DEFAULT false,
  sibling_discount_amount NUMERIC(14,2) DEFAULT 0,
  UNIQUE (receipt_id, ledger_id)
);
```

`receipts.receipt_no` `UNIQUE` — số biên lai cấp bằng `SEQUENCE` thay cho `counterSequence.ts` chạy transaction trên Firestore.

Bất biến cần trigger (không diễn tả nổi bằng CHECK một hàng): tổng `receipt_allocations.amount` của một biên lai đã `posted` phải bằng `receipts.amount_received`, trừ biên lai nạp ví (`wallet_deposit = true`, không có allocation).

#### `student_wallets` và `wallet_transactions`

```sql
CREATE TABLE student_wallets (
  student_id       TEXT PRIMARY KEY REFERENCES students(id) ON DELETE RESTRICT,
  opening_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
  history_started_at DATE
);
```

Số dư **không lưu**. `VIEW v_student_wallet_balance` khai triển đúng `computeWalletBalanceFromOpening`:

```sql
CREATE VIEW v_student_wallet_balance AS
SELECT w.student_id,
       w.opening_balance + COALESCE(SUM(
         CASE t.type
           WHEN 'deposit'    THEN  t.amount
           WHEN 'credit'     THEN  t.amount
           WHEN 'allocation' THEN -t.amount
           WHEN 'refund'     THEN -t.amount
           WHEN 'adjustment' THEN CASE WHEN t.direction = 'out'
                                       THEN -t.amount ELSE t.amount END
         END), 0) AS balance
FROM student_wallets w
LEFT JOIN wallet_transactions t
  ON t.student_id = w.student_id AND t.status = 'posted'
GROUP BY w.student_id, w.opening_balance;
```

View trả **số học thật, kể cả khi âm** — đúng chủ ý đã ghi trong `shared/wallet.ts`: số dư âm phải lộ ra để đối chiếu bắt được, chứ không bị `Math.max(0, …)` che đi.

#### Còn lại
`invoices`, `invoice_line_items`, `expenses`, `refunds`, `tuition_records` (legacy, chỉ đọc), `tuition_configs`, `payment_requests`, `payment_review_cases`, `webhook_events`, `admin_notifications`, `ledger_notice_log`, `outbox_jobs`.

`webhook_events.event_hash` `UNIQUE` — chống xử lý webhook hai lần bằng ràng buộc thay vì bằng kiểm tra trong code.

---

### 3.5 Lịch rảnh giáo viên (4 bảng)

`teacher_availability_slots`, `teacher_availability_profiles`, `teacher_availability_profile_selections` (từ `selections[]`), `teacher_availability_change_requests` + `..._request_selections`.

`selectionKeys[]` là mảng khoá phái sinh phục vụ truy vấn Firestore — **xoá**, thay bằng index trên bảng con.

---

### 3.6 Kết khoá khoá học (5 bảng)

`course_closings` (một hàng cho mỗi `class_term`), `course_closing_approvals`, `course_closing_exemptions`, `course_closing_records`, `course_closing_record_documents`.

`CourseClosingState` đang nhúng trong cả `Class` lẫn `ClassTerm` — hai bản sao của cùng một sự thật. Sau chuẩn hoá chỉ còn một hàng gắn với `class_terms`.

`CourseClosingSnapshot` **không lưu** — nó là kết quả thuần của `deriveCourseClosingSnapshot()`, tính khi cần.

Các `*Snapshot` trong `course_closing_records` thì **giữ**, vì là bằng chứng tại thời điểm phát hành (mục 1.7).

---

### 3.7 Thông báo và Zalo (7 bảng)

`notifications`, `zalo_notifications`, `zalo_bot_links`, `zalo_bot_link_codes`, `zalo_bot_messages`, `zalo_bot_pending_chats`, `zalo_bot_chat_claims`, `zalo_bot_admin_sessions`.

`zalo_bot_links`: `UNIQUE (staff_id)` và `UNIQUE (chat_id_hash)` — một nhân viên một chat, một chat một nhân viên. Hôm nay luật này chỉ nằm trong code.

`zalo_bot_messages.id` đang sinh từ `makeZaloBotDailyMessageId(date, staffId)` để chống gửi trùng digest. Thay bằng khoá thay thế + `UNIQUE (staff_id, digest_date, message_type)` — cùng tác dụng, đúng quy ước 1.1.

---

### 3.8 Vận hành (4 bảng)

`audit_logs`, `outbox_jobs`, `print_requests`, `print_request_files` (từ `files[]`).

`audit_logs`: cột thật cho `user_id`, `user_role`, `action`, `collection` (đổi tên `entity_table`), `entity_id`, `ip`, `user_agent`, `timestamp`; `changes` và `metadata` là `JSONB`. Đây là chỗ JSONB đúng chỗ — payload thật sự dị dạng theo từng loại hành động. Index BRIN trên `timestamp`.

---

## 4. Năm điểm mở — đã chốt 2026-08-18

### 4.1 `LessonDeck` / `LessonSlide` — không phải dữ liệu, không cần bảng

**Đóng.** Chúng không nằm trong Firestore. 57 file, nguồn ở `src/data/global-success/grade6/unit01.ts` … — dữ liệu TypeScript tĩnh biên dịch thẳng vào bundle, đọc bởi `LessonPlayer.tsx` và `LessonSlideRenderer.tsx`. Đó là lý do không có `match` nào trong `firestore.rules`. Không liên quan tới di trú.

### 4.2 `tuition_records` — bảng lưu trữ đóng băng

**Đóng.** Ngoài test, chỉ còn hai nơi nhắc tới: `server/api/lib/services/fullExportCollections.ts` (danh sách export) và `scripts/migrate-tuition-records.ts` (chính script đã chuyển chúng sang ledger). Không code nào ghi, không code nào đọc.

Quyết định: port sang bảng có kiểu cột đàng hoàng, **không FK**, không đường ghi, đánh dấu frozen.

Vì sao không FK dù schema này chủ trương ràng buộc chặt: dữ liệu legacy có thể trỏ tới học sinh đã bị xoá từ lâu. Gắn FK vào sẽ làm fail bước load để đổi lấy giá trị bằng không — bảng này không có ai ghi nữa nên không có bất biến nào cần bảo vệ. Không xoá, vì là lịch sử tài chính.

### 4.3 Điểm danh giáo viên — giữ trong `class_sessions`

**Đóng.** Sáu cột `teacherAttendance*` ở lại trong `class_sessions`. Quan hệ 1-1 thật; tách bảng chỉ tốn JOIN mà không mua được ràng buộc nào.

Giữ nguyên `teacher_attendance_source` với CHECK `IN ('office_admin','promotion_backfill')` — phân biệt buổi do người điểm danh với buổi do migration dựng lại, thứ mà audit lương cần.

### 4.4 `allowed_teachers` + `blocked_teachers` — một bảng, hai view

**Đóng.** Xem mục 3.1. Lưu một bảng để mâu thuẫn không biểu diễn nổi; dựng hai view mang tên cũ để UI và repository không phải đổi.

### 4.5 Sáu collection không có `interface` — còn mở, chờ dữ liệu

**Còn mở.** `exam_bank`, `curriculums`, `exam_templates`, `system_settings`, `refunds`, `student_progression_events` được ghi ad hoc, không có type trong repo.

Cách làm đã thống nhất: suy hình dạng từ **dữ liệu production thật** — đọc mẫu, thống kê tần suất từng trường, phát hiện trường tuỳ chọn và trường luôn có — chứ không đoán từ tên collection. Cần một bản export để làm việc này.

Đây là điểm duy nhất còn chặn việc khoá schema.

---

## 5. Việc tiếp theo

1. Lấy bản export production để chốt hình dạng sáu collection ở mục 4.5.
2. Viết schema thành Drizzle, sinh migration đầu tiên.
3. Viết script transform + bộ verify đối chiếu số dòng và tổng tiền.
4. Diễn tập cutover trên bản sao trước khi làm thật.
