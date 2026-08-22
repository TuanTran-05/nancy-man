# Ví học sinh thống nhất với Phiếu thu thủ công

Ngày: 2026-07-27  
Trạng thái: Đã được người dùng duyệt bằng văn bản ngày 2026-07-27
Ngôn ngữ: tiếng Việt; tên field và collection giữ tiếng Anh để khớp code

## 1. Mục tiêu

Thay luồng “đóng học phí” và “nạp ví” tách rời bằng một luồng tiền thống nhất cho **Phiếu thu
thủ công do kế toán lập**:

1. Tiền thực thu luôn đi vào ví học sinh.
2. Kế toán chọn một hoặc nhiều khoản công nợ để cấn.
3. Kế toán nhập số tiền cấn riêng cho từng khoản và được chủ động giữ lại tiền trong ví.
4. Việc cấn có thể sử dụng cả số dư ví cũ và tiền vừa thu.
5. Mọi khoản cộng/trừ mới được ghi thành lịch sử ví có thể đối soát.

Màn Ví học sinh phải hiển thị danh sách học sinh hoạt động với đủ thông tin nhận diện, có bộ lọc
xem học sinh đã nghỉ, số dư hiện tại và lịch sử ví.

## 2. Hiện trạng

- `server/api/finance/handlers/receipts.ts` ghi Phiếu thu học phí thẳng vào một
  `course_fee_ledgers` và không tạo lịch sử ví.
- `server/api/finance/handlers/wallet.ts` có endpoint `deposit-and-post` riêng. Endpoint này tạo
  Phiếu thu “nạp ví”, giao dịch `deposit` và cộng `students.walletBalance`.
- `GET /wallet/balances` chỉ trả học sinh có `walletBalance > 0`; vì vậy màn Ví học sinh không
  phải danh sách đầy đủ.
- Lịch sử hiện chỉ đọc `wallet_transactions`, chủ yếu có giao dịch nạp ví cũ; Phiếu thu học phí
  và các lần cấn công nợ không xuất hiện.
- Phiếu chi hiện là chi phí hoạt động chung, chưa có loại hoàn tiền cho học sinh.

Đặc tả này **thay thế quyết định D3** trong
`docs/superpowers/specs/2026-07-23-student-wallet-accounting-design.md`. Cụ thể, không còn hai chế
độ “Đóng cho khóa” và “Nạp ví” đối với Phiếu thu thủ công. Các quyết định khác của đặc tả cũ chỉ
giữ hiệu lực nếu không mâu thuẫn với tài liệu này.

## 3. Phạm vi

### Trong phạm vi

- Phiếu thu thủ công của kế toán.
- Phân bổ một Phiếu thu vào nhiều công nợ.
- Cấn công nợ trực tiếp từ số dư ví hiện có.
- Phiếu chi hoàn tiền học sinh.
- Danh sách và lịch sử Ví học sinh.
- Hủy Phiếu thu/Phiếu chi và đảo ngược biến động liên quan.
- Chụp số dư đầu kỳ khi triển khai.

### Ngoài phạm vi

- PayOS: tiếp tục ghi thẳng vào công nợ đã chọn như hiện tại, không tạo giao dịch ví.
- Hồi tố Phiếu thu học phí cũ thành giao dịch ví.
- Tự động chọn hoặc tự động cấn công nợ.
- Thay đổi nghiệp vụ Phiếu chi hoạt động.
- Thay đổi cách ghi nhận doanh thu hiện tại.

## 4. Các quyết định nghiệp vụ

### D1 — Một Phiếu thu tạo một nhóm biến động ví

Với Phiếu thu thủ công có số tiền thực thu `receiptAmount`:

```text
availableBeforeAllocation = currentWalletBalance + receiptAmount
endingWalletBalance       = availableBeforeAllocation - sum(allocation.amount)
```

Khi ghi sổ, server thực hiện trong **một Firestore transaction**:

1. Tạo Phiếu thu `posted`.
2. Tạo một `wallet_transactions` loại `deposit`, số tiền bằng `receiptAmount`.
3. Tạo một `wallet_transactions` loại `allocation` cho mỗi công nợ được chọn.
4. Tăng `paidTotal` và tính lại `status` của từng ledger.
5. Cập nhật `students.walletBalance` bằng `endingWalletBalance`.

Ví dụ: ví cũ 1.000.000đ, thu mới 2.000.000đ, cấn khóa A 1.500.000đ và khóa B 500.000đ:

```text
+2.000.000  Phiếu thu
-1.500.000  Cấn khóa A
-  500.000  Cấn khóa B
-----------
 1.000.000  Số dư ví cuối
```

Mọi bản ghi trong nhóm dùng chung `transactionGroupId`; các giao dịch do Phiếu thu tạo có
`receiptId`. Trình tự hiển thị ổn định bằng `groupSequence`: deposit trước, sau đó các allocation
theo thứ tự trên Phiếu thu.

### D2 — Kế toán kiểm soát toàn bộ phân bổ

- Kế toán được chọn nhiều ledger `unpaid` hoặc `partial` của cùng học sinh.
- Mỗi dòng có số tiền cấn riêng.
- Không bắt buộc phân bổ hết tiền, kể cả khi học sinh vẫn còn công nợ.
- Tổng phân bổ có thể lớn hơn số tiền vừa thu nếu ví cũ còn đủ tiền.
- Không dòng nào được vượt `ledgerRemaining` tại thời điểm server ghi sổ.
- Tổng phân bổ không được vượt số dư ví sau khi cộng tiền thu.
- Server không tự chọn ledger, không FIFO và không tự sửa số phân bổ do kế toán nhập.
- Nếu dữ liệu đã thay đổi do một thao tác đồng thời, toàn bộ transaction thất bại và UI tải lại số
  dư/công nợ để kế toán xác nhận lại.

Các khoản giảm giá, học bổng và miễn giảm hiện có vẫn là điều chỉnh ledger, không phải tiền ví.
Khi Phiếu thu có nhiều ledger, dữ liệu giảm giá được gắn với đúng dòng phân bổ/ledger và server
tiếp tục dùng các quy tắc hiện có. Phiếu miễn hoàn toàn có `amountReceived = 0` không tạo deposit
hay lịch sử ví vì không có tiền thực thu.

### D3 — Cấn công nợ từ ví không cần Phiếu thu mới

Màn Ví học sinh có thao tác **Cấn công nợ**. Kế toán chọn một hoặc nhiều công nợ và nhập số tiền
cho từng khoản. Server tạo nhóm transaction chỉ gồm các `allocation`, cập nhật ledger và trừ ví
nguyên tử. Không tạo Phiếu thu vì không phát sinh tiền mặt mới.

Các giới hạn ở D2 áp dụng giống hệt luồng cấn trong Phiếu thu.

### D4 — Bỏ luồng Nạp ví riêng

- Bỏ nút và modal “Nạp ví” khỏi màn Ví học sinh.
- Client mới không gọi `/wallet/deposit-and-post`.
- Tiền mới do kế toán thu chỉ được nhập qua Phiếu thu.
- Dữ liệu nạp ví cũ vẫn được giữ nguyên để đối soát; không xóa collection hay chứng từ cũ trong
  lần nâng cấp này.
- Endpoint cũ được ngừng sử dụng và phải bị chặn hoặc loại bỏ sau khi xác nhận không còn client
  cũ đang hoạt động.

### D5 — Phiếu chi hoàn tiền học sinh

Phiếu chi có hai loại:

1. **Chi hoạt động**: giữ nguyên hành vi hiện tại.
2. **Hoàn tiền học sinh**: chọn học sinh, nhập số tiền và lý do bắt buộc.

Ghi sổ Phiếu chi hoàn tiền tạo đồng thời:

- Expense/Phiếu chi `posted`, có `type: 'wallet_refund'` và `studentId`.
- `wallet_transactions` loại `refund`, liên kết bằng `expenseId`.
- Số dư ví mới bằng số dư cũ trừ số tiền hoàn.

Server từ chối nếu tiền hoàn vượt số dư. Hủy Phiếu chi hoàn tiền chuyển giao dịch refund sang
`void` và cộng tiền lại vào ví trong cùng transaction. Phiếu chi hoạt động không tạo giao dịch ví.

### D6 — Hủy Phiếu thu và các phân bổ

Hủy Phiếu thu thủ công mới phải đảo toàn bộ nhóm do Phiếu thu tạo:

1. Hoàn tác các allocation của nhóm và mở lại công nợ tương ứng.
2. Trừ deposit khỏi ví.
3. Chuyển Phiếu thu và các transaction liên quan sang `void`, lưu lý do, người hủy và thời gian.

Do một allocation trong nhóm có thể dùng cả số dư ví cũ, toàn bộ allocation gắn với Phiếu thu đều
được đảo khi hủy Phiếu thu. Nếu các giao dịch phát sinh sau đã làm cho kết quả cuối bị âm, server
chặn việc hủy và trả thông báo yêu cầu xử lý các giao dịch phụ thuộc trước.

Các thao tác hủy luôn dùng idempotency key và ghi critical audit log.

## 5. Mô hình dữ liệu

### 5.1 Phiếu thu thủ công phiên bản mới

Phiếu thu mới lưu số tiền thực nhận và snapshot phân bổ:

```ts
type ReceiptAllocation = {
  ledgerId: string;
  classId: string;
  amount: number;
  // Các field discount hiện có được đặt ở đúng allocation khi áp dụng.
};

type WalletManualReceiptFields = {
  flowVersion: 'wallet-manual-v2';
  transactionGroupId: string;
  allocations: ReceiptAllocation[];
  walletBalanceBefore: number;
  walletBalanceAfter: number;
};
```

`amountReceived` luôn là tiền thật đã thu và là số dùng cho báo cáo doanh thu. `allocations` không
được cộng lần nữa vào doanh thu. `ledgerId` và `classId` đơn lẻ chỉ còn là field legacy đối với
Phiếu thu cũ; Phiếu thu v2 lấy liên kết từ `allocations`.

### 5.2 Giao dịch ví phiên bản mới

Các transaction mới bổ sung metadata phục vụ nhóm, thứ tự và lịch sử:

```ts
type WalletV2Fields = {
  schemaVersion: 2;
  transactionGroupId: string;
  groupSequence: number;
  source: 'manual_receipt' | 'manual_allocation' | 'student_refund';
  receiptId?: string;
  expenseId?: string;
  ledgerId?: string;
};
```

Amount luôn dương; chiều tiền tiếp tục do loại giao dịch quyết định:

- `deposit`, `credit`: cộng ví.
- `allocation`, `refund`: trừ ví.
- `adjustment`: dùng `direction`.

Mỗi thao tác ghi có idempotency key. `students.walletBalance` chỉ thay đổi trong cùng Firestore
transaction với các bản ghi ví và ledger/receipt/expense liên quan.

### 5.3 Mốc bắt đầu lịch sử

Khi triển khai, script có dry-run và manifest sẽ chụp:

```ts
type WalletHistoryOpening = {
  walletHistoryStartedAt: string;
  walletOpeningBalance: number;
};
```

Script không thay đổi `walletBalance`. API lịch sử v2 chỉ trả:

1. Dòng “Số dư đầu kỳ khi nâng cấp” từ snapshot.
2. Giao dịch `schemaVersion: 2` phát sinh từ mốc đó.

Phiếu thu, Phiếu chi và giao dịch ví cũ không được chuyển đổi hay trộn vào lịch sử mới.

## 6. Giao diện

### 6.1 Phiếu thu

Thứ tự thao tác:

