# Triá»ƒn khai EduTrack trÃªn VPS

Runtime production lÃ  má»™t á»©ng dá»¥ng Ä‘á»™c láº­p trÃªn VPS:

```text
Internet -> Nginx :443 -> Node/Express 127.0.0.1:3000
                              |-> Vite SPA trong dist/
                              |-> API /api vÃ  /api/v1
                              |-> PostgreSQL
                              `-> thÆ° má»¥c upload cá»¥c bá»™

cron -> http://127.0.0.1:3000/api/...
```

KhÃ´ng cÃ³ serverless function, SDK xÃ¡c thá»±c bÃªn thá»© ba hoáº·c database cloud trong
runtime. MÆ°á»i hai nhÃ³m API cÅ© Ä‘Æ°á»£c Ä‘Äƒng kÃ½ trá»±c tiáº¿p trong
`server/http/routes.ts`; upload dÃ¹ng route `storage` cá»§a VPS.

## 1. YÃªu cáº§u host

- Node.js `>= 22.22`
- PostgreSQL `>= 14` vÃ  cÃ¡c extension `btree_gist`, `pg_trgm`, `unaccent`
- Nginx, PM2, Certbot, `curl`, `flock`, `age`, `rclone`
- timezone `Asia/Ho_Chi_Minh`

Kiá»ƒm tra host mÃ  khÃ´ng thay Ä‘á»•i cáº¥u hÃ¬nh:

```bash
bash deploy/vps/validate-host.sh
```

## 2. Cáº¥u hÃ¬nh

Sao chÃ©p `deploy/vps/.env.example` thÃ nh `/srv/edutrack/shared/.env`, Ä‘áº·t quyá»n
`600`, rá»“i Ä‘iá»n cÃ¡c giÃ¡ trá»‹ thá»±c. CÃ¡c biáº¿n báº¯t buá»™c gá»“m:

- `APP_URL`, `PUBLIC_BASE_URL`
- `DATABASE_URL`
- `SESSION_SECRET`
- `STORAGE_LOCAL_ROOT`, `STORAGE_SIGNING_SECRET`
- `CRON_SECRET`, `OTP_PEPPER`, `LOOKUP_CHALLENGE_SECRET`
- `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY`
- `APP_COMMIT_SHA` (Ä‘á»§ 40 kÃ½ tá»±), `POSTGRES_BACKUP_AGE_RECIPIENT`,
  `POSTGRES_BACKUP_RCLONE_REMOTE`

Google OAuth lÃ  tÃ¹y chá»n. Náº¿u báº­t, callback pháº£i lÃ :

```text
https://<domain>/api/v1/auth/google-callback
```

vÃ  cáº§n `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. SMS OTP dÃ¹ng
`SMS_API_URL`, `SMS_API_TOKEN` vÃ  tÃ¹y chá»n `SMS_SENDER_ID`.

Kiá»ƒm tra file cáº¥u hÃ¬nh trÆ°á»›c khi khá»Ÿi Ä‘á»™ng:

```bash
node --env-file=/srv/edutrack/shared/.env deploy/vps/validate-environment.mjs
```

## 3. Build vÃ  kiá»ƒm tra release

```bash
npm ci
npm run check:vps-source
npm run typecheck
npm run test:vps
npm run build:vps
npm run smoke:vps-build
```

Cháº¡y cÃ¡c gate trÃªn release cÃ´ láº­p. NÃªu cÃ³ staging riÃªng thÃ¬ Ä‘Ã¡nh giÃ¡ cÃ¡c gate nÃ y tÃºi trÃªn staging riÃªng; nÃªu khÃ´ng cÃ³, cÃ³ thá»ƒ tiáº¿p tá»¥c trÃªn VPS hiá»‡n tÆ°á»ng khi Ä‘Ã£ quyáº¿t nghá»› và khóa window nhá»:
- KHÃ”NG thá»Ÿn test/build khÃ¡ng cÃ³ trong release `current` cÃ¡c production;
- KHÃ“NG thá»Ÿn t?i l?i `pm2` hoáº·c `nginx` trong validation;
- ÄÃ£ cÃ³ xÃ¡c nháº­n khÃ´ng cÃ²n phiÃªn deploy/PM2 operator khÃ¡c;
- Chuáº©n bá» trÃªn test/shard vÃ ng m?i khi ch?t h?t.
`current` cá»§a production. Náº¿u chá»‰ cÃ³ má»™t VPS, cáº§n maintenance window vÃ  pháº£i xÃ¡c nháº­n khÃ´ng
cÃ³ phiÃªn deploy/PM2 operator khÃ¡c trÆ°á»›c khi cháº¡y; khÃ´ng tá»•ng há»£p cÃ¡c shard chÆ°a Ä‘á»§ thÃ nh káº¿t
quáº£ full-suite pass.

Release cáº§n cÃ³:

```text
dist/
dist-server/
package.json
package-lock.json
deploy/vps/
db/
scripts/materialize-document-store.mjs
```

TrÃªn VPS chá»‰ cÃ i dependency runtime:

```bash
npm ci --omit=dev --ignore-scripts
```

## 4. PostgreSQL vÃ  dá»¯ liá»‡u chuyá»ƒn Ä‘á»•i

LuÃ´n backup trÆ°á»›c migration:

```bash
bash deploy/vps/backup-postgres.sh
bash db/run-migrations.sh --dry-run
bash db/run-migrations.sh
```

