# Thiết kế Zalo Bot thông báo nội bộ

**Ngày:** 2026-08-15

**Trạng thái:** Đã duyệt trong brainstorming
**Phạm vi:** Thông báo riêng cho giáo viên, văn phòng và admin qua Zalo Bot Platform

## 1. Bối cảnh

EduTrack chạy bằng Vite, Vercel Functions và Firestore. Dự án đã có:

- Vercel Cron gọi `/api/audit/daily-maintenance` mỗi ngày.
- Outbox bền vững tại `server/api/lib/jobs/outbox.ts`.
- Hạ tầng ZNS, log và chống gửi trùng cho thông báo phụ huynh/học viên.
- Dữ liệu lịch lớp, điểm danh, ngày kết khóa và yêu cầu hỗ trợ in đề.

Tích hợp hiện tại chỉ hỗ trợ ZNS. Tính năng mới sử dụng Zalo Bot Platform, là sản phẩm riêng có Bot Token, webhook và API `sendMessage`. Bot chỉ phát thông báo nội bộ; bot không dùng AI và không xử lý hội thoại thông minh.

Serverless không tự theo dõi thời gian. Vercel Cron là tác nhân bên ngoài đánh thức function theo lịch, vì vậy hệ thống vẫn gửi được thông báo khi không có người mở ứng dụng.

## 2. Mục tiêu

- Gửi một tin nhắn riêng, được cá nhân hóa cho từng nhân viên vào cuối ngày.
- Nhắc giáo viên hoàn tất điểm danh và xử lý các lớp sắp kết khóa.
- Nhắc văn phòng các yêu cầu in đề sắp đến hạn hoặc quá hạn.
- Gửi admin bản tổng hợp tình trạng vận hành hằng ngày.
- Cho phép tự liên kết Zalo và liên kết thủ công bởi admin.
- Tái sử dụng cron, outbox, idempotency, audit và cơ chế phân quyền hiện có.
- Hoạt động an toàn trên Vercel serverless mà không cần tiến trình chạy liên tục.

## 3. Ngoài phạm vi

- Hội thoại AI hoặc trả lời câu hỏi tự do.
- ZNS, Zalo OA Chatbot hoặc gửi tin quảng cáo/broadcast.
- Gửi cho phụ huynh hoặc học viên.
- Gửi vào nhóm Zalo; phiên bản đầu chỉ hỗ trợ chat riêng.
- Nhắc điểm danh theo thời gian thực trong buổi học.
- Gửi hình ảnh, giọng nói, tài liệu hoặc sticker.
- Tùy chỉnh chi tiết từng loại thông báo cho từng nhân viên trong phiên bản đầu.

## 4. Quyết định kiến trúc

### 4.1 Luồng tổng thể

```text
Vercel Cron khoảng 21:30 Việt Nam
  -> Daily Notification Scanner
  -> Digest Composer
  -> Message record + Outbox job
  -> Zalo Bot sender
  -> Zalo Bot Platform sendMessage
  -> Message log, metrics và cảnh báo
```

Tạo cron riêng:

```text
Path: /api/audit/zalo-bot-daily-digest
Schedule: 30 14 * * *
```

Vercel Cron dùng UTC, nên `14:30 UTC` tương ứng `21:30 Asia/Ho_Chi_Minh`. Trên gói Hobby, thời điểm gọi có thể lệch trong phạm vi một giờ; độ chính xác này phù hợp với bản tổng hợp cuối ngày.

Không gắn job này vào daily maintenance hiện tại vì maintenance chạy khoảng 01:00 sáng hôm sau. Daily maintenance vẫn đóng vai trò chạy bù hoặc xử lý lại outbox còn tồn.

### 4.2 Các thành phần

#### Bot Connection Service

- Nhận webhook của Zalo Bot.
- Xác thực `X-Bot-Api-Secret-Token` trước khi đọc payload.
- Ghi nhận cuộc chat chưa liên kết.
- Xử lý lệnh liên kết bằng mã dùng một lần.
- Bỏ qua tin nhắn thông thường từ người đã liên kết.
- Gửi xác nhận khi liên kết thành công.

