# Ops Console cho `man.thienuy.edu.vn` — Design

**Ngày:** 2026-08-23  
**Trạng thái:** Đã duyệt thiết kế; chờ người dùng duyệt tài liệu trước khi lập kế hoạch triển khai.

## 1. Mục tiêu và phạm vi

`man.thienuy.edu.vn` là Ops Console nội bộ, chỉ dành cho một vài tài khoản vận hành độc lập với EduTrack. Nó phải cho biết nhanh tình trạng ứng dụng, PostgreSQL, cron, backup và lỗi mới; đồng thời gửi cảnh báo qua Zalo Bot.

Console chỉ đọc trạng thái của EduTrack. Ngoại lệ duy nhất là người vận hành có thể **acknowledge** một cảnh báo trong kho dữ liệu riêng của Ops Console. Website không được có thao tác restart tiến trình, chạy SQL, thay đổi dữ liệu nghiệp vụ, hay thay đổi cấu hình production.

Không thuộc phiên bản đầu:

- Truy cập log thô, request body, cookie, token, mật khẩu, số điện thoại hoặc dữ liệu học viên.
- Console truy vấn tùy ý, truy vấn nghiệp vụ, dashboard top-query, hay quyền `pg_monitor`/superuser.
- Bật `pg_stat_statements`, thay đổi `shared_preload_libraries`, hoặc đổi cấu hình PostgreSQL cần restart.
- Dùng tài khoản EduTrack (`admin`, `office`, v.v.) để đăng nhập console.

## 2. Khảo sát hiện trạng

| Hạng mục | Kết quả | Hệ quả thiết kế |
| --- | --- | --- |
| DNS `man.thienuy.edu.vn` | Đã trỏ tới VPS, nhưng chưa có Nginx vhost/chứng chỉ TLS; HTTPS hiện lỗi SNI. | Phải phát hành vhost/certificate riêng. |
| EduTrack runtime | Express/Node chạy qua PM2 ở `127.0.0.1:3000`; `/api/v1/liveness` và `/api/v1/health` đang xanh. | Console probe qua loopback, không qua Internet. |
| Health hiện có | Chỉ trả liveness, release và trạng thái PostgreSQL cơ bản. | Collector bổ sung lịch sử, ngưỡng và event. |
| PostgreSQL | PostgreSQL 16, ~81 MB; không có lock chờ/deadlock tại thời điểm khảo sát. `pg_stat_statements` chưa cài, `track_io_timing` tắt. | V1 dùng metric catalog tổng hợp đã phê duyệt, không thu query text. |
| Error log | PM2 lưu log thô; các lỗi gần nhất là đợt timeout/kết nối PostgreSQL ngày 22/08. Chưa có error store cấu trúc. | Chỉ collector đọc log và lưu event đã redaction/fingerprint. |
| Cron/backup | Cron ghi `cron.log`; backup PostgreSQL mã hóa, checksum và chạy hằng ngày. Backup hiện chỉ local trên VPS. | Theo dõi log/artifact; local-only là cảnh báo rủi ro. |
| Zalo Bot | Đã bật, có token/webhook secret; danh sách người nhận pilot hiện rỗng. | Release phải có allowlist UID nhận alert riêng cho Ops. |

## 3. Kiến trúc

```text
Browser
  -> Nginx :443 + TLS, man.thienuy.edu.vn
  -> ops-web (127.0.0.1:3101, service riêng)
  -> Ops SQLite

ops-collector (không mở cổng Internet)
  -> /api/v1/liveness và /api/v1/health qua loopback
  -> PostgreSQL qua user ops_monitor và hàm metric tổng hợp
  -> PM2 pid/error log, cron log, artifact backup trên VPS
  -> Ops SQLite + Zalo Bot alert sender
```

Code nằm trong package độc lập `ops-console/` trong repository, có build/release artifact và service riêng tại `/srv/edutrack-ops`; nó không dùng `/srv/edutrack/current` của application. Nginx chỉ proxy tới `127.0.0.1:3101` và chỉ phục vụ Ops Console cho hostname `man.thienuy.edu.vn`.

`ops-web` chạy bằng OS account riêng, không có quyền đọc `.env` của EduTrack, socket PM2, log application hoặc credential PostgreSQL. `ops-collector` là tiến trình không public, chỉ nhận input từ file/log và nguồn loopback đã xác định; nó dùng secret file quyền hạn chế để đọc metric và gửi Zalo. Không có shell command được tạo từ nội dung log hay input HTTP.

Ops SQLite là kho độc lập với database EduTrack để console vẫn hiển thị snapshot gần nhất, event và trạng thái alert khi PostgreSQL của app không kết nối được. Bật WAL, backup dữ liệu Ops hằng ngày cùng release metadata. Mọi timestamp lưu UTC và hiển thị `Asia/Ho_Chi_Minh`.

## 4. Bảo mật và định danh

