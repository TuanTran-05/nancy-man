# Thiết kế: Hợp nhất cơ chế tạo công nợ khóa học

## Bối cảnh

Công nợ khóa học nằm ở collection `course_fee_ledgers`. Kế toán tạo chúng bằng nút "Tạo công nợ"
trong trang Tài chính. Hiện có **bốn điểm vào** cho cùng một thao tác:

| Vị trí | Nhãn | Tham số |
| --- | --- | --- |
| `StudentFinanceWorkspace.tsx:345` | select "Tạo học phí theo lớp…" | một `classId` |
| `StudentFinanceWorkspace.tsx:365` | nút "Tạo học phí toàn bộ" | không |
| `LedgersTab.tsx:76` | nút "Tạo công nợ cho lớp này" | `classFilter` |
| `LedgersTab.tsx:91` | nút "Tạo công nợ tất cả lớp" | không |

`LedgersTab` chỉ hiển thị khi `VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE=false`; mặc định cờ này bật
(`accountingStudentWorkspaceMode.ts:7`) nên giao diện đang chạy thật là `StudentFinanceWorkspace`.

Cả bốn điểm vào gọi cùng một hàm `handleGenerateLedgers` (`Finance.tsx:697`) và cuối cùng cùng một
endpoint `POST /api/v1/classes/generate-ledgers`. Biến thể "theo lớp" chỉ thu hẹp phạm vi chứ không
đổi hành vi. Vì thao tác đã idempotent, chạy toàn trung tâm cho kết quả giống hệt chạy từng lớp.

## Vấn đề

### V1 — Khóa chống trùng chứa `termEnd`, một trường có thể thay đổi

Đường tạo theo lớp (`classHelpers.ts:594-602`) coi một công nợ là "đã tồn tại" khi khớp **cả**
`termStart` lẫn `termEnd`. Nhưng `extendActiveClassesForSystemHolidaysDetailed`
(`classHelpers.ts:194-228`) ghi đè `class.endDate` mỗi khi thêm ngày nghỉ lễ rơi vào ngày học.

Sau một lần gia hạn, công nợ đã tạo mang `termEnd` cũ, không còn khớp, và lần bấm nút kế tiếp tạo
**công nợ thứ hai cho cùng một khóa** dưới doc id khác. Học sinh bị tính nợ hai lần.

Hệ quả kéo theo ở tầng đọc: `buildAccountingStudentSummary` ghép ledger vào enrollment theo
`classId|termStart` (`studentFinanceProjection.ts:42`) bằng `Map.set`, nên bản ghi sau **đè** bản ghi
trước. Tiền đã thu trên bản ghi bị đè biến mất khỏi `totalPaid` của workspace trong khi vẫn hiện ở
tab công nợ legacy và báo cáo quỹ.

### V2 — Ba nơi ghi công nợ dùng ba luật định danh khác nhau

| Nơi ghi | Cách kiểm tra tồn tại | Nguồn `termStart`/`termEnd` |
| --- | --- | --- |
| `classHelpers.ts:604` (theo lớp) | query theo `classId`, so khớp `termStart` **và** `termEnd` | `class.startDate` / `class.endDate` |
| `classHelpers.ts:539` (theo enrollment) | query `studentId` + `classId` + `termStart` | `enrollment.termStart` / `enrollment.termEnd` |
| `transfer.ts:223` (chuyển lớp) | **chỉ `.get()` theo doc id 4 phần** | term giải từ class |

`transfer.ts:29` còn định nghĩa lại `buildCourseLedgerId` thay vì import. Cả ba đường đều sinh nợ
trùng khi `endDate` bị đẩy. Sửa riêng cái nút mà bỏ `transfer.ts` sẽ để lại một đường sinh trùng
đang mở.

### V3 — Rebuild summary chạy cho cả học sinh không bị ảnh hưởng

