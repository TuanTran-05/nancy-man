# Thiết kế đối soát học phí theo lớp cho báo cáo tài chính admin

Ngày: 2026-08-14

Trạng thái: Đã được người dùng duyệt ngày 2026-08-14; sẵn sàng lập kế hoạch và triển khai.

## 1. Bối cảnh

Trang `/admin/finance-report` hiện có:

- KPI tài chính trung tâm;
- đối soát học phí theo học sinh;
- biểu đồ cấu trúc doanh thu, xu hướng thu chi, thu theo cấp, chi theo hạng mục và công nợ theo trạng thái.

`StudentPaymentSection` hiện gom các ledger theo học sinh. Mỗi học sinh có thể mở chi tiết các khóa, nhưng admin phải duyệt một danh sách học sinh toàn trung tâm nên khó đối chiếu một lớp hoặc một khóa cụ thể.

Luồng đọc hiện tại có các đặc điểm ảnh hưởng trực tiếp tới thiết kế mới:

- `buildCenterFinanceReport` lấy ledger giao với tháng đã chọn rồi `aggregateStudentPayments` gom theo học sinh.
- Số tiền trên ledger là dữ liệu lũy kế hiện tại: `amount`, `discountTotal`, `paidTotal`.
- `calculateLedgerBalance` tính:
  - học phí gốc = `amount`;
  - giảm trừ = `discountTotal`;
  - phải thu = `max(amount - discountTotal, 0)`;
  - còn nợ = `max(phải thu - paidTotal, 0)`.
- `Class` có `tuitionFee` hiện tại và `terms` lịch sử, nhưng `ClassTerm` chưa lưu snapshot học phí.
- Khóa định danh ledger đã được chuẩn hóa theo bộ ba `studentId + classId + termStart`; `termEnd` chỉ là metadata có thể thay đổi.
- Enrollment là nguồn chuẩn của thành viên khóa; `students.classId` không đủ tin cậy sau chuyển lớp hoặc promotion.

## 2. Mục tiêu

Thêm khối **Đối soát học phí lớp** ngay phía trên **Đối soát học phí học sinh**, giữ nguyên toàn bộ chức năng hiện có.

Khối mới phải cho admin:

1. Chọn một lớp và khóa hiện tại hoặc khóa cũ.
2. Xem tổng học phí dự kiến, đã ghi sổ, học bổng/giảm trừ, phải thu, đã thu lũy kế và còn nợ của khóa.
3. Đối chiếu các tổng đó xuống từng học sinh.
4. Phát hiện học sinh thiếu ledger, ledger/enrollment trùng, số tiền không hợp lệ, thu vượt hoặc dữ liệu khóa không đủ tin cậy.
5. Mở chi tiết ledger và các phiếu thu đã cấn của đúng học sinh trong đúng khóa.
6. Giữ báo cáo ở chế độ chỉ đọc và chuyển sang workspace tài chính hiện có khi cần xử lý.

## 3. Quyết định đã duyệt

### 3.1 Phạm vi thời gian

- “Đã thu” là **đã thu lũy kế đến hiện tại** của ledger khóa.
- Khoản thu sau khi khóa kết thúc vẫn được tính nếu đã được cấn vào ledger của khóa.
- Không xây dựng ảnh chụp “đã thu tại ngày kết thúc khóa” trong phiên bản này.
- Bộ lọc Lớp/Khóa độc lập với bộ lọc Tháng của báo cáo hiện tại vì một khóa có thể kéo dài nhiều tháng.

### 3.2 Phạm vi học sinh

- Hiển thị mọi học sinh từng thuộc khóa, kể cả `completed`, `transferred` và `dropped`.
- Enrollment được nhóm theo `studentId + classId + termStart` để một enrollment trùng không sinh hai hàng học sinh.
- Nếu cùng bộ ba có nhiều enrollment, hàng vẫn xuất hiện một lần và mang cảnh báo `duplicate_enrollment`.

### 3.3 Học bổng và giảm trừ

