# Dựng database trên VPS

Hướng dẫn tự chạy. Mọi lệnh chạy trên VPS Ubuntu trừ chỗ ghi rõ "trên máy Windows".

Không có bước nào chạm vào Firestore. App vẫn đang chạy bình thường trong lúc bạn
làm việc này — bạn chỉ đang dựng một database rỗng bên cạnh.

> **Trạng thái source-only:** tài liệu này là runbook cho cửa sổ triển khai sau này. Không chạy các
> bước đọc Firestore, nạp dữ liệu, SSH hoặc migration trong giai đoạn chỉ chuẩn bị source code.

---

## Bước 0 — Kiểm tra điều kiện

```bash
psql --version                       # cần >= 14
sudo -u postgres psql -c 'SHOW server_version'
ls /usr/share/postgresql/*/extension/btree_gist.control   # cần tồn tại
```

Nếu file `.control` không có, cài contrib rồi kiểm lại:

```bash
sudo apt update && sudo apt install -y postgresql-contrib
```

Ba extension cần: `btree_gist`, `pg_trgm`, `unaccent`. Từ PostgreSQL 13 cả ba
đều là *trusted*, nên chủ database tạo được mà không cần superuser. Nếu vẫn báo
`permission denied to create extension`, xem cách xử lý ở Bước 4.

**Vì sao cần >= 14:** schema dùng `normalize(… , NFD)`, `num_nulls()`, và index
GiST trên `daterange` (`class_terms_range_idx` — đây là chỗ cần `btree_gist`).

---

## Bước 1 — Tạo role và database

Đổi mật khẩu trước khi dán.

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE edutrack LOGIN PASSWORD 'DOI-MAT-KHAU-NAY';
CREATE DATABASE edutrack OWNER edutrack ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
SQL
```

`LC_COLLATE 'C'` là cố ý: sắp xếp theo byte, ổn định và nhanh. Tên tiếng Việt
đã được sắp bằng `name_normalized` (đã bỏ dấu) chứ không dựa vào collation của
database, nên không mất gì.

Kiểm tra kết nối:

```bash
export DATABASE_URL='postgres://edutrack:DOI-MAT-KHAU-NAY@localhost:5432/edutrack'
psql "$DATABASE_URL" -c 'SELECT current_database(), current_user'
```

---

## Bước 2 — Đưa file lên

**Trên máy Windows**, từ thư mục repo:

```bash
scp -r db/ user@vps:/srv/edutrack/
```

Hoặc nếu đã commit và VPS clone được repo thì `git pull` cũng được — `db/.gitattributes`
đã ép `.sh` và `.sql` dùng LF nên không dính lỗi `bad interpreter`.

Chỉ cần bốn thứ: `db/migrations/`, `db/run-migrations.sh`, `db/verify-schema.sql`,
`db/verify-data.sql`. Thư mục `db/preflight/` và `db/normalization/` không cần lên VPS
— chúng đọc Firestore từ máy dev. `db/data.sql` sẽ được đưa lên riêng ở bước 7
(nó không nằm trong git).

---

## Bước 3 — Chạy thử

```bash
cd /srv/edutrack
export DATABASE_URL='postgres://edutrack:DOI-MAT-KHAU-NAY@localhost:5432/edutrack'

bash db/run-migrations.sh --dry-run
```

Kết quả mong đợi:

```
se chay  0001_extensions.sql
se chay  0002_identity.sql
…
se chay  0011_triggers.sql
se chay  0012_audit_log_user_name.sql
se chay  0013_jobs_error.sql
se chay  0014_notification_updated_at_optional.sql
se chay  0015_notification_updated_at_repair.sql
se chay  0016_vps_auth_sessions.sql
se chay  0017_document_store.sql
se chay  0018_auth_user_providers.sql
se chay  0019_restore_portability.sql
(dry-run) 19 file se chay, 0 file bo qua.
```

---

## Bước 4 — Chạy thật

```bash
bash db/run-migrations.sh
```

```
chay     0001_extensions.sql
…
chay     0011_triggers.sql
chay     0012_audit_log_user_name.sql
chay     0013_jobs_error.sql
chay     0014_notification_updated_at_optional.sql
chay     0015_notification_updated_at_repair.sql
chay     0016_vps_auth_sessions.sql
chay     0017_document_store.sql
chay     0018_auth_user_providers.sql
chay     0019_restore_portability.sql
Xong: 19 file da chay, 0 file bo qua.
```

Mỗi file chạy trong transaction riêng và được ghi vào bảng `schema_migrations`
kèm checksum. Lỗi ở file nào thì dừng ngay tại đó, các file trước vẫn giữ nguyên.

**Nếu `0001` báo `permission denied to create extension`:** tạo trước ba
extension bằng superuser, rồi chạy lại như thường.

```bash
sudo -u postgres psql -d edutrack -c 'CREATE EXTENSION IF NOT EXISTS btree_gist;
                                      CREATE EXTENSION IF NOT EXISTS pg_trgm;
                                      CREATE EXTENSION IF NOT EXISTS unaccent;'