`affectedStudentIds` gom **toàn bộ** học sinh của lớp, kể cả người bị bỏ qua vì đã có công nợ
(`classHelpers.ts:605` — `add` được gọi trước mọi lệnh `continue`).

`refreshAccountingStudentSummariesAfterCommit` rồi rebuild **tuần tự từng học sinh**
(`accountingStudentSummaryService.ts:115`), mỗi lần đọc student + enrollments + ledgers. Bấm nút lần
thứ hai tạo 0 công nợ nhưng vẫn rebuild toàn bộ học sinh trong trung tâm. Đây là nguyên nhân chính
khiến thao tác chậm và có nguy cơ chạm giới hạn 300s của Vercel Function.

Đường theo enrollment mắc cùng lỗi ở quy mô nhỏ hơn: `classHelpers.ts:544` gọi `affectedStudentIds.add`
ngay trong nhánh `ledger_exists`, tức là học sinh đã có công nợ vẫn bị rebuild. Dòng đó phải bỏ.

### V4 — Nguồn học sinh là `students.classId`, không phải enrollment

Đường theo lớp lấy học sinh bằng `students where classId == X` (`classHelpers.ts:590`), trong khi
cả workspace lẫn projection đều coi `student_course_enrollments` là nguồn chuẩn. Hai hệ quả:

- 59 mã học sinh tồn tại hai bản ghi trong `students` sau nghiệp vụ promotion; cả hai đều khớp query
  và đều được tạo công nợ.
- Học sinh có enrollment mở nhưng `students.classId` đã lệch thì bị tính vào sai lớp.

### V5 — Không có gì để xem trước

Thao tác ảnh hưởng toàn trung tâm nhưng chỉ hỏi một dialog một dòng, và kết quả trả về chỉ là mấy
con số đếm. Kế toán không biết trước sẽ tạo cho ai, bao nhiêu tiền, lớp nào bị bỏ và vì sao.

### V6 — Chuỗi xác nhận nói sai

`generateConfirmAll` ghi "Tạo/**cộng dồn** công nợ cho TẤT CẢ lớp?" (`vi/pages.ts:1868`). Code không
cộng dồn: công nợ đã tồn tại được giữ nguyên tuyệt đối, `paidTotal` không bị đụng tới.

## Quyết định

### Q1 — Một nút duy nhất, có bước xem trước

Xóa cả bốn điểm vào, thay bằng **một nút "Tạo công nợ"** trong `StudentFinanceWorkspace`.
`LedgersTab` trở thành chỉ-đọc.

Luồng: bấm → server chạy dry-run toàn trung tâm → modal kết quả → "Xác nhận tạo" hoặc đóng.

Modal hiển thị:

- **Tổng**: sẽ tạo N công nợ · tổng tiền X đ · M học sinh · K lớp.
- **Bảng theo lớp**: tên lớp · học phí · sẽ tạo · đã có · bỏ qua kèm lý do.
- **Danh sách công nợ trùng** có sẵn: lớp, học sinh, `termStart`, các doc id — **liệt kê từng dòng**,
  không chỉ đếm. Một con số tổng không đủ để kế toán đi tra.
- **Danh sách lỗi**: `classId` kèm thông điệp, cũng liệt kê từng dòng.

Không hiển thị tên từng học sinh sẽ được tạo công nợ: payload chỉ mang `studentId`, tra tên đòi hỏi
nối thêm danh bạ học sinh. Mức chi tiết dừng ở từng lớp.

Thanh tiến độ hiện ở **cả** giai đoạn xem trước lẫn giai đoạn ghi — cả hai đều phân trang qua toàn bộ
collection `classes` nên đều có thể kéo dài.

Ghi xong, modal chuyển sang trạng thái kết quả và **không tự đóng khi `errors[]` khác rỗng**. Tự đóng
lúc còn lỗi sẽ giấu mất phần việc chưa hoàn thành. Nút Đóng cũng **bị vô hiệu trong lúc đang ghi** —
đóng giữa chừng cũng là một cách giấu tiến trình.

