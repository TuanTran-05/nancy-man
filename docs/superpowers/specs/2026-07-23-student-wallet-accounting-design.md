# Ví số dư học sinh & Tái cấu trúc luồng thu học phí (Student Wallet)

Ngày: 2026-07-23
Trạng thái: Đã duyệt thiết kế với chủ trung tâm, chờ lập kế hoạch triển khai
Ngôn ngữ: tiếng Việt (thuật ngữ kỹ thuật giữ tiếng Anh để khớp code)

## Bài toán

Cơ chế hiện tại khóa cứng tiền vào từng khóa học:

1. **Không thể đóng trước.** Phiếu thu bắt buộc gắn một `ledgerId` và bị chặn
   "Amount exceeds remaining tuition" (`server/api/finance/handlers/receiptDiscount.ts:91`,
   `receipts.ts:387`). Đóng cả năm hoặc đóng từ lúc học thử (chưa có ledger) đều không có chỗ ghi.
2. **Nhắc nợ chỉ biết một khóa.** `handleNotifyTuitionReminder` gửi `ledgerRemaining` của đúng
   một ledger (`server/api/zalo/handlers/tuitionHandler.ts:63,91`) — học sinh nợ nhiều khóa nhận
   nhiều tin lẻ, không có tổng, không liệt kê.
3. **Buổi nghỉ có phép chỉ là số tham khảo.** `shared/studentRefundEstimate.ts` tính được tiền
   buổi nghỉ có phép nhưng spec 2026-07-18 giới hạn DISPLAY ONLY — kế toán phải tự xử lý tay.
4. **Học sinh vào giữa khóa vẫn bị ghi nợ nguyên khóa.** `generateCourseFeeLedgers`
   (`server/api/classes/helpers/classHelpers.ts:510-596`) luôn tạo ledger với 100%
   `class.tuitionFee`.

## Phạm vi

**Xây thêm lớp Ví lên trên hệ hiện có** (phương án được chọn — rủi ro thấp nhất):

- GIỮ NGUYÊN: `course_fee_ledgers`, `receipts` đóng theo khóa, `invoices`, PayOS, học bổng
  anh em, thông báo học phí khóa mới (`tuition_notice`), toàn bộ dữ liệu lịch sử.
- THÊM MỚI: ví số dư mỗi học sinh, phiếu thu nạp ví, đề xuất cấn trừ có duyệt, cộng ví tiền
  nghỉ có phép, công nợ theo tỷ lệ buổi cho học sinh vào giữa khóa, nhắc nợ gộp theo học sinh
  với template ZNS mới, danh sách học thử cho kế toán, phiếu chi hoàn tiền ví.

Ngoài phạm vi: kế toán dồn tích (doanh thu vẫn ghi nhận theo phiếu thu — cash basis),
PayOS qua ví, tự động hoàn tiền không cần duyệt.

## Các quyết định

### D1 — Ví không âm; số hiển thị là hiệu số

Hai sổ tách bạch, một con số hiển thị:

- **`students.walletBalance`** — tiền thật đã thu nhưng chưa gán vào khóa nào. **Không bao
  giờ âm.** Là khoản trung tâm giữ hộ phụ huynh (bản chất kế toán: nợ phải trả).
- **`course_fee_ledgers`** — công nợ từng khóa, giữ nguyên schema và logic hiện có.
- **Nợ ròng hiển thị** `netBalance = walletBalance − Σ ledgerRemaining(các ledger unpaid/partial)`.
  Âm = còn nợ, dương = đóng dư — đúng mô hình chủ trung tâm mô tả, nhưng vẫn trả lời được
  "khóa nào chưa thu đủ".

Phương án bị loại: một field `balance` cho phép âm, cộng trừ trực tiếp. Mất khả năng đối soát
(không truy được "vì sao ví còn 2 triệu"), trộn tiền thật đã thu với khoản phải thu.

### D2 — Mọi biến động ví là giao dịch bất biến

Collection mới **`wallet_transactions`** (server-only write, như `receipts`):