- Nhãn chính là **Học bổng / giảm trừ**.
- Giá trị đối soát lấy toàn bộ `discountTotal`, gồm học bổng, giảm giá, miễn giảm, hoàn cảnh khó khăn và ưu đãi anh chị em.
- Modal chi tiết tách loại khi metadata phiếu thu đủ rõ; phần không phân loại được ghi là “Chưa phân loại”.

### 3.4 Ranh giới thao tác

- Báo cáo chỉ đọc.
- Không tạo, sửa, hủy ledger hoặc phiếu thu từ trang admin.
- Chi tiết học sinh có liên kết sang workspace tài chính để xử lý.

## 4. Thiết kế trải nghiệm

### 4.1 Vị trí

Thứ tự nội dung trong `FinanceReport`:

1. KPI trung tâm.
2. **Đối soát học phí lớp** mới.
3. Đối soát học phí học sinh hiện tại.
4. Các biểu đồ hiện tại.
5. Chú thích hiện tại.

Không thay đổi vị trí hoặc hành vi của các phần cũ ngoài việc chèn khối mới.

Khối mới phải là một sibling được mount độc lập với `visibleState` của báo cáo tháng. Khi người dùng đổi month và báo cáo trung tâm tạm chuyển sang loading/error, khối đối soát lớp không được unmount, mất class/course đang chọn hoặc tải lại class options. Khi báo cáo trung tâm thành công, thứ tự DOM vẫn là KPI → đối soát lớp → đối soát học sinh → biểu đồ → chú thích.

### 4.2 Bộ lọc

Khối mới dùng hai bộ lọc phụ thuộc:

1. **Lớp**
   - Ban đầu chưa chọn lớp.
   - Hỗ trợ tìm theo tên lớp.
   - Gồm lớp `active`, `paused` và `archived`.

2. **Khóa**
   - Chỉ bật sau khi đã chọn lớp.
   - Tự chọn khóa hiện tại nếu xác định được.
   - Khóa cũ xếp từ mới đến cũ.
   - Khi đổi lớp, lựa chọn khóa cũ của lớp trước bị xóa và hệ thống chọn lại khóa hiện tại của lớp mới.

Tiêu đề khối ghi rõ đây là dữ liệu **trọn khóa**. Bộ lọc Tháng ở đầu trang tiếp tục điều khiển KPI, biểu đồ và đối soát học sinh cũ.

### 4.3 KPI của khóa

Sau khi chọn lớp/khóa, hiển thị:

- Học phí dự kiến.
- Học phí đã ghi sổ.
- Học bổng / giảm trừ.
- Phải thu sau giảm trừ.
- Đã thu lũy kế.
- Còn nợ.
- Thu vượt, chỉ hiện khi lớn hơn 0.
- Số học sinh thiếu ledger.
- Số trường hợp ledger/enrollment trùng hoặc dữ liệu không hợp lệ.

KPI không đủ dữ liệu hiển thị “Chưa đủ dữ liệu”, không hiển thị `0`.

### 4.4 Bảng học sinh

Cột trên desktop:

1. Học sinh: tên và mã học sinh.
2. Trạng thái enrollment.
3. Học phí gốc.
4. Học bổng / giảm trừ.
5. Phải đóng.
6. Đã đóng lũy kế.
7. Còn nợ.
8. Cảnh báo.
9. Thao tác xem chi tiết.

Ở cột Học phí gốc:

- có ledger: hiển thị tổng `recordedGross`;
- thiếu ledger nhưng thuộc diện phải có học phí và đã resolve được mức khóa: hiển thị `expectedGross` kèm nhãn “Dự kiến”;
- không thuộc diện tự tính hoặc mức khóa chưa xác định: hiển thị “—”.

Bảng có:

- tìm theo tên hoặc mã học sinh;
- bộ lọc Tất cả, Còn nợ, Đã đóng đủ, Thiếu công nợ, Có cảnh báo;
- sắp xếp mặc định: hàng có cảnh báo trước, sau đó nợ giảm dần (giá trị chưa xác định xếp cuối), rồi tên tăng dần.

Trên mobile, mỗi học sinh là một thẻ. KPI dùng lưới hai cột. Không ép bảng desktop thành vùng cuộn ngang khó đọc.