Toast sau khi ghi phải phân biệt: `errors[]` rỗng → thông báo thành công; còn lỗi → thông báo cảnh
báo nêu rõ đã tạo được bao nhiêu và còn bao nhiêu lớp lỗi. Báo "thành công" trong khi có lớp chưa
chạy được là báo sai.

Mọi chuỗi hiển thị lấy từ `useLanguage`, không viết thẳng vào component.

Dry-run không ghi gì và không rebuild summary nào.

### Q2 — Enrollment là nguồn học sinh, class là trục phân trang

Đối tượng được tạo công nợ: mọi `student_course_enrollments` có `status ∈ {trial, active, on_leave}`
(bộ ba trạng thái mở theo `isOpenStudentCourseEnrollmentStatus`). Không đọc `students.classId` nữa.

Nhưng **duyệt theo lớp**, không phân trang thẳng collection enrollment.
`makeStudentCourseEnrollmentId` là base64 của `[studentId, classId, termStart]`
(`shared/studentCourseEnrollment.ts:133`), nên doc id không mang thứ tự nghiệp vụ; phân trang theo id
sẽ rải enrollment của cùng một lớp khắp các trang và buộc phải truy vấn lại bảng ledger cho từng
enrollment. Duyệt theo lớp giữ chi phí ở **2 truy vấn mỗi lớp**, đúng bằng chi phí hiện tại.

Vì server phân trang toàn bộ collection `classes`, không lớp nào bị bỏ sót. Giao diện mới không gửi
`classIds` nữa — trước đây client tự lọc `status !== 'archived' && tuitionFee` rồi mới gửi
(`Finance.tsx:715`), khiến lý do bỏ qua bị giấu khỏi báo cáo. Server vẫn **nhận** `classIds` để không
phá các script hiện có.

Nút "Tạo học phí" theo từng enrollment trong bảng chi tiết học sinh
(`StudentFinanceWorkspace.tsx:570`) **được giữ lại**. Nó không phải một trong bốn điểm vào hàng loạt;
nó là hành động sửa lẻ cho một khóa cụ thể. Đường `enrollmentIds` phía server vẫn tồn tại, nhưng
chuyển sang dùng chung module định danh và hàm lập kế hoạch ở dưới.

**Giới hạn đã biết:** enrollment mở trỏ tới một class đã bị xóa sẽ không được duyệt tới. Đây là dữ
liệu không nhất quán cần script audit riêng, không thuộc phạm vi thiết kế này.

### Q3 — Khóa nghiệp vụ là bộ ba, doc id giữ nguyên

Khóa định danh một khoản công nợ là **(`studentId`, `classId`, `termStart`)** — đúng bộ ba mà
`makeStudentCourseEnrollmentId` dùng cho enrollment. `termEnd` là metadata có thể thay đổi và không
được nằm trong khóa.

`buildCourseLedgerId` **giữ nguyên dạng 4 phần**. Không đổi doc id, không migrate dữ liệu. Thay vào
đó doc id thôi đảm nhiệm việc chống trùng; việc đó chuyển hẳn sang truy vấn theo bộ ba.

Lý do không đổi id sang 3 phần: các doc cũ vẫn mang id 4 phần nên vẫn phải truy vấn để nhận diện
chúng — id mới không mua được gì, mà lại thêm rủi ro cho `merge-duplicate-student-records.ts:230` và
`transfer.ts:109`.

### Q4 — Công nợ trùng có sẵn: phát hiện và báo cáo, không tự sửa

Cơ chế mới không tạo thêm bản trùng. Với các cặp trùng đã tồn tại, hệ thống liệt kê ra trong modal
để kế toán tự quyết. Không tự động gộp: tiền đã thu nằm trên bản ghi nào là quyết định nghiệp vụ,
không phải quyết định của code.

