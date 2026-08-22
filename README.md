# EduTrack - Hệ thống Quản lý Trung tâm Tiếng Anh

EduTrack là hệ thống quản lý nội bộ cho trung tâm tiếng Anh, tập trung vào vận hành học vụ, lớp học, điểm danh, bài tập, tài chính, thanh toán học phí, thông báo phụ huynh và báo cáo quản trị.

Hệ thống được xây dựng theo hướng **Modular Monolith**: frontend React SPA, backend Express chạy trên VPS, PostgreSQL và object storage cục bộ, tích hợp PayOS, Zalo OA và Google Gemini.

> **Trạng thái PayOS (2026-08-20):** luồng thanh toán đang tạm hoãn trong giai đoạn ổn định hóa sau cutover VPS. Nút PayOS vẫn hiển thị để người dùng nhận biết tính năng, nhưng khi bấm chỉ báo **Đang phát triển** và không tạo yêu cầu thanh toán hay tải SDK PayOS.

## Tổng quan Hệ thống

| Layer | Công nghệ |
| --- | --- |
| **Frontend** | React 19, Vite 6, TypeScript, Tailwind CSS 4, React Router 7 |
| **UI/Charts** | Framer Motion, Recharts, Lucide React, react-hot-toast |
| **Backend** | Node.js 22, Express 5, domain handlers trong `api/` và `server/api/` |
| **Database** | PostgreSQL, Drizzle ORM, object storage cục bộ trên VPS |
| **Auth** | Session API cho staff, student và parent |
| **Payment** | Nghiệp vụ PayOS đã có trong mã nguồn nhưng giao diện checkout đang tạm hoãn |
| **Messaging** | Zalo OA/ZNS và hệ thống tin nhắn nội bộ |
| **AI** | Google Gemini hỗ trợ nhận xét học tập |
| **Face Attendance** | MediaPipe Tasks Vision, face-api.js, react-webcam |
| **Testing** | Vitest, Playwright, VPS build/smoke tests, k6 |

## Các Role trong Hệ thống

| Role | Chức năng chính |
| --- | --- |
| **Admin** | Quản trị hệ thống, lớp học, học sinh, tài chính, tin nhắn, audit log, reset mật khẩu staff |
| **Office** | Quản lý học vụ, tuyển sinh, điểm danh giáo viên, lớp học, học sinh, tổng quan vận hành |
| **Teacher** | Quản lý lớp, lịch dạy, điểm danh học sinh, giao/chấm bài, báo cáo, ngân hàng kiến thức |
| **Accounting** | Quản lý học phí, hóa đơn, biên lai, phiếu chi, thanh toán PayOS, đối soát |
| **Student** | Xem và nộp bài tập, làm quiz/exam, theo dõi thông tin học tập |
| **Parent** | Theo dõi kết quả học tập của con và thanh toán học phí |

## Tính năng Nổi bật

### Quản lý Học vụ

- Quản lý tuyển sinh, học thử, xét duyệt sau học thử và chuyển sang học chính thức.
- Quản lý hồ sơ học sinh, mã đăng nhập, phụ huynh, trạng thái học tập và vòng đời học sinh.
- Quản lý lớp học theo giáo viên, cấp học, phòng học, học phí, lương theo buổi, ngày bắt đầu/kết thúc và lịch nghỉ.
- Lịch học dự kiến theo thời khóa biểu của lớp, tự loại trừ ngày nghỉ của lớp và ngày nghỉ toàn hệ thống.
- Quản lý yêu cầu dạy thay và điều phối giáo viên.

### Điểm danh

- Điểm danh học sinh theo từng lớp và từng buổi học.
- Hỗ trợ trạng thái có mặt, vắng, đi muộn, có phép và số phút đi muộn.
- Kiểm soát dữ liệu theo ngày học, thời hạn lớp và quyền sở hữu lớp/học sinh.
- Hỗ trợ điểm danh bằng nhận diện khuôn mặt.
- Office/admin có thể xác nhận điểm danh giáo viên theo từng buổi dạy.
- Ghi audit cho các thao tác quan trọng liên quan đến điểm danh.