```ts
export type WalletTransactionType =
  | 'deposit'      // + nạp ví, từ phiếu thu không gắn khóa
  | 'allocation'   // − ví trả cho một ledger
  | 'credit'       // + cộng ví: nghỉ có phép cuối khóa, tiền thừa chuyển lớp
  | 'refund'       // − hoàn tiền, gắn phiếu chi
  | 'adjustment';  // ± sửa sai, bắt buộc lý do + người duyệt

export type WalletTransactionStatus = 'proposed' | 'posted' | 'rejected' | 'void';

export interface WalletTransaction {
  id: string;
  studentId: string;
  type: WalletTransactionType;
  amount: number;            // luôn dương; chiều do type quyết định
  status: WalletTransactionStatus;
  receiptId?: string;        // deposit
  ledgerId?: string;         // allocation, credit (khóa nguồn)
  expenseId?: string;        // refund
  classId?: string;
  note?: string;
  reason?: string;           // bắt buộc với adjustment, refund, rejected, void
  createdBy: string;
  createdByName: string;
  approvedBy?: string;       // người duyệt proposal / người post
  approvedByName?: string;
  createdAt: string;
  postedAt?: string;
  updatedAt?: string;
}
```

- `walletBalance` chỉ thay đổi khi transaction chuyển sang `posted`, và cập nhật **trong cùng
  Firestore transaction** với bản ghi — cache luôn khớp tổng.
- `allocation` khi post đồng thời tăng `ledger.paidTotal` và tính lại `ledger.status` theo đúng
  công thức của `receipts.ts:399-405` (tách thành hàm dùng chung, không copy).
- Void một transaction đã post = transaction trạng thái `void` + đảo ngược số dư và ledger
  (mẫu theo void receipt hiện có, `receipts.ts:514-637`).
- Idempotency key trên mọi thao tác ghi (mẫu `finance_idempotency_keys` hiện có).

Bất biến kiểm chứng được: `walletBalance = Σ(posted deposits + credits + adjustments dương)
− Σ(posted allocations + refunds + adjustments âm)`; ví ≥ 0 sau mọi giao dịch; post
`allocation`/`refund` vượt số dư ví bị từ chối.

### D3 — Phiếu thu hai chế độ; thao tác thường ngày không đổi

- **"Đóng cho khóa"** (mặc định): giữ nguyên 100% luồng `create-and-post` hiện tại — ghi thẳng
  vào ledger, một bước, không sinh giao dịch ví, không cần duyệt gì. PayOS giữ nguyên.
- **"Nạp ví"** (mới): phiếu thu không có `ledgerId`, không giới hạn số tiền. Vẫn cấp số chứng
  từ PT- theo `reserveNextCounterSequence`, vẫn `writeCriticalAuditLog`, vẫn gửi Zalo xác nhận
  đã nhận tiền. Post phiếu ⇒ tạo `wallet_transactions` type `deposit` status `posted` trong cùng
  transaction. Void phiếu ⇒ void deposit (chỉ khi ví còn đủ; nếu đã cấn trừ hết thì phải void
  allocation trước — thông báo rõ cho kế toán).
- `Receipt` thêm field `walletDeposit?: boolean` và `ledgerId` trở thành optional trong
  schema validation (chỉ với `walletDeposit === true`).

Phương án bị loại: mọi phiếu thu (kể cả đóng thẳng khóa) sinh cặp `deposit + allocation` net-0
để có một dòng tiền hợp nhất. Đổi hành vi đường ghi nóng nhất của hệ thống và đòi PayOS làm
tương tự, trong khi UI "lịch sử tiền của học sinh" đạt cùng kết quả bằng cách merge
`receipts` + `wallet_transactions` khi hiển thị.

### D4 — Cấn trừ do hệ thống đề xuất, kế toán duyệt

Trigger tạo proposal (`allocation`, status `proposed`):

1. **Mở khóa mới / reset khóa**: sau `generateCourseFeeLedgers`, với mỗi học sinh có
   `walletBalance > 0` và ledger mới `unpaid` → proposal
   `amount = min(walletBalance − Σ proposal đang chờ, ledgerRemaining)`.
2. **Thứ tự**: nếu học sinh còn nhiều ledger chưa trả, đề xuất trừ cho **khóa có termStart cũ
   nhất trước** (FIFO).
3. Kế toán duyệt từng học sinh hoặc **duyệt cả lớp một nút**; từ chối phải có lý do.
   Duyệt ⇒ post như D2. Proposal quá 90 ngày không xử lý thì hiển thị cảnh báo, không tự hủy.

Trigger tạo proposal (`credit`, status `proposed`):

4. **Chốt khóa** (course closing): tính `estimateSessionValue(...).refundable.amount` cho từng
   học sinh (module có sẵn, `shared/studentRefundEstimate.ts`) → proposal credit kèm diễn giải
   số buổi. Kế toán duyệt ⇒ tiền vào ví ⇒ khóa sau tự được đề xuất cấn trừ theo (1).

Phương án bị loại: tự động cấn trừ hoàn toàn — chủ trung tâm chọn kiểm soát bằng duyệt tay
(chốt ở buổi trao đổi 2026-07-23).