## Kiến trúc

### Module dùng chung mới

`server/api/lib/accounting/courseLedgerIdentity.ts`:

- `courseLedgerTupleKey(studentId, classId, termStart): string`
- `buildCourseLedgerId(studentId, classId, termStart, termEnd): string` — dời từ `classHelpers.ts:719`,
  hành vi không đổi
- `indexLedgersByTuple(docs): Map<string, LedgerDoc[]>` — key có nhiều hơn một phần tử nghĩa là trùng

Ba nơi ghi cùng import module này. Bản copy trong `transfer.ts:29` bị xóa.

### Hàm lập kế hoạch thuần

`server/api/lib/accounting/courseLedgerPlanner.ts`:

```
planClassLedgers(input: {
  classId, classData, enrollments, ledgers
}): ClassLedgerPlan
```

Không chạm Firestore, nhận dữ liệu đã đọc sẵn và trả về quyết định. Đây là nơi đặt toàn bộ test.

```
type ClassLedgerPlan = {
  classId: string;
  className: string;
  tuitionFee: number;
  skipReason: 'class_not_found' | 'class_archived' | 'tuition_not_configured' | null;
  creates: Array<{
    ledgerId: string;
    studentId: string;
    enrollmentId: string;
    termStart: string;
    termEnd: string | null;
    amount: number;
  }>;
  alreadyExists: number;
  duplicates: Array<{ studentId: string; termStart: string; ledgerIds: string[] }>;
};
```

### Thuật toán mỗi lớp

1. `course_fee_ledgers where classId == X` → `indexLedgersByTuple` → `Map<"studentId|classId|termStart", …>`.
   Key nào có ≥ 2 phần tử ghi vào `duplicates`.

   Bước này chạy **trước** mọi cổng chặn theo lớp. Lớp đã lưu trữ hoặc chưa cấu hình học phí vẫn có
   thể mang công nợ trùng sinh ra từ trước; Q4 là báo cáo toàn trung tâm nên không được bỏ sót chúng.
2. Đọc class doc. Doc không tồn tại → `skipReason: 'class_not_found'`. `status === 'archived'` →
   `'class_archived'`. `Number(tuitionFee || 0) <= 0` → `'tuition_not_configured'`. Lớp bị bỏ qua
   không sinh `creates` nào, nhưng `duplicates` từ bước 1 vẫn được giữ và báo cáo.

   Class **chỉ** cung cấp `tuitionFee`, `name` và `status`. `class.startDate`/`class.endDate` không
   còn được dùng để tính term — đó chính là gốc của V1. Term lấy từ enrollment, vốn đã được
   `assertValidStudentCourseEnrollment` bảo đảm là ngày hợp lệ
   (`shared/studentCourseEnrollment.ts:151`).
3. `student_course_enrollments where classId == X` → lọc `isOpenStudentCourseEnrollmentStatus`.
   Dùng truy vấn một trường trên `classId`, không cần index tổ hợp mới.
4. Mỗi enrollment mở: key đã có trong map → `alreadyExists++`; chưa có → thêm vào `creates` với
   `amount = class.tuitionFee`, `termStart`/`termEnd` lấy từ **enrollment**, kèm `enrollmentId`.
   Bộ ba đã được lên kế hoạch trong cùng lượt cũng tính là `alreadyExists`, để hai bản ghi enrollment
   trùng bộ ba không sinh hai công nợ.

Doc công nợ được ghi giữ nguyên shape hiện tại (`amount`, `paidTotal: 0`, `discountTotal: 0`,
`status: 'unpaid'`, `termStart`, `termEnd`, `source: 'course'`, `periodType: 'course'`, `createdAt`),
bổ sung `enrollmentId` — trước đây chỉ đường theo enrollment mới ghi trường này.

### Ghi bằng `create`, không phải `set`

