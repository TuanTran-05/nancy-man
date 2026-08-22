# Zalo Bot Staff Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây kênh Zalo Bot chỉ gửi thông báo riêng cho giáo viên, văn phòng và admin; hỗ trợ tự liên kết bằng mã một lần, admin liên kết thủ công, bản tổng hợp cuối ngày và cơ chế cron đáng tin cậy trên Vercel Serverless.

**Architecture:** Tách Zalo Bot Platform khỏi luồng Zalo OA/ZNS hiện có bằng dispatcher, client và collection riêng. Các public path của Bot được rewrite vào entrypoint Zalo hiện có để giữ Vercel function budget, rồi được chuyển ngay sang dispatcher Bot độc lập; semantic OA/ZNS không thay đổi. Webhook chỉ xử lý lệnh liên kết xác định trước; cron 21:30 giờ Việt Nam thu thập dữ liệu, tạo tối đa một digest cho mỗi nhân viên/ngày, ghi message ledger rồi đẩy job vào outbox hiện có. Outbox gọi Bot API, phân loại lỗi, cập nhật message ledger và giữ tính idempotent khi cron chạy lặp hoặc serverless cold start.

**Tech Stack:** TypeScript 5.8, Vercel Functions, Firebase Admin/Firestore, React 19, Vitest, Testing Library, Firebase Rules Emulator, Zod, Zalo Bot Platform HTTP API.

