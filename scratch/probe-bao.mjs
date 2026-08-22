/** READ-ONLY probe: find every record matching a student name fragment. */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDocumentStore } from 'firebase-admin/documentStore';

const projectRoot = 'C:/Users/ASUS/Downloads/edutrack-smart-tracking-app (6)';
const NEEDLE = (process.argv[2] || 'BAO').toUpperCase();

function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .trim();
}

if (!getApps().length) {
  const p = path.join(projectRoot, 'service-account-key.json');
  if (!existsSync(p)) throw new Error('no service-account-key.json');
  initializeApp({ credential: cert(JSON.parse(readFileSync(p, 'utf8'))) });
}
const DB_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  JSON.parse(readFileSync(path.join(projectRoot, 'firebase.json'), 'utf8')).documentStore[0].database;
const db = getDocumentStore(getApps()[0], DB_ID);
console.log('database:', DB_ID);

const COLLECTIONS = ['students', 'users', 'student_profiles', 'studentProfiles'];

for (const col of COLLECTIONS) {
  let snap;
  try {
    snap = await db.collection(col).get();
  } catch (e) {
    console.log(`\n### ${col}: ERROR ${e.message}`);
    continue;
  }
  if (snap.empty) {
    console.log(`\n### ${col}: (empty or missing)`);
    continue;
  }
  const hits = [];
  snap.forEach((d) => {
    const v = d.data();
    const blob = norm(
      [v.name, v.fullName, v.displayName, v.studentName, v.searchName].filter(Boolean).join(' ')
    );
    if (blob.includes(NEEDLE)) hits.push({ id: d.id, ...v });
  });
  console.log(`\n### ${col}: ${snap.size} docs, ${hits.length} match "${NEEDLE}"`);
  for (const h of hits) {
    console.log('---');
    console.log(
      JSON.stringify(
        {
          docId: h.id,
          id: h.id,
          studentId: h.studentId,
          studentCode: h.studentCode,
          code: h.code,
          name: h.name ?? h.fullName ?? h.displayName,
          role: h.role,
          status: h.status,
          isActive: h.isActive,
          deleted: h.deleted ?? h.isDeleted,
          classId: h.classId,
          classIds: h.classIds,
          canonicalStudentId: h.canonicalStudentId,
          mergedInto: h.mergedInto,
          retiredAt: h.retiredAt,
          uid: h.uid,
          createdAt: String(h.createdAt?.toDate?.() ?? h.createdAt ?? ''),
          updatedAt: String(h.updatedAt?.toDate?.() ?? h.updatedAt ?? ''),
        },
        null,
        2
      )
    );
  }
}
process.exit(0);
