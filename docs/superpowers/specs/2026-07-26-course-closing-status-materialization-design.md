# Thiết kế sửa trạng thái và materialize hồ sơ lưu trữ

**Ngày:** 2026-07-26  
**Trạng thái:** Đã được người dùng duyệt qua yêu cầu thực hiện tuần tự hai hạng mục đã chẩn đoán  
**Phạm vi:** Trạng thái tổng trên giao diện hồ sơ lưu trữ và 230 hồ sơ backfill hiện có trên Firestore production

## 1. Bối cảnh đã xác minh

Firestore production có 230 `course_closing_records`, tất cả đều được backfill ngày
2026-07-25:

- 129 hồ sơ có `evaluation=pending`, `tuition=not_requested`;
- 96 hồ sơ có cả hai document ở `not_requested`;
- 5 hồ sơ có cả hai document ở `pending`;
- mọi document đều có `attempts=0`;
- không có `materialize_course_closing_document` job trong `outbox_jobs`;
- không có `lastErrorCode`.

Hàm `deriveCourseClosingRecordStatus` hiện trả `retrying` cho mọi tổ hợp chưa
khớp các nhánh `ready`, vì vậy toàn bộ hồ sơ chưa được tạo file bị hiển thị sai
thành “Đang thử lại”.

## 2. Mục tiêu

1. Trạng thái tổng phản ánh đúng trạng thái nguồn:
   - có document `retrying` thì tổng là `retrying`;
   - có document `failed` thì tổng là `failed`;
   - cả hai `ready` thì tổng là `complete`;
   - chỉ một document `ready` thì tổng là trạng thái thiếu document còn lại;
   - chưa có document `ready`, nhưng có `pending`, thì tổng là `pending`;
   - cả hai chưa được yêu cầu thì tổng là `not_requested`.
2. Bộ lọc và bản xuất CSV hiểu được `pending` và `not_requested`.
3. Tạo DOCX cho đúng các artifact đang `pending` trên production bằng một quy
   trình có dry-run, digest kế hoạch, xác nhận project/database, báo cáo và khả
   năng chạy lại an toàn.
4. Xác minh cuối cùng bằng cả metadata Firestore và sự tồn tại của file Storage.

## 3. Các phương án

### Phương án A — Chỉ sửa nhãn giao diện

Ít thay đổi nhất nhưng không tạo ra tài liệu thật. Hồ sơ sẽ tiếp tục không thể
xem hoặc tải xuống. Không đạt mục tiêu người dùng.

### Phương án B — Đẩy toàn bộ artifact vào outbox

Dùng đúng worker production hiện có, nhưng cron chỉ chạy một lần mỗi ngày và
worker giới hạn 50 job mỗi lượt. Với 139 artifact, tiến trình kéo dài nhiều ngày
nếu không kích hoạt worker thủ công nhiều lần; việc quan sát tiến độ cũng gián
tiếp.

### Phương án C — CLI direct materialization có kiểm soát

Dùng lại `materializeCourseClosingDocument`, lập kế hoạch chỉ đọc trước, khóa
phạm vi bằng digest, sau đó xử lý tuần tự. Artifact đã `ready` được bỏ qua; lần
chạy lại tiếp tục các artifact còn `pending`/`retrying` trong cùng kế hoạch.
Phương án này được chọn vì giải quyết file ngay, giữ nguyên quy tắc render và
Storage của production, đồng thời dễ audit.

## 4. Kiến trúc

### 4.1 Trạng thái giao diện

Mở rộng `CourseClosingRecordDisplayStatus` với `not_requested` và `pending`.
`deriveCourseClosingRecordStatus` áp dụng thứ tự ưu tiên:

1. `retrying`;
2. `failed`;
3. `complete`;
4. `missing_tuition` hoặc `missing_evaluation`;
5. `pending`;
6. `not_requested`.

UI không suy đoán số lần thử; nó chỉ hiển thị trạng thái do backend tính từ hai
artifact.

### 4.2 Planner materialization

Planner thuần nhận danh sách record và tạo một item cho mỗi document có trạng
thái `pending`. Item chỉ chứa:

- `recordId`;
- `documentType`;
- `templateVersion`;
- trạng thái và số lần thử tại lúc dry-run.

Danh sách được sắp xếp ổn định và băm SHA-256. Dry-run ghi plan JSON và summary
không chứa tên, số điện thoại, nội dung đánh giá hoặc credential.

### 4.3 Apply

Apply yêu cầu:

- `--apply`;
- `--confirm-project`;
- `--confirm-database`;
- `--reviewed-plan`;
- `--confirm-digest`;
- thư mục báo cáo mới, khác thư mục dry-run.

Trước mỗi item, runner đọc lại record:

- `ready`: ghi nhận `skipped_ready`;
- `pending` hoặc `retrying` với `attempts < 5`: gọi materializer;
- `failed` hoặc `attempts >= 5`: ghi nhận `exhausted`;
- record/document không còn hợp lệ: ghi nhận `conflicted`.

Runner xử lý tuần tự, tiếp tục sau lỗi, ghi JSON summary cuối và trả mã lỗi nếu
còn item chưa `ready`. Chạy lại cùng reviewed plan là an toàn vì materializer
idempotent với artifact đã `ready`.

### 4.4 Xác minh

Sau apply:

1. đọc lại toàn bộ item trong plan;
2. yêu cầu mỗi item có `status=ready`, `storagePath`, `generatedAt`;
3. gọi `file.exists()` trên đúng bucket;
4. báo số lượng `ready_with_file`, `metadata_missing`, `file_missing`.

Chỉ coi hoàn tất khi mọi item trong plan là `ready_with_file`.

## 5. Phạm vi production

Theo snapshot ngày 2026-07-26, kế hoạch dự kiến gồm 139 artifact:

- 134 evaluation document;
- 5 tuition document.

96 hồ sơ `not_requested|not_requested` không được materialize vì không có
snapshot/bằng chứng đủ để render. Đây là trạng thái hợp lệ và sẽ được hiển thị
“Chưa yêu cầu”, không phải lỗi.

## 6. An toàn và xử lý lỗi

- Dry-run là mặc định và không ghi Firestore/Storage.
- Apply từ chối nếu project/database/digest không khớp.
- Không tạo hoặc gửi Zalo.
- Không thay đổi source collection.
- Không materialize document `not_requested`.
- Không ghi đè document đã `ready`.
- Không in dữ liệu cá nhân trong terminal/report.
- Mỗi lỗi được giữ theo `recordId` và `documentType` để có thể chạy lại có mục
  tiêu.

## 7. Kiểm thử

- Unit test mọi tổ hợp trạng thái tổng quan trọng.
- Component/header test cho hai lựa chọn lọc mới.
- Export test cho nhãn CSV mới.
- Planner test chỉ chọn `pending`, sắp xếp ổn định và không lộ PII.
- Apply test cho xác nhận target/digest, `ready`, retryable, exhausted,
  conflicted và lỗi tiếp tục.
- Verification test cho metadata/file tồn tại và thiếu.
- Chạy targeted Vitest, toàn bộ test liên quan, typecheck và build trước khi
  chạm production.

## 8. Tiêu chí hoàn thành

- Giao diện không còn hiển thị “Đang thử lại” cho record chưa từng thử.
- 139 artifact trong reviewed plan được xác minh `ready` và có file Storage.
- 96 record không có bằng chứng vẫn ở `not_requested`.
- Không còn artifact trong reviewed plan ở `pending`, `retrying` hoặc `failed`.
- Có báo cáo dry-run, apply và verification để đối chiếu.
