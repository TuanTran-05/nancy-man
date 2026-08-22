# Thiết kế báo cáo quỹ theo ngày cho vai trò Kế toán

Ngày: 2026-08-05
Trạng thái: Đã được duyệt ở mức định hướng

## 1. Mục tiêu

Mở rộng tab **Báo cáo quỹ** tại `/tuition?tab=report` để Kế toán có thể:

- Chọn một khoảng ngày bất kỳ và xem tổng thu, tổng chi, số dư.
- Chuyển giữa bảng tổng hợp theo ngày và bảng tổng hợp theo tháng.
- Mở chi tiết thu hoặc chi của toàn bộ khoảng báo cáo đã tải.
- Mở chi tiết thu hoặc chi của riêng một ngày trong bảng theo ngày.
- Xem cùng mức chi tiết giao dịch mà Admin đang có: chứng từ, học viên, lớp, phương thức thanh toán, số dư ví, phần tiền giữ trong ví, các khoản phân bổ và hoàn ví.

## 2. Hiện trạng

Luồng Kế toán hiện dùng:

- `src/pages/accounting/Finance.tsx` để giữ bộ lọc và tải báo cáo.
- `src/pages/accounting/components/ReportTab.tsx` để hiển thị báo cáo.
- `GET /api/v1/finance/report?startDate&endDate` để lấy tổng hợp khoảng ngày.
- `FinanceTransactionDetailsModal` dùng chung với Admin để hiển thị chi tiết.

Các giới hạn hiện tại:

- API báo cáo chỉ trả `monthlyBreakdown`, chưa có phân rã từng ngày.
- Modal chi tiết chỉ được bật nếu khoảng báo cáo là đúng một tháng trọn vẹn.
- API `center-report-details` chỉ nhận `month` và luôn truy vấn từ ngày đầu đến ngày cuối tháng.

## 3. Phạm vi

### Trong phạm vi

- Tổng hợp theo ngày cho báo cáo Kế toán.
- Drill-down thu/chi theo một ngày hoặc một khoảng ngày.
- Giữ nguyên báo cáo Admin và hợp đồng API theo tháng hiện tại.
- Dùng lại bảng và modal chi tiết giao dịch hiện có.
- Kiểm tra quyền cho cả `admin` và `accounting` ở backend.

### Ngoài phạm vi

- Thay thế tab Ví hoặc lịch sử ví theo từng học viên.
- Thêm loại giao dịch tài chính mới.
- Thay đổi cách tính tổng thu, tổng chi, tiền chưa phân bổ hoặc hoàn ví.
- Xây dựng aggregate theo ngày lưu sẵn trong Firestore ở phiên bản đầu.
- Xuất Excel/PDF.

## 4. Thiết kế trải nghiệm

### 4.1 Bộ lọc

Giữ các bộ lọc nhanh hiện có và hai trường `Từ ngày` / `Đến ngày`. Khi người dùng thay đổi ngày nhưng chưa bấm **Tải báo cáo**, các hành động mở chi tiết phải bị vô hiệu hóa để không hiển thị dữ liệu của khoảng cũ.

### 4.2 Thẻ tổng quan

Ba thẻ tiếp tục hiển thị:

- Tổng thu
- Tổng chi
- Số dư

Khi báo cáo hiện tại khớp với bộ lọc:

- Bấm **Tổng thu** mở tất cả giao dịch thu trong khoảng đã tải.
- Bấm **Tổng chi** mở tất cả giao dịch chi trong khoảng đã tải.
- Số dư không mở modal vì không phải một tập giao dịch độc lập.

### 4.3 Chuyển đổi độ chi tiết

Thêm điều khiển hai trạng thái:

- **Theo ngày** — mặc định.
- **Theo tháng** — giữ bảng hiện tại.

Bảng theo ngày có các cột:

| Cột | Hành vi |
|---|---|
| Ngày | Hiển thị ngày theo ngôn ngữ hiện tại |
| Thu | Bấm vào số tiền lớn hơn 0 để mở chi tiết thu của ngày |
| Chi | Bấm vào số tiền lớn hơn 0 để mở chi tiết chi của ngày |
| Số dư | Thu trừ chi của ngày |

Ngày không có thu hoặc chi không tạo nút drill-down cho ô tương ứng. Chỉ hiển thị những ngày có ít nhất một giao dịch đã ghi sổ.

