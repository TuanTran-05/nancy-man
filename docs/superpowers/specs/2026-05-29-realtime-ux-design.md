# Realtime UX Hybrid Plan

## 0. Review decisions

Nhung diem tu review duoc chap nhan va da cap nhat vao plan:

- Move nen tang `realtime_events` + rules len ngay sau utilities, nhung chi integrate tung callsite theo tung phase sau.
- `useParentTuitionData` da expose `refresh`; viec can lam la sua behavior refresh fail khong clear data va dung `refresh` trong PayOS flow.
- Acceptance ve `window.location.reload()` duoc sua lai: mutation/page logic khong duoc reload, con `ErrorBoundary` recovery reload hien co khong nam trong scope nay.
- `realtime_events` chi duoc luu payload toi thieu, khong PII.
- Finance receipt/expense/payment chi patch sau API success, khong optimistic truoc API.
- Them network resilience, stale indicator, circuit breaker/debounce cho invalidation, PayOS polling fallback, rollback strategy ro hon.
- Them test cases ve duplicate invalidation debounce, no reload, ParentTuition khong raw students read, event payload khong PII.

Diem can phan bien/lam ro:

- `roleScope` trong Firestore rules khong tu giam so active listeners neu client van subscribe qua nhieu channel. Giam read/listener cost phai lam bang client channel registry: moi role chi subscribe cac channel can dung. `limit(1)` query khong co loi the ro voi doc-per-channel listener; default nen la doc listener theo key, neu so channel tang moi can role-scoped collection query.

## 1. Muc tieu va acceptance

Muc tieu la xoa cam giac "lam gi cung phai reload trang" o cac luong thao tac chinh, trong khi van giu mo hinh bao mat hien tai. Cach lam la hybrid:

- Local patch/upsert sau khi API thanh cong cho thao tac cua chinh user.
- Background refresh cho payload doc qua `readChannel`.
- Firestore realtime listener cho collection da duoc rules cho phep doc truc tiep.
- Invalidation event cho du lieu nhay cam, dac biet la `students`, thay vi mo direct listener vao collection nay.

Acceptance chung:

- Tao/sua/xoa/chot/huy/thanh toan xong thi UI thay doi ma khong can reload.
- Mutation/page logic khong duoc goi `window.location.reload()`; `ErrorBoundary` recovery reload hien co duoc phep giu nguyen.
- Mutation thanh cong phai cap nhat UI ngay lap tuc bang patch/upsert local, hoac refresh trong vong vai giay neu can doc lai tu server.
- Refresh fail thi UI giu du lieu hien tai, set error/stale state va hien loi nhe, khong clear bang/list.
- Direct raw read `/students` van bi deny boi rules.
- Khong them direct client read vao collection `students`.
- ParentTuition khong can raw `students` read.
- `realtime_events` khong chua PII.

## 2. Hien trang da xac minh

Da xac minh trong codebase:

- `listOps.ts`, `useReadChannelResource.ts`, `useInvalidationRefresh.ts` chua ton tai.
- `useKnowledgeBankItems` dang dung `getDocs` mot lan.
- `useParentTuitionData` da return `refresh`, nhung catch path hien clear `feeLedgers` va `feeReceipts`.
- `useClassData` dung `getDoc` mot lan cho class detail; evaluations, assignments, submissions va sessions da subscribe realtime.
- `window.location.reload()` chi thay trong `ErrorBoundary.tsx`, khong phai mutation/page flow.
- `Finance`, `Students`, `AdminDashboard`, `LevelManagement`, `ParentDashboard`, `AccountingStudents` con nhieu payload doc mot lan qua `readChannel`.

## 3. Kien truc de xuat

### 3.1 Client list helpers

Tao `src/lib/collections/listOps.ts`:

- `upsertById<T extends { id: string }>(items, item)`
- `removeById<T extends { id: string }>(items, id)`
- `patchById<T extends { id: string }>(items, id, patch)`
- `mergeUniqueById<T extends { id: string }>(current, incoming)`

Yeu cau:

- Khong doi thu tu row cu khi update item da ton tai.
- Item moi append cuoi list, tru khi caller sort rieng.
- Dung cho Students, Finance, Admissions, Admin summary va cac hook readChannel.

