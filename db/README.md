# Schema PostgreSQL — dựng và nạp

Hiện thực của [`docs/superpowers/specs/2026-08-18-postgres-schema-design.md`](../docs/superpowers/specs/2026-08-18-postgres-schema-design.md).

- **Ngày:** 2026-08-19
- **Trạng thái:** runtime đã PostgreSQL-only và có 19 migration. Migration
  `0019_restore_portability.sql` đã được áp dụng trên VPS để schema-qualified hàm
  chuẩn hoá khi restore; restore drill cô lập vẫn là gate bắt buộc.
- **Cảnh báo:** `db/data.sql` sinh ngày 2026-08-19 chỉ là bằng chứng diễn tập lịch sử,
  không phải artifact cutover. Phải sinh lại dưới global write freeze.

```
db/
  migrations/          19 file SQL, chạy theo thứ tự số
  normalization/       quyết định chuẩn hoá dữ liệu (dạng dữ liệu, không phải code)
  preflight/           kiểm tra trước khi nạp + bộ nạp
  run-migrations.sh    trình chạy (psql + bảng schema_migrations)
  verify-schema.sql    đối chiếu SCHEMA sau khi chạy migration
  verify-data.sql      đối chiếu DỮ LIỆU sau khi chạy data.sql
  data.sql             dữ liệu production (KHÔNG trong git — 16 MB, chứa dữ liệu
                       cá nhân thật; sinh lại bằng 02-dry-run-load.mjs --emit)
  DEPLOY.md            hướng dẫn dựng trên VPS, 8 bước
```

Hai thứ đưa lên VPS: `migrations/` + `run-migrations.sh` (dựng schema), rồi
`data.sql` (nạp dữ liệu). `preflight/` và `normalization/` ở lại máy dev vì chúng
đọc Firestore.

---

## 1. Chạy

```bash
export DATABASE_URL='postgres://edutrack:...@localhost:5432/edutrack'

./db/run-migrations.sh --dry-run    # xem sẽ chạy gì
./db/run-migrations.sh              # chạy
./db/run-migrations.sh --status     # file nào đã chạy
```

Mỗi file chạy trong một transaction của riêng nó và được ghi vào bảng
`schema_migrations` kèm checksum. Chạy lại thì bỏ qua file đã xong; nếu file đã
chạy mà nội dung bị sửa sau đó, trình chạy **dừng** thay vì âm thầm bỏ qua —
sửa migration đã chạy là cách chắc chắn nhất để hai môi trường lệch nhau.

Yêu cầu: PostgreSQL **14 trở lên** (dùng `normalize()`, `num_nulls()`,
cột sinh `GENERATED ALWAYS AS … STORED`), cùng ba extension `btree_gist`,
`pg_trgm`, `unaccent` — cả ba đều nằm trong `postgresql-contrib`.

### Kết quả mong đợi

| | |
|---|---|
| Bảng | 85 |
| View | 8 |
| Materialized view | 2 |
| Index | 228 |
| Khoá ngoại | 177 |
| CHECK | 244 |
| UNIQUE | 85 |
| EXCLUDE | 0 |
| Trigger | 65 |

---

## 2. Bằng chứng: DDL này đã chạy, không chỉ được viết ra

Mười tám migration nền đã chạy trên PostgreSQL thật bằng PGlite. Migration thứ 19
đã chạy trên VPS sau khi phát hiện restore custom-format cần `search_path` độc lập.
Phần dưới ghi lại lần diễn tập snapshot ngày 2026-08-19; nó là bằng chứng thiết kế,
không thay thế backup và restore drill hậu cutover:

```
chuẩn hoá: dựng lại 6 hồ sơ, giữ 2 hồ sơ lưu trữ, bỏ 58 vỏ hồ sơ đã gộp,
           bỏ 3 hàng, sửa 1 giá trị, dựng lại 3 kỳ học

students                     744 + 6 dựng lại    evaluations                 472/472
student_auth_credentials         2/2            daily_reports                16/16
users                          116/116          assignments                    2/2
classes                         54/54           assignment_questions          80/80
class_terms                     92/92           assignment_question_options  320/320
class_term_weekly_sessions     138/138          submissions                   26/26
student_course_enrollments     823/823          submission_quiz_answers      769/769
class_sessions                 801/801          knowledge_bank_items          26/26
student_leave_periods           28/28           ledger_notice_log             70/70
course_fee_ledgers             739/739          course_closings               17/17
student_wallets                485/485          course_closing_records       412/412
receipts                       299/299          course_closing_record_documents 824/824
receipt_allocations            306/306          teacher_availability_*         4 + 24
wallet_transactions            604/604          notifications                 63/63
attendance                    8685/8685         zalo_notifications          1271/1271
staff_email_access              30/30           admin_notifications      58 + 553 lỗi
audit_logs                    8177/8177         zalo_bot_* (5 bảng)        5/9/5/5/22
outbox_jobs                    640/640          zalo_bulk_jobs / items      88 / 638
jobs / job_runs               120 / 3           finance_idempotency_keys     305/305
maintenance_flags               83/83           finance_monthly_aggregates     4/4

Bật lại bất biến tài chính: kiểm 299 biên lai, 739 ledger — 0 vi phạm.

Tổng đã thu:    Postgres 372.899.997  |  Firestore 372.899.997   KHỚP
Tổng biên lai:  Postgres 382.790.000  |  Firestore 382.790.000   KHỚP
Tổng số dư ví:  Postgres   9.890.003  |  Firestore  10.090.003   lệch −200.000
                → cache cũ của Firestore; số của Postgres mới đúng (xem mục 4)
Ví âm: 0        Bộ đếm lớp âm: 0  (trên Firestore: có, thấp nhất −16)

HÀNG BỊ BỎ: 0

ĐÃ XUẤT: db/data.sql  (29.419 câu lệnh, 16,3 MB)
```

Rồi **chính file đó** được phát lại vào một Postgres trống đã chạy đủ các migration
tồn tại ở lần diễn tập (`05-verify-dump.mjs`). Cutover phải lặp lại quy trình này
với đủ 19 migration và snapshot mới:

```
2. Chạy file dữ liệu     xong trong 4,6s  (16,3 MB)
3. Số hàng từng bảng     54 bảng, tổng 29.414 hàng — khớp con số file tự khai
4. Bất biến tài chính    299 biên lai, 739 ledger — cân
5. Toàn vẹn sau nạp      ledger trùng 0 · mã trùng 0 · ghi danh mồ côi 0
6. Cột sinh              name_normalized sạch dấu 100%

TẤT CẢ QUA — file dữ liệu này chạy được và số tiền cân.
```

Chạy lại:

```bash
cd db/preflight
npm install
node 00-validate-schema.mjs   ../migrations
node 01-check-constraints.mjs "<đường-dẫn-repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a
node 03-verify-decisions.mjs  "<đường-dẫn-repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a
node 02-dry-run-load.mjs      "<đường-dẫn-repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a ../migrations --emit ../data.sql
node --max-old-space-size=4096 05-verify-dump.mjs ../migrations ../data.sql
```

Bỏ `--emit` thì chỉ diễn tập, không ghi file. Có `--emit` thì file **chỉ được ghi
ra khi lần chạy đó bỏ qua 0 hàng và bất biến tài chính qua** — một file dữ liệu
sinh ra từ lần nạp có hàng bị từ chối là một file thiếu dữ liệu mà không ai nhìn
thấy.

---

## 3. Chín chỗ tài liệu thiết kế nói khác thực tế

Tài liệu thiết kế được viết từ `firestore.rules` và `src/types/*.ts`. Chín điểm
dưới đây là chỗ **dữ liệu production nói khác**, đo ngày 2026-08-19 trên
database `ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a`.

Hai điểm cuối (3.8 và 3.9) chỉ lộ ra khi nạp thử 40 collection còn lại — đó
chính là lý do làm bộ nạp đầy đủ **trước** khi dựng VPS.

### 3.1 Mã học sinh nằm ở `studentId`, không phải `code`

Tài liệu ánh xạ `code` → cột `code`, và `studentId` → `school_student_id`
("mã học sinh ở trường phổ thông").

Thực tế: `students.code` **rỗng trên 800/802 document**, còn `students.studentId`
khớp `/^HS\d{6}$/` trên **802/802** và trùng khớp 60/60 với doc ID của
`student_code_registry`. Tức `studentId` chính là mã đăng nhập. Không có
trường "mã ở trường phổ thông" nào tồn tại.

Schema lấy `students.code` **từ `studentId`**. Cột `school_student_id` không được tạo.

### 3.2 Bất biến biên lai của tài liệu là sai

Tài liệu: *"tổng `receipt_allocations.amount` của một biên lai đã posted phải
bằng `receipts.amount_received`"*.

