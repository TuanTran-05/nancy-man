# Thiết kế chi tiết giao dịch cho Báo cáo quỹ

- **Ngày:** 2026-07-30
- **Trạng thái:** Đã duyệt trong trao đổi
- **Phạm vi:** Trang `/admin/finance-report`, API tài chính trung tâm và các phép ghép dữ liệu chỉ đọc phục vụ báo cáo

## 1. Bối cảnh

Trang Báo cáo quỹ hiện lấy dữ liệu từ
`GET /api/v1/finance/center-report?month=YYYY-MM&months=N` và hiển thị các KPI tổng hợp. Hai KPI
`Đã thu` và `Đã chi` chỉ là con số. Người dùng chưa thể biết các chứng từ nào tạo nên con số đó.

Hệ thống đã có nguồn dữ liệu chuẩn:

- `receipts` cho tiền thực thu;
- `expenses` cho tiền thực chi;
- `course_fee_ledgers` cho số phải thanh toán, tổng đã trả, giảm trừ và công nợ;
- `students.walletBalance` cho số dư ví hiện tại;
- `classes` cho tên lớp;
- các snapshot `allocations` trên phiếu thu mới để mô tả một phiếu cấn nhiều công nợ.

Một phiếu thu `wallet-manual-v2` có thể nhận tiền vào ví và đồng thời cấn một hoặc nhiều công nợ.
Tổng các dòng cấn có thể sử dụng cả tiền vừa thu và tiền đã có trong ví, nên không được coi tổng
allocation là doanh thu mới. Phiếu hoàn ví đồng thời có một expense và một wallet transaction; báo cáo
chi chỉ được tính expense để tránh trùng tiền.

## 2. Quyết định đã chốt

1. Bấm KPI `Đã thu` hoặc `Đã chi` mở một hộp thoại chi tiết ngay trên trang báo cáo.
2. Chi tiết được tải lười từ một API riêng, có phân trang; không nhúng toàn bộ chứng từ vào phản hồi
   báo cáo tổng.
3. Kỳ báo cáo là tháng dương lịch: từ `YYYY-MM-01` đến ngày cuối cùng của đúng tháng đó.
4. `Số tiền còn lại` là công nợ **hiện tại** sau tất cả giao dịch, không phải snapshot lịch sử tại thời
   điểm lập phiếu.
5. Số dư ví hiển thị là `students.walletBalance` hiện tại do server đọc.
6. Phiếu thu nhiều công nợ có một dòng chứng từ chính và nhiều dòng phân bổ có thể bung ra.
7. Chi tiết phiếu chi hiển thị riêng người nhận tiền và người lập/ghi nhận phiếu.
8. Nếu tổng mới nhất của API chi tiết khác KPI đang hiển thị, trang tự tải lại báo cáo tổng.

## 3. Mục tiêu

- Giải thích đầy đủ những chứng từ tạo nên `Đã thu` và `Đã chi` của tháng được chọn.
- Giữ tổng KPI và tổng chi tiết cùng một định nghĩa nghiệp vụ.
- Ghép đúng phiếu thu với học sinh, lớp, công nợ và số dư ví hiện tại.
- Giữ tốc độ tải ban đầu của trang báo cáo khi tháng có nhiều giao dịch.
- Hoạt động rõ ràng trên cả màn hình lớn và điện thoại.

## 4. Ngoài phạm vi

- Không thay đổi cách tạo, ghi sổ hoặc hủy phiếu thu/phiếu chi.
- Không sửa số dư ví, công nợ hoặc dữ liệu lịch sử.
- Không thêm tìm kiếm toàn văn hoặc xuất Excel/PDF trong hộp thoại.
- Không biến allocation thành một khoản thu mới.
- Không thay đổi công thức các biểu đồ/KPI khác của Báo cáo quỹ.

## 5. API chi tiết

### 5.1 Endpoint

Thêm:

```text
GET /api/v1/finance/center-report-details
  ?month=YYYY-MM
  &type=income|expense
  &pageSize=25
  &cursor=<opaque-base64url>
```

Quy tắc:

- chỉ chấp nhận `GET`;
- quyền đọc là `admin` hoặc `accounting`, giống endpoint `center-report`;
- `month` phải là tháng lịch hợp lệ;
- `type` chỉ nhận `income` hoặc `expense`;
- `pageSize` mặc định `25`, nhỏ nhất `1`, lớn nhất `100`;
- sắp xếp ngày giao dịch giảm dần, sau đó ID chứng từ giảm dần để thứ tự ổn định;
- cursor là base64url của `{ date, id }`, được server giải mã và kiểm tra chặt chẽ;
- cursor sai định dạng trả `400 invalid_cursor`;
- ngày trong cursor phải thuộc tháng đang truy vấn.

