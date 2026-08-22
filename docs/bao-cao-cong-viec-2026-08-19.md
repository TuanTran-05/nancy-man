# Báo cáo công việc ngày 19/08/2026

## 1. Tổng quan

Hôm nay repository EduTrack được tổng hợp thành một đợt chuyển đổi nền tảng lớn: loại bỏ Firebase/Vercel khỏi runtime chính, chuyển dữ liệu và dịch vụ backend sang PostgreSQL, đóng gói ứng dụng thành Node/Express chạy trên VPS, đồng thời cập nhật frontend, test, script vận hành và tài liệu triển khai để dùng kiến trúc mới.

- Nhánh làm việc: `docs/postgres-migration-schema`.
- Commit nền trước thay đổi: `688cd8a` (`chore: sync current project state`).
- Phạm vi trước khi thêm báo cáo này: 832 đường dẫn thay đổi, gồm 735 file đã được Git theo dõi và 97 file mới.
- Trạng thái ban đầu: 641 file sửa, 65 file xóa, 29 file đổi tên và 97 file chưa được theo dõi.
- Thống kê cuối của commit: 830 file thay đổi, 43.237 dòng thêm và 38.921 dòng xóa.

## 2. Những thay đổi đã thực hiện

### 2.1. Chuyển cơ sở dữ liệu sang PostgreSQL

- Xây dựng bộ 18 migration liên tục từ `0001_extensions.sql` đến `0018_auth_user_providers.sql` cho identity, học vụ, bài tập, tài chính, kết khóa học, lịch rảnh, thông báo/Zalo, vận hành, view, trigger, session xác thực, DocumentStore và liên kết nhà cung cấp đăng nhập.
- Bổ sung quy trình preflight, chuẩn hóa dữ liệu, quyết định xử lý dữ liệu bất thường, sinh dump, phát lại dump và đối chiếu schema/dữ liệu.
- Thêm Drizzle ORM, schema/relations được introspect từ PostgreSQL và công cụ chuẩn hóa output của Drizzle Kit.
- Thêm script kiểm tra kết nối, materialize dữ liệu tương thích vào `app_documents`, so sánh kết quả đọc audit log và operational reads giữa nguồn cũ với PostgreSQL.
- Bảo vệ dữ liệu thật: `db/data.sql` không được đưa vào Git vì chứa dữ liệu cá nhân; quy trình yêu cầu sinh lại snapshot sát thời điểm cutover và kiểm tra bất biến tài chính trước khi nạp.

### 2.2. Dựng runtime Node/Express trên VPS

- Thêm entrypoint server, Express app, đăng ký route tập trung, health/liveness/readiness, SPA fallback và background tasks.
- Chuyển các API admissions, attendance, audit, auth, classes, education, finance, knowledge bank, PayOS, read, students và Zalo khỏi kiểu Vercel serverless sang route của server Node.
- Bổ sung build server bằng esbuild, lệnh build VPS, start VPS và smoke test artifact.
- Thêm cấu hình PM2, Nginx, cron, logrotate, backup PostgreSQL, provision/reload database, kiểm tra host và kiểm tra biến môi trường.
- Chuẩn hóa đường chạy production thành `Internet -> Nginx -> Node/Express -> PostgreSQL/local object storage`.

### 2.3. Thay Firebase/Firestore bằng lớp tương thích DocumentStore

- Thêm PostgreSQL-backed DocumentStore để giữ giao diện collection/document/query/transaction cho các handler nghiệp vụ hiện hữu trong giai đoạn chuyển đổi.
- Đổi tên các module, mock và test helper từ `firestore`/`inMemoryFirestore` sang `documentStore`/`inMemoryDocumentStore`.
- Chuyển batch write, counter sequence, record lifecycle, course-closing materialization, enrollment backfill và profile normalization sang abstraction mới.
- Loại bỏ Firebase config, Firestore/Realtime Database/Storage rules, indexes, emulator tests và các script chỉ phục vụ Firebase cũ.

### 2.4. Xác thực và phiên đăng nhập tự quản