Sau khi náº¡p snapshot Ä‘Ã£ chuáº©n hÃ³a:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/data.sql
npm run db:materialize-documents
```

Lá»‡nh materialize táº¡o dá»¯ liá»‡u tÆ°Æ¡ng thÃ­ch trong `app_documents` Ä‘á»ƒ cÃ¡c handler
nghiá»‡p vá»¥ cÅ© cháº¡y trÃªn PostgreSQL ngay trong cá»­a sá»• chuyá»ƒn Ä‘á»•i. Lá»‡nh máº·c Ä‘á»‹nh tá»«
chá»‘i cháº¡y náº¿u báº£ng Ä‘Ã£ cÃ³ dá»¯ liá»‡u. Chá»‰ khi chá»§ Ä‘á»™ng dá»±ng láº¡i hoÃ n toÃ n:

```bash
CONFIRM_DOCUMENT_STORE_REPLACE=replace \
  npm run db:materialize-documents -- --replace
```

Kiá»ƒm tra schema, dá»¯ liá»‡u vÃ  káº¿t ná»‘i:

```bash
psql "$DATABASE_URL" -f db/verify-schema.sql
psql "$DATABASE_URL" -f db/verify-data.sql
npm run db:check
```

## 5. Khá»Ÿi Ä‘á»™ng

```bash
cd /srv/edutrack/current
pm2 start deploy/vps/ecosystem.config.cjs --env production
pm2 save

curl --fail http://127.0.0.1:3000/api/v1/liveness
curl --fail http://127.0.0.1:3000/api/v1/health
```

Chá»‰ kÃ­ch hoáº¡t Nginx sau khi liveness vÃ  health Ä‘áº¡t:

```bash
sudo -E CERTBOT_EMAIL=ops@example.com \
  bash deploy/vps/activate-host.sh vps.thienuy.edu.vn
```

Náº¿u host staging chá»‰ cÃ³ IPv4 cÃ´ng khai, Certbot `>= 5.4` cÃ³ thá»ƒ cáº¥p chá»©ng chá»‰
ngáº¯n háº¡n trá»±c tiáº¿p cho IP. Chá»©ng chá»‰ IP cÃ³ háº¡n khoáº£ng sÃ¡u ngÃ y nÃªn khÃ´ng Ä‘Æ°á»£c táº¯t
timer tá»± gia háº¡n:

```bash
sudo -E CERTBOT_EMAIL=ops@example.com \
  bash deploy/vps/activate-host.sh 14.225.198.57
```

IP HTTPS phÃ¹ há»£p Ä‘á»ƒ kiá»ƒm tra háº¡ táº§ng vÃ  Ä‘Äƒng nháº­p báº±ng máº­t kháº©u. Google OAuth web
váº«n cáº§n má»™t hostname HTTPS, khÃ´ng dÃ¹ng raw IP lÃ m redirect host.

Trong giai Ä‘oáº¡n chuyá»ƒn Ä‘á»•i, khÃ´ng truyá»n hostname production vÃ o script trÃªn VPS.
Giá»¯ DNS production trá» tá»›i há»‡ thá»‘ng hiá»‡n táº¡i cho Ä‘áº¿n khi VPS vÆ°á»£t toÃ n bá»™ gate
cutover vÃ  cÃ³ maintenance window Ä‘Æ°á»£c phÃª duyá»‡t.

## 6. Cron, log vÃ  backup

Cron gá»i loopback báº±ng `CRON_SECRET`, khÃ´ng Ä‘i vÃ²ng qua Internet:

```bash
crontab deploy/vps/crontab
sudo install -m 0644 deploy/vps/logrotate.conf /etc/logrotate.d/edutrack
```

Backup PostgreSQL háº±ng ngÃ y Ä‘Æ°á»£c kiá»ƒm tra báº±ng `pg_restore --list`, mÃ£ hÃ³a báº±ng
`age`, ghi SHA-256 vÃ  upload báº±ng `rclone` sang nÆ¡i ngoÃ i VPS. Diá»…n táº­p restore
trÃªn database trá»‘ng riÃªng báº±ng `deploy/vps/restore-postgres-drill.sh`; script tá»«
chá»‘i target trÃ¹ng database production.

## 7. Gate trÆ°á»›c khi chuyá»ƒn traffic

- Typecheck, test VPS, build vÃ  smoke Ä‘á»u xanh Ä‘Ãºng commit.
- Äá»§ 19 migration vÃ  `app_documents` Ä‘Ã£ materialize.
- ÄÄƒng nháº­p máº­t kháº©u, Google, há»c sinh vÃ  phá»¥ huynh Ä‘Ã£ Ä‘Æ°á»£c thá»­ theo tá»«ng role.
- Upload/download, Zalo dry-run vÃ  cron thá»§ cÃ´ng Ä‘áº¡t. PayOS táº¡m hoÃ£n;
  giao diá»‡n pháº£i bÃ¡o tÃ­nh nÄƒng Ä‘ang phÃ¡t triá»ƒn vÃ  khÃ´ng táº¡o payment request.
- Backup vÃ  restore drill Ä‘áº¡t; PM2/Nginx khÃ´ng cÃ³ lá»—i má»›i.
- DNS, webhook vÃ  TTL Ä‘Ã£ Ä‘Æ°á»£c chá»‘t trong maintenance window.

Rollback á»©ng dá»¥ng lÃ  Ä‘Æ°a symlink `current` vá» release VPS trÆ°á»›c Ä‘Ã³ vÃ  restore
snapshot PostgreSQL tÆ°Æ¡ng á»©ng. KhÃ´ng dÃ¹ng má»™t ná»n táº£ng runtime thá»© hai lÃ m Ä‘Æ°á»ng
rollback Ã¢m tháº§m.

Checklist cutover Ä‘áº§y Ä‘á»§, Ä‘áº·c biá»‡t global write freeze trÃªn nguá»“n Firebase cÅ©,
náº±m táº¡i [`docs/runbooks/vps-postgres-cutover.md`](../../docs/runbooks/vps-postgres-cutover.md).