- Account Ops được provision/revoke bằng CLI do operator hệ thống chạy, không có màn hình quản trị user trong website.
- Login dùng username riêng, mật khẩu hash bằng `scrypt` (tham số versioned), TOTP bắt buộc và rate limit. TOTP seed được mã hóa bằng key tách riêng khỏi database.
- Session server-side có cookie `Secure`, `HttpOnly`, `SameSite=Strict`, idle timeout 15 phút, absolute timeout 8 giờ, rotate session khi đăng nhập và logout/revoke được.
- API của web yêu cầu session và CSRF protection cho acknowledge/logout. Chỉ public các route login/TOTP cần thiết; các response không cache.
- Nginx đặt HSTS, `X-Content-Type-Options`, CSP không cho script bên thứ ba, `X-Robots-Tag: noindex`, request-size nhỏ, rate limit login và không route bất kỳ `/api` EduTrack nào.
- Mọi truy cập, login thất bại, acknowledge và thay đổi trạng thái alert ghi audit vào SQLite, không chứa secret.

### Quyền PostgreSQL

Tạo schema `ops_metrics`, owner không-login riêng và role login `ops_monitor`. Role này không có `SELECT` trên các bảng public, không là member của `pg_monitor`, không có `CREATE`, DML hay quyền role. Nó chỉ có `EXECUTE` trên một tập hàm `SECURITY DEFINER` đã review; mỗi hàm cố định `search_path = pg_catalog`, không nhận SQL/text động và chỉ trả aggregate sau:

- thời gian probe, database size, state/connection count, active count;
- lock đang chờ, deadlock/rollback/temp-file counter;
- dead tuple/autovacuum/autoanalyze theo tên bảng, không có dữ liệu hàng;
- các thông số cấu hình an toàn cần hiển thị (ví dụ max connections, `track_io_timing`, extension quan sát).

Credential `ops_monitor` chỉ ở secret file của collector. Nếu probe database bị từ chối/lỗi, collector ghi `database_unreachable`; nó không tự tăng quyền, thay `pg_hba.conf` hay sửa PostgreSQL.

## 5. Thành phần và dữ liệu

### Collector

Collector chạy độc lập qua systemd, không phải PM2:

| Nguồn | Chu kỳ | Dữ liệu lưu |
| --- | ---: | --- |
| Liveness/health loopback | 15 giây | HTTP state, latency, release, failure reason đã giới hạn |
| PID/process app | 15 giây | Có mặt/không, PID, uptime, memory và transition; không lưu environment |
| PostgreSQL snapshot | 60 giây | Metric trả từ `ops_metrics` và thời gian kết nối |
| Error log PM2 | tail tăng dần | Fingerprint, mức, count, first/last seen, excerpt redacted |
| `cron.log` và artifact | 60 giây | Last success/failure/skip theo job, tuổi backup, checksum/artifact, dung lượng |

Collector bắt đầu tail từ cuối file khi bootstrap để lỗi lịch sử không tạo alert mới. Sau đó cursor theo inode/offset để chịu log rotation. Redactor chạy trước khi persist hoặc gửi Zalo: che key/token/bearer/cookie/password, email, phone, UUID nghiệp vụ và payload JSON; excerpt có giới hạn độ dài. Fingerprint được tạo từ thành phần đã redaction.

Unit collector dùng `Restart=on-failure`, watchdog và `OnFailure` unit riêng. Failure unit gửi một thông điệp Zalo cố định (không parse log, không truy cập SQLite) qua credential hạn chế, để sự cố của collector vẫn được báo khi dashboard không còn cập nhật.

Retention: raw snapshot 30 ngày; aggregate ngày 12 tháng; error/alert/audit 90 ngày. Cleanup chạy trong collector và được ghi event riêng khi thất bại.

### Dashboard

Một dashboard responsive, auto-refresh, hiển thị rõ `last updated` và trạng thái `stale` khi collector không gửi dữ liệu:

1. **Tổng quan:** trạng thái overall, sự cố đang mở, sự cố đã acknowledge, thời điểm snapshot/release.
2. **Service:** liveness, health, probe latency, process/pid, memory và lần transition gần đây.
3. **PostgreSQL:** kết nối, latency, connection saturation, active/waiting locks, deadlock/rollback/temp, database/disk size, dead tuple và autovacuum. Capability không có trong V1 được hiện là unavailable thay vì 0.
4. **Cron & backup:** từng job expected/last result, tuổi backup, encrypted/checksum state, size và cảnh báo local-only/offsite.
5. **Errors & alerts:** danh sách event theo fingerprint/status, thống kê 5 phút/1 giờ, trích đoạn đã lọc, timeline, acknowledge actor/time/note.

Không có biểu mẫu SQL, terminal, restart, config editor hay navigation vào ứng dụng EduTrack.

## 6. Đánh giá trạng thái và Zalo alert

