# Thiết kế mở rộng Zalo Bot bằng Capability Registry

**Ngày:** 2026-08-22
**Trạng thái:** Đã duyệt trong brainstorming
**Phạm vi:** Nâng chất lượng trả lời và mở rộng bot nội bộ cho `teacher`, `office`, `accounting`, `admin`, gồm cả tra cứu và thao tác ghi có xác nhận trong chat

## 1. Bối cảnh

EduTrack đã có Zalo Bot chạy production với webhook, liên kết tài khoản, digest, audit, chống giao webhook trùng và hội thoại hỏi đáp cơ bản. Thiết kế này mở rộng thiết kế chỉ-đọc tại `docs/superpowers/specs/2026-08-16-zalo-bot-ai-chat-design.md`; các chốt bảo mật đã có vẫn giữ nguyên nếu tài liệu này không thay thế rõ ràng.

Hiện trạng cần tái sử dụng:

- `server/api/zalo-bot/chat/intentClassifier.ts` dùng Gemini để ánh xạ câu tiếng Việt vào schema nhỏ.
- `server/api/zalo-bot/chat/chatService.ts` kiểm tra liên kết, đọc lại vai trò, rate limit và chống xử lý trùng.
- `server/api/zalo-bot/chat/answerComposer.ts` tạo câu trả lời xác định, giới hạn 2.000 ký tự.
- `server/api/zalo-bot/chat/admin/adminChatDispatcher.ts` đã có 11 intent quản trị chỉ-đọc, phân giải thực thể và audit nhưng đang tắt bằng cờ cấu hình.
- `server/api/lib/auth/authz.ts` và các domain handler hiện tại là nguồn sự thật về quyền nghiệp vụ.
- Điểm danh, yêu cầu in, thông báo, phiếu thu/chi và ví học viên đã có luật nghiệp vụ trong các route/handler tương ứng.
- Tài chính đã có transaction và `finance_idempotency_keys`; bot phải dùng lại thay vì tạo một luật tài chính thứ hai.

Giới hạn hiện tại:

- Bộ intent cơ bản chỉ có sĩ số, danh sách học viên, ngày kết thúc, điểm danh hôm nay và việc cần làm.
- Admin data assistant đã được xây nhưng chưa bật; các vai trò khác chưa có catalog tra cứu tương ứng.
- `ZALO_BOT_STAFF_ROLES` chưa có `accounting`.
- Bot chỉ đọc. Không có bản xem trước bất biến, lệnh chờ hay xác nhận thao tác ghi.
- Một số luật mutation còn nằm trong API handler. Gọi lại route qua HTTP hoặc chép luật vào bot đều tạo nguy cơ lệch hành vi với web app.

## 2. Mục tiêu

- Cho phép bốn vai trò nội bộ hỏi tự nhiên bằng tiếng Việt trong đúng phạm vi họ được xem trên web app.
- Trả lời thích ứng: kết luận trước, chi tiết sau, phân trang khi dài và hỏi đúng một thông tin khi còn mơ hồ.
- Mở một catalog thao tác ghi có kiểm soát cho lớp/điểm danh, văn phòng/thông báo và tài chính/quản trị.
- Mọi mutation có bản xem trước và chỉ chạy sau lệnh chính xác `XÁC NHẬN <mã>` trong chat riêng.
- Quyền được ép ở code và domain service, không dựa vào prompt hoặc vai trò lưu trong link cũ.
- Mỗi lệnh thực hiện tối đa một lần, kể cả webhook bị gửi lại, người dùng xác nhận lặp hoặc hai worker chạy đồng thời.
- Có audit, khả năng tắt riêng từng capability và rollout theo tài khoản thí điểm.
- Giữ nguyên webhook, luồng `/link`, digest và các intent đang hoạt động khi registry mới bị tắt.

## 3. Ngoài phạm vi ban đầu

- Phụ huynh, học sinh và chat nhóm.
- Cho Gemini truy cập cơ sở dữ liệu, gọi tool nghiệp vụ hoặc tự thực hiện mutation.
- Tự động chạy mutation chỉ từ câu như “OK”, “đồng ý” hoặc dự đoán ý định.
- Xóa cứng dữ liệu. Catalog ban đầu chỉ hỗ trợ các hành vi có nghĩa nghiệp vụ như hủy hoặc void.
- Quản trị người dùng, đổi vai trò, cấp quyền và các mutation cơ sở hạ tầng.
- Dùng bot như một trình dựng báo cáo tùy ý hoặc truy vấn cơ sở dữ liệu tự do.
- Tự retry command đã chuyển sang `failed`. Người dùng phải tạo một bản xem trước mới sau lỗi trước khi xác nhận lại. Việc phục hồi worker chết khi command còn `executing` chỉ được phép bằng cùng idempotency key như mục 8.4.