Lệnh ghi dùng `batch.create()` thay cho `batch.set(…, { merge: false })`. Lý do: hai lượt apply chạy
song song cùng lập kế hoạch cho một bộ ba sẽ sinh cùng một doc id; `set` khiến lượt sau **đè** lượt
trước và nếu có phiếu thu vừa được chốt xen giữa thì `paidTotal` bị reset về 0. `create` ném lỗi khi
doc đã tồn tại, đúng điều ta muốn.

Đánh đổi: trong một `WriteBatch`, một `create` thất bại làm hỏng cả lô. Vì vậy lô ghi hạ xuống **100
lệnh** thay vì 450, và lô hỏng được ghi vào `errors[]` rồi đi tiếp thay vì ném ra ngoài. Thao tác vốn
idempotent nên chạy lại là cách khắc phục rẻ và an toàn.

Cả hai đường ghi — toàn trung tâm và theo `enrollmentIds` — dùng chung executor này. Đường theo
enrollment tối đa 100 bản ghi nên vừa khít một lô, và cho nó đi đường riêng sẽ để lại đúng lỗ hổng
`set` mà thiết kế này đang bịt.

**Giới hạn đã chấp nhận:** `create` chỉ khóa được một doc id cụ thể, không phải cả bộ ba. Hai request
chạy song song mà giữa chúng `class.endDate` vừa đổi sẽ sinh hai doc id khác nhau cho cùng bộ ba và
`create` không chặn được. Chỉ mục theo bộ ba lúc đọc đã xử lý mọi trường hợp tuần tự; phần còn lại
đòi hỏi transaction hoặc document khóa riêng, không tương xứng với xác suất xảy ra.

### Đếm sau khi commit

`createdCount` và `affectedStudentIds` **chỉ** tăng sau khi lô chứa chúng commit thành công. Đếm
trước lúc ghi sẽ báo cáo những công nợ chưa hề tồn tại và kích hoạt rebuild summary cho học sinh
không có gì thay đổi.

Kéo theo: giai đoạn ghi tách khỏi giai đoạn lập kế hoạch. Lập kế hoạch cho cả trang trước, rồi mới
thực thi theo lô — không vừa duyệt lớp vừa ghi.

### Hợp đồng API

`POST /api/v1/classes/generate-ledgers` giữ nguyên đường dẫn. Thêm trường body:

```
mode?: 'preview' | 'apply'   // thiếu trường → 'apply'
```

**Thiếu** trường thì mặc định `'apply'`, để không phá các client cũ đang gọi endpoint này. Nhưng có
trường với giá trị **không thuộc** hai giá trị trên thì trả `400`, không im lặng rơi về `'apply'`.
Một lỗi gõ như `"preveiw"` mà bị coi là `'apply'` sẽ biến thao tác xem trước thành thao tác ghi toàn
trung tâm.

`mode: 'preview'` đi kèm `enrollmentIds` cũng trả `400`. Đường theo enrollment ghi ngay và không có
giai đoạn lập kế hoạch riêng; chấp nhận cờ preview ở đó sẽ ghi thật trong khi handler tưởng là xem
trước, nên bỏ qua audit, rebuild summary và realtime event. Xem trước chỉ hỗ trợ cho đường toàn
trung tâm.

Response bổ sung, giữ nguyên các trường đếm hiện có:

```
{
  success: true,
  createdCount, skippedDuplicates, skippedClasses, processedClasses,
  cursor, hasMore, batchSize,
  mode: 'preview' | 'apply',
  totalAmount: number,
  plan: ClassLedgerPlan[],
  duplicateLedgers: Array<{ classId, studentId, termStart, ledgerIds }>,
  errors: Array<{ classId, message }>
}
```

Ở `mode: 'preview'`, `createdCount` là số **sẽ** tạo, không ghi gì, `affectedStudentIds` rỗng.

