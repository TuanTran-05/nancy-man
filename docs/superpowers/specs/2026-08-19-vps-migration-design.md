# Thiết kế: Chuyển backend từ Vercel sang VPS tự quản

- **Ngày:** 2026-08-19
- **Trạng thái:** Đã chốt thiết kế, chờ lập kế hoạch triển khai
- **Bối cảnh liên quan:** [2026-08-18-postgres-schema-design.md](2026-08-18-postgres-schema-design.md)

## 1. Mục tiêu và phạm vi

Đưa toàn bộ ứng dụng (frontend + API) đang chạy trên Vercel sang một VPS Ubuntu tự quản,
chạy dưới dạng **một process Node.js duy nhất** thay cho mô hình serverless function.

### Trong phạm vi

- Xây tầng HTTP server (Express) thay thế cơ chế routing/rewrite của Vercel
- Chuyển 3 cron job của Vercel sang crontab hệ thống
- Cấu hình hạ tầng VPS: Nginx reverse proxy, SSL, PM2, biến môi trường
- Quy trình kiểm thử và cutover đổi domain

### Ngoài phạm vi

- **Chuyển Firestore sang PostgreSQL.** Đây là dự án riêng, lớn hơn nhiều (~145 file backend
  gọi thẳng Firestore). Sau đợt này app **vẫn kết nối Firestore như cũ**. PostgreSQL đã cài
  trên VPS nhưng chưa được dùng.
- **Sửa URL API phía frontend.** 236 lời gọi trong 87 file giữ nguyên. Người dùng cho phép
  sửa, nhưng việc này không phục vụ mục tiêu rời Vercel — chỉ thêm bề mặt sai sót. Nếu muốn
  dọn URL cho gọn, làm thành một đợt riêng sau khi VPS đã chạy ổn định.

### Ràng buộc đã chốt với người dùng

1. **Không cần giữ bản Vercel hiện tại chạy được.** Được tự do đổi cấu trúc phía server,
   không phải mirror `vercel.json` 1:1.
2. **Cutover hẳn sang VPS**, không chạy song song lâu dài.
3. Cron dùng **crontab hệ thống + curl**, không nhúng `node-cron` vào process app.

## 2. Kiến trúc

```
Internet → Nginx (:443, SSL)  →  Express (:3000)  ─┬→ /api/*  → handler hiện có
                                                    └→ /*      → dist/ + SPA fallback
                                                          │
                                    crontab + curl ────────┘ (3 job)
```

Một process Node.js do PM2 quản lý. Nginx làm SSL termination và reverse proxy.

### 2.1 Tái dùng handler, không viết lại nghiệp vụ

Khảo sát cho thấy các handler chỉ dùng những thuộc tính mà Express cung cấp sẵn:
`req.query`, `req.headers`, `req.method`, `res.status()`, `res.json()`, `res.setHeader()`.

Do đó 13 handler `api/<nhóm>/[action].ts` gắn thẳng vào Express được, gần như không sửa
phần thân. Toàn bộ logic nghiệp vụ (tài chính, điểm danh, PayOS, Zalo) **giữ nguyên**.

Các nhóm route: `admissions`, `attendance`, `audit`, `auth`, `classes`, `edu`, `finance`,
`knowledge-bank`, `payments/payos`, `read`, `students`, `zalo`, `zalo-bot`.

### 2.2 Tầng routing

Thay vì dịch máy móc ~20 rule rewrite trong `vercel.json`, khai báo **một route table duy
nhất** tại `server/http/routes.ts`. Mỗi dòng map URL mà frontend đang gọi sang handler kèm
các tham số query cần inject:

```ts
route('/api/v1/finance/:resource(receipts|expenses)/:id/:action(post|void|next-number)', financeHandler)
route('/api/v1/zalo-bot/:action*', zaloHandler, { actionPrefix: 'bot-' })
route('/api/v1/teacher-attendance/:action*', attendanceHandler, { query: { resource: 'teacher-attendance' } })
```

**URL phía client giữ nguyên** — đây là hợp đồng phải bảo toàn. Cách khai báo phía server
được viết lại cho dễ đọc và test được.

Nguồn sự thật để đối chiếu khi triển khai: mảng `rewrites` trong `vercel.json` (mỗi rule
phải có route tương ứng) **và** kết quả grep `/api/v1/` trong `src/` (mỗi URL frontend gọi
phải khớp một route).

### 2.3 Body parsing

Đây là điểm dễ hỏng nhất. `express.json()` **không được** áp cho các route nhận file upload,
vì `formidable` cần đọc raw stream — nếu áp nhầm, request upload sẽ treo tới khi timeout.