- Thêm auth adapter dùng bảng PostgreSQL, session store, cookie/session API và luồng xác thực frontend mới.
- Bổ sung đăng nhập mật khẩu, Google OAuth tùy chọn, SMS OTP và quản lý liên kết nhà cung cấp auth.
- Thay các biến môi trường Firebase bằng `DATABASE_URL`, cấu hình pool PostgreSQL, session secret, local storage, Google OAuth và SMS provider.
- Cập nhật AuthContext, login handlers, đổi mật khẩu, OTP số điện thoại, quản lý tài khoản nhân viên/học sinh/phụ huynh và test liên quan.

### 2.5. Realtime, read API và frontend data flow

- Gỡ Realtime Database delta service, RTDB admin client và hook `useRtdbStream`.
- Thêm polling stream có giới hạn interval, refresh khi tab hoạt động lại hoặc mạng online, cùng cơ chế invalidation dựa trên event key.
- Bổ sung các read handler SQL cho audit log, operational reads và một số frontend collections; giữ đường tương thích DocumentStore trong giai đoạn chuyển đổi.
- Cập nhật hàng loạt hook, API client, trang quản trị, học vụ, học sinh, tài chính, bài tập, knowledge bank, in ấn, lịch, báo cáo và Zalo để dùng auth/data flow mới.

### 2.6. Lưu trữ file trên VPS

- Thêm object store cục bộ, cấu hình thư mục lưu trữ, chữ ký URL và route đọc object.
- Chuyển upload/download ảnh hồ sơ, ảnh khuôn mặt, media bài tập và knowledge bank khỏi Firebase Storage.
- Thêm test cho object store, route storage và các API upload phía frontend.

### 2.7. Nghiệp vụ và script vận hành

- Cập nhật các luồng tuyển sinh, điểm danh, lớp học, kết khóa học, học sinh, canonical identity, tài chính, ví, biên lai, Zalo bot và notification outbox để chạy trên abstraction mới.
- Chuyển các script audit/backfill/repair/rebuild sang DocumentStore hoặc PostgreSQL-compatible path.
- Xóa các script migration một lần đã hoàn tất hoặc phụ thuộc trực tiếp Firebase/Vercel.
- Cập nhật k6 load tests sang cơ chế token/auth mới và giữ production guard.

### 2.8. Dependency, cấu hình và CI

- Thêm runtime dependency: `express`, `pg`, `drizzle-orm`.
- Thêm dev dependency: `@types/pg`, `drizzle-kit`, `esbuild`.
- Gỡ `firebase`, `firebase-admin`, `@vercel/functions`, Firebase rules tooling, Vercel CLI và type package của Vercel.
- Thêm các npm script `dev:vps`, `build:server`, `build:vps`, `start:vps`, `smoke:vps-build`, `db:check`, `db:pull`, `db:materialize-documents`, các parity check, source-safety check và `test:vps`.
- Cập nhật CI, Playwright, ESLint, Vite, `.env.example`, `.gitignore` và `.gitattributes` cho runtime VPS/PostgreSQL và line ending an toàn trên Linux.

### 2.9. Tài liệu

- Viết hướng dẫn app migration, deploy database, Drizzle model và triển khai VPS.
- Cập nhật README, production runbook, security hardening checklist, Zalo bot runbook và tài liệu rollout tài chính.
- Loại bỏ checklist/tài liệu chỉ còn phù hợp với Vercel, Firebase staging và Firebase production.

## 3. Phạm vi ảnh hưởng kiến trúc

Phân tích knowledge graph ghi nhận:

- 132 node thay đổi trực tiếp: 86 file, 12 service, 11 config, 11 pipeline, 6 document, 4 function và 2 endpoint.
- 483 cạnh liên kết trực tiếp, chủ yếu là import và quan hệ test.
- 148 node bị ảnh hưởng một bước, tập trung ở frontend, API, load test, shared code và script.
- Độ phức tạp của node thay đổi: 40 complex, 50 moderate và 42 simple.
- Các lớp bị chạm: frontend pages/components/hooks/libraries/shell, backend endpoints/services, shared code, testing, scripts/migrations, config/infrastructure và documentation.