bash db/run-migrations.sh
```

Đừng chạy cả file `0001` bằng superuser: các hàm `app_*` sẽ thuộc sở hữu của
`postgres`, và lần chạy sau bằng role `edutrack` sẽ hỏng ở
`CREATE OR REPLACE FUNCTION` với lỗi *must be owner of function*. Chỉ tạo
extension thôi là đủ — `CREATE EXTENSION IF NOT EXISTS` với extension đã tồn tại
thoát ra trước khi kiểm quyền, nên `0001` chạy lại bằng role thường sẽ qua.

---

## Bước 5 — Đối chiếu

```bash
psql "$DATABASE_URL" -f db/verify-schema.sql
```

Bảng đầu tiên phải **OK hết 10 dòng**. Đây là con số đo được trên bản đã diễn tập:

| đối tượng | mong đợi |
|---|---|
| bảng | 85 |
| view | 8 |
| materialized view | 2 |
| index | 228 |
| khoá ngoại | 177 |
| CHECK | 244 |
| UNIQUE | 85 |
| EXCLUDE | 0 |
| trigger | 65 |
| hàm `app_*` | 14 |

Bảng "Hàm chuẩn hoá" phải in ra đúng:

```
TRAN THI QUYNH NHU | DANG DINH DO | TRAN ANH TUAN | HS260847
```

Nếu cột `d gach ngang` không ra `DANG DINH DO` thì từ điển `unaccent` trên VPS
khác bản đã thử — báo lại, vì `students.code_normalized` và `name_normalized`
là **cột sinh (generated)**, sai ở đây là sai vĩnh viễn trong dữ liệu.

Bảng cuối ("số hàng từng bảng") lúc này chỉ có hai dòng: `schema_migrations` = 19
và `teacher_availability_slots` = 6. Cái sau là 6 khung giờ nạp sẵn ở `0007` để khoá
ngoại có chỗ trỏ tới. Đúng.

---

## Bước 6 — Sinh file dữ liệu (chạy trên máy dev, không phải VPS)

Bước này đọc Firestore production (chỉ đọc) và đổ ra **một file SQL**. VPS không
cần Node, không cần khoá Firebase, không cần mở cổng 5432 ra ngoài.

```bash
cd db/preflight
npm install

# 1. Kiểm lại các quyết định chuẩn hoá còn đúng với production hôm nay không.
#    Production vẫn đang chạy — số liệu tăng từng ngày.
node 03-verify-decisions.mjs "<đường-dẫn-repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a

# 2. Nạp thử toàn bộ vào một Postgres thật trong bộ nhớ, rồi ghi ra db/data.sql.
node 02-dry-run-load.mjs "<đường-dẫn-repo>" ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a \
     ../migrations --emit ../data.sql

# 3. Phát lại chính file đó vào một Postgres trống, đối chiếu lại tiền.
node --max-old-space-size=4096 05-verify-dump.mjs ../migrations ../data.sql
```

Bước 1 phải in `TAT CA KHANG DINH CON DUNG`. Nếu một khẳng định hết hạn (ví dụ
mã `HS260321` đã có người dùng), sửa `db/normalization/decisions.json` trước —
**đừng nạp**.

Bước 2 phải in `HANG BI BO QUA: 0`. File chỉ được ghi ra khi con số này bằng 0;
một file dữ liệu sinh ra từ lần nạp có hàng bị từ chối là một file thiếu dữ liệu
mà không ai nhìn thấy.

Bước 3 phải in `TAT CA QUA`.

`db/data.sql` **không nằm trong git** — 16 MB và chứa tên, ngày sinh, số điện
thoại học sinh thật. Sinh lại bất cứ lúc nào bằng lệnh trên.

---

## Bước 7 — Nạp dữ liệu

Đưa file lên rồi chạy:

```bash
scp db/data.sql user@vps:/srv/edutrack/db/
```

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/data.sql
```

Toàn bộ nằm trong **một transaction**: hoặc vào hết, hoặc không hàng nào vào.
Không có trạng thái nạp dở. Mất kết nối giữa chừng thì Postgres tự huỷ, chạy lại
từ đầu là được.