Hiện trạng đã khảo sát:

- `api/knowledge-bank/[action].ts` — **đã xác nhận**, có khai báo `config.api.bodyParser = false`
- `formidable` còn được dùng trong `server/api/students/handlers/import.ts` và ba handler
  `server/api/edu/handlers/*` — nhưng các route này **không** khai báo `bodyParser: false`

**Việc bắt buộc khi triển khai:** xác minh chính xác từng route nào cần raw body (đọc code
handler, kiểm tra cách chúng phân nhánh theo `content-type`), rồi khai báo tường minh danh
sách route bỏ qua `express.json()`. Không suy đoán từ việc chỉ nhìn khai báo `config`.

### 2.4 Chạy TypeScript

`tsconfig.json` để `noEmit: true` — hiện không có bước build nào cho code server, Vercel tự
compile. Trên VPS: build bằng **esbuild** thành một bundle JS, PM2 chạy bundle đó. Khởi động
nhanh và không phụ thuộc `tsx` lúc runtime.

Import trong code server dùng đuôi `.js` (chuẩn ESM `NodeNext`) — cấu hình esbuild phải xử
lý đúng, đặt `platform: node`, `format: esm`.

### 2.5 Phục vụ frontend

Express serve thư mục `dist/` do Vite build, kèm fallback mọi đường dẫn không khớp `/api/*`
về `index.html` — thay cho rule catch-all cuối trong `vercel.json`.

## 3. Cron

Ba job, chuyển sang crontab hệ thống gọi bằng `curl` kèm header
`Authorization: Bearer $CRON_SECRET` (các handler đã tự kiểm tra header này sẵn — không phụ
thuộc gì vào riêng Vercel, nên **không cần sửa code**).

| Job | Lịch cũ (UTC, `vercel.json`) | Giờ VN tương ứng |
|---|---|---|
| `/api/audit/daily-maintenance` | `0 18 * * *` | 01:00 |
| `/api/audit/zalo-bot-daily-digest` | `30 14 * * *` | 21:30 |
| `/api/audit/outbox-process` | `35 14 * * *` | 21:35 |

**Bẫy múi giờ:** Vercel Cron chạy theo UTC; crontab chạy theo giờ hệ thống VPS. Phải xác định
timezone của VPS (`timedatectl`) rồi chọn một trong hai: giữ VPS ở UTC và copy nguyên lịch,
hoặc đặt VPS theo `Asia/Ho_Chi_Minh` và dùng cột "Giờ VN". Chọn sai làm mọi job lệch 7 tiếng.

### 3.1 daily-maintenance gọi HTTP ngược lại chính nó

`runDailyMaintenanceFanOut` không tự chạy hết việc: nó phát HTTP request về chính deployment
để chạy 5 job con (`cleanup`, `finance-aggregate`, `dashboard-aggregate`,
`notification-digest`, …). Địa chỉ được lấy theo thứ tự:

```
process.env.VERCEL_PROJECT_PRODUCTION_URL  →  header x-forwarded-host  →  header host
```

Hai việc bắt buộc:

1. **Nginx phải set `X-Forwarded-Host` và `X-Forwarded-Proto`.** Thiếu thì job chết lặng lẽ.
2. Thay `VERCEL_PROJECT_PRODUCTION_URL` bằng biến trung tính **`PUBLIC_BASE_URL`** trong
   `api/audit/[action].ts`, giữ fallback về các header. Đây là chỗ áp dụng quyền tự do đổi
   code để loại tên biến Vercel khỏi codebase.

> Ghi chú vận hành: theo ghi nhận trước đây, cron `daily-maintenance` đã không nổ kể từ
> 2026-07-18 và 2/3 cron trong `vercel.json` không chạy. Sau khi lên VPS cần xác nhận cả ba
> job thực sự chạy (kiểm tra job-tracking đã thêm trước đó), chứ không mặc định là chúng vốn
> vẫn hoạt động.

## 4. Biến môi trường

59 biến, chia nhóm: Firebase (6), Zalo/ZNS (24), PayOS (5), Turnstile (3), secret & feature
flag (còn lại). Lưu tại `.env` trên VPS với quyền `600`, **không commit vào git**.

### Bắt buộc

- **`NODE_ENV=production`.** Code dùng sự tồn tại của biến `VERCEL` để nhận biết production
  (`server/api/lib/http/cors.ts`, `server/api/lib/validation/validateEnv.ts`,
  `server/api/auth/handlers/shared.ts`). Trên VPS biến `VERCEL` không tồn tại — nếu quên đặt
  `NODE_ENV=production`, **CORS sẽ cho phép origin `localhost`** và vài kiểm tra bảo mật khác
  bị nới lỏng.