`createdCount` và `totalAmount` luôn mô tả **cùng một tập**: ở `apply` là tập đã commit thành công,
ở `preview` là tập dự kiến. Nếu một lô ghi hỏng, cả hai cùng giảm — không được để một con số theo kế
hoạch còn con số kia theo thực tế.

Response **không** có `studentCount` hay `classCount`. Hai con số "M học sinh · K lớp" trong modal
được client tự dẫn xuất từ `plan[].creates[].studentId` bằng `Set`, và số lớp là số phần tử `plan` có
`creates.length > 0`. Cộng dồn con số tổng theo từng trang sẽ đếm trùng một học sinh xuất hiện ở hai
trang; dữ liệu chi tiết vốn đã nằm trong `plan` nên không cần thêm trường nào.

Apply **tính lại kế hoạch từ đầu**, không tin `plan` do client gửi lên. Preview chỉ mang tính tư vấn:
dữ liệu có thể thay đổi giữa hai bước, và apply vẫn tự chống trùng nên sai lệch chỉ dẫn tới số thực
tế khác số xem trước, không dẫn tới ghi sai.

Một lớp lỗi được ghi vào `errors[]` và vòng lặp đi tiếp; không làm hỏng cả lô.

### Giới hạn tần suất

`api/classes/[action].ts:85` đang giới hạn `generate-ledgers` 10 lượt/phút **chung một biểu thức** với
`reset-course`, `import-students` và `rebuild-student-counts`. Một lần bấm nút giờ tốn preview + apply,
mỗi bước nhiều trang, nên 10 là quá chặt.

Nới **chỉ** cho `generate-ledgers`: `preview` 120 lượt ở scope riêng `classes_ledger_preview`, `apply`
60 lượt ở `classes_mutation`. Ba action nặng còn lại **giữ nguyên 10** — chúng không phân trang và
nới hạn mức cho chúng là tác dụng phụ ngoài ý muốn. Test phải khẳng định trực tiếp trên tham số truyền
vào `enforceRateLimit`, vì hàm này bị mock trong `api/classes/action.test.ts:60` nên mọi sai lệch hạn
mức sẽ lọt qua nếu chỉ kiểm tra status code.

### Sửa `transfer.ts`

`handleTransfer` thay `.get()` theo doc id bằng truy vấn bộ ba. Nó đã đọc sẵn
`where studentId == id and classId == txSourceClassId` cho lớp cũ (`transfer.ts:136`); thêm một truy
vấn tương tự cho lớp đích trong cùng transaction, rồi lọc theo `termStart` trong bộ nhớ. Nếu tìm
thấy công nợ cùng bộ ba, không tạo mới — kể cả khi doc id khác vì `termEnd` đã đổi.

## Thay đổi phía giao diện

### Xóa

- `StudentFinanceWorkspace.tsx:342-375` — cả khối select + nút.
- Props `onGenerateAll`, `onGenerateClass`, `generatingLedgers` bỏ khỏi `StudentFinanceWorkspaceProps`.
- `LedgersTab.tsx:73-99` — cả khối hai nút. Props `handleGenerateLedgers`, `generatingLedgers`,
  `classMap` bỏ theo nếu không còn chỗ dùng.

### Thêm

`src/pages/accounting/components/GenerateLedgersDialog.tsx` — modal xem trước, tự quản lý vòng lặp
phân trang cho cả preview lẫn apply, hiển thị tiến độ theo số lớp đã xử lý.

Nút "Tạo công nợ" đặt ở thanh hành động của workspace, cạnh "Lịch sử thu".

`src/lib/api/classAdminApi.ts` — thêm hàm chạy theo `cursor` của server cho cả hai chế độ, thay vì tự
chia lô `classIds` ở client.

