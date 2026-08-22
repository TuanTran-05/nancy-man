# Thiết kế kho lưu trữ hồ sơ kết khóa

**Ngày:** 2026-07-23
**Trạng thái:** Chờ người dùng duyệt đặc tả
**Phạm vi:** Office Academic, Zalo course-closing notifications, Firebase Storage, kho hồ sơ dùng chung cho Admin/Office/Kế toán

## 1. Bối cảnh

Hệ thống đã có luồng kết khóa chuẩn hóa theo `currentCourseId`, nhận xét giữa khóa/cuối khóa, điểm thi, học phí khóa tiếp theo, lịch khóa mới, trạng thái phê duyệt kết khóa và bằng chứng gửi Zalo. Office hiện gửi nhận xét và thông báo học phí cho từng học viên hoặc theo lô từ trang Học vụ.

Hai file Word do người dùng cung cấp là mẫu hồ sơ nội bộ:

- `Nhận Xét Kết Khóa.docx`, SHA-256 `A1F45565B879BB00609BB06E89EEEE97E4B289B30A40917C02E520E0F1A2AF19`;
- `THÔNG BÁO HP.docx`, SHA-256 `0BB08A44AD6FC1592953410559714D75A50A2DB164179DEAB28347B8CF1B39BF`.

Hai file này không được gửi cho phụ huynh. Sau khi một thông báo Zalo tương ứng gửi thành công, hệ thống tự điền mẫu, lưu DOCX vào Firebase Storage và tạo metadata để tra cứu trong ứng dụng.

## 2. Mục tiêu

1. Mỗi học viên trong mỗi khóa có tối đa một bộ hồ sơ gồm phiếu nhận xét và thông báo học phí.
2. Hồ sơ phản ánh đúng dữ liệu đã dùng tại thời điểm gửi, không thay đổi khi lớp được reset hoặc cấu hình học phí thay đổi.
3. Hồ sơ được phân loại theo tháng kết khóa, sau đó theo lớp và học viên.
4. Admin và Office được xem, tải cả hai loại hồ sơ.
5. Kế toán chỉ được xem, tải thông báo học phí.
6. File chỉ được truy cập qua backend bằng URL ký có thời hạn; client không được đọc trực tiếp Firestore hoặc Storage.
7. Tạo file có tính idempotent, tự thử lại khi lỗi và không gửi lại Zalo.

## 3. Quyết định nghiệp vụ đã duyệt

- Luồng gửi Zalo hiện tại không thay đổi nội dung hay hành vi gửi.
- DOCX chỉ là bản lưu nội bộ, không đính kèm vào Zalo.
- Đơn vị lưu trữ là một học viên trong một `courseId`.
- Cấu trúc hiển thị là `tháng kết khóa → lớp → học viên → hai loại hồ sơ`.
- `closingMonth` được lấy từ tháng của ngày kết khóa trong snapshot khóa, không lấy từ tháng người dùng bấm gửi.
- Phiếu nhận xét được tạo sau khi thông báo nhận xét gửi thành công.
- Thông báo học phí được tạo sau khi thông báo học phí gửi thành công.
- Gửi thất bại không tạo hồ sơ tương ứng.
- Hai loại hồ sơ độc lập; một record có thể tạm thời chỉ có phiếu nhận xét.
- Thiếu nhận xét giữa khóa không chặn tạo phiếu; các ô giữa khóa được để trống.
- Hồ sơ đã sẵn sàng là bất biến và không có chức năng sửa hoặc xóa từ UI.
- Thông báo hạng không tạo thêm tài liệu.

## 4. Phương án kỹ thuật được chọn

Áp dụng mô hình **tạo ngay kết hợp outbox**:

1. Sau khi Zalo gửi thành công, server ghi snapshot bất biến và tạo outbox job có khóa idempotency.
2. Server cố gắng tạo và tải DOCX lên Storage ngay trong request hiện tại để hồ sơ xuất hiện sớm.
3. Nếu tạo file ngay thất bại, kết quả gửi Zalo vẫn được giữ là thành công; outbox tự thử lại.
4. Khi Office bấm lại một thông báo đã gửi, server không gửi Zalo lần hai. Nếu file còn thiếu, server bảo đảm outbox repair tồn tại cho đúng snapshot đã lưu.
5. Mọi lần materialize lại dùng cùng record ID và Storage path nên không tạo hồ sơ trùng.

