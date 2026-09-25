# Quy trình Rollout Database Explorer

Tài liệu này mô tả cách kiểm tra snapshot, duyệt policy, cấp role chỉ đọc và chuẩn bị credentials cho Database Explorer. Không bật feature gate cho đến khi cả hai target đã qua verifier và có phê duyệt rollout riêng.

## Mặc định và danh tính PostgreSQL

API, SQL worker và từng target đều tắt trong các file môi trường mẫu. SQL worker chỉ nhận credential qua `FileSecretResolver`; file môi trường chứa reference, không chứa URL hay secret.

`ops_database_browser` là capability role `NOLOGIN`. Hai kết nối dùng danh tính riêng: `ops_browser_edutrack` trên database `edutrack_production` và `ops_browser_ops` trên database `edutrack_ops`. Mỗi login kế thừa capability với `INHERIT TRUE, SET FALSE`, tối đa hai kết nối, `default_transaction_read_only=on`, và không có quyền elevated. Chỉ capability role nhận column grants đã duyệt.

## 1. Lấy snapshot cấu trúc đã xác thực

Dùng session cookie đã xác thực của Ops API trong cookie jar có quyền đọc riêng (mode `0600`). Không đặt cookie hoặc bearer token trực tiếp trong lệnh hay shell history. Lưu response của `GET /api/v1/database/:targetId/schema` thành snapshot riêng cho từng target:

```bash
umask 077
OPS_BASE_URL=https://man.thienuy.edu.vn
OPS_COOKIE_JAR=/secure/path/ops-session-cookie-jar

curl --fail --silent --show-error --cookie "$OPS_COOKIE_JAR" \
  "$OPS_BASE_URL/api/v1/database/edutrack_production/schema" \
  --output schema-edutrack.json
curl --fail --silent --show-error --cookie "$OPS_COOKIE_JAR" \
  "$OPS_BASE_URL/api/v1/database/ops/schema" \
  --output schema-ops.json

jq -e '.targetId == "edutrack_production" and (.checksum | test("^[a-f0-9]{64}$")) and (.schemas | type == "array" and length > 0)' schema-edutrack.json >/dev/null
jq -e '.targetId == "ops" and (.checksum | test("^[a-f0-9]{64}$")) and (.schemas | type == "array" and length > 0)' schema-ops.json >/dev/null
```

Các lệnh `jq` phải thành công; snapshot rỗng hoặc không có schema không được dùng để cấp quyền. Duyệt đúng structural response từ endpoint. Không dùng response chứa `rows`, `cells` hoặc `rowRefs`.

## 2. Render và review policy report

Truyền trực tiếp snapshot không rỗng vào report CLI. CLI vẫn hỗ trợ stdin cho thao tác tương tác, nhưng quy trình rollout luôn dùng `--snapshot-file` và target phải khớp snapshot:

```bash
node scripts/database-explorer/render-policy-report.mjs \
  --target edutrack_production --snapshot-file schema-edutrack.json \
  > policy-edutrack.txt
node scripts/database-explorer/render-policy-report.mjs \
  --target ops --snapshot-file schema-ops.json \
  > policy-ops.txt
```

DBA và Security Lead rà soát toàn bộ tên cột và classification trong hai báo cáo. Đảm bảo cột mật khẩu, token, OTP, khóa riêng và credential là `blocked`; PII được gắn `pii`. Ghi lại đúng `policyVersion` và checksum của từng snapshot sau khi hoàn tất review.

Sau khi được duyệt, tạo approval JSON cho SQL worker. `version` phải bằng `policyVersion`; checksum từng target phải khớp snapshot đã review:

```json
{
  "version": "<policyVersion đã duyệt>",
  "targets": {
    "edutrack_production": "<checksum trong schema-edutrack.json>",
    "ops": "<checksum trong schema-ops.json>"
  }
}
```

Không render grants bằng approval rỗng, checksum suy đoán hoặc snapshot khác target.

## 3. Render column grants đã duyệt

CLI yêu cầu snapshot, approval, target, capability role và output path. Output path phải mới. Mọi trực tiếp bảng hiện có sẽ bị thu hồi trước khi cấp schema usage và SELECT cột được duyệt; blocked, không-selectable, foreign-table và relation không khả dụng không nhận SELECT. CLI không tạo sequence hoặc function grants.

```bash
node --experimental-strip-types deploy/postgres/render-database-explorer-grants.ts \
  --snapshot-file schema-edutrack.json \
  --approval-file /secure/path/database-policy-approval.json \
  --target edutrack_production \
  --role ops_database_browser \
  --output edutrack-grants.sql

node --experimental-strip-types deploy/postgres/render-database-explorer-grants.ts \
  --snapshot-file schema-ops.json \
  --approval-file /secure/path/database-policy-approval.json \
  --target ops \
  --role ops_database_browser \
  --output ops-grants.sql
```

