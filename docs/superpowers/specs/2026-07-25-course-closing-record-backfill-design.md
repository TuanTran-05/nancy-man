# Thiết kế backfill hồ sơ kết khóa từ Firestore thật

**Ngày:** 2026-07-25  
**Trạng thái:** Đã được người dùng duyệt  
**Phạm vi:** Toàn bộ dữ liệu kết khóa lịch sử trong Firestore production

## 1. Bối cảnh

Ứng dụng đã có:

- schema `CourseClosingRecord`;
- collection server-only `course_closing_records`;
- repository upsert snapshot đánh giá và học phí;
- materializer tạo DOCX và lưu Firebase Storage;
- API và giao diện tra cứu hồ sơ kết khóa;
- luồng tạo hồ sơ mới sau khi gửi Zalo thành công.

Script `scripts/generate-course-closing-record-fixtures.ts` hiện chỉ render dữ liệu mẫu tĩnh. Dữ liệu lịch sử trước khi tính năng lưu hồ sơ được triển khai chưa được chuyển thành `course_closing_records`.

Audit chỉ đọc trên Firestore production ngày 2026-07-25 ghi nhận:

- 42 lớp được quét;
- 27 lớp có trạng thái kết khóa một phần;
- 13 lớp có dữ liệu lịch sử mơ hồ cần xử lý thận trọng;
- chưa có lớp nào đạt trạng thái `completed` theo schema course-closing mới.

## 2. Mục tiêu

1. Đọc toàn bộ nguồn dữ liệu kết khóa lịch sử từ Firestore production.
2. Dựng tối đa một hồ sơ cho mỗi cặp `{courseId, studentId}`.
3. Vẫn tạo hồ sơ một phần khi thiếu đánh giá cuối khóa hoặc bằng chứng học phí.
4. Không suy đoán dữ liệu chưa được chứng minh và không gắn trạng thái đã gửi khi không có bằng chứng.
5. Cho người dùng xem đầy đủ kết quả dry-run trước khi ghi thật.
6. Chỉ ghi Firestore sau một xác nhận riêng của người dùng.
7. Cho phép chạy lại an toàn, không tạo bản trùng và không ghi đè tài liệu đã sẵn sàng.
8. Không gửi lại Zalo trong bất kỳ pha backfill nào.

## 3. Ngoài phạm vi

- Không thay đổi nội dung hoặc hành vi của luồng gửi Zalo hiện tại.
- Không sửa dữ liệu nguồn trong `classes`, `students`, `evaluations`, `zalo_notifications`, `course_fee_ledgers` hoặc `users`.
- Không tự động tạo hàng loạt DOCX/Storage trong cùng lần ghi record.
- Không tự sửa 13 lớp có nguồn dữ liệu mơ hồ.
- Không đưa số điện thoại hoặc dữ liệu nhạy cảm vào báo cáo.

## 4. Phương án được chọn

Áp dụng backfill hai pha:

1. `dry-run`: đọc production, dựng record dự kiến và xuất báo cáo; không gọi bất kỳ Firestore write nào.
2. `apply`: sau khi người dùng duyệt báo cáo, upsert đúng tập record đã được lập kế hoạch.

Pha materialize DOCX được tách thành thao tác riêng sau khi record đã được ghi và xác minh. Điều này giới hạn blast radius, giúp đối chiếu dữ liệu trước khi phát sinh file và tránh tạo outbox ngoài ý muốn.

## 5. Kiến trúc

### 5.1 Source loader

Source loader chỉ đọc:

- `classes`;
- `students`;
- `evaluations`;
- `zalo_notifications`;
- `course_fee_ledgers`;
- `users`;
- `course_closing_records` để phát hiện record hiện hữu.

Loader nhận Firestore database ID bắt buộc và không mặc định ngầm sang `(default)`.

### 5.2 Pure planner

Planner là module thuần, không phụ thuộc Firestore write. Module:

1. chuẩn hóa document thành dữ liệu nội bộ tối thiểu;
2. nhóm theo định danh khóa;
3. ghép học viên, đánh giá, thông báo và ledger;
4. dựng candidate `CourseClosingRecord`;
5. phân loại candidate thành `create`, `merge`, `unchanged`, `ambiguous` hoặc `skipped`;
6. sinh lý do có cấu trúc cho mọi candidate không thể ghi.

Việc tách planner khỏi I/O cho phép kiểm thử toàn bộ quy tắc dữ liệu bằng fixture nhỏ và bảo đảm dry-run/apply dùng cùng một kế hoạch.

### 5.3 Writer

Writer chỉ được gọi khi có `--apply`. Writer:

- yêu cầu xác nhận project ID và database ID trên command line;
- dùng document ID `{courseId}__{studentId}`;
- upsert theo batch có giới hạn;
- không xóa field hiện hữu;
- không ghi đè snapshot hoặc document đã `ready`;
- không tạo outbox job;
- không gọi Zalo;
- ghi thời gian backfill và phiên bản backfill tối thiểu để audit.

### 5.4 Reporter

Reporter xuất:

- JSON máy đọc được với quyết định và reason code cho từng candidate;
- CSV phục vụ đối chiếu thủ công;
- summary trên terminal.

Báo cáo chỉ chứa định danh vận hành cần thiết: class ID/tên lớp, course ID, student ID/mã/tên học viên, trạng thái nguồn, trạng thái record dự kiến và lý do. Không chứa số điện thoại, email, token hoặc nội dung credential.

## 6. Quy tắc chọn dữ liệu

### 6.1 Định danh khóa

Thứ tự ưu tiên:

1. `courseId` đã gắn trực tiếp trên evaluation hoặc notification;
2. course identity canonical đã có trong class;
3. `currentCourseId` chỉ khi lớp đã kết thúc, không có course ID cạnh tranh và ngày nguồn phù hợp với khoảng khóa.

Nếu hai nguồn canonical chỉ tới hai course khác nhau hoặc không thể chứng minh course tương ứng, candidate là `ambiguous` và không được ghi.

### 6.2 Học viên

Chỉ tạo candidate khi xác định được `studentId`, `classId` và `courseId`. Student name/code lấy từ document học viên canonical; thiếu tên hoặc mã không được tự điền từ số điện thoại.

Học viên thiếu một trong hai loại snapshot vẫn được tạo record một phần.

### 6.3 Đánh giá

- Chỉ chọn đánh giá cuối khóa thuộc đúng course.
- Khi có nhiều candidate, dùng helper canonical hiện có để chọn version hiện hành.
- Đánh giá giữa khóa đúng course được gắn bổ sung nếu tồn tại.
- Thiếu đánh giá cuối khóa thì không có `evaluationSnapshot`; `evaluationDocument` ở `not_requested`.
- Không đánh dấu evaluation document `ready` nếu chưa có file Storage đã xác minh.

### 6.4 Học phí

Tuition snapshot chỉ được dựng khi có bằng chứng từ:

1. ledger đã xác minh thuộc đúng học viên/khóa; hoặc
2. notification học phí đã gửi, thuộc đúng học viên/khóa và có amount/due date hợp lệ.

Không dùng riêng `class.tuitionFee` để suy ra rằng học phí đã được gửi. Nếu không có bằng chứng, record vẫn được tạo nhưng không có `tuitionSnapshot` và `tuitionDocument` ở `not_requested`.

### 6.5 Hồ sơ hiện hữu

- Record không tồn tại: lập kế hoạch `create`.
- Record tồn tại nhưng thiếu snapshot có thể chứng minh: lập kế hoạch `merge`.
- Record đã có cùng dữ liệu: `unchanged`.
- Snapshot/document đã `ready`: giữ nguyên.
- Dữ liệu nguồn mới mâu thuẫn với snapshot bất biến hiện hữu: `ambiguous`, không ghi đè.

## 7. Trạng thái document

Trong pha backfill record:

- có snapshot và chưa có file xác minh: document ở `pending`;
- không có snapshot/bằng chứng: document ở `not_requested`;
- document hiện hữu đã `ready`: giữ nguyên toàn bộ metadata file;
- không đặt `ready` chỉ dựa trên notification hoặc ledger.

