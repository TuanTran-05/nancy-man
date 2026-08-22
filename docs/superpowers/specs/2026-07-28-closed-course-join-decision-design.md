# Thiết kế: Quyết định khi thêm học sinh vào lớp đã kết khóa

- **Ngày:** 2026-07-28
- **Trạng thái:** Đã triển khai và kiểm chứng
- **Phạm vi:** Modal quyết định ở 3 luồng gán học sinh vào lớp, tham số `joinedAt` cho 4 endpoint, module domain dùng chung cho client và server

## 0. Tình trạng kiểm chứng

| Hạng mục | Kết quả |
|---|---|
| Vitest toàn bộ | 378 file pass, 2 skipped; 2616 test pass, 121 skipped, 0 fail |
| `tsc --noEmit` | pass |
| `npm run build` | pass |
| `eslint .` | 0 error |
| Chạy thử trình duyệt thật | Modal render đúng tiếng Việt, nằm trên modal nền, chặn ngày ngoài phạm vi, trả về `2026-02-10` đúng định dạng ISO khi nhập `10/02/2026` |

**Chưa kiểm chứng:** đường ghi thật xuống Firestore. `.env` không có `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` / `FIREBASE_STORAGE_BUCKET`, và `/api` cần `vercel dev` (Vercel CLI chưa cài). Toàn bộ bằng chứng phía server đến từ unit test với Firestore giả.

**Lưu ý không liên quan:** `api/audit/cold-imports.test.ts` đỏ khoảng một nửa số lần chạy trên máy này do timeout 5000ms mặc định trong khi chi phí thật dao động 3,2–6,3 giây. File này không nằm trong thay đổi và chuỗi import của nó không chạm tới module mới.

## 1. Bối cảnh

Thêm học sinh vào lớp đã qua ngày kết khóa thất bại với lỗi 500:

```
Error: joinedAt must be within the course term
  at assertValidStudentCourseEnrollment (shared/studentCourseEnrollment.ts:170)
  at upsertSystemEnrollment (server/api/lib/student/courseEnrollmentRepository.ts:227)
```

Bất biến tại `shared/studentCourseEnrollment.ts:169` yêu cầu `termStart <= joinedAt <= termEnd`. Công thức tính `joinedAt` lại chỉ kẹp một chiều:

```ts
const joinedAt = term ? (today < term.termStart ? term.termStart : today) : today;
```

Vào sớm thì được nâng lên `termStart`, vào sau ngày kết khóa thì `joinedAt = today > termEnd` nên vi phạm bất biến. Cùng công thức đó bị lặp ở 8 vị trí.

Bản sửa đã áp dụng (commit chưa tạo tại thời điểm viết spec): helper dùng chung `resolveTermJoinedAt` kẹp cả hai đầu, dùng ở toàn bộ 8 vị trí. Lớp đã kết khóa giờ nhận `joinedAt = termEnd`.

Việc kẹp im lặng đó chấm dứt lỗi 500 nhưng ghi một ngày không ai chọn. Spec này thay bằng một quyết định tường minh của người dùng.

## 2. Mục tiêu

1. Người dùng gán học sinh vào lớp đã kết khóa phải được hỏi, không bị chặn cũng không bị ghi âm thầm.
2. Chọn khóa hiện tại thì tự nhập ngày vào học, bắt buộc nằm trong phạm vi khóa.
3. Chọn khóa sau thì được hướng dẫn reset course, không ghi dữ liệu nào.
4. Ngày đã chọn phải chi phối điểm danh của học sinh trong khóa đó.
5. Các luồng không có giao diện không được gãy.

## 3. Điều kiện coi là lớp đã kết khóa

`today > termEnd` **hoặc** `courseClosing.approval.status === 'approved'`.

Vế thứ hai bao trường hợp lớp được duyệt kết khóa sớm hơn ngày kết thúc: khóa đã chốt sổ nên thêm học sinh vào vẫn là bất thường dù còn trong hạn ngày.

Dùng `approval.status` chứ không dùng `'completed'`. `CourseClosingStatus` với giá trị `'completed'` chỉ tồn tại trên `CourseClosingSnapshot`, do `deriveCourseClosingSnapshot` tính ra từ evaluation và evidence của nhiều collection. Document lớp chỉ lưu `courseClosing.approval` (`server/api/classes/helpers/courseClosing.ts:655`), nên `approval.status === 'approved'` là tín hiệu duy nhất đọc được rẻ ở cả hai phía. `'invalidated'` nghĩa là phê duyệt đã bị hủy hiệu lực nên không tính là đã chốt sổ.