#### Daily Notification Scanner

- Dùng ngày và múi giờ `Asia/Ho_Chi_Minh` cho mọi phép tính.
- Đọc dữ liệu lớp, lịch học, điểm danh, kết khóa, yêu cầu in đề và nhân viên.
- Trả về các notification item thuần dữ liệu, không trực tiếp gửi tin.

#### Digest Composer

- Nhóm notification item theo nhân viên.
- Tạo tối đa một digest cho mỗi nhân viên trong một ngày Việt Nam.
- Giữ nội dung không quá 2.000 ký tự.
- Khi danh sách quá dài, hiển thị mục ưu tiên và đường dẫn vào EduTrack để xem đầy đủ.

#### Message Store và Outbox

- Tạo một `zalo_bot_messages` record trước khi gửi.
- Tạo outbox job loại `send_zalo_bot_message` với payload chỉ chứa `messageId`.
- Dùng idempotency key `zalo-bot-digest:{staffId}:{YYYY-MM-DD}`.
- Handler tải message và liên kết đang hoạt động ngay trước khi gửi để không dùng chat đã bị thu hồi.
- Cron tạo job rồi gọi một lượt xử lý outbox ngay trong cùng invocation. Daily maintenance xử lý lại job còn tồn sau đó.

#### Zalo Bot Client

- Gọi `POST https://bot-api.zaloplatforms.com/bot{BOT_TOKEN}/sendMessage`.
- Chỉ chạy ở server.
- Đọc `ZALO_BOT_TOKEN` từ biến môi trường.
- Chuẩn hóa timeout, lỗi HTTP, mã lỗi nền tảng và kết quả `message_id`.

#### Admin UI

Trang `Admin > Zalo Bot` cung cấp:

- Danh sách nhân viên đã/chưa liên kết.
- Danh sách cuộc chat đang chờ.
- Liên kết thủ công và hủy liên kết.
- Gửi tin thử.
- Xem lần cron gần nhất và số liệu queued/sent/failed/skipped.
- Xem lịch sử, chạy tổng hợp ngay và gửi lại tin lỗi.

Giáo viên và nhân viên văn phòng chỉ thấy trạng thái liên kết của chính mình và thao tác tạo mã tự liên kết.

## 5. Mô hình dữ liệu

Các collection này chỉ được đọc/ghi qua server API. Firestore client rules không cấp quyền ghi trực tiếp.

### 5.1 `zalo_bot_links/{staffId}`

```typescript
type ZaloBotLink = {
  staffId: string;
  chatId: string;
  zaloDisplayName: string;
  role: 'teacher' | 'office' | 'admin';
  status: 'active' | 'disabled' | 'needs_relink';
  linkedMethod: 'self' | 'admin';
  linkedBy: string;
  linkedAt: string;
  lastSeenAt: string;
  disabledAt?: string;
  disabledBy?: string;
};
```

### 5.2 `zalo_bot_chat_claims/{chatIdHash}`

```typescript
type ZaloBotChatClaim = {
  chatIdHash: string;
  staffId: string;
  status: 'active' | 'released';
  createdAt: string;
  releasedAt?: string;
};
```

Link và claim được tạo/cập nhật trong cùng Firestore transaction. Ràng buộc:

- Một `staffId` chỉ có một link hoạt động.
- Một `chatIdHash` chỉ có một claim hoạt động.

### 5.3 `zalo_bot_pending_chats/{chatIdHash}`

```typescript
type ZaloBotPendingChat = {
  chatId: string;
  chatIdHash: string;
  zaloDisplayName: string;
  status: 'pending' | 'linked' | 'ignored';
  firstSeenAt: string;
  lastSeenAt: string;
  linkedStaffId?: string;
};
```

### 5.4 `zalo_bot_link_codes/{codeHash}`

```typescript
type ZaloBotLinkCode = {
  codeHash: string;
  staffId: string;
  expiresAt: string;
  attemptCount: number;
  consumedAt?: string;
  createdAt: string;
};
```

- Mã hiển thị dạng ngắn, đủ để nhập thủ công.
- Chỉ lưu hash của mã.
- Hết hạn sau 10 phút.
- Dùng một lần và bị khóa sau nhiều lần nhập sai.
- Có TTL cleanup cho record hết hạn.