### 4.5 Chi tiết học sinh

Bấm một hàng mở modal chỉ đọc, được scope bằng `classId + termStart + studentId`.

Modal gồm:

- thông tin enrollment và trạng thái;
- tất cả ledger khớp khóa, không tự ẩn ledger trùng;
- học phí gốc, giảm trừ, phải thu, đã thu, còn nợ và thu vượt của từng ledger;
- các allocation từ phiếu thu đã ghi sổ;
- số phiếu thu, ngày thu, phương thức, số tiền cấn, loại giảm trừ và ghi chú khi có;
- cảnh báo dữ liệu;
- liên kết mở workspace tài chính của học sinh.

## 5. Mô hình khóa và mức học phí

### 5.1 Định danh khóa

Khóa nghiệp vụ của một lớp là:

```text
classId + termStart
```

`courseId` được giữ làm metadata khi có. `termEnd` không tham gia định danh vì có thể thay đổi do gia hạn hoặc ngày nghỉ.

### 5.2 Khám phá khóa

Danh sách khóa của một lớp là hợp của:

- khóa hiện tại trên class;
- `ClassTerm[]`;
- các `termStart` khác nhau trong enrollment;
- các `termStart` khác nhau trong ledger.

Nhờ vậy dữ liệu legacy không có term history đầy đủ vẫn có thể được tìm thấy. Mỗi option ghi nguồn và cảnh báo nếu ngày hoặc metadata giữa các nguồn xung đột.

Chỉ `termStart` đúng định dạng `YYYY-MM-DD` mới tạo thành course option có thể chọn. Document có `termStart` thiếu hoặc sai định dạng được đếm trong cảnh báo cấp lớp `course_term_invalid`; API không tạo một scope giả từ dữ liệu ngày không hợp lệ.

### 5.3 Snapshot học phí

Mở rộng `ClassTerm`:

```ts
interface ClassTerm {
  // các trường hiện có
  tuitionFee?: number;
}
```

Khi một khóa hiện tại được đưa vào lịch sử, hệ thống sao chép `class.tuitionFee` vào `term.tuitionFee`. Không backfill tự động các khóa cũ không chắc chắn.

Nguồn mức học phí của một khóa, theo thứ tự ưu tiên:

1. `ClassTerm.tuitionFee` của khóa cũ hoặc `class.tuitionFee` của khóa hiện tại.
2. Với legacy, tập các `ledger.amount` hợp lệ của khóa:
   - đúng một mức dương duy nhất: dùng mức đó, nguồn `inferred_from_ledgers`;
   - không có mức hợp lệ: `unknown`;
   - có nhiều mức: `conflict`.

Không dùng `class.tuitionFee` hiện tại để đoán khóa cũ.

Nếu đã có fee từ class/term nhưng một ledger hợp lệ có `amount` khác fee đó, fee dự kiến vẫn giữ theo snapshot và hàng nhận cảnh báo `ledger_fee_mismatch`. Giá trị ledger khác biệt vẫn được giữ nguyên trong “Đã ghi sổ”.

## 6. Quy tắc enrollment và ledger

### 6.1 Hàng học sinh

Server tạo hợp của student IDs từ enrollment và ledger của khóa. Vì vậy:

- enrollment thiếu ledger vẫn xuất hiện;
- ledger thiếu enrollment vẫn xuất hiện;
- hồ sơ student đã bị xóa vẫn xuất hiện bằng ID có sẵn.

Ledger không có `studentId` không bị bỏ qua. Mỗi ledger đó tạo một hàng dữ liệu mồ côi, định danh bằng ledger ID, mang cảnh báo `ledger_student_missing`, được cộng vào số ghi sổ nhưng không được tính là một học sinh hoặc một suất học phí dự kiến.

### 6.2 Diện phải có học phí

Nếu chưa có ledger:

- `trial`, `active`, `on_leave`, `completed`: `missing_ledger`, được tính là thuộc diện phải có học phí;
- `transferred`, `dropped`: `tuition_review_required`, không tự cộng vào học phí dự kiến.