Lớp legacy không có `startDate` lẫn `terms[]` không xác định được phạm vi, giữ nguyên hành vi hiện tại: không hiện modal, không ghi enrollment.

### 3.1 Dữ liệu lớp mà client đang có

`projectedClassDoc` (`server/api/read/handlers/utils.ts:499`) là payload lớp gửi cho client. Hiện nó trả `startDate` và `endDate` nhưng không trả `terms` lẫn `courseClosing`.

Bổ sung đúng một trường dẫn xuất:

```ts
...(data.courseClosing &&
typeof data.courseClosing === 'object' &&
(data.courseClosing as { approval?: { status?: unknown } }).approval?.status === 'approved'
  ? { courseClosingApproved: true }
  : {}),
```

Không trả cả khối `courseClosing` vì client chỉ cần một boolean, và khối đó chứa danh sách `exemptions` không cần thiết cho màn hình học sinh.

Hệ quả: `courseClosingApproved()` trong module domain phải đọc được **cả hai** hình dạng — `courseClosing.approval.status` của document gốc (phía server) và cờ `courseClosingApproved` đã dẫn xuất (phía client). Nếu chỉ đọc một, phía còn lại sẽ không bao giờ nhận ra khóa đã chốt sổ.

Client không có `terms[]` là chấp nhận được: `startDate`/`endDate` trên document lớp luôn mô tả khóa **hiện tại**, còn `terms[]` là lịch sử các khóa đã đóng. Client chỉ cần biết có nên hỏi hay không; server vẫn là nơi phân giải term thật và xác thực `joinedAt`.

## 4. Tầng domain dùng chung

Module mới `shared/classJoinWindow.ts`, thuần túy, không đụng Firestore:

```ts
export type ClosedCourseReason = 'term_ended' | 'closing_completed';

export type ClassJoinWindow = {
  termStart: string;
  termEnd: string | null;
  isClosed: boolean;
  closedReason: ClosedCourseReason | null;
};

export function resolveClassJoinWindow(
  classData: Record<string, unknown>,
  today: string
): ClassJoinWindow | null;

export function isJoinedAtInWindow(window: ClassJoinWindow, joinedAt: string): boolean;

export function resolveTermJoinedAt(
  term: { termStart: string; termEnd: string | null },
  today: string
): string;
```

`resolveClassJoinWindow` tái dùng đúng thứ tự ưu tiên của `resolveClassCurrentTerm` hiện tại: term trong `terms[]` chứa `today` trước, sau đó fallback `classData.startDate/endDate`. Trả `null` khi không có `termStart`.

`resolveTermJoinedAt` kẹp `joinedAt` vào cả hai biên của term. Đây chính là bản sửa lỗi 500 gốc: công thức cũ chỉ nâng ngày vào sớm lên `termStart` mà không hạ ngày vào muộn xuống `termEnd`.

`resolveClassCurrentTerm` trong `server/api/lib/student/courseEnrollmentRepository.ts` ủy quyền cho module này và giữ nguyên chữ ký cùng hành vi ném lỗi 409, để client và server không lệch định nghĩa. File này cũng re-export `resolveTermJoinedAt` để các handler giữ nguyên đường import hiện có.

Module nằm ở `shared/` vì cả `Class` phía client lẫn document Firestore phía server đều có `startDate`, `endDate`, `terms`, `courseClosing`.

### 4.1 Thay đổi hành vi: ngày được kiểm chặt hơn

`resolveClassCurrentTerm` cũ nhận **mọi chuỗi** làm `startDate`/`endDate`:

```ts
const start = typeof classData.startDate === 'string' ? classData.startDate : '';
```

`resolveClassTermRange` mới chỉ nhận chuỗi khớp `YYYY-MM-DD` và là ngày có thật trên lịch.

Hệ quả cho lớp có ngày sai định dạng: trước đây term rác được dựng ra rồi chết ở `assertValidStudentCourseEnrollment` với lỗi **500**; giờ term không phân giải được nên trả `null` — `resolveClassCurrentTerm` ném **409** và các đường dùng `tryResolveClassCurrentTerm` lặng lẽ bỏ qua việc ghi enrollment, đúng như với lớp legacy không có ngày.

