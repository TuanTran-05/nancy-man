# Chuẩn hoá dữ liệu trước khi nạp

- **Ngày:** 2026-08-19
- **Mốc chuẩn:** 2026-08-15
- **Kết quả:** diễn tập nạp toàn bộ 54 collection của production — **0 hàng bị bỏ**

Quyết định nằm ở [`decisions.json`](decisions.json), không giấu trong code.
[`../preflight/03-verify-decisions.mjs`](../preflight/03-verify-decisions.mjs)
kiểm lại từng khẳng định trong đó với Firestore, nên file không thể mục đi âm thầm.

## Quy tắc

1. Hồ sơ học sinh nào còn **đủ chứng cứ (tên + mã + lớp)** thì dựng lại; không đủ thì bỏ.
2. **Tiền đã thu luôn giữ** — biên lai và giao dịch ví là chứng từ thật.
3. Dữ liệu **sai** trước mốc 2026-08-15 thì xoá, không cố cứu.
4. **Không bịa.** Mọi trường trong `decisions.json` đều trỏ ngược về một bản ghi có thật.

Áp quy tắc 1 xong thì hoá ra **cả 6 hồ sơ đều đủ chứng cứ** — nên quy tắc 3 gần
như không phải dùng tới. Chỗ tưởng mất tiền cũng không mất.

---

## 1. Sáu hồ sơ dựng lại từ `audit_logs`

Đợt xoá tay 2026-08-10 làm 6 hồ sơ biến mất khỏi `students` nhưng để lại 68 bản
ghi trỏ tới chúng. `audit_logs` giữ đủ tên và mã cho cả 6.

| id | mã | tên | lớp | tiền dính vào |
|---|---|---|---|---|
| `42DjKQ0LRk4UQvmlC4rp` | HS260321 | MAI THỊ THIÊN KIM | Superkids - Huynh Le T3-T5 | biên lai 1.100.000 **đã thu** |
| `YVfEWfDxz1QgHbkexGpH` | HS260322 | CHẾ TRẦN AN NHIÊN | Superkids - Huynh Le T3-T5 | biên lai 1.100.000 **đã thu** |
| `5g9pL8su6oTJPP8b9aPu` | HS260068 | NGUYỄN ĐOÀN TUẤN TÚ | G6-CS2 | ledger 1.200.000 chưa trả |
| `TATENjEGwtbCbLNz4anV` | HS260808 | NGUYÊN NGỌC BÍCH | G4 - Ms. Hằng - T7CN | ledger 1.200.000 chưa trả |
| `ro186kHKX03bxIHGv7z9` | HS260787 | CAO HOÀNG THÙY CHI | G12 - Ms.Hương | ledger 1.400.000 chưa trả |
| `n9EQvOrdDgwy72WXbdTe` | G6-01 | QUÁCH HOÀNG MINH | G6 | không đồng nào |

Cả 6 nạp với `student_lifecycle = 'archived'` và `is_revoked = true`: lịch sử và
chứng từ được giữ, nhưng họ không xuất hiện như học sinh đang học.

**Đã kiểm:** 6/6 mã chưa ai dùng, 6/6 lớp còn tồn tại, 6/6 có dấu vết trong `audit_logs`.

Vài chỗ đáng nói:

- `YVfEWfDxz1QgHbkexGpH` có hai giá trị `dob` trong audit (`2019-09-05` rồi sửa
  thành `2019-05-09`). Lấy bản **sau**.
- `5g9pL8su6oTJPP8b9aPu` không có `studentCode` trong audit; mã HS260068 lấy từ
  `course_closing_records` — nơi cũng ghi tên và lớp khớp.
- `n9EQvOrdDgwy72WXbdTe` mang mã **`G6-01`** theo hệ cũ, không phải `HSxxxxxx`.
  Giữ nguyên thay vì bịa một mã HS mới. Đây là hồ sơ duy nhất không dính đồng
  nào và toàn bộ hoạt động nằm trước mốc (2026-03-13 … 2026-07-08) — theo quy
  tắc 3 thì bỏ cũng được, nhưng chứng cứ đủ nên giữ: dựng lại thì hoàn tác được,
  xoá 32 điểm danh + 2 đánh giá + 3 bài nộp thì không.

## 2. Hai hồ sơ lưu trữ được giữ