Nếu đã có ít nhất một ledger, hàng luôn tham gia số liệu ghi sổ bất kể trạng thái enrollment hiện tại.

Khi enrollment trùng có trạng thái khác nhau, hàng được tính là thuộc diện phải có học phí nếu ít nhất một enrollment có trạng thái `trial`, `active`, `on_leave` hoặc `completed`.

### 6.3 Ledger trùng

Một học sinh có từ hai ledger trở lên cùng `studentId + classId + termStart` nhận cảnh báo `duplicate_ledger`.

Không tự chọn ledger “đúng”, không gộp và không xóa:

- hàng học sinh liệt kê từng ledger trong modal;
- số “Đã ghi sổ” phản ánh tổng các document đang tồn tại;
- “Dự kiến” chỉ tính một suất học phí cho học sinh;
- khối KPI ghi rõ tổng ghi sổ có thể bị ảnh hưởng bởi dữ liệu trùng.

Sự chênh lệch giữa Dự kiến và Đã ghi sổ giúp admin phát hiện ledger thiếu hoặc trùng.

## 7. Công thức tài chính

### 7.1 Theo ledger

Với mỗi ledger hợp lệ:

```text
gross       = amount
reduction   = discountTotal
netDue      = max(gross - reduction, 0)
paid        = paidTotal
outstanding = max(netDue - paid, 0)
overpaid    = max(paid - netDue, 0)
```

`paid` không bị cap bằng `netDue`; khoản vượt phải hiện riêng.

### 7.2 Theo lớp/khóa

```text
expectedGross = resolvedCourseFee × chargeableStudentCount
recordedGross = Σ ledger.gross
reductionTotal = Σ ledger.reduction
netDueTotal = Σ ledger.netDue
paidTotal = Σ ledger.paid
outstandingTotal = Σ ledger.outstanding
overpaidTotal = Σ ledger.overpaid
```

`expectedGross` là `null` khi không xác định chắc chắn được mức học phí khóa.

`chargeableStudentCount` đếm một lần mỗi học sinh:

- có trạng thái enrollment thuộc diện phải có học phí; hoặc
- có ledger của khóa.

### 7.3 Giá trị không hợp lệ

Một trường tiền chỉ hợp lệ khi là số hữu hạn và không âm.

- Trường không hợp lệ sinh mã cảnh báo riêng.
- Chỉ số phụ thuộc vào trường không hợp lệ trả `null`, không ép thành `0`.
- KPI bị ảnh hưởng hiển thị “Chưa đủ dữ liệu”.
- Các KPI độc lập, còn đủ dữ liệu vẫn được hiển thị.

Ví dụ: `amount` hỏng nhưng `paidTotal` hợp lệ thì “Đã thu lũy kế” vẫn hiển thị; “Đã ghi sổ”, “Phải thu”, “Còn nợ” và “Thu vượt” của hàng đó là chưa xác định.

### 7.4 Phiếu thu và ví

- `paidTotal` trên ledger là nguồn số lũy kế chính.
- Chi tiết phiếu thu chỉ lấy receipt `posted` và allocation khớp ledger của khóa.
- Receipt `draft` hoặc `void` không được tính.
- Wallet deposit chưa allocation không thuộc doanh thu của khóa.
- Allocation từ ví vào ledger được tính vì nó đã làm tăng `paidTotal` của ledger.

## 8. Kiến trúc

### 8.1 Module thuần

Thêm `shared/classTuitionReconciliation.ts`.

Module:

- không đọc Firestore;
- không phụ thuộc React;
- nhận class/course metadata, enrollment, ledger và student rows đã chuẩn hóa;
- trả course summary, student rows và warning codes;
- là nơi duy nhất định nghĩa công thức và quy tắc nhóm.

Frontend không tính lại số tiền.

### 8.2 Repository và service

Repository bổ sung các phép đọc scope hẹp:

- danh sách lớp tối thiểu cho bộ lọc;
- course sources của một class;
- enrollment theo class, lọc chính xác `termStart`;
- ledger theo class, lọc chính xác `termStart`;
- student docs theo IDs;
- posted receipts của một student khớp tập ledger IDs;
- với orphan ledger không có student, posted receipts theo `classIds array-contains classId`, đọc bằng cursor page rồi mới lọc allocation khớp ledger.