## 4. Quyết định kiến trúc

Chọn kiến trúc **Capability Registry hybrid**.

Gemini chỉ làm nhiệm vụ hiểu ngôn ngữ và tạo `CapabilityDraft` có schema. Code sở hữu toàn bộ phần còn lại: allowlist capability, kiểm tra quyền, phân giải thực thể, đọc dữ liệu, dựng bản xem trước, lưu lệnh chờ, thực thi và audit.

Không chọn hai hướng sau:

- **LLM tool calling trực tiếp:** mở bề mặt rủi ro lớn, khó chứng minh quyền và khó giữ idempotency cho nghiệp vụ tài chính.
- **Một chuỗi `if/switch` intent cố định ngày càng dài:** dễ triển khai bước đầu nhưng buộc classifier, quyền, resolver, composer và executor dính vào nhau khi catalog mở rộng.

Registry tạo một ranh giới thống nhất nhưng từng capability vẫn là module nhỏ, có schema và test riêng.

### 4.1 Luồng tổng quát

```text
Zalo webhook
  -> xác thực webhook + chống giao trùng
  -> giải chat riêng thành staffId
  -> đọc lại user context và trạng thái link
  -> conversation coordinator
       |-- lệnh hệ thống: TRỢ GIÚP / TIẾP / HỦY / XÁC NHẬN / TRẠNG THÁI
       '-- câu tự nhiên
            -> parser xác định trước, nếu khớp
            -> Gemini classifier có schema, nếu cần
            -> registry lookup + feature gates
            -> entity resolver trong tập được phép
            -> domain authorization
                 |-- read: query -> deterministic composer -> gửi câu trả lời
                 '-- write: prepare preview -> lưu pending command -> gửi mã
                                              |
                             XÁC NHẬN <mã> ----'
                                              -> claim atomically
                                              -> đọc lại quyền
                                              -> kiểm state fingerprint
                                              -> execute domain service đúng một lần
                                              -> audit + lưu receipt
                                              -> gửi receipt
```

Parser xác định chạy trước Gemini để các lệnh xác nhận, hủy, trạng thái và một số câu lệnh rõ ràng vẫn hoạt động khi Gemini gián đoạn.

### 4.2 Giao diện capability

Mỗi capability khai báo tối thiểu:

```ts
type CapabilityMode = 'read' | 'write';

type CapabilityDefinition<Draft, Args, Preview, Result> = {
  name: string;
  version: number;
  mode: CapabilityMode;
  allowedRoles: ZaloBotStaffRole[];
  sensitivity: 'normal' | 'personal' | 'financial';
  draftSchema: Schema<Draft>;
  resolve(context: BotActorContext, draft: Draft): Promise<Args>;
  authorize(context: BotActorContext, args: Args): Promise<void>;
  read?: (context: BotActorContext, args: Args) => Promise<Result>;
  prepare?: (context: BotActorContext, args: Args) => Promise<{
    preview: Preview;
    stateFingerprint: string;
  }>;
  execute?: (context: BotActorContext, command: ConfirmedCommand<Args>) => Promise<Result>;
  compose(result: Result | Preview): string;
};
```

Các kiểu thực tế dùng TypeScript và validator hiện có của repo. `execute` không nhận câu người dùng hay output thô của Gemini; nó chỉ nhận ID chuẩn và tham số đã validate được đóng băng trong lệnh chờ.

### 4.3 Năm lớp quyền

Một yêu cầu chỉ được chạy khi đồng thời thỏa mãn:

1. Vai trò hiện tại của user khớp với vai trò trong liên kết Zalo.
2. Vai trò nằm trong `allowedRoles` của capability.
3. Capability và vai trò đang được bật bởi feature gate.
4. Resolver chỉ tìm thực thể trong tập actor được phép biết.
5. Domain service hiện tại cho phép hành động cụ thể trên thực thể đó.

Registry là một trần quyền bổ sung, không thay thế authz của web app. Khi bị từ chối, câu trả lời không tiết lộ thực thể có tồn tại ngoài phạm vi hay không.

