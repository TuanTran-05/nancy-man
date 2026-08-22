# Bằng chứng ổn định hậu cutover VPS — 2026-08-20

Tài liệu này ghi lại trạng thái đã kiểm chứng sau khi EduTrack chuyển runtime từ
Vercel/Firebase sang VPS/PostgreSQL. Mọi thời gian vận hành bên dưới dùng múi giờ
`Asia/Ho_Chi_Minh`, trừ timestamp UTC do API trả về.

## Kết luận

Release ứng dụng `123305562157f4e6ac77b836ebe29394d5753c5c` đang phục vụ production
từ `/srv/edutrack/releases/20260820-12330556`. Symlink
`/srv/edutrack/current` trỏ đúng release này, PM2 online và cả health loopback lẫn
HTTPS đều trả HTTP 200 với PostgreSQL connected và đúng release SHA.

PayOS được chủ động loại khỏi release gate. Cả `PAYOS_ENABLED` và
`VITE_PAYOS_ENABLED` đều là `false`. Giao diện phụ huynh hiển thị trạng thái
“Đang phát triển”, không gọi API/SDK khi người dùng bấm nút; endpoint tạo thanh
toán trả HTTP 503 với mã `PAYOS_DISABLED`.

## Mã nguồn và artifact

- Commit ứng dụng: `123305562157f4e6ac77b836ebe29394d5753c5c`
- Commit vận hành bổ sung EOL logrotate: `85723003fd086058e7e2c32170895d3e5581a258`
- Source archive SHA-256: `d10915dbb286a231a09afc98df903fe9b5634420d3e9c4b150b5ba8ca339d377`
- Build archive SHA-256: `23a5bf3f421146bf12c418580cdce09beefa0e8f5eee529bbd981019fd729aea`
- Release rollback gần nhất: `/srv/edutrack/releases/20260820-fullsync-033305`

Các gate đã đạt:

- typecheck;
- `test:vps`: 78/78;
- full Vitest: 5.334 passed, 4 skipped trên 643 file;
- `build:vps` và `smoke:vps-build`;
- runtime smoke sau `npm prune --omit=dev`;
- migration dry-run: 19 migration đã áp dụng, không còn migration chờ;
- runtime dependency audit: 0 vulnerability.

## PostgreSQL, backup và restore drill

- PostgreSQL 16.14, đủ 19 migration và 85 bảng ứng dụng.
- Backup mã hóa:
  `/srv/edutrack/shared/backups/postgres/edutrack-20260820T032510Z.dump.age`.
- Kích thước: 4.307.390 byte.
- `sha256sum -c`: đạt.
- Restore drill chạy trên PostgreSQL 16 cô lập tại port tạm `55432`, không ghi vào
  production.
- Restore drill kiểm tra đủ schema, index, foreign key, trigger, số lượng document
  và các invariant dữ liệu/tài chính; kết quả đạt.
- Bằng chứng restore:
  `/srv/edutrack/shared/logs/restore-drill-20260820T032605Z.log`.
- Cluster restore tạm đã dừng và dữ liệu tạm đã được xóa sau khi kiểm tra.

Backup offsite chưa được cấu hình vì VPS chưa có rclone remote. Rclone 1.75.0 đã
được cài cho user `deploy` tại `/home/deploy/.local/bin/rclone`, checksum bản phát
hành chính thức đã đạt và crontab đã có user-local bin trong `PATH`.

Theo quyết định tạm thời của người vận hành lúc 11:00 ngày 2026-08-20, backup chạy
ở `POSTGRES_BACKUP_MODE=local`, retention 14 ngày và từ chối bắt đầu khi filesystem
đã dùng từ 85% trở lên. Script backup được tách khỏi app release, cài bất biến tại
`/srv/edutrack/shared/ops/cb2a5a6b` và symlink `shared/ops/current` trỏ tới đó.
Source commit đầy đủ là `cb2a5a6b21a556073baf29dee6bfc37b2d71595a`.

Backup thủ công `edutrack-20260820T041016Z.dump.age` đạt `pg_restore --list`, age
encryption và SHA-256. Restore drill từ chính file này đạt 19 migration, 85 bảng
và 27.594 document; cluster PostgreSQL tạm trên port 55433 đã được dừng và xóa.
Bằng chứng:

- `/srv/edutrack/shared/logs/backup-manual-20260820T041016Z.log`;
- `/srv/edutrack/shared/logs/restore-drill-local-20260820T041046Z.log`.