### 3.2 `useReadChannelResource`

Tao `src/hooks/useReadChannelResource.ts`.

Interface:

```ts
type UseReadChannelResourceOptions<TPayload, TItem extends { id: string }> = {
  channel: string;
  params?: Record<string, unknown>;
  select: (payload: TPayload) => TItem[];
  enabled?: boolean;
};

type UseReadChannelResourceResult<TItem extends { id: string }> = {
  data: TItem[];
  loading: boolean; // initial load: true when there is no usable data yet
  refreshing: boolean; // background refresh: true while old data remains visible
  error: Error | null;
  lastSyncedAt: string | null;
  isStale: boolean;
  refresh: () => Promise<void>;
  replace: (items: TItem[]) => void;
  patch: (id: string, patch: Partial<TItem>) => void;
  upsert: (item: TItem) => void;
  remove: (id: string) => void;
};
```

Behavior:

- Load ban dau neu `enabled !== false`.
- `loading` chi dung cho initial load/skeleton khi chua co data usable.
- `refreshing` dung cho subtle spinner/sync indicator khi dang refresh nen van hien data cu.
- `refresh` fail thi set `error` va `isStale`, khong clear `data`.
- Unmount cleanup: cancel/ignore late async result de khong set state sau unmount.
- Re-mount behavior: hook fetch lai tu `readChannel`; khong cache stale data qua instance mount moi.
- `replace`, `patch`, `upsert`, `remove` chi cap nhat local state.
- Neu `readChannel` chua co timeout rieng, reuse timeout/cancellation pattern hien co cua API client hoac them abort-safe wrapper trong hook.

### 3.3 `useInvalidationRefresh`

Tao `src/hooks/useInvalidationRefresh.ts`.

Interface:

```ts
type UseInvalidationRefreshOptions = {
  channelKey: RealtimeEventKey;
  enabled?: boolean;
  debounceMs?: number;
  minIntervalMs?: number;
  onInvalidate: () => void | Promise<void>;
};
```

Default strategy:

- `debounceMs = 750`.
- `minIntervalMs = 2500` cho cung mot channel, chu yeu de coalesce cross-user invalidation reads.
- Self-mutation khong doi invalidation: UI duoc patch/upsert local sau API success, invalidation chi lam canonical/background sync.
- Bo qua snapshot dau tien.
- Chi cho phep mot refresh in-flight tren moi hook/channel.
- Neu event den khi refresh dang chay, schedule mot trailing refresh sau debounce/min interval.
- Cleanup Firestore listener va pending timers khi unmount.
- Permission/network listener error khong crash UI; caller nhan stale/error state neu refresh fail.

### 3.4 `realtime_events`

Tao utility server `api/lib/realtime/events.ts`:

```ts
type RealtimeEventKey =
  | 'students'
  | 'finance-ledger'
  | 'finance-receipt'
  | 'finance-expense'
  | 'parent-tuition'
  | 'parent-dashboard'
  | 'admin-summary'
  | 'admissions'
  | 'level-management'
  | 'accounting-students'
  | 'knowledge-bank';

async function touchRealtimeEvent(
  key: RealtimeEventKey,
  options?: { targetId?: string; roleScope?: string[] }
): Promise<void>;
```

Firestore doc shape:

```ts
{
  key: RealtimeEventKey,
  targetId?: string,
  version: number,
  updatedAt: serverTimestamp(),
  roleScope: string[]
}
```

Rules and payload constraints:

- Client read allowed theo event key + current user role.
- Client write denied.
- `roleScope` dung de validate quyen/doc intent, nhung khong thay the viec client chi subscribe channel can thiet.
- Khong ghi PII: khong `studentName`, `phone`, `amount`, `note`, `receipt`, `payment`, message content, ledger detail.
- `touchRealtimeEvent` fail thi log error nhung khong fail mutation chinh.
- Bulk mutation chi touch moi affected channel mot lan sau batch, khong touch tung row.
- Server-side touch khong debounce: moi mutation thanh cong van tang version/touch event. Debounce/min interval chi nam o client de gom nhieu reads lien tiep, khong lam mat event canonical.

Cost strategy:

