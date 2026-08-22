# Session-based End Date & Class-level Holidays

## Summary

Thay đổi cơ chế gợi ý endDate từ "tuần" sang "buổi học". Thêm tính năng giáo viên set ngày nghỉ cho lớp, tự động kéo dài endDate khi ngày nghỉ trùng lịch học.

## Current State

- End date tính theo tuần: `startDate + (weeks * 7)`, 12 tuần cho lớp 1-2, 8 tuần cho lớp 3+
- Holidays chỉ ở cấp hệ thống (`system_settings/holidays`), admin quản lý
- Holidays dùng để bỏ qua ngày khi đếm session nhưng KHÔNG tự động kéo dài endDate
- Logic nằm ở 3 chỗ: `Classes.tsx:284`, `ResetCourseModal.tsx:32`, `api/zalo/[action].ts:186`

## Requirements

1. Đổi từ tuần → buổi: 16 buổi cho tất cả lớp
2. Tính cả ngày nghỉ hệ thống khi gợi ý endDate ban đầu
3. Giáo viên set ngày nghỉ cho lớp với chọn phạm vi (1 lớp hoặc tất cả lớp cùng ngày trong tuần)
4. Tự động kéo dài endDate + toast notification khi thêm ngày nghỉ

## Approach: Hybrid (Approach C)

Frontend tính suggested endDate (instant feedback), backend validate khi save.

---

## Section 1: Core Calculation Logic

### Session-based end date calculation

Thay vì `startDate + weeks * 7`, hệ thống đếm số buổi học thực tế:

```
calculateEndDate(startDate, requiredSessions, daysOfWeek, holidays):
  current = startDate
  sessionCount = 0
  while sessionCount < requiredSessions:
    if current.getDay() in daysOfWeek AND current not in holidays:
      sessionCount++
    current += 1 day
  return current - 1  // ngày cuối cùng là ngày học
```

### Required sessions theo grade

| Grade | Required sessions |
| ----- | ----------------- |
| 1-12  | 16                |

### Nơi cần thay đổi (dùng chung 1 utility function)

1. `src/pages/common/Classes.tsx:284` — tạo lớp mới
2. `src/components/class-detail/ResetCourseModal.tsx:32` — reset khóa
3. `api/zalo/[action].ts:186` — gợi ý lịch học phí Zalo

---

## Section 2: Class-level Holidays

### Data Model

Lưu holidays trực tiếp trong Class doc:

```typescript
// Thêm vào interface Class
interface Class {
  // ... existing fields
  holidays?: string[]; // ['2026-06-15', '2026-07-02'] - dates this class skips
}
```

### UI — Trong ClassDetail

Thêm section "Ngày nghỉ của lớp" trong tab lịch học của ClassDetail:

```
┌─────────────────────────────────────┐
│  Ngày nghỉ của lớp                  │
│  ┌─────────────────────────────────┐│
│  │ 15/06/2026 (T2)  [✕]          ││
│  │ 02/07/2026 (T5)  [✕]          ││
│  └─────────────────────────────────┘│
│  ┌──────────┐  ┌──────────────────┐│
│  │ Chọn ngày │  │ Phạm vi:        ││
│  │ [______]  │  │ ○ Chỉ lớp này  ││
│  │           │  │ ○ Tất cả lớp   ││
│  └──────────┘  │   cùng ngày     ││
│                └──────────────────┘│
│  [Thêm ngày nghỉ]                  │
└─────────────────────────────────────┘
```

### Scope selection — "Tất cả lớp cùng ngày"

Khi chọn "Tất cả lớp cùng ngày trong tuần":

1. Lấy ngày được chọn → xác định ngày trong tuần (T2/T3/...)
2. Query tất cả lớp có `daysOfWeek` chứa ngày đó
3. Thêm ngày nghỉ vào `holidays` của tất cả lớp đó
4. Tính lại endDate cho tất cả lớp bị ảnh hưởng
5. Hiển thị thông báo: "Đã thêm ngày nghỉ cho X lớp"

---

## Section 3: Auto-extend & Notification

### Trigger

Giáo viên thêm ngày nghỉ mới cho lớp (hoặc nhiều lớp nếu chọn scope "tất cả").

### Flow

