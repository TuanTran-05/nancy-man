# Zalo Bot Operations Runbook

Zalo Bot is a private staff-notification channel for `teacher`, `office`, and `admin` accounts. It is logically isolated from the existing Zalo OA/ZNS integration. The public Bot endpoints remain under `/api/v1/zalo-bot/*` and `/api/zalo-bot/*` and are served by the VPS route table.

## Preflight

- Verify the VPS crontab schedules 21:30, 21:35, and 01:00 Vietnam time exactly.
- Keep all Bot credentials server-side. Never create a `VITE_ZALO_BOT_*` variable.
- Keep `ZALO_BOT_DAILY_DIGEST_ENABLED=false` and `ZALO_BOT_DRY_RUN=true` through the initial pilot verification.
- Giữ ZALO_BOT_CHAT_ENABLED=false cho tới khi digest đã chạy ổn định.

## 1. Create credentials

Create the bot in Zalo Bot Platform and copy its token. Generate three independent 32-byte secrets by running this command three separate times:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Assign the three different outputs to:

- `ZALO_BOT_WEBHOOK_SECRET`
- `ZALO_BOT_LINK_CODE_PEPPER`
- `ZALO_BOT_CHAT_HASH_SECRET`

Configure these production environment variables:

```dotenv
ZALO_BOT_TOKEN=<provider token>
ZALO_BOT_WEBHOOK_SECRET=<secret 1>
ZALO_BOT_LINK_CODE_PEPPER=<secret 2>
ZALO_BOT_CHAT_HASH_SECRET=<secret 3>
ZALO_BOT_REQUEST_TIMEOUT_MS=10000
ZALO_BOT_ENABLED=true
ZALO_BOT_DAILY_DIGEST_ENABLED=false
ZALO_BOT_DRY_RUN=true
```

Restart the VPS application after changing server environment variables.

## 2. Configure and verify the webhook

Set the webhook URL in Zalo Bot Platform to:

```text
https://<APP_URL>/api/zalo-bot/webhook
```

Set the provider's `X-Bot-Api-Secret-Token` to exactly the same value as `ZALO_BOT_WEBHOOK_SECRET`.

Verify all four cases before linking pilot accounts:

1. A request with a wrong or missing secret receives `403` and creates no persistent record.
2. A normal message in a `PRIVATE` chat appears as a pending chat in Admin → Zalo OA → Bot nội bộ.
3. A `GROUP` message, including `/link CODE`, is acknowledged but creates no pending chat, claim, or link.
4. Replaying the same provider event ID does not duplicate attempts, links, confirmation messages, or jobs.

## 3. Link 3–5 pilot accounts

Cover at least one `teacher`, one `office`, and one `admin`.

For self-linking:

1. Open Profile → Zalo Bot and select “Tạo mã liên kết”.
2. Send `/link CODE` in a private chat with the bot before the code expires.
3. Confirm that Profile shows the active link and the confirmation message reaches that private chat.

For manual admin linking:

1. Ask the pilot to send a normal private message to the bot.
2. Open Admin → Zalo OA → Bot nội bộ.
3. Pair the pending chat only with an eligible `teacher`, `office`, or `admin` account.
4. Send an admin test message and wait for the recent-message row to show `sent` plus a provider message ID.

A chat can belong to only one staff account. Unlink it before assigning it elsewhere.

## 4. Dry-run validation

Keep:

```dotenv
ZALO_BOT_ENABLED=true
ZALO_BOT_DAILY_DIGEST_ENABLED=false
ZALO_BOT_DRY_RUN=true
```

Invoke the job manually with `CRON_SECRET`:

```bash
curl --fail-with-body -H "Authorization: Bearer $CRON_SECRET" "https://<APP_URL>/api/audit/zalo-bot-daily-digest"
```

Expected HTTP status is `200`. A `502` means generation finished but at least one delivery failed. Check these response fields:

- `counts.confirmationRepair`: replay-safe confirmation jobs repaired in this run.
- `counts.generation`: daily ledgers/jobs enqueued in this run.
- `counts.delivery`: outbox jobs successfully processed in the bounded immediate pass.
- `counts.deliveryFailures`: outbox jobs that failed in that pass.
- `digest.sourceCounts.outstandingFailedMessages`: failures already outstanding before this digest run, not failures newly produced by it.

Compare the generated ledger with the source screens:

- Teachers: incomplete attendance for regular or explicit taught/makeup sessions; substitutes receive the attendance item.
- Primary teachers: D-7, D-3, and D-1 course-closing reminders.
- Office: all pending print requests whose `neededDate` is today, overdue, or tomorrow.
- Admin: daily totals, including a zero-count day where applicable.

Run the same endpoint twice and confirm the second invocation creates no duplicate daily ledger or outbox job.

## 5. Pilot rollout gate