Mỗi monitor là một state machine `unknown -> healthy/warning/critical -> recovered`, có event chỉ khi transition hoặc threshold thay đổi. Baseline `unknown` không alert trước khi có đủ mẫu.

| Điều kiện | Mức |
| --- | --- |
| Hai liveness/process probe liên tiếp thất bại | Critical |
| Hai PostgreSQL probe liên tiếp thất bại | Critical |
| Waiting lock tồn tại trên hai snapshot liên tiếp | Warning; Critical nếu kéo dài 5 phút |
| Connection >80% trong 5 phút | Warning; >90% trong 5 phút là Critical |
| Disk backup >80% | Warning; >90% là Critical |
| Backup mã hóa/checksum thành công gần nhất quá 26 giờ, hoặc cron job quá schedule +30 phút | Critical |
| Backup chỉ local | Warning liên tục trên dashboard, nhắc Zalo tối đa một lần/ngày |
| Cùng fingerprint lỗi >=10 lần/5 phút hoặc dòng `FATAL` mới | Critical |

Một alert gửi Zalo ngay khi transition vào warning/critical; cùng fingerprint chỉ nhắc sau 30 phút. Hai mẫu healthy liên tiếp tạo recovery event và gửi một tin recovery. Tin Zalo chỉ chứa severity, monitor, thời điểm, số lần lỗi và link console; không chứa error excerpt hay database/business data. Người nhận chỉ lấy từ `OPS_ALERT_ZALO_RECIPIENT_UIDS`, bắt buộc non-empty trên production và không dùng allowlist chat/admin thông thường.

Nếu Zalo lỗi, alert được persist là `delivery_failed`, retry exponential có giới hạn và xuất hiện ở dashboard. Console không được đánh dấu healthy chỉ vì gửi alert thành công.

## 7. Kiểm thử và tiêu chí release

### Kiểm thử

- Unit: redactor/fingerprint, parser log rotation, status threshold, dedupe/cooldown/recovery, cron/backup parser, SQLite retention, metric response mapping.
- Database: contract test cho `ops_metrics` bằng role `ops_monitor`; khẳng định không `SELECT` bảng public, không DML/DDL và không nhận dynamic SQL.
- Security: password/TOTP/session expiry/CSRF/rate-limit, protected API, account audit, no secrets/PII in stored events/HTML/Zalo payload.
- UI: loading/stale/unknown/warning/critical/recovered, responsive dashboard và acknowledge.
- Integration: mock liveness/PostgreSQL/log/cron/backup/Zalo; app/DB down vẫn render snapshot và alert queue.
- Deployment smoke: build, SQLite migration, systemd hardening, `nginx -t`, certificate issuance/renewal, HTTPS SNI, auth/TOTP, loopback probes, synthetic critical/recovery alert tới recipient test.

### Release gates

1. `man.thienuy.edu.vn` DNS trỏ VPS và HTTP ACME challenge truy cập được.
2. Secret file và `OPS_ALERT_ZALO_RECIPIENT_UIDS` được provision; không commit secret/UID.
3. `ops_monitor` least-privilege test pass và collector không có capability DML.
4. Cả web/collector chạy qua systemd, restart độc lập; Nginx certificate và renewal test pass.
5. Synthetic alert/recovery nhận qua Zalo với recipient được phê duyệt; không có PII/secret trong message.
6. Rollback chỉ tắt vhost/service của Ops Console và trả về release Ops trước; không sửa runtime/data EduTrack. Role/hàm metric có thể giữ lại vô hại sau rollback.

## 8. Rủi ro và xử lý

- **DB down:** SQLite giữ snapshot/event; monitor nêu rõ `database_unreachable`, không suy diễn metric cũ là hiện tại.
- **Collector down:** dashboard chuyển `stale`; systemd restart unit, còn `OnFailure` notifier gửi Zalo cố định qua kênh độc lập.
- **Web down:** collector và Zalo sender vẫn tiếp tục; Nginx có 502 nhưng app EduTrack không bị ảnh hưởng.
- **Zalo down:** retry hữu hạn, dashboard hiển thị delivery failure; không retry vô hạn.
- **Disk full:** metric disk/backup sẽ alert trước ngưỡng; SQLite write failure chuyển console sang degraded và không làm ảnh hưởng database app.
- **Log chứa dữ liệu nhạy cảm:** persist/send chỉ sau redaction; test fixture chứa token, email, phone và JSON để ngăn regression.

## 9. Tiêu chí hoàn thành

Production tại `https://man.thienuy.edu.vn` yêu cầu account Ops + TOTP, hiển thị toàn bộ monitor trên bằng dữ liệu đã làm sạch, tự phát hiện các failure scenario đã nêu, ghi acknowledge/audit, gửi và dedupe Zalo alert/recovery. Main application tại `vps.thienuy.edu.vn` tiếp tục chạy không bị restart, đổi route hay tăng quyền database cho browser.
