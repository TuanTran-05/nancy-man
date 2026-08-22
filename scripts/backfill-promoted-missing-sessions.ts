import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import { isScheduledClassDate } from '../shared/classSchedule.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Sessions that were marked on a source class after its cohort had already moved on.
 * The promotion cutoff correctly stops paying the source class from that date, but the
 * new class never got a matching session, so the teacher would lose pay for days he
 * actually taught. This recreates those sessions on the class that now owns them.
 *
 * Each entry is only written after checking the day really was a scheduled class date
 * and that the source class holds marked-present evidence for it.
 */
const MISSING_SESSIONS: Array<{
  classId: string;
  expectedClassName: string;
  sourceClassId: string;
  dates: string[];
}> = [
  {
    classId: 'sFc2NhcpwbmdudLCPpIp',
    expectedClassName: 'G1 - Mr.Minh T7-CN 17H30',
    sourceClassId: 'waoUqyi2aZ00NKgIcbIf',
    dates: ['2026-07-11', '2026-07-19'],
  },
];

export type MissingSessionSummary = {
  mode: 'dry-run' | 'apply';
  wouldCreate: number;
  created: number;
  alreadyPresent: number;
  notScheduled: number;
  noEvidence: number;
};

export async function backfillPromotedMissingSessions({
  db,
  apply,
  log = console.log,
}: {
  db: Pick<DocumentStore, 'collection'>;
  apply: boolean;
  log?: (message: string) => void;
}): Promise<MissingSessionSummary> {
  const summary: MissingSessionSummary = {
    mode: apply ? 'apply' : 'dry-run',
    wouldCreate: 0,
    created: 0,
    alreadyPresent: 0,
    notScheduled: 0,
    noEvidence: 0,
  };

  for (const entry of MISSING_SESSIONS) {
    const classSnap = await db.collection('classes').doc(entry.classId).get();
    if (!classSnap.exists) {
      log(`[skip] lớp ${entry.classId} không tồn tại`);
      continue;
    }
    const classData = classSnap.data() || {};
    if (String(classData.name || '') !== entry.expectedClassName) {
      log(`[STOP] tên lớp đã đổi — mong đợi "${entry.expectedClassName}", thực tế "${classData.name}"`);
      continue;
    }

    const teacherId = String(classData.teacherId || '');
    const salaryPerSession = Number(classData.salaryPerSession || 0);

    for (const date of entry.dates) {
      const sessionId = `${entry.classId}_${date}`;
      const existing = await db.collection('class_sessions').doc(sessionId).get();
      if (existing.exists) {
        summary.alreadyPresent += 1;
        log(`[ok] ${sessionId} đã có`);
        continue;
      }

      // The day must genuinely fall on the new class's schedule.
      const scheduled = isScheduledClassDate(
        {
          startDate: String(classData.startDate || ''),
          endDate: String(classData.endDate || ''),
          daysOfWeek: Array.isArray(classData.daysOfWeek) ? (classData.daysOfWeek as number[]) : [],
          weeklySessions: Array.isArray(classData.weeklySessions)
            ? (classData.weeklySessions as never[])
            : undefined,
        },
        date
      );
      if (!scheduled) {
        summary.notScheduled += 1;
        log(`[STOP] ${date} không phải ngày học theo lịch của ${classData.name}`);
        continue;
      }

      // The source class must show the teacher was marked present that day.
      const sourceSession = await db
        .collection('class_sessions')
        .doc(`${entry.sourceClassId}_${date}`)
        .get();
      const sourceStatus = String(sourceSession.data()?.teacherAttendanceStatus || '');
      if (!['present', 'absent'].includes(sourceStatus)) {
        summary.noEvidence += 1;
        log(`[STOP] ${date} lớp nguồn không có bằng chứng đã chấm công`);
        continue;
      }

      summary.wouldCreate += 1;
      log(
        `[fix] tạo ${sessionId} — ${sourceStatus}, ${salaryPerSession.toLocaleString('vi-VN')} đ ` +
          `(bằng chứng: ${entry.sourceClassId}_${date})`
      );

      if (apply) {
        const now = new Date().toISOString();
        await db.collection('class_sessions').doc(sessionId).set({
          classId: entry.classId,
          date,
          teacherId,
          salaryPerSession,
          status: 'taught',
          teacherAttendanceStatus: sourceStatus,
          teacherAttendanceNote:
            'Chuyển từ lớp cũ khi lên lớp: buổi đã dạy nhưng bị chấm nhầm ở lớp nguồn.',
          teacherAttendanceSource: 'promotion_backfill',
          teacherAttendanceMarkedBy: 'system:backfill-promoted-missing-sessions',
          teacherAttendanceMarkedByRole: 'admin',
          teacherAttendanceMarkedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        summary.created += 1;
      }
    }
  }

  log(JSON.stringify(summary, null, 2));
  return summary;
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
  await backfillPromotedMissingSessions({
    db: getDocumentStore(initFirebase(), requiredEnv('FIRESTORE_DATABASE_ID')),
    apply: process.argv.includes('--apply'),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
