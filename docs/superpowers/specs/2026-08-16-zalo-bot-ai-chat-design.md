# Thiết kế hỏi đáp AI cho Zalo Bot

**Ngày:** 2026-08-16

**Trạng thái:** Đã duyệt trong brainstorming
**Phạm vi:** Trả lời câu hỏi vận hành bằng tiếng Việt cho nhân viên đã liên kết Zalo Bot, giới hạn đúng phạm vi dữ liệu mà người hỏi đã có quyền xem trên web app

## 1. Bối cảnh

`docs/superpowers/specs/2026-08-15-zalo-bot-notification-design.md` liệt kê "hội thoại AI hoặc trả lời câu hỏi tự do" là ngoài phạm vi. Thiết kế này mở lại đúng ranh giới đó và thay thế câu đó; mọi phần còn lại của thiết kế thông báo giữ nguyên hiệu lực.

Những gì đã chạy và được tái sử dụng:

- Webhook `/api/zalo-bot/webhook` xác thực bằng `X-Bot-Api-Secret-Token` và giải được `chatId → staffId` qua `zalo_bot_chat_claims` + `zalo_bot_links` (`server/api/zalo-bot/webhookHandler.ts:185`).
- Lớp phân quyền dùng chung với web app tại `server/api/lib/auth/authz.ts`: `assertClassAccess`, `getUserContext`, `getClassGrade`.
- Tích hợp Gemini đã có tại `server/api/edu/handlers/evaluations.ts:494` — biến môi trường `GEMINI_API_KEY` chỉ ở phía server, allowlist model, `checkRateLimit` fail-closed, `writeAuditLog`, và system instruction chống prompt injection.
- Bộ đọc roster chuẩn `listCanonicalClassRoster` / `listCanonicalClassRosterProfiles` (`server/api/lib/student/canonicalClassRoster.ts:23`), đọc từ `student_course_enrollments` thay vì field projection `students.classId`.
- Luật dựng danh sách việc cần làm `buildZaloBotDigestPlan` (`server/api/zalo-bot/digestRules.ts:24`).
- `waitUntil` từ `@vercel/functions`, đã dùng tại `server/api/lib/telemetry/deferredReadTelemetry.ts:34`; Fluid Compute đang bật trong `vercel.json`.

Hiện tại mọi tin nhắn không phải `/link` đều rơi vào nhánh trả `{ ignored: true }`. Đó là điểm cắm của tính năng này.

## 2. Mục tiêu

- Nhân viên đã liên kết bot hỏi bằng tiếng Việt tự nhiên và nhận câu trả lời trong vòng vài giây.
- Phạm vi dữ liệu trả lời bằng đúng phạm vi người đó thấy trên web app, không rộng hơn một dòng nào.
- Phạm vi được ép ở tầng code, không ở prompt, để prompt injection không nới rộng được.
- Con số trong câu trả lời do code tính và code viết ra, không đi qua mô hình ngôn ngữ.
- Không thêm Vercel Function nào, giữ nguyên hạn mức 12 trong `api/serverless-budget.test.ts`.
- Bật/tắt độc lập với digest hằng ngày.

## 3. Ngoài phạm vi

- Hành động ghi dữ liệu qua chat (điểm danh hộ, tạo yêu cầu in, nhắc học phí). Chỉ đọc.
- Phụ huynh, học sinh, và vai trò `accounting` — bot không liên kết được các vai trò này (`shared/zaloBot.ts:1`).
- Chat nhóm.
- Câu hỏi về lịch dạy, học phí, công nợ, lương. Phiên bản đầu chỉ ba chủ đề ở mục 5.
- Lưu nguyên văn lịch sử hội thoại.
- Gemini diễn đạt lại câu trả lời (Hướng B trong brainstorming). Có thể thêm sau mà không phải làm lại.

## 4. Quyết định kiến trúc

### 4.1 Luồng một câu hỏi

```text
Zalo -> POST /api/zalo-bot/webhook   (rewrite sẵn -> /api/zalo/bot-webhook)
  |
  |-- 1. xác thực X-Bot-Api-Secret-Token          -+
  |-- 2. parse update, loại GROUP                  |  đã có, không sửa
  |-- 3. "/link CODE" -> luồng liên kết cũ        -+
  |
  '-- 4. MỚI: tin nhắn thường từ chat đã liên kết
         |-- giải chatId -> staffId
         |-- chưa liên kết? -> giữ nguyên hành vi cũ (recordPendingZaloBotChat)
         '-- đã liên kết? -> trả 200 NGAY, xử lý tiếp trong waitUntil
                |-- a. rate limit theo staffId (fail-closed)
                |-- b. dựng lại quyền từ users/{staffId} ngay lúc này
                |-- c. tạo ledger chat_reply_{messageId}; đã tồn tại -> dừng
                |-- d. đọc ngữ cảnh 15 phút gần nhất
                |-- e. Gemini: câu tiếng Việt -> { intent, classNameHint }
                |-- f. giải tên lớp TRONG TẬP ĐƯỢC PHÉP
                |-- g. assertClassAccess() lần nữa, độc lập
                |-- h. truy vấn + composer viết câu
                '-- i. sendZaloBotText + cập nhật ledger
```