Mô phỏng đúng môi trường cron tạo thêm bản `edutrack-20260820T041146Z.dump.age`,
checksum đạt và ghi đủ cảnh báo local-only vào
`/srv/edutrack/shared/logs/backup.log`. Sau cleanup artifact thử, disk dùng 72%,
dưới ngưỡng 85%. Backup local không bảo vệ được trường hợp mất toàn bộ VPS/ổ đĩa.

## Host và lịch vận hành

Crontab của user `deploy` đã được cài với `CRON_TZ=Asia/Ho_Chi_Minh`:

- 00:15: logrotate bằng `/srv/edutrack/shared/logrotate.conf` và state riêng;
- 01:00: `/api/audit/daily-maintenance`;
- 03:00: backup PostgreSQL mã hóa local-only qua `shared/ops/current`;
- 21:30: `/api/audit/zalo-bot-daily-digest`;
- 21:35: `/api/audit/outbox-process`.

User `deploy` không có sudo nên cấu hình logrotate không được ghi vào
`/etc/logrotate.d`. Cấu hình tương đương được chạy bằng crontab user, đã qua debug
và một lần chạy thật; state file xác nhận các log EduTrack đã được nhận diện.

Lần chạy thủ công daily maintenance đạt 8/8 bước. Cleanup đã xóa 2.265 audit log
đủ điều kiện theo retention policy và 5 Zalo chat session hết hạn. Không có outbox
được xử lý, không có người nhận Zalo được enqueue và không có PayOS reconciliation.

TLS cho `vps.thienuy.edu.vn` hợp lệ từ 2026-08-19 đến 2026-11-17. Timer
`snap.certbot.renew.timer` active; lần renew gần nhất kết thúc với `Result=success`
và exit code 0 lúc 10:11:24 ngày 2026-08-20.

Tại lần hậu kiểm lúc 10:46 ngày 2026-08-20:

- `GET http://127.0.0.1:3000/api/v1/health`: HTTP 200;
- `GET https://vps.thienuy.edu.vn/api/v1/health`: HTTP 200;
- `GET https://vps.thienuy.edu.vn/`: HTTP 200;
- `POST /api/v1/payments/payos/create`: HTTP 503, `PAYOS_DISABLED`;
- không có stack trace gắn với release hiện hành trong PM2 error log;
- dung lượng đĩa: 70% đã dùng, còn khoảng 12 GiB.

Lúc 11:07 phát hiện một release app được triển khai đồng thời tại
`/srv/edutrack/releases/20260820-110500-reportfix2`. Release này không có
`.release-commit` và vẫn báo SHA `123305562157f4e6ac77b836ebe29394d5753c5c` dù
artifact khác release đã được chứng minh trước đó. Để không ghi đè hotfix này,
backup được triển khai thành ops release độc lập; app hiện vẫn chạy `reportfix2`
và health 200. Chủ sở hữu hotfix cần bổ sung source commit/artifact provenance.

## Rủi ro được giữ nguyên để xử lý riêng

Daily student-identity health hiện báo một hồ sơ có hai enrollment mở. Điều tra
read-only cho thấy đây không phải hai bản ghi chuyển lớp trùng: hai enrollment
thuộc hai lớp/term khác nhau và đều có lịch điểm danh cùng ledger đã thanh toán.
Trong khi đó canonical read, progression, health và các đặc tả hiện hành đều cố
ý áp đặt invariant “mỗi hồ sơ chỉ có một enrollment mở”.

Không đóng enrollment production và không hạ điều kiện health để che cảnh báo.
Không chuyển canonical read mode sang `canonical_required` cho tới khi có quyết
định sản phẩm rõ ràng: EduTrack có hỗ trợ một học viên học đồng thời nhiều lớp hay
không. Nếu có, cần một đợt thiết kế/migration xuyên suốt read model, progression,
transfer, dashboard, accounting projection và health gate.

## Việc còn lại

1. Khi chọn được nơi lưu ngoài VPS, cung cấp rclone remote theo dạng `remote:path`
   và credentials tương ứng; chuyển mode sang `offsite`, xác nhận upload/download
   và restore bản tải về. Cron 03:00 hiện đã hoạt động ở mode local.
2. Bổ sung commit SHA và artifact checksum thật cho release app `reportfix2`.
3. Theo dõi PM2/Nginx/PostgreSQL/error log đủ 24 giờ sau release.
4. Chốt yêu cầu nghiệp vụ đối với học viên học đồng thời nhiều lớp trước khi tiếp
   tục canonical student cutover.