Student document dùng field Firestore `name` và `studentId`; repository map chúng lần lượt thành contract `fullName` và `studentCode`, còn `id` lấy từ document ID. Repository không đọc các field `fullName/studentCode` không tồn tại trên student document.

Service:

- xác thực scope;
- chuẩn hóa document;
- resolve course option và mức học phí;
- gọi module thuần;
- không ghi Firestore.

### 8.3 Client

Thêm API functions và types trong lớp client tài chính hiện có. UI mới nằm trong:

```text
src/pages/admin/components/financeReport/ClassTuitionReconciliationSection.tsx
```

Các phần nhỏ có thể tách thành:

- `ClassCourseFilters`;
- `ClassTuitionKpis`;
- `ClassTuitionStudentTable`;
- `ClassTuitionStudentDetailModal`.

Không đưa công thức nghiệp vụ vào các component.

## 9. Hợp đồng API

Router tài chính hiện có dùng action dạng gạch nối như `center-report`. Tính năng mới dùng đúng ba action:

- `class-reconciliation-options`;
- `class-reconciliation`;
- `class-reconciliation-student`.

### 9.1 Options

`GET /api/finance/class-reconciliation-options`

Không có `classId`: trả danh sách lớp tối thiểu.

`GET /api/finance/class-reconciliation-options?classId=<id>`

Trả danh sách khóa của đúng lớp, được tổng hợp từ class, terms, enrollment và ledger.

Response:

```ts
type ClassReconciliationOptionsResponse =
  | {
      success: true;
      mode: 'classes';
      classes: Array<{
        id: string;
        name: string;
        status: 'active' | 'paused' | 'archived';
      }>;
    }
  | {
      success: true;
      mode: 'courses';
      selectedClass: {
        id: string;
        name: string;
        status: 'active' | 'paused' | 'archived';
      };
      warnings: ClassTuitionWarningCode[];
      courses: Array<{
        key: string;
        courseId: string | null;
        termStart: string;
        termEnd: string | null;
        label: string;
        isCurrent: boolean;
        tuitionFee: number | null;
        tuitionFeeSource:
          | 'class_current'
          | 'term_snapshot'
          | 'inferred_from_ledgers'
          | 'unknown'
          | 'conflict';
        warnings: ClassTuitionWarningCode[];
      }>;
    };
```

### 9.2 Summary và student rows

`GET /api/finance/class-reconciliation?classId=<id>&termStart=YYYY-MM-DD`

```ts
type MoneyMetric = number | null;

type ClassTuitionStudentRow = {
  key: string;
  kind: 'student' | 'orphan_ledger';
  studentId: string | null;
  fullName: string;
  studentCode: string;
  studentRecordFound: boolean;
  enrollmentIds: string[];
  enrollmentStatuses: Array<
    'trial' | 'active' | 'on_leave' | 'completed' | 'transferred' | 'dropped'
  >;
  ledgerIds: string[];
  chargeable: boolean;
  expectedGross: MoneyMetric;
  recordedGross: MoneyMetric;
  reductionTotal: MoneyMetric;
  netDueTotal: MoneyMetric;
  paidTotal: MoneyMetric;
  outstandingTotal: MoneyMetric;
  overpaidTotal: MoneyMetric;
  warnings: ClassTuitionWarningCode[];
};

type ClassTuitionReconciliationResponse = {
  success: true;
  scope: {
    classId: string;
    className: string;
    courseId: string | null;
    termStart: string;
    termEnd: string | null;
    courseLabel: string;
  };
  tuitionFee: {
    amount: number | null;
    source: 'class_current' | 'term_snapshot' | 'inferred_from_ledgers' | 'unknown' | 'conflict';
  };
  summary: {
    expectedGross: MoneyMetric;
    recordedGross: MoneyMetric;
    reductionTotal: MoneyMetric;
    netDueTotal: MoneyMetric;
    paidTotal: MoneyMetric;
    outstandingTotal: MoneyMetric;
    overpaidTotal: MoneyMetric;
    studentCount: number;
    unidentifiedLedgerCount: number;
    missingLedgerCount: number;
    warningRowCount: number;
  };
  rows: ClassTuitionStudentRow[];
  warnings: ClassTuitionWarningCode[];
};
```