Phương án này tận dụng `outbox_jobs` và cron bảo trì hiện có, đồng thời tránh độ trễ thường gặp của phương án chỉ chạy nền.

## 5. Mô hình dữ liệu

### 5.1 Collection

Tạo collection server-only:

```text
course_closing_records
```

Document ID xác định:

```text
{courseId}__{studentId}
```

`courseId` và `studentId` đều là Firestore document ID hiện hữu nên không chứa dấu `/`.

### 5.2 Kiểu dữ liệu

```ts
type ClosingDocumentType = 'evaluation' | 'tuition';

type ClosingDocumentStatus =
  | 'not_requested'
  | 'pending'
  | 'ready'
  | 'retrying'
  | 'failed';

interface ClosingStoredDocument {
  type: ClosingDocumentType;
  status: ClosingDocumentStatus;
  templateVersion: 1;
  storagePath?: string;
  downloadFilename?: string;
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  generatedAt?: string;
  sourceNotificationId?: string;
  attempts: number;
  lastAttemptAt?: string;
  lastErrorCode?: string;
}

interface CourseClosingEvaluationSnapshot {
  evaluationId: string;
  evaluationVersion: string;
  evaluationDate: string;
  scores: {
    attendance: number;
    effort: number;
    pronunciation: number;
    homework: number;
    behavior: number;
  };
  finalExamScore: number;
  totalScore: number;
  classification: 'excellent' | 'good' | 'fair' | 'average' | 'failing';
  positivePoints: string[];
  improvementPoints: string;
  midterm?: {
    evaluationId: string;
    evaluationDate: string;
    examScore: number;
  };
}

interface CourseClosingTuitionSnapshot {
  noticeDate: string;
  amount: number;
  paymentWindowStart: string;
  paymentDueDate: string;
  previousCourseStartDate: string;
  previousCourseEndDate: string;
  finalExamDate: string;
  finalExamScore: number;
  nextCourseStartDate: string;
  nextCourseEndDate: string;
  ledgerId?: string;
}

interface CourseClosingRecord {
  id: string;
  recordVersion: 1;
  closingMonth: string;
  courseId: string;
  classId: string;
  className: string;
  classNameNormalized: string;
  courseStartDate: string;
  courseEndDate: string;
  studentId: string;
  studentName: string;
  studentNameNormalized: string;
  studentCode: string;
  teacherId: string;
  teacherName: string;
  evaluationSnapshot?: CourseClosingEvaluationSnapshot;
  tuitionSnapshot?: CourseClosingTuitionSnapshot;
  evaluationDocument: ClosingStoredDocument;
  tuitionDocument: ClosingStoredDocument;
  createdAt: string;
  updatedAt: string;
}
```

Không lưu số điện thoại, mật khẩu, ảnh học viên hoặc toàn bộ class/student document vào record.

### 5.3 Trạng thái hiển thị

Client suy ra trạng thái hàng học viên từ hai document:

- cả hai `ready`: `Đủ 2 hồ sơ`;
- evaluation `ready`, tuition `not_requested`: `Thiếu thư học phí`;
- evaluation chưa `ready`, tuition `ready`: `Thiếu phiếu nhận xét`;
- có `pending` hoặc `retrying`: `Đang tạo lại`;
- có `failed`: `Tạo file thất bại`.

Kế toán chỉ nhận projection học phí nên không được suy ra hay nhận trạng thái chi tiết của phiếu nhận xét.

## 6. Ánh xạ mẫu Word

### 6.1 Phiếu nhận xét kết khóa

Mẫu là A4 dọc, lề 0,5 inch, nội dung chính nằm trong một bảng. Các trường được điền như sau:

| Vị trí trong mẫu | Nguồn canonical |
|---|---|
| Full name | `studentName` |
| Class | `className` |
| Attendance | `evaluationSnapshot.scores.attendance` |
| Effort & Participation | `evaluationSnapshot.scores.effort` |
| Pronunciation | `evaluationSnapshot.scores.pronunciation` |
| Homework | `evaluationSnapshot.scores.homework` |
| Behavior | `evaluationSnapshot.scores.behavior` |
| Mid-term date/result | `midterm.evaluationDate` và `midterm.examScore`; để trống nếu không có |
| Final test date/result | `evaluationDate` và `finalExamScore` |
| Final result | `totalScore` |
| Xếp loại | `classification` |
| Teacher’s comments | điểm tốt và điểm cần cải thiện |
| Teacher | `teacherName` |
| Ý kiến phụ huynh | để trống |

Xếp loại dùng đúng thang của mẫu:

- 90–100: `Excellent (Xuất sắc)`;
- 80–89: `Good (Giỏi)`;
- 70–79: `Fair (Khá)`;
- 56–69: `Average (Trung bình)`;
- 0–55: `Failing (Yếu)`.

`finalExamScore` dùng `finalScore`; nếu dữ liệu legacy không có `finalScore`, dùng cùng fallback canonical của Zalo là `totalScore`.

### 6.2 Thông báo học phí

Mẫu là A5 dọc. Nội dung được điền như sau:

| Vị trí trong mẫu | Nguồn canonical |
|---|---|
| Học viên | `studentName` |
| Lớp | `className` |
| Ngày khai giảng/kết khóa | `previousCourseStartDate` / `previousCourseEndDate` |
| Ngày thi cuối khóa | `finalExamDate` |
| Điểm thi cuối khóa | `finalExamScore` |
| Ngày lên khóa mới | `nextCourseStartDate` |
| Ngày bắt đầu khóa mới | `nextCourseStartDate` |
| Thời gian đăng ký/đóng phí | `paymentWindowStart` đến `paymentDueDate` |
| Học phí | `amount`, định dạng VND |
| Ngày lập thư | `noticeDate`, định dạng ngày Việt Nam |

Số tiền phải đúng giá trị đã dùng để gửi Zalo: ưu tiên ledger đã xác minh, sau đó mới dùng `class.tuitionFee`. Lịch khóa mới và hạn đóng dùng chung helper canonical `getNextCourseTuitionSchedule`.

### 6.3 Phiên bản mẫu

Hai mẫu được lưu trong source dưới tên phiên bản v1. Runtime luôn ghi `templateVersion: 1` vào document metadata. Thay mẫu trong tương lai phải tạo phiên bản mới; không ghi đè hoặc tái tạo hàng loạt hồ sơ cũ.

## 7. Storage

Storage path xác định:

```text
course_closing_records/{closingMonth}/{classId}/{courseId}/{studentId}/evaluation-v1.docx
course_closing_records/{closingMonth}/{classId}/{courseId}/{studentId}/tuition-v1.docx
```

Tên tải xuống thân thiện:

```text
{studentName}_Nhan_xet_ket_khoa.docx
{studentName}_Thong_bao_hoc_phi.docx
```

Tên tải được sanitize ở backend. Storage path dùng ID ổn định, không dùng tên người hoặc tên lớp.

Storage metadata gồm MIME type, record ID, document type, course ID và template version; không chứa nội dung nhận xét.

## 8. Luồng tạo hồ sơ

### 8.1 Gửi nhận xét

1. Luồng hiện tại chạy guard kết khóa và lấy `CourseClosingSendContext`.
2. Zalo gửi nhận xét thành công hoặc bằng chứng cho biết đã gửi đúng course/evaluation version.
3. Server lấy nhận xét giữa khóa cùng kỳ nếu tồn tại, lấy tên giáo viên và dựng snapshot tối thiểu.
4. Server upsert `course_closing_records/{courseId}__{studentId}`.
5. Server tạo outbox job `materialize_course_closing_document` với idempotency key:

```text
closing-record:{courseId}:{studentId}:evaluation:v1
```

