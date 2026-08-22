# Quy trình rollback production

Tài liệu Vercel/Firebase trước đây đã được thay thế kể từ đợt cutover
PostgreSQL-only ngày 2026-08-19.

Quy trình có thẩm quyền nằm tại
[`runbooks/vps-postgres-cutover.md`](runbooks/vps-postgres-cutover.md#7-rollback).

Nguyên tắc bắt buộc:

- Bật global write freeze trước khi rollback.
- Rollback release VPS phải đi cùng snapshot PostgreSQL tương ứng.
- Restore vào database riêng, verify xong mới chuyển `DATABASE_URL`.
- Không promote Vercel cũ và không đưa Firestore trở lại làm nguồn ghi.
- Nếu PostgreSQL đã nhận write mới, rollback owner phải chốt cách reconcile hoặc
  forward-fix; không được âm thầm restore đè dữ liệu.