### 4.4 Modal chi tiết

`FinanceTransactionDetailsModal` được tổng quát hóa để nhận một kỳ báo cáo thay vì chỉ nhận tháng:

- Một ngày: hiển thị ngày đó.
- Nhiều ngày: hiển thị `từ ngày – đến ngày`.
- Admin: tiếp tục truyền tháng; component chuyển tháng thành ngày đầu và ngày cuối tháng.

Modal tiếp tục phân trang 25 giao dịch và dùng lại:

- `IncomeTransactionDetails`
- `ExpenseTransactionDetails`

## 5. Hợp đồng dữ liệu

### 5.1 Báo cáo tổng hợp

Mở rộng request hiện có:

```http
GET /api/v1/finance/report?startDate=2026-08-01&endDate=2026-08-31&includeDaily=1
```

Khi `includeDaily=1`, response bổ sung:

```ts
type DailyFinanceBreakdown = {
  date: string;       // YYYY-MM-DD
  income: number;
  expenses: number;
  balance: number;
};

type FinanceReport = {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  dailyBreakdown?: DailyFinanceBreakdown[];
  monthlyBreakdown: MonthlyFinanceBreakdown[];
  incomeByLevel?: LevelBreakdown[];
  expensesByCategory?: CategoryBreakdown[];
  source?: 'live' | 'aggregate';
};
```

`includeDaily=1` dùng dữ liệu live vì aggregate tháng hiện tại không giữ số liệu từng ngày. Giới hạn số chứng từ hiện có vẫn được áp dụng; khoảng quá lớn trả lỗi `report_too_large`.

Các consumer không gửi `includeDaily=1` vẫn nhận hành vi cũ, có thể không nhận trường
`dailyBreakdown`, và không bị buộc tải dữ liệu chi tiết theo ngày. Giao diện Kế toán xử lý trường
này bằng mảng rỗng nếu response không có dữ liệu ngày.

### 5.2 Chi tiết giao dịch

Giữ endpoint `center-report-details` để tránh tạo một luồng chi tiết thứ hai. Request hỗ trợ một trong hai scope:

```ts
type FinanceDetailsScope =
  | { month: string; startDate?: never; endDate?: never }
  | { month?: never; startDate: string; endDate: string };
```

Ví dụ theo ngày:

```http
GET /api/v1/finance/center-report-details?startDate=2026-08-05&endDate=2026-08-05&type=income&pageSize=25
```

Ví dụ theo khoảng:

```http
GET /api/v1/finance/center-report-details?startDate=2026-08-01&endDate=2026-08-15&type=expense&pageSize=25
```

Quy tắc tương thích:

- Request chỉ có `month` hoạt động như hiện tại.
- Request theo khoảng phải có cả `startDate` và `endDate`.
- Không chấp nhận đồng thời `month` và khoảng ngày.
- Khoảng ngày tính cả hai đầu.
- `startDate` phải nhỏ hơn hoặc bằng `endDate`.

Response luôn chứa `period: { startDate, endDate }`. Trường `month` được giữ cho request theo tháng để không phá vỡ Admin và các test hiện có.

## 6. Backend

### 6.1 Tổng hợp theo ngày

`aggregateFinanceReport` xây thêm `dailyMap` từ cùng tập receipts và expenses đang dùng cho tổng tháng:

- Thu dùng `receivedDate.slice(0, 10)`.
- Chi dùng `paidDate.slice(0, 10)`.
- Chỉ tính chứng từ đã ghi sổ vì repository hiện đã đảm bảo điều kiện này.
- Ví nạp nhưng chưa phân bổ vẫn là cash-in đúng một lần.
- Hoàn ví vẫn là cash-out đúng một lần.

Kết quả được sắp xếp tăng dần theo chuỗi ngày ISO.

### 6.2 Truy vấn chi tiết theo kỳ

Tổng quát hóa `buildCenterFinanceReportDetails` để nhận `period` đã được kiểm tra. Nhánh thu và chi tiếp tục dùng repository hiện có với `startDate/endDate`, do đó không cần tải toàn bộ giao dịch về frontend.

Cursor phân trang phải gắn với:

- Loại giao dịch.
- Ngày bắt đầu.
- Ngày kết thúc.
- Ngày và ID của dòng cuối.

Cursor của kỳ khác hoặc loại giao dịch khác bị trả `invalid_cursor`.

### 6.3 Quyền và kiểm tra đầu vào

