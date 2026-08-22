# Thiết kế: Thu tiền trực tiếp từ danh sách công nợ học sinh

- **Ngày:** 2026-07-30
- **Trạng thái:** Đã duyệt phương án trong trao đổi; chờ người dùng review đặc tả đã ghi
- **Phạm vi:** Workspace tài chính học sinh trong `/tuition`, Phiếu thu thủ công và lịch sử Phiếu thu

## 1. Bối cảnh

Workspace tài chính hiện đã lấy học sinh làm trung tâm. Mỗi dòng trong
`StudentFinanceWorkspace` có tên, mã học sinh, trạng thái thanh toán, tổng đã đóng và tổng còn
thiếu; khi mở rộng còn xem được công nợ từng khóa.

Tuy nhiên, luồng thu tiền vẫn bắt đầu từ tab **Phiếu thu**:

1. Kế toán rời danh sách công nợ.
2. Bấm tạo Phiếu thu.
3. Chọn lại học sinh trong danh sách dài.
4. Modal mới tải lại công nợ của học sinh để nhập tiền và phân bổ.

Việc chọn lại học sinh là dư thừa vì dòng công nợ đã xác định chính xác `studentId`. Trên thực tế,
`ReceiptModal` đã dùng `studentId` để tải `WalletStudentContext`, cho phép phân bổ tiền vào một
hoặc nhiều ledger và gọi luồng `wallet-manual-v2` hiện có. Backend cũng đã cập nhật projection
`accounting_student_summaries` và phát realtime event sau khi ghi Phiếu thu.

Tab Phiếu thu đồng thời đang giữ lịch sử chứng từ, số Phiếu thu, chi tiết phân bổ, trạng thái và
một số thao tác ghi sổ/hủy. Vì vậy không được xóa phần lịch sử khi bỏ tab khỏi thanh điều hướng.

## 2. Mục tiêu

1. Kế toán thu tiền ngay tại dòng học sinh đang xem trong workspace Công nợ.
2. Không phải tìm và chọn lại học sinh trong modal.
3. Giữ nguyên toàn bộ quy tắc Phiếu thu, ví, phân bổ công nợ, giảm giá và idempotency hiện có.
4. Bỏ tab Phiếu thu khỏi thanh điều hướng khi workspace học sinh được bật.
5. Vẫn tra cứu, lọc, xem chi tiết và xử lý lịch sử Phiếu thu toàn trung tâm.
6. Không làm mất khả năng thu trước khi học sinh chưa có hoặc đã thanh toán hết công nợ.
7. Giữ an toàn cho môi trường còn chạy giao diện ledger cũ trong thời gian feature flag tồn tại.

## 3. Ngoài phạm vi

- Không thay đổi schema `receipts`, `wallet_transactions` hoặc `course_fee_ledgers`.
- Không thay đổi API ghi Phiếu thu hay Firestore transaction hiện có.
- Không tự động chọn ledger, không áp dụng FIFO và không tự động phân bổ toàn bộ tiền thu.
- Không thay đổi PayOS, Phiếu chi, báo cáo doanh thu hoặc thao tác **Cấn công nợ** từ số dư ví.
- Không xóa dữ liệu Phiếu thu cũ.
- Không thêm nghiệp vụ in Phiếu thu nếu hệ thống hiện chưa có.
- Không đổi tên toàn bộ workspace hay thiết kế lại các tab tài chính khác.

## 4. Quyết định UX

### D1 — Bỏ tab Phiếu thu trong chế độ workspace học sinh

Khi `ACCOUNTING_STUDENT_WORKSPACE_ENABLED` bật, thanh điều hướng không còn tab
**Phiếu thu**. Các tab còn lại giữ nguyên.

Key `receipts` vẫn được giữ trong type và code legacy trong thời gian feature flag còn tồn tại:

- Workspace bật: không render tab Phiếu thu.
- Workspace tắt: tab Phiếu thu cũ và nút tạo Phiếu thu vẫn hoạt động để tránh mất đường thu tiền.

Khi feature flag được gỡ hoàn toàn trong một thay đổi sau, wrapper legacy mới được xóa. Đợt thay
đổi này không trộn việc dọn feature flag vào phạm vi UX.

### D2 — Mỗi dòng học sinh có nút Thu tiền

Cột thao tác của `StudentFinanceWorkspace` có nút chính **Thu tiền**, đặt cạnh liên kết Profile.
Nút được hiển thị cho mọi dòng học sinh mà kế toán đang xem, kể cả:

- còn một hoặc nhiều khoản nợ;
- chưa tạo ledger;
- đã thanh toán hết;
- được mở qua bộ lọc lịch sử/đã nghỉ.

Quy tắc này giữ nguyên khả năng thu trước. Nếu học sinh không có ledger cần thanh toán, tiền thực
thu được giữ trong ví theo luồng `wallet-manual-v2` hiện có. Backend tiếp tục là nơi quyết định
học sinh hoặc giao dịch có hợp lệ hay không.

Nút không tự mở rộng dòng và không phụ thuộc dữ liệu chi tiết khóa đã được tải hay chưa. Nó dùng
trực tiếp `studentId`, tên và mã có sẵn trong summary row.

### D3 — Modal ở chế độ học sinh cố định

`ReceiptModal` hỗ trợ hai chế độ:

1. **Fixed student**: mở từ dòng Công nợ.
2. **Selectable student**: giữ lại cho giao diện Phiếu thu legacy khi feature flag tắt.

Ở chế độ fixed:

- Tiêu đề hiển thị `Thu tiền — <Tên học sinh>`.
- Tên và mã học sinh là thông tin chỉ đọc.
- Không render dropdown chọn học sinh.
- Khi modal mở, tự tải `WalletStudentContext` của `studentId` đã nhận.
- Mỗi lần mở tạo idempotency key mới và reset dữ liệu của lần mở trước.

Phần còn lại của modal giữ nguyên:

- Số tiền thực thu.
- Số dư ví cũ và số dư khả dụng.
- Danh sách công nợ chưa thanh toán.
- Chọn nhiều ledger và nhập số cấn riêng từng dòng.
- Học bổng, giảm giá và miễn giảm theo từng allocation.
- Phương thức, ngày thu và ghi chú.
- Bản tổng hợp số tiền đã phân bổ, dùng từ ví cũ và số dư cuối.
- Nút **Lưu & Chốt** gọi `createAndPostReceipt`.

Không tự chọn công nợ dù học sinh chỉ có một ledger. Điều này giữ đúng quyết định nghiệp vụ đã
duyệt: kế toán kiểm soát toàn bộ phân bổ và có thể chủ động giữ tiền trong ví.

Nếu không có công nợ, modal hiển thị rõ:

> Học sinh không còn khoản công nợ cần thanh toán. Số tiền thu sẽ được giữ trong ví.

### D4 — Lịch sử thu nằm trong workspace Công nợ

Toolbar của `StudentFinanceWorkspace` có nút phụ **Lịch sử thu**. Nút mở dialog kích thước lớn
thay vì một tab điều hướng riêng.

Dialog chứa toàn bộ khả năng tra cứu hiện có:

- tìm theo tên/mã học sinh hoặc số Phiếu thu;
- lọc lớp, trạng thái và khoảng ngày;
- xem số Phiếu thu, học sinh, lớp/phân bổ, số tiền, giảm giá, phương thức, ngày thu và trạng thái;
- mở chi tiết allocations;
- tải thêm kết quả;
- giữ các thao tác post/hủy mà bảng Phiếu thu hiện có cho phép.

Dialog không có nút **Tạo Phiếu thu**. Điểm bắt đầu thu tiền duy nhất trong workspace mới là nút
**Thu tiền** tại dòng học sinh.

Dialog dùng `ModalPortal`, khóa cuộn nền, có focus trap và đóng bằng nút X, `Escape` hoặc backdrop.
Bảng rộng được cuộn ngang bên trong dialog, không làm trang Công nợ bị kéo rộng.

### D5 — Tương thích URL cũ

Trong chế độ workspace:

- Mở `?tab=receipts` được chuẩn hóa thành workspace học sinh và tự mở Lịch sử thu.
- Trạng thái Lịch sử thu dùng query
  `?tab=students&view=receipt-history`, để refresh/back/forward không làm mất ngữ cảnh.
- Đóng dialog bỏ `view=receipt-history` nhưng giữ nguyên search/filter/cursor của workspace.

Trong chế độ legacy, `?tab=receipts` tiếp tục mở tab Phiếu thu cũ.

## 5. Ranh giới component

### 5.1 `Finance`

`Finance` giữ vai trò điều phối:

- trạng thái học sinh đang được thu tiền;
- mở/đóng Receipt modal;
- mở/đóng Lịch sử thu;
- tải danh sách Phiếu thu khi lịch sử mở;
- lazy-load student directory phục vụ thông tin Student đầy đủ và tính học bổng anh em.

