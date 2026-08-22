# Ổn định hậu cutover VPS + PostgreSQL

Tài liệu này là checklist hiện hành kể từ ngày 2026-08-20, sau khi EduTrack đã
nhận traffic và write trên PostgreSQL. Runbook cutover ngày 19/08 chỉ còn dùng
để tra cứu lịch sử.

## Nguyên tắc no-go

- Không nạp lại snapshot Firebase và không đưa Firestore trở lại làm nguồn ghi.
- Không build, sửa source hoặc thay artifact bên trong `/srv/edutrack/current`.
- Không deploy archive không ánh xạ được về một Git commit đã push.
- PayOS tạm thời không phải release gate. API key/checksum key giữ trống; giao diện
  phụ huynh phải báo “Tính năng đang phát triển” và không tạo payment request.
- Không bật cron gửi Zalo trước khi đã chạy thủ công trong chế độ/tài khoản an toàn.

## Gate 1 — nguồn phát hành tái lập được

1. Chốt mọi thay đổi source đang chạy, loại archive và dữ liệu production khỏi Git.
2. Chạy typecheck, `test:vps`, full Vitest, `build:vps` và `smoke:vps-build`.
3. Commit và push; `APP_COMMIT_SHA` phải là đủ 40 ký tự của commit đó.
4. Build trong release directory mới. Release đã activate phải được coi là bất biến.

## Gate 2 — database và backup

1. Xác nhận `schema_migrations` có đúng 19 hàng liên tục từ `0001` đến `0019`.
2. Tạo full backup mới sau mọi repair dữ liệu gần nhất.
3. Kiểm tra `pg_restore --list`, mã hoá bằng age và ghi SHA-256.
4. Chế độ chuẩn là `POSTGRES_BACKUP_MODE=offsite`: cấu hình
   `POSTGRES_BACKUP_RCLONE_REMOTE` tới nơi nằm ngoài VPS và xác nhận upload.
5. Khi người vận hành chấp nhận rủi ro tạm thời, có thể dùng
   `POSTGRES_BACKUP_MODE=local`, giữ `POSTGRES_BACKUP_RETENTION_DAYS=14` và đặt
   `POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT=85`. Mỗi lần chạy phải ghi cảnh báo
   rằng mất VPS/ổ đĩa sẽ mất cả production lẫn backup; đây không phải disaster
   recovery. Cài script đã commit vào `/srv/edutrack/shared/ops/<git-sha>` và đổi
   symlink `/srv/edutrack/shared/ops/current` atomically; không sửa trực tiếp app
   release chỉ để thay đổi backup policy.
6. Restore bản `.dump.age` vào database cô lập, rồi chạy verify schema/data read-only.

## Gate 3 — vận hành host

1. Cài crontab EduTrack đúng một nơi và xác nhận timezone `Asia/Ho_Chi_Minh`.
2. Cài `/etc/logrotate.d/edutrack` và dry-run cấu hình logrotate.
3. Xác nhận Nginx/PostgreSQL/PM2 active, HTTPS health 200 và timer renew Certbot active.
4. Lưu bằng chứng chạy thủ công từng cron; không gửi PayOS và không gọi reconciliation.

## Gate 4 — smoke và theo dõi

- Smoke login/session/logout cho admin, office, accounting, teacher, student, parent.
- Smoke upload/download, read-model, attendance và các invariant tài chính read-only.
- Google OAuth và Turnstile được kiểm tra riêng; PayOS được kỳ vọng ở trạng thái
  “đang phát triển”.
- Theo dõi PM2/Nginx/PostgreSQL và error log ít nhất 24 giờ sau release.

## Bằng chứng bắt buộc

Git SHA, checksum artifact, release path, output test/build/smoke, 19 migration,
backup mode đã phê duyệt, checksum backup local (và offsite khi mode là `offsite`),
restore drill, cron, logrotate, role smoke, health trước-sau deploy và người phê
duyệt go/no-go.