Mỗi student row chứa identity, toàn bộ trạng thái enrollment, ledger IDs, các metric tiền nullable và warning codes. Response trả toàn bộ hàng của một lớp/khóa để frontend tìm kiếm, lọc và sắp xếp tại chỗ.

Với `MoneyMetric`, `null` luôn có nghĩa là chỉ số không thể tính đầy đủ; `0` là một tổng hợp lệ bằng không.

### 9.3 Chi tiết học sinh

`GET /api/finance/class-reconciliation-student?classId=<id>&termStart=YYYY-MM-DD&studentId=<id>`

Với hàng `orphan_ledger`, thay `studentId` bằng `ledgerId`. Request phải có đúng một trong hai trường `studentId` hoặc `ledgerId`. Khi nhận `ledgerId`, server đọc ledger rồi kiểm tra lại `classId + termStart`; ID do client gửi không tự tạo quyền truy cập.

Response chứa:

- enrollment rows của đúng bộ ba;
- ledger rows của đúng bộ ba;
- posted receipt allocations khớp ledger IDs;
- tổng tiền và cảnh báo;
- thông tin cần để tạo URL sang workspace tài chính.

Endpoint không trả receipt không liên quan đến khóa.

Response:

```ts
type ClassTuitionStudentDetailResponse = {
  success: true;
  scope: {
    classId: string;
    termStart: string;
    studentId: string | null;
    ledgerId: string | null;
  };
  student: {
    id: string | null;
    fullName: string;
    studentCode: string;
    recordFound: boolean;
  };
  enrollments: Array<{
    id: string;
    status: 'trial' | 'active' | 'on_leave' | 'completed' | 'transferred' | 'dropped';
    joinedAt: string;
    endedAt: string | null;
  }>;
  ledgers: Array<{
    id: string;
    gross: MoneyMetric;
    reduction: MoneyMetric;
    netDue: MoneyMetric;
    paid: MoneyMetric;
    outstanding: MoneyMetric;
    overpaid: MoneyMetric;
  }>;
  allocations: Array<{
    receiptId: string;
    receiptNo: string;
    receivedDate: string;
    paymentMethod: string;
    allocatedAmount: number;
    discountAmount: number;
    discountType: string | null;
    note: string;
  }>;
  warnings: ClassTuitionWarningCode[];
  workspaceUrl: string | null;
};
```

## 10. Luồng dữ liệu frontend

1. Mount trang: tải danh sách lớp tối thiểu.
2. Chọn lớp:
   - xóa course/report/detail cũ;
   - tải course options của lớp;
   - tự chọn khóa hiện tại nếu có.
3. Có lớp và khóa:
   - tạo request key `classId:termStart`;
   - tải report;
   - chỉ commit response nếu request key vẫn là lựa chọn hiện tại.
4. Đổi lớp/khóa:
   - đóng modal chi tiết;
   - hủy request cũ bằng `AbortController`;
   - luôn có request-key guard để chống response đến muộn.
5. Mở học sinh:
   - tải chi tiết đúng scope;
   - mỗi lần mở mới đều tải lại để phản ánh allocation hiện tại;
   - retry chỉ request chi tiết, không tải lại toàn bộ report.

Lỗi của khối mới không thay thế hoặc xóa report trung tâm đang hiển thị.

## 11. Trạng thái và xử lý lỗi

### 11.1 Trạng thái UI

- Chưa chọn lớp.
- Đang tải lớp.
- Lớp không có khóa.
- Đang tải khóa.
- Đang tải report.
- Report rỗng.
- Report thành công có/không có cảnh báo.
- Lỗi tải kèm nút Thử lại.
- Modal đang tải, rỗng, lỗi hoặc thành công.

### 11.2 Warning codes

Tập tối thiểu:

```ts
type ClassTuitionWarningCode =
  | 'missing_ledger'
  | 'duplicate_ledger'
  | 'duplicate_enrollment'
  | 'ledger_without_enrollment'
  | 'tuition_review_required'
  | 'course_fee_unknown'
  | 'course_fee_conflict'
  | 'ledger_fee_mismatch'
  | 'course_term_invalid'
  | 'course_metadata_conflict'
  | 'overpaid'
  | 'student_record_missing'
  | 'ledger_student_missing'
  | 'enrollment_data_invalid'
  | 'ledger_amount_invalid'
  | 'ledger_discount_invalid'
  | 'ledger_paid_invalid';
```

### 11.3 Giới hạn

- Options/report không trả dữ liệu bị cắt cụt.
- Giới hạn tối đa 5.000 enrollment docs và 5.000 ledger docs cho một class/course, đồng nhất với ngưỡng bảo vệ báo cáo tài chính hiện có.
- Nhánh chi tiết theo student giới hạn 500 posted receipt docs trước khi lọc allocation.
- Nhánh chi tiết orphan không dùng hard cap 500 của student: repository đọc `classIds + status`, sort `createdAt DESC`, cursor từng trang 500 đến khi hết; chỉ trả allocation khớp ledger. Tổng scan orphan vẫn có safety cap 5.000 docs và không bao giờ trả riêng một phần trang đã quét.
- Không thu hẹp orphan scan bằng `receivedDate >= termStart`, vì receipt trả trước khóa hoặc allocation từ ví có thể có ngày thu trước `termStart` nhưng vẫn được phân bổ hợp lệ vào ledger.
- Vượt giới hạn trả `class_reconciliation_too_large` với HTTP 413.
- UI hiển thị lỗi rõ ràng, không hiển thị tổng một phần.

### 11.4 Phân quyền

- Tất cả endpoint mới yêu cầu role `admin`.
- Server tự xác định số tiền từ Firestore; không nhận hoặc tin tổng tiền do client gửi.
- Nếu detail nhận `studentId` hoặc `ledgerId`, server luôn xác minh document thực sự thuộc `classId + termStart`.
- Detail endpoint kiểm tra student/ledger thực sự thuộc scope đã yêu cầu trước khi trả receipt allocation.

## 12. Accessibility và đa ngôn ngữ

- Nhãn, trạng thái, cảnh báo và lỗi có khóa tiếng Việt/Anh.
- Select, search, filter chips, table row action và modal dùng được bằng bàn phím.
- Modal trap focus, khóa scroll, đóng bằng Escape và trả focus về hàng đã mở.
- Cảnh báo không chỉ dùng màu; luôn có icon và nội dung chữ.
- Số tiền dùng formatter hiện có và không render `NaN`.
- Ngày dùng formatter API date hiện có.

## 13. Kiểm thử

### 13.1 Module thuần

- Công thức gross/reduction/net/paid/outstanding/overpaid.
- Paid lớn hơn net không bị cap.
- Wallet/receipt metadata không làm thay đổi ledger math.
- Nhóm một hàng cho enrollment trùng.
- Ledger trùng được cộng đúng dữ liệu ghi sổ và cảnh báo.
- Enrollment thiếu ledger theo từng status.
- Ledger thiếu enrollment.
- Hồ sơ student thiếu.
- Snapshot fee, fee suy ra, fee unknown và fee conflict.
- Ledger amount khác fee snapshot giữ nguyên số ghi sổ và sinh `ledger_fee_mismatch`.
- Giá trị âm, `NaN`, chuỗi và trường thiếu trả metric nullable đúng phạm vi ảnh hưởng.
- Sắp xếp cảnh báo, nợ và tên.

### 13.2 Repository/service

- Chỉ lấy enrollment/ledger khớp `classId + termStart`.
- Khóa cũ được tìm từ term, enrollment hoặc ledger legacy.
- Không dùng tuition hiện tại cho khóa cũ.
- Detail chỉ trả posted allocations của ledger thuộc scope.
- Draft/void và receipt khác khóa bị loại.
- Giới hạn document trả 413, không trả partial response.