Vì blast radius xuyên toàn bộ stack, đây là thay đổi rủi ro cao và cần coi như một migration/cutover có gate, không phải một refactor cục bộ.

## 4. Kết quả kiểm tra

| Kiểm tra | Kết quả | Chi tiết |
|---|---|---|
| `npm run typecheck` | Đạt | TypeScript không có lỗi |
| `npm run test:vps` | Đạt | 7 file test, 73 test đạt; source safety xác nhận 18 migration liên tục |
| `npm run build:vps` | Đạt | Student identity architecture sạch; Vite build 4.664 module; server bundle được tạo |
| `npm run smoke:vps-build` | Đạt | Liveness, readiness, API 404 JSON và SPA fallback đều đạt |
| `npm test` | Đạt | 634 file đạt; 5.293 test đạt, 4 bỏ qua |

### Trạng thái các lỗi full unit suite trước đó

- Toàn bộ 19 file/67 test lỗi đo lại từ baseline đã đạt trong lần chạy lại ngày 19/08/2026.
- Các mock DocumentStore, canonical student reads, ledger paging, admissions, enrollment, wallet, Zalo client và runbook parity hiện không còn làm đỏ full suite.

## 5. Rủi ro và việc cần làm tiếp

- Full unit suite đã xanh; gate production còn phụ thuộc smoke test trên VPS/staging với PostgreSQL và tài khoản thật.
- Cần diễn tập migration trên PostgreSQL trống, chạy `verify-schema.sql`, `verify-data.sql`, materialize `app_documents` và chạy parity checks trên snapshot mới nhất.
- Harness smoke test theo role đã có; cần cung cấp URL staging và credential cho Admin, Office, Accounting, Teacher, Student, Parent để chạy các ca đang skip.
- Google OAuth, SMS/Zalo OTP, upload/download trên local object store thật, PayOS sandbox, Zalo dry-run, signed URL expiry, reconciliation và cron thủ công vẫn phải xác minh trên staging có tích hợp đầy đủ.
- Đo tải với `VITE_REALTIME_POLL_MS=10000` cần chạy trên staging an toàn có PostgreSQL và token load-test; không chạy vào production.
- Cần hoàn tất backup/restore drill, kiểm tra PM2/Nginx/logrotate, xác nhận secret production và chuẩn bị rollback theo release + snapshot PostgreSQL tương ứng.
- Diff overlay đã được cập nhật tại `.understand-anything/diff-overlay.json`; có thể chạy `/understand-anything:understand-dashboard` để xem trực quan phạm vi thay đổi và thành phần bị ảnh hưởng.

## 6. Commit

Toàn bộ thay đổi và báo cáo này được chuẩn bị để commit cùng nhau với thông điệp:

```text
feat: migrate runtime from Firebase to PostgreSQL VPS
```

## 7. Frontend P0 verification bổ sung

### 7.1. Auth, session và security boundary

- Thêm `e2e/role-session-matrix.spec.ts` cho sáu role: Admin, Office, Accounting, Teacher, Student và Parent. Mỗi ca kiểm tra login, role trả về từ session API, reload tab, route được phép, route bị chặn và logout.
- Thêm `e2e/security-boundaries.spec.ts` cho anonymous/cleared session 401, mutation cùng origin đi tới auth, mutation cross-site bị chặn 403 và CORS preflight nguồn lạ không được cấp `Access-Control-Allow-Origin`; session hết hạn định kỳ được khóa bằng regression test trong `AuthContext`.
- Bổ sung CSRF/origin guard tập trung ở Express trước API dispatcher. Request server-to-server không có browser origin headers vẫn được giữ tương thích cho webhook và cron.
- Sửa route `DELETE /api/v1/knowledge-bank/:id`: document ID được chuẩn hóa thành logical action `delete` trước maintenance guard, nên unauthenticated request trả 401 thay vì 500.
- Thêm selector ổn định cho role tab và nút logout để smoke test không phụ thuộc text/ngôn ngữ UI.

