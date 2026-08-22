# Thiết kế nhắc tổng công nợ theo học sinh

- **Ngày:** 2026-07-31
- **Trạng thái:** Đã duyệt phương án trong trao đổi; chờ người dùng review đặc tả
- **Phạm vi:** Workspace Công nợ, API Zalo `notify-tuition-reminder` và mẫu ZNS thông báo nợ học phí

## 1. Bối cảnh

Trong `StudentFinanceWorkspace`, tên học sinh đã là liên kết mở hồ sơ ở tab mới. Cột thao tác vẫn có
thêm liên kết **Profile**, nên cùng một chức năng xuất hiện hai lần và chiếm chỗ của thao tác
**Nhắc học phí** vốn có ở giao diện công nợ cũ.

Luồng cũ gửi nhắc theo một `ledgerId`. Workspace mới lấy học sinh làm trung tâm và một học sinh có thể
nợ nhiều khóa, nên gửi riêng từng ledger sẽ tạo nhiều tin Zalo cho cùng một phụ huynh và không khớp số
tổng còn thiếu trên dòng học sinh.

Đặc tả này thay thế hai quyết định cũ chỉ trong `StudentFinanceWorkspace`:

- ô tên và nút **Profile** trong đặc tả
  `2026-07-29-accounting-wallet-ux-design.md`;
- nút **Thu tiền** đặt cạnh liên kết **Profile** trong D2 của
  `2026-07-30-student-centric-receipt-collection-design.md`.

Tên học sinh vẫn là liên kết mở hồ sơ. Chỉ liên kết **Profile** dư thừa trong cột thao tác bị bỏ.

## 2. Quyết định UX

Mỗi dòng học sinh có hai thao tác:

1. **Thu tiền** — giữ nguyên luồng Phiếu thu fixed-student hiện có.
2. **Nhắc học phí** — gửi một thông báo tổng hợp cho toàn bộ công nợ còn mở của học sinh.

Quy tắc hiển thị:

- tên học sinh tiếp tục mở `/students/:studentId?tab=finance` trong tab mới;
- không còn liên kết chữ **Profile** trong cột thao tác;
- nút **Nhắc học phí** chỉ bật khi `totalOutstanding > 0`;
- khi đang gửi, nút bị khóa và hiển thị trạng thái tải để chặn gửi lặp;
- một học sinh đang gửi không khóa nút của các học sinh khác;
- gửi thành công hiển thị toast có số lần nhắc mới và làm mới trang Công nợ hiện tại;
- thiếu số điện thoại, không còn nợ hoặc Zalo chưa cấu hình phải trả lỗi rõ ràng, không ghi nhận là đã gửi.

## 3. Hợp đồng API

Client workspace gọi `notify-tuition-reminder` với:

```ts
{
  studentId: string;
}
```

Endpoint tiếp tục chấp nhận `ledgerId` từ giao diện legacy trong thời gian chuyển đổi. Khi nhận
`ledgerId`, server đọc ledger để lấy `studentId`, sau đó vẫn chạy cùng một luồng tổng hợp theo học sinh.
Không còn hai cách tính số tiền hoặc dựng template khác nhau.

Server:

1. xác thực vai trò `admin` hoặc `accounting`;
2. đọc hồ sơ học sinh canonical để lấy tên, mã học viên và số điện thoại;
3. đọc tất cả `course_fee_ledgers` của học sinh;
4. loại ledger `paid`, `waived` hoặc có `ledgerRemaining <= 0`;
5. tính tổng công nợ mở;
6. trừ `students.walletBalance` khả dụng nhưng không cho kết quả âm;
7. từ chối gửi nếu công nợ ròng bằng `0`;
8. dựng một payload ZNS và gửi đúng một tin;
9. sau khi Zalo xác nhận thành công, tăng bộ đếm và đóng dấu lần nhắc trên mọi ledger còn nợ đã tham gia
   phép tính;
10. ghi một log `zalo_notifications` mức học sinh, kèm `ledgerIds`, tổng trước khi trừ ví, số dư ví và
    công nợ ròng;
11. phát invalidation `accounting-student-finance`.

Dedup guard dùng khóa ổn định theo `studentId`, công nợ ròng và tập `ledgerIds`. Nếu số nợ hoặc danh
sách khóa nợ thay đổi thì được phép gửi lại; bấm lặp với cùng snapshot bị chặn.

## 4. Mẫu ZNS mới

Template dùng đúng form **Thông báo nợ học phí** đã được cung cấp:

| Biến | Giá trị |
| --- | --- |
| `<student_name>` | Tên học sinh canonical |
| `<student_code>` | Mã học viên canonical |
| `<amount>` | Công nợ ròng sau khi trừ số dư ví, số nguyên VND dương, không tự nối thêm ký hiệu |
| `<semester>` | Danh sách đầy đủ các khóa còn nợ |
| `<due_date>` | Ngày Việt Nam hiện tại cộng `NEXT_COURSE_TUITION_DUE_DAYS`, định dạng `dd/MM/yyyy` |

`<semester>` phải cho biết rõ từng khóa đang nợ. Mỗi khóa có định dạng:

```text
Khóa dd/MM - dd/MM
```