1. Chọn học sinh.
2. Nhập số tiền thực thu, ngày thu, phương thức và ghi chú.
3. Hiển thị số dư ví hiện tại, tiền vừa thu và tổng tiền khả dụng.
4. Hiển thị toàn bộ công nợ chưa thanh toán của học sinh.
5. Chọn nhiều công nợ và nhập số cấn từng dòng.
6. Hiển thị bản xem trước gồm tiền thu, phần dùng từ ví cũ, tổng cấn và số dư cuối.
7. Xác nhận ghi sổ.

Chi tiết Phiếu thu hiển thị danh sách phân bổ và phần còn lại trong ví. Danh sách Phiếu thu vẫn
hiển thị `amountReceived`, không hiển thị tổng allocation như tiền thu mới.

### 6.2 Danh sách Ví học sinh

Mặc định chỉ hiển thị học sinh đang hoạt động. Bộ lọc:

- Đang học.
- Đã nghỉ/đã lưu trữ.
- Tất cả.

Tìm kiếm theo tên, mã học sinh hoặc số điện thoại. Các cột:

- Họ và tên.
- Mã học sinh.
- Ngày sinh.
- Lớp hiện tại.
- Số điện thoại.
- Số dư ví.
- Thao tác Cấn công nợ và Xem lịch sử.

API danh sách không được lọc `walletBalance > 0`; học sinh có số dư 0 vẫn xuất hiện.

### 6.3 Lịch sử ví

Lịch sử sắp xếp mới nhất trước, nhưng các dòng trong cùng nhóm giữ `groupSequence`. Mỗi dòng có:

- Thời gian.
- Loại giao dịch.
- Số tiền có dấu `+`/`−` và màu phân biệt.
- Số dư sau giao dịch.
- Số Phiếu thu/Phiếu chi.
- Công nợ và lớp liên quan.
- Nội dung, người thực hiện và trạng thái.

Giao dịch void vẫn xuất hiện với trạng thái “Đã hủy”. Số dư chạy được API tính từ số dư đầu kỳ và
các giao dịch v2 còn hiệu lực, thay vì tin vào snapshot cũ của một transaction đã bị hủy.

## 7. API và ranh giới module

- Một module domain thuần tính và kiểm tra kế hoạch phân bổ:
  `current balance + receipt − allocations`, giới hạn từng ledger và trạng thái sau phân bổ.
- Handler Firestore chỉ chịu trách nhiệm đọc snapshot, gọi domain planner và áp dụng toàn bộ writes
  trong một transaction.
- Cùng domain planner được tái sử dụng cho Phiếu thu và thao tác Cấn công nợ.
- Component biên tập phân bổ dùng chung giữa Receipt modal và Wallet tab.
- API lịch sử chịu trách nhiệm ghép dòng số dư đầu kỳ, tính signed amount và running balance.
- Client không tự tính kết quả cuối đáng tin cậy; preview chỉ để hỗ trợ nhập liệu, server luôn kiểm
  tra lại.

Các endpoint ghi chỉ dành cho `admin` và `accounting`, theo quyền hiện có của finance router.
Client không được ghi trực tiếp `wallet_transactions`.

## 8. PayOS, báo cáo và sự kiện realtime

- PayOS giữ nguyên luồng hiện tại: receipt gắn một ledger và cập nhật ledger trực tiếp.
- Receipt PayOS không tạo `deposit`/`allocation` và không xuất hiện trong lịch sử ví v2.
- Doanh thu tiếp tục lấy tiền thực thu từ receipt; allocation chỉ là chuyển tiền đang giữ hộ sang
  công nợ, không phải một lần thu mới.
- Phiếu chi hoàn tiền được tính vào cash out đúng một lần qua expense, không cộng thêm
  `wallet_transactions` vào chi phí.
- Sau commit, phát các realtime event cần thiết cho receipt, ledger, accounting student finance,
  wallet list và parent tuition theo các luồng hiện có.

## 9. Xử lý lỗi và bất biến

Server phải đảm bảo:

- Học sinh tồn tại.
- Ledger tồn tại, thuộc đúng học sinh và đang còn nợ.
- Không có allocation âm hoặc bằng 0.
- Mỗi ledger chỉ xuất hiện một lần trong một request.
- Mỗi allocation không vượt số còn nợ.
- Tổng allocation không vượt số dư sau khi thu.
- Refund không vượt số dư hiện tại.
- Ví không âm sau mọi thao tác.
- Idempotency key dùng lại không nhân đôi tiền và không được replay sang loại nghiệp vụ khác.
- Tất cả reads xảy ra trước writes theo yêu cầu của Firestore transaction.
- Lỗi ở bất kỳ bước nào làm toàn bộ thao tác thất bại.

Thông báo lỗi cho kế toán phải nêu rõ khoản nợ hoặc số dư nào đã thay đổi để có thể tải lại và xác
nhận, không trả lỗi 500 chung cho các xung đột nghiệp vụ dự kiến.

## 10. Kiểm thử

Viết test trước cho các lớp sau.

### Domain tests

- Một Phiếu thu cấn một và nhiều ledger.
- Tổng allocation nhỏ hơn, bằng và lớn hơn tiền vừa thu.
- Dùng kết hợp số dư cũ và tiền vừa thu.
- Chủ động giữ tiền trong ví khi vẫn còn nợ.
- Allocation vượt số dư hoặc vượt ledger remaining bị từ chối.
- Ledger status được tính lại bằng helper dùng chung.
- Full waiver không tạo giao dịch ví.

### Handler transaction tests

- Receipt, deposit, allocations, ledgers và wallet balance cùng commit.
- Lỗi giữa transaction không để lại bản ghi dở dang.
- Idempotent retry không tạo giao dịch trùng.
- Hai thao tác đồng thời không làm ví âm hoặc ledger trả quá số nợ.
- Cấn từ ví không tạo Phiếu thu.
- Hoàn tiền/hủy hoàn tiền cập nhật expense và ví nguyên tử.
- Hủy Phiếu thu đảo đúng toàn bộ nhóm; hủy bị chặn khi có phụ thuộc làm ví âm.
- PayOS vẫn đi theo luồng cũ.

### UI tests

- Phiếu thu chọn nhiều công nợ và hiển thị preview đúng.
- Danh sách ví hiển thị cả học sinh số dư 0.
- Đủ sáu cột thông tin và hai thao tác.
- Mặc định chỉ hiện học sinh hoạt động; bộ lọc xem được học sinh đã nghỉ.
- Tìm kiếm theo tên, mã và số điện thoại.
- Lịch sử có số dư đầu kỳ, dấu cộng/trừ, chứng từ và trạng thái void.
- Không còn nút Nạp ví.

### Migration/reconciliation tests

- Dry-run không ghi dữ liệu.
- Snapshot số dư đầu kỳ không thay đổi `walletBalance`.
- Chạy lại script an toàn và không ghi đè mốc đã chụp.
- Tổng giao dịch v2 cộng số dư đầu kỳ khớp `students.walletBalance`.

## 11. Tiêu chí hoàn thành

Tính năng hoàn thành khi:

1. Kế toán lập được một Phiếu thu, dùng tổng số dư sau thu để cấn nhiều công nợ tùy chọn và giữ
   phần còn lại trong ví.
2. Mọi thay đổi receipt, ledger và ví là nguyên tử, idempotent và có audit log.
3. Có thể cấn số dư ví hiện có mà không cần tạo Phiếu thu giả.
4. Phiếu chi hoàn tiền trừ ví; Phiếu chi hoạt động không đổi.
5. Màn Ví học sinh hiển thị đúng danh sách, bộ lọc, sáu trường thông tin và số dư.
6. Lịch sử mới có số dư đầu kỳ và đầy đủ giao dịch cộng/trừ sau triển khai.
7. Dữ liệu cũ, PayOS, doanh thu và chi phí không bị tính trùng hoặc thay đổi ngoài phạm vi.