`HfwmG7tjVQT02J9XJvFZ` (BẢO NGÂN, HS260267) và `gNorxvFV0e6i8j5ehfWP`
(ĐỖ THỊ PHƯƠNG NGÂN, HS260779) có `deletedAt` nhưng **không** merge vào ai —
nhân viên lưu trữ chúng, không phải trùng lặp. Mỗi hồ sơ còn nằm cuối một tham
chiếu thật. Nạp với `archived` + `is_revoked`.

## 3. Năm mươi tám vỏ hồ sơ đã gộp — bỏ

58 hồ sơ có `mergedIntoStudentId`. Đã kiểm **58/58**: đích đến còn sống và mang
**cùng mã học sinh**. Chúng chính là thứ tạo ra 58 mã trùng. Bỏ đi thì
`UNIQUE (code_normalized)` đi qua sạch và **không mất danh tính nào** — người
thật vẫn ở đó dưới id chuẩn.

## 4. Khoản 200.000đ — không mất

Ban đầu tôi báo đây là tiền không có chứng từ. **Sai.** Chứng từ có thật:

```
08/08 12:14  PT-260808-133  nhận 1.400.000  → nạp ví 1.400.000, gán ledger 1.200.000
08/09 11:30  PT-260809-014  nhận 1.200.000  → nạp ví 1.200.000, gán ledger 1.200.000
08/10 14:10  wallet_transaction: allocation 200.000
             "Gán nốt số dư ví còn lại của phiếu PT-260808-133 vào học phí"
```

Cộng lại: nạp 2.600.000 − gán 2.600.000 = **0**. Cột `students.walletBalance`
ghi 200.000 vì **không được cập nhật** sau giao dịch ngày 10/8.

Dòng allocation thứ hai trên biên lai `PT-260808-133` (200.000, cùng ledger với
dòng 1.200.000) chính là bản ghi của lần gán đó. `UNIQUE (receipt_id, ledger_id)`
gộp hai dòng thành một dòng 1.400.000 — ledger vẫn trả đủ 1.400.000, không đổi
một đồng nào.

Đây là minh hoạ đúng cho lý do bỏ cột số dư: **view tính ra 0, và 0 mới đúng.**

## 5. Ba hàng bỏ, một giá trị sửa

| | |
|---|---|
| `class_sessions/5WiJgcjDQSnpQbXfs3j4` | Trùng ngày với `Z8oeO9IN5H3lsV6IOAoH_2026-05-13`. Giữ bản có điểm danh giáo viên đầy đủ; bản bỏ không có trường `teacherAttendance*` nào. Cùng lớp, cùng giáo viên, cùng mức lương buổi. |
| `users/loadtest-student-001` | `role='student'` không có `studentId`. Tài khoản sinh cho loadtest. |
| `zalo_bulk_job_items` × 22 | Trỏ tới hai job đã bị xoá (`axo26waYNpA3MM9QUhIj`, `EplhA0TXgXp5amEn7olc`). Chỉ là hàng nối; bản ghi gửi thật vẫn nằm trong `zalo_notifications` — cả 22 đều `sent`, ngày 2026-08-03. Trước mốc. |
| `classes/2GIu9f1T94IoMFu7F6Ye.startTime` | `"18:00"` → `"18:00:00"`, cho khớp 53 lớp còn lại. |

## 5b. Một kỳ học dựng lại từ bản ghi kết khoá

Lớp `RI6vRY14dJtwLSpdy1Bc` bị reset sang khoá mới mà không đẩy khoá cũ vào
`terms[]`. Khoá cũ (2026-06-27 … 2026-08-16) chỉ còn sống trong `courseClosing`
của chính lớp — và có ledger trỏ tới nó. Bộ nạp dựng lại kỳ đó với
`repair_source = 'derived_from_course_closing'`.

Chính ca này làm lộ ra ràng buộc `EXCLUDE` sai (xem mục 7).

## 5c. Hai kỳ học dựng lại từ ghi danh và ledger

Phát hiện muộn nhất, và là phát hiện của **bước kiểm chứng file dữ liệu**
(`05-verify-dump.mjs`) chứ không phải của bước nạp — bước nạp không thấy gì sai vì
`student_course_enrollments.term_id` cho phép NULL.

Hai lớp có `terms[]` **rỗng** và `courseClosing` **null**, tức bản ghi lớp chỉ mô
tả đúng một kỳ. Nhưng ghi danh và ledger của chúng trỏ tới một kỳ khác hẳn — và
tiền nằm ở kỳ đó:

| lớp | kỳ bản ghi lớp mô tả | kỳ mà ghi danh + ledger nhớ | ghi danh | ledger | đã thu |
|---|---|---|---|---|---|
| G8 - Ms. Hằng - T3T5 | 2026-08-06 → 09-29 | **2026-08-11 → 10-01** | 14 | 14 | 3.900.000 |
| G4 - Ms. Hằng - T7CN | 2026-08-09 → 10-03 | **2026-06-14 → 08-08** | 12 | 12 | 3.550.000 |

Bỏ qua thì `class_terms` thiếu hẳn một kỳ **có tiền**, mọi màn hình liệt kê "các
kỳ của lớp" sẽ không thấy nó, và 26 ghi danh phải chịu `term_id` NULL vĩnh viễn.

**Dựng lại**, vì nhân chứng không mâu thuẫn ở bất kỳ điểm nào:

- cả 26 ghi danh và 26 ledger đều ghi **cùng một** `termStart`/`termEnd` — không
  có hàng nào khác;
- mọi ledger của mỗi kỳ đều cùng một học phí (1.300.000 và 1.200.000), nên
  `tuition_fee` lấy được từ chứng từ chứ không phải đoán;
- **0 học sinh nằm ở cả hai kỳ** của cùng một lớp. Đây là căn cứ để nói đây là
  hai lớp học sinh khác nhau, không phải bản sao của cùng một kỳ.

`course_id` để NULL: không nhân chứng nào còn giữ `courseId` của kỳ đã mất, và
mượn `currentCourseId` của kỳ hiện tại thì là bịa.

Đánh dấu bằng `class_terms.repair_source = 'derived_from_enrollments'`, nên lúc
nào cũng tra ngược được kỳ nào là dựng lại chứ không phải gốc.

---

## 6. Ba cache không nạp

| Trường | Vì sao |
|---|---|
| `students.walletBalance` | Mục 4. Thay bằng `v_student_wallet_balance`. |
| `classes.studentCounts` | 4 lớp đang có bộ đếm **âm** (thấp nhất −16). Thay bằng `v_class_student_counts`. |
| `course_fee_ledgers.paidTotal` / `discountTotal` / `siblingDiscountTotal` | Thay bằng `v_ledger_totals`. Đã đối chiếu: 739/739 khớp, lệch 0đ. |

---

## 7. Hai lỗi schema mà bước nạp đầy đủ tìm ra

Diễn tập 14 bảng cốt lõi không phát hiện được hai cái này; chỉ khi nạp nốt 40
collection còn lại chúng mới lộ. Cả hai đã sửa thẳng vào `0003` và `0004` —
migration chưa chạy ở đâu nên không cần file vá.

| Migration | Bỏ | Vì sao |
|---|---|---|
| `0003_academic.sql` | `EXCLUDE class_terms_no_overlap` | Lớp `RI6vRY14dJtwLSpdy1Bc` có khoá cũ kết thúc 16/8 và khoá mới bắt đầu 15/8 — chồng 2 ngày, là chuyển khoá bình thường. Bất biến "kỳ không bao giờ chồng" không đúng với dữ liệu thật. |
| `0004_assignments.sql` | `UNIQUE submission_attempt_key` | `attemptNumber` không được ứng dụng cấp tăng dần đáng tin: một học sinh có `[1,1,3,3,3]`; 4/26 bài nộp trùng bộ ba. |

Ngoài ra, bước nạp xác nhận **một ràng buộc thứ tự** phải ghi vào tài liệu:
`assignment_questions` và `assignment_question_options` bắt buộc nằm trong **cùng
một transaction**, vì khoá ngoại ghép `(id, correct_answer) → options(question_id,
option_key)` là `DEFERRABLE INITIALLY DEFERRED` — nó hoãn kiểm tới cuối
transaction, không lâu hơn. Chèn từng hàng ở chế độ autocommit thì mọi câu hỏi
đều bị từ chối.

---

## Chạy lại

```bash
cd db/preflight
npm install
node 03-verify-decisions.mjs "<đường-dẫn-repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a
node 02-dry-run-load.mjs    "<đường-dẫn-repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a ../migrations --emit ../data.sql
node --max-old-space-size=4096 05-verify-dump.mjs ../migrations ../data.sql
```

`03` phải kết thúc bằng `TAT CA KHANG DINH CON DUNG`.
`02` phải kết thúc bằng `HANG BI BO QUA: 0`.
`05` phải kết thúc bằng `TAT CA QUA`.

Nếu `03` báo sai ở đâu, dữ liệu production đã đổi kể từ 2026-08-19 — sửa
`decisions.json` trước, đừng nạp.