Vòng lặp phân trang phải **phát hiện cursor không tiến**. `loadClassPage` khi nhận `classIds` tính
`indexOf(cursor) + 1` (`classHelpers.ts:484`); cursor không nằm trong danh sách cho `indexOf === -1`
→ `startIndex = 0` → trả lại đúng trang đầu kèm đúng cursor cũ, tức lặp vô hạn. Client giữ tập cursor
đã thấy và **ném lỗi** khi gặp lại, thay vì chạy hết bộ đếm bảo vệ rồi trả về như thể thành công một
phần. Cũng ném lỗi khi hết bộ đếm mà `hasMore` vẫn `true`, và khi `page.mode` khác chế độ đã yêu cầu.

### Chuỗi ngôn ngữ

Sửa `generateConfirmAll` và `generateConfirmClass` (`vi/pages.ts:1867-1868`) — bỏ chữ "cộng dồn".
Thêm chuỗi cho modal xem trước ở cả `vi` và `en`.

## Xử lý lỗi

| Tình huống | Hành vi |
| --- | --- |
| Một lớp ném lỗi khi đọc | Ghi `errors[]`, xử lý tiếp lớp sau |
| Một lô ghi thất bại | Ghi `errors[]`, đi tiếp lô sau. Các lô đã commit trong cùng trang **vẫn giữ** — một trang có thể ghi một phần. Không có gì để rollback vì thao tác idempotent: chạy lại sẽ bù đúng phần thiếu |
| Rebuild summary thất bại | Đã có sẵn: đẩy vào `outbox_jobs` để retry (`accountingStudentSummaryService.ts:131`) |
| Preview thất bại giữa chừng | Modal báo lỗi, không cho bấm xác nhận |
| Enrollment không đọc được | Bỏ qua, ghi `errors[]` kèm `enrollmentId` |

## Kiểm thử

### `courseLedgerPlanner.test.ts` (thuần, không mock Firestore)

- lớp `archived` → `skipReason`, `creates` rỗng
- `tuitionFee = 0` và `tuitionFee` thiếu → `'tuition_not_configured'`
- class doc không tồn tại → `'class_not_found'`
- enrollment `completed` / `transferred` / `dropped` → không tạo
- enrollment `trial` / `on_leave` → **có** tạo
- **công nợ cũ có `termEnd` khác** → nhận là đã tồn tại, không tạo trùng *(hồi quy chính cho V1)*
- hai công nợ cùng bộ ba → vào `duplicates`, không tạo thêm
- hai bản ghi `students` trùng nhưng một enrollment → đúng một công nợ *(V4)*
- `termStart`/`termEnd` lấy từ enrollment chứ không từ class khi hai bên lệch nhau

### `classOperationsHandlers` / handler tests

- `mode: 'preview'` không gọi `batch.commit` và không gọi `refreshAccountingStudentSummaries…`
- `mode: 'apply'` truyền vào `refreshAccountingStudentSummaries…` **chỉ** các `studentId` có ledger
  mới ghi *(V3)*
- không tạo gì → `affectedStudentIds` rỗng → không rebuild
- lỗi ở một lớp không chặn các lớp còn lại
- `errors[]` được trả về đúng

### `transfer` tests

- công nợ lớp đích tồn tại dưới doc id có `termEnd` cũ → không tạo bản thứ hai *(V2)*

### Frontend

- `StudentFinanceWorkspace` không còn render select/nút cũ
- `LedgersTab` không còn render nút nào
- `GenerateLedgersDialog`: preview → hiện tổng và bảng theo lớp; xác nhận → gọi apply; đóng → không gọi apply
- preview trả `createdCount: 0` → nút xác nhận bị vô hiệu

## Ngoài phạm vi

- Gộp các công nợ trùng đã tồn tại trong production. Chỉ báo cáo (Q4).
- Enrollment mở trỏ tới class đã xóa. Cần script audit riêng (Q2).
- Bỏ hẳn `LedgersTab` và cờ `VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE`. Tab vẫn còn, chỉ mất nút.
- Đổi shape doc id của `course_fee_ledgers` (Q3).