Bước (c) đứng trước (e) là có chủ đích: một webhook được giao lại phải dừng **trước** khi tốn một lần gọi Gemini, không phải sau.

### 4.2 Bốn chốt chặn phạm vi

Đây là phần cốt lõi của thiết kế. Yêu cầu "không được truy rộng ra xem lớp khác" được bảo đảm bằng bốn chốt độc lập, không phải bằng chỉ dẫn trong prompt.

**1. Mô hình không có đường chạm vào dữ liệu.** Gemini chỉ nhận câu hỏi thô và trả về `{ intent, classNameHint }`. Không tool calling, không truy cập Firestore, không có bước nào cho phép nó đọc. Đầu ra xấu nhất mà một câu hỏi thù địch tạo ra được là một chuỗi tên lớp, và chuỗi đó đi tiếp vào chốt 2.

**2. Bộ ứng viên bị giới hạn trước khi dò tên.** `classResolver` dựng tập lớp được phép trước, rồi mới khớp tên trong tập đó:

- `teacher` → `classes` where `teacherId == uid`
- `office`, `admin` → toàn bộ, theo đúng `canManageAcademicRecords`

Vì lớp của người khác không nằm trong tập ứng viên, bot trả "không tìm thấy lớp nào tên vậy". Câu trả lời này **không phân biệt** giữa "lớp không tồn tại" và "lớp tồn tại nhưng bạn không có quyền", nên không dùng bot để dò được sự tồn tại của lớp người khác.

**3. Kiểm tra lại lần hai, độc lập.** Mỗi executor trong `chatQueries.ts` tự gọi `assertClassAccess(db, ctx, classId, 'read')` — chính hàm web app đang dùng — trước khi đọc bất kỳ dữ liệu nào. Một lỗi lập trình ở chốt 2 không đủ để rò dữ liệu; phải hỏng cả hai chốt.

**4. Quyền đọc lại tại thời điểm hỏi.** Bước (b) đọc `users/{staffId}` mới qua `getUserContext`, kiểm `blockedTeacher`, và đối chiếu `role` hiện tại với `link.role` đã lưu — cùng cách `server/api/zalo-bot/deliveryService.ts:54` đang làm. Nhân viên bị khóa hoặc đổi vai trò mất quyền ngay, không phải chờ hủy liên kết Zalo.

### 4.3 Hệ quả về quyền riêng tư

Vì code viết câu trả lời chứ không phải Gemini, **tên và dữ liệu học sinh không bao giờ rời khỏi server**. Kể cả intent `class_student_list`, danh sách tên vẫn do `answerComposer` ghép trong code. Thứ duy nhất gửi ra Gemini là câu hỏi thô của nhân viên.

### 4.4 Vì sao không dùng outbox

Outbox retry theo cron lúc 21:35 và 01:00. Với chat, giao lại câu trả lời sau vài tiếng tệ hơn không trả lời. Xử lý chạy trong `waitUntil`; nếu hỏng thì bot nhắn một câu xin lỗi và dừng, không hẹn lại.

## 5. Bộ intent

Schema đầu ra của Gemini cố tình nhỏ: `{ intent, classNameHint }`. Không có tham số ngày — điểm danh luôn hiểu là hôm nay theo `getVietnamTodayDateOnly` (`shared/classVisibility.ts:9`).

| Intent | Ví dụ câu hỏi | Nguồn dữ liệu |
|---|---|---|
| `class_student_count` | "lớp 7 của tôi có bao nhiêu học sinh" | `listCanonicalClassRoster`, nhóm theo `currentEnrollment.status` |
| `class_student_list` | "liệt kê học sinh lớp 7A1" | `listCanonicalClassRosterProfiles` |
| `attendance_today` | "hôm nay lớp nào tôi chưa điểm danh" | `resolveAttendanceEligibilityBatch` + `attendance` where `date == hôm nay` |
| `my_todo` | "tôi còn việc gì chưa xong", "lớp nào sắp kết thúc" | collector hẹp + `buildZaloBotDigestPlan` |
| `unsupported` | ngoài ba chủ đề trên | không đọc gì |

Sĩ số tính từ `listCanonicalClassRoster`, **không** dùng field cache `classes.studentCounts`. Field đó được cộng trừ theo delta qua `applyClassStudentCountDeltas` nên có thể trôi khỏi thực tế; roster đọc thẳng từ `student_course_enrollments` và mặc định chỉ tính enrollment đang mở.

