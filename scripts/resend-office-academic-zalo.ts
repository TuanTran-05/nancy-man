import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { FieldValue, getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import {
  isCurrentAcademicCourseRecord,
  isCurrentAcademicStudent,
  isRequiredAcademicEvaluationStudent,
  selectFinalEvaluation,
} from '../shared/academic.js';
import {
  getEvaluationRankDiscount,
  getEvaluationRankTemplateLabel,
  isRankedEvaluation,
  normalizeEvaluationRank,
} from '../shared/evaluationRank.js';
import { normalizePhoneVN } from '../shared/phone.js';
import { formatCoursePeriodForZalo, formatDateForZalo } from '../server/api/lib/zalo/zaloFormat.js';
import { getNextCourseTuitionSchedule } from '../server/api/zalo/helpers/tuitionDates.js';
import {
  assertExpectedTuitionResend,
  shouldSendTuitionNotice,
} from './resend-office-academic-zalo-policy.js';

type DocumentStoreRow = Record<string, unknown> & { id: string };
type ZaloConfig = {
  appId: string;
  appSecret: string;
  initialAccessToken: string;
  refreshToken: string;
  znsEvalTemplateId: string;
  znsNextCourseTuitionTemplateId: string;
  znsRankTemplateId: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const YES = process.argv.includes('--yes');
const CLEANUP_FAILED = process.argv.includes('--cleanup-failed');
const TUITION_ONLY = process.argv.includes('--tuition-only');
const FORCE_TUITION_RESEND = process.argv.includes('--force-tuition-resend');
const EXPECTED_TUITION = getOptionalNumberArg('--expected-tuition');
const EXPECTED_TARGET_COUNT = getOptionalNumberArg('--expected-target-count');
const CLASS_ID_QUERY = getArg('--class-id') || '';
const CLASS_QUERY = getArg('--class') || 'G9 - Mr. Anh Tuan';
const STUDENT_QUERY = getArg('--student') || '';
const EXCLUDE_STUDENT_QUERY = getArg('--exclude-student') || '';
const RESEND_BY = getArg('--by') || 'codex-resend';
const SLEEP_MS = Number(getArg('--sleep-ms') || 900);
const EVALUATION_NOTICE_LOG_TYPES = ['evaluation', 'evaluation_notice'];
const TUITION_NOTICE_LOG_TYPES = ['next_course_tuition', 'tuition_notice'];
const EVALUATION_NOTICE_LOG_TYPE = 'evaluation_notice';
const TUITION_NOTICE_LOG_TYPE = 'tuition_notice';

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).replace(/^"|"$/g, '') : undefined;
}

function getOptionalNumberArg(name: string): number | undefined {
  const raw = getArg(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function loadDotEnv() {
  const envPaths = [
    path.join(projectRoot, '.env'),
    path.join(projectRoot, '.vercel/.env.preview.local'),
  ];
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value.replace(/\\n/g, '\n');
    }
  }
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function initDb(): DocumentStore {
  loadDotEnv();
  if (getApps().length === 0) {
    const servicePath = path.join(projectRoot, 'service-account-key.json');
    if (existsSync(servicePath)) {
      initializeApp({ credential: cert(JSON.parse(readFileSync(servicePath, 'utf8'))) });
    } else {
      const projectId = mustEnv('FIREBASE_PROJECT_ID');
      const clientEmail = mustEnv('FIREBASE_CLIENT_EMAIL');
      const privateKey = mustEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    }
  }
  const firebaseConfigPath = path.join(projectRoot, 'firebase-applet-config.json');
  const firebaseConfig = existsSync(firebaseConfigPath)
    ? JSON.parse(readFileSync(firebaseConfigPath, 'utf8'))
    : {};
  const databaseId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.documentStoreDatabaseId;
  return databaseId ? getDocumentStore(getApps()[0], databaseId) : getDocumentStore(getApps()[0]);
}

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getZaloConfig(): ZaloConfig {
  return {
    appId: process.env.ZALO_APP_ID || '',
    appSecret: process.env.ZALO_APP_SECRET || '',
    initialAccessToken: process.env.ZALO_OA_ACCESS_TOKEN || '',
    refreshToken: process.env.ZALO_REFRESH_TOKEN || '',
    znsEvalTemplateId: process.env.ZALO_ZNS_EVAL_TEMPLATE_ID || '',
    znsNextCourseTuitionTemplateId: process.env.ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID || '',
    znsRankTemplateId: process.env.ZALO_ZNS_RANK_TEMPLATE_ID || '',
  };
}

async function readTokenState(db: DocumentStore) {
  const cfg = getZaloConfig();
  const snap = await db.collection('_zalo_config').doc('tokens').get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    accessToken: String(data.accessToken || cfg.initialAccessToken || ''),
    refreshToken: String(data.refreshToken || cfg.refreshToken || ''),
    expiresAt: Number(data.expiresAt || 0),
  };
}

