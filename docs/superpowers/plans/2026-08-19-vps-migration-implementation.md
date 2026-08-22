# Kế hoạch migration VPS — đã được thay thế

Kế hoạch ban đầu giả định chỉ chuyển hosting và tiếp tục dùng Firebase. Giả định
đó không còn đúng: runtime hiện tại là Node/Express + PostgreSQL-only, gồm 18
migration và lớp tương thích `app_documents`.

Tài liệu này được giữ để giải thích lịch sử quyết định, nhưng không dùng làm
checklist triển khai. Runbook duy nhất có thẩm quyền là
[`../../runbooks/vps-postgres-cutover.md`](../../runbooks/vps-postgres-cutover.md).

## Trạng thái source ngày 2026-08-19

- Express/Vite/PM2, PostgreSQL DocumentStore, native session và local storage đã
  được triển khai trong source.
- Nginx có bootstrap ACME, TLS, HTTP redirect và secure proxy headers.
- Environment production bắt buộc pin full commit SHA, backup mã hóa và offsite.
- Có global HTTP write-freeze, backup age+rclone và restore drill cách ly.
- Test, typecheck, VPS build và smoke phải xanh lại trên đúng release trước deploy.

## Việc chỉ có thể hoàn tất trên hạ tầng

- Chọn hostname và credential staging; deploy đúng SHA đã push lên remote.
- Dựng PostgreSQL staging trống, chạy đủ 19 migration và role smoke.
- Freeze mọi write trên nguồn Firebase cũ, sinh snapshot production mới, replay,
  materialize và chạy toàn bộ parity/financial invariants.
- Chứng minh certificate renewal, ba cron, backup offsite và restore drill.
- PayOS tạm hoãn theo quyết định ngày 2026-08-20; giao diện phải báo tính năng đang
  phát triển và không tạo payment request. Chốt Zalo webhook, DNS TTL, cutover
  commander và rollback owner cho các phần còn lại.

Không được dùng snapshot `db/data.sql` ngày 2026-08-19 và không rollback về
Vercel/Firestore.