### 4.4 Dùng chung domain service

Bot không gọi loopback HTTP vào web app và không sao chép luật trong route. Trước khi đăng ký capability ghi, logic mutation tương ứng phải được tách thành server-only domain service có input/output typed. Route web hiện tại và bot cùng gọi service đó.

Các điểm tách chính:

- Điểm danh: từ `server/api/attendance/route.ts` thành service giữ nguyên eligibility, maintenance guard, transaction và audit.
- Yêu cầu in: dùng luật tạo/upload trong `server/api/knowledge-bank/handlers/printRequests.ts` và luật hủy/chuyển trạng thái trong `server/api/classes/handlers/classPrintRequestHandlers.ts`.
- Thông báo: dùng notification/outbox hiện có; receipt của bot phân biệt rõ `queued` với `delivered`.
- Tài chính: tái sử dụng service từ `server/api/finance/handlers/receipts.ts`, `expenses.ts`, `wallet.ts` và các idempotency key hiện có.

Refactor chỉ phục vụ đường dùng chung này; không thay đổi luật nghiệp vụ ngoài phạm vi bot.

## 5. Catalog capability ban đầu

Tên dưới đây là định danh ổn định dùng cho config, audit và metrics. Chi tiết mutation chỉ được mở khi domain service tương ứng đã được tách và có contract test với route web.

### 5.1 Tra cứu

| Nhóm | Capability | Vai trò tối đa |
|---|---|---|
| Lớp | `class.roster.count`, `class.roster.list`, `class.end_date`, `class.schedule` | teacher theo lớp phụ trách; office/admin theo authz |
| Điểm danh | `attendance.today`, `attendance.session_status`, `attendance.history` | teacher theo lớp phụ trách; office/admin theo authz |
| Công việc | `task.my`, `print_request.status`, `print_request.queue` | teacher xem của mình; office/admin theo authz |
| Học viên | `student.lookup`, `student.contact`, `student.academic` | office/admin; teacher chỉ trong lớp được phép và chỉ field được phép |
| Tài chính | `student.tuition`, `student.wallet`, `finance.receipts`, `finance.expenses`, `finance.center_summary` | accounting/admin |
| Nhân sự | `teacher.payroll` | admin và accounting chỉ khi authz hiện tại cho phép |
| Bot | `zalo.operations` | admin |

Năm base intent hiện có và 11 admin intent đã xây được bọc bằng adapter registry trước, không viết lại query. Các cờ admin cũ vẫn là chốt bổ sung trong giai đoạn chuyển đổi, nên deploy registry không tự bật dữ liệu quản trị.

### 5.2 Thao tác ghi

| Nhóm | Capability | Quy tắc chính |
|---|---|---|
| Điểm danh | `attendance.mark_or_correct` | Teacher chỉ buổi đủ điều kiện của lớp mình; office/admin chỉ khi domain authz cho phép |
| In ấn | `print_request.create` | Chỉ tạo sau khi file đã tải lên, kiểm MIME/kích thước và gắn asset ID hợp lệ |
| In ấn | `print_request.cancel` | Teacher chỉ yêu cầu của mình còn ở trạng thái cho phép |
| In ấn | `print_request.update_status` | Office/admin, theo state transition hiện có |
| Thông báo | `notification.queue` | Preview có kênh, đối tượng, số người nhận và nội dung; execute chỉ tạo outbox một lần |
| Phiếu thu | `finance.receipt.create_and_post`, `finance.receipt.void` | Accounting/admin; dùng idempotency và transaction hiện có; void bắt buộc lý do |
| Phiếu chi | `finance.expense.create_and_post`, `finance.expense.void` | Accounting/admin; dùng idempotency và transaction hiện có; void bắt buộc lý do |
| Ví học viên | `finance.wallet.allocate`, `finance.wallet.void` | Accounting/admin; giữ nguyên kiểm tra phụ thuộc ledger |

Không có capability “thực hiện tùy ý”. Mutation mới phải được thêm vào catalog, có schema, ma trận quyền, preview, fingerprint, executor và test riêng.

## 6. Vai trò

`shared/zaloBot.ts` mở rộng `ZALO_BOT_STAFF_ROLES` bằng `accounting`. Việc này chỉ cho phép lưu liên kết đúng kiểu; nó không tự bật digest, read hay write cho kế toán.