### D5 — Học sinh vào giữa khóa: công nợ theo tỷ lệ buổi, kế toán sửa được

Khi gán học sinh vào lớp mà khóa đang chạy (join date > termStart):

```
pricePerSession   = class.tuitionFee ÷ courseTotalSessions      // D1 spec 2026-07-18
sessionsRemaining = |các buổi từ joinDate → termEnd|            // cùng bộ đếm buổi
suggestedAmount   = round(pricePerSession × sessionsRemaining)
```

- Hộp thoại chốt công nợ hiển thị phép tính ("còn 14/36 buổi × 50.000đ = 700.000đ"),
  kế toán **sửa được số cuối** rồi mới tạo ledger.
- Ledger lưu thêm basis để đối soát và hiển thị:
  `prorationBasis?: { courseTotalSessions, sessionsRemaining, pricePerSession, suggestedAmount }`.
- Vào đúng đầu khóa (joinDate ≤ buổi đầu tiên) → thu đủ 100%, không qua hộp thoại.
- Bộ đếm buổi tái dùng logic denominator của spec 2026-07-18 (union lịch tuần + makeup,
  trừ ngày hủy + ngày lễ) — tách thành hàm chung, không viết lại.

### D6 — Học thử: kế toán thấy ngay, thu tiền được ngay

- Office đưa học sinh waitlist vào lớp học thử (luồng hiện có, `studentLifecycle: 'trial'`
  + `classId`) → `touchRealtimeEvent('accounting-students')` đã có sẵn đảm bảo realtime.
- Trang Kế toán thêm khối **"Học sinh học thử"**: tên, mã, lớp học thử, ngày vào, số dư ví,
  nút tạo phiếu thu nạp ví tại chỗ. Nạp ví không đòi hỏi ledger nên thu được từ ngày học thử.
- Học thử xong **không học tiếp**: kế toán tạo **phiếu chi hoàn tiền** — `expenses` thêm
  `type: 'wallet_refund'` + `studentId` + `walletTransactionId`, số chứng từ PC- như phiếu chi
  thường, bắt buộc lý do. Post phiếu chi ⇒ `wallet_transactions` type `refund` posted, ví trừ
  tương ứng (không cho âm).
- Khối học thử đánh dấu đỏ học sinh đã rời trung tâm mà ví còn tiền.

### D7 — Nhắc nợ gộp theo học sinh, template ZNS mới

> **Superseded:** Chi tiết format `semester`, giới hạn độ dài, template config và UI preview
> trong mục D7 được thay thế bởi
> `docs/superpowers/specs/2026-07-31-student-level-tuition-reminder-design.md`.

Template mới (chủ trung tâm đang đăng ký với Zalo OA):

> Thông báo nợ học phí — Kính gửi phụ huynh em `<student_name>` - Mã học viên
> `<student_code>` … Học phí nợ: `<amount>` — Khóa nợ: `<semester>` — Hạn thanh toán:
> `<due_date>`

| Tham số | Nguồn |
|---|---|
| `amount` | `max(0, Σ ledgerRemaining − walletBalance)` — nợ ròng |
| `semester` | Chuỗi liệt kê khóa nợ: `"<tên lớp> <termStart MM/yyyy> (<còn nợ>)"`, phân cách `", "`. Vượt giới hạn ký tự template → cắt còn N khóa đầu + `" và {k} khóa khác"`. Giới hạn khai báo khi đăng ký template phải lấy mức rộng nhất Zalo cho phép. |
| `due_date` | Kế toán chọn khi gửi (như cũ) |

- Endpoint `notify-tuition-reminder` đổi đầu vào từ `ledgerId` sang `studentId`; server tự gom
  các ledger `unpaid/partial`, trừ ví, dựng chuỗi semester. Dùng lại config
  `ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID` (template nhắc nợ hiện có —
  `znsTuitionNoticeTemplateId`, `tuitionHandler.ts:93`).
- Chỉ gửi được khi **nợ ròng > 0** — học sinh đóng cả năm không bao giờ bị nhắc oan.
- UI: nút nhắc nợ chuyển từ từng dòng ledger sang từng học sinh, có **xem trước nội dung tin**
  trước khi gửi. Dedup guard theo `(studentId, nợ ròng)` — nợ thay đổi thì gửi lại được
  (đính chính khi phụ huynh ý kiến).
- Tracking: ghi `zalo_notifications` type `tuition_reminder` mức học sinh kèm danh sách
  `ledgerIds` + snapshot số tiền; đồng thời stamp `tuitionReminder*` lên từng ledger liên quan
  để màn hình cũ còn hiển thị đúng.

