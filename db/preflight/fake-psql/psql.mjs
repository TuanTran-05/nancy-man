// `psql` gia, chay tren PGlite voi mot thu muc du lieu ben vung.
//
// Ly do ton tai: may dev khong co psql lan docker, nen run-migrations.sh chua tung
// duoc chay thu — va no da hong tren VPS o dung phan keo dan giua bash va SQL.
//
//   PATH="$PWD/db/preflight/fake-psql:$PATH" \
//   FAKE_PG_DATA=/tmp/pg \
//   DATABASE_URL=postgres://x bash db/run-migrations.sh
//
// KHONG phai ban thay the psql. No chi hieu nhung co ma run-migrations.sh va cac
// file verify-*.sql dung toi: -c, -f, -v, -q, -t, -A, -X, -F.
//
// QUAN TRONG — mot khac biet da tung lam bai kiem noi doi:
//   psql THAT khong thay bien (:'ten') trong chuoi cua -c. No chi thay khi doc tu
//   file (-f) hoac tu stdin. Ban dau file nay thay ca trong -c, nen script bao
//   xanh o day nhung do tren VPS voi "syntax error at or near :".
//   Gio no bat chuoc dung: -c gui nguyen van cho server.

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

const argv = process.argv.slice(2);
const vars = new Map();
const steps = [];
let fieldSep = '|';

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-c' || a === '--command') { steps.push(['cmd', argv[++i]]); continue; }
  if (a === '-f' || a === '--file') { steps.push(['file', argv[++i]]); continue; }
  if (a === '-v' || a === '--set') {
    const kv = argv[++i];
    const eq = kv.indexOf('=');
    vars.set(eq < 0 ? kv : kv.slice(0, eq), eq < 0 ? '' : kv.slice(eq + 1));
    continue;
  }
  if (a.startsWith('-F')) { fieldSep = a.length > 2 ? a.slice(2) : argv[++i]; continue; }
  if (a.startsWith('--')) continue;
  if (a.startsWith('-') && a.length > 1) continue;   // q, t, A, X: khong doi gi o day
  // con lai la chuoi ket noi — bo qua, PGlite khong dung toi
}

// Tham chieu bien cua psql. Chi ap dung cho -f va stdin, dung nhu psql that.
const quoteLit = (s) => `'${String(s).split("'").join("''")}'`;
function interpolate(sql) {
  let out = sql.replace(/:'([A-Za-z_][A-Za-z0-9_]*)'/g,
    (m, n) => (vars.has(n) ? quoteLit(vars.get(n)) : m));
  out = out.replace(/:"([A-Za-z_][A-Za-z0-9_]*)"/g,
    (m, n) => (vars.has(n) ? `"${String(vars.get(n)).split('"').join('""')}"` : m));
  out = out.replace(/(^|[^:]):([A-Za-z_][A-Za-z0-9_]*)/g,
    (m, pre, n) => (vars.has(n) ? pre + vars.get(n) : m));
  return out;
}

// Khong co -c lan -f: psql doc stdin. Co thay bien.
if (steps.length === 0) {
  const stdin = readFileSync(0, 'utf8');
  if (stdin.trim()) steps.push(['stdin', stdin]);
}

const dataDir = process.env.FAKE_PG_DATA;
if (!dataDir) { console.error('fake psql: can FAKE_PG_DATA'); process.exit(2); }

const pg = await PGlite.create({ dataDir, extensions: { btree_gist, pg_trgm, unaccent } });

const render = (res) => {
  if (!res || !res.rows || res.rows.length === 0) return;
  const names = res.fields?.length ? res.fields.map((f) => f.name) : Object.keys(res.rows[0]);
  for (const row of res.rows) {
    console.log(names.map((n) => (row[n] === null || row[n] === undefined ? '' : String(row[n]))).join(fieldSep));
  }
};

const BACKSLASH = String.fromCharCode(92);

try {
  for (const [kind, val] of steps) {
    const rawSql = kind === 'file' ? readFileSync(val, 'utf8') : val;
    // -c di thang toi server, khong thay bien. -f va stdin thi co.
    const sql = kind === 'cmd' ? rawSql : interpolate(rawSql);
    // Meta-command cua psql bat dau bang dau gach cheo nguoc; PGlite khong hieu.
    // Cac file verify-*.sql co \echo va \pset — bo dong do, phan SQL giu nguyen.
    const cleaned = sql.split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith(BACKSLASH))
      .join('\n');
    for (const res of await pg.exec(cleaned)) render(res);
  }
} catch (e) {
  console.error(`ERROR:  ${String(e.message).split(/\r?\n/)[0]}`);
  await pg.close();
  process.exit(3);          // psql tra 3 khi loi SQL voi ON_ERROR_STOP
}

await pg.close();
process.exit(0);
