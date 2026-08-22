// Sinh ban va user_name cho audit_logs DA NAP tu mot db/data.sql cu.
// Chi doc Firestore va chi sinh UPDATE cho dung cac id co trong data.sql.
//
//   node 06-emit-audit-user-name-backfill.mjs <repo> <database-id> [data.sql] [output.sql]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { literal } from './lib/sql-emit.mjs';

const [
  repoArg,
  databaseId,
  dataArg = '../data.sql',
  outputArg = '../audit-log-user-name-backfill.sql',
] = process.argv.slice(2);
if (!repoArg || !databaseId) {
  throw new Error(
    'Cach dung: node 06-emit-audit-user-name-backfill.mjs <repo> <database-id> [data.sql] [output.sql]'
  );
}

const repo = resolve(repoArg);
const serviceAccount = JSON.parse(readFileSync(resolve(repo, 'service-account-key.json'), 'utf8'));
const dataSql = readFileSync(resolve(dataArg), 'utf8');
const snapshotIds = new Set(
  [...dataSql.matchAll(/^INSERT INTO audit_logs .*? VALUES \('([^']+)'/gm)].map((match) => match[1])
);
if (snapshotIds.size === 0) throw new Error('Khong tim thay audit_logs trong data.sql');

const app = initializeApp(
  { credential: cert(serviceAccount) },
  `audit-user-name-backfill-${Date.now()}`
);

try {
  const firestore = getFirestore(app, databaseId);
  const snapshot = await firestore.collection('audit_logs').select('userName').get();
  const names = new Map();
  for (const document of snapshot.docs) {
    if (!snapshotIds.has(document.id)) continue;
    const value = document.data().userName;
    names.set(document.id, typeof value === 'string' && value.trim() ? value : null);
  }

  const missingIds = [...snapshotIds].filter((id) => !names.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Firestore thieu ${missingIds.length} audit id cua data.sql; dung, khong sinh backfill`
    );
  }

  const nonNullNames = [...names.values()].filter((value) => value !== null).length;
  const lines = [
    '-- audit-log-user-name-backfill.sql',
    '-- Chua ten nguoi dung that. Khong commit hoac gui cong khai.',
    'BEGIN;',
    `DO $guard$ BEGIN IF (SELECT count(*) FROM audit_logs) <> ${snapshotIds.size} THEN`,
    `  RAISE EXCEPTION 'audit_logs khong con dung ${snapshotIds.size} hang; dung backfill';`,
    'END IF; END $guard$;',
  ];
  for (const id of [...snapshotIds].sort()) {
    lines.push(
      `UPDATE audit_logs SET user_name = ${literal(names.get(id))} WHERE id = ${literal(id)};`
    );
  }
  lines.push(
    `DO $guard$ BEGIN IF (SELECT count(*) FROM audit_logs WHERE user_name IS NOT NULL) <> ${nonNullNames} THEN`,
    `  RAISE EXCEPTION 'user_name khac con so ky vong ${nonNullNames}';`,
    'END IF; END $guard$;',
    'COMMIT;',
    ''
  );
  writeFileSync(resolve(outputArg), lines.join('\n'), 'utf8');
  console.log(
    `DA XUAT ${outputArg}: ${snapshotIds.size} audit logs, ${nonNullNames} user_name co gia tri`
  );
} finally {
  await deleteApp(app);
}