Đo thử: **25/298 biên lai không thoả**, tất cả đều là biên lai có phần tiền
chạy qua ví. Công thức đúng:

```
SUM(allocations) + SUM(nạp ví) − SUM(rút ví trả học phí) = amount_received
```

Dạng này khớp **298/298, không ngoại lệ**. Đó là dạng được cài trong
`app_assert_receipt_balanced()` ở `0011_triggers.sql`.

### 3.3 Production có 54 collection, không phải 67

Tài liệu đếm 67 `match` trong `firestore.rules`. Database thật có **54 root
collection**. Trong đó **20 collection tài liệu không hề nhắc tới**, gồm những
cái có dữ liệu thật:

| Collection | Docs | Thành |
|---|---|---|
| `jobs` | 120 | bảng `jobs` |
| `job_runs` | 3 | bảng `job_runs` |
| `finance_idempotency_keys` | 304 | bảng `finance_idempotency_keys` |
| `finance_monthly_aggregates` | 4 | bảng `finance_monthly_aggregates` |
| `zalo_bulk_jobs` / `zalo_bulk_job_items` | 88 / 660 | hai bảng cùng tên |
| `zalo_bot_chat_sessions` | 5 | bảng `zalo_bot_chat_sessions` |
| `admissions_history` | 12 | bảng `admissions_history` |
| `student_enrollment_migration_journal` | 334 | bảng đóng băng |
| `payment_order_codes` | 1 | bảng `payment_order_codes` |
| `_maintenance` | 83 | bảng `maintenance_flags` |
| `_zalo_config` | 1 | bảng `zalo_config` |
| `background_jobs` | 2 | gộp vào `jobs` |
| `_counters` | 30 | `SEQUENCE` |
| `_rate_limits` | 1949 | **không port** — bộ đếm IP tạm, dựng lại từ đầu |
| `_payment_locks` | 1 | **không port** — `SELECT … FOR UPDATE` trên ledger làm đúng việc này |
| `read_models` | 1 | **không port** — thành matview |
| `config` | 1 | gộp vào `staff_email_access` |
| `conversations` | 0 | **không port** |

Ngược lại, những thứ tài liệu liệt kê mà production **không có document nào**:
`invoices`, `expenses`, `tuition_records`, `tuition_configs`, `payment_requests`,
`refunds`, `exam_bank`, `curriculums`, `exam_templates`, `print_requests`,
`substitute_requests`, `blocked_teachers`, `student_progression_events`,
`password_reset_requests`, và toàn bộ nhóm identity-health / merge. Bảng vẫn
được tạo (code còn đường ghi) nhưng nạp xong sẽ rỗng.

### 3.4 `student_auth_credentials` chỉ có 2 hàng

Tài liệu: *"Đây là bảng khiến học sinh và phụ huynh không phải đặt lại mật khẩu
khi cutover."*

Đúng về cơ chế, nhưng phạm vi thật là **2 document, và cả hai chỉ chứa mật khẩu
phụ huynh**. Không học sinh nào đang có bam mật khẩu riêng. Cutover không làm ai
mất quyền đăng nhập, nhưng không phải vì bảng này cứu được 802 người.

### 3.5 `students.faceImage` không phải base64

Tài liệu lo *"Base64 trong DB là lãng phí"*. Thực tế trường này dài tối đa 123
ký tự — nó là đường dẫn Storage, trùng nội dung với `faceImageStoragePath`. Gộp
làm một cột.

### 3.6 Xoá mềm có thật, ở bốn nơi

Tài liệu bỏ hẳn xoá mềm. Production đang có:

- `students`: 60 document có `deletedAt` / `mergedIntoStudentId`
- `classes`: 6 có `deletedAt`, 4 có `archivedAt`
- `evaluations`: 4 có `deletedAt`, 300 có cờ `isDeleted`
- `attendance`: 413 có cờ `isVoided`

Xử lý trong schema:

| | Cách làm |
|---|---|
| `students` nghỉ hưu | 58 vỏ đã gộp: **không nạp**; 2 hồ sơ lưu trữ thật: nạp với `archived` (xem mục 4) |
| `classes` | `status = 'archived'` + `archived_at/by/reason`; `deletedAt` bỏ |
| `evaluations` | 4 bản bị xoá **không nạp**; cột soft-delete bỏ |
| `attendance` | `is_voided` **giữ lại** — huỷ một lần điểm danh là trạng thái nghiệp vụ, không phải xoá bản ghi |