- Dung doc listener theo key cho cac channel can thiet cua man hinh dang mount.
- Khong mount listener cho channel role/man hinh khong dung.
- Khong dung broad collection listener cho `realtime_events`.
- Chi consider role-scoped `where('roleScope', 'array-contains', role)` + `limit` neu so channel tang va can gom listener.

### 3.5 API response normalization

API mutation co the bo sung field moi nhung phai backward compatible.

Client strategy:

- Chi upsert/patch khi response co `id` va cac field toi thieu cho row hien tai.
- Neu response partial hoac khong dat guard, khong render row incomplete; goi background refresh resource canonical.
- API response la immediate hint; server/readChannel/Firestore state van la canonical source sau refresh.
- Co the dung lightweight type guards hoac `zod` cho cac response moi, khong can schema hoa toan bo endpoint cu trong dot dau.

## 4. Ke hoach trien khai theo pha

Thu tu uu tien moi:

1. Realtime refresh utilities + `listOps`.
2. `realtime_events` foundation + rules.
3. Finance receipt/expense refresh khong reload.
4. ParentTuition + PayOS refresh.
5. Students local patch/remove/refresh + ClassDetail strategy.
6a. KnowledgeBank + Admissions.
6b. Admin summary, LevelManagement, ParentDashboard, AccountingStudents.
7. Backend latency/outbox.
8. Tests va regression sweep.

### Phase 1: Realtime refresh utilities + listOps

Thuc hien:

- Them `listOps` va unit tests.
- Them `useReadChannelResource` va hook tests.
- Them `useInvalidationRefresh` voi debounce, min interval, in-flight guard va cleanup tests.
- Chua integrate vao UI ngoai test harness.

Acceptance:

- Helper/hook tests pass.
- `useReadChannelResource` refresh fail giu data hien tai va set stale/error.
- `useInvalidationRefresh` debounce duplicate events va khong double-fetch snapshot dau tien.

### Phase 2: `realtime_events` foundation + rules

Thuc hien:

- Them `api/lib/realtime/events.ts`.
- Them Firestore rules cho `realtime_events`.
- Them type/key registry dung chung cho client/server neu phu hop.
- Them helper client de map current role/screen -> allowed channel keys, tranh subscribe thua.
- Chua bat buoc integrate vao cac page trong phase nay.

Acceptance:

- Role hop le doc duoc event can thiet.
- Client khong write duoc event.
- Direct raw read `students` van deny.
- Event payload validation/rules/tests khong cho PII fields.
- Bulk touch utility co co che increment version va khong fail mutation chinh neu touch loi.

### Phase 3: Finance receipt/expense refresh khong reload

Thuc hien tren `Finance`:

- Tao `refreshFinanceResource(resource)` cho `students`, `ledgers`, `receipts`, `expenses`, `payments`.
- Tach load function hien tai thanh function co the goi lai sau mutation.
- `students` trong Finance van doc qua `readChannel('finance', { resource: 'students' })`.
- Sau mutation thanh cong, patch/upsert local va background refresh dung resource.
- Sau phase 2, subscribe cac event can thiet khi page mount:
  - `finance-ledger`
  - `finance-receipt`
  - `finance-expense`
  - `students` cho finance student projection neu man hinh can.

Thuc hien tren modal:

- `ReceiptModalProps` them `onSuccess?: (receipt: Receipt | null) => void`.
- `ExpenseModalProps` them `onSuccess?: (expense: Expense | null) => void`.
- Sau create-and-post thanh cong, goi `onSuccess(result.receipt || result.item || result || null)` roi moi `onClose`.
- Parent chi upsert khi response dat guard; neu khong thi refresh.

Finance action policy:

- `postReceipt`, `voidReceipt`, `postExpense`, `voidExpense`, payment actions:
  - Khong optimistic truoc API.
  - API success thi patch/upsert local.
  - API fail thi giu nguyen UI hien tai va toast loi.
  - Receipt thay doi thi refresh ledgers vi paid/remaining thay doi.
- `generateCourseFeeLedgersInBatches` success thi refresh `ledgers` va touch `finance-ledger`, `parent-tuition`, `accounting-students`.
- Rationale: finance/payment la du lieu tien bac, ledger/payment state co nhieu side effect va source of truth nam tren server, nen chi update UI sau API success.

