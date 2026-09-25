# Rotation role PostgreSQL cho SQL Console và Database Explorer

Tài liệu này áp dụng cho credential của SQL Worker dành cho SQL Console (`ops_readonly`) và Database Explorer (`ops_database_browser`). Production mặc định giữ `OPS_SQL_READ_ENABLED=false` và `OPS_EXPLORER_*_ENABLED=false`; chỉ bật sau khi toàn bộ kiểm tra bên dưới đạt và có phê duyệt vận hành. Chi tiết quy trình rollout từng bước cho Database Explorer xem tại [database-explorer-rollout.md](./database-explorer-rollout.md).

## Điều kiện trước khi thay đổi

- Có bản ghi DR drill chứng minh RPO không quá một phút và RTO không quá 15 phút.
- Đã xem role/grant diff với DBA; đặc biệt, script sẽ bỏ quyền `TEMPORARY` khỏi `PUBLIC`, bỏ `CREATE` trên schema, toàn bộ quyền bảng/sequence và quyền thực thi function khỏi `PUBLIC` trong các business schema khai báo. Mọi ứng dụng còn cần các quyền đó phải được cấp trực tiếp trước khi chạy script.
- `ops_readonly` và `ops_database_browser` chỉ được cấp các business schema đã liệt kê rõ ràng; tuyệt đối không thêm `_ops`, `pg_catalog` hoặc `information_schema` vào danh sách.
- Không bật SQL Console hay Database Explorer, không deploy credential và không áp dụng role chỉ để “thử nhanh” trên production.

## Credential

Tạo mật khẩu URL-safe, tối thiểu 32 ký tự cho login mới. Mỗi file credential, `pgpass` của DBA và PostgreSQL URL của login phải thuộc service account, mode `0600`, không phải symlink.

Tuyệt đối không được ghi mật khẩu, PostgreSQL URL hoặc output chứa secret vào shell history, ticket, log deployment hay audit evidence. Audit chỉ lưu tên role, thời điểm, hash của grant diff và kết quả `pass`/`fail` của verifier.

- SQL Console: Read login là member inherited nhưng không thể `SET ROLE` vào `ops_readonly`; cancel login chỉ kế thừa `ops_cancel`/`pg_signal_backend`, không có quyền bảng.
- Database Explorer: Browser login kế thừa `ops_database_browser` với quyền SELECT mức cột (column-level) trên các cột đã được duyệt, không có quyền SELECT trên các cột `blocked`.

Browser và Ops API không bao giờ đọc trực tiếp các credential này.

## Áp dụng và kiểm chứng

1. Chọn fixture không nhạy cảm trong business schema, bao gồm một cột có thể xuất hiện trong `UPDATE ... WHERE false`. Verifier chỉ thử mutation trong transaction rồi rollback. Đối với explorer role, cung cấp thêm `--blocked-column` để xác nhận cột nhạy cảm bị từ chối truy cập.
2. Đặt file credential của read/browser login vào secret store/system credential; PostgreSQL URL phải kết nối bằng login mới và TLS được kiểm tra ở cấu hình worker.
3. DBA chạy `deploy/postgres/apply-role-grants.sh`:
   - Cho SQL Console: Chạy chế độ mặc định với `--read-login`, `--cancel-login`.
   - Cho Database Explorer: Truyền `--role-type explorer`, `--browser-login`, `--safe-column`, `--blocked-column`, và `--grants-file`.
4. Script tự chạy `verify-readonly-role.ts` hoặc `verify-database-explorer-role.ts`. Báo cáo phải có `status: "pass"`. Các thao tác bị cấm (INSERT, UPDATE, DELETE, TRUNCATE, CREATE TABLE/TEMP TABLE/FUNCTION, ALTER, DROP, COPY TO PROGRAM) và SELECT cột blocked phải bị từ chối.
5. Lưu bằng chứng không-secret: thời điểm, database identity, role, version script, hash của grant diff và trạng thái kiểm chứng. Không lưu SQL URL hay password.
6. Chỉ sau đó mới tạo configuration worker trỏ vào read credential. Vẫn để cờ tính năng `false` cho tới khi gate Phase 3 hoặc Phased Rollout được duyệt.

## Rotation và retirement

Mỗi rotation tạo login mới thay vì ghi đè login đang chạy. Cập nhật secure credential của worker để login mới được verifier kiểm chứng trước. Sau grace period, truyền `--retire-login <old-login>` cho script.

Script đọc `pg_stat_activity`. Nếu còn session của login cũ, nó dừng với trạng thái an toàn và không vô hiệu hóa role. Chỉ khi session đã drain, script chạy `ALTER ROLE ... NOLOGIN` và revoke membership của role cũ. Không terminate session production để ép rotation.

Nếu verifier fail, giữ các cờ tính năng `false`, revoke credential/login mới theo change đã duyệt và mở incident; không bỏ qua bằng cách chạy SQL bằng owner account.