### 7.2. Polling và invalidation

- Bổ sung test refresh khi tab foreground và khi mạng online trở lại.
- Bổ sung test coalesce khi refresh chậm, phục hồi sau lỗi/session hết hạn và giữ dữ liệu sau lần poll thành công kế tiếp.
- Bổ sung test cleanup interval/listener khi unmount/remount để ngăn polling timer nhân đôi.
- Chạy contract invalidation cho assignment, classes, office queries, student directory và finance queries: 8 file, 66 test đạt.

### 7.3. Kết quả chạy bổ sung

| Kiểm tra | Kết quả | Chi tiết |
|---|---|---|
| Playwright trên VPS artifact local | Đạt có điều kiện | 27 đạt, 7 skip, 0 lỗi; 6 role và projected read skip do thiếu credential |
| P0 API/module contracts | Đạt | 118 file, 1.287 test đạt cho students/admissions/classes/attendance/finance/PayOS/edu/knowledge/audit/Zalo/read |
| Auth/polling regression | Đạt | 3 file, 15 test đạt |
| Full Vitest | Đạt | 634 file; 5.293 test đạt, 4 bỏ qua |
| TypeScript | Đạt | `tsc --noEmit` không có lỗi |
| VPS gate | Đạt | `test:vps`, `build:vps`, `smoke:vps-build` đều đạt |

### 7.4. Dữ liệu cần để hoàn tất smoke test thật

- `PLAYWRIGHT_BASE_URL` trỏ tới VPS staging.
- `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`.
- `E2E_OFFICE_EMAIL`, `E2E_OFFICE_PASSWORD`.
- `E2E_ACCOUNTING_EMAIL`, `E2E_ACCOUNTING_PASSWORD`.
- `E2E_TEACHER_EMAIL`, `E2E_TEACHER_PASSWORD`.
- `E2E_STUDENT_CODE`, `E2E_STUDENT_PASSWORD`.
- `E2E_PARENT_CODE`, `E2E_PARENT_PASSWORD`.
- Turnstile staging/test key cho browser automation và credential sandbox cho Google, SMS/Zalo, PayOS.

## 8. P0 cutover hardening bổ sung

- Nâng shared in-memory DocumentStore fixture để mô phỏng document ID, nested field,
  query operator, cursor/order và snapshot semantics; sửa các mock ghi đè làm mất
  `PostgresDocumentStore`.
- Cập nhật expectation session/cookie + CSRF cho Zalo frontend; xác nhận accounting
  invalidation, paging, wallet/canonical enrollment và loại test cleanup Firebase
  Auth đã không còn implementation.
- Thêm global HTTP write freeze: `GLOBAL_WRITE_FREEZE=true` chặn mọi mutation `/api`
  bằng `503` nhưng vẫn cho phép read. Freeze phải được triển khai và kiểm chứng trên
  nguồn Firebase cũ trước snapshot cuối; bật nó chỉ ở VPS mới là chưa đủ.
- Bổ sung Nginx ACME bootstrap, Certbot/TLS, redirect HTTPS/HSTS; production env bắt
  buộc pin full SHA và khai báo backup age+rclone ngoài VPS.
- Backup PostgreSQL giờ được verify, mã hóa trước khi lưu, upload offsite và check;
  có restore drill từ chối database target trùng production.
- Chạy sạch 18 migration bằng PGlite. Gate schema hiện tại được đo lại thành 85 bảng,
  8 view, 2 materialized view, 228 index, 177 foreign key, 244 CHECK, 85 UNIQUE,
  65 trigger và 14 hàm `app_*`.
- Hợp nhất quy trình tại `docs/runbooks/vps-postgres-cutover.md`; tài liệu migration,
  rollback và plan Firebase/Vercel cũ đã được đánh dấu superseded.
- Diff overlay đã đồng bộ đúng 830 file của commit cuối.