Renderer dừng mà không tạo SQL nếu thiếu tham số, target mở/không khớp, snapshot có row data, policy version không khớp, hay checksum không có trong approval.

## 4. Provision và xác minh từng login

Provision riêng từng database. `--target` đóng xác định login được phép; `--database` phải là database đúng của target. Mật khẩu lấy từ file mode `0600`, URL verifier kết nối bằng TLS `verify-full`, không đưa secret vào command arguments.

Ví dụ target EduTrack Production:

```bash
deploy/postgres/apply-role-grants.sh \
  --role-type explorer --target edutrack_production \
  --database edutrack_production \
  --admin-pgpass-file /secure/path/dba.pgpass \
  --browser-login ops_browser_edutrack \
  --browser-password-file /secure/path/edutrack-browser.pass \
  --business-schemas public --schema-owner-role edutrack_owner \
  --browser-database-url-file /secure/path/edutrack-browser.url \
  --grants-file edutrack-grants.sql \
  --fixture public.users --safe-column id --blocked-column password_hash \
  --revoke-public-privileges --require-tls
```

Target Ops dùng `--target ops`, `--database edutrack_ops`, `--browser-login ops_browser_ops`, cùng snapshot, grant SQL, URL và fixture tương ứng. Không dùng chung login giữa hai target.

Verifier phải báo `status: "pass"`, đúng database và login đã cấu hình, TLS đang hoạt động, SELECT cột blocked bị từ chối, và mọi mutation bị từ chối. Ví dụ verifier của target EduTrack Production:

```bash
node --experimental-strip-types deploy/postgres/verify-database-explorer-role.ts \
  --database-url-file /secure/path/edutrack-browser.url \
  --fixture public.users --safe-column id --blocked-column password_hash \
  --expected-database edutrack_production \
  --expected-role ops_browser_edutrack --require-tls
```

Lặp lại với `edutrack_ops` và `ops_browser_ops`. Giữ feature gates false nếu bất kỳ verifier nào fail.

## 5. Credentials systemd và enablement

Base `edutrack-ops-sql-worker.service` không tải database URL, cursor key hoặc approval. Chỉ sau khi cả bốn file tồn tại dưới `/etc/edutrack-ops/credentials/`, thuộc `root:root`, mode `0400`, không phải symlink, mới chạy installer với opt-in tường minh:

```bash
sudo EDUTRACK_OPS_INSTALL_DATABASE_EXPLORER_DROPIN=true \
  deploy/ops/scripts/install-systemd-assets.sh /srv/edutrack-ops/releases/<release>
```

Installer kiểm tra hai target URL, `ops-database-cursor-key` và `ops-database-policy-approval` trước khi cài drop-in. Không có opt-in thì các file này không được kiểm tra và drop-in không được cài.

Giữ `OPS_SQL_WORKER_ENABLED=false` ở API, `OPS_DATABASE_EXPLORER_ENABLED=false` ở worker và hai target gate false cho tới khi hoàn tất role verification cùng phê duyệt triển khai. Enable từng target cho một `ops_owner`, bật API bridge và worker gates theo thứ tự, rồi theo dõi target health, timeout, latency và audit đầy đủ ít nhất 24 giờ trước khi xét target còn lại. Chỉ mở maintainer sau khi hai cửa sổ quan sát được review riêng. Local tests không thay thế quan sát production.

## 6. Cursor key rotation

Giữ nguyên reference `ops-database-cursor-key`. Khi chủ động xoay key, thay nội dung bằng canonical standard Base64 của đúng 32 byte ngẫu nhiên (tạo bằng `openssl rand -base64 32`), lưu file credential an toàn mode `0600`, rồi restart SQL worker trong change được duyệt. Key mới làm cursor và rowRef cũ không còn hợp lệ; client bắt đầu lại từ trang đầu. Không bật fallback cho token cũ.

## 7. Rollback

Tắt target bị ảnh hưởng ngay. Nếu cần, tắt thêm Database Explorer toàn cục ở worker và API-to-worker bridge:

```dotenv
OPS_DATABASE_EDUTRACK_ENABLED=false
OPS_DATABASE_OPS_ENABLED=false
OPS_DATABASE_EXPLORER_ENABLED=false
OPS_SQL_WORKER_ENABLED=false
```

Áp dụng env change và restart SQL worker/API theo quy trình vận hành. Nếu nghi credential bị lộ, đặt login liên quan thành `NOLOGIN`, revoke membership `ops_database_browser`, rồi rotate credential qua change được duyệt. Không sửa role hoặc xoay credential như một phần của local test.
