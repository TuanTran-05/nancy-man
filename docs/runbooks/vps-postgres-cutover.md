# Runbook cutover VPS + PostgreSQL

> Tài liệu lịch sử kể từ 2026-08-20. Production đã nhận write trên PostgreSQL
> và có 19 migration. Không chạy lại snapshot/import Firebase. Checklist hiện
> hành: [`vps-postgres-post-cutover-stabilization.md`](vps-postgres-post-cutover-stabilization.md).

ÄÃ¢y lÃ  runbook cÃ³ tháº©m quyá»n cho Ä‘á»£t chuyá»ƒn production khá»i Vercel/Firebase.
CÃ¡c káº¿ hoáº¡ch hosting/Firebase cÅ© chá»‰ cÃ²n giÃ¡ trá»‹ lá»‹ch sá»­. KhÃ´ng rollback runtime
vá» Vercel/Firestore sau khi Ä‘Ã£ nháº­n write trÃªn PostgreSQL.

## Pháº¡m vi vÃ  Ä‘iá»u kiá»‡n no-go

- Baseline Ä‘Ã£ kiá»ƒm: `99d2ec4e42af7bb0e696e05656078ed2ce6049af`. CÃ¡c sá»­a P0 trong
  bÃ¡o cÃ¡o nÃ y Ä‘ang náº±m trÃªn baseline, nÃªn **khÃ´ng deploy riÃªng SHA baseline** vÃ¬
  nÃ³ chÆ°a chá»©a write-freeze, TLS/backup Gate này nÃªn cháº¡y trÃªn release cô lÃ¡p. MÃ´ hiáº¿n tÃ­nh tÃªn lÃ  VPS staging riÃªng; nÃªu chÆ°a cÃ³ staging riÃªng, cÃ³ thá»ƒ tiáº¿p tá»¥c trá»ng h?p nÃªu thoÃ¡ d? kiá»‡n dÆ°á»›i Ä‘Ã¢y:
- release test Ä‘Ã£ Ä‘Æ°á»£c Ä‘Æ°a trong thÆ° m?c riÃªng vÃ  KHÃ”NG Ä‘á»•i symlink `/srv/edutrack/current`;
- KHÃ”NG kh?i Ä‘á»™ng l?i `pm2` hoáº·c `nginx` trong suá»t validation;
- KHÃ”NG cÃ²n operator khÃ¡c Ä‘iá»u khiá»ƒn release/PM2 trong khoáa gian validation;
- có maintenance window Ä‘Ã£ Ä‘Æ°á»£c xÃ¡c nháº­n vÃ  owner duy nháº¥t;

Trong trÆ°áº£ng há»£p nÃ y, viá»‡c má»™t shard hay test flaky retried Ä‘áº¡t khÃ´ng Ä‘Æ°á»£c tÃ­nh lÃ  full-suite pass.

## 2. Dá»±ng staging an toÃ n

1. Táº¡o PostgreSQL trá»‘ng vÃ  role riÃªng; chá»‰ bind PostgreSQL vÃ o loopback/private
   network. Cháº¡y `bash deploy/vps/validate-host.sh`.
2. Táº¡o `/srv/edutrack/shared/.env` tá»« template báº±ng
   `prepare-environment.mjs`, Ä‘áº·t owner `deploy` vÃ  mode `600`.
3. DÃ¹ng secret Ä‘á»™c láº­p cho `SESSION_SECRET`, `STORAGE_SIGNING_SECRET`,
   `OTP_PEPPER`, `LOOKUP_CHALLENGE_SECRET`, database vÃ  credential tÃ­ch há»£p.
   Staging khÃ´ng káº¿ thá»«a PayOS/Zalo production.
4. Äáº·t `APP_COMMIT_SHA` Ä‘Ãºng SHA release vÃ  giá»¯ `GLOBAL_WRITE_FREEZE=false`.
5. Cáº¥u hÃ¬nh age recipient vÃ  rclone remote náº±m ngoÃ i VPS; cháº¡y
   `validate-environment.mjs` trÆ°á»›c khi khá»Ÿi Ä‘á»™ng.
6. Cháº¡y Ä‘á»§ 19 migration, rá»“i kiá»ƒm schema:

```bash
bash db/run-migrations.sh --dry-run
bash db/run-migrations.sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify-schema.sql
```

Káº¿t quáº£ báº¯t buá»™c: 19 dÃ²ng `schema_migrations`; má»i dÃ²ng `ket_qua` lÃ  `OK`.

## 3. Chá»¥p dá»¯ liá»‡u cuá»‘i dÆ°á»›i global write freeze

