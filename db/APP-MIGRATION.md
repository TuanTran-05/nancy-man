# Trạng thái chuyển ứng dụng sang PostgreSQL/VPS

Trạng thái source hiện tại:

- Express trên VPS là runtime API duy nhất.
- PostgreSQL là backend dữ liệu duy nhất.
- Xác thực dùng session cookie HttpOnly và bảng `auth_sessions`.
- Mật khẩu nhân sự dùng `staff_password_credentials`; học sinh/phụ huynh dùng
  `student_auth_credentials`.
- Google OAuth được liên kết bằng `auth_user_providers`.
- File được lưu tại `STORAGE_LOCAL_ROOT` và ký URL bằng
  `STORAGE_SIGNING_SECRET`.

## Hai lớp dữ liệu PostgreSQL

Schema chuẩn hóa trong migrations `0001`–`0015` giữ các ràng buộc nghiệp vụ và
các read channel SQL tối ưu. Migration `0017` thêm `app_documents`, một lớp
tương thích PostgreSQL cho các handler document cũ. Nó không kết nối tới dịch
vụ database bên ngoài.

Sau khi nạp `db/data.sql`, chạy:

```bash
npm run db:materialize-documents
```

Việc này dựng dữ liệu tương thích từ các bảng chuẩn hóa. Không chạy server nếu
`app_documents` chưa được materialize; nếu không, các handler cũ sẽ nhìn thấy
database rỗng.

## Xác thực

Migrations liên quan:

- `0016_vps_auth_sessions.sql`: credentials, session, rate limit và OTP.
- `0018_auth_user_providers.sql`: liên kết Google OAuth.

Biến bắt buộc gồm `SESSION_SECRET`, `OTP_PEPPER`,
`LOOKUP_CHALLENGE_SECRET`, Turnstile và `DATABASE_URL`. Google OAuth/SMS chỉ cần
khi bật tính năng tương ứng.

Client không giữ bearer token trong JavaScript. Mọi request cùng origin gửi
cookie bằng `credentials: same-origin`; mutation còn có `X-Requested-With` và
backend kiểm tra origin.

## Gate triển khai

```bash
npm run check:vps-source
npm run typecheck
npm run test:vps
npm run build:vps
npm run smoke:vps-build
```

Ngoài các gate source, cửa sổ triển khai phải kiểm tra row count, tài chính,
đăng nhập theo role, upload/download, OAuth callback, cron và restore backup.