`my_todo` tái dùng phần **luật** (`buildZaloBotDigestPlan`) nhưng **không** tái dùng phần **đọc**. `collectZaloBotDigestSources` đọc toàn bộ `classes` và toàn bộ `users` (`server/api/zalo-bot/digestSources.ts:104`) — chấp nhận được cho một lần chạy lúc 21:30, quá đắt cho một câu chat. Cần một collector hẹp chỉ đọc lớp của người hỏi, trả về đúng hình dạng `DailyDigestRuleInput` cho một người nhận.

## 6. Thành phần

Thư mục mới `server/api/zalo-bot/chat/`, theo nếp repo: mỗi file một việc, kèm một `.test.ts` bên cạnh.

| File | Việc | Phụ thuộc |
|---|---|---|
| `intentClassifier.ts` | Gọi Gemini, ép `responseJsonSchema`, trả `{ intent, classNameHint }` | `@google/genai` |
| `classResolver.ts` | Tên lớp → `classId`, chỉ trong tập được phép | `getClassGrade`, Firestore |
| `chatQueries.ts` | Executor theo intent, mỗi cái tự gọi `assertClassAccess` | roster, eligibility, digestRules |
| `answerComposer.ts` | Viết câu tiếng Việt, cắt ≤ 2000 ký tự | thuần túy, không I/O |
| `chatSessionRepository.ts` | Đọc/ghi ngữ cảnh ngắn | Firestore |
| `chatService.ts` | Điều phối bước a→i | tất cả trên |

Sửa các file sẵn có:

- `server/api/zalo-bot/webhookHandler.ts` — nhánh tin nhắn thường + `waitUntil`
- `server/api/zalo-bot/config.ts` — cờ `chatEnabled`
- `shared/zaloBot.ts` — `ZaloBotMessageType` thêm `'chat_reply'`
- `server/api/zalo-bot/digestSources.ts` — lọc `chat_reply` khỏi phép đếm ở mục 7
- `.env.example`, `docs/zalo-bot-runbook.md`

Khớp tên lớp: bỏ dấu tiếng Việt và hạ chữ thường trước khi so, cộng `getClassGrade` để hiểu "lớp 7" khi tên lớp là "7A1". Dùng `getClassGrade` thay vì viết lại regex khối lớp — hàm đó đã xử lý các biến thể tên đang có trong dữ liệu (`server/api/lib/auth/authz.ts:107`).

## 7. Dữ liệu

**Collection mới `zalo_bot_chat_sessions/{staffId}`**

```ts
{
  staffId: string;
  lastIntent: string;
  lastClassId: string | null;
  lastAskedAt: string;   // ISO
  expiresAt: string;     // ISO, lastAskedAt + 15 phút
}
```

Không lưu nguyên văn tin nhắn, không lưu tên hay số liệu học sinh. Ngữ cảnh chỉ dùng để hiểu câu nối tiếp kiểu "còn lớp kia thì sao". Dọn bản ghi quá hạn trong `daily-maintenance` đã có.

**`zalo_bot_messages` dùng lại** với `messageType: 'chat_reply'`, id `chat_reply_{zaloMessageId}`. Các field bắt buộc của `ZaloBotMessage` điền như sau: `digestDate` = ngày Việt Nam lúc trả lời theo `getVietnamTodayDateOnly`, `chatIdHash` = giá trị lấy từ `zalo_bot_links/{staffId}`, `role` = vai trò đã đọc lại ở bước (b) chứ không phải `link.role` đã lưu.

**Chống trả lời trùng.** Không dùng marker `_maintenance/zaloBotWebhook_{messageId}` cho việc này: nhánh tin nhắn thường đã ghi marker đó ở bước 4 (`touchActiveZaloBotLinkFromWebhook` ghi `outcome: 'updated'`) trước khi `waitUntil` chạy, nên marker luôn tồn tại sẵn và không phân biệt được lần đầu với lần giao lại. Chốt chống trùng nằm ở `createZaloBotMessageIfAbsent` với id `chat_reply_{zaloMessageId}`: trả `'existing'` nghĩa là câu hỏi này đã được xử lý, dừng ngay và không gọi Gemini. Bản ghi ledger vì vậy phải được tạo **trước** khi gọi Gemini, không phải sau khi gửi.

**Tác dụng phụ phải chặn.** `server/api/zalo-bot/digestSources.ts:106` đếm `zalo_bot_messages` có `status == 'failed'` để báo `outstandingFailedMessages` cho admin trong digest hằng ngày. Nếu không lọc, mỗi lần chat lỗi sẽ làm phồng con số đó và admin sẽ tưởng hệ thống thông báo đang hỏng. Lọc `messageType === 'chat_reply'` ra khỏi phép đếm trong bộ nhớ; snapshot đã được fetch sẵn nên không cần index mới.