Các bước staging/production chưa chạy vì workspace không có hostname, VPS access,
credential snapshot Firebase mới, credential role/sandbox hay quyền DNS/webhook.
Docker cũng không có trên máy này; PGlite rehearsal không thay thế PostgreSQL staging.
Ngoài ra `99d2ec4e42af7bb0e696e05656078ed2ce6049af` mới là baseline và hiện chưa có
trên remote branch; các sửa P0 còn chưa commit. Phải tạo, duyệt và push một
`CUTOVER_SHA` mới chứa cả baseline lẫn P0 trước khi VPS fetch/deploy.

## 9. Xác nhận trực tiếp trên VPS qua IP

Phạm vi kiểm tra ngày 19/08/2026 chỉ dùng SSH, `127.0.0.1` trên VPS và
`http://14.225.198.57`. Không truy cập domain production, không đổi DNS/Nginx và
không chạy mutation, webhook, bot, reconciliation hay load test trên dữ liệu đang dùng.

### 9.1. Runtime và cấu hình

- Host `edutrack-nancy-qpcr`; release active
  `7300cf38d740af8c75e5126dc592cdebb8f3de62` tại
  `/srv/edutrack/releases/20260819-ip-login-7300cf38`.
- Nginx và PostgreSQL `active`; PM2 `edutrack` `online`, 0 unstable restart. Các lần
  restart ghi nhận trong phiên này đều do reload env/release có chủ đích.
- UI qua IP trả `200`; `/api/v1/liveness` và `/api/v1/health` trả `200`; health xác nhận
  PostgreSQL `connected`; session ẩn danh trả `401` đúng kỳ vọng.
- Theo yêu cầu vận hành tạm thời, toàn bộ năm tham chiếu domain trong
  `/srv/edutrack/shared/.env` đã được loại bỏ: `APP_URL`, `PUBLIC_BASE_URL`,
  `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` trỏ sang `http://14.225.198.57` và
  `TURNSTILE_EXPECTED_HOSTNAME` là `14.225.198.57`. Bản trước lần đổi cuối được lưu tại
  `/srv/edutrack/shared/.env.bak-before-ip-final-active-20260819`. Chỉ tiến trình
  `edutrack` được restart để nạp env; Nginx và domain production không bị thay đổi.
- Release active dùng cơ chế tạm thời `ALLOW_INSECURE_HTTP_AUTH=true`, đồng thời buộc
  `TURNSTILE_ENABLED=false` và `VITE_TURNSTILE_ENABLED=false`. Cookie chỉ bỏ cờ `Secure`
  cho request HTTP cùng origin thực tế; cần tắt cờ này ngay khi HTTPS hoạt động.
- `validate-environment.mjs` hiện vẫn báo `APP_URL must use HTTPS` với URL IP/HTTP dù
  runtime đã hỗ trợ cờ tạm thời. Đây là lỗi gate deploy còn phải sửa; không được coi
  environment validator là đạt trong trạng thái hiện tại.

### 9.2. PostgreSQL

- Đủ 18 migration `0001`–`0018`, tất cả có trạng thái `success`.
- Verifier schema mới đạt toàn bộ: 85 bảng, 8 view, 2 materialized view, 228 index,
  177 foreign key, 244 CHECK, 85 UNIQUE, 65 trigger, 14 hàm `app_*` và đủ ba extension.
- Đối chiếu read-only đạt 11/11 bảng nghiệp vụ cốt lõi, 4/4 tổng tài chính khớp từng
  đồng và 7/7 bất biến dữ liệu bằng 0. Phần `app_enable_finance_guards()` có khả năng
  khóa/đổi trạng thái trigger không được chạy trên hệ thống đang dùng.
- Release đang chạy chứa bản `db/verify-schema.sql` cũ nên tự báo lệch ở sáu bộ đếm;
  số thực tế của database khớp chính xác verifier mới trong worktree.

### 9.3. Frontend/integration read-only và các blocker

- Playwright qua IP xác nhận trang login tải được, nút Google hiện diện, submit rỗng bị
  vô hiệu hóa và lần chạy ổn định không có console error ngoài `401` session ẩn danh đã
  được lọc đúng.