| Vai trò | Phạm vi bot |
|---|---|
| `teacher` | Lớp phụ trách, roster, lịch, điểm danh, công việc, yêu cầu in và thông báo lớp được phép |
| `office` | Vận hành học vụ, điểm danh còn thiếu, thông tin học viên được phép, hàng đợi in và thông báo nghiệp vụ |
| `accounting` | Học phí, ví, phiếu thu/chi và dòng tiền trong phạm vi authz; không sửa lớp hay điểm danh |
| `admin` | Mọi capability mà web app cho phép, nhưng vẫn qua registry, xác nhận, fingerprint và audit |

Các switch exhaustive hiện có cho ba vai trò phải được cập nhật và test. Daily digest cho `accounting` giữ tắt cho tới khi có thiết kế nội dung riêng.

## 7. Hội thoại và cách trả lời

### 7.1 Nguyên tắc composer

- Kết luận hoặc số liệu chính ở dòng đầu.
- Chi tiết, cảnh báo và hành động tiếp theo ở các dòng sau.
- Không dựa vào Markdown phức tạp mà client Zalo có thể không render.
- Mỗi tin không quá 2.000 ký tự.
- Danh sách dài trả trang đầu và lưu cursor tối thiểu; `TIẾP` lấy trang tiếp theo.
- Nếu phân giải được nhiều thực thể, hỏi đúng một câu và liệt kê tập ứng viên đã được lọc quyền.
- Không gửi dữ liệu kết quả từ database vào Gemini để diễn đạt lại.

Gemini chỉ nhận nội dung câu hỏi do người dùng gửi và metadata ngôn ngữ tối thiểu; câu hỏi có thể tự chứa tên người. Không gửi roster, số điện thoại, số dư, lương hoặc dữ liệu truy vấn từ server sang mô hình. Session không lưu nguyên văn câu hỏi.

### 7.2 Lệnh hệ thống

- `TRỢ GIÚP`: catalog rút gọn theo vai trò và feature gate hiện tại.
- `TIẾP`: trang tiếp của kết quả đọc gần nhất, nếu cursor còn hạn.
- `XÁC NHẬN ABC123`: xác nhận đúng lệnh đang chờ.
- `HỦY ABC123`: hủy lệnh đang chờ.
- `TRẠNG THÁI ABC123`: trả receipt hoặc trạng thái hiện tại.
- `TRẠNG THÁI`: trả trạng thái lệnh gần nhất của actor.

Không diễn giải `OK`, `đồng ý` hoặc câu tương tự thành xác nhận.

### 7.3 Ví dụ bản xem trước

```text
SẮP GHI ĐIỂM DANH
Lớp: 7A1 — buổi 22/08/2026
Có mặt: 18 | Vắng: 2 | Có phép: 1
Thay đổi: 3 học viên

Gửi: XÁC NHẬN K7M2Q9
Hủy: HỦY K7M2Q9
Mã hết hạn sau 5 phút.
```

Preview tài chính phải thêm số tiền, học viên/đối tượng, phương thức, ngày hạch toán và lý do void nếu có. Preview thông báo phải hiện số người nhận; danh sách nhạy cảm được rút gọn theo quyền.

## 8. Lệnh chờ và state machine

### 8.1 Repository

Tạo abstraction `PendingCommandRepository`; adapter đầu tiên lưu qua document store hiện tại. Service và registry không gọi Firestore trực tiếp, giúp việc chuyển storage sau này không làm đổi hợp đồng capability.

Collection logic `zalo_bot_pending_commands/{commandId}`:

```ts
type PendingCommandStatus =
  | 'awaiting_confirmation'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'stale';

type ZaloBotPendingCommand = {
  commandId: string;
  publicCodeHash: string;
  staffId: string;
  chatIdHash: string;
  roleAtCreation: ZaloBotStaffRole;
  capability: string;
  capabilityVersion: number;
  canonicalArgs: Record<string, unknown>;
  previewSnapshot: string;
  stateFingerprint: string;
  status: PendingCommandStatus;
  idempotencyKey: string;
  invalidConfirmationAttempts: number;
  executionAttempts: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  confirmedAt?: string;
  completedAt?: string;
  resultCode?: string;
  receiptSnapshot?: string;
  errorCode?: string;
};
```

`canonicalArgs` chỉ chứa ID và dữ liệu tối thiểu cần thực hiện. Dữ liệu tài chính hoặc cá nhân không cần thiết không được chép vào command. `previewSnapshot` và `receiptSnapshot` của capability nhạy cảm dùng bản che dữ liệu; audit chi tiết nằm trong domain audit hiện có.

