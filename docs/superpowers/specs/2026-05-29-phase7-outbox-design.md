# Phase 7: Backend Latency / Outbox Design

## 1. Muc tieu

Giam latency backend bang cach chuyen non-critical side effects sang background processing, su dung outbox system da co. Main transaction van blocking de dam bao data integrity.

**Thanh cong khi:**

- Receipt/expense mutation response nhanh hon 200-400ms.
- Audit log failure khong crash HTTP response.
- Zalo notification cho expense/student qua outbox voi retry.
- Main transaction integrity khong thay doi.

## 2. Hien trang

Outbox system da ton tai:

- `api/lib/jobs/outbox.ts` — core engine: `createOutboxJob`, `processOutboxJobs`, idempotency, exponential backoff (30s * 2^attempts, max 5 attempts), stale lock recovery (5 minutes).
- `api/lib/jobs/productionHandlers.ts` — chi co 1 handler: `send_zalo_receipt_confirmation`.
- Vercel cron `outbox-process` chay moi phut.
- Receipt `create-and-post` va `post` da dung outbox cho Zalo, nhung audit van blocking.

Van de hien tai:

- `writeCriticalAuditLog` blocking + throw — neu Firestore blip sau transaction commit, HTTP tra 500 du data da luu.
- `touchRealtimeEvent` sequential await — 4 calls x 50-100ms = 200-400ms added latency cho receipts.
- Zalo chi outbox cho receipts, chua cho expense/student flows.

## 3. Blocking vs Background Boundaries

### Blocking (giu nguyen)

| Side effect | Ly do |
|---|---|
| Firestore main transaction | Data integrity — atomic |
| `createOutboxJob()` call | Can biet job da enqueue truoc khi response |
| Zalo OTP (`zaloOtp.ts`) | User can OTP code trong response |
| Tuition payment Zalo (`tuitionPayments.ts`) | User can biet notification sent |

### Chuyen sang background (outbox)

| Side effect | Hien tai | Sau Phase 7 |
|---|---|---|
| `writeCriticalAuditLog` | Blocking + throw | Outbox `audit_log` job, non-throwing |
| `writeAuditLog` | Blocking, non-throwing | Outbox `audit_log` job |
| Zalo expense confirmation | Blocking chua co | Outbox `send_zalo_expense_confirmation` |
| Zalo student notification | Blocking chua co | Outbox `send_zalo_student_notification` |

### Fire-and-forget (khong outbox, khong blocking)

| Side effect | Hien tai | Sau Phase 7 |
|---|---|---|
| `touchRealtimeEvent` | Blocking sequential | Fire-and-forget `Promise.allSettled`, ~0ms added |

Ly do khong dua realtime event vao outbox:

- Chi la 1 Firestore write nhe (~50ms).
- Client da debounce + minInterval — duplicate event vo hai.
- Neu outbox, co delay toi da 1 phut — UX khong "realtime".

## 4. Outbox Job Types

### Job types moi

| Job type | Handler | Payload | Idempotency key |
|---|---|---|---|
| `audit_log` | Ghi vao `audit_logs` collection | `{ userId, userRole, userName, action, collection, documentId, changes?, metadata?, ip?, userAgent? }` | `audit:{collection}:{documentId}:{action}:{timestamp_ms}` |
| `send_zalo_expense_confirmation` | Gui Zalo ZNS cho expense | `{ expense }` | `zalo:expense:{expenseId}:posted` |
| `send_zalo_student_notification` | Gui Zalo ZNS cho student event (status change, transfer, import) | `{ studentId, notificationType, data }` | `zalo:student:{studentId}:{type}:{timestamp_ms}` |

### Handler registration

Mo rong `api/lib/jobs/productionHandlers.ts` — dang ky them 3 handlers moi.

### Outbox cleanup

Them cron job `outbox-cleanup` chay daily 19:00 UTC, xoa `done` jobs > 7 ngay:

```json
// vercel.json
{ "path": "/api/v1/audit/outbox-cleanup", "schedule": "0 19 * * *" }
```

## 5. Handler Refactoring

### Receipt `create-and-post` flow — sau Phase 7