6. Server chạy materializer ngay; thành công thì upload DOCX, đánh dấu artifact `ready` và đánh dấu outbox job `done`.
7. Nếu materializer lỗi, record giữ `pending`/`retrying`; outbox xử lý lại mà không gọi Zalo.

### 8.2 Gửi học phí

1. Luồng hiện tại chạy guard kết khóa, xác minh ledger nếu client cung cấp `ledgerId` và dựng nội dung học phí canonical.
2. Zalo gửi thông báo học phí thành công hoặc bằng chứng cho biết thông báo đúng course đã được gửi.
3. Server chụp amount thực gửi, ledger ID, ngày gửi, lịch khóa mới, hạn đóng và điểm thi cuối khóa vào `tuitionSnapshot`.
4. Server merge snapshot vào đúng document `{courseId}__{studentId}` mà luồng nhận xét đã tạo; không thay đổi `evaluationSnapshot`.
5. Server tạo outbox job `materialize_course_closing_document` với idempotency key:

```text
closing-record:{courseId}:{studentId}:tuition:v1
```

6. Server chạy materializer ngay; thành công thì upload DOCX, đánh dấu tuition artifact `ready` và outbox job `done`.
7. Nếu tạo hoặc upload file lỗi, tuition artifact giữ `pending`/`retrying`; outbox xử lý lại từ `tuitionSnapshot` mà không gọi Zalo.

### 8.3 Gửi hàng loạt

Các đường single-send và bulk-send phải gọi cùng một archive service. Chế độ `both` tạo phiếu nhận xét sau phần evaluation thành công và tạo thông báo học phí sau phần tuition thành công. Một phần thất bại không làm mất file đã tạo từ phần thành công.

### 8.4 Retry và dữ liệu thay đổi

- Materializer chỉ đọc snapshot trong `course_closing_records`, không đọc lại class/evaluation hiện tại.
- Reset Course sau khi gửi không ảnh hưởng hồ sơ đang pending.
- Upload retry ghi cùng Storage path.
- Nếu artifact đã `ready`, materializer trả thành công mà không tạo bản sao.
- Sau 5 lần outbox thất bại, artifact chuyển `failed`.
- Re-click một notification đã gửi phải bảo đảm snapshot/outbox còn tồn tại; không gọi lại Zalo.

## 9. API

Tiếp tục dùng serverless function classes hiện có để không tạo thêm function bundle.

### 9.1 Danh sách

```http
GET /api/v1/classes/course-closing-records?month=2026-07&q=nguyen
```

Quy tắc:

- `month` bắt buộc theo `YYYY-MM`;
- API chỉ đọc record có `closingMonth` tương ứng, giới hạn 1.000 record/tháng;
- `q` tùy chọn, server chuẩn hóa dấu/hoa-thường rồi lọc theo tên lớp, tên học viên hoặc mã học viên;
- response được sort theo tên lớp rồi tên học viên;
- nếu vượt 1.000 record, trả `truncated: true` để UI cảnh báo thay vì âm thầm bỏ dữ liệu.

Projection theo role:

- Admin/Office: metadata và preview của cả evaluation/tuition;
- Kế toán: chỉ metadata lớp/học viên/tháng và `tuitionSnapshot`/`tuitionDocument`; loại bỏ toàn bộ evaluation snapshot/document;
- role khác: `403`.

Khi không truyền tháng ở lần mở đầu, client gọi endpoint lấy tháng gần nhất:

```http
GET /api/v1/classes/course-closing-record-month
```

Endpoint trả `latestMonth` hoặc tháng hiện tại nếu chưa có record.

### 9.2 Mở hoặc tải file

```http
GET /api/v1/classes/course-closing-record-file
  ?recordId={courseId}__{studentId}
  &documentType=evaluation|tuition
  &mode=inline|attachment
```

Quy tắc:

- Admin/Office được lấy cả hai loại;
- Kế toán chỉ được lấy `tuition`;
- role khác hoặc Kế toán yêu cầu `evaluation`: `403`;
- artifact phải ở trạng thái `ready`, nếu không trả `409`;
- backend lấy `storagePath` từ Firestore, không nhận path từ client;
- URL ký có thời hạn tối đa 10 phút;
- `mode=attachment` đặt `Content-Disposition` theo `downloadFilename`;
- mỗi lượt mở/tải ghi audit bắt buộc.