Ba thứ file tự làm, không cần bạn nhớ:

1. **Chặn nạp hai lần.** Nếu `students` đã có dữ liệu, file dừng ngay với thông
   báo rõ thay vì chồng lên thế hệ cũ.
2. **Tắt rồi bật lại bất biến tài chính.** Trong lúc nạp, biên lai và phân bổ
   luôn có cái tới trước cái tới sau, nên guard phải tắt. Hàm bật lại **tự quét
   toàn bộ** — một hàng lệch là cả transaction bị huỷ.
3. **Ép kiểm ràng buộc `DEFERRABLE` trước `COMMIT`**, để nếu hỏng thì hỏng ở chỗ
   có thông báo rõ ràng chứ không hỏng lặng lẽ.

Thời gian: ~30 giây trên VPS bình thường (29.419 câu lệnh, 16 MB).

---

## Bước 8 — Đối chiếu dữ liệu

Hai phép kiểm, chạy cả hai.

**8a. Số hàng — so với chính con số `data.sql` tự khai.** Tự cập nhật theo file,
nên đúng kể cả khi bạn sinh lại file vào ngày khác:

```bash
grep '^-- ky vong:' db/data.sql | sed 's/-- ky vong: //' | while read t _ n; do
  got=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $t")
  if [ "$got" = "$n" ]; then echo "OK   $t = $got"
  else echo "FAIL $t: co $got, ky vong $n"; fi
done | sort | grep -c '^OK' | xargs -I{} echo "{}/54 bang khop"
```

Bỏ đoạn `| sort | grep -c ...` cuối nếu muốn xem từng dòng.

**8b. Tiền và bất biến:**

```bash
psql "$DATABASE_URL" -f db/verify-data.sql
```

Mọi cột `ket_qua` phải là `OK`. Đây là con số đã đo trên bản phát lại ngày
2026-08-19:

| khoản | mong đợi |
|---|---|
| tổng đã thu (ledger) | 372.899.997 |
| tổng phân bổ biên lai | 372.899.997 |
| tổng biên lai ghi sổ | 382.790.000 |
| tổng số dư ví | 9.890.003 |
| ví âm | 0 |
| bộ đếm lớp âm | 0 |
| học sinh / lớp / kỳ | 750 / 54 / 92 |
| ghi danh / ledger / biên lai | 823 / 739 / 299 |

Nếu bạn sinh lại `data.sql` vào ngày khác thì **mục 1 và mục 2 của
`verify-data.sql` sẽ báo FAIL** — production vẫn chạy, số liệu lớn hơn. Đó không
phải lỗi nạp. Lúc đó tin **8a** cho số hàng, và tin mục 3–5 của `verify-data.sql`
(các bất biến đều so với 0 nên không hết hạn). Muốn hết FAIL thì cập nhật con số
trong `verify-data.sql` theo khối `-- ky vong:` ở cuối `data.sql`.

---

## Làm lại từ đầu

**Chưa nạp dữ liệu** — xoá sạch là an toàn:

```bash
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
psql "$DATABASE_URL" -c 'GRANT ALL ON SCHEMA public TO edutrack'
bash db/run-migrations.sh
```

**Đã nạp dữ liệu rồi** — lệnh trên xoá luôn dữ liệu. Nếu chỉ muốn nạp lại dữ liệu
mà giữ schema:

```bash
psql "$DATABASE_URL" -c 'TRUNCATE students CASCADE'   # kéo theo toàn bộ bảng con
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/data.sql
```

Chỉ làm được khi ứng dụng **chưa** ghi gì vào Postgres. Sau cutover thì đây là
lệnh xoá dữ liệu thật.

---

## Hai điều đừng làm

1. **Đừng sửa file trong `db/migrations/` sau khi nó đã chạy.** Trình chạy so
   checksum và sẽ dừng — đó là chủ ý. Cần đổi gì thì viết migration mới, không sửa file cũ.

2. **Đừng nạp `data.sql` cũ.** File mang theo ảnh chụp Firestore tại thời điểm
   sinh ra nó. Production vẫn chạy: từ 2026-08-19 tới lúc bạn cutover sẽ có thêm
   biên lai, điểm danh, log. Sinh lại file ngay trước khi nạp thật.

---

## Sau khi xong

Báo lại kết quả `verify-schema.sql` và `verify-data.sql`, rồi tiếp tục đúng các
gate materialize, parity, backup/restore và traffic trong
[`docs/runbooks/vps-postgres-cutover.md`](../docs/runbooks/vps-postgres-cutover.md).