- Chỉ `admin` và `accounting` được gọi báo cáo và chi tiết.
- Ngày phải đúng định dạng `YYYY-MM-DD` và là ngày lịch hợp lệ.
- Khoảng đảo ngược hoặc scope mơ hồ trả `400` với mã lỗi rõ ràng.
- `pageSize` tiếp tục bị giới hạn từ 1 đến 100.

## 7. Frontend

### 7.1 API client

- `fetchFinanceReport` nhận tùy chọn `includeDaily`.
- `fetchCenterFinanceReportDetails` nhận discriminated union theo tháng hoặc khoảng ngày.
- Các type dùng chung được mở rộng nhưng giữ tương thích với Admin.

### 7.2 Trạng thái ReportTab

`ReportTab` giữ:

- `breakdownMode: 'day' | 'month'`, mặc định `day`.
- `detailScope`, chứa scope toàn khoảng hoặc một ngày.
- `detailType: 'income' | 'expense'`.

Top-level `Finance` tiếp tục giữ `reportRange`. `handleLoadReport` gọi API với `includeDaily: true`.

### 7.3 Đồng bộ dữ liệu

Modal chỉ mở khi `reportRange` khớp chính xác với `reportFrom/reportTo`. `expectedTotal` được lấy như sau:

- Drill-down toàn khoảng: `report.totalIncome` hoặc `report.totalExpenses`.
- Drill-down một ngày: `dailyRow.income` hoặc `dailyRow.expenses`.

Nếu tổng từ endpoint chi tiết khác `expectedTotal`, gọi lại báo cáo với `forceLive: true` và giữ cách bảo vệ chống refresh lặp hiện có.

## 8. Lỗi và trạng thái rỗng

- Đang tải: vô hiệu hóa nút tải và hiển thị spinner.
- Không có dữ liệu: giữ thẻ tổng bằng 0 và hiển thị trạng thái rỗng cho bảng.
- Khoảng quá lớn: hiển thị thông báo yêu cầu thu hẹp khoảng ngày.
- Chi tiết tải lỗi: giữ nút thử lại trong modal.
- Bộ lọc đã thay đổi: hiển thị hướng dẫn tải lại và vô hiệu hóa drill-down.
- Phân trang hết dữ liệu: vô hiệu hóa nút trang kế tiếp.

## 9. Kiểm thử

### Backend

- Tổng hợp receipts và expenses thành đúng từng ngày.
- Ngày chỉ có thu, chỉ có chi và có cả hai.
- Ví nạp chưa phân bổ và hoàn ví không bị đếm hai lần.
- Khoảng ngày tính cả ngày đầu và ngày cuối.
- Ngày nhuận và cuối tháng.
- Từ chối ngày sai, khoảng đảo ngược và scope mơ hồ.
- Cursor không thể dùng lại cho kỳ hoặc loại giao dịch khác.
- Admin và Kế toán được phép; vai trò khác bị từ chối.
- Request theo `month` của Admin vẫn hoạt động.

### Frontend

- Mặc định hiển thị bảng theo ngày và chuyển được sang theo tháng.
- Bấm Tổng thu/Tổng chi mở chi tiết toàn khoảng.
- Bấm ô thu/chi của ngày mở đúng ngày và đúng loại.
- Ô bằng 0 không tương tác.
- Sửa bộ lọc nhưng chưa tải lại sẽ khóa drill-down.
- Tổng chi tiết lệch sẽ yêu cầu refresh live đúng một lần.
- Báo cáo Admin và modal theo tháng không hồi quy.

## 10. Tiêu chí chấp nhận

1. Kế toán chọn một khoảng hợp lệ và tải được báo cáo.
2. Báo cáo hiển thị tổng và phân rã từng ngày chính xác.
3. Người dùng chuyển được giữa bảng ngày và bảng tháng.
4. Tổng thu/Tổng chi mở đúng giao dịch của toàn khoảng đã tải.
5. Thu/chi của một ngày mở đúng giao dịch của ngày đó.
6. Chi tiết thể hiện đầy đủ dữ liệu ví và phân bổ như giao diện Admin.
7. Phân trang, thử lại, trạng thái rỗng và dữ liệu stale hoạt động đúng.
8. Giao diện Admin hiện tại không thay đổi hành vi.
9. Toàn bộ test mới và test hồi quy liên quan đều đạt.