Đây là cải thiện chứ không phải hồi quy, nhưng người vận hành cần biết: một lớp có `startDate` hỏng sẽ chuyển từ "báo lỗi ồn ào" sang "không ghi enrollment". Nếu nghi ngờ có lớp như vậy, chạy `npm run audit:student-course-enrollments` để đối chiếu.

## 5. Hợp đồng API

Bốn endpoint nhận thêm trường tùy chọn `joinedAt` dạng `YYYY-MM-DD`:

| Endpoint | Handler |
|---|---|
| `POST /api/students/create` | `server/api/lib/student/studentCreation.ts` |
| `PUT /api/students/update` | `server/api/students/handlers/update.ts` |
| `POST /api/students/transfer` | `server/api/students/handlers/transfer.ts` |
| `POST /api/admissions/create-trial` | `server/api/admissions/handlers/createTrial.ts` (cả ba nhánh) |

Quy tắc xử lý:

- Có `joinedAt`: phải là ISO date hợp lệ và nằm trong `[termStart, termEnd]` của lớp đích. Sai định dạng hoặc ngoài phạm vi trả **400** kèm thông điệp nêu rõ phạm vi hợp lệ.
- Không có `joinedAt`: giữ nguyên `resolveTermJoinedAt` như hiện tại. Đây là lưới an toàn cho import Excel, reset-course và script backfill, những luồng không có giao diện để hỏi.
- Lớp không phân giải được term: bỏ qua `joinedAt`, không ghi enrollment, y như hiện tại.

`joinedAt` được ghi vào **cả hai** nơi:

1. `student_course_enrollments` qua `upsertSystemEnrollment` — đã có.
2. `students.courseJoins` qua `appendCourseJoin` — **mới** cho create, update và cả ba nhánh create-trial. `transfer` đã ghi sẵn.

### 5.1 Vì sao `trial-decision` không nhận `joinedAt`

Đến bước duyệt học thử, học sinh đã có enrollment `trial` cho đúng bộ `(studentId, classId, termStart)` do create-trial ghi. `upsertSystemEnrollment` giữ `existing?.joinedAt` (`courseEnrollmentRepository.ts:241`) và `appendCourseJoin` không bao giờ ghi đè entry cùng khóa (`enrollmentWindowWrites.ts:21`). Cả hai đều là hành vi cố ý bảo vệ dữ liệu backfill. Hỏi ngày ở bước duyệt sẽ cho ra một modal mà câu trả lời bị vứt đi.

Ngày vào học được ấn định đúng một lần, lúc học sinh lần đầu vào khóa. Bước duyệt chỉ đổi trạng thái.

### 5.2 Ba nhánh của `create-trial`

`handleCreateTrial` rẽ vào một trong ba hàm, cả ba đều phải nhận `joinedAt`:

| Nhánh | Vị trí | Ghi enrollment hiện tại |
|---|---|---|
| `createTrialStudent` | `createTrial.ts:211` | Có |
| `reactivateTrialStudent` | `createTrial.ts:65` | Có |
| `promotePendingToTrial` | `createTrial.ts:294` | **Không có** |

Nhánh thứ ba là nhánh trang Admissions thực sự dùng: `handleCreateTrialSubmit` (`src/pages/office/Admissions.tsx:423`) luôn gửi `pendingStudentId`. Nhánh này hiện không gọi `resolveClassCurrentTerm` lẫn `upsertSystemEnrollment`, nên học sinh chờ được chuyển thành học thử mà không có bản ghi enrollment nào. Đây là lỗ hổng có sẵn, không do thiết kế này tạo ra, nhưng phải vá thì modal mới có tác dụng.

### 5.3 `trialStartedAt` phải theo `joinedAt`

`countTrialAttendance` (`server/api/lib/admissions/trial.ts:20`) bỏ qua mọi bản ghi attendance có `date` trước `trialStartedAt`. Nếu người dùng chọn một ngày trong quá khứ mà `trialStartedAt` vẫn là hiện tại, học sinh không bao giờ đếm đủ buổi và kẹt vĩnh viễn ở `pending_sessions`.