- **`APP_URL`** — danh sách origin được phép (phân tách bằng dấu phẩy), phải trỏ domain thật.
- **`PUBLIC_BASE_URL`** — biến mới, thay `VERCEL_PROJECT_PRODUCTION_URL` (mục 3.1).

### Phải đổi giá trị khi sang domain mới

`PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL`, `TURNSTILE_EXPECTED_HOSTNAME`.

### Biến Vercel còn sót trong code

`VERCEL`, `VERCEL_ENV`, `VERCEL_REGION`, `VERCEL_GIT_COMMIT_SHA`,
`VERCEL_PROJECT_PRODUCTION_URL`. Xử lý: thay bằng biến trung tính hoặc để rơi vào nhánh
fallback sẵn có. `VERCEL_REGION` chỉ dùng cho header chẩn đoán, để mặc định `local` cũng được.

## 5. Hạ tầng VPS

| Thành phần | Ghi chú |
|---|---|
| Nginx | SSL termination, reverse proxy `:3000`, set `X-Forwarded-*` |
| Certbot | SSL Let's Encrypt, tự gia hạn |
| PM2 | Giữ app chạy nền, tự restart, `pm2 startup` để sống qua reboot |
| crontab | 3 job (mục 3) |
| PostgreSQL | Đã cài, **chưa dùng** ở đợt này |

Nginx cần nâng `client_max_body_size` để không chặn upload file (giá trị cụ thể xác định khi
triển khai, dựa theo giới hạn `formidable` trong code).

## 6. Kiểm thử

1. **Bộ test hiện có** phải xanh. Lưu ý: trước khi bắt đầu cần lấy baseline — đã ghi nhận 21
   test fail sẵn trên `main` (5 file quanh student identity) và 24 lỗi `tsc` ẩn. `npm run
   typecheck` là cổng kiểm tra hợp đồng thật sự, không phải bộ test.
2. **Test riêng cho tầng routing** — mỗi rule trong `vercel.json` và mỗi URL frontend gọi phải
   có test khẳng định nó tới đúng handler với đúng query. Đây là phần code mới, nên viết theo
   TDD.
3. **Kiểm tra tay các luồng tiền** trên subdomain tạm: tạo phiếu thu, nạp/trừ ví, PayOS
   sandbox, upload file, đăng nhập (Turnstile).

## 7. Cutover

Dù mục tiêu là chuyển nhanh, thứ tự dưới đây tránh việc ghi nhận sai học phí trên production.

1. Deploy VPS lên **subdomain tạm** (vd `new.tenmien.com`), xin SSL cho subdomain đó
2. Chạy toàn bộ mục 6 trên subdomain
3. Cập nhật **URL webhook trong dashboard PayOS** sang domain mới — thao tác thủ công ngoài
   code; quên bước này thì thanh toán của khách không được ghi nhận
4. Trỏ DNS domain chính về VPS, xin SSL cho domain chính
5. **Tắt cron bên Vercel** — hai nơi cùng chạy job ghi dữ liệu sẽ gây trùng lặp
6. Theo dõi log 24h, xác nhận cả 3 cron nổ đúng giờ

### Rollback

Giữ project Vercel nguyên vẹn (chỉ tắt cron) cho tới khi VPS chạy ổn định vài ngày. Nếu hỏng,
trỏ DNS ngược lại và bật cron Vercel là quay về trạng thái cũ.

## 8. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Route map sai → API trả 404 hoặc sai handler | Test đối chiếu 1-1 với `vercel.json` và grep frontend (mục 6.2) |
| Áp nhầm `express.json()` lên route upload → treo request | Xác minh tường minh danh sách route upload (mục 2.3) |
| Quên `NODE_ENV=production` → CORS mở cho localhost | Đưa vào checklist; thêm kiểm tra lúc khởi động |
| Cron lệch 7 tiếng do múi giờ | Xác định timezone VPS trước, dùng bảng đối chiếu (mục 3) |
| Quên đổi webhook PayOS → mất ghi nhận thanh toán | Bước bắt buộc trong checklist cutover (mục 7.3) |
| Nginx thiếu `X-Forwarded-Host` → daily-maintenance chết lặng | Cấu hình Nginx + xác nhận job chạy sau cutover |
| VPS RAM thấp → chết khi build hoặc export file nặng | Tạo swap; cân nhắc build ở máy khác rồi copy `dist/` lên |