## 10. Giao diện

### 10.1 Route và điều hướng

Tạo route dùng chung:

```text
/course-closing-records
```

- Admin: mục `Kho hồ sơ kết khóa` trong nhóm Báo cáo.
- Office: mục `Kho hồ sơ kết khóa` gần trang Học vụ.
- Kế toán: mục `Kho thông báo học phí` trong khu vực Tài chính.

Route cho phép `admin`, `office`, `accounting`; nội dung tiếp tục được giới hạn tại backend.

### 10.2 Bố cục

- Bộ chọn tháng, mặc định tháng gần nhất có hồ sơ.
- Ô tìm theo lớp, học viên hoặc mã học viên.
- Nhóm theo lớp; header lớp hiển thị ngày kết khóa và số hồ sơ đầy đủ.
- Hàng học viên hiển thị trạng thái từng tài liệu.
- `Xem thông tin` mở modal preview từ snapshot.
- `Tải Word` lấy URL ký qua API.
- Không có nút sửa, xóa hoặc thay thế file.

Kế toán chỉ thấy thông tin cần cho thư học phí: tháng, lớp, học viên, số tiền, hạn đóng, trạng thái và file học phí. Tiêu chí đánh giá, nhận xét giáo viên và phiếu nhận xét không xuất hiện trong DOM hoặc API response.

## 11. Quyền và bảo mật

| Vai trò | Phiếu nhận xét | Thông báo học phí |
|---|---:|---:|
| Admin | Xem, tải | Xem, tải |
| Office | Xem, tải | Xem, tải |
| Kế toán | Không truy cập | Xem, tải |
| Giáo viên, phụ huynh, học viên | Không truy cập | Không truy cập |

Firestore Rules cấm toàn bộ client read/write collection `course_closing_records`. Storage Rules cấm toàn bộ client read/write prefix `course_closing_records/**`. Việc đoán record ID, URL route hoặc Storage path không vượt qua được kiểm tra role phía server.

Audit lưu actor, role, record ID, document type, mode và thời điểm. Audit không lưu nội dung nhận xét, điểm chi tiết hoặc số điện thoại.

## 12. Xử lý lỗi

- Zalo lỗi: giữ hành vi hiện tại, không tạo snapshot tài liệu.
- Snapshot/upsert lỗi sau khi Zalo thành công: request ghi lỗi có cấu trúc và lần retry/already-sent path phải khởi tạo repair mà không gửi lại Zalo.
- Sinh DOCX lỗi: artifact `pending` hoặc `retrying`, outbox tiếp tục.
- Upload Storage lỗi: cùng cơ chế retry, không ghi `ready`.
- Firestore update cuối lỗi sau khi upload: retry kiểm tra file cùng path và hoàn tất metadata, không tạo file thứ hai.
- Hết 5 lần retry: artifact `failed`, UI hiển thị lỗi chung; `lastErrorCode` không chứa dữ liệu cá nhân.
- File Storage bị mất nhưng metadata `ready`: download trả lỗi có cấu trúc và enqueue repair cho đúng snapshot/version.
- Một artifact lỗi không thay đổi trạng thái artifact còn lại.

## 13. Quan sát và audit

Ghi audit cho:

- tạo snapshot hồ sơ;
- materialize thành công/thất bại cuối;
- mở preview;
- lấy URL xem inline;
- tải file attachment.

Structured logs dùng `recordId`, `courseId`, `documentType`, `templateVersion`, `errorCode` và outbox job ID. Không log nội dung nhận xét hoặc đường dẫn signed URL.

## 14. Migration và dữ liệu cũ

Phạm vi đầu tiên áp dụng cho các lần gửi từ sau khi tính năng được triển khai. Không tự động dựng hồ sơ từ log legacy vì các log cũ có thể thiếu snapshot điểm, lịch và học phí chính xác.