### 13.3 Handler

- Admin được phép.
- Accounting, office, teacher, student và request không xác thực bị từ chối.
- Thiếu/sai `classId`, `studentId`, `termStart` trả 400.
- Class không tồn tại hoặc `termStart` không thuộc bất kỳ course source hợp lệ nào của class trả 404.
- Khóa hợp lệ nhưng chưa có enrollment/ledger trả 200 với danh sách rỗng và các tổng hợp lệ bằng 0 nếu mức học phí đã xác định.
- Student document không tồn tại nhưng scope vẫn có enrollment/ledger trả 200 kèm `student_record_missing`.
- Service exception được chuẩn hóa.

### 13.4 Frontend

- Khối mới nằm trước `StudentPaymentSection`.
- Ban đầu chưa chọn lớp.
- Chọn lớp tự chọn khóa hiện tại.
- Đổi lớp xóa khóa và dữ liệu cũ.
- Khóa cũ hiển thị và tải độc lập với month.
- Response đến muộn không ghi đè lựa chọn mới.
- KPI và hàng khớp fixture.
- Search và 5 bộ lọc nhanh hoạt động.
- Modal detail lazy-load, retry và đóng đúng.
- Deep-link workspace tự tải detail; nếu target hợp lệ nằm ngoài 50 rows đầu sau khi filter class/lifecycle, target được pin vào tập rows đang render trong thời gian expanded.
- Mobile cards và desktop table đều render đủ dữ liệu.
- Cảnh báo có text/ARIA label.

### 13.5 Hồi quy

- Test hiện có của `FinanceReport`, `StudentPaymentSection`, `centerFinanceReport` và finance API tiếp tục đạt.
- Typecheck đạt.
- Production build đạt.
- Các Firestore index tests đạt; nếu query mới cần index, index được khai báo và kiểm thử.

## 14. Tiêu chí chấp nhận

1. Admin xem được khóa hiện tại và khóa cũ của lớp active, paused hoặc archived.
2. Tổng lớp đối chiếu được xuống từng học sinh.
3. Tổng hàng khớp KPI theo công thức trong tài liệu.
4. Học sinh thiếu ledger không biến mất.
5. Học sinh chuyển/nghỉ/hoàn thành vẫn có mặt trong lịch sử khóa.
6. Mọi dữ liệu thiếu, trùng, xung đột, không hợp lệ hoặc thu vượt có cảnh báo.
7. “Đã thu” là số lũy kế hiện tại đã cấn đúng ledger của khóa.
8. Tiền ví chưa cấn và receipt draft/void không được tính.
9. Khối mới chỉ đọc và không thay đổi dữ liệu kế toán.
10. Bộ lọc lớp/khóa độc lập với bộ lọc tháng, có nhãn phạm vi rõ.
11. Response cũ không lóe lên dưới scope mới khi đổi bộ lọc.
12. Toàn bộ phần hiện có của trang tiếp tục hoạt động như trước.

## 15. Ngoài phạm vi

- Xuất Excel/PDF.
- Thu tiền, sửa hoặc hủy ledger/receipt trong báo cáo.
- Tự gộp hoặc xóa ledger/enrollment trùng.
- Backfill tự động mức học phí lịch sử không chắc chắn.
- Báo cáo số đã thu tại một thời điểm lịch sử.
- Thay đổi công thức của báo cáo trung tâm hoặc đối soát học sinh hiện tại.

## 16. Phương án bị loại

### Mở rộng toàn bộ `CenterFinanceReport`

Bị loại vì làm response lớn, ghép scope khóa với scope tháng và tăng nguy cơ chạm giới hạn ledger.

### Ghép dữ liệu ở frontend

Bị loại vì đưa quá nhiều dữ liệu tài chính xuống client, lặp công thức và làm tăng rủi ro sai lệch phân quyền/nghiệp vụ.

### Accordion tải mọi lớp

Bị loại vì trang dài, payload lớn và không phù hợp số lượng lớp tăng dần. Thiết kế được chọn là lọc một lớp/khóa rồi tải chi tiết theo nhu cầu.