Global freeze pháº£i cháº·n toÃ n bá»™ write táº¡i ingress cá»§a deployment Firebase cÅ©:
admissions/student, ghi danh, Ä‘iá»ƒm danh, Ä‘Ã¡nh giÃ¡, biÃªn lai, vÃ­, thanh toÃ¡n,
upload, cron, PayOS webhook vÃ  Zalo webhook. Middleware
`GLOBAL_WRITE_FREEZE=true` cá»§a server má»›i tráº£ `503` cho má»i HTTP mutation, nhÆ°ng
nÃ³ chá»‰ báº£o vá»‡ deployment nÃ o Ä‘Ã£ cháº¡y code Ä‘Ã³; khÃ´ng Ä‘Æ°á»£c coi nÃ³ lÃ  báº±ng chá»©ng
Ä‘Ã£ khÃ³a nguá»“n cÅ© náº¿u nguá»“n cÅ© chÆ°a Ä‘Æ°á»£c cáº­p nháº­t.

TrÃ¬nh tá»± báº¯t buá»™c:

1. Háº¡ DNS TTL trÆ°á»›c cá»­a sá»• theo káº¿ hoáº¡ch; thÃ´ng bÃ¡o maintenance.
2. Táº¯t táº¡o payment order má»›i, dá»«ng ba cron Vercel vÃ  Ä‘á»£i request/payment Ä‘ang xá»­
   lÃ½ káº¿t thÃºc. Giá»¯ danh sÃ¡ch payment Ä‘Ã£ paid nhÆ°ng chÆ°a xÃ¡c nháº­n Ä‘á»ƒ Ä‘á»‘i soÃ¡t.
3. Báº­t freeze á»Ÿ nguá»“n cÅ©. Thá»­ cÃ³ chá»§ Ä‘Ã­ch tá»«ng nhÃ³m write nÃªu trÃªn vÃ  lÆ°u báº±ng
   chá»©ng `503`; kiá»ƒm tra log khÃ´ng cÃ²n write thÃ nh cÃ´ng sau má»‘c freeze.
4. Ghi chÃ­nh xÃ¡c UTC timestamp vÃ  ngÆ°á»i xÃ¡c nháº­n freeze.
5. Chá»‰ sau Ä‘Ã³ cháº¡y láº¡i tá»« mÃ¡y cÃ³ quyá»n Ä‘á»c Firebase production má»›i nháº¥t:

```bash
cd db/preflight
node 03-verify-decisions.mjs "<repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a
node 02-dry-run-load.mjs "<repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a \
  ../migrations --emit ../data.sql
node --max-old-space-size=4096 05-verify-dump.mjs ../migrations ../data.sql
```

Ba gate tÆ°Æ¡ng á»©ng pháº£i lÃ  `TAT CA KHANG DINH CON DUNG`, `HANG BI BO QUA: 0` vÃ 
`TAT CA QUA`. Náº¿u má»™t gate fail: giá»¯ freeze hoáº·c chá»§ Ä‘á»™ng má»Ÿ láº¡i nguá»“n cÅ©, há»§y
snapshot vÃ  xá»­ lÃ½ nguyÃªn nhÃ¢n; khÃ´ng tiáº¿p tá»¥c báº±ng file cÅ©.

## 4. Náº¡p vÃ  chá»©ng minh parity