Một lần bấm lại thông báo đã gửi trong current course có đủ bằng chứng canonical sẽ không gửi Zalo lần hai và có thể tạo repair job cho file còn thiếu. Hồ sơ của khóa cũ đã reset không được suy đoán hoặc tự sinh nếu không có snapshot bất biến.

## 15. Kiểm thử

### 15.1 Unit

- `closingMonth` theo ngày kết khóa;
- xếp loại tại các biên 0, 55, 56, 69, 70, 79, 80, 89, 90, 100;
- fallback `finalScore → totalScore`;
- thiếu midterm tạo ô trống;
- số tiền ưu tiên ledger rồi class fee;
- Storage path, download filename và idempotency key xác định;
- role projection loại bỏ evaluation khỏi response kế toán.

### 15.2 DOCX

- hai template v1 giữ đúng SHA baseline nguồn trước khi chèn slot;
- file kết quả là ZIP/OOXML hợp lệ và có đủ package part bắt buộc;
- không còn marker slot chưa điền;
- ký tự tiếng Việt được giữ đúng;
- page size/margin A4 và A5 không thay đổi;
- bảng phiếu nhận xét, header/footer, styles, relationships và phần không chỉnh sửa được giữ nguyên;
- nội dung dài nhất trong giới hạn hiện tại không làm hỏng package;
- render và kiểm tra trực quan cả hai fixture trước khi giao tính năng.

### 15.3 API và tích hợp

- send evaluation thành công tạo snapshot/job/file;
- send tuition thành công cập nhật đúng record;
- Zalo thất bại không tạo artifact;
- bulk và single dùng cùng archive service;
- chế độ `both` tạo độc lập hai artifact;
- retry không gọi Zalo và không nhân đôi Firestore/Storage;
- reset course trước khi outbox chạy không đổi nội dung;
- missing Storage object enqueue repair;
- Admin/Office xem, tải hai loại;
- Kế toán chỉ xem, tải tuition;
- các role khác và truy cập chéo của kế toán trả `403`;
- artifact chưa ready trả `409`;
- audit được ghi khi xem/tải.

### 15.4 UI

- mặc định tháng gần nhất;
- đổi tháng và tìm kiếm;
- nhóm lớp và sort học viên;
- năm trạng thái hiển thị;
- modal preview đúng projection;
- kế toán không nhận/render dữ liệu evaluation;
- lỗi tải, trạng thái pending/failed và empty state có thông báo rõ ràng.

### 15.5 Rules và regression

- Firestore client không đọc/ghi `course_closing_records`;
- Storage client không đọc/ghi `course_closing_records/**`;
- luồng gửi Zalo hiện tại, course-closing approval và Reset Course vẫn pass;
- outbox handler hiện hữu vẫn xử lý receipt/accounting jobs.

## 16. Tiêu chí nghiệm thu

1. Gửi nhận xét thành công tạo đúng một phiếu DOCX cho học viên/course.
2. Gửi học phí thành công tạo đúng một thông báo DOCX trong cùng record.
3. Nội dung hai DOCX khớp dữ liệu canonical đã gửi và giữ bố cục mẫu.
4. Hồ sơ được tìm theo tháng kết khóa và nhóm đúng lớp/học viên.
5. Admin/Office xem, tải cả hai file; Kế toán chỉ xem, tải học phí.
6. Không client nào truy cập trực tiếp collection hoặc Storage prefix.
7. Retry không gửi lại Zalo và không tạo file/record trùng.
8. Reset lớp hoặc thay đổi dữ liệu sau khi gửi không làm hồ sơ cũ thay đổi.
9. Test unit, DOCX, API, UI, rules và regression liên quan đều pass.

## 17. Ngoài phạm vi

- Gửi hai file Word cho phụ huynh.
- Gửi email.
- Cho giáo viên, phụ huynh hoặc học viên vào kho.
- Cho Kế toán xem phiếu nhận xét.
- Sửa, xóa hoặc thay thế hồ sơ đã `ready`.
- Tự động backfill mọi log legacy.
- Chuyển DOCX sang PDF hoặc tạo trình xem Word giống Microsoft Word.
- Thiết kế lại nội dung Zalo, course-closing state machine hoặc ledger.
