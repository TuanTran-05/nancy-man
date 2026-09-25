# Quy trình Rollout Database Explorer

Tài liệu này hướng dẫn chi tiết quy trình chuẩn bị, cấp phát quyền, kiểm chứng và rollout theo từng giai đoạn cho tính năng Database Explorer trên hệ thống `man.thienuy.edu.vn`.

## 1. Nguyên tắc an toàn

1. **Mặc định tắt:** Tính năng và cả hai target (`edutrack_production`, `ops`) mặc định bị tắt cho đến khi hoàn thành toàn bộ các bước kiểm tra.
2. **Quyền tối thiểu:** Role database browser (`ops_database_browser`) chỉ được cấp quyền `SELECT` ở mức cột (column-level) cho các cột an toàn; hoàn toàn không có quyền trên các cột bị đánh dấu `blocked` (mật khẩu, khóa bảo mật, OTP, token).
3. **Kiểm tra độc lập:** Mỗi target database phải được chạy script verifier độc lập và đạt kết quả `pass` trước khi cấu hình vào worker.
4. **Không rò rỉ credential:** Không in hoặc lưu DSN, connection URL, mật khẩu vào log, ticket hay shell history. File credential phải có mode `0600`.

## 2. Thứ tự triển khai chuẩn (Phased Rollout)

Quá trình triển khai bắt buộc phải tuân thủ nghiêm ngặt theo thứ tự 11 bước sau:

### Bước 1: Render policy report
Chạy script render báo cáo chính sách dữ liệu cho từng database target:
```bash
node scripts/database-explorer/render-policy-report.mjs --target edutrack_production > policy-edutrack.json
node scripts/database-explorer/render-policy-report.mjs --target ops > policy-ops.json
```

### Bước 2: Review classifications
DBA và Security Lead rà soát toàn bộ phân loại cột:
- Đảm bảo 100% cột nhạy cảm (passwords, tokens, OTP hashes, private keys) được phân loại `blocked`.
- Xác nhận các cột PII (email, phone, họ tên học sinh/giáo viên) được phân loại `pii`.
- Xác nhận checksum dữ liệu khớp với snapshot đã kiểm duyệt.

### Bước 3: Render role grants
Sử dụng công cụ `render-database-explorer-grants.ts` để sinh ra các câu lệnh SQL `GRANT SELECT (<safe_columns>)` dựa trên snapshot và policy đã được duyệt:
```bash
node --experimental-strip-types deploy/postgres/render-database-explorer-grants.ts \
  --target edutrack_production \
  --output edutrack-grants.sql
```

### Bước 4: Apply role grants on each target
Chạy script `apply-role-grants.sh` với tham số `--role-type explorer` cho từng database target:
```bash
deploy/postgres/apply-role-grants.sh \
  --role-type explorer \
  --database edutrack_production \
  --admin-pgpass-file /path/to/dba.pgpass \
  --browser-login ops_browser_edutrack \
  --browser-password-file /secrets/edutrack_browser.pass \
  --business-schemas public \
  --schema-owner-role edutrack_owner \
  --browser-database-url-file /secrets/edutrack_browser.url \
  --grants-file edutrack-grants.sql \
  --fixture public.users \
  --safe-column id \
  --blocked-column password_hash \
  --revoke-public-privileges \
  --require-tls
```

### Bước 5: Run verifier on each target
Chạy độc lập `verify-database-explorer-role.ts` để kiểm chứng toàn bộ posture bảo mật:
```bash
node --experimental-strip-types deploy/postgres/verify-database-explorer-role.ts \
  --database-url-file /secrets/edutrack_browser.url \
  --fixture public.users \
  --safe-column id \
  --blocked-column password_hash \
  --expected-database edutrack_production \
  --expected-role ops_browser_edutrack \
  --require-tls
```
Báo cáo JSON xuất ra phải có `"status": "pass"` và không có bất kỳ failure nào.

### Bước 6: Capture approved checksums
Ghi nhận schema checksum và data policy checksum đã duyệt vào cấu hình worker để ngăn chặn schema drift hoặc truy cập khi schema bị thay đổi mà chưa duyệt lại.

### Bước 7: Install credentials
Lưu trữ an toàn các file URL credential vào server chạy SQL worker với phân quyền mode `0600` thuộc sở hữu của service account chạy worker.

### Bước 8: Enable Ops target for owner
Bật cờ cho target nội bộ Ops database trước, chỉ mở cho role `ops_owner`:
- Đặt `OPS_EXPLORER_OPS_ENABLED=true`
- Giữ `OPS_EXPLORER_EDUTRACK_ENABLED=false`
- Khởi động lại service worker và api:
  ```bash
  sudo systemctl restart edutrack-ops-sql-worker edutrack-ops-api
  ```

### Bước 9: Observe
Quan sát log hệ thống và audit ledger trong tối thiểu 24 giờ:
- Kiểm tra query timeout (15s) và lock timeout (2s).
- Xác nhận các sự kiện `database.schema_viewed` và `database.rows_viewed` được ghi vào hash chain đầy đủ.
- Xác nhận không có lỗi kết nối hoặc deadlock.

### Bước 10: Enable EduTrack target for owner
Kích hoạt target `edutrack_production` cho role `ops_owner`:
- Đặt `OPS_EXPLORER_EDUTRACK_ENABLED=true`.
- Restart worker và api.
- Kiểm tra chức năng duyệt bảng masked và quy trình step-up xác thực MFA/TOTP để reveal PII trong 10 phút.

### Bước 11: Observe & Enable maintainers
- Tiếp tục theo dõi telemetry và audit logs.
- Sau khi mọi kiểm tra ổn định, mở quyền duyệt bảng cho role `ops_maintainer` (role `ops_viewer` vẫn chỉ được phép duyệt cấu trúc schema và quan hệ ERD, không được duyệt dữ liệu).

## 3. Quy trình Rollback

Trong trường hợp phát hiện bất kỳ dấu hiệu bất thường, suy giảm hiệu năng cơ sở dữ liệu production hoặc cảnh báo bảo mật:

1. **Khóa truy cập tức thời:**
   Đặt cả hai biến cờ về `false`:
   ```bash
   OPS_EXPLORER_OPS_ENABLED=false
   OPS_EXPLORER_EDUTRACK_ENABLED=false
   ```
2. **Khởi động lại bridge:**
   ```bash
   sudo systemctl restart edutrack-ops-sql-worker edutrack-ops-api
   ```
   Hệ thống Ops API sẽ lập tức từ chối mọi yêu cầu truy vấn bảng với mã lỗi `DATABASE_TARGET_UNAVAILABLE`. Không cần can thiệp hay restart database PostgreSQL production.

3. **Thu hồi quyền tại Database (nếu có nghi vấn xâm nhập credential):**
   Chạy lệnh thu hồi quyền hoặc vô hiệu hóa login của browser:
   ```sql
   ALTER ROLE ops_browser_edutrack NOLOGIN;
   REVOKE ops_database_browser FROM ops_browser_edutrack;
   ```