### 8.2 Mã xác nhận

- Mã hiển thị gồm 6 ký tự base32 dễ nhập, loại ký tự dễ nhầm.
- Chỉ lưu HMAC của mã bằng secret server, không lưu mã rõ.
- Mã gắn với `staffId`, `chatIdHash` và `commandId`, hết hạn sau 5 phút.
- Tối đa 5 lần xác nhận sai cho một command và tiếp tục chịu rate limit theo staff/chat.
- Mỗi staff chỉ có một mutation đang hoạt động ở trạng thái `awaiting_confirmation` hoặc `executing`.
- Nếu đã có lệnh chờ, yêu cầu ghi mới không tự hủy lệnh cũ; bot yêu cầu xác nhận hoặc hủy lệnh hiện tại trước.

### 8.3 Chuẩn bị lệnh

1. Resolver chuyển hint thành canonical ID trong phạm vi actor.
2. `authorize` kiểm quyền hiện tại.
3. `prepare` đọc trạng thái, validate luật nghiệp vụ và tạo preview.
4. Capability tạo fingerprint xác định từ các field ảnh hưởng tới quyết định và phiên bản luật.
5. Repository tạo command và mã trong transaction, đồng thời áp ràng buộc một lệnh chờ mỗi staff.
6. Bot gửi preview; nếu gửi thất bại, command vẫn tồn tại và có thể tra bằng `TRẠNG THÁI` nhưng không tự chạy.

### 8.4 Xác nhận và thực thi

1. Parse chính xác lệnh xác nhận, hash mã và tìm command gắn với actor/chat.
2. Transaction chuyển `awaiting_confirmation` sang `executing`. Chỉ một worker claim được.
3. Đọc lại user, link, vai trò, feature gates và domain authorization.
4. Đọc lại các field trạng thái và tính fingerprint mới.
5. Nếu fingerprint khác, chuyển command cũ sang `stale` và không execute. Coordinator chạy lại `prepare` với canonical args hiện tại để gửi một preview và mã mới nếu yêu cầu vẫn hợp lệ; nếu không còn hợp lệ thì giải thích ngắn gọn và dừng.
6. Gọi domain service với `commandId` làm idempotency key cấp bot.
7. Domain service ghi mutation và audit theo transaction/outbox thích hợp.
8. Lưu `succeeded` cùng receipt trước khi gửi receipt qua Zalo.

Nếu một capability không thể cung cấp idempotency hoặc chứng minh trạng thái trước mutation, capability đó không được bật.

`executing` dùng lease có thời hạn. Nếu worker chết sau khi domain service commit nhưng trước khi lưu receipt, worker phục hồi chỉ được claim lại sau khi lease hết hạn và gọi service bằng đúng `commandId`. Domain idempotency phải trả kết quả đã có hoặc hoàn tất đúng một lần; đây là reconciliation của cùng command, không phải retry một command `failed`.

## 9. Riêng tư và audit

- Quyền được đọc mới ở mỗi câu hỏi và mỗi lần xác nhận; không tin `roleAtCreation` để cấp quyền.
- Chat ID chỉ xuất hiện rõ trong link server-only; command, log và audit dùng hash.
- Sensitive read dùng HMAC fingerprint và audit pattern hiện có của admin assistant.
- Message ledger không lưu nội dung trả lời nhạy cảm; dùng marker như `ZALO_BOT_SENSITIVE_CONTENT_MARKER` và metadata tối thiểu.
- Log ứng dụng không chứa raw question, preview tài chính, số điện thoại, roster hoặc token/secret.
- Retention dùng chính sách audit hiện có. Pending command hết hạn được dọn bởi maintenance; bản ghi receipt/audit giữ theo loại nghiệp vụ, không theo TTL chat session.
- Gemini không được nhận system data, kết quả query, quyền chi tiết hoặc secret. Output luôn được validate với schema và allowlist registry.
- Lệnh ghi chỉ chạy trong chat riêng; update từ group bị bỏ qua trước coordinator.

