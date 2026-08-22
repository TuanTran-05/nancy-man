import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Classes created through "lên lớp" copied their roster from a source class, but the
 * link was never persisted (see classCrudHandlers). This reconstructs it from the
 * roster overlap so payroll can stop counting the source class from the promotion date.
 *
 * Report only: it never writes. Review the mapping before backfilling anything.
 */
type PromotionCandidate = {
  newClassId: string;
  newClassName: string;
  createdAt: string;
  importedCount: number;
};

function ts(value: unknown): string {
  const date = (value as { toDate?: () => Date })?.toDate?.();
  return date ? date.toISOString() : String(value ?? '');
}

function money(value: number): string {
  return value.toLocaleString('vi-VN') + ' đ';
}

export async function reportClassPromotionLinks({
  db,
  log = console.log,
}: {
  db: Pick<DocumentStore, 'collection'>;
  log?: (message: string) => void;
}) {
  const [classesSnap, studentsSnap, auditSnap, teachersSnap] = await Promise.all([
    db.collection('classes').get(),
    db.collection('students').get(),
    db.collection('audit_logs').where('collection', '==', 'classes').where('action', '==', 'create').get(),
    db.collection('users').where('role', '==', 'teacher').get(),
  ]);

  const teacherName = new Map(
    teachersSnap.docs.map((d) => [d.id, String(d.data().displayName || d.id)])
  );
  const classById = new Map(classesSnap.docs.map((d) => [d.id, d]));

  const rosterByClass = new Map<string, Set<string>>();
  for (const doc of studentsSnap.docs) {
    const data = doc.data() || {};
    const classId = String(data.classId || '');
    const studentId = String(data.studentId || '');
    if (!classId || !studentId) continue;
    if (!rosterByClass.has(classId)) rosterByClass.set(classId, new Set());
    rosterByClass.get(classId)!.add(studentId);
  }

  const candidates: PromotionCandidate[] = auditSnap.docs
    .map((doc) => doc.data() || {})
    .filter((entry) => Number((entry.metadata as Record<string, unknown>)?.importedCount || 0) > 0)
    .map((entry) => ({
      newClassId: String(entry.documentId || ''),
      newClassName: String((entry.metadata as Record<string, unknown>)?.className || ''),
      createdAt: String(entry.timestamp || ''),
      importedCount: Number((entry.metadata as Record<string, unknown>)?.importedCount || 0),
    }))
    .filter((entry) => classById.has(entry.newClassId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  log(`Tìm thấy ${candidates.length} lớp được tạo bằng cơ chế lên lớp.\n`);

  for (const candidate of candidates) {
    const newRoster = rosterByClass.get(candidate.newClassId) || new Set<string>();
    let best: { classId: string; overlap: number } | null = null;

    for (const [classId, roster] of rosterByClass) {
      if (classId === candidate.newClassId) continue;
      const created = ts(classById.get(classId)?.data()?.createdAt);
      if (created && created > candidate.createdAt) continue;
      let overlap = 0;
      for (const studentId of roster) if (newRoster.has(studentId)) overlap += 1;
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { classId, overlap };
    }

    const newData = classById.get(candidate.newClassId)?.data() || {};
    log(`LỚP MỚI  ${candidate.newClassName} (${candidate.newClassId})`);
    log(`         tạo lúc ${candidate.createdAt} — import ${candidate.importedCount} học sinh`);

    if (!best) {
      log('  => KHÔNG suy ra được lớp nguồn (roster không giao nhau)\n');
      continue;
    }

    const sourceDoc = classById.get(best.classId);
    const sourceData = sourceDoc?.data() || {};
    const cutoff = candidate.createdAt.slice(0, 10);
    log(`LỚP NGUỒN ${sourceData.name} (${best.classId})`);
    log(
      `         GV=${teacherName.get(String(sourceData.teacherId)) || sourceData.teacherId} | ` +
        `status=${sourceData.status} | trùng ${best.overlap}/${newRoster.size} học sinh`
    );

    const sessionsSnap = await db
      .collection('class_sessions')
      .where('classId', '==', best.classId)
      .get();
    const rate = Number(sourceData.salaryPerSession || 0);
    const paidAfter = sessionsSnap.docs
      .map((d) => d.data() || {})
      .filter(
        (s) =>
          String(s.date || '') >= cutoff &&
          ['present', 'absent'].includes(String(s.teacherAttendanceStatus))
      )
      .map((s) => String(s.date))
      .sort();

    log(`         MỐC CẮT = ${cutoff}`);
    if (paidAfter.length === 0) {
      log('         Không có buổi nào đã chấm công từ mốc cắt — không ảnh hưởng lương.\n');
    } else {
      log(
        `         ${paidAfter.length} buổi đã chấm công TỪ mốc cắt sẽ bị bỏ: ${paidAfter.join(', ')}`
      );
      log(`         Giảm lương lớp nguồn: ${paidAfter.length} x ${money(rate)} = ${money(paidAfter.length * rate)}\n`);
    }

    // Days that would end up unpaid on both sides, so office can add the missing session.
    const newSessionsSnap = await db
      .collection('class_sessions')
      .where('classId', '==', candidate.newClassId)
      .get();
    const newDates = new Set(newSessionsSnap.docs.map((d) => String(d.data()?.date || '')));
    const orphaned = paidAfter.filter((date) => !newDates.has(date));
    if (orphaned.length > 0) {
      log(`         !! ${orphaned.length} ngày sẽ mất công ở CẢ HAI lớp: ${orphaned.join(', ')}`);
      log('            (lớp mới chưa có buổi tương ứng — cần kiểm tra)\n');
    }
  }
}

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function initFirebase(): App {
  if (getApps().length) return getApps()[0];
  const servicePath = path.join(projectRoot, 'service-account-key.json');
  if (existsSync(servicePath)) {
    return initializeApp({ credential: cert(JSON.parse(readFileSync(servicePath, 'utf8'))) });
  }
  return initializeApp({
    credential: cert({
      projectId: requiredEnv('FIREBASE_PROJECT_ID'),
      clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: requiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  });
}

async function main() {
  loadLocalEnv();
  await reportClassPromotionLinks({
    db: getDocumentStore(initFirebase(), requiredEnv('FIRESTORE_DATABASE_ID')),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