Khi request có `joinedAt` tường minh, cả ba nhánh đặt `trialStartedAt` theo ngày đó (`${joinedAt}T00:00:00.000Z`) thay vì thời điểm hiện tại. Không có `joinedAt` thì giữ nguyên `new Date().toISOString()`.

`joinedAt` và `trialStartedAt` là dữ liệu nghiệp vụ; thời điểm mutation/audit
vẫn là thời gian thực `now`. Vì vậy không được dùng ngày lịch sử để backdate
`admittedAt`, `statusChangedAt`, `createdAt`, `updatedAt`, hoặc đối số `now`
của `upsertSystemEnrollment`. Nếu lớp không phân giải được term thì server bỏ
qua `joinedAt` theo quy tắc §5, không ghi enrollment/course join và giữ
`trialStartedAt = now`.

## 6. Vì sao phải ghi `courseJoins`

Điểm danh không đọc `student_course_enrollments`. `server/api/read/handlers/readers.ts:2364-2371` dựng resolver từ `students.courseJoins` cộng mốc sàn `students.enrollmentDate`.

Hiện `studentCreation.ts` không ghi `courseJoins` và đặt `enrollmentDate = serverTimestamp()`. Nếu chỉ ghi ngày người dùng chọn vào bản ghi enrollment thì mốc sàn hôm nay vẫn khiến mọi buổi trong quá khứ của khóa ra `not_enrolled`, ngày đã chọn không có tác dụng gì.

Ghi `courseJoins` khiến học sinh thuộc khóa từ đúng ngày đó. Các buổi từ ngày đó đến cuối khóa hiện ra dưới dạng chưa điểm danh để bổ sung, và tính vào mẫu số chuyên cần.

`enrollmentDate` giữ nguyên `serverTimestamp()`, không sửa. `createEligibilityResolver` (`shared/studentSessionEligibility.ts:71-77`) ưu tiên entry `courseJoins` khớp `(classId, termStart)` và bỏ qua mốc sàn khi entry tồn tại, nên không cần đụng tới một trường đang chi phối nhiều báo cáo khác.

## 7. Guard phía client

Hook dùng chung `src/lib/classes/useClosedCourseJoin.tsx`:

```ts
const { guard, modal } = useClosedCourseJoin();
// guard(classData: Class, onProceed: (joinedAt?: string) => void | Promise<void>)
```

Luồng:

- Lớp chưa đóng: gọi thẳng `onProceed()`, không hiện modal.
- Lớp đã đóng: mở modal, hiển thị tên lớp, ngày kết thúc khóa và lý do đóng (quá hạn ngày hay đã duyệt kết khóa), kèm hai lựa chọn.
  - **Khóa hiện tại**: hiện `ApiDateTextInput` bắt buộc, giới hạn `[termStart, termEnd]`, ghi rõ phạm vi cho phép ngay dưới ô nhập. Nút xác nhận disabled tới khi ngày hợp lệ. Xác nhận gọi `onProceed(joinedAt)`.
  - **Khóa sau**: thay phần thân bằng thông báo hướng dẫn reset course cho lớp rồi tạo lại học sinh. Chỉ có nút Đóng, không gọi `onProceed`, không ghi dữ liệu.

Với term mở (`termEnd: null`), khóa chỉ có thể đóng vì đã duyệt kết khóa chứ không thể quá hạn ngày. Modal dùng câu chữ riêng cho trường hợp này: không nêu ngày kết thúc ở phụ đề, và ô nhập ngày chỉ ghi giới hạn dưới (`Chọn ngày từ {termStart} trở đi`) thay vì một khoảng có đầu cuối.

`modal` là `ReactNode` để màn hình gọi tự render. Component modal tách riêng ở `src/components/classes/ClosedCourseJoinModal.tsx`, dùng `ModalPortal` và `useBodyScrollLock` theo đúng khuôn các modal hiện có.

Kiểu `Class` (`src/types/class.ts:25`) nhận thêm `courseClosingApproved?: boolean` khớp với trường mới của `projectedClassDoc`.

Ba màn hình gắn guard vào ngay trước lời gọi API:

- `src/pages/common/components/students/StudentActionModals.tsx` — tạo và sửa học sinh (`handleSubmit`)
- `src/pages/common/components/students/StudentTransferModal.tsx` — chuyển lớp
- `src/pages/office/Admissions.tsx` — tạo học thử