Workspace hiện cố ý không tải toàn bộ student directory khi vào tab học sinh. Thiết kế này giữ
ưu điểm đó: directory chỉ được tải lần đầu khi kế toán mở **Thu tiền** hoặc **Lịch sử thu**, sau
đó cache trong state cho các lần dùng tiếp theo trên cùng trang.

Modal mở khung ngay và hiển thị trạng thái tải trong khi `WalletStudentContext` cùng student
directory được tải song song. Form chưa được phép ghi sổ trước khi dữ liệu Student cần cho quy tắc
học bổng đã sẵn sàng.

### 5.2 `StudentFinanceWorkspace`

Component tiếp tục sở hữu query, phân trang, expand row và course details. Component nhận hai
callback rõ ràng:

```ts
onCollectPayment(student: AccountingStudentSummary): void
onOpenReceiptHistory(): void
```

Nó không sở hữu Receipt modal, không gọi API Phiếu thu và không tải student directory. Ranh giới
này giữ workspace tập trung vào read model công nợ.

### 5.3 `ReceiptModal`

Modal tiếp tục sở hữu draft Phiếu thu và validation phía client. Props bổ sung phải biểu diễn rõ
hai chế độ fixed/selectable thay vì suy luận mơ hồ từ chuỗi rỗng.

Selected student đầy đủ vẫn được truyền cho `WalletAllocationEditor` cùng student pool để preview
học bổng anh em đúng như luồng hiện tại. Server luôn kiểm tra lại khi commit.

Modal cung cấp callback thành công để controller đóng modal và cập nhật các read view cần thiết.
Projection Công nợ vẫn được làm mới qua realtime event `accounting-student-finance`; không cập nhật
lạc quan số tiền trên client.

### 5.4 Lịch sử Phiếu thu

`ReceiptsTab` hiện trộn ba trách nhiệm: guard theo active tab, nút tạo Phiếu thu và bảng lịch sử.
Phần lịch sử được tách thành component trình bày dùng chung:

- `ReceiptHistoryTable`: bảng, expand allocation và action.
- `ReceiptHistoryDialog`: filter + bảng + phân trang trong workspace mới.
- `ReceiptsTab`: wrapper legacy, tiếp tục thêm nút tạo Phiếu thu khi feature flag tắt.

Không sao chép hai bảng lịch sử khác nhau.

## 6. Luồng dữ liệu

### 6.1 Thu tiền

1. Kế toán bấm **Thu tiền** tại dòng học sinh.
2. `Finance` lưu target và mở Receipt modal fixed-student.
3. Client tải song song:
   - `/wallet/student-context?studentId=...`;
   - student directory nếu chưa có cache.
4. Kế toán nhập tiền, chọn allocations, phương thức, ngày và ghi chú.
5. Client gửi `flowVersion: 'wallet-manual-v2'` qua endpoint hiện có.
6. Server ghi nguyên tử receipt, deposit, allocations, ledger totals và wallet balance.
7. Server rebuild summary và phát invalidation `accounting-student-finance`.
8. UI báo thành công, đóng modal và danh sách Công nợ tải lại trang hiện tại qua cơ chế
   invalidation có sẵn.

### 6.2 Xem lịch sử

1. Kế toán bấm **Lịch sử thu**.
2. URL thêm `view=receipt-history`.
3. `Finance` tải trang Phiếu thu đầu tiên theo bộ lọc của dialog.
4. Bảng lịch sử render trong dialog; tải thêm dùng cursor hiện có.
5. Post/hủy thành công tải lại lịch sử và nhận các invalidation ledger/workspace hiện có.
6. Đóng dialog trở về đúng danh sách Công nợ, bộ lọc và vị trí điều hướng trước đó.

## 7. Xử lý lỗi và trạng thái

- **Không tải được student directory:** giữ modal mở với thông báo và nút thử lại; không cho ghi
  sổ để tránh preview sai học bổng anh em.
- **Không tải được WalletStudentContext:** hiển thị lỗi trong modal và nút tải lại; dữ liệu nhập
  chưa được gửi.
- **Công nợ/số dư đổi trong lúc nhập:** server từ chối transaction; modal giữ thông tin tiền thu,
  ngày, phương thức và ghi chú, tải lại context rồi xóa toàn bộ allocations để kế toán chọn lại.
  Không tự động gửi lại.
