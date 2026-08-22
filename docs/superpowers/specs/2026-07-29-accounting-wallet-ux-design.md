# Thiết kế: Dọn UX ví học sinh và mở profile từ màn hình kế toán

- **Ngày:** 2026-07-29
- **Trạng thái:** Đã duyệt trong trao đổi
- **Phạm vi:** Tab Ví học sinh trong `/tuition`, và tên học sinh trong toàn bộ bảng của vai trò kế toán

## 1. Bối cảnh

Ba vấn đề UX do người dùng báo:

1. **Lịch sử ví nằm dưới đáy trang.** `WalletTab` render lịch sử thành một `<section>` inline đặt sau bảng số dư. Bảng số dư có thể dài hàng trăm dòng, nên bấm "Xem lịch sử" ở dòng đầu xong phải cuộn tới tận cuối trang mới thấy kết quả.
2. **"Cấn công nợ" và "Xem lịch sử" trông như chữ, không như nút.** Hai thao tác này *là* `<button>` nhưng chỉ được style bằng màu chữ, không viền không nền, nên người dùng không nhận ra là bấm được.
3. **Bấm tên học sinh không mở profile.** Ở tất cả bảng của vai trò kế toán (`WalletTab`, `LedgersTab`, `ReceiptsTab`, `PaymentsTab`), tên học sinh là text thuần — bấm không có gì xảy ra. Riêng `StudentFinanceWorkspace` (chỉ hiện khi bật cờ `VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE`) có điều hướng nhưng bằng `window.location.href`, tức reload cả trang, kèm một loạt tham số `from_*` không nơi nào đọc.

Route `/students/:studentId` và endpoint `read/student-admin-report` đều đã cho phép role `accounting`, và `getVisibleStudentProfileTabs` đã trả tab `finance` cho role này. Nghĩa là backend và routing không cần đổi — chỉ thiếu affordance ở phía UI.

## 2. Mục tiêu

- Xem lịch sử ví không phải rời khỏi vị trí đang đứng trong bảng số dư.
- Nhìn là biết chỗ nào bấm được.
- Từ bất kỳ bảng kế toán nào, mở được profile học sinh mà không mất ngữ cảnh danh sách đang lọc.

Không nằm trong phạm vi: đổi dữ liệu trả về của API ví, đổi luồng cấn công nợ, đổi quyền theo vai trò.

## 3. Thiết kế

### 3.1 `WalletHistoryModal`

Component mới `src/pages/accounting/components/WalletHistoryModal.tsx`, bọc `WalletHistoryPanel` đã có trong khung modal theo đúng khuôn của `WalletAllocationModal`:

- `ModalPortal` với `trapFocus` và `lockScroll`; `useBodyScrollLock` đếm theo `lockCount` nên lồng modal vẫn an toàn.
- Nền mờ `fixed inset-0 z-[1000]`, hộp `max-w-6xl` `max-h-[92vh]`, thân modal `overflow-y-auto` để bảng lịch sử tự cuộn trong modal.
- Header: tiêu đề "Lịch sử ví", tên + mã học sinh, số dư ví hiện tại, nút X.
- Đóng bằng: nút X, phím `Escape`, hoặc bấm nền mờ. `Escape` nhường quyền cho hộp thoại con: khi có nhiều hơn một `[role="dialog"][aria-modal="true"]` đang mở, modal lịch sử bỏ qua phím này để không đóng cả hai cùng lúc.
- Nút nền mờ đặt sau hộp thoại trong DOM (nằm dưới nhờ `z-index`) để focus trap dừng ở nút đóng thay vì nền.
- Trạng thái đang tải hiển thị spinner *bên trong* modal, để modal mở ngay khi bấm chứ không chờ API.

`VoidReasonDialog` bên trong `WalletHistoryPanel` giữ nguyên: nó tự portal ra `document.body` và mount sau modal lịch sử, nên với cùng `z-[1000]` nó vẫn nằm trên.

`WalletTab` bỏ khối `<section>` lịch sử inline, thay bằng `<WalletHistoryModal>` render có điều kiện.

### 3.2 Nút thao tác

Trong cột "Thao tác" của bảng ví:

- **Cấn công nợ** — nút chính: nền xanh đặc, chữ trắng, icon `WalletCards`.
- **Xem lịch sử** — nút phụ: viền xám, nền trắng, icon `History`.

Cả hai: `px-3 py-1.5`, `rounded-lg`, `text-sm font-medium`, hover đổi nền, `focus-visible` có ring. Nhãn chữ giữ nguyên để không phá test và thói quen người dùng.

### 3.3 `StudentProfileLink`

Component dùng chung `src/pages/accounting/components/StudentProfileLink.tsx`:

```tsx
<StudentProfileLink studentId={row.id} name={row.name} />
```

- Render `<a href={`/students/${studentId}?tab=finance`} target="_blank" rel="noopener noreferrer">`, chữ xanh, gạch chân khi hover, kèm icon `ExternalLink` nhỏ.
- Hàm dựng URL tách ra `src/pages/accounting/studentProfileHref.ts` (giữ file component chỉ export component, tránh cảnh báo fast-refresh) và nhận thêm tham số tuỳ chọn để giữ deep link theo khóa của workspace.
- Mở tab trình duyệt mới, theo quyết định của người dùng: kế toán thường rà soát nhiều học sinh liên tiếp, không nên mất bộ lọc và vị trí cuộn của danh sách.
- Thiếu `studentId` **hoặc** thiếu tên thì degrade về `<span>` chữ thường: một link mang nhãn "—" vô nghĩa với trình đọc màn hình.
- Vì là thẻ `<a>` thật nên hỗ trợ sẵn Ctrl/Cmd+click, chuột giữa, và điều hướng bàn phím.

Áp dụng tại:

| Chỗ dùng | Ô hiện tại |
| --- | --- |
| `WalletTab` | cột "Họ và tên" |
| `LedgersTab` | tên học sinh trong cột đầu |
| `ReceiptsTab` | cột học sinh |
| `PaymentsTab` | cột học sinh |
| `StudentFinanceWorkspace` | ô tên và nút "Profile" |

Ở `StudentFinanceWorkspace`, `openProfile` bị xoá cùng toàn bộ phần sinh tham số `from_*`: không code nào đọc chúng, và trạng thái danh sách đã được `updateUrl` ghi sẵn vào URL hiện tại qua `history.replaceState`, nên nút Back của trình duyệt vẫn khôi phục đúng bộ lọc.

### 3.4 Nhãn trạng thái giao dịch

Bảng lịch sử in thẳng `row.status` nên kế toán đọc được `posted` / `proposed` / `rejected` bằng tiếng Anh, riêng `void` mới có nhãn tiếng Việt. Thêm bảng nhãn cho cả bốn trạng thái của `WalletTransactionStatus` (`Chờ duyệt`, `Đã chốt`, `Đã từ chối`, `Đã hủy`), giữ nguyên ưu tiên cho `t.financePage.walletTxVoided` ở trạng thái hủy.

## 4. Kiểm thử

Bổ sung vào `WalletTab.test.tsx`:

- Bấm "Xem lịch sử" mở `role="dialog"` tên "Lịch sử ví"; bấm X đóng lại.
- `Escape` đóng modal, nhưng **không** đóng khi hộp thoại hủy đang mở đè lên.
- Tên học sinh render thành link đúng `href` và `target="_blank"`.
- Test hủy nhóm cấn công nợ hiện có phải vẫn xanh, chứng minh `VoidReasonDialog` lồng trong modal vẫn chạy.

Thêm `StudentProfileLink.test.tsx` (href, escape ký tự, hai nhánh degrade) và test link cho `LedgersTab`, `PaymentsTab`, `ReceiptsTab`, `StudentFinanceWorkspace`.

## 5. Rủi ro

- **Modal lồng modal.** Đã kiểm: `useBodyScrollLock` đếm lock, thứ tự portal đảm bảo dialog hủy nằm trên. Test hiện có phủ luồng này.
- **Bảng lịch sử rộng 980px trong modal.** Thân modal cuộn ngang được, giống bảng gốc.
- **Cờ workspace tắt.** `StudentFinanceWorkspace` có thể không hiển thị ở môi trường hiện tại; sửa nó vẫn cần thiết cho môi trường đã bật cờ.