Chuyá»ƒn `data.sql` qua kÃªnh mÃ£ hÃ³a, xÃ¡c minh checksum, rá»“i trÃªn PostgreSQL trá»‘ng:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/data.sql
npm run db:materialize-documents
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify-schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify-data.sql
npm run db:check
```

LÆ°u artifact cho cÃ¡c gate sau:

- Row count cá»§a má»i báº£ng khá»›p khá»‘i `-- ky vong:` trong snapshot má»›i.
- KhÃ´ng cÃ³ student/course enrollment má»“ cÃ´i hoáº·c canonical identity trÃ¹ng/lá»‡ch.
- Tá»•ng biÃªn lai, allocations, ledger Ä‘Ã£ thu, wallet transactions vÃ  sá»‘ dÆ° vÃ­
  khá»›p; khÃ´ng cÃ³ vÃ­ Ã¢m, class counter Ã¢m hoáº·c receipt/ledger máº¥t cÃ¢n báº±ng.
- Audit log paging vÃ  operational reads cÃ³ cÃ¹ng payload/cursor:

```bash
npm run db:parity:audit-log -- <firebase-database-id> <start-date> <end-date>
npm run db:parity:operational -- <firebase-database-id>
```

Cháº¡y láº¡i parity sau materialize. Báº¥t ká»³ sai lá»‡ch nÃ o chÆ°a giáº£i thÃ­ch Ä‘Æ°á»£c lÃ 
no-go, ká»ƒ cáº£ tá»•ng row count trÃ´ng Ä‘Ãºng.

## 5. TLS, process vÃ  váº­n hÃ nh

1. Start PM2 trÃªn loopback; kiá»ƒm liveness/readiness trÆ°á»›c khi public.
2. Äáº·t `CERTBOT_EMAIL`, rá»“i cháº¡y
   `sudo -E bash deploy/vps/activate-host.sh <domain> [domain-khac]`.
   Script chá»‰ má»Ÿ ACME challenge trÃªn HTTP, láº¥y certificate, sau Ä‘Ã³ báº­t redirect
   308, TLS vÃ  HSTS. XÃ¡c nháº­n certificate renewal timer.
3. CÃ i logrotate vÃ  crontab. TrÆ°á»›c khi táº¯t cron Vercel, gá»i thá»§ cÃ´ng Ä‘Ãºng ba route:

```bash
bash deploy/vps/run-cron.sh /api/audit/daily-maintenance
bash deploy/vps/run-cron.sh /api/audit/zalo-bot-daily-digest
bash deploy/vps/run-cron.sh /api/audit/outbox-process
```

4. Cháº¡y `backup-postgres.sh`; xÃ¡c nháº­n cÃ³ `.dump.age` + `.sha256` cáº£ local vÃ 
   remote ngoÃ i VPS. Táº¡o database trá»‘ng riÃªng vÃ  diá»…n táº­p:

```bash
AGE_IDENTITY_FILE=/secure/path/identity.txt \
  bash deploy/vps/restore-postgres-drill.sh \
  /srv/edutrack/shared/backups/postgres/<backup>.dump.age \
  '<isolated-restore-database-url>'
```

KhÃ´ng dÃ¹ng database production lÃ m target restore drill.

## 6. Smoke, chuyá»ƒn traffic vÃ  theo dÃµi

- Smoke login/session cho admin, office, teacher, accounting, student, parent;
  xÃ¡c nháº­n cookie Secure, CSRF boundary, logout/revoke vÃ  session háº¿t háº¡n.
- Smoke admissions/enrollment, attendance, receipt/payment, upload/download,
  audit paging, PayOS sandbox vÃ  Zalo dry-run.
- Chá»‘t PayOS/Zalo webhook URL + secret; Ä‘á»•i DNS; báº­t cron VPS Ä‘Ãºng má»™t nÆ¡i.
- Theo dÃµi PM2/Nginx/PostgreSQL, queue/outbox, webhook, auth failures vÃ  cÃ¡c báº¥t
  biáº¿n tÃ i chÃ­nh trong toÃ n bá»™ cá»­a sá»•. Chá»‰ táº¯t freeze sau khi ngÆ°á»i chá»‰ huy kÃ½
  Ä‘á»§ parity + smoke; ghi láº¡i timestamp má»Ÿ write.

## 7. Rollback

Rollback lÃ  má»™t cáº·p khÃ´ng thá»ƒ tÃ¡ch rá»i:

1. Báº­t `GLOBAL_WRITE_FREEZE=true` vÃ  dá»«ng cron/webhook mutation.
2. XÃ¡c Ä‘á»‹nh release VPS tá»‘t gáº§n nháº¥t vÃ  snapshot PostgreSQL mÃ£ hÃ³a Ä‘Æ°á»£c táº¡o ngay
   trÆ°á»›c release Ä‘Ã³.
3. Äá»•i symlink `/srv/edutrack/current` vá» release Ä‘Ã³, restore snapshot vÃ o
   database **má»›i/riÃªng**, cháº¡y verify, rá»“i chuyá»ƒn `DATABASE_URL` cÃ³ kiá»ƒm soÃ¡t.
4. Reload PM2/Nginx, cháº¡y role smoke, sau Ä‘Ã³ má»›i má»Ÿ write.

KhÃ´ng promote Vercel cÅ© vÃ  khÃ´ng Ä‘Æ°a Firestore trá»Ÿ láº¡i lÃ m nguá»“n ghi. Náº¿u Ä‘Ã£ cÃ³
write má»›i sau cutover, restore snapshot sáº½ lÃ m máº¥t cÃ¡c write Ä‘Ã³; rollback owner
pháº£i quyáº¿t Ä‘á»‹nh reconcile/forward-fix trÆ°á»›c khi cho phÃ©p restore.

## BiÃªn báº£n báº¯t buá»™c

LÆ°u: SHA, hostname, ngÆ°á»i phÃª duyá»‡t, freeze/unfreeze timestamp, checksum
snapshot, output 19 migration, schema/data/parity, backup/offsite/restore drill,
ba cron, role smoke, webhook, DNS TTL vÃ  quyáº¿t Ä‘á»‹nh go/no-go/rollback.