- **Bấm lưu nhiều lần hoặc mạng retry:** nút lưu bị khóa khi đang gửi và idempotency key hiện có
  ngăn tạo receipt trùng.
- **Không tải được lịch sử:** dialog vẫn mở, hiển thị lỗi và nút thử lại; không ảnh hưởng danh sách
  Công nợ.
- **Hủy/post thất bại:** giữ nguyên dòng lịch sử và hiển thị lỗi; chỉ cập nhật sau khi server xác
  nhận thành công.

## 8. Phân quyền, audit và dữ liệu

- Quyền ghi giữ nguyên `admin` và `accounting` tại finance router.
- Client không ghi trực tiếp Firestore.
- Receipt number, người tạo, thời gian, idempotency và critical audit log giữ nguyên.
- Không migration và không backfill.
- Receipt cũ, PayOS receipt và wallet-manual-v2 receipt vẫn xuất hiện trong cùng lịch sử theo dữ
  liệu hiện có.
- Bỏ tab chỉ là thay đổi đường vào UI, không xóa chứng từ hay collection.

## 9. Khả năng truy cập

- Nút **Thu tiền** và **Lịch sử thu** là `<button>` thật, có focus ring và accessible name.
- Modal fixed-student công bố tên học sinh trong heading/dialog label.
- Trạng thái tải và lỗi dùng vùng thông báo phù hợp.
- Focus quay lại nút đã mở modal/dialog sau khi đóng.
- Bảng lịch sử giữ header rõ ràng; nút expand allocation có `aria-expanded`.
- Tất cả thao tác vẫn dùng được bằng bàn phím.

## 10. Kiểm thử

### Component

- `StudentFinanceWorkspace` render nút Thu tiền cho mỗi row và gửi đúng summary vào callback.
- Nút Lịch sử thu gọi đúng callback, không thay đổi filter workspace.
- `ReceiptModal` fixed-student ẩn dropdown, hiển thị đúng tên/mã và tự tải context.
- Mỗi lần đổi target hoặc mở lại modal reset draft/idempotency và không dùng context cũ.
- Selectable-student mode legacy vẫn hoạt động.
- Học sinh không có ledger vẫn thu được tiền và tạo allocation rỗng.
- Allocation một/nhiều ledger, giảm giá và validation ví tiếp tục xanh.
- `ReceiptHistoryDialog` có filter, phân trang, expand allocations và không có nút tạo Phiếu thu.
- Post/hủy trong history giữ nguyên hành vi hiện có.

### Integration

- Workspace bật: không thấy tab Phiếu thu; mỗi row có Thu tiền.
- Workspace tắt: tab Phiếu thu cũ vẫn tạo được receipt.
- `?tab=receipts` ở workspace mở Lịch sử thu và được chuẩn hóa URL.
- Đóng Lịch sử thu giữ nguyên query/cursor/expanded student của workspace.
- Thu tiền thành công làm tổng đã đóng/còn thiếu cập nhật qua invalidation.
- Chỉ mở workspace không tải full student directory; lần mở Thu tiền hoặc Lịch sử thu đầu tiên
  mới tải và cache directory.
- Lỗi tải dữ liệu tham chiếu không cho submit.

### Regression

- PayOS, Cấn công nợ từ ví, hủy allocation, Phiếu chi và báo cáo tài chính không đổi.
- Server receipt transaction và idempotency tests hiện có tiếp tục xanh.
- Build/typecheck xác nhận props và `Tab` union vẫn nhất quán ở cả hai chế độ feature flag.

## 11. Tiêu chí hoàn thành

1. Trong workspace học sinh, thanh tab không còn Phiếu thu.
2. Mỗi dòng học sinh có nút Thu tiền và modal luôn mở đúng học sinh, không yêu cầu chọn lại.
3. Thu một phần, thu nhiều công nợ, giữ dư trong ví, giảm giá và thu trước vẫn hoạt động.
4. Không có allocation tự động ngoài lựa chọn của kế toán.
5. Lịch sử thu toàn trung tâm vẫn tra cứu, lọc, xem chi tiết và thực hiện action hiện có.
6. Deep link Phiếu thu cũ không trở thành trang trắng hoặc mất chức năng.
7. Giao diện legacy vẫn an toàn khi workspace feature flag tắt.
8. Không thay đổi schema, API nghiệp vụ, PayOS hoặc số liệu báo cáo.
9. Các test component, integration, regression cùng typecheck/build đều đạt.