async function refreshAccessToken(db: DocumentStore, refreshToken: string) {
  const cfg = getZaloConfig();
  if (!refreshToken || !cfg.appId || !cfg.appSecret) return null;
  const response = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      secret_key: cfg.appSecret,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      app_id: cfg.appId,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await response.json();
  if (!data?.access_token) return null;
  const tokenState = {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || refreshToken),
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  await db.collection('_zalo_config').doc('tokens').set(
    {
      accessToken: tokenState.accessToken,
      refreshToken: tokenState.refreshToken,
      expiresAt: tokenState.expiresAt,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return tokenState.accessToken;
}

async function getValidAccessToken(db: DocumentStore) {
  const tokenState = await readTokenState(db);
  if (tokenState.accessToken && tokenState.expiresAt > Date.now() + 5 * 60 * 1000) {
    return tokenState.accessToken;
  }
  const refreshed = await refreshAccessToken(db, tokenState.refreshToken);
  if (refreshed) return refreshed;
  if (!tokenState.expiresAt && tokenState.accessToken) return tokenState.accessToken;
  return null;
}

async function sendZaloZNSMessage(
  db: DocumentStore,
  templateId: string,
  templateData: Record<string, string | number>,
  phone: string,
  trackingId: string
) {
  let accessToken = await getValidAccessToken(db);
  if (!accessToken) return { success: false, error: 'Missing valid Zalo access token' };

  const makeRequest = async (token: string) => {
    const response = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: token },
      body: JSON.stringify({
        phone,
        template_id: templateId,
        template_data: templateData,
        tracking_id: trackingId,
      }),
    });
    return response.json();
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const data = await makeRequest(accessToken);
    if (data.error === 0 || data.message === 'Success') {
      return { success: true, messageId: data.data?.msg_id || String(Date.now()) };
    }

    if ((data.error === -401 || data.error === -124) && attempt === 0) {
      const tokenState = await readTokenState(db);
      const refreshed = await refreshAccessToken(db, tokenState.refreshToken);
      if (refreshed) {
        accessToken = refreshed;
        continue;
      }
    }

    return {
      success: false,
      error: `Zalo error ${data.error ?? 'unknown'}: ${data.message || ''}`.trim(),
    };
  }

  return { success: false, error: 'Zalo send retry exhausted' };
}