- Test selector tab học sinh của worktree chưa có trong artifact đang deploy, do các sửa
  P0 tương ứng chưa có trong artifact tại thời điểm chạy ca này. Sau đó release
  `20260819-ip-login-7300cf38` đã được build, smoke và activate bởi phiên triển khai
  song song; cần chạy lại ma trận role khi có credential kiểm thử.
- CORS preflight từ origin lạ không nhận `Access-Control-Allow-Origin`.
- Google OAuth chưa có `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`.
- PayOS client ID có cấu hình nhưng API key/checksum key đang rỗng; runtime cảnh báo
  PayOS bị vô hiệu hóa. Vì vậy chưa thể xác nhận sandbox/webhook/reconciliation.
- Zalo bot đang bật và không ở dry-run; không gửi thử để tránh tác động người dùng thật.
- Có một PostgreSQL dump kèm SHA-256 lúc 21:06, nhưng chưa thấy cron entry hay cấu hình
  logrotate dành riêng cho EduTrack được cài trên host; cần hoàn tất gate vận hành này
  trước khi coi cutover production là hoàn chỉnh.

## 10. P0 verification chỉ chạy trên VPS

Theo yêu cầu vận hành mới nhất, các kết quả dưới đây được tạo trực tiếp trên VPS; không
chạy thêm test trên máy làm việc của người dùng.

- Toàn bộ source worktree hợp lệ được đóng gói thành 2.231 file, upload vào release cô lập
  `/srv/edutrack/releases/20260819-p0-vps-test-01`. SHA-256 của archive ở hai đầu cùng là
  `44698fe12d80184e7ecf117406d0350faf9154af8da8c3c76dadb314df8c5051`.
- Release thử nghiệm không thay symlink `/srv/edutrack/current`, không activate Nginx và
  không restart PM2 bởi quy trình kiểm thử này.
- Lần đọc cuối cho thấy `current` đã được một luồng vận hành khác chuyển sang
  `/srv/edutrack/releases/20260819-vps-domain-turnstile-a3de78ad`; release P0 thử nghiệm
  vẫn tách biệt, không còn tiến trình Vitest và PM2 `edutrack` đang `online`.
- `npm ci --ignore-scripts` đạt; `npm run typecheck` đạt trong 145,2 giây;
  `npm run test:vps` đạt 7 file/74 test trong 41,3 giây.
- Full Vitest được hạ xuống một worker, ghim một CPU và chia 20 shard để bảo vệ dịch vụ.
  Sáu shard hoàn tất đã chạy 1.622 test: 1.621 đạt, 1 lỗi. Test lỗi duy nhất là cảnh báo
  DevTools trong `Assignments.test.tsx`; chạy lại riêng trên cùng VPS đạt 1/1 trong 16,99
  giây, nên được phân loại flaky dưới tải chứ chưa có bằng chứng regression nghiệp vụ.
- Không được ghi nhận full suite là đạt: shard 7 bị dừng có chủ đích và shard 8–20 chưa
  chạy. Trong thời gian này có một phiên `root` tương tác khác và PM2 liên tục nhận lệnh
  stop/restart; tiến trình panel `BTTask` cũng có lúc chiếm gần trọn CPU. Build/smoke và
  rehearsal migration tiếp theo được dừng để tránh tác động production.
- `npm audit --omit=dev` trên VPS đạt với 0 lỗ hổng production. Audit đầy đủ có 5 cảnh báo
  chỉ trong toolchain dev: 4 moderate qua `drizzle-kit`/`esbuild` và 1 high qua `nanoid`.
  Không chạy `npm audit fix` vì remediation được đề xuất có thay đổi major/downgrade.

Gate còn thiếu phải chạy trên VPS staging riêng hoặc trong maintenance window đã chốt:
full Vitest, `build:vps`, `smoke:vps-build`, PostgreSQL trống đủ 18 migration, restore drill,
parity dữ liệu và role/integration smoke. Các kết quả xanh cũ ở mục 4/7 là lịch sử của
artifact trước đó, không thay thế gate cho release P0 cô lập nêu tại mục này.