Phản hồi chung:

```ts
type CenterReportDetailsResponse<Row> = {
  success: true;
  month: string;
  type: 'income' | 'expense';
  period: { startDate: string; endDate: string };
  totalCount: number;
  totalAmount: number;
  rows: Row[];
  nextCursor: string | null;
};
```

`totalCount` và `totalAmount` được lấy bằng Firestore aggregate `count()` và `sum()` trên cùng base
query dùng để lấy trang dữ liệu. Chúng không được tính từ riêng trang hiện tại.

### 5.2 Ranh giới tháng

Server tạo:

```text
startDate = YYYY-MM-01
endDate   = ngày cuối tháng, dạng YYYY-MM-DD
```

Thu lọc theo:

```text
status == posted
receivedDate >= startDate
receivedDate <= endDate + "\uf8ff"
```

Chi lọc theo:

```text
status == posted
paidDate >= startDate
paidDate <= endDate + "\uf8ff"
```

Điều kiện này giống định nghĩa đang dùng trong `FinanceRepository.listPostedReceipts` và
`listPostedExpenses`. Bản nháp và chứng từ đã hủy không xuất hiện.

## 6. Kiểu dữ liệu chi tiết

### 6.1 Thu

```ts
type IncomeAllocationDetail = {
  ledgerId: string;
  classId: string;
  className: string;
  allocatedAmount: number;
  amountDue: number;
  remainingAmount: number;
  dataAvailable: boolean;
};

type IncomeTransactionDetail = {
  id: string;
  receiptNo: string;
  invoiceNo: string;
  receivedDate: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  phone: string;
  paymentMethod: 'cash' | 'transfer' | 'other' | string;
  amountReceived: number;
  amountDue: number;
  remainingAmount: number;
  walletBalance: number;
  walletDeposit: boolean;
  note: string;
  allocations: IncomeAllocationDetail[];
};
```

Quy tắc dựng dòng:

- `amountReceived` luôn lấy từ receipt và là giá trị duy nhất được cộng vào doanh thu.
- Phiếu có `allocations` dùng danh sách đó; phiếu cũ không có allocations dùng `ledgerId` và
  `classId` làm một dòng liên kết.
- Mỗi ledger liên kết được đọc ở trạng thái hiện tại.
- `amountDue = max(0, ledger.amount - ledger.discountTotal)`.
- `remainingAmount = max(0, amountDue - ledger.paidTotal)`.
- Tổng `amountDue` và `remainingAmount` của receipt là tổng theo các ledger ID duy nhất, không cộng
  trùng nếu dữ liệu cũ chứa liên kết lặp.
- `allocatedAmount` mô tả số tiền đã cấn vào công nợ trong thao tác đó. Trường này không được cộng
  vào KPI Thu vì nó có thể bao gồm số dư ví có sẵn.
- Phiếu chỉ thu tiền vào ví mà không gắn công nợ trả allocations rỗng, `amountDue = 0` và
  `remainingAmount = 0`. Mapper đặt `walletDeposit = true` khi receipt đã có cờ này, hoặc khi
  `flowVersion === 'wallet-manual-v2'` nhưng không có ledger/allocation liên kết; không phụ thuộc dữ
  liệu cũ có lưu sẵn cờ hay không.
- `walletBalance` lấy trực tiếp từ student hiện tại.
- Nếu thiếu student, class hoặc ledger lịch sử, receipt vẫn được trả về để tổng tiền không hụt.
  Trường chữ dùng chuỗi rỗng, tiền liên kết dùng `0`, và `dataAvailable = false` để giao diện hiển thị
  `Không có dữ liệu`.
- `receiptNo` là số phiếu thu; `invoiceNo` hiển thị thêm nếu PayOS hoặc luồng hóa đơn đã lưu trường này.

### 6.2 Chi

```ts
type ExpenseTransactionDetail = {
  id: string;
  expenseNo: string;
  paidDate: string;
  category: string;
  amount: number;
  purpose: string;
  reason: string;
  note: string;
  payee: string;
  createdBy: string;
  createdByName: string;
  type: 'activity' | 'wallet_refund';
  studentId: string;
  studentName: string;
  walletBalance: number | null;
};
```