### Bài tập, Kiểm tra và Đánh giá

- Giáo viên tạo bài tập dạng tự luận hoặc quiz.
- Học sinh nộp bài trực tuyến, hệ thống lưu trạng thái nộp/chấm điểm.
- Quiz tách đáp án đúng khỏi dữ liệu trả về cho học sinh.
- Theo dõi chỉ số integrity cho bài kiểm tra như mất focus, đổi tab, thoát fullscreen.
- Đánh giá giữa kỳ/cuối kỳ bằng bộ điểm kỹ năng, nhận xét điểm mạnh và điểm cần cải thiện.
- Hỗ trợ nhận xét học tập bằng Google Gemini.

### Tài chính và Thanh toán

- Quản lý học phí theo khóa, ledger, invoice, receipt và trạng thái công nợ.
- Quản lý phiếu thu, phiếu chi, giảm trừ, miễn giảm và số chứng từ tự động.
- Luồng PayOS đã có checkout, webhook idempotent, reconciliation và review queue, nhưng hiện được tạm hoãn; giao diện phụ huynh chỉ báo **Đang phát triển** và không gọi PayOS.
- Kế toán có màn hình quản lý học sinh, học phí, biên lai, hóa đơn và báo cáo tài chính.
- Tích hợp Zalo để nhắc học phí và xác nhận thanh toán.

### Dashboard, Báo cáo và Vận hành

- Dashboard admin cho tổng quan vận hành trung tâm.
- Dashboard giáo viên cho lớp đang dạy, lịch, bài tập, học sinh rủi ro và báo cáo lớp.
- Dashboard phụ huynh theo dõi tình hình học tập và học phí của con.
- Báo cáo học tập, điểm danh, doanh thu và hoạt động lớp.
- API read-model có giới hạn dữ liệu theo từng màn hình để giảm tải PostgreSQL và tránh đưa dữ liệu nhạy cảm trực tiếp ra frontend.

### Ngân hàng Kiến thức

- Upload và quản lý tài liệu PDF/DOCX theo chương trình, khối, lớp hoặc unit.
- Lesson decks web-native cho chương trình Global Success.
- Trình chiếu bài giảng trực tiếp trong trình duyệt cho giáo viên/admin.
- Phân trang theo curriculum, grade và unit.

### Tin nhắn và Thông báo

- Tin nhắn nội bộ giữa giáo viên/phụ huynh và admin/giáo viên.
- Badge tin nhắn chưa đọc trong app shell.
- Zalo OA/ZNS cho thông báo vắng học, OTP, nhận xét cuối khóa, tài khoản staff, xác nhận thanh toán và nhắc học phí.
- Quy trình reset mật khẩu cho student, parent và staff.

### Bảo mật và Kiểm soát

- Phân quyền theo role ở cả frontend route và API; PostgreSQL không được mở trực tiếp cho trình duyệt.
- Rate limiting cho login, OTP, reset mật khẩu và các thao tác nhạy cảm.
- Mật khẩu student/parent dùng PBKDF2 có version, vẫn có lớp tương thích legacy.
- Audit log cho các thao tác thay đổi dữ liệu quan trọng.
- Cron jobs cho cleanup audit, tổng hợp tài chính và notification digest; lịch đối soát PayOS chỉ bật lại khi tính năng được phê duyệt vận hành.
- Tài liệu vận hành production, staging, rollback và xử lý sự cố nằm trong `docs/`.

## Workflow Chính

### 1. Tuyển sinh và nhập học

```text
Office tạo hồ sơ tuyển sinh
  -> xếp lớp học thử
  -> giáo viên/office theo dõi số buổi học thử
  -> đánh giá kết quả học thử
  -> accepted/rejected
  -> nếu accepted: chuyển thành học sinh chính thức và gắn vào lớp
```

### 2. Lớp học, lịch dạy và điểm danh

