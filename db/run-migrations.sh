#!/usr/bin/env bash
#
# Chay cac file db/migrations/*.sql theo thu tu, mot lan duy nhat moi file.
#
#   ./db/run-migrations.sh                 # chay nhung file chua chay
#   ./db/run-migrations.sh --dry-run       # chi liet ke se chay gi
#   ./db/run-migrations.sh --status        # xem file nao da chay
#
# Bien moi truong:
#   DATABASE_URL   postgres://user:pass@host:5432/dbname   (bat buoc)
#
# Moi file chay trong MOT transaction cua rieng no (chinh file .sql da co
# BEGIN/COMMIT). psql chay voi ON_ERROR_STOP=1 nen loi la dung han, khong chay
# tiep file sau.
#
# --------------------------------------------------------------------------
# Cach truyen gia tri vao SQL, va hai cach da THAT BAI truoc do:
#
#   1. $$...$$  (dollar-quoting cua SQL) trong chuoi nhay kep cua bash
#      -> bash an mat $$ thanh so hieu tien trinh, sinh ra SQL rac kieu
#         "WHERE filename = 520400001_extensions".
#
#   2. :'ten'   (bien cua psql) kem -v ten=gia-tri
#      -> psql KHONG thay bien trong chuoi cua -c. No chi thay khi doc tu file
#         (-f) hoac tu stdin. Server nhan nguyen van :'ten' va bao
#         "syntax error at or near :".
#
# Cach dung o day khong phu thuoc vao hanh vi nao cua psql: ham sql_lit() nhan
# doi dau nhay don roi boc lai, dung nhu quote_literal() cua Postgres. Postgres
# 9.1 tro len mac dinh standard_conforming_strings=on nen dau gach cheo nguoc la
# ky tu thuong, khong can xu ly them.
# --------------------------------------------------------------------------

set -Eeuo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/migrations"
MODE="apply"

for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --status)  MODE="status" ;;
    *) echo "Tham so khong hieu: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Thieu DATABASE_URL." >&2
  echo "Vi du: export DATABASE_URL='postgres://edutrack:...@localhost:5432/edutrack'" >&2
  exit 2
fi

# Chuoi bash -> literal SQL an toan.
sql_lit() { local s=${1//\'/\'\'}; printf "'%s'" "$s"; }

psql_q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX -c "$1"; }

# So theo doi phai ton tai truoc khi hoi no da chay gi, tuc truoc ca 0001. File
# 0009 cung tao bang nay (de mot lan `psql -f` tung file van dung schema), nhung
# o do la CREATE TABLE IF NOT EXISTS. Dinh nghia hai noi PHAI giong het nhau —
# neu lech, ai chay truoc se quyet dinh hinh dang cuoi cung.
psql_q "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename     TEXT PRIMARY KEY,
    checksum     TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    error        TEXT
  );" >/dev/null

if [[ "$MODE" == "status" ]]; then
  printf '%-34s %-9s %s\n' FILE STATUS "CHAY LUC"
  psql "$DATABASE_URL" -qtAX -F'|' -c \
    "SELECT filename, status, coalesce(finished_at::text,'-') FROM schema_migrations ORDER BY filename" \
    | while IFS='|' read -r f s t; do printf '%-34s %-9s %s\n' "$f" "$s" "$t"; done
  exit 0
fi

shopt -s nullglob
FILES=("$MIGRATIONS_DIR"/*.sql)
if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Khong tim thay file .sql nao trong $MIGRATIONS_DIR" >&2
  exit 1
fi

applied=0
skipped=0

for path in "${FILES[@]}"; do
  file="$(basename "$path")"
  checksum="$(sha256sum "$path" | cut -d' ' -f1)"
  q_file="$(sql_lit "$file")"
  q_sum="$(sql_lit "$checksum")"

  recorded="$(psql_q "SELECT checksum || ':' || status FROM schema_migrations WHERE filename = $q_file" || true)"

  if [[ -n "$recorded" ]]; then
    rec_sum="${recorded%%:*}"
    rec_status="${recorded##*:}"
    if [[ "$rec_status" == "success" ]]; then
      if [[ "$rec_sum" != "$checksum" ]]; then
        echo "DUNG: $file da chay nhung noi dung da bi sua sau do." >&2
        echo "      Da chay: $rec_sum" >&2
        echo "      Hien co: $checksum" >&2
        echo "      Sua migration da chay la cach chac chan nhat de hai moi truong lech nhau." >&2
        echo "      Viet mot file moi thay vi sua file cu." >&2
        exit 1
      fi
      skipped=$((skipped + 1))
      continue
    fi
    echo "CANH BAO: $file lan truoc ket thuc o trang thai '$rec_status'. Chay lai." >&2
  fi

  if [[ "$MODE" == "dry-run" ]]; then
    echo "se chay  $file"
    applied=$((applied + 1))
    continue
  fi

  echo "chay     $file"
  psql_q "
    INSERT INTO schema_migrations (filename, checksum, status)
    VALUES ($q_file, $q_sum, 'running')
    ON CONFLICT (filename) DO UPDATE
      SET checksum = EXCLUDED.checksum, status = 'running',
          started_at = now(), finished_at = NULL, error = NULL" >/dev/null

  if err="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qX -f "$path" 2>&1)"; then
    psql_q "
      UPDATE schema_migrations
         SET status = 'success', finished_at = now()
       WHERE filename = $q_file" >/dev/null
    applied=$((applied + 1))
  else
    psql_q "
      UPDATE schema_migrations
         SET status = 'failed', finished_at = now(), error = $(sql_lit "$err")
       WHERE filename = $q_file" >/dev/null || true
    echo "LOI trong $file:" >&2
    echo "$err" >&2
    exit 1
  fi
done

if [[ "$MODE" == "dry-run" ]]; then
  echo "(dry-run) $applied file se chay, $skipped file bo qua."
else
  echo "Xong: $applied file da chay, $skipped file bo qua."
fi
