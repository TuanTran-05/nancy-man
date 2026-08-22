// Chay toan bo db/migrations/*.sql tren mot Postgres that (PGlite WASM)
// de bat loi cu phap / phu thuoc truoc khi dung toi VPS.
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

const dir = process.argv[2];
const db = await PGlite.create({ extensions: { btree_gist, pg_trgm, unaccent } });

const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
let failed = false;

for (const f of files) {
  const sql = readFileSync(`${dir}/${f}`, 'utf8');
  try {
    await db.exec(sql);
    console.log(`OK    ${f}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL  ${f}`);
    console.log(`      ${e.message}`);
    if (e.position) {
      const pos = Number(e.position);
      const before = sql.slice(0, pos);
      const line = before.split('\n').length;
      const ctx = sql.split('\n').slice(Math.max(0, line - 4), line + 2);
      console.log(`      tai dong ~${line}:`);
      ctx.forEach((l, i) => console.log(`        ${Math.max(1, line - 3) + i}| ${l}`));
    }
    break;
  }
}

if (!failed) {
  const counts = await db.query(`
    SELECT
      (SELECT count(*) FROM pg_tables      WHERE schemaname = 'public')                   AS tables,
      (SELECT count(*) FROM pg_views       WHERE schemaname = 'public')                   AS views,
      (SELECT count(*) FROM pg_matviews    WHERE schemaname = 'public')                   AS matviews,
      (SELECT count(*) FROM pg_indexes     WHERE schemaname = 'public')                   AS indexes,
      (SELECT count(*) FROM pg_constraint  WHERE contype = 'f')                           AS foreign_keys,
      (SELECT count(*) FROM pg_constraint  WHERE contype = 'c' AND connamespace = 'public'::regnamespace) AS checks,
      (SELECT count(*) FROM pg_constraint  WHERE contype = 'u')                           AS uniques,
      (SELECT count(*) FROM pg_constraint  WHERE contype = 'x')                           AS excludes,
      (SELECT count(*) FROM pg_trigger     WHERE NOT tgisinternal)                        AS triggers,
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'app\\_%')                          AS functions
  `);
  console.log('\nTONG KET SCHEMA');
  for (const [k, v] of Object.entries(counts.rows[0])) console.log(`  ${k.padEnd(14)} ${v}`);

  const tables = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
  );
  console.log('\nBANG (' + tables.rows.length + '):');
  console.log('  ' + tables.rows.map(r => r.tablename).join('\n  '));
}

// Dong PGlite truoc khi ket thuc. Tren Windows, ep process.exit() khi worker
// WASM van dang don dep co the lam libuv assert va bien mot lan validate xanh
// thanh exit code 1.
await db.close();
process.exitCode = failed ? 1 : 0;
