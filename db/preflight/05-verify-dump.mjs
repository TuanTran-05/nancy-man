// Phat lai file du lieu (db/data.sql) vao mot Postgres HOAN TOAN TRONG SACH da
// chay du 12 migration, roi doi chieu lai.
//
//   node 05-verify-dump.mjs ../migrations ../data.sql
//
// Muc dich: thu ban cam len VPS phai la thu da duoc chung minh chay duoc. Buoc
// nay khong doc Firestore — no chi biet den file SQL, dung nhu psql tren VPS.
// Neu buoc nay xanh ma tren VPS do, thi khac biet nam o schema tren VPS, khong
// nam o du lieu.

import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

const migrationsDir = process.argv[2];
const dumpPath = process.argv[3];
if (!migrationsDir || !dumpPath) {
  console.error('Dung: node 05-verify-dump.mjs <thu-muc-migrations> <duong-dan-data.sql>');
  process.exit(2);
}

let fails = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '   (' + detail + ')' : ''}`);
  if (!ok) fails++;
};
const vn = (x) => Number(x).toLocaleString('vi-VN');

const pg = await PGlite.create({ extensions: { btree_gist, pg_trgm, unaccent } });

console.log('1. Dung schema tu migrations');
for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(`${migrationsDir}/${f}`, 'utf8'));
}
const tbl = await pg.query(
  "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
);
console.log(`   ${tbl.rows[0].n} bang\n`);

console.log('2. Chay file du lieu (dung cach psql se chay tren VPS)');
const dump = readFileSync(dumpPath, 'utf8');
const bytes = Buffer.byteLength(dump, 'utf8');
const t0 = Date.now();
try {
  await pg.exec(dump);
} catch (e) {
  console.log(`   THAT BAI: ${String(e.message).split(/\r?\n/)[0]}`);
  console.log('\n   File nay KHONG chay duoc. Dung cam len VPS.');
  await pg.close();
  process.exit(1);
}
console.log(`   xong trong ${((Date.now() - t0) / 1000).toFixed(1)}s  (${(bytes / 1048576).toFixed(1)} MB)\n`);

// -------------------------------------------------------------- so hang
// File tu mang theo con so ky vong o cuoi (`-- ky vong: <bang> = <n>`), do
// chinh lan nap sinh ra no ghi lai. Doi chieu tung bang mot.
console.log('3. So hang tung bang so voi con so file tu khai');
const expected = [...dump.matchAll(/^-- ky vong: (\w+) = (\d+)$/gm)].map((m) => [m[1], Number(m[2])]);
check(expected.length > 0, `file co khai bao ky vong`, `${expected.length} bang`);
let rowTotal = 0;
for (const [table, want] of expected) {
  const r = await pg.query(`SELECT count(*)::int AS n FROM ${table}`);
  const got = r.rows[0].n;
  rowTotal += got;
  if (got !== want) check(false, table.padEnd(34), `co ${got}, ky vong ${want}`);
}
check(true, 'tat ca bang khop con so ky vong'.padEnd(34), `tong ${rowTotal} hang`);
console.log('');

// ------------------------------------------------------- bat bien tai chinh
// app_enable_finance_guards() da chay ben trong file. Chay lai o day de chac
// chan trang thai sau COMMIT van dung, chu khong chi dung o thoi diem nap.
console.log('4. Bat bien tai chinh (chay lai sau khi da commit)');
try {
  const r = await pg.query('SELECT * FROM app_enable_finance_guards()');
  check(true, 'moi bien lai va ledger can bang',
    `${r.rows[0].checked_receipts} bien lai, ${r.rows[0].checked_ledgers} ledger`);
} catch (e) {
  check(false, 'bat bien tai chinh', String(e.message).split(/\r?\n/)[0]);
}

const one = async (sql) => (await pg.query(sql)).rows[0];

const paid = await one('SELECT coalesce(sum(paid_total),0)::bigint AS v FROM v_ledger_totals');
const recv = await one("SELECT coalesce(sum(amount_received),0)::bigint AS v FROM receipts WHERE status='posted'");
const alloc = await one('SELECT coalesce(sum(amount),0)::bigint AS v FROM receipt_allocations');
const wal = await one('SELECT coalesce(sum(balance),0)::bigint AS v FROM v_student_wallet_balance');
const negW = await one('SELECT count(*)::int AS v FROM v_student_wallet_balance WHERE balance < 0');
const negC = await one('SELECT count(*)::int AS v FROM v_class_student_counts WHERE active < 0 OR total < 0');

console.log(`  ---   tong da thu (ledger)     ${vn(paid.v)}`);
console.log(`  ---   tong bien lai da ghi so  ${vn(recv.v)}`);
console.log(`  ---   tong phan bo bien lai    ${vn(alloc.v)}`);
console.log(`  ---   tong so du vi            ${vn(wal.v)}`);
check(Number(negW.v) === 0, 'khong co vi am', `${negW.v}`);
check(Number(negC.v) === 0, 'khong co bo dem lop am', `${negC.v}`);
console.log('');

// ------------------------------------------------------------- toan ven
// Nhung thu ma FK khong noi duoc, hoac chi dung sau khi TAT CA da vao.
console.log('5. Toan ven sau nap');
const probes = [
  ['ledger trung (student, class, term)',
    `SELECT count(*)::int AS v FROM (
       SELECT student_id, class_id, term_start FROM course_fee_ledgers
       GROUP BY 1,2,3 HAVING count(*) > 1) t`],
  ['ma hoc sinh trung',
    `SELECT count(*)::int AS v FROM (
       SELECT code_normalized FROM students WHERE code_normalized <> ''
       GROUP BY 1 HAVING count(*) > 1) t`],
  ['phan bo bien lai tro toi ledger khong ton tai',
    `SELECT count(*)::int AS v FROM receipt_allocations a
       LEFT JOIN course_fee_ledgers l ON l.id = a.ledger_id WHERE l.id IS NULL`],
  ['cau hoi co dap an dung khong nam trong phuong an',
    `SELECT count(*)::int AS v FROM assignment_questions q
       WHERE q.correct_answer IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM assignment_question_options o
         WHERE o.question_id = q.id AND o.option_key = q.correct_answer)`],
  ['ghi danh tro toi ky khong ton tai',
    `SELECT count(*)::int AS v FROM student_course_enrollments e
       WHERE NOT EXISTS (SELECT 1 FROM class_terms t
         WHERE t.class_id = e.class_id AND t.term_start = e.term_start)`],
];
for (const [label, sql] of probes) {
  const r = await one(sql);
  check(Number(r.v) === 0, label, `${r.v}`);
}

// ------------------------------------------------------------ chuan hoa
console.log('\n6. Cot sinh (normalize) — sai o day la sai vinh vien trong du lieu');
const norm = await one(`
  SELECT
    (SELECT count(*)::int FROM students WHERE name_normalized ~ '[^A-Z0-9 ]') AS con_dau,
    (SELECT count(*)::int FROM students WHERE name <> '' AND name_normalized = '') AS rong`);
check(Number(norm.con_dau) === 0, 'name_normalized khong con dau/chu thuong', `${norm.con_dau}`);
check(Number(norm.rong) === 0, 'name_normalized khong rong khi name co chu', `${norm.rong}`);

console.log(`\n${fails === 0 ? 'TAT CA QUA — file du lieu nay chay duoc va so tien can.' : `CO ${fails} MUC HONG.`}`);
await pg.close();
process.exitCode = fails === 0 ? 0 : 1;