Backend:

- Finance receipt/expense handlers tra record moi nhat khi co the:
  - create-and-post receipt: `{ success: true, id, receiptNo, receipt }`
  - post/void receipt: `{ success: true, receipt }`
  - create-and-post expense: `{ success: true, id, expenseNo, expense }`
  - post/void expense: `{ success: true, expense }`
- Touch event sau write chinh thanh cong.

Acceptance:

- Tao phieu thu/chi xong row moi hien ngay hoac refresh trong vai giay.
- Chot/huy phieu thu/chi xong status doi ngay.
- Tao cong no xong ledgers refresh khong reload.
- Refresh fail khong xoa du lieu Finance hien tai.
- Khong goi `window.location.reload()` trong Finance mutation flows.

### Phase 4: ParentTuition + PayOS refresh

Thuc hien:

- `useParentTuitionData` da co `refresh`; sua refresh fail de khong clear data hien tai.
- Them `lastSyncedAt`, `isStale`/error handling neu ap dung qua `useReadChannelResource`.
- Trong checkout PayOS:
  - Khi status API tra `paid`, goi `refresh()` ngay.
  - Cap nhat message thanh "Da ghi nhan thanh toan, dang dong bo bien lai".
  - Dong modal sau khi da schedule refresh, khong bat user reload.
- Giu polling fallback hien co cho payment critical path.
- Neu user dong modal truoc khi PayOS callback ve:
  - ParentTuition van refresh khi nhan `parent-tuition` invalidation.
  - Co the refresh khi page/tab focus lai neu payment dang pending gan day.
- Neu status check timeout/network fail:
  - Giu pending UI/message nhe.
  - Cho polling lan sau hoac invalidation webhook cap nhat.
- Finance PayOS tab:
  - `refreshPayOSPaymentStatus`, `resolvePayOSReview`, `reconcilePayOSPayments` reload/patch payment list sau API success.
  - Neu status thanh `paid`, refresh `ledgers` va `receipts`.

Acceptance:

- Thanh toan thanh cong thi ledger/receipt hien trang thai moi trong cung page.
- ParentTuition khong raw read `students` hoac `payment_requests`.
- API fail giu UI hien tai va hien loi nhe.

### Phase 5: Students local patch/remove/refresh + ClassDetail

Thuc hien tren `Students`:

- Sau create: upsert hoc sinh moi vao list neu API tra record du guard; neu chi tra id/partial thi refresh.
- Sau update phone/contact: patch row bang data da submit va id response.
- Sau delete: remove row khoi list sau API success; neu delete fail thi giu nguyen UI.
- Sau import: default refresh vi import result hien chi co name/studentId, chua du full row.
- Status change va transfer:
  - Day la cac flow co optimistic patch hien co.
  - Luu rollback snapshot trong memory theo row/action id, khong dung LocalStorage, khong can undo UI.
  - Disable/serialize action tren cung row khi mutation dang in-flight; neu co event ngoai den, background refresh canonical state.
- Rationale: student status/transfer la lower-risk hon finance, row patch don gian va co rollback/refetch ro rang, nen giu optimistic UX hien co. Finance khong ap dung policy nay vi sai tien/ledger trong UI co rui ro cao hon.

Backend students:

- Student create/update/status nen tra `{ success: true, id, student }` neu lay duoc record sau write.
- Delete tra `{ success: true, id, deleted: true }`.
- Student mutations touch `students`; import touch mot lan sau batch.

Class detail strategy:

- Doi class doc trong `useClassData` tu `getDoc` mot lan sang `subscribeToDoc` vi reset course/schedule/status/class metadata anh huong truc tiep man hinh detail.
- Khong dung listener raw `students`.
- Them `refreshStudents()` cho roster doc qua `readChannel('class-detail')`.
- Roster refresh khi:
  - local student mutation trong cung page can refresh,
  - `students` invalidation den,
  - class transfer/status update thanh cong.
- Evaluations/assignments/submissions/sessions da realtime thi giu nguyen.

Classes:

- Class list da realtime, giu nguyen.
- Student counts refresh sau student mutation va khi `students` invalidation den.

Acceptance:

- Sua phone/contact hoc sinh xong list cap nhat ngay.
- Xoa hoc sinh xong row bien mat sau API success.
- Import hoc sinh xong list/class counts cap nhat khong reload.
- Class detail metadata realtime qua class doc listener.
- Class roster refresh qua readChannel, khong raw `students` read.

### Phase 6a: KnowledgeBank + Admissions

KnowledgeBank:

- Doi `useKnowledgeBankItems` tu `getDocs` sang `onSnapshot`.
- Query giu `orderBy('createdAt', 'desc')` va limit hien tai.
- Upload/delete giu loading state theo item; listener cap nhat list.

Admissions:

- Add waitlist:
  - Neu API tra du pending row thi add local sau success.
  - Neu partial thi giu refetch hien tai.
- Delete pending:
  - Remove row sau API success.
  - API fail giu nguyen UI va toast loi.
- Create trial:
  - Remove pending row sau API success.
  - Refresh recent timeline.
- Touch/listen `admissions` de dong bo nhieu office staff.

Acceptance:

- Upload/xoa tai lieu cap nhat list tu dong.
- Waitlist/trial khong can reload va dong bo duoc giua nhieu user.

### Phase 6b: Admin summary, LevelManagement, ParentDashboard, AccountingStudents

AdminDashboard:

- Dung `refreshAdminSummary`.
- `CreateStaffModal` goi `onSuccess` sau create thanh cong.
- Summary refresh hoac listen `admin-summary`.
- Staff add/remove/unblock/delete touch `admin-summary`.

LevelManagement:

- `useLevelManagementData` listen `level-management` va `students`.
- Payload classes da realtime mot phan; payload students/evaluations/sessions/attendance refresh qua invalidation.

ParentDashboard:

- Chat giu realtime hien tai.
- Payload readChannel refresh qua `parent-dashboard` invalidation khi co attendance/evaluation/assignment/student status thay doi.

AccountingStudents:

- Refresh page dau tien khi `accounting-students` hoac `students` invalidation thay doi.
- Neu dang load more, invalidation reset ve page dau de tranh merge sai summary.

Acceptance:

- Staff create/delete cap nhat admin summary khong reload.
- Level/parent dashboard cap nhat sau cac mutation quan trong ma khong mo raw student read.

### Phase 7: Backend latency/outbox

Lam sau khi UI refresh flows da dung.

Default implementation nen phu hop Vercel + Firestore hien tai:

- Dung Firestore `outbox_jobs` collection + secured Vercel Cron/API processor, thay vi Cloud Tasks/Pub/Sub trong dot dau.
- Job fields:
  - `idempotencyKey`
  - `type`
  - `payload`
  - `status: pending | processing | done | failed`
  - `processingStartedAt`
  - `lockedBy`
  - `attempts`
  - `nextRunAt`
  - `lastError`
  - `createdAt`, `updatedAt`
- Idempotency:
  - Job handler phai idempotent; retry/duplicate cron khong duoc gui lai Zalo/report duplicate neu side effect da completed.
  - Dung `idempotencyKey` theo business entity/action, vi du `zalo:receipt:{receiptId}:posted`.
  - Before processing, transaction claim job khi `status` la `pending` hoac `failed` voi `nextRunAt <= now`, set `processing`, `processingStartedAt`, `lockedBy`.
  - Stale `processing` job qua timeout duoc retry bang transaction, khong xu ly song song.
- Retry:
  - exponential backoff.
  - max attempts mac dinh 5.
  - failed jobs giu lai de admin/ops xem.
- Monitoring:
  - log structured error.
  - admin-only failed outbox count/report neu can.
  - alert thu cong/hosting logs trong dot dau; automation/notification co the la phase sau.

Blocking boundaries:

- Main transaction blocking:
  - receipt
  - expense
  - ledger
  - payment state
- Critical audit blocking neu compliance bat buoc.
- Background/outbox:
  - Zalo notification
  - report sync/aggregate refresh neu khong can cho response
  - non-critical audit

Acceptance:

- Tao phieu/cong no khong bi treo vi side effect khong lien quan den write chinh.
- Neu side effect fail, UI van cap nhat record chinh va failed job duoc retry/visible.

### Phase 8: Tests va regression sweep