### 3.7 `audit_logs.userRole` không phải tập đóng

Ngoài `admin/office/teacher/accounting/student/system/unknown`, cột này còn
chứa giá trị `"TRAN ANH TUAN"` — một cái **tên** lọt vào ô vai trò. Vì vậy
`audit_logs` không có CHECK trên `user_role`: một ràng buộc làm fail bước nạp
sổ nhật ký lịch sử thì đổi lấy giá trị bằng không.

---

### 3.8 Ràng buộc `EXCLUDE` chống kỳ chồng lấn phải bỏ

Tài liệu: *"Ràng buộc EXCLUDE là thứ Firestore không thể có, và nó chặn đúng lớp
lỗi 'term chồng nhau' từng gây ra ledger trùng."*

Đo trên `classes.terms[]` thì đúng — 0/31 lớp vi phạm. Nhưng khi dựng kỳ từ **mọi
bằng chứng** (kể cả `courseClosing` của chính lớp) thì lộ ra:

```
lớp RI6vRY14dJtwLSpdy1Bc (G6 - Mr.Khoa - T7CN)
  khoá cũ:  2026-06-27 .. 2026-08-16
  khoá mới: 2026-08-15 .. 2026-10-04
```

Chồng 2 ngày — chuyển khoá bình thường, không phải lỗi. Đặt `EXCLUDE` thì bước
nạp từ chối một bản ghi kết khoá có thật, và sau cutover ứng dụng sẽ dừng mỗi lần
chuyển khoá gặp nhau.

Thứ **thật sự** chặn ledger trùng là `UNIQUE (student_id, class_id, term_start)`
trên `course_fee_ledgers` — đã đo 0/739 vi phạm. Đã bỏ `EXCLUDE`, giữ
`UNIQUE (class_id, term_start)` và thêm một index GiST để sau này truy vấn theo
khoảng ngày vẫn nhanh.

### 3.9 `submissions.attemptNumber` không đáng tin

Schema ban đầu của tôi đặt `UNIQUE (assignment_id, student_id, attempt_number)`.
Production nói khác: học sinh `9sUfWp5CuOPDIl4XFu6c` có `attemptNumber`
**[1, 1, 3, 3, 3]** trên cùng một bài tập; 4/26 bài nộp trùng bộ ba này.

Ứng dụng không cấp số lần nộp một cách tăng dần đáng tin (nhiều khả năng do đua
ghi). Đặt `UNIQUE` ở đây vừa làm hỏng bước nạp, vừa làm ứng dụng dừng lần đầu
hai học sinh bấm nộp gần nhau sau cutover. Đã đổi thành index thường.

---

## 4. Chuẩn hoá — đã làm xong

Chi tiết đầy đủ ở [`normalization/README.md`](normalization/README.md);
quyết định ở dạng dữ liệu tại [`normalization/decisions.json`](normalization/decisions.json).

Quy tắc áp: **đủ chứng cứ (tên + mã + lớp) thì dựng lại, không đủ thì bỏ**; tiền
đã thu luôn giữ; dữ liệu sai trước mốc 2026-08-15 thì xoá. Áp xong thì hoá ra cả
6 hồ sơ mất tích đều đủ chứng cứ, nên gần như không phải xoá gì.

| Việc | Số lượng |
|---|---|
| Hồ sơ dựng lại từ `audit_logs` | 6 |
| Hồ sơ lưu trữ giữ lại (`deletedAt`, không merge) | 2 |
| Vỏ hồ sơ đã gộp — bỏ | 58 |
| Hàng bỏ (`class_sessions` trùng, tài khoản loadtest) | 2 |
| Giá trị sửa (`startTime` sai định dạng) | 1 |
| Allocation gộp (hai dòng cùng ledger trên một biên lai) | 1 |
| **Hàng không giải thích được** | **0** |

Hai điều đáng ghi lại:

**Khoản 200.000đ không mất.** Báo cáo trước của tôi nói nó không có chứng từ —
sai. Giao dịch ví ngày 2026-08-10 có thật (`allocation 200.000`, ghi chú *"Gán
nốt số dư ví còn lại của phiếu PT-260808-133 vào học phí"*). Cộng đủ 5 giao dịch
của em NGUYỄN LƯƠNG MAI LY ra **0**; cột `students.walletBalance` ghi 200.000 vì
không được cập nhật sau giao dịch đó. View của schema mới trả 0 — và 0 mới đúng.
Đây đúng là loại lỗi mà việc bỏ cột số dư xoá bỏ.

**58 mã trùng biến mất mà không mất ai.** Cả 58 vỏ hồ sơ đã gộp đều trỏ về một
hồ sơ còn sống mang **cùng mã**. Bỏ vỏ đi thì `UNIQUE (code_normalized)` đi qua
sạch, người thật vẫn ở đó dưới id chuẩn.


## 5. Thứ tự nạp

Có một **vòng phụ thuộc thật** giữa `users` và `students`:

```
users.student_id                    →  students
students.admitted_by                →  users
students.trial_teacher_id           →  users
students.trial_class_id             →  classes  →  users.teacher_id
```

`users_student_link` là CHECK, mà CHECK trong Postgres **không deferrable
được** — một user role `student`/`parent` phải có `student_id` ngay từ lúc
INSERT. Ba cột phía `students` thì đều nullable. Nên thứ tự bắt buộc là:

1. `students` (để `admitted_by`, `trial_class_id`, `trial_teacher_id` = NULL)
2. `users` (kèm `student_id`)
3. `classes`
4. `UPDATE students` — vá ngược ba cột trên
5. Phần còn lại theo thứ tự khoá ngoại thông thường

### Tắt bất biến tài chính khi nạp hàng loạt

Hai bất biến tiền là CONSTRAINT TRIGGER, deferred **trong phạm vi một
transaction**. Nếu bước nạp chia thành nhiều transaction (ledger trước, biên
lai sau) thì ledger sẽ fail ở commit của chính nó.

```sql
SELECT app_disable_finance_guards();
--  … nạp …
SELECT * FROM app_enable_finance_guards();
--  → checked_receipts | checked_ledgers
```

`app_enable_finance_guards()` **tự kiểm tra lại toàn bộ** biên lai và ledger sau
khi bật, nên không thể quên bật mà vẫn tưởng là an toàn.

---

## 6. Những gì không được port

| Bỏ | Thay bằng |
|---|---|
| `student_code_registry` | `UNIQUE (students.code_normalized)` |
| `student_profile_aliases`, `..._merge_journal`, `..._merge_runs` | gộp hồ sơ = một `UPDATE` trong một transaction |
| `student_identity_health` + 2 bảng con | `UNIQUE` + `FOREIGN KEY` khiến trạng thái đó không xảy ra được |
| `realtime_events` (20 kênh) | `LISTEN/NOTIFY` qua `app_notify()` |
| `accounting_student_summaries` | `mv_accounting_student_summary` |
| `admin_class_tuition_summaries` | `mv_admin_class_tuition_summary` |
| `accounting_student_summary_health`, `admin_class_tuition_health` | không còn trạng thái lệch để theo dõi |
| `read_models/dashboard_global` | dựng từ view khi cần |
| `_counters` | `SEQUENCE receipt_no_seq` |
| `_rate_limits` | dựng lại từ đầu trên VPS |
| `_payment_locks` | `SELECT … FOR UPDATE` |
| `system/connection-test` | health endpoint |

Cùng với đó, các trường bóng trên `students` bị xoá: `canonicalProfileId`,
`requestedProfileId`, `redirected`, `placementStatus`, `mergedIntoStudentId`,
`studentProfileState`; và `users.blockedTeacher` / `users.blockedAt`.

---

## 7. Bước tiếp theo

1. Dựng database trên VPS, chạy `run-migrations.sh` — xem [DEPLOY.md](DEPLOY.md).
2. Chạy lại `03-verify-decisions.mjs` ngay trước khi nạp thật. Production vẫn
   đang chạy, dữ liệu đổi từng ngày; nếu một khẳng định trong `decisions.json`
   hết hạn thì phải sửa file trước, đừng nạp.
3. Sinh lại `data.sql` (`--emit`), phát lại bằng `05-verify-dump.mjs`, rồi
   `psql -f db/data.sql` trên VPS và `psql -f db/verify-data.sql` để đối chiếu.
   Đừng dùng file cũ: production vẫn chạy, ảnh chụp hôm nay khác ảnh chụp hôm qua.
4. Materialize `app_documents`, rồi chạy parity audit log, operational reads,
   row counts và toàn bộ bất biến tài chính.
5. Thực hiện TLS, backup mã hóa/offsite, restore drill và cutover duy nhất theo
   [`docs/runbooks/vps-postgres-cutover.md`](../docs/runbooks/vps-postgres-cutover.md).