**Thông báo học phí khóa mới (`tuition_notice`) giữ nguyên hoàn toàn** — số tiền, luồng gửi,
guard gửi-một-lần đều không đổi (chốt với chủ trung tâm 2026-07-23).

### D8 — Chuyển lớp thống nhất về ví

`transfer.ts:179-211` hiện trừ tiền thừa lớp cũ vào ledger lớp mới qua `discountTotal`
(rollover). Sau tính năng này: tiền thừa → `wallet_transactions` type `credit` posted
(diễn giải "Tiền thừa chuyển lớp từ X") → ledger lớp mới tạo với nguyên giá → hệ thống tạo
allocation proposal theo D4. Một cơ chế duy nhất; dữ liệu rollover cũ giữ nguyên, không migrate.

### D9 — Báo cáo, phân quyền, hiển thị

- **FinanceReport** thêm 2 chỉ số: Tổng tiền giữ hộ (Σ walletBalance > 0 — nghĩa vụ với phụ
  huynh) và Tổng nợ ròng toàn trung tâm. Doanh thu giữ nguyên cách tính theo phiếu thu.
- **Phân quyền**: ghi ví/phiếu thu/phiếu chi/duyệt — `admin` + `accounting`. Office thấy danh
  sách học thử nhưng không thấy số tiền. Parent thấy ví + danh sách khóa nợ của con mình
  (qua parent dashboard service, thêm vào projection hiện có).
- **firestore.rules**: `wallet_transactions` chặn client write (mẫu receipts); đọc qua API.
- **Trang chi tiết học sinh (kế toán)**: dòng thời gian tiền = merge `receipts` (posted) +
  `wallet_transactions` (posted/void), sắp theo thời gian.

### D10 — Đối soát

Script `scripts/reconcile-wallet-balances.ts` (dry-run + manifest, theo mẫu backfill hiện có):
với mỗi học sinh, tính lại balance từ `wallet_transactions` posted, so với cache; lệch → báo
cáo, có cờ `--fix`. Chạy định kỳ tay hoặc cron.

## Không cần migration

Mọi học sinh khởi tạo `walletBalance = 0` (mặc định khi field vắng mặt). Ledger, phiếu thu,
hóa đơn, PayOS, dữ liệu rollover lịch sử: không đụng. Hệ mới chỉ mọc thêm lên trên; tắt UI ví
đi thì hệ cũ vẫn chạy nguyên như trước.

## Kiểm thử

Module thuần viết test trước (test-first):

- Máy trạng thái ví: post/void từng type; ví không bao giờ âm; allocation vượt ledgerRemaining
  bị clamp; refund vượt ví bị từ chối.
- Đề xuất cấn trừ: FIFO theo termStart; nhiều proposal chờ không vượt tổng ví; duyệt cả lớp.
- Proration giữa khóa: vào đầu khóa → 100%; giữa khóa → đúng số buổi; khóa không xác định được
  số buổi → không gợi ý (kế toán nhập tay), không bao giờ chia 0 (mẫu `estimateSessionValue`).
- Nợ ròng & chuỗi semester: nhiều khóa, có ví, có miễn giảm; chuỗi bị cắt đúng "…và k khóa khác".
- Idempotency: gửi trùng idempotency key không nhân đôi tiền (mẫu test receipts hiện có).
- Transaction tests: post allocation cập nhật ledger.status đúng công thức dùng chung;
  void receipt nạp ví khi ví đã tiêu một phần bị chặn kèm thông báo.
- Reminder handler: học sinh nợ ròng 0 → 400; template id thiếu → lỗi cấu hình được log.

## Thứ tự triển khai (mỗi bước tự chạy được độc lập)

1. **Lõi ví**: types, `wallet_transactions`, hàm dùng chung cập nhật ledger status, phiếu thu
   nạp ví, void, lịch sử ví trên trang học sinh, firestore.rules, script đối soát.
2. **Đề xuất & duyệt**: proposal khi mở khóa (D4.1-3), credit nghỉ có phép khi chốt khóa
   (D4.4), khối "Chờ duyệt" trên trang kế toán.
3. **Giữa khóa**: hàm đếm buổi dùng chung, hộp thoại chốt công nợ theo tỷ lệ, `prorationBasis`.
4. **Nhắc nợ mới**: endpoint theo học sinh, config template mới, chuỗi semester, preview UI.
5. **Hoàn thiện**: khối học thử, phiếu chi hoàn tiền, chuyển lớp qua ví (D8), báo cáo (D9),
   parent dashboard.

Bước 4 phụ thuộc template ZNS được Zalo duyệt; các bước khác không phụ thuộc ngoài.