## 10. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Gemini lỗi/timeout | Parser xác định, lệnh hệ thống và trợ giúp vẫn hoạt động; câu tự nhiên nhận thông báo thử lại |
| Capability chưa bật | Trả danh mục đang hỗ trợ, không tiết lộ capability ẩn |
| Không tìm thấy/không có quyền | Cùng một câu “không tìm thấy trong phạm vi của bạn” |
| Nhiều thực thể | Hỏi một câu làm rõ từ tập ứng viên đã lọc quyền |
| Preview hết hạn | Đánh dấu `expired`; người dùng phải tạo lại |
| Dữ liệu đổi sau preview | Đánh dấu lệnh cũ `stale`; không ghi; nếu còn hợp lệ thì gửi preview và mã mới |
| Hai xác nhận đồng thời | Một worker execute; worker còn lại đọc trạng thái/receipt |
| Webhook xác nhận bị giao lại | Trả receipt đã lưu, không execute lại |
| Domain service lỗi trước commit | `failed`, không báo thành công và không tự retry |
| Mutation thành công nhưng gửi receipt lỗi | Command vẫn `succeeded`; `TRẠNG THÁI` trả receipt, mutation không chạy lại |
| Notification đã queue nhưng chưa gửi | Receipt nói rõ “đã xếp hàng”, không nói “đã gửi” |
| Audit bắt buộc không ghi được | Mutation fail-closed hoặc nằm cùng transaction/outbox bảo đảm với mutation |

Không rollback bằng cách xóa dữ liệu nghiệp vụ. Tài chính dùng void/correction theo domain rules; rollback phát hành là tắt capability.

## 11. Feature gates và cấu hình

Thêm các gate fail-closed:

```dotenv
ZALO_BOT_CAPABILITY_REGISTRY_ENABLED=false
ZALO_BOT_WRITE_ENABLED=false
ZALO_BOT_ROLES_ENABLED=teacher,office,admin
ZALO_BOT_CAPABILITIES_ENABLED=
ZALO_BOT_CAPABILITY_AUDIENCE=none
ZALO_BOT_CAPABILITY_PILOT_UIDS=
```

Quy tắc:

- Registry master tắt: luồng chat hiện tại chạy không đổi.
- Write master tắt: không capability ghi nào được prepare hoặc execute, kể cả command cũ.
- Danh sách role/capability có giá trị lạ làm config fail khi khởi động, không bỏ qua âm thầm.
- `ZALO_BOT_CAPABILITY_AUDIENCE` chỉ nhận `none`, `pilot`, `all` và mặc định `none`. Chế độ `pilot` yêu cầu danh sách UID không rỗng; chuyển sang `all` phải là thay đổi cấu hình có chủ đích.
- Gate được kiểm cả lúc tạo preview và lúc xác nhận.
- `ZALO_BOT_ADMIN_DATA_ENABLED`, `ZALO_BOT_ADMIN_INTENTS_ENABLED` và `ZALO_BOT_ADMIN_PILOT_UIDS` tiếp tục chặn các adapter admin trong giai đoạn chuyển đổi. Chỉ xóa cờ cũ bằng một migration riêng sau khi parity được chứng minh.

## 12. Kiểm thử

### 12.1 Unit và contract

- Mỗi capability có test schema, resolver, authorize, preview/fingerprint, composer và error mapping.
- Contract test bảo đảm web route và bot adapter gọi cùng domain service với cùng luật và kết quả.
- Composer luôn ≤ 2.000 ký tự, có phân trang ổn định và không cắt giữa dữ liệu quan trọng.
- Parser chỉ nhận đúng `XÁC NHẬN <mã>`, `HỦY <mã>`, `TRẠNG THÁI [mã]`.

### 12.2 Quyền và bảo mật

- Ma trận bốn vai trò × mọi capability: đường không được phép phải fail trước query/mutation nhạy cảm.
- Teacher không dò được lớp/học viên ngoài phạm vi bằng tên chính xác hoặc prompt injection.
- Office không thực hiện mutation tài chính; accounting không sửa lớp/điểm danh.
- Vai trò đổi, user bị khóa hoặc link bị vô hiệu giữa preview và confirm phải bị chặn.
- Ép classifier trả capability hoặc ID tùy ý vẫn không vượt registry/resolver/authz.
- Không có PII, raw message hoặc secret trong log, message snapshot và audit chung.

### 12.3 Idempotency và cạnh tranh

- Cùng webhook message ID chỉ được xử lý một lần.
- Hai preview ghi đồng thời của cùng staff chỉ tạo một command chờ.
- Hai xác nhận đồng thời chỉ gọi domain mutation một lần.
- Xác nhận lặp sau thành công trả cùng receipt.
- Fingerprint khác chặn execute và đánh dấu `stale`.
- Lỗi gửi Zalo sau commit không làm mutation chạy lại.
- Finance command dùng cùng `commandId` nhưng payload fingerprint khác phải bị từ chối.