```text
Admin/Office tạo lớp
  -> khai báo giáo viên, thời gian khóa học, thứ học, giờ học, phòng, ngày nghỉ
  -> calendar tự dựng lịch học dự kiến theo tháng/tuần
  -> giáo viên điểm danh học sinh theo buổi
  -> office/admin xác nhận điểm danh giáo viên
  -> dữ liệu đi vào dashboard, báo cáo và payroll
```

### 3. Bài tập và đánh giá học sinh

```text
Giáo viên tạo assignment/quiz
  -> học sinh làm và nộp bài
  -> giáo viên chấm điểm/feedback
  -> hệ thống cập nhật dashboard, báo cáo lớp và hồ sơ học sinh
  -> giáo viên tạo evaluation giữa kỳ/cuối kỳ khi cần
```

### 4. Học phí và thanh toán

```text
Lớp có học phí khóa học
  -> hệ thống tạo ledger/invoice
  -> kế toán ghi nhận phiếu thu hoặc phụ huynh thanh toán PayOS
  -> webhook/reconcile xác nhận giao dịch
  -> tạo receipt, cập nhật công nợ
  -> gửi thông báo/biên nhận qua Zalo khi cấu hình đầy đủ
```

### 5. Thông báo và hỗ trợ phụ huynh

```text
Điểm danh, học phí hoặc nhận xét học tập phát sinh sự kiện
  -> hệ thống tạo dữ liệu thông báo/tin nhắn
  -> giáo viên/admin trao đổi trong app nếu cần
  -> Zalo OA gửi ZNS cho các luồng đã cấu hình template
```

## Kiến trúc Hệ thống

```text
React SPA
  pages, components, hooks, contexts
        |
        | HTTPS fetch
        v
Express application on VPS
  server/index.ts, server/http/routes.ts
  api/[domain]/[action].ts, server/api/[domain]
        |
        +--> PostgreSQL
        +--> Local object storage
        +--> PayOS
        +--> Zalo OA/ZNS
        +--> Google Gemini
```

### Nguyên tắc tổ chức

- Frontend route được bảo vệ bằng `ProtectedRoute` và role trong `src/app/AnimatedRoutes.tsx`.
- Backend chia theo domain trong `api/`, mỗi domain có router `[action].ts` và tách helper/handler khi logic lớn.
- Logic dùng chung giữa frontend và API đặt trong `shared/`.
- Read-heavy screens dùng `api/read/[channel].ts` để lấy projection đã giới hạn thay vì đọc thẳng nhiều collection từ client.
- Tích hợp ngoài như PayOS, Zalo và object storage được gom trong `server/api/` để kiểm soát bảo mật và retry.

## Cấu trúc Dự án

```text
api/                           Public API compatibility entrypoints
  admissions/                  Tuyển sinh và học thử
  attendance/                  Điểm danh học sinh và giáo viên
  audit/                       Audit log, health, cleanup, aggregate jobs
  auth/                        Staff/student/parent auth, OTP, reset password
  classes/                     Lớp học, import học sinh, dạy thay, tạo ledger
  edu/                         Assignment, submission, evaluation
  finance/                     Receipt, invoice, expense, report
  knowledge-bank/              Upload và đọc tài liệu học liệu
  payments/payos/              PayOS checkout, webhook, status, reconcile
  read/                        Read-model API theo màn hình
  students/                    CRUD/import/lifecycle học sinh
  zalo/                        Zalo OA, tin nhắn, nhắc học phí
  lib/                         Auth, HTTP, jobs, logging, services

server/                        Express runtime cho VPS
  http/                        App, route table và HTTP adapters
  db/                          PostgreSQL connection và backend mode
  runtime/                     Background tasks và shutdown lifecycle

src/                           Frontend - React SPA
  app/                         App shell, routes, sidebar, header
  components/                  UI dùng chung, lesson player
  contexts/                    AuthContext
  data/                        Lesson decks và dữ liệu tĩnh
  hooks/                       Hooks nghiệp vụ
  lib/                         API clients, i18n, utilities
  pages/                       Trang theo role/domain
  security/                    Test bảo mật frontend

shared/                        Domain helpers dùng chung frontend/backend
scripts/                       Migration, audit, maintenance scripts
e2e/                           Playwright tests
loadtests/                     k6 smoke/load/stress/spike/soak/scalability
docs/                          Runbook, staging, rollback, launch checklist
```

