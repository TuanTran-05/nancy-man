# Báo cáo trước khi xóa & tạo lại học phí

**Ngày:** 2026-08-10
**Project:** `gen-lang-client-0014842483`
**Database:** `ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a`
**Trạng thái:** CHỈ ĐỌC — chưa ghi/xóa bất cứ thứ gì trên Firestore.

---

## 0. Về database id

Anh nói database đuôi `41a`. Project này chỉ có 3 database, **không có cái nào đuôi `41a`**:

| Database | Ai dùng |
|---|---|
| `ai-studio-265b67cd-…-f381ac797291` | không nơi nào trong repo tham chiếu |
| **`ai-studio-4bd76afc-…-f17f1cfeb31a`** | **app + toàn bộ 50+ script migration trước đây** |
| `tuantran05xnancy` | không nơi nào trong repo tham chiếu |

→ Đã chốt làm việc trên `…b31a` (tin nhắn đầu tiên của anh đúng).

---

## 1. Backup đã có trên đĩa

`backups/finance-rebuild-2026-08-10T13-20-31-397Z/`

Bản sao nguyên văn từng document, 1 file / 1 collection:

| Collection | Số doc |
|---|---|
| course_fee_ledgers | 657 |
| receipts | 206 |
| wallet_transactions | 415 |
| accounting_student_summaries | 762 |
| students | 754 |
| classes | 53 |
| student_course_enrollments | 720 |
| invoices | 0 |
| payment_requests | 0 |

---

## 2. Tiền hiện tại — đối chiếu khớp tuyệt đối

| Khoản | Số tiền (₫) |
|---|---|
| Tổng đã lên hóa đơn (billed) | 831.700.000 |
| Đã thu (posted receipts) | 260.690.000 |
| — trong đó đã gán vào ledger | 255.952.497 |
| — còn treo ở ví học sinh | 4.737.503 |
| Công nợ còn lại | 575.747.503 |

Kiểm tra toàn vẹn — **tất cả đều sạch**:

- `paidTotal` của **từng** ledger khớp chính xác tổng receipt đã posted → sai lệch: **0**
- Receipt trỏ vào ledger không tồn tại: **0**
- Receipt posted chưa gán tiền: **0**
- Ledger không có enrollment tương ứng: **0**
- `invoices` / `payment_requests`: **rỗng** → không có giao dịch online đang treo
- 260.690.000 − 255.952.497 = 4.737.503 = đúng bằng tổng số dư ví của 12 học sinh ✓

**204 học sinh đã đóng tiền.** Không có ai bị chia tiền giữa 2 bản ghi trùng mã (kiểm tra 58 mã trùng: **0** mã có tiền ở cả hai bên). Không có ai giữ tiền mà rebuild không với tới được.

---

## 3. ⚠️ Điều nguy hiểm nhất — xin quyết định của anh

Nút "Tạo công nợ" (`courseLedgerPlanner.ts:86`) **chỉ tạo ledger cho enrollment đang mở** (`active` / `on_leave`).

- 615 active + 29 on_leave = **644** → rebuild tạo lại đúng 644 ledger, 812.800.000 ₫
- 66 completed + 4 dropped + 6 transferred → **không tạo lại gì cả**

Nghĩa là nếu xóa sạch rồi tạo lại:

| | Ledger | Tiền (₫) |
|---|---|---|
| Hiện có | 657 | 831.700.000 billed |
| Được tạo lại | 644 | 812.800.000 billed |
| **Không được tạo lại** | **113** | **142.900.000 billed** |
| → trong đó **đang giữ tiền học sinh đã đóng thật** | **36** | **45.670.000** |

**45.670.000 ₫ của 36 học sinh đã đóng cho các khóa đã kết thúc sẽ không còn chỗ để ghi lại.**

Ví dụ lớp `G11 - Ms.Hương CN T2` (khóa 2026-07-11 → 2026-08-30, đã completed): Quách Văn Hóa, Vũ Duy Hoàng, Phạm Anh Duy, Phạm Thành Danh, Nguyễn Chí Khang… mỗi em 1.400.000 ₫ đã đóng đủ.

Danh sách đầy đủ 36 dòng: `scratch/finance-rebuild-stranded.json`

### Ba lựa chọn

**A. Giữ lịch sử (khuyến nghị)** — chỉ xóa & tạo lại ledger của khóa đang học; giữ nguyên 113 ledger của khóa đã kết thúc. Công nợ hiện tại sạch, lịch sử đã đóng còn nguyên.

**B. Xóa sạch rồi dựng lại cả lịch sử** — xóa hết, tạo 644 ledger mới, sau đó dựng lại 113 ledger cũ từ backup và replay toàn bộ payment. Kết quả giống A nhưng nhiều bước rủi ro hơn.

**C. Xóa sạch, chấp nhận mất lịch sử** — đúng nguyên văn yêu cầu ban đầu. Công nợ sạch tinh, nhưng 45.670.000 ₫ của 36 em biến mất khỏi hệ thống (chỉ còn trong file backup).

---

## 4. Hai việc bắt buộc phải làm dù chọn phương án nào

1. **Ví học sinh:** 4.737.503 ₫ số dư của 12 em (Nguyễn Quy Quyền 875.000; Ngô Nguyễn Na Uy, Cao Nguyễn Quỳnh Như, Nguyễn Lê Thảo Quyên mỗi em 787.500; Thanh Thuỷ 700.000; …) phải được tạo lại, nếu không các em mất tiền đã nạp.

2. **2 học sinh mất hồ sơ:** `YVfEWfDxz1QgHbkexGpH` và `42DjKQ0LRk4UQvmlC4rp`, mỗi em đã đóng 1.100.000 ₫ (tổng 2.200.000 ₫), có receipt và ledger nhưng **document trong `students` đã bị xóa** (hệ quả của đợt xóa tay 2026-08-10). Rebuild vẫn với tới được qua enrollment, nhưng tên sẽ hiển thị trống.

---

## 5. Kế hoạch thực thi khi anh duyệt

1. Chạy lại backup ngay trước khi xóa (dữ liệu có thể đã đổi).
2. Xóa theo phạm vi anh chọn — ghi manifest verbatim **trước** khi xóa.
3. Chạy "Tạo công nợ" qua đúng `planClassLedgers` production.
4. Replay payment: ledger id sinh ra là **tất định** (`studentId_classId_termStart_termEnd`) và **0 trùng lặp**, nên gán lại tiền chính xác 1-1.
5. Dựng lại `accounting_student_summaries`.
6. Đối chiếu sau khi xong: tổng thu phải vẫn đúng 260.690.000 ₫, ví vẫn 4.737.503 ₫.

Mọi script chạy **dry-run trước**, in ra số liệu để anh duyệt, rồi mới `--apply`.