## 8. Cấu hình

Thêm vào `loadZaloBotConfig`:

```dotenv
ZALO_BOT_CHAT_ENABLED=false
```

Đọc qua `readBooleanEnv` đã có. Cờ tách riêng khỏi `ZALO_BOT_DAILY_DIGEST_ENABLED` để bật/tắt chat mà không ảnh hưởng digest. Khi `enabled === true` và `chatEnabled === true` thì `GEMINI_API_KEY` trở thành bắt buộc, kiểm tại thời điểm load cấu hình chứ không phải giữa một câu hỏi.

Dùng lại `GEMINI_API_KEY` và allowlist model hiện có; mặc định `gemini-3.5-flash`.

Rate limit: `checkRateLimit(db, 'zalo_bot_chat:' + staffId, 30, 60*60*1000, { failClosed: true })`.

Không thêm route, không thêm file trong `api/` → `api/serverless-budget.test.ts` giữ nguyên 12 function.

## 9. Xử lý lỗi

Nguyên tắc: im lặng là kết cục tệ nhất trên kênh chat. Mọi nhánh đều trả lời một câu, trừ hai trường hợp cố ý giữ nguyên hành vi cũ.

| Tình huống | Hành vi |
|---|---|
| Chat chưa liên kết | Giữ nguyên hành vi hôm nay: ghi pending, không trả lời. Mục 3 của runbook đang dựa vào pending chat để admin ghép thủ công. |
| `ZALO_BOT_CHAT_ENABLED=false` | Giữ nguyên hành vi hôm nay |
| Vượt rate limit | "Bạn đã hỏi khá nhiều trong giờ qua, thử lại sau ít phút giúp tôi." |
| Gemini lỗi hoặc quá 8 giây | "Hiện chưa trả lời được, bạn thử lại giúp tôi." |
| Intent `unsupported` | Liệt kê đúng ba việc bot làm được |
| Không khớp lớp nào | "Không tìm thấy lớp nào tên «7B» trong các lớp của bạn." |
| Khớp nhiều lớp | "Bạn hỏi lớp nào: 7A1, 7A2?" — lưu vào session để câu sau nối được |
| `assertClassAccess` ném 403 | Gửi người dùng cùng câu "không tìm thấy", nhưng ghi log cảnh báo: tới được đây nghĩa là `classResolver` đã hỏng |
| Gửi Zalo thất bại | Ghi ledger `failed`, không retry |

## 10. Kiểm thử

Unit test cạnh mỗi file, theo nếp repo. Bốn test dưới đây là hợp đồng của thiết kế này:

1. **Rò chéo giáo viên.** Giáo viên A hỏi đúng tên lớp của giáo viên B → nhận "không tìm thấy", và không có lệnh đọc Firestore nào chạm vào lớp đó.
2. **Prompt injection.** Ép `intentClassifier` trả `classNameHint` tùy ý, kể cả tên lớp thật của người khác; `classResolver` vẫn phải chặn. Test này chứng minh chốt chặn nằm ở code chứ không ở prompt.
3. **Quyền đọc lại lúc hỏi.** `blockedTeacher = true`, hoặc `users.role` đổi sau khi liên kết → từ chối ngay, không cần hủy link.
4. **Idempotency.** Cùng `message_id` vào hai lần → đúng một câu trả lời, đúng một bản ghi ledger.

Thêm: `answerComposer` không bao giờ vượt 2000 ký tự với đầu vào lớn nhất có thể (lớp đông nhất trong dữ liệu); `digestSources` không đếm `chat_reply` vào `outstandingFailedMessages`.

`npm run typecheck` phải xanh. Theo ghi nhận vận hành của dự án, đây là cổng hợp đồng thật sự chứ không phải test suite.

## 11. Triển khai

1. Deploy với `ZALO_BOT_CHAT_ENABLED=false`. Xác nhận hành vi webhook không đổi.
2. Đặt `GEMINI_API_KEY` nếu chưa có trong môi trường production.
3. Bật `ZALO_BOT_CHAT_ENABLED=true`, thử với một tài khoản `teacher` thí điểm.
4. Kiểm bằng tay: hỏi lớp mình → có số; hỏi đúng tên lớp người khác → "không tìm thấy"; hỏi ngoài chủ đề → danh sách ba việc.
5. Mở rộng cho `office` và `admin` sau khi một ngày thí điểm khớp với dữ liệu trên web app.

Rollback: đặt `ZALO_BOT_CHAT_ENABLED=false` và redeploy. Digest hằng ngày và luồng liên kết không bị ảnh hưởng.