Ví dụ học sinh nợ hai khóa:

```text
Khóa 27/08 - 09/11, Khóa 22/08 - 09/12
```

Quy tắc dựng chuỗi:

- dùng `termStart` và `termEnd` của chính ledger, không lấy ngày của lớp hiện tại để thay thế;
- ngày luôn có hai chữ số cho ngày và tháng;
- sắp xếp `termStart` mới nhất trước, sau đó theo `ledgerId` để kết quả ổn định;
- không đưa khóa đã thanh toán, được miễn hoặc có số còn lại bằng `0` vào danh sách;
- không gộp hai khoảng ngày khác nhau thành một mục;
- nếu ledger thiếu một trong hai mốc ngày, server từ chối gửi và trả lỗi chỉ rõ ledger chưa đủ kỳ học,
  thay vì gửi một nội dung mơ hồ;
- không cắt thành “và N khóa khác”. Nếu chuỗi vượt giới hạn biến của template Zalo, server từ chối gửi
  với lỗi cấu hình để không che giấu khóa còn nợ.

Nhắc nợ tiếp tục dùng `ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID`, là biến template nhắc nợ đã có trên
Vercel và đã được cập nhật sang form có `semester`. Luồng thông báo học phí khóa tiếp theo vẫn dùng riêng
`ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID` và không bị thay đổi.

## 5. Ranh giới thay đổi

### Frontend

- `StudentFinanceWorkspace` bỏ import và liên kết `buildStudentProfileHref` chỉ dùng cho nút Profile;
  `StudentProfileLink` ở tên học sinh và ở chi tiết khóa vẫn giữ nguyên.
- Props bổ sung callback nhắc nợ theo `AccountingStudentSummary`.
- `Finance` sở hữu trạng thái loading theo `studentId`, gọi Zalo service và xử lý toast/invalidation.
- Không tải full student directory chỉ để gửi nhắc; server chịu trách nhiệm đọc hồ sơ canonical.

### Backend

- Logic gom ledger, tính công nợ ròng và dựng chuỗi khóa nằm trong helper thuần có test riêng.
- Handler chỉ điều phối xác thực, đọc Firestore, gọi Zalo, cập nhật tracking và trả response.
- Thay đổi không sửa transaction Phiếu thu, số dư ví, PayOS, Phiếu chi hoặc báo cáo.

## 6. Xử lý lỗi

- `studentId` và `ledgerId` đều thiếu: `400`.
- Học sinh không tồn tại: `404`.
- Không có số điện thoại hợp lệ: `400`.
- Không có ledger còn nợ hoặc ví đã bù hết nợ: `400`.
- Ledger nợ thiếu `termStart`/`termEnd`: `400`, không gửi.
- Thiếu `ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID`: `503`, không gửi.
- Zalo thất bại: không tăng bộ đếm ledger và không ghi dedup success.
- Ghi tracking sau gửi phải theo cơ chế hiện có; lỗi tracking được log/audit và không làm client gửi lại
  một tin Zalo đã thành công.

## 7. Kiểm thử

### Component

- tên học sinh vẫn là link hồ sơ;
- không còn link **Profile** trong cột thao tác;
- có nút **Thu tiền** và **Nhắc học phí**;
- nút nhắc bị khóa khi không còn nợ hoặc đang gửi;
- click truyền đúng summary row và chỉ khóa đúng học sinh đang gửi.

### Helper/API

- một ledger nợ tạo một mục `Khóa dd/MM - dd/MM`;
- hai ledger nợ tạo đúng chuỗi
  `Khóa 27/08 - 09/11, Khóa 22/08 - 09/12`;
- ledger paid/waived/remaining `0` bị loại;
- tổng tiền trừ số dư ví và không âm;
- thiếu kỳ học bị từ chối;
- payload dùng đủ `student_name`, `student_code`, `amount`, `semester`, `due_date`;
- gửi thành công cập nhật mọi ledger tham gia và log đủ `ledgerIds`;
- Zalo thất bại không cập nhật bộ đếm;
- payload legacy `ledgerId` được quy về cùng luồng tổng hợp theo học sinh;
- quyền ngoài `admin`/`accounting` bị từ chối.

### Regression

- nút Thu tiền và link hồ sơ vẫn hoạt động;
- nhắc học phí từ `LedgersTab` không bị mất trong thời gian legacy còn tồn tại;
- test Zalo, workspace, typecheck và production build đạt.

## 8. Tiêu chí hoàn thành

1. Cột thao tác của mỗi học sinh hiển thị **Thu tiền** và **Nhắc học phí**, không hiển thị **Profile**.
2. Bấm tên học sinh vẫn mở đúng hồ sơ tài chính.
3. Một lần bấm nhắc gửi đúng một tin cho tổng công nợ ròng của học sinh.
4. `<semester>` liệt kê đầy đủ, rõ ràng mọi khóa còn nợ theo dạng
   `Khóa dd/MM - dd/MM`, phân cách bằng dấu phẩy.
5. Không gửi nhắc khi hết nợ, thiếu số điện thoại, thiếu kỳ học hoặc thiếu template.
6. Chỉ sau khi Zalo gửi thành công mới cập nhật bộ đếm, dedup và tracking.