## Cài đặt và Chạy Local

### Yêu cầu

- Node.js 22.22 trở lên
- npm
- PostgreSQL 16 trở lên
- PayOS, Zalo OA và Gemini credentials nếu dùng các tích hợp tương ứng

### Bước 1: Cài dependencies

```bash
npm install
```

### Bước 2: Cấu hình environment

Tạo `.env` từ template:

```bash
cp .env.example .env
```

Điền các nhóm biến chính:

- PostgreSQL connection, pool và object-storage settings
- Gemini API key
- PayOS client ID, API key, checksum key, return/cancel URL
- Zalo OA credentials và ZNS template IDs
- `CRON_SECRET`, `OTP_PEPPER`, `LOOKUP_CHALLENGE_SECRET`

### Bước 3: Chạy development server

```bash
# Frontend only
npm run dev

# Full-stack local qua Express/VPS runtime
npm run dev:vps
```

### Bước 4: Build production

```bash
npm run build:vps
```

## Scripts

| Script | Mô tả |
| --- | --- |
| `npm run dev` | Chạy Vite dev server |
| `npm run dev:vps` | Build rồi chạy full-stack bằng Express runtime |
| `npm run build` | Build frontend production |
| `npm run build:vps` | Build frontend và server cho VPS |
| `npm run test:vps` | Kiểm tra source safety và VPS runtime |
| `npm run preview` | Preview bản build |
| `npm run lint` | Kiểm tra ESLint |
| `npm run lint:fix` | Tự sửa lỗi ESLint có thể fix |
| `npm run format` | Format frontend source theo Prettier |
| `npm run format:check` | Kiểm tra format frontend source |
| `npm run typecheck` | Kiểm tra TypeScript |
| `npm run test` | Chạy Vitest |
| `npm run test:watch` | Chạy Vitest watch mode |
| `npm run test:coverage` | Chạy Vitest kèm coverage |
| `npm run test:e2e` | Chạy Playwright E2E |
| `npm run migrate` | Chạy migrations |
| `npm run migrate:dry-run` | Dry-run migrations |
| `npm run audit:student-lifecycle` | Audit vòng đời học sinh |
| `npm run repair:student-lifecycle` | Sửa dữ liệu vòng đời học sinh |
| `npm run loadtest:smoke` | Chạy k6 smoke test |
| `npm run loadtest:load` | Chạy k6 load test |
| `npm run loadtest:stress` | Chạy k6 stress test |

## Kiểm tra Trước khi Deploy

```bash
npm run typecheck
npm run test
npm run test:vps
npm run build:vps
npm run smoke:vps-build
npm run build
```

Với thay đổi liên quan trình duyệt hoặc luồng người dùng:

```bash
npm run test:e2e
```

Với thay đổi tài chính/thanh toán, cần chạy thêm test liên quan PayOS/finance và đối chiếu runbook trong `docs/`.

## Deployment

Dự án deploy trên một VPS Linux:

- `npm run build:vps` tạo frontend trong `dist/` và server bundle trong `dist-server/`.
- PM2 quản lý Express process; Nginx kết thúc TLS và reverse proxy vào loopback port.
- PostgreSQL và thư mục upload chỉ lắng nghe/ghi trên VPS, không mở trực tiếp ra Internet.
- Cron chạy qua `deploy/vps/run-cron.sh` và được khai báo trong `deploy/vps/crontab`.

Tài liệu vận hành:

- `docs/production-runbook.md`
- `deploy/vps/README.md`
- `db/DEPLOY.md`
- `docs/rollback-procedure.md`
- `docs/payment-incident-sop.md`

## License

Private - Internal use only.