### 5.5 `zalo_bot_messages/{messageId}`

```typescript
type ZaloBotMessage = {
  staffId: string;
  role: 'teacher' | 'office' | 'admin';
  chatIdHash: string;
  digestDate: string;
  messageType: 'daily_digest' | 'link_confirmation' | 'test';
  contentSnapshot: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  zaloMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  sentAt?: string;
  nextAttemptAt?: string;
};
```

Raw `chatId` chỉ nằm trong link/pending record server-only. Log và claim dùng SHA-256 của chat ID.

## 6. Luồng liên kết

### 6.1 Tự liên kết

1. Nhân viên đăng nhập EduTrack và chọn `Kết nối Zalo Bot`.
2. API tạo mã một lần gắn với UID nhân viên hiện tại.
3. Nhân viên mở bot và gửi `LINK <mã>`.
4. Webhook xác thực secret, hash mã và tải pending code.
5. Firestore transaction xác nhận mã còn hạn, chưa dùng, nhân viên đang hoạt động và chat chưa được claim.
6. Transaction tạo link + claim, tiêu thụ mã và cập nhật pending chat.
7. Bot gửi xác nhận chứa tên và vai trò đã liên kết.

### 6.2 Admin liên kết thủ công

1. Nhân viên mở bot và gửi một tin bất kỳ để tạo pending chat.
2. Admin mở danh sách chat chờ, chọn cuộc chat và hồ sơ nhân viên.
3. UI hiển thị rõ tên Zalo, tên EduTrack và vai trò để admin xác nhận.
4. Firestore transaction tạo link + claim và cập nhật pending chat.
5. Admin có thể gửi tin thử để người nhận xác nhận.
6. Mọi thao tác link/unlink được ghi audit với actor và thời gian.

### 6.3 Thu hồi và thay đổi liên kết

- Admin có thể disable hoặc release link.
- Khi tài khoản nhân viên bị vô hiệu hóa, sender bỏ qua link ngay lập tức.
- Link cũ được giữ phục vụ kiểm toán, không xóa cứng.
- Re-link yêu cầu release claim cũ trong transaction trước khi claim chat mới.

## 7. Quy tắc thông báo

### 7.1 Giáo viên: điểm danh

Một lớp được nhắc khi tất cả điều kiện đúng:

- Ngày Việt Nam hiện tại là ngày học theo lịch lớp.
- Buổi học không bị hủy hoặc dời.
- Lớp có ít nhất một học viên đủ điều kiện điểm danh.
- Ít nhất một học viên đủ điều kiện chưa có trạng thái điểm danh của buổi đó.

Người nhận là giáo viên thực tế phụ trách buổi học: giáo viên dạy thay nếu có, nếu không là giáo viên chính. Tin chỉ nêu tên lớp và số học viên còn thiếu; không đưa danh sách học viên vào Zalo.

### 7.2 Giáo viên: lớp sắp kết khóa

- Kiểm tra các mốc D-7, D-3 và D-1 theo `termEnd`/`endDate` chuẩn.
- Chỉ đưa vào digest khi còn việc chưa hoàn tất, ví dụ nhận xét, đánh giá hoặc bước kết khóa.
- Người nhận là giáo viên chính của lớp.

### 7.3 Văn phòng: in đề

Đưa yêu cầu vào digest nếu:

- Trạng thái là `pending` hoặc `in_progress`; và
- `requiredBy` là ngày hôm sau, hoặc yêu cầu đã quá hạn.

Nếu mô hình yêu cầu in đề chưa có `requiredBy`, bổ sung trường này là một phần bắt buộc của triển khai. Phiên bản đầu gửi cùng một digest cho mọi tài khoản văn phòng đang hoạt động và đã liên kết.

### 7.4 Admin: báo cáo cuối ngày

Mọi admin đang hoạt động và đã liên kết nhận báo cáo gồm:

- Tổng số lớp đã học.
- Số lớp chưa hoàn tất điểm danh.
- Số lớp sắp kết khóa và còn việc.
- Số yêu cầu in đề đang chờ/quá hạn.
- Số tin bot gửi thất bại.
- Số nhân viên đang hoạt động nhưng chưa liên kết.

Admin vẫn nhận bản báo cáo khi mọi chỉ số cần xử lý bằng 0. Giáo viên và văn phòng không nhận tin nếu không có việc.

## 8. Định dạng nội dung

### 8.1 Giáo viên

```text
📋 TỔNG HỢP CUỐI NGÀY — 15/08/2026

Điểm danh chưa hoàn tất:
• Starters T2-T4: còn 3 học viên

Lớp sắp kết khóa:
• Movers A: còn 3 ngày — chưa đủ nhận xét
```

### 8.2 Văn phòng

```text
🖨️ CÔNG VIỆC IN ĐỀ

Cần dùng ngày mai:
• Đề Flyers A — 15 bản

Quá hạn:
• Starters C — yêu cầu từ 14/08
```

### 8.3 Admin

```text
📊 BÁO CÁO CUỐI NGÀY

• 18 lớp đã học
• 3 lớp chưa hoàn tất điểm danh
• 4 lớp sắp kết khóa
• 2 yêu cầu in đề đang chờ
• 1 tin Zalo Bot gửi thất bại
• 5 nhân viên chưa liên kết Zalo
```

## 9. Bảo mật và quyền riêng tư

- `ZALO_BOT_TOKEN`, `ZALO_BOT_WEBHOOK_SECRET` và `CRON_SECRET` chỉ nằm trong Vercel environment variables.
- Bot Token nằm trong URL của Bot API, vì vậy HTTP client và logger phải redact toàn bộ token và không ghi request URL nguyên bản vào log hoặc error record.
- Webhook so sánh secret trước khi xử lý body.
- Cron endpoint yêu cầu bearer `CRON_SECRET` giống các audit job hiện tại.
- Tạo mã liên kết yêu cầu phiên đăng nhập hợp lệ và chỉ tạo cho chính người dùng.
- Link thủ công, unlink, chạy ngay và resend chỉ dành cho admin.
- Link code được hash, hết hạn, dùng một lần và có rate limit.
- Chat ID không được trả về frontend ngoài dữ liệu đã che/mask dành cho admin.
- Nội dung Zalo chỉ chứa dữ liệu tối thiểu cần thiết; không đưa thông tin nhạy cảm của học viên vào digest.
- Người dùng phải được thông báo rõ đây là hệ thống tự động chỉ dùng để gửi thông báo.

## 10. Idempotency, retry và xử lý lỗi

### 10.1 Phân loại lỗi

- `400` hoặc chat không hợp lệ: lỗi vĩnh viễn, đánh dấu link `needs_relink` và cảnh báo admin.
- `401/403`: lỗi cấu hình/token, dừng batch để tránh gọi lặp và tạo cảnh báo nghiêm trọng.
- `429`, timeout hoặc `5xx`: lỗi tạm thời, retry tối đa ba lần với `nextAttemptAt` tăng dần.
- Nhân viên/link không còn hoạt động: message chuyển `skipped`, không gửi.

### 10.2 Chống gửi trùng

- Message và outbox job dùng cùng khóa logic theo staff + ngày.
- Tạo message/job trong transaction hoặc bằng create-if-absent.
- Sender kiểm tra trạng thái `sent` trước khi gọi API.
- Một cron invocation trùng không thể tạo lần gửi thứ hai.

### 10.3 Cron bị thiếu

- Lưu job run với ngày Việt Nam và trạng thái thành công/thất bại.
- Daily maintenance lúc 01:00 kiểm tra digest ngày trước.
- Nếu digest chưa chạy, thực hiện catch-up một lần hoặc tạo cảnh báo admin.
- Admin có nút `Chạy tổng hợp ngay` để phục hồi thủ công.

## 11. Quan sát vận hành

Dashboard hiển thị:

- Lần cron thành công gần nhất.
- Lần webhook hợp lệ gần nhất.
- Số nhân viên đã liên kết/tổng nhân viên đang hoạt động.
- Số message queued, sent, failed và skipped theo ngày.
- Lỗi Bot API gần nhất và số link `needs_relink`.