Quy tắc dựng dòng:

- KPI Chi và `totalAmount` chỉ cộng `expense.amount`.
- Wallet transaction của một khoản hoàn ví không được cộng lần hai.
- `payee` là người/đơn vị nhận tiền.
- `createdByName`, fallback `createdBy`, là người lập hoặc ghi nhận phiếu.
- Chi hoạt động giữ nguyên `purpose`, `reason` và `note`; giao diện ưu tiên nội dung theo thứ tự
  `purpose`, `reason`, `note`.
- Phiếu hoàn ví trả thêm học sinh và số dư ví hiện tại. Chi hoạt động không gắn học sinh trả
  `walletBalance = null`.

## 7. Backend

### 7.1 Router và handler

- Thêm nhánh `action === 'center-report-details'` trong `api/finance/[action].ts`.
- Thêm `server/api/finance/handlers/centerReportDetails.ts`.
- Handler chịu trách nhiệm xác thực quyền, chuẩn hóa query, ánh xạ lỗi nghiệp vụ sang mã HTTP và gọi
  service.

### 7.2 Repository

Mở rộng `FinanceRepository` bằng các phép đọc tập trung:

- trang receipts theo tháng, mới nhất trước;
- trang expenses theo tháng, mới nhất trước;
- aggregate count/sum cho base query tương ứng;
- batch-get ledger theo ID;
- batch-get student theo ID, gồm `name`, `studentId`, `contact`, `walletBalance`;
- batch-get class theo ID, gồm tên lớp.

Batch get chia nhóm tối đa 100 document references. Không đọc toàn bộ students/classes cho mỗi trang.

Thêm hai composite index:

```text
receipts: status ASC, receivedDate DESC
expenses: status ASC, paidDate DESC
```

Document ID là khóa phụ ổn định cho pagination.

### 7.3 Service và domain mapper

- Thêm `server/api/lib/services/centerFinanceReportDetailsService.ts` để điều phối repository và join.
- Thêm module thuần `shared/centerFinanceReportDetails.ts` để:
  - chuẩn hóa receipt/expense;
  - dựng liên kết allocation cũ và mới;
  - tính `amountDue`/`remainingAmount` bằng helper tiền chuẩn;
  - chống lặp ledger;
  - giữ receipt/expense khi dữ liệu liên kết bị thiếu.

Client không tự tính lại công nợ hoặc số dư ví.

## 8. Frontend

### 8.1 KPI có thể bấm

`FinanceKpiRow` nhận callback mở chi tiết. Hai card sau render thành `<button type="button">`:

- `Đã thu`;
- `Đã chi`.

Hai card có affordance `Xem chi tiết`, trạng thái hover/focus rõ ràng và accessible name chứa tên KPI.
Các KPI còn lại vẫn là card tĩnh.

### 8.2 Hộp thoại chi tiết

Thêm component tập trung trong
`src/pages/admin/components/financeReport/FinanceTransactionDetailsModal.tsx`:

- dùng `ModalPortal`, focus trap và khóa cuộn theo mẫu modal hiện có;
- desktop dùng hộp thoại rộng có bảng cuộn ngang;
- điện thoại dùng khung gần toàn màn hình và các giao dịch dạng card;
- header hiển thị loại Thu/Chi, tháng, tổng chứng từ và tổng tiền;
- mở modal trước rồi hiển thị loading bên trong;
- đóng bằng nút X, Escape hoặc backdrop;
- mới nhất trước;
- có nút trang trước/sau; nút sau dùng `nextCursor`;
- có trạng thái rỗng, lỗi và nút thử lại.

Bảng Thu hiển thị:

1. số phiếu thu và số hóa đơn;
2. ngày thu;
3. học sinh, mã học sinh và số điện thoại;
4. lớp hoặc số lượng công nợ;
5. phương thức thanh toán;
6. tiền thực thu;
7. phải thanh toán hiện tại;
8. công nợ hiện tại;
9. số dư ví hiện tại.

Dòng có allocation có nút bung chi tiết. Mỗi allocation hiển thị lớp, số tiền đã cấn, phải thanh toán và
còn lại. Tiền chưa phân bổ được ghi rõ là `Tiền đang giữ trong ví`.

Bảng Chi hiển thị:

1. số phiếu chi;
2. ngày chi;
3. hạng mục;
4. nội dung/lý do;
5. số tiền;
6. người nhận;
7. người lập phiếu;
8. học sinh liên quan nếu là hoàn ví.