### 12.4 Tích hợp và end-to-end

Mỗi vai trò có ít nhất một kịch bản đọc và một kịch bản ghi xuyên suốt trên môi trường thử nghiệm. Kịch bản tài chính xác minh transaction, ledger, idempotency và void dependency. Kịch bản notification xác minh queued/delivered không bị nhập làm một. Luồng `/link`, digest và năm base intent hiện có có regression test.

Các cổng tối thiểu trước rollout: test liên quan, full typecheck và các suite contract/security của bot đều xanh.

## 13. Quan sát vận hành

Theo dõi theo capability và role, không gắn nội dung người dùng:

- classifier success/fallback/low-confidence;
- entity disambiguation và no-match;
- read success/failure và latency;
- preview created/expired/cancelled/stale;
- confirmation invalid/duplicate;
- mutation succeeded/failed;
- receipt delivery failed/ambiguous;
- notification queued/delivered/failed;
- unauthorized attempt và feature-gate denial.

Alert ưu tiên cho unauthorized anomaly, mutation có trạng thái không xác định, audit failure và finance idempotency conflict. Dashboard không hiển thị raw args nhạy cảm.

## 14. Rollout và rollback

Đây là kiến trúc tổng thể; triển khai được chia thành các lát độc lập để giảm rủi ro. Mỗi lát có plan, test và gate riêng.

1. **Foundation:** registry, adaptive composer, role `accounting`, feature gates, metrics; deploy tất cả gate mới ở `false`.
2. **Read parity:** bọc năm base intent và 11 admin intent; thêm read catalog theo vai trò; pilot admin rồi các vai trò còn lại.
3. **Command core + attendance:** pending repository, confirmation state machine và capability điểm danh thí điểm với giáo viên.
4. **Office:** yêu cầu in và notification queue; file upload chỉ mở sau khi validation/asset binding hoàn tất.
5. **Finance:** receipt, expense và wallet; pilot với một nhóm accounting, theo dõi idempotency/audit trước khi mở rộng.

Thứ tự là thứ tự phát hành, không loại bỏ nhóm tác vụ nào đã duyệt. Implementation plan đầu tiên sau tài liệu này chỉ bao phủ lát Foundation; các lát mutation có plan riêng sau khi domain service tương ứng được tách và review.

Rollback:

- Tắt capability cụ thể trước.
- Nếu lỗi lan rộng, tắt `ZALO_BOT_WRITE_ENABLED` nhưng giữ read/link/webhook.
- Nếu registry lỗi, tắt `ZALO_BOT_CAPABILITY_REGISTRY_ENABLED` để quay về chat hiện tại.
- Không xóa pending command; command bị gate chặn không được execute và sẽ hết hạn.

## 15. Tiêu chí nghiệm thu

- Không vai trò nào đọc hoặc ghi ngoài quyền web app hiện tại.
- Gemini không có đường gọi database hoặc mutation.
- Mỗi confirmation code tạo tối đa một mutation và mọi duplicate nhận cùng receipt.
- State đổi sau preview luôn chặn lệnh cũ.
- Bot phân biệt rõ prepared, queued, succeeded, delivered và failed.
- Các câu trả lời kết luận trước, hỗ trợ `TIẾP`, và không vượt 2.000 ký tự.
- Gemini gián đoạn không làm mất lệnh xác nhận, hủy, trạng thái và trợ giúp cơ bản.
- Link, webhook, digest, năm base intent và admin read audit không bị regression.
- Có thể tắt riêng capability/role/pilot mà không dừng bot.
- Bốn vai trò hoàn thành được kịch bản nghiệp vụ đã bật từ đầu đến cuối trên môi trường thí điểm.

## 16. Ảnh hưởng tới thiết kế cũ

Tài liệu này thay thế các giới hạn “chỉ đọc”, “không có accounting” và “không ghi dữ liệu qua chat” trong thiết kế ngày 2026-08-16. Các nguyên tắc còn lại của thiết kế cũ — Gemini không đọc dữ liệu, resolver bị giới hạn quyền, kiểm tra quyền độc lập, không lưu raw conversation và chống webhook trùng — tiếp tục có hiệu lực.
