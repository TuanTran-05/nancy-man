# Rotation role PostgreSQL cho SQL Console

Tài liệu này áp dụng cho credential của SQL Worker, không áp dụng cho database Ops riêng. Production mặc định giữ `OPS_SQL_READ_ENABLED=false`; chỉ bật sau khi toàn bộ kiểm tra bên dưới đạt và có phê duyệt vận hành.

## Điều kiện trước khi thay đổi

- Có bản ghi DR drill chứng minh RPO không quá một phút và RTO không quá 15 phút.
- Đã xem role/grant diff với DBA; đặc biệt, script sẽ bỏ quyền `TEMPORARY` khỏi `PUBLIC`, bỏ `CREATE` trên schema, toàn bộ quyền bảng/sequence và quyền thực thi function khỏi `PUBLIC` trong các business schema khai báo. Mọi ứng dụng còn cần các quyền đó phải được cấp trực tiếp trước khi chạy script.
- `ops_readonly` chỉ được cấp các business schema đã liệt kê rõ ràng; tuyệt đối không thêm `_ops`, `pg_catalog` hoặc `information_schema` vào danh sách.
- Không bật SQL Console, không deploy credential và không áp dụng role chỉ để “thử nhanh” trên production.

## Credential

Tạo hai mật khẩu URL-safe, tối thiểu 32 ký tự: một cho read login và một cho cancel login. Mỗi file credential, `pgpass` của DBA và PostgreSQL URL của read login phải thuộc service account, mode `0600`, không phải symlink.

Tuyệt đối không được ghi mật khẩu, PostgreSQL URL hoặc output chứa secret vào shell history, ticket, log deployment hay audit evidence. Audit chỉ lưu tên role, thời điểm, hash của grant diff và kết quả `pass`/`fail` của verifier.

Read login là member inherited nhưng không thể `SET ROLE` vào `ops_readonly`; cancel login chỉ kế thừa `ops_cancel`/`pg_signal_backend`, không có quyền bảng. Browser và Ops API không bao giờ đọc các credential này.

## Áp dụng và kiểm chứng

1. Chọn fixture không nhạy cảm trong business schema, bao gồm một cột có thể xuất hiện trong `UPDATE ... WHERE false`. Verifier chỉ thử mutation trong transaction rồi rollback.
2. Đặt file credential của read login vào secret store/system credential; PostgreSQL URL phải kết nối bằng login read mới và TLS được kiểm tra ở cấu hình worker.
3. DBA chạy `deploy/postgres/apply-role-grants.sh` với database, business schemas, owner role, file credential và `--revoke-public-privileges`.
4. Script tự chạy `verify-readonly-role.ts`. Báo cáo phải có `status: "pass"`, các đọc đơn giản/catalog/schema phải pass; INSERT, UPDATE, DELETE, TRUNCATE, CREATE TABLE/TEMP TABLE/FUNCTION, ALTER, DROP và `SET ROLE ops_cancel` phải bị từ chối.
5. Lưu bằng chứng không-secret: thời điểm, database identity, role, version script, hash của grant diff và trạng thái kiểm chứng. Không lưu SQL URL hay password.
6. Chỉ sau đó mới tạo configuration worker trỏ vào read credential. Vẫn để `OPS_SQL_READ_ENABLED=false` cho tới khi gate Phase 3 được duyệt.

## Rotation và retirement

Mỗi rotation tạo read/cancel login mới thay vì ghi đè login đang chạy. Cập nhật secure credential của worker để login mới được verifier kiểm chứng trước. Sau grace period, truyền `--retire-login <old-login>` cho script.

Script đọc `pg_stat_activity`. Nếu còn session của login cũ, nó dừng với trạng thái an toàn và không vô hiệu hóa role. Chỉ khi session đã drain, script chạy `ALTER ROLE ... NOLOGIN` và revoke membership của role cũ. Không terminate session production để ép rotation.

Nếu verifier fail, giữ `OPS_SQL_READ_ENABLED=false`, revoke credential/login mới theo change đã duyệt và mở incident; không bỏ qua bằng cách chạy SQL bằng owner account.