```
1. db.runTransaction()           — blocking (atomic)
2. createOutboxJob(zalo)         — blocking (~50ms)
3. createOutboxJob(audit_log)    — blocking (~50ms)
4. processOutboxJobs().catch()   — fire-and-forget
5. touchRealtimeEvent() x4       — fire-and-forget parallel (~0ms)
6. return res.json()
```

### Expense `create-and-post` flow — sau Phase 7

```
1. db.runTransaction()           — blocking (atomic)
2. createOutboxJob(audit_log)    — blocking (~50ms)
3. createOutboxJob(zalo_expense) — blocking (~50ms)
4. processOutboxJobs().catch()   — fire-and-forget
5. touchRealtimeEvent()          — fire-and-forget (~0ms)
6. return res.json()
```

### Cac flow khac (post/void receipt, post/void expense, student CRUD)

Cung pattern:

- Audit → outbox job.
- Zalo (neu co) → outbox job.
- touchRealtimeEvent → fire-and-forget parallel.
- Response ngay sau outbox writes.

## 6. touchRealtimeEvent Strategy

### Hien tai (blocking sequential)

```ts
await touchRealtimeEvent('finance-receipt');
await touchRealtimeEvent('finance-ledger');
await touchRealtimeEvent('parent-tuition');
await touchRealtimeEvent('accounting-students');
// ~200-400ms added
```

### Sau Phase 7 (fire-and-forget parallel)

```ts
Promise.allSettled([
  touchRealtimeEvent('finance-receipt'),
  touchRealtimeEvent('finance-ledger'),
  touchRealtimeEvent('parent-tuition'),
  touchRealtimeEvent('accounting-students'),
]).catch(() => {});
// ~0ms added
```

Retry: khong retry — neu fail, client van co polling/refresh fallback.

## 7. Acceptance Criteria

| # | Criteria |
|---|---|
| 1 | Receipt create/post/void khong block audit log. Response time giam ~200-400ms. |
| 2 | Audit log failure khong crash HTTP response. Outbox job fail → retry, response van 200. |
| 3 | touchRealtimeEvent failure khong block response. Fire-and-forget. |
| 4 | Zalo expense/student notification qua outbox voi idempotency key, retry 5 lan. |
| 5 | Outbox cleanup xoa done jobs > 7 ngay. Cron hang ngay. |
| 6 | Main transaction integrity khong thay doi. Receipt, expense, ledger, payment state van atomic. |
| 7 | Khong co `window.location.reload()` trong mutation flows. |

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Outbox job write fail sau transaction commit | Audit mat, data van dung | Log error, alert threshold, manual recovery |
| Inline process fail → cho cron 1 phut | Zalo/notification delay | Inline attempt luon chay truoc, cron la fallback |
| Audit log delay 1-5s | Compliance audit log khong real-time | Chap nhan duoc; timestamp ghi dung thoi diem transaction |
| Outbox_jobs collection growth | Storage cost | Cleanup cron xoa done jobs > 7 ngay |
| Duplicate Zalo notification | User nhan 2 lan | Idempotency key da co trong outbox |

## 9. Out of Scope

- Zalo OTP flow van blocking (user can code).
- Tuition payment notification van blocking (user can biet).
- Report sync/aggregate van chay qua cron rieng (khong thay doi).
- Khong redesign outbox engine — chi them handlers.
- Khong thay doi business logic.

## 10. Test Plan

### Unit tests

- `createOutboxJob` voi `audit_log` type — verify payload, idempotency key.
- `audit_log` handler — verify ghi vao `audit_logs` collection.
- `send_zalo_expense_confirmation` handler — verify gui Zalo.
- `processOutboxJobs` xu ly `audit_log` job.

### Integration tests

- Receipt `create-and-post` — verify audit log duoc ghi qua outbox (khong phai inline).
- Receipt `create-and-post` — verify response khong block tren audit.
- Expense `create-and-post` — verify Zalo expense notification qua outbox.
- touchRealtimeEvent fire-and-forget — verify khong block response.

### Rules tests

- `outbox_jobs` collection — client khong duoc write.
- `audit_logs` collection — chi server write (da co rule).

### Regression

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:rules
```