```
Teacher adds holiday for date X
  → Check: X có nằm trong khoảng [startDate, endDate] không?
    → Không: Không cần extend (nghỉ ngoài khóa học)
    → Có: Check: X có trùng daysOfWeek của lớp không?
      → Không: Không cần extend (không phải ngày học)
      → Có: endDate cũ không còn đủ số buổi
        → Recalculate endDate
        → Update class.endDate trong Firestore
        → Show toast: "Ngày kết khóa đã được kéo dài đến {newEndDate}"
```

### Notification (toast)

- Thêm 1 ngày nghỉ cho 1 lớp: "Đã thêm ngày nghỉ 15/06. Ngày kết khóa mới: 03/08/2026"
- Thêm ngày nghỉ cho nhiều lớp: "Đã thêm ngày nghỉ cho 5 lớp. Ngày kết khóa đã được cập nhật."
- Ngày nghỉ không ảnh hưởng: "Đã thêm ngày nghỉ 15/06." (không mention endDate)

### Edge cases

1. Ngày nghỉ đã tồn tại: Bỏ qua, không duplicate
2. Ngày nghỉ trùng ngày nghỉ lễ hệ thống: Vẫn lưu vào class holidays (idempotent)
3. Xóa ngày nghỉ: Recalculate endDate ngược lại → endDate có thể ngắn lại
4. Reset khóa học: Xóa tất cả class holidays (giáo viên sẽ set lại cho khóa mới)

---

## Section 4: Backend Validation

### API Endpoint

Thêm action `recalculateEndDate` vào existing `api/classes/[action].ts`:

```typescript
// Request
{
  action: 'recalculateEndDate',
  classId: string,
  startDate: string,
  grade: number,
  holidays: string[],
  systemHolidays: string[]
}

// Response
{
  endDate: string,
  totalSessions: number,
  sessionDates: string[]
}
```

### Validation khi save class

Khi save class (create/update), backend:

1. Validate `startDate` < `endDate`
2. Validate `endDate` hợp lệ dựa trên `daysOfWeek`, `holidays`, `requiredSessions`
3. Nếu không hợp lệ → trả về error + suggested endDate

### Sync frontend/backend

- Frontend gọi `calculateEndDate()` utility → hiển thị suggested endDate ngay
- Khi save → backend validate lại
- Nếu mismatch → backend trả về endDate đúng, frontend cập nhật

---

## Section 5: Files Changed

| File                                               | Thay đổi                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `src/lib/utils/dateUtils.ts` (mới)                 | Utility `calculateEndDate()`, `getRequiredSessions()`            |
| `src/types.ts`                                     | Thêm `holidays?: string[]` vào `Class` interface                 |
| `src/pages/common/Classes.tsx`                     | Dùng utility thay vì logic cũ (line 284)                         |
| `src/components/class-detail/ResetCourseModal.tsx` | Dùng utility thay vì logic cũ (line 32) + xóa holidays khi reset |
| `api/zalo/[action].ts`                             | Dùng utility cho `getNextCourseTuitionSchedule` (line 186)       |
| `src/pages/common/ClassDetail.tsx`                 | Thêm UI quản lý ngày nghỉ                                        |
| `api/classes/[action].ts`                          | Thêm action `recalculateEndDate` + validation                    |
| `src/hooks/useClassData.ts`                        | Subscribe thêm `holidays` field từ class doc                     |
| `firestore.rules`                                  | Cho phép teacher update `holidays` field                         |
| `src/pages/level/LevelManagement.tsx`              | Merge class holidays với system holidays                         |
| `src/hooks/useLevelManagementData.ts`              | Fetch thêm class holidays                                        |

## Section 6: Testing

### Unit tests (utility function)

- `calculateEndDate()` với:
  - Lớp T2/T4/T6, 16 buổi, không nghỉ → đúng endDate
  - Lớp T3/T5/T7, 16 buổi, có ngày nghỉ lễ → endDate kéo dài
  - Lớp có class holiday trùng lịch → endDate kéo dài
  - startDate không phải ngày học → bắt đầu từ ngày học kế tiếp

### Integration tests

- Thêm ngày nghỉ cho 1 lớp → endDate cập nhật
- Thêm ngày nghỉ scope "tất cả lớp" → tất cả lớp cùng ngày cập nhật
- Xóa ngày nghỉ → endDate thu lại

### Manual testing

- Tạo lớp mới → endDate gợi ý đúng theo số buổi
- Reset khóa → endDate gợi ý đúng
- Zalo tuition schedule → endDate đúng