1. Set `ZALO_BOT_DAILY_DIGEST_ENABLED=true` and keep `ZALO_BOT_DRY_RUN=true` for one business day.
2. Verify the configured 21:30 digest, 21:35 outbox drain, and 01:00 catch-up invocations in VPS/PM2 logs.
3. Confirm source counts, ledger counts, and intended recipients match.
4. Set `ZALO_BOT_DRY_RUN=false` for pilot accounts only by limiting who is linked.
5. Verify `sent` status, provider message IDs, attempt counts, and failures in the admin panel.
6. Expand linking to all staff only after a full pilot day matches the source data and delivery ledger.

## Hỏi đáp AI

Bot trả lời bốn loại câu hỏi cho tài khoản đã liên kết: sĩ số và danh sách học sinh của một lớp, ngày kết khóa của một lớp, điểm danh hôm nay, và việc cần xử lý. Phạm vi dữ liệu bằng đúng phạm vi người hỏi thấy trên web app — giáo viên chỉ thấy lớp mình dạy; office và admin thấy toàn bộ. `my_todo` của office/admin có cả yêu cầu in đang chờ; admin summary vận hành của digest không được phơi vào chat ở phiên bản này.

Bật bằng:

```dotenv
ZALO_BOT_CHAT_ENABLED=true
GEMINI_API_KEY=<khóa Gemini>
```

`GEMINI_API_KEY` trở thành bắt buộc khi `ZALO_BOT_ENABLED` và `ZALO_BOT_CHAT_ENABLED` cùng bằng `true`; thiếu khóa thì cấu hình không load được và webhook trả 503.

Kiểm tra sau khi bật, bằng một tài khoản `teacher` thí điểm:

1. Hỏi về lớp mình → nhận số liệu khớp với màn hình lớp trên web.
2. Hỏi đúng tên một lớp của giáo viên khác → nhận "Không tìm thấy lớp nào tên «…» trong các lớp của bạn". Đây là hành vi đúng: câu trả lời cố ý không phân biệt "lớp không tồn tại" với "bạn không có quyền", để bot không dùng được để dò tên lớp.
3. Hỏi ngày kết khóa của lớp mình → nhận ngày theo định dạng `DD/MM/YYYY`; hỏi lớp ngoài phạm vi → vẫn nhận "Không tìm thấy".
4. Hỏi ngoài bốn chủ đề → nhận danh sách bốn việc bot làm được.
5. Gửi lại đúng một tin nhắn cũ → không sinh câu trả lời thứ hai.

Giới hạn 30 câu mỗi giờ cho mỗi tài khoản, fail-closed. Replay có ledger sẵn dừng trước rate limiter; hai request thật sự đồng thời vẫn được chặn authoritative bằng transaction tạo ledger. Câu trả lời được ghi vào `zalo_bot_messages` với `messageType: 'chat_reply'`; các bản ghi này **không** được tính vào `outstandingFailedMessages` của digest hằng ngày.

Session chỉ giữ intent và lớp gần nhất, hết hạn sau 15 phút và được daily maintenance xóa. Khi điều tra sự cố chat, query riêng `zalo_bot_messages` với `messageType == 'chat_reply'` và xem `status`, `errorCode`, `deliveryAmbiguous`; các lỗi này cố ý không trộn vào chỉ số lỗi notification của digest.

Rollback: đặt `ZALO_BOT_CHAT_ENABLED=false` rồi redeploy. Digest hằng ngày và luồng liên kết không bị ảnh hưởng.

## Delivery errors and retries

- `401`: provider authentication failure. Abort the current outbox batch and raise one critical admin incident.
- `403`, `408`, `429`, and `5xx`: not authentication failures; retry according to outbox policy.
- Unknown `400`/`404`: do not invalidate the link unless the provider description explicitly identifies a chat/recipient problem.
- Chat/recipient-specific invalid response: set the link to `needs_relink` and release its chat claim.

The deterministic ledger and outbox prevent duplicate enqueue when cron or application code repeats. Zalo Bot `sendMessage` does not accept a client idempotency key, so a timeout or network failure after the provider accepted a message is an at-least-once case. The ledger marks this as `deliveryAmbiguous: true`. Inspect the admin warning and provider/chat state before manually retrying; a retry can duplicate the provider message.

## Rollback

For immediate message rollback, set:

```dotenv
ZALO_BOT_DAILY_DIGEST_ENABLED=false
```

Redeploy and confirm the cron response reports the digest as disabled. Leave `ZALO_BOT_ENABLED=true` if staff must continue linking/unlinking and operators need to inspect records.

For a full Bot shutdown, also set `ZALO_BOT_ENABLED=false` and redeploy. Do not delete link, claim, ledger, or outbox records during rollback; retain them for investigation and safe recovery.