Mọi link/unlink, chạy thủ công và resend phải đi qua audit log hiện có.

## 12. Kiểm thử

### Unit test

- Ngày học, khoảng ngày lớp và múi giờ Việt Nam.
- Buổi hủy/dời và giáo viên dạy thay.
- Định nghĩa điểm danh hoàn tất theo học viên đủ điều kiện.
- Mốc kết khóa D-7/D-3/D-1.
- Yêu cầu in đề ngày mai/quá hạn.
- Gom digest theo người nhận, thứ tự ưu tiên và giới hạn 2.000 ký tự.
- Idempotency key và hành vi khi không có việc.

### Integration test

- Webhook secret hợp lệ/không hợp lệ.
- Tự liên kết thành công, mã hết hạn, mã đã dùng và thử sai quá giới hạn.
- Admin liên kết thủ công, trùng staff và trùng chat.
- Release/re-link trong Firestore transaction.
- Bot API trả `200`, `400`, `401`, `429`, timeout và `5xx`.
- Cron auth, dry run, tạo job và xử lý outbox.
- Catch-up khi thiếu daily run.

### Authorization test

- Giáo viên chỉ xem/tạo mã của chính mình.
- Giáo viên không thể link/unlink người khác hoặc chạy/resend job.
- Văn phòng không có quyền admin.
- Admin có quyền quản lý link và vận hành job.

### E2E test

- Trang admin hiển thị pending/linked/unlinked đúng.
- Liên kết thủ công, gửi thử, unlink và xem history.
- Trang hồ sơ nhân viên tạo mã và cập nhật trạng thái sau khi webhook liên kết.

## 13. Rollout

### Giai đoạn 1: Dry run

- Tạo bot, token, webhook và secret.
- Bật scanner/composer nhưng không gọi Bot API.
- Admin xem trước recipient và nội dung trong EduTrack.

### Giai đoạn 2: Pilot

- Liên kết admin và 3-5 giáo viên.
- Gửi tin thử và digest thực trong một tuần.
- Theo dõi duplicate, nội dung sai, link lỗi và rate limit.

### Giai đoạn 3: Mở rộng

- Liên kết toàn bộ giáo viên và văn phòng.
- Bật admin daily summary.
- Theo dõi tỷ lệ liên kết và gửi thất bại.

### Giai đoạn 4: Production

- Bật cron tự động cho toàn bộ nhân viên.
- Duy trì nút chạy thủ công, resend và kill switch.

Feature flags:

```text
ZALO_BOT_ENABLED
ZALO_BOT_DAILY_DIGEST_ENABLED
ZALO_BOT_DRY_RUN
```

## 14. Tiêu chí hoàn thành

- Admin và nhân viên có thể liên kết theo hai luồng đã thiết kế.
- Một chat không thể liên kết đồng thời với hai nhân viên.
- Giáo viên/văn phòng chỉ nhận digest khi có việc; admin luôn nhận báo cáo.
- Mỗi nhân viên nhận tối đa một daily digest cho một ngày Việt Nam.
- Cron chạy được khi không có người mở ứng dụng.
- Duplicate cron không tạo duplicate message.
- Mọi lần gửi đều có trạng thái và bằng chứng `message_id` hoặc lỗi.
- Token và raw chat ID không bị lộ qua frontend/log công khai.
- Dry run và kill switch hoạt động bằng thay đổi cấu hình, không cần sửa mã nguồn; việc cập nhật environment variable có thể cần redeploy cấu hình Vercel.
- Test unit, integration, authorization và E2E liên quan đều đạt.

## 15. Tài liệu tham chiếu

- Zalo Bot Platform introduction: https://bot.zapps.me/docs/
- Create Bot: https://bot.zapps.me/docs/create-bot/
- Authentication: https://bot.zapps.me/docs/authorize/
- `sendMessage`: https://bot.zapps.me/docs/apis/sendMessage/
- Webhook: https://bot.zapps.me/docs/webhook/
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Vercel Cron management and idempotency: https://vercel.com/docs/cron-jobs/manage-cron-jobs