Pha materialize riêng sau này dùng materializer hiện có để chuyển `pending` thành `ready`.

## 8. Giao diện dòng lệnh

Thêm script với các chế độ rõ ràng:

```text
npm run audit:course-closing-records
npm run repair:course-closing-records -- --apply \
  --confirm-project <firebase-project-id> \
  --confirm-database <firestore-database-id>
```

Các tùy chọn:

- mặc định là dry-run;
- `--report-dir <path>` chọn nơi xuất JSON/CSV;
- `--apply` bật writer;
- `--confirm-project` và `--confirm-database` bắt buộc khi apply;
- tùy chọn filter chỉ phục vụ chẩn đoán, không thay đổi mặc định “toàn bộ”.

Không cung cấp cờ ngầm vừa apply vừa materialize.

## 9. Trình tự vận hành

1. Chạy unit test và typecheck.
2. Chạy dry-run trên Firestore production.
3. Kiểm tra summary, JSON/CSV và các candidate `ambiguous`/`skipped`.
4. Trình người dùng số lượng tổng hợp và mẫu record dự kiến.
5. Dừng và chờ người dùng xác nhận riêng.
6. Chạy apply với project/database confirmation.
7. Đọc lại `course_closing_records` và đối chiếu số lượng đã ghi.
8. Chạy dry-run lần hai; kết quả phải chỉ còn `unchanged`, `ambiguous` hoặc `skipped`.
9. Báo cáo kết quả cho người dùng.
10. Chỉ lập kế hoạch materialize DOCX sau một quyết định riêng.

## 10. Xử lý lỗi

- Credential/database thiếu: dừng trước khi đọc.
- Project/database xác nhận không khớp: dừng trước khi ghi.
- Date/identity không hợp lệ: `ambiguous` hoặc `skipped` với reason code; không làm hỏng toàn bộ run.
- Read lỗi: kết thúc run thất bại, không apply kế hoạch không đầy đủ.
- Batch write lỗi: dừng, báo batch/candidate bị ảnh hưởng; lần chạy lại tiếp tục an toàn nhờ deterministic ID và merge.
- Record thay đổi giữa dry-run và apply: writer đọc lại và từ chối ghi đè field bất biến/`ready`.
- Báo cáo không ghi credential hoặc dump document nguồn đầy đủ.

## 11. Kiểm thử

### 11.1 Unit

- xác định course canonical và fallback an toàn;
- phát hiện course mâu thuẫn;
- hồ sơ đủ hai snapshot;
- hồ sơ chỉ có evaluation;
- hồ sơ chỉ có tuition;
- hồ sơ không có cả hai nhưng có identity hợp lệ;
- nhiều final evaluation và chọn version canonical;
- ledger/notification không thuộc course bị loại;
- merge record hiện hữu;
- bảo toàn document `ready`;
- idempotency;
- redaction báo cáo.

### 11.2 I/O

- dry-run không gọi `set`, `update`, `create` hoặc `commit`;
- apply yêu cầu hai giá trị xác nhận;
- batch writer giới hạn kích thước;
- lỗi một read làm dừng trước writer;
- conflict tại thời điểm apply không ghi đè snapshot bất biến.

### 11.3 Production verification

- số record đọc lại bằng số `create + merge` thành công cộng record hiện hữu;
- chọn mẫu record đủ, thiếu evaluation, thiếu tuition và ambiguous để đối chiếu;
- chạy lại dry-run không tạo thêm `create`/`merge`;
- API tháng gần nhất và danh sách hồ sơ đọc được các record vừa backfill.

## 12. Tiêu chí hoàn thành

- Có dry-run report cho toàn bộ Firestore production.
- Người dùng đã xem report và xác nhận trước apply.
- Không có write trước xác nhận đó.
- Apply tạo/merge đúng record và không gửi Zalo.
- Hồ sơ một phần hiển thị đúng phần thiếu.
- Không ghi đè record/document đã `ready`.
- Dry-run sau apply chứng minh idempotent.
- Chưa materialize DOCX hàng loạt nếu chưa có quyết định riêng.
