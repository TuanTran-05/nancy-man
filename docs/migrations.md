# Migration dữ liệu — tài liệu lịch sử

Framework migration Firestore trong phiên bản cũ đã bị loại khỏi runtime. Các
lệnh và biến Firebase Admin trước đây không còn là quy trình production hợp lệ.

Nguồn hướng dẫn hiện hành:

- PostgreSQL schema/data: [`../db/DEPLOY.md`](../db/DEPLOY.md)
- Cutover, global write freeze, parity và rollback:
  [`runbooks/vps-postgres-cutover.md`](runbooks/vps-postgres-cutover.md)
- Canonical student profile lịch sử/chuyên biệt:
  [`runbooks/canonical-student-profile-cutover.md`](runbooks/canonical-student-profile-cutover.md)

Không khôi phục `scripts/migrations` hoặc Firebase migration runner để phục vụ
rollback. Thay đổi schema mới phải là một migration PostgreSQL mới sau `0018`;
không sửa migration đã chạy.