function docRows(snapshot: AppDocumentStore.QuerySnapshot): DocumentStoreRow[] {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function scoreFromEvaluation(evaluation: DocumentStoreRow): string {
  return String(evaluation.finalScore ?? evaluation.totalScore ?? '');
}

function selectFinalEvaluationRow(evaluations: DocumentStoreRow[]): DocumentStoreRow | null {
  return selectFinalEvaluation(
    evaluations as unknown as Parameters<typeof selectFinalEvaluation>[0]
  ) as DocumentStoreRow | null;
}

function textFromValue(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join('; ');
  return String(value || '').trim();
}

function limitText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentCourseRows(rows: DocumentStoreRow[], classData: DocumentStoreRow): DocumentStoreRow[] {
  return rows.filter((row) => isCurrentAcademicCourseRecord(row, classData));
}

function findLedgerForStudent(ledgers: DocumentStoreRow[], studentId: string, classData: DocumentStoreRow) {
  const studentLedgers = currentCourseRows(
    ledgers.filter((ledger) => ledger.studentId === studentId && ledger.classId === classData.id),
    classData
  );
  const termStart = String(classData.startDate || '');
  const termEnd = String(classData.endDate || '');
  return (
    studentLedgers.find(
      (ledger) =>
        String(ledger.termStart || '') === termStart && String(ledger.termEnd || '') === termEnd
    ) || studentLedgers[0]
  );
}

function hasSent(
  logs: DocumentStoreRow[],
  studentId: string,
  classId: string,
  types: string | string[]
): boolean {
  const typeSet = new Set(Array.isArray(types) ? types : [types]);
  return logs.some(
    (log) =>
      log.studentId === studentId &&
      log.classId === classId &&
      typeSet.has(String(log.type || '')) &&
      log.status === 'sent'
  );
}

function maskPhone(value: unknown): string {
  const phone = String(value || '');
  if (phone.length <= 4) return phone ? '***' : '';
  return `${phone.slice(0, 2)}***${phone.slice(-3)}`;
}

async function findTargetClass(db: DocumentStore) {
  const [classesSnap, usersSnap] = await Promise.all([
    db.collection('classes').get(),
    db.collection('users').where('role', '==', 'teacher').get(),
  ]);
  const teachers = new Map(
    docRows(usersSnap).map((user) => [
      user.id,
      String(user.displayName || user.name || user.email || user.id),
    ])
  );
  const classRows = docRows(classesSnap);
  const tokens = normalizeText(CLASS_QUERY).split(' ').filter(Boolean);
  const matches = CLASS_ID_QUERY
    ? classRows.filter((classRow) => classRow.id === CLASS_ID_QUERY)
    : classRows.filter((classRow) => {
        const haystack = normalizeText(
          `${classRow.name || ''} ${teachers.get(String(classRow.teacherId || '')) || ''}`
        );
        return tokens.every((token) => haystack.includes(token));
      });
  return { matches, teachers };
}

async function deleteFailedManualResendLogs(db: DocumentStore, classId: string, studentIds?: string[]) {
  const snap = await db
    .collection('zalo_notifications')
    .where('classId', '==', classId)
    .where('source', '==', 'manual_resend')
    .where('resendBy', '==', RESEND_BY)
    .where('status', '==', 'failed')
    .get();
  const docs = studentIds?.length
    ? snap.docs.filter((doc) => studentIds.includes(String((doc.data() || {}).studentId || '')))
    : snap.docs;
  if (!APPLY) return { matched: docs.length, deleted: 0 };

  let batch = db.batch();
  let writes = 0;
  let deleted = 0;
  for (const doc of docs) {
    batch.delete(doc.ref);
    writes += 1;
    deleted += 1;
    if (writes >= 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes > 0) await batch.commit();
  return { matched: docs.length, deleted };
}

async function sendEvaluation(
  db: DocumentStore,
  student: DocumentStoreRow,
  classData: DocumentStoreRow,
  evaluation: DocumentStoreRow
) {
  const cfg = getZaloConfig();
  if (!cfg.znsEvalTemplateId) throw new Error('Missing ZALO_ZNS_EVAL_TEMPLATE_ID');
  const phone = normalizePhoneVN(String(student.contact || ''));
  const courseEndDate = String(classData.endDate || '');
  const result = await sendZaloZNSMessage(
    db,
    cfg.znsEvalTemplateId,
    {
      student_name: String(student.name || ''),
      student_code: String(student.studentId || student.code || ''),
      course_end_date: courseEndDate
        ? formatDateForZalo(courseEndDate)
        : formatCoursePeriodForZalo(classData as Parameters<typeof formatCoursePeriodForZalo>[0], {
            fallbackToName: true,
          }),
      final_grade: scoreFromEvaluation(evaluation),
      good: limitText(textFromValue(evaluation.positivePoints), 200) || 'Chua co nhan xet',
      bad: limitText(textFromValue(evaluation.improvementPoints), 200) || 'Khong co',
    },
    phone,
    `edutrack_eval_resend_${student.id}_${Date.now()}`.substring(0, 48)
  );
  return { ...result, phone };
}

async function sendRank(
  db: DocumentStore,
  student: DocumentStoreRow,
  classData: DocumentStoreRow,
  evaluation: DocumentStoreRow
) {
  const cfg = getZaloConfig();
  if (!cfg.znsRankTemplateId) throw new Error('Missing ZALO_ZNS_RANK_TEMPLATE_ID');
  const rank = normalizeEvaluationRank(evaluation.rank);
  if (!isRankedEvaluation(rank)) return { success: false, skipped: true, rank };
  const phone = normalizePhoneVN(String(student.contact || ''));
  const result = await sendZaloZNSMessage(
    db,
    cfg.znsRankTemplateId,
    {
      student_name: String(student.name || ''),
      student_code: String(student.studentId || student.code || ''),
      rank: getEvaluationRankTemplateLabel(rank),
      discount: getEvaluationRankDiscount(rank),
    },
    phone,
    `edutrack_rank_resend_${student.id}_${Date.now()}`.substring(0, 48)
  );
  return { ...result, phone, rank };
}

async function sendTuition(db: DocumentStore, student: DocumentStoreRow, classData: DocumentStoreRow) {
  const cfg = getZaloConfig();
  if (!cfg.znsNextCourseTuitionTemplateId)
    throw new Error('Missing ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID');
  const phone = normalizePhoneVN(String(student.contact || ''));
  const courseEndDate = String(classData.endDate || '');
  const schedule = getNextCourseTuitionSchedule(
    courseEndDate,
    classData as Parameters<typeof getNextCourseTuitionSchedule>[1]
  );
  const amount = Number(classData.tuitionFee || 0);
  const result = await sendZaloZNSMessage(
    db,
    cfg.znsNextCourseTuitionTemplateId,
    {
      student_name: String(student.name || ''),
      student_code: String(student.studentId || student.code || ''),
      previous_end_date: schedule.previousEndDate,
      start_date: schedule.startDate,
      end_date: schedule.endDate,
      amount,
      due_date: schedule.dueDate,
    },
    phone,
    `edutrack_fee_resend_${student.id}_${Date.now()}`.substring(0, 48)
  );
  return { ...result, phone, amount, schedule };
}

async function main() {
  if (FORCE_TUITION_RESEND && !TUITION_ONLY) {
    throw new Error('--force-tuition-resend requires --tuition-only');
  }

  const db = initDb();
  const { matches, teachers } = await findTargetClass(db);
  if (matches.length !== 1) {
    console.log(
      JSON.stringify(
        {
          mode: APPLY ? 'apply' : 'dry-run',
          classQuery: CLASS_QUERY,
          classIdQuery: CLASS_ID_QUERY,
          matchedClassCount: matches.length,
          matches: matches.map((classRow) => ({
            id: classRow.id,
            name: classRow.name || '',
            teacherId: classRow.teacherId || '',
            teacherName: teachers.get(String(classRow.teacherId || '')) || '',
            status: classRow.status || '',
          })),
          error: matches.length === 0 ? 'No matching class found' : 'More than one class matched',
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  if (APPLY && !YES) {
    throw new Error('Refusing apply without --yes');
  }

  const classData = matches[0];
  const classId = String(classData.id);
  const [studentsSnap, evaluationsSnap, ledgersSnap, logsSnap] = await Promise.all([
    db.collection('students').where('classId', '==', classId).get(),
    db.collection('evaluations').where('classId', '==', classId).get(),
    db.collection('course_fee_ledgers').where('classId', '==', classId).get(),
    db.collection('zalo_notifications').where('classId', '==', classId).get(),
  ]);

  const students = docRows(studentsSnap).filter(isCurrentAcademicStudent);
  const excludeTokens = normalizeText(EXCLUDE_STUDENT_QUERY).split(' ').filter(Boolean);
  const filteredStudents = EXCLUDE_STUDENT_QUERY
    ? students.filter((student) => {
        const haystack = normalizeText(
          `${student.name || ''} ${student.studentId || ''} ${student.code || ''}`
        );
        return !excludeTokens.every((token) => haystack.includes(token));
      })
    : students;
  const targetStudents = STUDENT_QUERY
    ? filteredStudents.filter((student) => {
        const tokens = normalizeText(STUDENT_QUERY).split(' ').filter(Boolean);
        const haystack = normalizeText(
          `${student.name || ''} ${student.studentId || ''} ${student.code || ''}`
        );
        return tokens.every((token) => haystack.includes(token));
      })
    : filteredStudents;
  if (STUDENT_QUERY && targetStudents.length !== 1) {
    console.log(
      JSON.stringify(
        {
          mode: APPLY ? 'apply' : 'dry-run',
          class: {
            id: classId,
            name: classData.name || '',
          },
          studentQuery: STUDENT_QUERY,
          matchedStudentCount: targetStudents.length,
          matches: targetStudents.map((student) => ({
            id: student.id,
            name: student.name || '',
            code: student.studentId || student.code || '',
            enrollmentStatus: student.enrollmentStatus || 'active',
          })),
          error:
            targetStudents.length === 0
              ? 'No matching student found'
              : 'More than one student matched',
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }
  const cleanup = CLEANUP_FAILED
    ? await deleteFailedManualResendLogs(
        db,
        classId,
        STUDENT_QUERY ? targetStudents.map((student) => student.id) : undefined
      )
    : { matched: 0, deleted: 0 };
  const evaluations = currentCourseRows(docRows(evaluationsSnap), classData);
  const ledgers = docRows(ledgersSnap);
  const logs = currentCourseRows(docRows(logsSnap), classData);
  const evaluationsByStudent = new Map<string, DocumentStoreRow[]>();
  for (const evaluation of evaluations) {
    const studentId = String(evaluation.studentId || '');
    if (!studentId) continue;
    evaluationsByStudent.set(studentId, [
      ...(evaluationsByStudent.get(studentId) || []),
      evaluation,
    ]);
  }

  const plans = targetStudents.map((student) => {
    const finalEvaluation = selectFinalEvaluationRow(evaluationsByStudent.get(student.id) || []);
    const onLeaveMissingEvaluation =
      String(student.enrollmentStatus || 'active') === 'on_leave' && !finalEvaluation;
    const activeMissingEvaluation =
      isRequiredAcademicEvaluationStudent(student) && !finalEvaluation;
    const rank = normalizeEvaluationRank(finalEvaluation?.rank);
    const ledger = findLedgerForStudent(ledgers, student.id, classData);
    const sendable =
      Boolean(finalEvaluation) && !onLeaveMissingEvaluation && !activeMissingEvaluation;
    return {
      student,
      finalEvaluation,
      ledger,
      sendable,
      onLeaveMissingEvaluation,
      activeMissingEvaluation,
      rank,
      evaluationPreviouslySent: hasSent(logs, student.id, classId, EVALUATION_NOTICE_LOG_TYPES),
      rankPreviouslySent: hasSent(logs, student.id, classId, 'rank_achievement'),
      tuitionPreviouslySent: hasSent(logs, student.id, classId, TUITION_NOTICE_LOG_TYPES),
    };
  });

  const plansWithTuitionDecision = plans.map((plan) => ({
    ...plan,
    shouldSendTuition: shouldSendTuitionNotice({
      sendable: plan.sendable,
      tuitionPreviouslySent: plan.tuitionPreviouslySent,
      tuitionOnly: TUITION_ONLY,
      forceTuitionResend: FORCE_TUITION_RESEND,
    }),
  }));
  const tuitionTargetCount = plansWithTuitionDecision.filter(
    (plan) => plan.shouldSendTuition
  ).length;

  assertExpectedTuitionResend({
    actualTuition: Number(classData.tuitionFee || 0),
    actualTargetCount: tuitionTargetCount,
    expectedTuition: EXPECTED_TUITION,
    expectedTargetCount: EXPECTED_TARGET_COUNT,
  });

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    class: {
      id: classId,
      name: classData.name || '',
      teacherId: classData.teacherId || '',
      teacherName: teachers.get(String(classData.teacherId || '')) || '',
      startDate: classData.startDate || '',
      endDate: classData.endDate || '',
      tuitionFee: classData.tuitionFee || 0,
    },
    studentQuery: STUDENT_QUERY || null,
    excludeStudentQuery: EXCLUDE_STUDENT_QUERY || null,
    resendSafety: {
      tuitionOnly: TUITION_ONLY,
      forceTuitionResend: FORCE_TUITION_RESEND,
      expectedTuition: EXPECTED_TUITION ?? null,
      expectedTargetCount: EXPECTED_TARGET_COUNT ?? null,
    },
    counts: {
      currentStudents: students.length,
      targetStudents: targetStudents.length,
      willSendEvaluation: TUITION_ONLY ? 0 : plans.filter((plan) => plan.sendable).length,
      willSendTuition: tuitionTargetCount,
      willSendRankIfUnsent: TUITION_ONLY
        ? 0
        : plans.filter(
            (plan) => plan.sendable && isRankedEvaluation(plan.rank) && !plan.rankPreviouslySent
          ).length,
      skippedOnLeaveNoEvaluation: plans.filter((plan) => plan.onLeaveMissingEvaluation).length,
      skippedActiveMissingEvaluation: plans.filter((plan) => plan.activeMissingEvaluation).length,
      evaluationPreviouslySent: plans.filter((plan) => plan.evaluationPreviouslySent).length,
      tuitionPreviouslySent: plans.filter((plan) => plan.tuitionPreviouslySent).length,
    },
    cleanupFailedManualResendLogs: cleanup,
    students: plansWithTuitionDecision.map((plan) => ({
      id: plan.student.id,
      name: plan.student.name || '',
      code: plan.student.studentId || plan.student.code || '',
      phone: maskPhone(normalizePhoneVN(String(plan.student.contact || ''))),
      enrollmentStatus: plan.student.enrollmentStatus || 'active',
      hasFinalEvaluation: Boolean(plan.finalEvaluation),
      rank: plan.rank,
      actions: plan.sendable
        ? TUITION_ONLY
          ? plan.shouldSendTuition
            ? ['tuition']
            : []
          : [
              'evaluation',
              ...(isRankedEvaluation(plan.rank) && !plan.rankPreviouslySent ? ['rank'] : []),
              ...(plan.shouldSendTuition ? ['tuition'] : []),
            ]
        : [],
      skipReason: plan.onLeaveMissingEvaluation
        ? 'on_leave_without_final_evaluation'
        : plan.activeMissingEvaluation
          ? 'active_without_final_evaluation'
          : '',
      previousSent: {
        evaluation: plan.evaluationPreviouslySent,
        rank: plan.rankPreviouslySent,
        tuition: plan.tuitionPreviouslySent,
      },
      ledger: plan.ledger
        ? {
            id: plan.ledger.id,
            tuitionNoticeCount: Number(plan.ledger.tuitionNoticeCount || 0),
            tuitionNoticeLastSentAt: plan.ledger.tuitionNoticeLastSentAt || '',
          }
        : null,
    })),
  };

  if (!APPLY) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const tokenState = await readTokenState(db);
  const freshAccessToken = await refreshAccessToken(db, tokenState.refreshToken);
  if (!freshAccessToken) {
    throw new Error('Unable to refresh Zalo access token; aborting before sending.');
  }

  const results = [];
  for (const plan of plansWithTuitionDecision) {
    const student = plan.student;
    const resultRow: Record<string, unknown> = {
      id: student.id,
      name: student.name || '',
      evaluation: 'skipped',
      rank: 'skipped',
      tuition: 'skipped',
    };

    if (!plan.sendable || !plan.finalEvaluation) {
      resultRow.skipReason = plan.onLeaveMissingEvaluation
        ? 'on_leave_without_final_evaluation'
        : 'missing_final_evaluation';
      results.push(resultRow);
      continue;
    }

    if (!TUITION_ONLY) {
      const evaluationResult = await sendEvaluation(db, student, classData, plan.finalEvaluation);
      resultRow.evaluation = evaluationResult.success ? 'sent' : 'failed';
      resultRow.evaluationError = evaluationResult.error || '';
      await db.collection('zalo_notifications').add({
        studentId: student.id,
        studentName: String(student.name || ''),
        classId,
        className: String(classData.name || ''),
        teacherId: String(classData.teacherId || student.teacherId || ''),
        phone: evaluationResult.phone,
        templateId: getZaloConfig().znsEvalTemplateId,
        status: evaluationResult.success ? 'sent' : 'failed',
        zaloMessageId: evaluationResult.messageId || '',
        errorMessage: evaluationResult.error || '',
        date: String(classData.endDate || new Date().toISOString().slice(0, 10)),
        type: EVALUATION_NOTICE_LOG_TYPE,
        source: 'manual_resend',
        resendBy: RESEND_BY,
        createdAt: new Date().toISOString(),
      });

      if (evaluationResult.success && isRankedEvaluation(plan.rank) && !plan.rankPreviouslySent) {
        await sleep(SLEEP_MS);
        const rankResult = await sendRank(db, student, classData, plan.finalEvaluation);
        resultRow.rank = rankResult.success ? 'sent' : 'failed';
        resultRow.rankError = 'error' in rankResult ? rankResult.error || '' : '';
        await db.collection('zalo_notifications').add({
          studentId: student.id,
          studentName: String(student.name || ''),
          classId,
          className: String(classData.name || ''),
          teacherId: String(classData.teacherId || student.teacherId || ''),
          phone:
            'phone' in rankResult
              ? rankResult.phone
              : normalizePhoneVN(String(student.contact || '')),
          templateId: getZaloConfig().znsRankTemplateId,
          status: rankResult.success ? 'sent' : 'failed',
          zaloMessageId: 'messageId' in rankResult ? rankResult.messageId || '' : '',
          errorMessage: 'error' in rankResult ? rankResult.error || '' : '',
          date: String(classData.endDate || new Date().toISOString().slice(0, 10)),
          type: 'rank_achievement',
          rank: plan.rank,
          discount: getEvaluationRankDiscount(plan.rank),
          source: 'manual_resend',
          resendBy: RESEND_BY,
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      resultRow.evaluation = 'skipped_tuition_only';
    }

    if (!plan.shouldSendTuition) {
      resultRow.tuition = plan.tuitionPreviouslySent
        ? 'skipped_already_sent'
        : 'skipped_not_selected';
      results.push(resultRow);
      continue;
    }
    if (!TUITION_ONLY && resultRow.evaluation !== 'sent' && !plan.evaluationPreviouslySent) {
      resultRow.tuition = 'skipped_evaluation_not_sent';
      results.push(resultRow);
      continue;
    }

    await sleep(SLEEP_MS);
    const tuitionResult = await sendTuition(db, student, classData);
    resultRow.tuition = tuitionResult.success ? 'sent' : 'failed';
    resultRow.tuitionError = tuitionResult.error || '';
    await db.collection('zalo_notifications').add({
      studentId: student.id,
      studentName: String(student.name || ''),
      classId,
      className: String(classData.name || ''),
      teacherId: String(classData.teacherId || student.teacherId || ''),
      phone: tuitionResult.phone,
      templateId: getZaloConfig().znsNextCourseTuitionTemplateId,
      status: tuitionResult.success ? 'sent' : 'failed',
      zaloMessageId: tuitionResult.messageId || '',
      errorMessage: tuitionResult.error || '',
      date: tuitionResult.schedule.dueDate,
      courseEndDate: tuitionResult.schedule.previousEndDate,
      nextCourseStartDate: tuitionResult.schedule.startDate,
      nextCourseEndDate: tuitionResult.schedule.endDate,
      type: TUITION_NOTICE_LOG_TYPE,
      amount: tuitionResult.amount,
      source: 'manual_resend',
      resendBy: RESEND_BY,
      createdAt: new Date().toISOString(),
    });

    if (tuitionResult.success && plan.ledger) {
      await db
        .collection('course_fee_ledgers')
        .doc(plan.ledger.id)
        .update({
          tuitionNoticeCount: FieldValue.increment(1),
          tuitionNoticeLastSentAt: new Date().toISOString(),
          tuitionNoticeLastSentBy: RESEND_BY,
          tuitionNoticeLastSentByName: RESEND_BY,
          tuitionNoticeLastSource: 'office',
          tuitionNoticeLastMessageId: tuitionResult.messageId || '',
          tuitionNoticeLastAmount: tuitionResult.amount,
          tuitionNoticeLastDueDate: tuitionResult.schedule.dueDate,
          updatedAt: new Date().toISOString(),
        });
    }

    results.push(resultRow);
    await sleep(SLEEP_MS);
  }

  console.log(JSON.stringify({ ...summary, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