Chay targeted tests theo tung slice, sau do full regression:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:rules
```

## 5. Test plan chi tiet

Unit/component tests:

- `listOps`: upsert, patch, remove, merge order.
- `useReadChannelResource`: initial load, refresh, local patch/upsert/remove, refresh fail keeps data and sets stale.
- `useReadChannelResource`: `loading` true only for initial load; `refreshing` true for background refresh while old data remains visible; re-mount fetches fresh data.
- `useInvalidationRefresh`: skip initial snapshot, debounce duplicate events, max one refresh per `minIntervalMs`, trailing refresh, cleanup unsubscribe and timers on unmount.
- `touchRealtimeEvent`: increments version, uses server timestamp, rejects/strips PII payload fields.
- `touchRealtimeEvent`: server touch is not debounced; each successful mutation increments/touches event, client coalesces reads.
- Outbox: duplicate cron/worker claim cannot process same job concurrently; idempotency key prevents duplicate side effects.
- `ReceiptModal`: calls `onSuccess` after create success; does not close on failure.
- `ExpenseModal`: calls `onSuccess` after create success.
- `useParentTuitionData`: refresh fail keeps previous ledgers/receipts.
- `useKnowledgeBankItems`: snapshot add/delete changes list.

Integration/component tests:

- `Finance`: create receipt upserts row; post/void receipt patches status and refreshes ledger; post/void expense patches status; no `window.location.reload()` after create/post/void.
- `ParentTuition`: PayOS `paid` status calls `refresh`; no raw `students`/`payment_requests` listener.
- `Students`: update phone/contact patches row; delete removes after API success; import triggers refresh; status/transfer rollback or refresh on failure.
- `ClassDetail/useClassData`: class doc listener updates metadata; roster refresh uses readChannel.
- `Admissions`: delete pending removes after API success; create trial removes pending and refreshes timeline.
- `AdminDashboard`: `CreateStaffModal` `onSuccess` refreshes summary.

Rules/security tests:

- Direct raw read `students` denied.
- Client write `realtime_events` denied.
- Role hop le doc duoc event can thiet.
- Parent khong doc duoc admin/finance event neu khong co quyen.
- `realtime_events` payload khong cho PII fields: `studentName`, `phone`, `amount`, `note`, `receipt`, `payment`, `message`.

Performance/resilience checks:

- Local UI patch visible under 500ms after API success in component tests/manual QA.
- Invalidation duplicate events coalesce: same channel not refreshed more than once per `minIntervalMs`, with trailing refresh.
- E2E/smoke for critical paths:
  - mocked PayOS paid -> ParentTuition refresh.
  - student import -> list refresh.
  - finance receipt create/post/void -> no reload and row/status updates.
- Optional load/soak later: simulate many mutation events and verify readChannel refresh count is bounded by debounce/min interval.

## 6. Thu tu commit de review de hon

1. `docs: update realtime ux design`
2. `feat: add realtime refresh utilities`
3. `feat: add realtime invalidation events and rules`
4. `feat: refresh finance mutations without reload`
5. `feat: refresh parent tuition after payment`
6. `feat: patch student mutations locally`
7. `feat: realtime knowledge bank admissions and summaries`
8. `feat: move non-critical backend side effects to outbox`
9. `test: cover realtime ux flows`

## 7. Ngoai scope dot dau

- Khong lam full websocket/custom server realtime.
- Khong mo raw `students` listener cho client.
- Khong redesign UI visual.
- Khong thay doi business logic tinh hoc phi/discount ngoai viec refresh UI.
- Khong refactor toan bo finance page neu khong can de dat UX realtime.
- Khong dua outbox vao phase dau neu UI refresh chua xong.

## 8. Rui ro va cach giam

- Event doc leak activity: payload toi thieu, khong PII, role-based rules.
- Listener/read cost: client channel registry, doc listener only for mounted screen and allowed role, debounce refresh.
- Optimistic sai: finance/payment only patch after API success; Students only rollback memory for existing optimistic status/transfer flows.
- Duplicate refresh: debounce + min interval + in-flight guard + trailing refresh.
- Stale pagination: paginated read models reset page dau on invalidation.
- Network disconnect: expose stale/error/lastSyncedAt; keep current data.