`TrialReviewPanel` không gắn guard, theo §5.1.

Ở màn hình sửa học sinh, guard chỉ chạy khi request thực sự gán lớp. Server chỉ dùng `joinedAt` khi `classId` đổi (`update.ts:83`), nên hỏi lúc chỉ sửa tên hay số điện thoại là phiền vô ích:

```ts
const isAssigningClass = !editingStudent || editingStudent.classId !== selectedClass.id;
```

Chỉ `isAssigningClass` mới đi qua guard; còn lại submit thẳng.

Chuỗi hiển thị thêm vào `src/lib/i18n/locales/vi/components.ts` và `src/lib/i18n/locales/en/components.ts`.

## 8. Kiểm thử

**Domain** — `shared/classJoinWindow.test.ts`:

- Quá `endDate` ra `isClosed` với lý do `term_ended`.
- `courseClosing.approval.status === 'approved'` mà còn trong hạn ngày ra `isClosed` với lý do `closing_completed`.
- Cờ dẫn xuất `courseClosingApproved: true` (dạng payload client nhận) cũng ra `isClosed`.
- Khóa đang chạy ra `isClosed: false`.
- Lớp có `terms[]` chọn đúng term chứa `today` trước khi fallback.
- Lớp legacy thiếu ngày trả `null`.
- `isJoinedAtInWindow` chặn ngày trước `termStart` và sau `termEnd`, chấp nhận đúng hai biên.
- `resolveTermJoinedAt` nâng ngày vào sớm lên `termStart`, hạ ngày vào muộn xuống `termEnd`, giữ nguyên ngày trong khóa và ngày của term mở (`termEnd: null`).

**Projection** — `projectedClassDoc` trả `courseClosingApproved: true` khi `approval.status === 'approved'`, và bỏ trường này khi `approval.status === 'invalidated'` hoặc khi lớp không có `courseClosing`.

**Server** — mỗi endpoint trong số 4, và với create-trial là cả ba nhánh:

- `joinedAt` hợp lệ ghi đúng cả bản ghi enrollment lẫn `courseJoins`.
- `joinedAt` ngoài phạm vi trả 400 và không ghi gì.
- Thiếu `joinedAt` vẫn clamp về `termEnd` (test hiện có trong `studentCreation.atomic.test.ts` phải tiếp tục xanh).
- create-trial với `joinedAt` tường minh đặt `trialStartedAt` theo ngày đó.
- `promotePendingToTrial` ghi ra enrollment, việc mà nhánh này trước đây không làm.

**Chuyển lớp, biên `endedAt`** — `upsertSystemEnrollment` đóng các enrollment đang mở khác bằng `endedAt: input.joinedAt` (`courseEnrollmentRepository.ts:216`), trong khi `assertValidStudentCourseEnrollment` bắt `endedAt >= joinedAt`. Học sinh đang mở một enrollment bắt đầu **sau** ngày vừa chọn sẽ làm giao dịch ném `endedAt cannot precede joinedAt`. Đóng enrollment cũ tại `max(open.joinedAt, input.joinedAt)`: khóa cũ kết thúc khi khóa mới bắt đầu, còn nếu ngày vào khóa mới sớm hơn cả ngày vào khóa cũ thì khóa cũ dài đúng không ngày. Cần một test riêng cho tình huống này.

**Client**:

- Lớp chưa đóng: submit đi thẳng, không render modal.
- Lớp đã đóng: modal hiện hai lựa chọn kèm đúng lý do.
- Chọn khóa hiện tại, nhập ngày ngoài phạm vi: nút xác nhận disabled.
- Chọn khóa hiện tại, ngày hợp lệ: API nhận đúng `joinedAt`.
- Chọn khóa sau: không có lời gọi API nào.
- Sửa học sinh mà không đổi lớp: submit đi thẳng dù lớp đã đóng.

## 9. Nằm ngoài phạm vi

- Không đổi cách `reset course` hoạt động, không tự động reset thay người dùng.
- Không sửa `enrollmentDate`.
- Không đụng import Excel, script backfill và đường nhập roster của reset-course; các luồng này tiếp tục dùng clamp.
- Không thêm lựa chọn nào khác vào modal ngoài hai lựa chọn đã chốt.