### 8.3 Đồng bộ tổng

Modal nhận `expectedTotal` từ `report.current.cashIn` hoặc `cashOut`. Sau lần tải chi tiết đầu tiên:

- nếu `totalAmount === expectedTotal`, không làm gì;
- nếu khác, gọi callback tải lại `fetchCenterFinanceReport(month, months)`;
- báo cáo tổng được cập nhật trong nền, không đóng modal;
- mỗi lần mở modal chỉ phát một yêu cầu làm mới để tránh vòng lặp.

### 8.4 Client API và i18n

- Thêm các type và `fetchCenterFinanceReportDetails` vào `src/lib/api/financeApi.ts`.
- Bổ sung nhãn tiếng Việt và tiếng Anh trong locale pages cho nút, tiêu đề, cột, phương thức thanh
  toán, phân trang, loading/rỗng/lỗi, `Không có dữ liệu` và `Tiền đang giữ trong ví`.

## 9. Bảo mật và xử lý lỗi

- Mọi dữ liệu chi tiết đi qua API đã xác thực; client không đọc Firestore trực tiếp.
- Endpoint không có thao tác ghi.
- Role khác `admin`/`accounting` nhận `403`.
- Method khác GET nhận `405`.
- Tháng sai nhận `400 invalid_month`.
- Type sai nhận `400 invalid_detail_type`.
- Cursor sai nhận `400 invalid_cursor`.
- Lỗi join một document lịch sử không làm rơi chứng từ gốc.
- Lỗi truy vấn/aggregate được xử lý qua `handleApiError` hiện có và giao diện cho phép thử lại.

## 10. Kiểm thử

### 10.1 Domain

Test `shared/centerFinanceReportDetails.test.ts`:

- phiếu cũ một ledger;
- phiếu mới nhiều allocations;
- ledger trùng chỉ được tính một lần ở tổng phải thu/còn lại;
- allocation lớn hơn tiền thực thu không làm tăng doanh thu;
- tiền vào ví chưa phân bổ;
- student/class/ledger bị thiếu;
- giảm trừ, đã trả và công nợ được chặn về tối thiểu 0;
- hoàn ví chỉ tạo một dòng chi.

### 10.2 Repository và service

- query đúng ngày đầu và cuối tháng;
- loại draft/void;
- thứ tự ngày + ID ổn định;
- cursor không lặp hoặc bỏ dòng;
- page size và next cursor;
- aggregate count/sum không phụ thuộc page size;
- batch join student, ledger và class;
- số dư ví là giá trị hiện tại;
- tổng receipt dùng `amountReceived`, tổng expense dùng `amount`;
- phiếu liên kết dữ liệu cũ bị thiếu vẫn được giữ.

### 10.3 Handler

- chấp nhận admin/accounting;
- từ chối role khác;
- từ chối method, month, type và cursor sai;
- phản hồi đúng contract cho income và expense.

### 10.4 Frontend

- chỉ card `Đã thu` và `Đã chi` có thể bấm;
- bấm đúng card gọi đúng `type`;
- modal hiển thị đủ trường Thu và Chi;
- bung/thu allocation;
- mobile card và desktop table dùng cùng dữ liệu;
- loading, rỗng, lỗi, thử lại;
- phân trang không lặp dòng;
- đóng bằng X, Escape và backdrop;
- chênh tổng gọi làm mới báo cáo đúng một lần.

### 10.5 Xác minh cuối

Chạy:

```text
vitest cho domain, repository, service, handler và component liên quan
npm.cmd run typecheck
npm.cmd run build
```

## 11. Tiêu chí hoàn thành

1. Bấm `Đã thu` thấy toàn bộ thông tin chứng từ thu của đúng tháng đã chọn.
2. Bấm `Đã chi` thấy toàn bộ thông tin chứng từ chi của đúng tháng đã chọn.
3. Tổng chi tiết Thu bằng tổng `amountReceived` posted của tháng; tổng Chi bằng tổng `expense.amount`
   posted của tháng.
4. Một phiếu nhiều công nợ không làm doanh thu bị nhân đôi.
5. Công nợ và số dư ví hiển thị theo trạng thái hiện tại trên server.
6. Dữ liệu lịch sử thiếu liên kết không làm chứng từ biến mất khỏi tổng hoặc danh sách.
7. Giao diện sử dụng được trên desktop, điện thoại và bàn phím.
8. Không có thay đổi ghi dữ liệu, migration hoặc phép tính tài chính ngoài phạm vi.