**Provider contracts verified 2026-08-15:** [sendMessage](https://docs.zaloplatforms.com/docs/BOT/apis/sendMessage), [API envelope](https://docs.zaloplatforms.com/docs/BOT/call_api), [Webhook](https://docs.zaloplatforms.com/docs/BOT/webhook), [Error codes](https://docs.zaloplatforms.com/docs/BOT/error_code), [setWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook). Re-check these pages at implementation and pilot time; captured tests remain the regression contract.

**Implementation status 2026-08-16:** Tasks 1–15 have landed and passed the repository verification suite. The step checkboxes below are retained as the original execution recipe. The Pilot Rollout Gate and Final Release Gate remain operator-run gates that require a real deployment and provider credentials.

## Global Constraints

- Giữ Zalo Bot hoàn toàn độc lập với Zalo OA/ZNS; không sửa semantic của các action ZNS hiện có.
- Bot không dùng AI và không trả lời hội thoại tự do. Webhook chỉ phản hồi lệnh liên kết, xác nhận liên kết và thông báo hệ thống.
- Chỉ các vai trò `teacher`, `office`, `admin` được liên kết. `accounting`, `student`, `parent` không thuộc phạm vi này.
- Mọi collection Zalo Bot là server-only. Frontend chỉ đi qua API có Firebase Auth; không đọc hoặc ghi Firestore trực tiếp.
- Không log URL đầy đủ của Bot API vì token nằm trong path. Không log token, raw link code hoặc raw webhook secret.
- Dùng múi giờ `Asia/Ho_Chi_Minh` và date key `YYYY-MM-DD` cho digest, deadline và idempotency.
- Dùng `print_requests.neededDate` đã tồn tại; không thêm trường `requiredBy`. Yêu cầu in cần nhắc là `status === 'pending'` và `neededDate <= tomorrow`.
- Mỗi người có tối đa một message `daily_digest` cho một ngày. ID phải xác định được từ `digestDate + staffId`.
- Nội dung gửi qua Bot API không vượt 2.000 ký tự. Khi phải rút gọn, giữ số tổng hợp và thêm link về ứng dụng.
- Cờ triển khai: `ZALO_BOT_ENABLED`, `ZALO_BOT_DAILY_DIGEST_ENABLED`, `ZALO_BOT_DRY_RUN`.
- Chỉ chat `PRIVATE` được ghi pending hoặc liên kết. Webhook từ chat `GROUP` luôn trả acknowledgement an toàn nhưng không ghi raw chat ID và không tạo link.
- Phản hồi Bot API phải được phân loại từ JSON `{ ok, result, description, error_code }`; HTTP status chỉ là fallback khi body thiếu hoặc không hợp lệ. `401` là auth; `403`, `408`, `429` và `5xx` không được coi đồng loạt là auth.
- Idempotency của ledger/outbox ngăn duplicate do cron hoặc enqueue chạy lại. Bot API không nhận client idempotency key, vì vậy retry sau timeout/network error có semantics at-least-once và có thể tạo duplicate ở provider; runbook và UI quản trị phải nói rõ giới hạn này.
- Trước mỗi lần gửi, delivery phải tải lại user hiện tại và chỉ gửi khi user tồn tại, `blockedTeacher !== true`, role hiện tại thuộc `teacher | office | admin`, role khớp link và link vẫn `active`.
- Mọi lệnh `createOutboxJob` phải truyền `StudentIdentityMutationContext`; không làm optional hoặc bypass student-identity mutation guard hiện có.
- Không tạo thêm direct Vercel Function cho Bot: route công khai phải dùng dispatcher Bot phía sau `api/zalo/[action].ts` để tổng số function không vượt giới hạn Hobby hiện tại.
- Thứ tự triển khai bên dưới là thứ tự phụ thuộc. Mỗi task phải hoàn tất test và commit riêng trước khi sang task tiếp theo.

## Execution Prerequisite

- File plan này phải được track trước khi tạo worktree triển khai. `.gitignore` chỉ unignore đúng file này; commit plan hoặc dùng `git add -f` rồi commit trước khi chạy `superpowers:using-git-worktrees`.
- Working tree hiện có thay đổi không liên quan. Khi triển khai, dùng worktree riêng hoặc chỉ stage đúng file được liệt kê trong từng task.

## File Map and Responsibilities

### Files to create

| File | Responsibility |
|---|---|
| `shared/zaloBot.ts` | Kiểu dữ liệu dùng chung, role/status hợp lệ, parse lệnh liên kết, ID idempotent |
| `shared/zaloBot.test.ts` | Unit test cho contract và helper thuần |
| `server/api/zalo-bot/config.ts` | Đọc và kiểm tra env server-only |
| `server/api/zalo-bot/config.test.ts` | Test feature flags và lỗi cấu hình |
| `server/api/zalo-bot/botClient.ts` | Gọi `sendMessage`, timeout, phân loại lỗi provider, che token |
| `server/api/zalo-bot/botClient.test.ts` | Test HTTP contract và error taxonomy |
| `server/api/zalo-bot/linkRepository.ts` | Mã một lần, pending chat, claim duy nhất, liên kết/hủy liên kết |
| `server/api/zalo-bot/linkRepository.test.ts` | Test transaction và uniqueness |
| `server/api/zalo-bot/webhookHandler.ts` | Xác thực webhook, parse update, xử lý `/link`, bỏ qua chat thường |
| `server/api/zalo-bot/webhookHandler.test.ts` | Test secret, link command và ignored message |
| `server/api/zalo-bot/linkHandlers.ts` | API self-link và API quản trị liên kết |
| `server/api/zalo-bot/linkHandlers.test.ts` | Test role/auth/validation/audit |
| `server/api/zalo-bot/routeHandler.ts` | Dispatcher Bot độc lập phía sau entrypoint Vercel dùng chung |
| `api/zalo-bot/action.test.ts` | Test dispatch và auth boundary của router |
| `src/lib/zalo/zaloBotService.ts` | Client API typed cho UI |
| `src/lib/zalo/zaloBotService.test.ts` | Test path/method/payload frontend |
| `src/components/zalo/ZaloBotLinkCard.tsx` | Card tự liên kết trong Profile |
| `src/components/zalo/ZaloBotLinkCard.test.tsx` | Test UX tạo mã, trạng thái và hủy liên kết |
| `src/components/zalo/ZaloBotManagementPanel.tsx` | Bảng pending chat, staff link và test message cho admin |
| `src/components/zalo/ZaloBotManagementPanel.test.tsx` | Test liên kết thủ công, hủy và refresh |
| `server/api/zalo-bot/digestTypes.ts` | Model nguồn chuẩn hóa và reminder item |
| `server/api/zalo-bot/digestRules.ts` | Luật điểm danh, kết khóa, in đề và tổng hợp admin |
| `server/api/zalo-bot/digestRules.test.ts` | Unit test ma trận nghiệp vụ |
| `server/api/zalo-bot/digestComposer.ts` | Ghép digest theo vai trò, giới hạn 2.000 ký tự |
| `server/api/zalo-bot/digestComposer.test.ts` | Snapshot nội dung và test truncation |
| `server/api/zalo-bot/digestSources.ts` | Đọc Firestore và chuẩn hóa dữ liệu cho một ngày |
| `server/api/zalo-bot/digestSources.test.ts` | Test query bounds, roster eligibility và giáo viên dạy thay |
| `server/api/zalo-bot/messageRepository.ts` | Ledger message, transition trạng thái và attempt count |
| `server/api/zalo-bot/messageRepository.test.ts` | Test state machine và idempotency |
| `server/api/zalo-bot/digestService.ts` | Fan-out reminder theo người, tạo ledger và outbox jobs |
| `server/api/zalo-bot/digestService.test.ts` | Test một digest/người/ngày và dry run |
| `server/api/zalo-bot/deliveryService.ts` | Gửi một ledger message, xử lý provider error và relink |
| `server/api/zalo-bot/deliveryService.test.ts` | Test success, invalid chat, auth abort và retry tối đa ba lần |
| `server/api/zalo-bot/linkConfirmationService.ts` | Tạo/repair ledger và outbox xác nhận liên kết sau webhook commit |
| `server/api/zalo-bot/linkConfirmationService.test.ts` | Test replay-safe link confirmation và crash repair |
| `api/audit/zalo-bot-daily-digest.test.ts` | Test cron auth, date selection, catch-up và outbox processing |
| `docs/zalo-bot-runbook.md` | Cấu hình bot, webhook, dry run, pilot, vận hành và rollback |

### Files to modify

| File | Change |
|---|---|
| `server/api/lib/jobs/outbox.ts` | Cho phép `maxAttempts` theo job và lỗi yêu cầu dừng batch |
| `server/api/lib/jobs/outbox.test.ts` | Bảo vệ retry mặc định và hành vi mới |
| `server/api/lib/jobs/productionHandlers.ts` | Đăng ký handler `send_zalo_bot_message` |
| `src/pages/common/Profile.tsx` | Hiển thị self-link card cho teacher/office/admin |
| `src/pages/common/Profile.zaloBot.test.tsx` | Test tích hợp card theo role |
| `src/pages/admin/ZaloOA.tsx` | Thêm khu vực “Bot nội bộ”, tách nhãn rõ với OA/ZNS |
| `src/pages/admin/ZaloOA.test.tsx` | Test tích hợp panel quản trị |
| `api/audit/[action].ts` | Thêm daily digest job và catch-up trong daily maintenance |
| `api/audit/daily-maintenance.test.ts` | Bảo vệ fan-out catch-up |
| `api/zalo/[action].ts` | Chuyển namespace `bot-*` sang dispatcher Bot trước luồng OA/ZNS hiện có |
| `api/zalo/action.test.ts` | Khóa dispatch Bot và bảo vệ auth boundary OA/ZNS hiện có |
| `vercel.json` | Cron `30 14 * * *` tương ứng 21:30 Việt Nam |
| `vercel.config.test.mjs` | Khóa chính xác ba cron daily-maintenance, digest và outbox drain |
| `firestore.indexes.json` | Composite index `print_requests(status, neededDate)` cho queue đến hạn/quá hạn |
| `.env.example` | Thêm env Bot Platform và feature flags |
| `firestore.rules` | Explicit deny cho toàn bộ collection Zalo Bot |
| `firestore.rules.test.mjs` | Khóa sự tồn tại của explicit deny blocks cho collection Bot |
| `firestore.rules.emulator.test.ts` | Chứng minh anonymous/teacher/office/admin đều không đọc/ghi được dữ liệu bot |
| `docs/production-runbook.md` | Liên kết sang runbook Zalo Bot và nêu cảnh báo vận hành |

---

## Task 1: Shared Contracts and Server Configuration

**Files:**

- Create: `shared/zaloBot.ts`
- Create: `shared/zaloBot.test.ts`
- Create: `server/api/zalo-bot/config.ts`
- Create: `server/api/zalo-bot/config.test.ts`

**Consumes:** `process.env`, authenticated user role, raw webhook text.

**Produces:** Typed link/message records, stable IDs, parsed link command, validated runtime config.

- [ ] **Step 1: Write failing contract tests**

~~~ts
import { describe, expect, it } from 'vitest';
import {
  makeZaloBotDailyMessageId,
  parseZaloBotLinkCommand,
  isZaloBotStaffRole,
} from './zaloBot';

describe('zalo bot contracts', () => {
  it('accepts only notification recipients', () => {
    expect(['teacher', 'office', 'admin'].filter(isZaloBotStaffRole)).toEqual([
      'teacher',
      'office',
      'admin',
    ]);
    expect(isZaloBotStaffRole('accounting')).toBe(false);
  });

  it('parses a case-insensitive one-time link command', () => {
    expect(parseZaloBotLinkCommand('  /LiNk a7k9-q2  ')).toBe('A7K9Q2');
    expect(parseZaloBotLinkCommand('xin chào')).toBeNull();
  });

  it('builds one stable digest id per staff and date', () => {
    expect(makeZaloBotDailyMessageId('2026-08-15', 'teacher/01')).toBe(
      'daily_digest_2026-08-15_teacher_01'
    );
  });
});
~~~

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `npx.cmd vitest run shared/zaloBot.test.ts server/api/zalo-bot/config.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the contracts and strict config loader**

Add these public contracts:

~~~ts
export const ZALO_BOT_STAFF_ROLES = ['teacher', 'office', 'admin'] as const;
export type ZaloBotStaffRole = (typeof ZALO_BOT_STAFF_ROLES)[number];
export type ZaloBotLinkStatus = 'active' | 'disabled' | 'needs_relink';
export type ZaloBotLinkedMethod = 'self' | 'admin';
export type ZaloBotMessageStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'skipped';
export type ZaloBotMessageType = 'daily_digest' | 'link_confirmation' | 'test';

export interface ZaloBotLink {
  staffId: string;
  chatId: string;
  chatIdHash: string;
  displayName: string;
  role: ZaloBotStaffRole;
  status: ZaloBotLinkStatus;
  linkedMethod: ZaloBotLinkedMethod;
  linkedBy: string;
  linkedAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface ZaloBotMessage {
  id: string;
  staffId: string;
  role: ZaloBotStaffRole;
  chatIdHash: string;
  digestDate: string;
  messageType: ZaloBotMessageType;
  contentSnapshot: string;
  status: ZaloBotMessageStatus;
  attempts: number;
  processingStartedAt?: string;
  lockedBy?: string;
  lastAttemptAt?: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  deliveryAmbiguous?: boolean;
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function isZaloBotStaffRole(value: unknown): value is ZaloBotStaffRole {
  return ZALO_BOT_STAFF_ROLES.includes(value as ZaloBotStaffRole);
}

export function parseZaloBotLinkCommand(text: string): string | null {
  const match = /^\/link\s+([a-z0-9-]{6,16})$/i.exec(text.trim());
  return match ? match[1].replace(/-/g, '').toUpperCase() : null;
}

export function makeZaloBotDailyMessageId(date: string, staffId: string): string {
  return ('daily_digest_' + date + '_' + staffId).replace(/[^a-zA-Z0-9_-]/g, '_');
}
~~~

`digestDate` is the Vietnam date key associated with every ledger row: the requested digest date for `daily_digest`, and the creation date for `link_confirmation`/`test`. This keeps incident grouping and retention queries consistent across message types.

`loadZaloBotConfig()` must return:

~~~ts
export type ZaloBotConfig = {
  enabled: boolean;
  dailyDigestEnabled: boolean;
  dryRun: boolean;
  token: string;
  webhookSecret: string;
  linkCodePepper: string;
  chatHashSecret: string;
  appUrl: string;
  requestTimeoutMs: number;
};
~~~

Rules:

- Boolean env accepts only `true` or `false`; empty values use `false`.
- When `enabled === true`, token, webhook secret, link-code pepper and chat-hash secret are required.
- `ZALO_BOT_WEBHOOK_SECRET` must contain 8 through 256 characters, matching the Bot Platform `secret_token` contract.
- `APP_URL` is normalized without a trailing slash.
- Error messages name the missing env key but never include its value.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx.cmd vitest run shared/zaloBot.test.ts server/api/zalo-bot/config.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add shared/zaloBot.ts shared/zaloBot.test.ts server/api/zalo-bot/config.ts server/api/zalo-bot/config.test.ts
git commit -m "feat: add zalo bot contracts and config"
~~~

## Task 2: Zalo Bot API Client

**Files:**

- Create: `server/api/zalo-bot/botClient.ts`
- Create: `server/api/zalo-bot/botClient.test.ts`

**Consumes:** Validated `ZaloBotConfig`, `chatId`, text up to 2.000 characters.

**Produces:** Provider message ID or a typed provider error that delivery logic can act on.

- [ ] **Step 1: Write failing HTTP client tests**

Cover all of these cases with a mocked `global.fetch`:

- POSTs JSON `{ chat_id, text }` to `https://bot-api.zaloplatforms.com/bot<TOKEN>/sendMessage`.
- Adds `Content-Type: application/json`.
- Rejects empty text and text longer than 2.000 characters before calling fetch.
- Parses the Bot API JSON envelope even when HTTP is `2xx`; `{ ok: false, error_code, description }` must throw instead of being treated as success.
- Maps only provider `error_code === 401` to `kind === 'auth'` and `abortBatch === true`.
- Maps provider `403`, `408` and `5xx` to `kind === 'transient'`; `403` must never create an auth incident.
- Maps `429` to `kind === 'rate_limited'`; parse `Retry-After` as seconds, clamp it to 5 seconds through 5 minutes and retain it as `retryAfterMs`.
- Maps a `404`/`400` response to `invalid_chat` only when the sanitized description contains a recipient/chat marker (`chat`, `recipient`, `người nhận` or `cuộc trò chuyện`) together with `invalid`/`not found`/`không hợp lệ`/`không tồn tại`. Unknown `400`/`404` responses remain `permanent` and must not disable a link.
- Maps AbortSignal timeout and network errors to `kind === 'transient'` and marks them `deliveryAmbiguous === true`, because the provider may have accepted the message before the connection failed.
- Falls back to HTTP status only when the JSON envelope is missing or malformed; maps remaining `4xx` to `permanent`.
- Error messages and captured diagnostics do not contain the token or request URL.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/botClient.test.ts`

Expected: FAIL because `botClient.ts` does not exist.

- [ ] **Step 3: Implement the typed client**

Expose this API:

~~~ts
export type ZaloBotApiErrorKind =
  | 'invalid_chat'
  | 'auth'
  | 'rate_limited'
  | 'transient'
  | 'permanent';

export class ZaloBotApiError extends Error {
  constructor(
    message: string,
    readonly kind: ZaloBotApiErrorKind,
    readonly statusCode: number,
    readonly retryAfterMs = 0,
    readonly deliveryAmbiguous = false,
    readonly providerErrorCode?: number
  ) {
    super(message);
    this.name = 'ZaloBotApiError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'transient' || this.kind === 'auth';
  }

  get abortBatch(): boolean {
    return this.kind === 'auth';
  }
}

export async function sendZaloBotText(
  input: { chatId: string; text: string },
  config: Pick<ZaloBotConfig, 'token' | 'requestTimeoutMs'>
): Promise<{ messageId: string }>;
~~~

Use `AbortSignal.timeout(config.requestTimeoutMs)`. Read the response body exactly once and validate this envelope before reading `result.message_id`:

~~~ts
const responseSchema = z.object({
  ok: z.boolean(),
  result: z.object({ message_id: z.string().min(1) }).optional(),
  description: z.string().optional(),
  error_code: z.number().int().optional(),
});
~~~

Emit a sanitized message such as `Zalo Bot sendMessage failed with provider code 401`; never copy `description`, token, raw chat ID or provider URL into a stored/logged error. Tests use captured fixtures matching the official `{ ok, result, description, error_code }` contract and must cover HTTP `200` with `ok: false`.

- [ ] **Step 4: Verify the client**

Run: `npx.cmd vitest run server/api/zalo-bot/botClient.test.ts`

Expected: PASS.

Run: `npx.cmd eslint server/api/zalo-bot/botClient.ts server/api/zalo-bot/botClient.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add server/api/zalo-bot/botClient.ts server/api/zalo-bot/botClient.test.ts
git commit -m "feat: add zalo bot api client"
~~~

## Task 3: Atomic Link Repository

**Files:**

- Create: `server/api/zalo-bot/linkRepository.ts`
- Create: `server/api/zalo-bot/linkRepository.test.ts`

**Consumes:** Authenticated staff identity, webhook chat identity, one-time code, admin actor.

**Produces:** `zalo_bot_links`, `zalo_bot_chat_claims`, `zalo_bot_pending_chats`, `zalo_bot_link_codes` with atomic uniqueness.

- [ ] **Step 1: Write failing repository tests**

Create deterministic clock, random-code and HMAC dependencies. Test:

- Issued code has 8 uppercase alphanumeric characters, expires after 10 minutes, and only its HMAC is stored.
- A valid unexpired code creates an active link, active chat claim and consumed timestamp in one transaction.
- An already claimed chat cannot be assigned to a second staff account.
- Re-linking the same staff releases the previous chat claim before claiming the new chat.
- Admin manual linking requires a pending chat and records `linkedMethod: 'admin'`.
- Self linking records `linkedMethod: 'self'` and `linkedBy` equal to the staff ID.
- Unlink changes link status to `disabled` and claim state to `released`; it does not delete audit evidence.
- Expired or consumed codes fail without creating a link.
- Five failed commands from the same pending chat block further attempts for 15 minutes.
- Official webhook senders without a `username` are stored successfully; `username` remains optional throughout repository and admin DTOs.
- The webhook event marker and link/pending mutation commit atomically: a transaction failure writes neither side, and a replay of a processed `webhookEventId` returns its stored outcome without consuming the code twice.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/linkRepository.test.ts`

Expected: FAIL because repository exports are absent.

- [ ] **Step 3: Implement transaction-safe repository functions**

Expose:

~~~ts
export type ZaloBotLinkActor = {
  uid: string;
  role: ZaloBotStaffRole;
  displayName: string;
};

export type PendingZaloBotChat = {
  chatId: string;
  chatIdHash: string;
  displayName: string;
  username?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
  blockedUntil?: string;
};

export async function issueZaloBotLinkCode(
  db: Firestore,
  staff: ZaloBotLinkActor,
  deps: LinkRepositoryDeps
): Promise<{ code: string; expiresAt: string }>;

export async function recordPendingZaloBotChat(
  db: Firestore,
  chat: { chatId: string; displayName: string; username?: string; webhookEventId: string },
  deps: LinkRepositoryDeps
): Promise<PendingZaloBotChat>;

export async function consumeZaloBotLinkCode(
  db: Firestore,
  input: {
    code: string;
    chatId: string;
    displayName: string;
    username?: string;
    webhookEventId: string;
  },
  deps: LinkRepositoryDeps
): Promise<ZaloBotLink>;

export async function adminLinkZaloBotChat(
  db: Firestore,
  input: { staff: ZaloBotLinkActor; chatIdHash: string; adminId: string },
  deps: LinkRepositoryDeps
): Promise<ZaloBotLink>;

export async function disableZaloBotLink(
  db: Firestore,
  input: { staffId: string; actorId: string },
  deps: LinkRepositoryDeps
): Promise<void>;

export async function touchActiveZaloBotLinkFromWebhook(
  db: Firestore,
  input: { chatId: string; webhookEventId: string },
  deps: LinkRepositoryDeps
): Promise<'updated' | 'unlinked' | 'replayed'>;

export async function recordIgnoredZaloBotWebhookEvent(
  db: Firestore,
  input: { webhookEventId: string; eventName: string; outcome: string },
  deps: LinkRepositoryDeps
): Promise<'recorded' | 'replayed'>;
~~~

Implementation details:

- `codeHash = HMAC-SHA256(linkCodePepper, normalizedCode)`.
- `chatIdHash = HMAC-SHA256(chatHashSecret, chatId)`.
- Use document IDs `zalo_bot_link_codes/{codeHash}`, `zalo_bot_chat_claims/{chatIdHash}`, `zalo_bot_pending_chats/{chatIdHash}`, `zalo_bot_links/{staffId}`.
- Use `_maintenance/zaloBotWebhook_<messageId>` as the event record. `recordPendingZaloBotChat`, `consumeZaloBotLinkCode` and `touchActiveZaloBotLinkFromWebhook` write the final `processed` event record in the same Firestore transaction as their link/pending mutations. `recordIgnoredZaloBotWebhookEvent` handles valid non-mutating events. Event records contain `kind: 'zalo_bot_webhook'`, `eventName`, `messageId`, `outcome`, optional `staffId`, optional `linkedAt` and timestamps; a successful link also stores `confirmationStatus: 'pending'` for scheduled crash repair. No event record contains a raw chat ID.
- Keep raw `chatId` only inside server-only link/pending documents because it is required for delivery.
- In the transaction, reject an active claim whose `staffId` differs from the target staff.
- Preserve `linkedAt`; update `lastSeenAt` when an already linked chat sends an update.

- [ ] **Step 4: Verify repository behavior**

Run: `npx.cmd vitest run server/api/zalo-bot/linkRepository.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add server/api/zalo-bot/linkRepository.ts server/api/zalo-bot/linkRepository.test.ts
git commit -m "feat: add atomic zalo bot linking"
~~~

## Task 4: Webhook and Authenticated Link APIs

**Files:**

- Create: `server/api/zalo-bot/webhookHandler.ts`
- Create: `server/api/zalo-bot/webhookHandler.test.ts`
- Create: `server/api/zalo-bot/linkHandlers.ts`
- Create: `server/api/zalo-bot/linkHandlers.test.ts`
- Create: `server/api/zalo-bot/routeHandler.ts`
- Create: `api/zalo-bot/action.test.ts`
- Modify: `api/zalo/[action].ts`
- Modify: `api/zalo/action.test.ts`
- Modify: `vercel.json`

**Consumes:** Zalo webhook POSTs, Firebase bearer auth for staff/admin APIs.

**Produces:** Self-link status/code, admin overview/link/unlink actions, safe webhook acknowledgements.

- [ ] **Step 1: Write failing route and handler tests**

Test this route matrix:

| Action | Method | Auth |
|---|---|---|
| `webhook` | POST | `X-Bot-Api-Secret-Token` |
| `my-link` | GET | teacher/office/admin |
| `create-link-code` | POST | teacher/office/admin |
| `unlink` | POST | teacher/office/admin, self only |
| `admin-overview` | GET | admin |
| `admin-link` | POST | admin |
| `admin-unlink` | POST | admin |

Webhook assertions:

- Missing or wrong secret returns `403` before any body parsing or Firestore call; compare equal-length secret buffers with `timingSafeEqual`.
- Accepts only the official envelope `ok: true`, `result.event_name` and `result.message`; derives the event ID from `result.message.message_id`, never from a nonexistent `updateId`.
- A `GROUP` chat returns `200` with `{ ignored: true, reason: 'group_chat_not_supported' }` without recording a pending chat, link or raw group chat ID.
- A `/link CODE` message consumes the code and returns a fixed success acknowledgement without invoking any conversational logic.
- A normal message is recorded as pending when unlinked and returns `200` with `ignored: true`.
- A normal message from an active linked chat only updates `lastSeenAt`; no conversational response is sent.
- Duplicate webhook messages are deduplicated using `_maintenance/zaloBotWebhook_<message.message_id>`; a replay returns the stored outcome and does not consume a code or increment the rate limiter again.
- The official sender object has no required `username`; pending and overview DTOs omit it when absent.
- Malformed bodies return `400`; valid updates without a text message return `200` and are ignored.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/webhookHandler.test.ts server/api/zalo-bot/linkHandlers.test.ts api/zalo-bot/action.test.ts`

Expected: FAIL because the handlers and router do not exist.

- [ ] **Step 3: Implement handlers and explicit dispatch**

Use this router shape:

~~~ts
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res)) return;
  const action = String(req.query.action || '');

  if (action === 'webhook') {
    return handleZaloBotWebhook(req, res);
  }

  if (action.startsWith('admin-')) {
    const verified = await verifyAuthContext(req, res, ['admin']);
    if (!verified) return;
    return dispatchZaloBotAdminAction(action, req, res, verified.context);
  }

  const verified = await verifyAuthContext(req, res, ['teacher', 'office', 'admin']);
  if (!verified) return;
  return dispatchZaloBotSelfAction(action, req, res, verified.context);
}
~~~

Add rewrite before the generic `/api/v1/:path*` rewrite:

~~~json
{
  "source": "/api/v1/zalo-bot/:action*",
  "destination": "/api/zalo-bot/:action*"
}
~~~

Parse the webhook with a strict outer contract and passthrough only inside provider-owned objects:

~~~ts
const zaloBotWebhookSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    event_name: z.string().min(1),
    message: z
      .object({
        from: z.object({
          id: z.string().min(1),
          display_name: z.string().default(''),
          is_bot: z.boolean().optional(),
        }),
        chat: z.object({
          id: z.string().min(1),
          chat_type: z.enum(['PRIVATE', 'GROUP']),
        }),
        text: z.string().optional(),
        message_id: z.string().min(1),
        date: z.number().optional(),
      })
      .optional(),
  }),
});
~~~

For `message.text.received`, pass `message.message_id` as `webhookEventId` into the repository transaction. For non-text events, write a bounded processed marker containing no raw chat ID. The HTTP JSON acknowledgement is not a chat reply; link confirmation is added through the ledger/outbox in Task 12.

All mutations call `writeRequiredAuditLog` with collection `zalo_bot_links`, document ID equal to staff ID, actor role and metadata containing only `linkedMethod`, `linkStatus` and `chatIdHash`.

`admin-overview` returns:

~~~ts
export type ZaloBotAdminOverview = {
  links: Array<Omit<ZaloBotLink, 'chatId'>>;
  pendingChats: Array<Omit<PendingZaloBotChat, 'chatId'>>;
  staff: Array<{
    uid: string;
    displayName: string;
    email: string;
    role: ZaloBotStaffRole;
  }>;
  recentMessages: Array<Omit<ZaloBotMessage, 'contentSnapshot'>>;
};
~~~

Do not return raw chat IDs, code hashes or secrets to the browser.

`my-link` and `admin-overview` also return `botEnabled: boolean`. When `ZALO_BOT_ENABLED=false`, code/link mutations return `503` with `errorCode: 'zalo_bot_disabled'`; webhook still authenticates and acknowledges safely but performs no link mutation.

- [ ] **Step 4: Verify APIs**

Run: `npx.cmd vitest run server/api/zalo-bot/webhookHandler.test.ts server/api/zalo-bot/linkHandlers.test.ts api/zalo-bot/action.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add server/api/zalo-bot api/zalo-bot vercel.json
git commit -m "feat: add zalo bot linking api"
~~~

## Task 5: Staff Self-Link UI

**Files:**

- Create: `src/lib/zalo/zaloBotService.ts`
- Create: `src/lib/zalo/zaloBotService.test.ts`
- Create: `src/components/zalo/ZaloBotLinkCard.tsx`
- Create: `src/components/zalo/ZaloBotLinkCard.test.tsx`
- Create: `src/pages/common/Profile.zaloBot.test.tsx`
- Modify: `src/pages/common/Profile.tsx`

**Consumes:** Authenticated link endpoints.

**Produces:** A simple Profile workflow that tells staff exactly how to link their private Zalo chat.

- [ ] **Step 1: Write failing service and component tests**

Test:

- On mount, card loads `/api/v1/zalo-bot/my-link`.
- When `my-link` returns `botEnabled: false`, the card renders an unavailable notice and no create/unlink mutation control.
- “Tạo mã liên kết” POSTs `/create-link-code`, displays the 8-character code and expiry.
- Instructions show `Mở bot Zalo → gửi /link <CODE>`.
- Active state shows linked display name, linked method and last linked time, but never raw chat ID.
- “Hủy liên kết” asks for confirmation, POSTs `/unlink`, then reloads status.
- `needs_relink` state explains that the chat is no longer valid and offers a new code.
- Card renders only for teacher, office and admin.
- Copy button copies the full `/link CODE` command and displays success feedback.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx.cmd vitest run src/lib/zalo/zaloBotService.test.ts src/components/zalo/ZaloBotLinkCard.test.tsx src/pages/common/Profile.zaloBot.test.tsx`

Expected: FAIL because service/card integration is absent.

- [ ] **Step 3: Implement typed service and card**

Expose:

~~~ts
export function getMyZaloBotLink(): Promise<{
  botEnabled: boolean;
  link: Omit<ZaloBotLink, 'chatId'> | null;
}>;

export function createMyZaloBotLinkCode(): Promise<{
  code: string;
  expiresAt: string;
}>;

export function unlinkMyZaloBotChat(): Promise<{ success: true }>;
~~~

Mount `ZaloBotLinkCard` inside the existing Profile security tab, below phone management and above Google account linking. Keep UI copy inside the component for this feature; provide Vietnamese and English variants using `useLanguage`.

- [ ] **Step 4: Verify UI behavior**

Run: `npx.cmd vitest run src/lib/zalo/zaloBotService.test.ts src/components/zalo/ZaloBotLinkCard.test.tsx src/pages/common/Profile.zaloBot.test.tsx`

Expected: PASS.

Run: `npx.cmd eslint src/lib/zalo/zaloBotService.ts src/components/zalo/ZaloBotLinkCard.tsx src/pages/common/Profile.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/lib/zalo/zaloBotService.ts src/lib/zalo/zaloBotService.test.ts src/components/zalo/ZaloBotLinkCard.tsx src/components/zalo/ZaloBotLinkCard.test.tsx src/pages/common/Profile.tsx src/pages/common/Profile.zaloBot.test.tsx
git commit -m "feat: add staff zalo bot self linking"
~~~

## Task 6: Admin Manual-Link Management

**Files:**

- Create: `src/components/zalo/ZaloBotManagementPanel.tsx`
- Create: `src/components/zalo/ZaloBotManagementPanel.test.tsx`
- Modify: `src/lib/zalo/zaloBotService.ts`
- Modify: `src/lib/zalo/zaloBotService.test.ts`
- Modify: `src/pages/admin/ZaloOA.tsx`
- Modify: `src/pages/admin/ZaloOA.test.tsx`

**Consumes:** Sanitized admin overview and admin mutation endpoints.

**Produces:** Admin can pair one pending Zalo chat with one staff account and unlink it.

- [ ] **Step 1: Write failing admin panel tests**

Test:

- Panel heading says “Zalo Bot nội bộ” and explains it is separate from OA/ZNS.
- Pending chat rows show display name, optional username when present and last-seen time; missing username never renders `undefined` or blocks linking.
- Staff selector includes only teacher/office/admin and indicates active/unlinked state.
- Link button POSTs `{ staffId, chatIdHash }` to `/admin-link`.
- UI refuses to submit without both a pending chat and staff selection.
- Unlink POSTs `{ staffId }` to `/admin-unlink`.
- Successful mutation refreshes overview; failed mutation preserves selection and shows provider-safe error.
- Raw `chatId` is never expected or rendered.
- When `botEnabled` is false, the panel is read-only and explains that server configuration must be enabled before linking.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx.cmd vitest run src/components/zalo/ZaloBotManagementPanel.test.tsx src/lib/zalo/zaloBotService.test.ts src/pages/admin/ZaloOA.test.tsx`

Expected: FAIL because management methods/panel are absent.

- [ ] **Step 3: Implement the panel and integrate it**

Add typed service methods:

~~~ts
export function getZaloBotAdminOverview(): Promise<ZaloBotAdminOverview>;
export function adminLinkZaloBotChat(input: {
  staffId: string;
  chatIdHash: string;
}): Promise<{ success: true }>;
export function adminUnlinkZaloBotStaff(staffId: string): Promise<{ success: true }>;
~~~

Render `ZaloBotManagementPanel` above the existing OA history section. Keep OA status/history/manual-send behavior unchanged.

- [ ] **Step 4: Verify admin management**

Run: `npx.cmd vitest run src/components/zalo/ZaloBotManagementPanel.test.tsx src/lib/zalo/zaloBotService.test.ts src/pages/admin/ZaloOA.test.tsx`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/components/zalo/ZaloBotManagementPanel.tsx src/components/zalo/ZaloBotManagementPanel.test.tsx src/lib/zalo/zaloBotService.ts src/lib/zalo/zaloBotService.test.ts src/pages/admin/ZaloOA.tsx src/pages/admin/ZaloOA.test.tsx
git commit -m "feat: add admin zalo bot link management"
~~~

## Task 7: Pure Digest Rules and Message Composer

**Files:**

- Create: `server/api/zalo-bot/digestTypes.ts`
- Create: `server/api/zalo-bot/digestRules.ts`
- Create: `server/api/zalo-bot/digestRules.test.ts`
- Create: `server/api/zalo-bot/digestComposer.ts`
- Create: `server/api/zalo-bot/digestComposer.test.ts`

**Consumes:** A normalized daily source bundle with no Firestore objects.

**Produces:** Recipient-keyed reminder items and role-specific text capped at 2.000 characters.

- [ ] **Step 1: Write failing business-rule tests**

Define normalized inputs:

~~~ts
export type AttendanceDigestSource = {
  classId: string;
  className: string;
  date: string;
  scheduled: boolean;
  sessionStatus: 'unconfirmed' | 'taught' | 'cancelled' | 'makeup';
  primaryTeacherId: string;
  effectiveTeacherId: string;
  eligibleStudentIds: string[];
  markedStudentIds: string[];
};

export type CourseClosingDigestSource = {
  classId: string;
  className: string;
  primaryTeacherId: string;
  endDate: string;
  snapshot: CourseClosingSnapshot;
};

export type PrintDigestSource = {
  requestId: string;
  className: string;
  teacherName: string;
  neededDate: string;
  status: PrintRequestStatus;
  fileCount: number;
  totalCopies: number;
};

export type ActiveZaloBotRecipient = {
  staffId: string;
  role: ZaloBotStaffRole;
  displayName: string;
  chatIdHash: string;
};

export type ZaloBotDigestSourceCounts = {
  classes: number;
  sessions: number;
  attendanceRows: number;
  printRequests: number;
  activeLinks: number;
  eligibleRecipients: number;
  outstandingFailedMessages: number;
  potentialTruncation: string[];
};

export type DailyDigestRuleInput = {
  digestDate: string;
  tomorrowDate: string;
  activeRecipients: ActiveZaloBotRecipient[];
  attendance: AttendanceDigestSource[];
  courseClosing: CourseClosingDigestSource[];
  printRequests: PrintDigestSource[];
  sourceCounts: ZaloBotDigestSourceCounts;
};

export type AttendanceReminderItem = Pick<
  AttendanceDigestSource,
  'classId' | 'className' | 'date'
> & { missingStudentCount: number };

export type CourseClosingReminderItem = Pick<
  CourseClosingDigestSource,
  'classId' | 'className' | 'endDate'
> & { snapshotStatus: CourseClosingSnapshot['status'] };

export type PrintReminderItem = Omit<PrintDigestSource, 'status'>;

export type AdminDigestSummary = {
  linkedRecipients: number;
  eligibleRecipients: number;
  missingAttendanceClasses: number;
  courseClosingClasses: number;
  pendingPrintRequests: number;
  outstandingFailedMessages: number;
  potentialTruncation: string[];
};
~~~

Test the full decision matrix:

- Attendance included when the date is normally scheduled **or** an explicit `class_sessions` row has status `taught`/`makeup`; only `cancelled` is excluded. This preserves attendance reminders for makeup sessions on non-regular days.
- Attendance item goes to `effectiveTeacherId`; an accepted substitute wins over session and class teacher.
- Extra attendance rows for ineligible students do not make a session complete.
- Course closing included only at D-7, D-3 or D-1 and only when snapshot status is not `completed` or `no_required_students`.
- Course closing item always goes to `primaryTeacherId`, never the substitute.
- Print request included only when status is `pending` and `neededDate <= tomorrow`; overdue requests remain included.
- Every active office link receives the same current print queue.
- Every active admin link receives counts even when every count is zero.
- `outstandingFailedMessages` means ledger rows already in `failed` state at the collector cutoff, before the current digest is enqueued. The admin copy labels it “lỗi tồn đọng trước lần chạy này”; it never claims to include delivery failures from the digest currently being generated.
- Teacher/office recipients with no items are omitted.

- [ ] **Step 2: Write failing composer tests**

Assert:

- Teacher message groups “Điểm danh còn thiếu” and “Sắp kết khóa”.
- Office message includes needed date, class, teacher, file count and total copies.
- Admin message includes recipient/link counts, missing-attendance class count, course-closing count, print count, outstanding failed-message count as of generation, source truncation warnings and dry-run state.
- Output remains at most 2.000 UTF-16 code units.
- A long list is cut only between complete lines and ends with `Xem chi tiết: <APP_URL>`.
- The same input produces byte-for-byte stable output for idempotent snapshots.

- [ ] **Step 3: Run tests and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/digestRules.test.ts server/api/zalo-bot/digestComposer.test.ts`

Expected: FAIL because rules/composer do not exist.

- [ ] **Step 4: Implement pure selection and composition**

Expose:

~~~ts
export type ZaloBotDigestRecipient = {
  staffId: string;
  role: ZaloBotStaffRole;
  attendance: AttendanceReminderItem[];
  courseClosing: CourseClosingReminderItem[];
  printRequests: PrintReminderItem[];
  adminSummary?: AdminDigestSummary;
};

export type ZaloBotDigestPlan = Map<string, ZaloBotDigestRecipient>;

export function buildZaloBotDigestPlan(input: DailyDigestRuleInput): ZaloBotDigestPlan;

export function composeZaloBotDigest(
  recipient: ZaloBotDigestRecipient,
  input: { digestDate: string; appUrl: string; dryRun: boolean }
): string;
~~~

Use date-only arithmetic from `date-fns` with `parseISO` and `differenceInCalendarDays`; do not parse date-only values through UTC midnight. Sort all items by class name then stable ID before composing.

- [ ] **Step 5: Verify and commit**

Run: `npx.cmd vitest run server/api/zalo-bot/digestRules.test.ts server/api/zalo-bot/digestComposer.test.ts`

Expected: PASS.

~~~bash
git add server/api/zalo-bot/digestTypes.ts server/api/zalo-bot/digestRules.ts server/api/zalo-bot/digestRules.test.ts server/api/zalo-bot/digestComposer.ts server/api/zalo-bot/digestComposer.test.ts
git commit -m "feat: add zalo bot digest rules"
~~~

## Task 8: Firestore Digest Source Collector

**Files:**

- Create: `server/api/zalo-bot/digestSources.ts`
- Create: `server/api/zalo-bot/digestSources.test.ts`

**Consumes:** Firestore, digest date, existing schedule/eligibility/course-closing helpers.

**Produces:** `DailyDigestRuleInput` with bounded, normalized reads.

- [ ] **Step 1: Write failing source tests**

Use a Firestore fake with query call tracking. Test these exact bounds:

- `MAX_ACTIVE_CLASSES = 2_000`, `MAX_DATE_ROWS = 5_000`, `MAX_PENDING_PRINTS = 2_000`, `MAX_ACTIVE_LINKS = 2_000`, `MAX_FAILED_MESSAGES = 2_000`.
- Every bounded query requests `MAX + 1`, truncates the normalized result to `MAX`, and adds the collection name to `sourceCounts.potentialTruncation` when the extra row exists.
- Reads `class_sessions`, `substitute_requests` and `attendance` for exactly the digest date.
- Reads pending `print_requests` and filters by canonical `neededDate`.
- Reads active `zalo_bot_links`, current `users` documents and outstanding `zalo_bot_messages` with `status === 'failed'`.
- Includes a linked recipient only when the user exists, `blockedTeacher !== true`, the current role is teacher/office/admin and equals the role stored on the link.
- Merges canonical `student_course_enrollments` with legacy current-class students, then calls `resolveAttendanceEligibilityBatch`.
- Excludes students whose resolution is `not_enrolled` or `on_leave`.
- Resolves effective teacher with `getEffectiveTeacherIdForSession`.
- Uses `isExpectedClassSessionOnDate` for regular sessions, while preserving an explicit `taught`/`makeup` `class_sessions` row on a non-regular date. Archived classes without an explicit actual session and holidays without an explicit makeup session do not create reminders.
- Calls `computeCourseClosingSnapshot` only for classes whose end date is D-7, D-3 or D-1.
- Limits course-closing computations to ten concurrent promises.
- Splits `db.getAll` student references into chunks of at most 300 and proves no per-attendance-cell student query occurs.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/digestSources.test.ts`

Expected: FAIL because the collector is absent.

- [ ] **Step 3: Implement the collector with existing domain helpers**

Expose:

~~~ts
export async function collectZaloBotDigestSources(
  db: Firestore,
  input: { digestDate: string; tomorrowDate: string }
): Promise<DailyDigestRuleInput>;
~~~

Reuse:

- `getVietnamTodayStr`, `isExpectedClassSessionOnDate` from `shared/classSchedule.ts`.
- `buildClassTerms` from `shared/studentEnrollmentTimeline.ts`.
- `resolveAttendanceEligibilityBatch` from `server/api/lib/attendance/sessionEligibility.ts`.
- `getEffectiveTeacherIdForSession` from `shared/teacherAttendance.ts`.
- `computeCourseClosingSnapshot` from `server/api/classes/helpers/courseClosing.ts`.

Query strategy:

1. Load classes, same-day sessions/substitutes/attendance, pending prints, active links, relevant users and outstanding failed Zalo ledgers in parallel using the exact constants above.
2. Build maps by class/date and staff ID.
3. For each normally expected class or explicit `taught`/`makeup` session, resolve the current course term and candidate roster.
4. Batch student document reads with `db.getAll` in chunks of 300; never perform one independent student query per attendance cell.
5. Normalize documents to plain strings/numbers before calling pure rules.
6. Count only pre-existing `failed` ledger rows as `outstandingFailedMessages`; current-run delivery outcomes are intentionally not part of this digest.
7. Return source counts so the admin summary can expose truncation or collection-limit warnings.

- [ ] **Step 4: Verify source collection**

Run: `npx.cmd vitest run server/api/zalo-bot/digestSources.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add server/api/zalo-bot/digestSources.ts server/api/zalo-bot/digestSources.test.ts
git commit -m "feat: collect zalo bot digest sources"
~~~

## Task 9: Outbox Retry Policy Extension

**Files:**

- Modify: `server/api/lib/jobs/outbox.ts`
- Modify: `server/api/lib/jobs/outbox.test.ts`

**Consumes:** Existing outbox jobs plus optional per-job retry policy.

**Produces:** Three-attempt Zalo jobs and a typed way to stop the current processing batch on provider authentication failure, without changing defaults for other job types.

- [ ] **Step 1: Write failing regression tests**

Add tests proving:

- Existing jobs without `maxAttempts` still use five attempts.
- A job created with `maxAttempts: 3` becomes `dead` on its third failed execution.
- A non-retryable handler error becomes `dead` immediately.
- An abort-batch handler error updates the current job then leaves later eligible jobs untouched.
- A handler error with `retryAfterMs` schedules `nextRunAt` from that bounded delay instead of the default exponential backoff.
- `createOutboxJob` still requires its existing third `StudentIdentityMutationContext` argument for both idempotent and non-idempotent jobs.
- Existing successful, stale-lock and idempotency tests remain green.

- [ ] **Step 2: Run the outbox tests and confirm failure**

Run: `npx.cmd vitest run server/api/lib/jobs/outbox.test.ts`

Expected: FAIL on the new policy assertions.

- [ ] **Step 3: Implement backward-compatible policy fields**

Add:

~~~ts
export class OutboxHandlerError extends Error {
  constructor(
    message: string,
    readonly options: {
      retryable: boolean;
      abortBatch: boolean;
      retryAfterMs?: number;
    }
  ) {
    super(message);
    this.name = 'OutboxHandlerError';
  }
}
~~~

Extend `OutboxJob` and only the second `createOutboxJob` input with optional `maxAttempts`; preserve the required third `StudentIdentityMutationContext` argument unchanged. Validate `maxAttempts` as an integer from 1 through 10 and store it in both idempotent and generated-ID job documents. In the catch branch:

~~~ts
const policyError = err instanceof OutboxHandlerError ? err : null;
const nextAttempts = claimedJob.attempts + 1;
const maxAttempts = claimedJob.maxAttempts ?? 5;
const terminal = policyError?.options.retryable === false || nextAttempts >= maxAttempts;
const boundedRetryAfterMs = policyError?.options.retryAfterMs
  ? Math.min(300_000, Math.max(5_000, policyError.options.retryAfterMs))
  : null;
~~~

Use `boundedRetryAfterMs` for `nextRunAt` when present; otherwise retain the existing exponential backoff. After persisting the failed/dead state, break the processing loop when `policyError?.options.abortBatch === true`.

- [ ] **Step 4: Verify no outbox regression**

Run: `npx.cmd vitest run server/api/lib/jobs/outbox.test.ts api/audit/outbox-process.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add server/api/lib/jobs/outbox.ts server/api/lib/jobs/outbox.test.ts
git commit -m "feat: add per-job outbox retry policy"
~~~

## Task 10: Message Ledger and Daily Digest Enqueue

**Files:**

- Create: `server/api/zalo-bot/messageRepository.ts`
- Create: `server/api/zalo-bot/messageRepository.test.ts`
- Create: `server/api/zalo-bot/digestService.ts`
- Create: `server/api/zalo-bot/digestService.test.ts`

**Consumes:** Digest plan, active links, feature flags.

**Produces:** Deterministic `zalo_bot_messages` records and idempotent `send_zalo_bot_message` outbox jobs.

- [ ] **Step 1: Write failing ledger state-machine tests**

Allowed transitions:

| From | To |
|---|---|
| new | pending, skipped |
| pending | processing, failed, skipped |
| failed | processing, failed, skipped |
| processing | sent, failed, skipped |
| sent | no further transition |
| skipped | no further transition |

Test optimistic claim so two workers cannot send the same ledger message. A fresh `processing` claim is busy; `processingStartedAt` older than five minutes is reclaimable by one worker, matching the existing outbox stale-lock window. Test that `attempts` increments in a second transaction immediately before a provider call, not on claim, stale inspection or cron re-runs.

Expose the generic ledger primitive used later by daily digests, link confirmations and admin test messages:

~~~ts
export async function createZaloBotMessageIfAbsent(
  db: Firestore,
  message: ZaloBotMessage
): Promise<'created' | 'existing'>;

export async function claimZaloBotMessageForDelivery(
  db: Firestore,
  input: { messageId: string; lockerId: string; now: string }
): Promise<'claimed' | 'busy' | 'terminal' | 'missing'>;

export async function beginZaloBotProviderAttempt(
  db: Firestore,
  input: { messageId: string; lockerId: string; now: string }
): Promise<{ attempt: number }>;
~~~

- [ ] **Step 2: Write failing digest service tests**

Test:

- Creates deterministic ID `daily_digest_<date>_<staffId>`.
- Creates one ledger and one outbox job with idempotency key `zalo-bot:<messageId>`.
- Sets `maxAttempts: 3`.
- Re-running the same date does not overwrite `contentSnapshot` or duplicate the job.
- Teacher/office with no reminder are skipped without creating a message.
- Every active admin receives a message even when summary counts are zero.
- Disabled and `needs_relink` links never receive jobs.
- A link whose current user is missing, has `blockedTeacher === true`, has a non-staff role or no longer matches the link role never receives a job.
- Dry run creates a `skipped` ledger with `errorCode: 'dry_run'` and no outbox job.
- Re-running a dry-run date after changing flags does not enqueue the terminal `skipped` ledger.
- Digest-disabled returns a skipped run result and writes no recipient ledger.

- [ ] **Step 3: Run tests and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/messageRepository.test.ts server/api/zalo-bot/digestService.test.ts`

Expected: FAIL because ledger/service modules do not exist.

- [ ] **Step 4: Implement idempotent enqueue**

Expose:

~~~ts
export async function runZaloBotDailyDigest(
  db: Firestore,
  input: {
    digestDate: string;
    tomorrowDate: string;
    config: ZaloBotConfig;
  }
): Promise<{
  digestDate: string;
  dryRun: boolean;
  recipients: number;
  enqueued: number;
  existing: number;
  skipped: number;
}>;
~~~

For each planned recipient:

1. Build the deterministic message ID.
2. Create the ledger document only if absent.
3. If dry run, store `status: 'skipped'` and stop.
4. Reload an existing ledger. Call `createOutboxJob` only when its canonical status is `pending` or `failed`; this repairs a crash between ledger creation and job creation without enqueueing a terminal dry-run `skipped` ledger.
5. Pass this required third argument to `createOutboxJob`:

~~~ts
{
  actorId: `job:zalo-bot-digest:${input.digestDate}`,
  operation: 'zalo_bot:enqueue-daily-digest',
}
~~~

6. Payload contains only `{ messageId }`; delivery reloads the canonical ledger, link and current user server-side.

Store `_maintenance/zaloBotDigest_<digestDate>` with run counts and `completedAt` only after every recipient has been handled.

- [ ] **Step 5: Verify and commit**

Run: `npx.cmd vitest run server/api/zalo-bot/messageRepository.test.ts server/api/zalo-bot/digestService.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

~~~bash
git add server/api/zalo-bot/messageRepository.ts server/api/zalo-bot/messageRepository.test.ts server/api/zalo-bot/digestService.ts server/api/zalo-bot/digestService.test.ts
git commit -m "feat: enqueue idempotent zalo bot digests"
~~~

## Task 11: Delivery Handler and Provider Failure Semantics

**Files:**

- Create: `server/api/zalo-bot/deliveryService.ts`
- Create: `server/api/zalo-bot/deliveryService.test.ts`
- Modify: `server/api/lib/jobs/productionHandlers.ts`
- Modify: `server/api/zalo-bot/messageRepository.ts`
- Modify: `server/api/zalo-bot/messageRepository.test.ts`
- Modify: `server/api/zalo-bot/linkRepository.ts`
- Modify: `server/api/zalo-bot/linkRepository.test.ts`

**Consumes:** Outbox `{ messageId }`, canonical message ledger, current active link, Bot API client.

**Produces:** Sent/failed/skipped message state, reclaimable ledger locks, relink status, critical admin incident and outbox control error.

- [ ] **Step 1: Write failing delivery tests**

Test:

- Claims pending ledger, reloads active link and current `users/{staffId}`, then sends exactly `contentSnapshot` only when the user exists, `blockedTeacher !== true`, the current role is eligible and matches the link.
- A second worker sees a fresh claim as busy; a five-minute-stale ledger claim is reclaimed once and proceeds.
- Success stores `status: 'sent'`, provider message ID and sent timestamp.
- Missing/disabled link or ineligible/current-role-mismatched user stores `status: 'skipped'` with a sanitized `errorCode` and performs no provider call.
- `invalid_chat` stores `status: 'skipped'`, marks link `needs_relink`, releases chat claim and completes the outbox handler.
- `rate_limited` forwards bounded `retryAfterMs`; provider `403`, `408`, `5xx`, network and timeout store a failed attempt and throw retryable `OutboxHandlerError`.
- Network/timeout failures set `deliveryAmbiguous: true`; the test and runbook state that the retry is at-least-once and can duplicate a message already accepted by Zalo.
- Third provider attempt stores terminal failed state; outbox policy prevents a fourth call.
- Only provider `401` creates one critical `admin_notifications` incident per Vietnam date and throws `OutboxHandlerError` with `abortBatch: true`; provider `403` never creates that incident.
- Other permanent provider errors store failed state and throw non-retryable `OutboxHandlerError`.
- Error text stored in Firestore is sanitized and contains no token, URL or raw chat ID.
- `ZALO_BOT_ENABLED=false` or dry run skips without a provider call.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/deliveryService.test.ts server/api/zalo-bot/messageRepository.test.ts server/api/zalo-bot/linkRepository.test.ts`

Expected: FAIL because delivery, reclaim and relink behavior are absent.

- [ ] **Step 3: Implement delivery and register one production handler**

Expose:

~~~ts
export async function deliverZaloBotMessage(
  db: Firestore,
  input: { messageId: string },
  deps: DeliveryDependencies
): Promise<void>;
~~~

Register:

~~~ts
registerOutboxHandler('send_zalo_bot_message', async (payload: unknown) => {
  const parsed = z.object({ messageId: z.string().min(1) }).parse(payload);
  await deliverZaloBotMessage(getDb(), parsed, {
    config: loadZaloBotConfig(),
    sendText: sendZaloBotText,
  });
});
~~~

The critical admin notification uses deterministic document ID `zalo_bot_auth_<digestDate>` so repeated jobs cannot flood admin.

Delivery order is fixed:

1. Claim/reclaim the ledger with a random `lockerId`.
2. Reload link and current user; skip without provider access when either is ineligible.
3. Call `beginZaloBotProviderAttempt` immediately before `sendText`, so ledger `attempts` reflects provider calls only.
4. On success, update `sent` only when `lockedBy` still matches.
5. On typed provider failure, update ledger first, then throw the matching `OutboxHandlerError`. Forward `retryAfterMs`; set `abortBatch` only for auth.
6. For `invalid_chat`, call a transaction-safe repository method that changes the link to `needs_relink` and releases the matching active chat claim.

Because `sendMessage` has no client idempotency parameter, reclaim/retry after an ambiguous provider call is at-least-once. Do not claim provider-level exactly-once delivery in tests, UI copy or runbook.

- [ ] **Step 4: Verify handler integration**

Run: `npx.cmd vitest run server/api/zalo-bot/deliveryService.test.ts server/api/zalo-bot/messageRepository.test.ts server/api/zalo-bot/linkRepository.test.ts server/api/lib/jobs/outbox.test.ts api/audit/outbox-process.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add server/api/zalo-bot/deliveryService.ts server/api/zalo-bot/deliveryService.test.ts server/api/zalo-bot/messageRepository.ts server/api/zalo-bot/messageRepository.test.ts server/api/zalo-bot/linkRepository.ts server/api/zalo-bot/linkRepository.test.ts server/api/lib/jobs/productionHandlers.ts
git commit -m "feat: deliver zalo bot outbox messages"
~~~

## Task 12: Replay-Safe Link Confirmation

**Files:**

- Create: `server/api/zalo-bot/linkConfirmationService.ts`
- Create: `server/api/zalo-bot/linkConfirmationService.test.ts`
- Modify: `server/api/zalo-bot/webhookHandler.ts`
- Modify: `server/api/zalo-bot/webhookHandler.test.ts`

**Consumes:** A committed webhook event outcome containing `staffId` and `linkedAt`, generic ledger primitive and outbox.

**Produces:** Exactly one deterministic link-confirmation ledger/job per successful link event, repairable after a crash between link commit and enqueue.

- [ ] **Step 1: Write failing confirmation and replay tests**

Test:

- Successful `/link CODE` commits the link/event transaction first, then calls the confirmation service.
- Message ID is `link_confirmation_<staffId>_<linkedAtEpoch>` and message type is `link_confirmation`.
- The outbox payload is only `{ messageId }`, idempotency key is `zalo-bot:<messageId>` and `maxAttempts` is three.
- `createOutboxJob` receives `{ actorId: 'webhook:zalo-bot', operation: 'zalo_bot:enqueue-link-confirmation' }` as its third argument.
- Replaying a processed webhook event reads stored `staffId`/`linkedAt` and calls the idempotent confirmation service again, repairing a crash after link commit without creating a second ledger or job.
- If the current link no longer has the same `linkedAt`, the stale event is skipped so an old confirmation cannot be sent to a newly linked chat.
- A repair scan queries at most 100 `_maintenance` rows by the single field `confirmationStatus === 'pending'`, verifies `kind === 'zalo_bot_webhook'` in memory, ensures each ledger/job, then marks that event `enqueued`; this avoids a new composite index and repairs the gap even if the provider never replays the webhook.
- Processed non-link events and failed link outcomes never create confirmation jobs.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/linkConfirmationService.test.ts server/api/zalo-bot/webhookHandler.test.ts`

Expected: FAIL because the confirmation service and replay repair are absent.

- [ ] **Step 3: Implement idempotent confirmation enqueue**

Expose:

~~~ts
export async function ensureZaloBotLinkConfirmation(
  db: Firestore,
  input: { staffId: string; linkedAt: string }
): Promise<{ messageId: string; ledger: 'created' | 'existing'; jobId: string }>;

export async function repairPendingZaloBotLinkConfirmations(
  db: Firestore,
  input?: { limit?: number }
): Promise<{ scanned: number; enqueued: number; skipped: number }>;
~~~

Reload the canonical link, require `status === 'active'` and exact `link.linkedAt === input.linkedAt`, then obtain `chatIdHash` and compose fixed confirmation text without raw chat ID. Create the ledger only if absent; when an existing canonical ledger is `pending` or `failed`, always ensure the deterministic outbox job exists. A replay of a terminal `sent`/`skipped` ledger performs no provider work.

The webhook handler uses the committed event outcome for both first delivery and replay repair. It never reconstructs `linkedAt` from the current clock. After `ensureZaloBotLinkConfirmation` succeeds, update the marker to `confirmationStatus: 'enqueued'`; if that update fails, the next replay/repair scan safely repeats the deterministic ensure operation.

- [ ] **Step 4: Verify confirmation integration**

Run: `npx.cmd vitest run server/api/zalo-bot/linkConfirmationService.test.ts server/api/zalo-bot/webhookHandler.test.ts server/api/zalo-bot/linkRepository.test.ts server/api/zalo-bot/messageRepository.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add server/api/zalo-bot/linkConfirmationService.ts server/api/zalo-bot/linkConfirmationService.test.ts server/api/zalo-bot/webhookHandler.ts server/api/zalo-bot/webhookHandler.test.ts
git commit -m "feat: enqueue replay-safe zalo link confirmations"
~~~

## Task 13: Admin Test Message API and UI

**Files:**

- Modify: `server/api/zalo-bot/linkHandlers.ts`
- Modify: `server/api/zalo-bot/linkHandlers.test.ts`
- Modify: `server/api/zalo-bot/routeHandler.ts`
- Modify: `api/zalo-bot/action.test.ts`
- Modify: `api/zalo/[action].ts`
- Modify: `api/zalo/action.test.ts`
- Modify: `src/lib/zalo/zaloBotService.ts`
- Modify: `src/lib/zalo/zaloBotService.test.ts`
- Modify: `src/components/zalo/ZaloBotManagementPanel.tsx`
- Modify: `src/components/zalo/ZaloBotManagementPanel.test.tsx`

**Consumes:** Admin auth, current eligible user/link, generic ledger and outbox.

**Produces:** Admin-only asynchronous test-message enqueue and status refresh; no provider call occurs in the request handler.

- [ ] **Step 1: Write failing API, service and UI tests**

Test:

- `POST /admin-test` is present in the admin dispatcher and rejects unauthenticated, teacher, office and accounting callers.
- Disabled bot, missing/non-active link, missing user, `blockedTeacher === true`, ineligible role or link/user role mismatch returns a safe `409`/`503` without ledger or job.
- A valid request creates `messageType: 'test'`, random UUID-based message ID, fixed content naming the target staff account, and a `send_zalo_bot_message` job with `maxAttempts: 3`.
- `createOutboxJob` receives `{ actorId: adminUid, operation: 'zalo_bot:admin-test' }` as its required third argument.
- The API returns the ledger ID and never invokes `sendZaloBotText` inline.
- `adminSendZaloBotTest(staffId)` POSTs `/api/v1/zalo-bot/admin-test`; the button appears only for an active, currently eligible link and refreshes recent message status after success.

- [ ] **Step 2: Run all affected tests and confirm failure**

Run: `npx.cmd vitest run server/api/zalo-bot/linkHandlers.test.ts api/zalo-bot/action.test.ts src/lib/zalo/zaloBotService.test.ts src/components/zalo/ZaloBotManagementPanel.test.tsx`

Expected: FAIL on the absent action/service/button.

- [ ] **Step 3: Implement asynchronous admin test enqueue**

Add `admin-test` to the existing admin dispatcher. Generate the ledger ID with `randomUUID()`, persist fixed text, then create the deterministic outbox job with payload `{ messageId }`. Reuse the same delivery handler as daily digests and confirmations.

Add:

~~~ts
export function adminSendZaloBotTest(
  staffId: string
): Promise<{ success: true; messageId: string }>;
~~~

After success, refresh `admin-overview`; do not optimistically label the message sent.

- [ ] **Step 4: Verify every modified surface**

Run: `npx.cmd vitest run server/api/zalo-bot/linkHandlers.test.ts api/zalo-bot/action.test.ts src/lib/zalo/zaloBotService.test.ts src/components/zalo/ZaloBotManagementPanel.test.tsx server/api/zalo-bot/deliveryService.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add -- server/api/zalo-bot/linkHandlers.ts server/api/zalo-bot/linkHandlers.test.ts server/api/zalo-bot/routeHandler.ts api/zalo-bot/action.test.ts 'api/zalo/[action].ts' api/zalo/action.test.ts src/lib/zalo/zaloBotService.ts src/lib/zalo/zaloBotService.test.ts src/components/zalo/ZaloBotManagementPanel.tsx src/components/zalo/ZaloBotManagementPanel.test.tsx
git commit -m "feat: add admin zalo bot test messages"
~~~

## Task 14: Serverless Cron, Immediate Dispatch and Catch-Up

**Files:**

- Create: `api/audit/zalo-bot-daily-digest.test.ts`
- Modify: `api/audit/[action].ts`
- Modify: `api/audit/daily-maintenance.test.ts`
- Modify: `vercel.json`
- Modify: `vercel.config.test.mjs`

**Consumes:** Vercel Cron bearer secret or authorized admin manual invocation.

**Produces:** Daily digest generation at 21:30 Vietnam time, immediate bounded outbox processing and 01:00 catch-up.

- [ ] **Step 1: Write failing cron tests**

Test:

- Accepts a timing-safe valid `Authorization: Bearer <CRON_SECRET>` or Firebase-authenticated `admin` manual invocation.
- Rejects missing/invalid bearer, unauthenticated, teacher, office and accounting callers. Do not reuse existing `authorizeJob`, because it permits accounting.
- Accepts GET and POST only.
- Normal mode uses current Vietnam date and next Vietnam date.
- `mode=catch-up` chooses the previous Vietnam date and skips when `_maintenance/zaloBotDigest_<date>.completedAt` exists.
- Calls `runTrackedJob` with kind `zalo_bot_daily_digest`.
- Calls `repairPendingZaloBotLinkConfirmations(db, { limit: 100 })` before digest generation and reports its counts separately.
- Initializes production handlers and calls `processOutboxJobs(db, 'zalo-bot-daily-digest')` after enqueue.
- Response separates generation counts from delivery counts.
- Repeated invocation returns success without duplicate messages.
- Existing daily maintenance includes `/api/audit/zalo-bot-daily-digest?mode=catch-up`.
- Vercel config schedules digest at `30 14 * * *` and a second outbox drain at `35 14 * * *`.
- Student-identity maintenance guard returns the existing blocked response before generation/outbox mutation; the next scheduled/catch-up run remains safe.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx.cmd vitest run api/audit/zalo-bot-daily-digest.test.ts api/audit/daily-maintenance.test.ts`

Expected: FAIL because action/cron fan-out is absent.

- [ ] **Step 3: Implement the audit action**

Add dispatcher action `zalo-bot-daily-digest`. Its handler:

1. Authorizes with a dedicated helper: return true for `isCronAuthorized(req)`; otherwise call `verifyAuthToken(req, res, ['admin'])`. Never call the broader `authorizeJob` helper.
2. Runs `guardStudentIdentityRouteMutation` with surface `audit_jobs` and action `zalo-bot-daily-digest`, matching the current outbox mutation contract.
3. Calculates `digestDate` with `getVietnamTodayStr`. Calculate adjacent date keys with `format(addDays(parseISO(digestDate), delta), 'yyyy-MM-dd')`; do not use `toISOString()` date slicing.
4. Loads `ZaloBotConfig`.
5. Calls `runTrackedJob` with kind `zalo_bot_daily_digest`; inside the runner call `repairPendingZaloBotLinkConfirmations(db, { limit: 100 })` and then `runZaloBotDailyDigest`.
6. Calls `initOutboxHandlers()` and one bounded `processOutboxJobs` pass.
7. Returns `200` with confirmation-repair, generation and delivery summaries; returns `502` if generation succeeds but delivery has failures.

Add to Vercel cron:

~~~json
{
  "path": "/api/audit/zalo-bot-daily-digest",
  "schedule": "30 14 * * *"
},
{
  "path": "/api/audit/outbox-process",
  "schedule": "35 14 * * *"
}
~~~

`14:30 UTC` equals `21:30 Asia/Ho_Chi_Minh`. The 21:35 outbox drain catches jobs left by a bounded or interrupted immediate pass. Keep the existing `0 18 * * *` daily-maintenance cron; it runs at 01:00 Vietnam time and invokes catch-up. Exact minute execution requires a Vercel plan with minute-level cron precision; Hobby only guarantees invocation within the scheduled hour.

- [ ] **Step 4: Verify serverless scheduling**

Run: `npx.cmd vitest run api/audit/zalo-bot-daily-digest.test.ts api/audit/daily-maintenance.test.ts api/audit/outbox-process.test.ts vercel.config.test.mjs`

Expected: PASS.

Run: `npx.cmd prettier --check vercel.json 'api/audit/[action].ts'`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add -- 'api/audit/[action].ts' api/audit/zalo-bot-daily-digest.test.ts api/audit/daily-maintenance.test.ts vercel.json vercel.config.test.mjs
git commit -m "feat: schedule zalo bot daily digest"
~~~

## Task 15: Rules, Environment, Runbook and End-to-End Verification

**Files:**

- Modify: `firestore.rules`
- Modify: `firestore.rules.test.mjs`
- Modify: `firestore.rules.emulator.test.ts`
- Modify: `.env.example`
- Create: `docs/zalo-bot-runbook.md`
- Modify: `docs/production-runbook.md`

**Consumes:** Completed implementation; staging credentials are not required to commit this task.

**Produces:** Explicit server-only rules, reproducible deployment instructions and a separate post-commit pilot/rollback gate.

- [ ] **Step 1: Write one failing structural test plus emulator regressions**

In `firestore.rules.test.mjs`, parse one `match` block per collection and assert that each exact block contains `allow read, write: if false;`. This structural assertion must fail before the explicit blocks are added even though the existing catch-all already denies unknown collections.

In `firestore.rules.emulator.test.ts`, for unauthenticated, teacher, office and admin client SDK contexts, assert read and write denial for:

- `zalo_bot_links`
- `zalo_bot_chat_claims`
- `zalo_bot_pending_chats`
- `zalo_bot_link_codes`
- `zalo_bot_messages`

Admin access must also be denied at Firestore rules level because admin management is server API only.

- [ ] **Step 2: Prove the structural test is red and the existing catch-all is already safe**

Run: `npx.cmd vitest run firestore.rules.test.mjs`

Expected: FAIL because the five explicit Zalo Bot blocks are absent.

Run: `npm.cmd run test:rules`

Expected: PASS because the existing catch-all deny already protects the collections; these emulator cases are regression coverage, not the red test.

- [ ] **Step 3: Add explicit deny rules and environment documentation**

Add one block per collection:

~~~text
match /zalo_bot_links/{id} {
  allow read, write: if false;
}
~~~

Apply the same deny rule to the other four collections.

Add to `.env.example`:

~~~dotenv
# Zalo Bot Platform for private staff notifications; server-only.
ZALO_BOT_TOKEN=
ZALO_BOT_WEBHOOK_SECRET=
ZALO_BOT_LINK_CODE_PEPPER=
ZALO_BOT_CHAT_HASH_SECRET=
ZALO_BOT_REQUEST_TIMEOUT_MS=10000
ZALO_BOT_ENABLED=false
ZALO_BOT_DAILY_DIGEST_ENABLED=false
ZALO_BOT_DRY_RUN=true
~~~

The runbook must contain exact procedures:

1. Create bot and obtain token in Zalo Bot Platform.
2. Generate three independent 32-byte secrets for webhook, link-code HMAC and chat-ID HMAC.
3. Configure webhook URL `https://<APP_URL>/api/zalo-bot/webhook` with the same `X-Bot-Api-Secret-Token`; verify only `PRIVATE` chats can link and `GROUP` events are ignored without persistence.
4. Document provider taxonomy: `401` auth/abort; `403`, `408`, `429` and `5xx` are not auth; unknown `400`/`404` does not invalidate a link unless the description is explicitly chat/recipient-related.
5. Document delivery semantics: deterministic ledger/outbox prevents duplicate cron enqueue, but timeout/network retry is at-least-once because Bot `sendMessage` has no client idempotency key. Operators must inspect `deliveryAmbiguous` before manually retrying a duplicate-sensitive message.
6. Deploy with bot enabled, digest disabled and dry run enabled.
7. Link 3–5 pilot accounts covering teacher, office and admin.
8. Run the cron endpoint manually with bearer `CRON_SECRET`; compare digest ledger with source screens and interpret `outstandingFailedMessages` as failures existing before this run.
9. Enable daily digest while retaining dry run for one business day.
10. Disable dry run for the pilot, verify sent/provider IDs, ambiguous attempts and error counts.
11. Expand linking to all staff only after the separate Pilot Rollout Gate passes.
12. Roll back by setting `ZALO_BOT_DAILY_DIGEST_ENABLED=false`; keep webhook/link records intact for investigation.

- [ ] **Step 4: Run complete verification**

Run focused feature suite:

~~~bash
npx.cmd vitest run shared/zaloBot.test.ts server/api/zalo-bot src/lib/zalo/zaloBotService.test.ts src/components/zalo/ZaloBotLinkCard.test.tsx src/components/zalo/ZaloBotManagementPanel.test.tsx src/pages/common/Profile.zaloBot.test.tsx src/pages/admin/ZaloOA.test.tsx api/zalo-bot/action.test.ts api/zalo/action.test.ts api/audit/zalo-bot-daily-digest.test.ts api/audit/daily-maintenance.test.ts api/audit/outbox-process.test.ts api/audit/cold-imports.test.ts api/serverless-budget.test.ts server/api/lib/jobs/outbox.test.ts vercel.config.test.mjs firestore.rules.test.mjs
~~~

Expected: PASS.

Run repository checks:

~~~bash
npm.cmd run test:rules
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
~~~

Expected: all commands exit 0.

Run secret scan:

~~~bash
rg --line-number "bot[0-9][0-9A-Za-z:_-]{18,}|^ZALO_BOT_(TOKEN|WEBHOOK_SECRET|LINK_CODE_PEPPER|CHAT_HASH_SECRET)=[^<[:space:]][^[:space:]]*" . --glob "!node_modules/**" --glob "!.git/**"
~~~

Expected: no real token or populated secret is found.

- [ ] **Step 5: Commit operational hardening**

~~~bash
git add firestore.rules firestore.rules.test.mjs firestore.rules.emulator.test.ts firestore.indexes.json .env.example docs/zalo-bot-runbook.md docs/production-runbook.md
git commit -m "docs: add zalo bot operations and security"
~~~

## Pilot Rollout Gate

Run this gate only after Task 15 is committed and a staging deployment with a real pilot bot is available. It is not part of the Task 15 commit and must pause for the operator credentials/deployment.

- [ ] Self-link succeeds in a `PRIVATE` chat; a `GROUP` `/link` is ignored and a second private chat cannot claim the same staff.
- [ ] Admin manual link succeeds only from a pending private chat.
- [ ] A teacher with incomplete regular attendance receives one private digest.
- [ ] An explicit makeup session on a non-regular day also produces an attendance reminder.
- [ ] The actual substitute receives the attendance item; the primary teacher retains course-closing items.
- [ ] Every linked office account receives the due/overdue pending print queue.
- [ ] Every linked admin receives daily totals, including a zero-count day; failure count is verified as the pre-run outstanding count.
- [ ] Duplicate cron invocation creates no duplicate ledger or outbox job. With no timeout/network ambiguity, it also creates no duplicate provider send.
- [ ] A forced chat/recipient-specific invalid response moves the link to `needs_relink`; an unknown `400`/`404` leaves the link unchanged.
- [ ] A forced `403` is retried without an auth incident. A forced `401` stops the current outbox batch and creates exactly one critical admin incident.
- [ ] A simulated timeout marks `deliveryAmbiguous: true`; the operator verifies the runbook warning before retry.
- [ ] With the app idle, Vercel Cron still invokes the serverless function and produces the digest.

## Final Release Gate

- [ ] Confirm the plan is tracked and all 15 task commits exist; unrelated working-tree changes were not staged.
- [ ] Confirm the feature flags remain `daily digest disabled` and `dry run enabled` in the first production deployment.
- [ ] Confirm Zalo Bot token/webhook secret are stored only in Vercel environment variables.
- [ ] Confirm provider requests never log their URL.
- [ ] Confirm the 21:30 digest, 21:35 outbox drain and 01:00 catch-up all appear in Vercel deployment configuration.
- [ ] Confirm one full pilot day has matching source counts, message ledger counts and provider delivery counts before widening rollout.
