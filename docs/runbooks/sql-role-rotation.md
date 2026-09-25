# Rotation role PostgreSQL cho SQL Console và Database Explorer

Tài liệu này áp dụng cho credential của SQL Worker dành cho SQL Console (`ops_readonly`) và Database Explorer (`ops_database_browser`). Production mặc định giữ `OPS_SQL_READ_ENABLED=false`, `OPS_DATABASE_EXPLORER_ENABLED=false`, cả hai target false và `OPS_SQL_WORKER_ENABLED=false`; chỉ bật sau khi toàn bộ kiểm tra bên dưới đạt và có phê duyệt vận hành. Chi tiết rollout xem tại [database-explorer-rollout.md](./database-explorer-rollout.md).

## Điều kiện trước khi thay đổi

- Có bản ghi DR drill chứng minh RPO không quá một phút và RTO không quá 15 phút.
- Đã xem role/grant diff với DBA; đặc biệt, script sẽ bỏ quyền `TEMPORARY` khỏi `PUBLIC`, bỏ `CREATE` trên schema, toàn bộ quyền bảng/sequence và quyền thực thi function khỏi `PUBLIC` trong các business schema khai báo. Mọi ứng dụng còn cần các quyền đó phải được cấp trực tiếp trước khi chạy script.
- `ops_readonly` và `ops_database_browser` chỉ được cấp các business schema đã liệt kê rõ ràng; tuyệt đối không thêm `_ops`, `pg_catalog` hoặc `information_schema` vào danh sách.
- Không bật SQL Console hay Database Explorer, không deploy credential và không áp dụng role chỉ để “thử nhanh” trên production.

## Credential

Tạo mật khẩu URL-safe, tối thiểu 32 ký tự cho login mới. Mỗi file credential, `pgpass` của DBA và PostgreSQL URL của login phải thuộc service account, mode `0600`, không phải symlink.

Tuyệt đối không được ghi mật khẩu, PostgreSQL URL hoặc output chứa secret vào shell history, ticket, log deployment hay audit evidence. Audit chỉ lưu tên role, thời điểm, hash của grant diff và kết quả `pass`/`fail` của verifier.

- SQL Console: Read login là member inherited nhưng không thể `SET ROLE` vào `ops_readonly`; cancel login chỉ kế thừa `ops_cancel`/`pg_signal_backend`, không có quyền bảng.
- Database Explorer: `ops_browser_edutrack` và `ops_browser_ops` là LOGIN riêng của đúng target/database. Mỗi login kế thừa capability `ops_database_browser` bằng `INHERIT TRUE, SET FALSE`, tối đa hai kết nối, read-only mặc định và không có quyền elevated. Chỉ capability role nhận column SELECT đã duyệt; blocked columns không thể SELECT.

Browser và Ops API không bao giờ đọc trực tiếp các credential này.

## Áp dụng và kiểm chứng

1. Chọn fixture không nhạy cảm trong business schema, bao gồm một cột có thể xuất hiện trong `UPDATE ... WHERE false`. Verifier chỉ thử mutation trong transaction rồi rollback. Đối với explorer role, cung cấp thêm `--blocked-column` để xác nhận cột nhạy cảm bị từ chối truy cập.
2. Đặt file credential của read/browser login vào secret store/system credential; PostgreSQL URL phải kết nối bằng login mới và TLS được kiểm tra ở cấu hình worker.
3. DBA chạy `deploy/postgres/apply-role-grants.sh`:
   - Cho SQL Console: Chạy chế độ mặc định với `--read-login`, `--cancel-login`.
   - Cho Database Explorer: chạy riêng từng target với `--role-type explorer --target edutrack_production --browser-login ops_browser_edutrack` hoặc `--target ops --browser-login ops_browser_ops`; truyền snapshot grants đã được approval checksum duyệt.
4. Script tự chạy `verify-readonly-role.ts` hoặc `verify-database-explorer-role.ts`. Báo cáo phải có `status: "pass"` và đúng LOGIN/database identity. Các thao tác bị cấm (INSERT, UPDATE, DELETE, TRUNCATE, CREATE TABLE/TEMP TABLE/FUNCTION, ALTER, DROP, COPY TO PROGRAM) và SELECT cột blocked phải bị từ chối.
5. Lưu bằng chứng không-secret: thời điểm, database identity, role, version script, hash của grant diff và trạng thái kiểm chứng. Không lưu SQL URL hay password.
6. Chỉ sau đó mới tạo configuration worker trỏ vào read credential. Vẫn để cờ tính năng `false` cho tới khi gate Phase 3 hoặc Phased Rollout được duyệt.

## Xoay cursor key Database Explorer

Giữ nguyên `FileSecretResolver` reference `ops-database-cursor-key`. Tạo canonical standard Base64 từ đúng 32 byte ngẫu nhiên bằng `openssl rand -base64 32`, thay nội dung credential file theo quy trình bảo mật với mode `0600`, sau đó restart SQL worker trong change được duyệt. Cursor và rowRef hiện tại sẽ mất hiệu lực; người dùng bắt đầu lại từ trang đầu. Không chấp nhận token plaintext-HMAC cũ hoặc giữ fallback trong thời gian chuyển đổi.

## Rotation và retirement

Mỗi login rotation tạo danh tính mới trong target tương ứng thay vì ghi đè credential đang chạy. Cập nhật secure credential của worker để login mới được verifier kiểm chứng trước. Sau grace period, truyền `--retire-login <old-login>` cho script.

Script đọc `pg_stat_activity`. Nếu còn session của login cũ, nó dừng với trạng thái an toàn và không vô hiệu hóa role. Chỉ khi session đã drain, script chạy `ALTER ROLE ... NOLOGIN` và revoke membership của role cũ. Không terminate session production để ép rotation.

Nếu verifier fail, giữ các cờ tính năng `false`, revoke credential/login mới theo change đã duyệt và mở incident; không bỏ qua bằng cách chạy SQL bằng owner account.
