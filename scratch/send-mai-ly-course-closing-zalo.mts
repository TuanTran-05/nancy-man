/**
 * One-off, idempotent real Zalo delivery for Mai Ly's three course-closing notices.
 * Replaces the synthetic message IDs created by repair-mai-ly-course-closing.mts.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import {
  computeCourseClosingComputation,
  evaluationVersion,
  type CourseClosingSendContext,
} from '../server/api/classes/helpers/courseClosing.js';
import {
  buildCanonicalEvaluationNotification,
  buildCanonicalRankNotification,
  buildCanonicalTuitionNoticeBody,
  recipientFromCourseClosingContext,
} from '../server/api/zalo/helpers/courseClosingNotificationPayloads.js';
import { createZaloPayloadSnapshot } from '../server/api/zalo/helpers/zaloTemplatePolicy.js';
import { getNextCourseTuitionSchedule } from '../server/api/zalo/helpers/tuitionDates.js';
import { formatDateForZalo } from '../server/api/lib/zalo/zaloFormat.js';

type NoticeType = 'evaluation' | 'rank' | 'tuition';
type SendResult = { success: boolean; messageId?: string; error?: string; errorCode?: number };

const STUDENT_ID = 'b9C4QhZ1h7qQEFp8ChId';
const STUDENT_CODE = 'HS260587';
const CLASS_ID = 'XXTe0dcLydenBbhXkIHF';
const COURSE_ID = 'b043105c-565c-4d05-b94f-04d2f4565a02';
const EVALUATION_ID = 'ekTTFZXfOiERStB9G1VQ';
const DATABASE_ID = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const EXPECTED_SOURCE = 'manual_course_closing_repair';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');
const args = new Set(process.argv.slice(2));
if (
  apply &&
  (!args.has('--yes') ||
    !args.has(`--confirm-student=${STUDENT_CODE}`) ||
    !args.has(`--confirm-class=${CLASS_ID}`) ||
    !args.has(`--confirm-course=${COURSE_ID}`))
) {
  throw new Error('Apply requires --yes and exact student, class, and course confirmations.');
}

function loadDotEnv() {
  for (const envPath of [
    path.join(projectRoot, '.env'),
    path.join(projectRoot, '.vercel/.env.preview.local'),
  ]) {
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

function initDb(): DocumentStore {
  loadDotEnv();
  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(
      readFileSync(path.join(projectRoot, 'service-account-key.json'), 'utf8')
    );
    initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
  }
  return getDocumentStore(getApps()[0], DATABASE_ID);
}

const db = initDb();
const config = {
  appId: process.env.ZALO_APP_ID || '',
  appSecret: process.env.ZALO_APP_SECRET || '',
  initialAccessToken: process.env.ZALO_OA_ACCESS_TOKEN || '',
  refreshToken: process.env.ZALO_REFRESH_TOKEN || '',
  evaluationTemplateId: process.env.ZALO_ZNS_EVAL_TEMPLATE_ID || '',
  rankTemplateId: process.env.ZALO_ZNS_RANK_TEMPLATE_ID || '',
  tuitionTemplateId: process.env.ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID || '',
};

async function readTokenState() {
  const snap = await db.collection('_zalo_config').doc('tokens').get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    accessToken: String(data.accessToken || config.initialAccessToken || ''),
    refreshToken: String(data.refreshToken || config.refreshToken || ''),
    expiresAt: Number(data.expiresAt || 0),
  };
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  if (!refreshToken || !config.appId || !config.appSecret) return null;
  const response = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      secret_key: config.appSecret,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      app_id: config.appId,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await response.json();
  if (!data?.access_token) return null;
  const accessToken = String(data.access_token);
  await db.collection('_zalo_config').doc('tokens').set(
    {
      accessToken,
      refreshToken: String(data.refresh_token || refreshToken),
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return accessToken;
}

async function getValidAccessToken() {
  const state = await readTokenState();
  if (state.accessToken && state.expiresAt > Date.now() + 5 * 60 * 1000) {
    return state.accessToken;
  }
  return (await refreshAccessToken(state.refreshToken)) || state.accessToken || null;
}

async function sendZns(
  templateId: string,
  templateData: Record<string, string | number>,
  phone: string,
  trackingId: string
): Promise<SendResult> {
  let token = await getValidAccessToken();
  if (!token) return { success: false, error: 'Missing valid Zalo access token' };
  const request = async (accessToken: string) => {
    const response = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: accessToken },
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
    try {
      let data = await request(token);
      if ((data.error === -401 || data.error === -124) && attempt === 0) {
        const state = await readTokenState();
        const refreshed = await refreshAccessToken(state.refreshToken);
        if (refreshed) {
          token = refreshed;
          data = await request(token);
        }
      }
      if (data.error === 0 || data.message === 'Success') {
        return { success: true, messageId: String(data.data?.msg_id || '') };
      }
      return {
        success: false,
        errorCode: typeof data.error === 'number' ? data.error : undefined,
        error: `Zalo error ${String(data.error ?? 'unknown')}: ${String(data.message || '')}`,
      };
    } catch (error) {
      if (attempt < 2) continue;
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { success: false, error: 'Zalo send retry exhausted' };
}

const manualDocId = (type: NoticeType) => `manual_${COURSE_ID}_${STUDENT_ID}_${type}`;
const [studentDoc, classDoc, evaluationDoc, ledgerQuery, snapshot] = await Promise.all([
  db.collection('students').doc(STUDENT_ID).get(),
  db.collection('classes').doc(CLASS_ID).get(),
  db.collection('evaluations').doc(EVALUATION_ID).get(),
  db.collection('course_fee_ledgers').where('studentId', '==', STUDENT_ID).get(),
  computeCourseClosingComputation(db, CLASS_ID),
]);
if (!studentDoc.exists || !classDoc.exists || !evaluationDoc.exists) {
  throw new Error('Expected production student, class, or evaluation is missing.');
}
const studentData: Record<string, any> = { id: studentDoc.id, ...(studentDoc.data() || {}) };
const classData: Record<string, any> = { id: classDoc.id, ...(classDoc.data() || {}) };
const finalEvaluationData = evaluationDoc.data() || {};
if (String(studentData.studentId || '') !== STUDENT_CODE) throw new Error('Student mismatch.');
if (String(classData.currentCourseId || '') !== COURSE_ID) throw new Error('Course mismatch.');
if (String(finalEvaluationData.studentId || '') !== STUDENT_ID) {
  throw new Error('Evaluation student mismatch.');
}
if (String(finalEvaluationData.classId || '') !== CLASS_ID) {
  throw new Error('Evaluation class mismatch.');
}
const context: CourseClosingSendContext = {
  courseId: COURSE_ID,
  classData,
  studentData,
  finalEvaluationData,
  evaluationId: EVALUATION_ID,
  evaluationVersion: evaluationVersion(evaluationDoc as never),
  snapshot: snapshot.snapshot,
};
const recipient = recipientFromCourseClosingContext(context, 'manual_course_closing_delivery');
const evaluationCanonical = buildCanonicalEvaluationNotification(context);
const rankCanonical = buildCanonicalRankNotification(context);
const ledger = ledgerQuery.docs.find((doc) => {
  const data = (doc.data() || {}) as Record<string, any>;
  return (
    String(data.classId || '') === CLASS_ID &&
    String(data.termStart || '') === String(classData.startDate || '')
  );
});
if (!ledger) throw new Error('Outgoing course ledger is missing.');
const tuitionBody = buildCanonicalTuitionNoticeBody(context, ledger.data());
const schedule = getNextCourseTuitionSchedule(String(classData.endDate || ''), classData);

const manualDocs = new Map(
  await Promise.all(
    (['evaluation', 'rank', 'tuition'] as NoticeType[]).map(async (type) => {
      const doc = await db.collection('zalo_notifications').doc(manualDocId(type)).get();
      if (!doc.exists) throw new Error(`Manual completion log is missing for ${type}.`);
      const data = doc.data() || {};
      if (data.status !== 'sent' || data.source !== EXPECTED_SOURCE) {
        throw new Error(`Unexpected manual completion state for ${type}.`);
      }
      return [type, { ref: doc.ref, data }] as const;
    })
  )
);

const hash = createHash('sha256').update(`${COURSE_ID}:${STUDENT_ID}`).digest('hex').slice(0, 20);
const plans: Array<{
  type: NoticeType;
  templateId: string;
  templateData: Record<string, string | number>;
  trackingId: string;
}> = [
  {
    type: 'evaluation',
    templateId:
      config.evaluationTemplateId || String(manualDocs.get('evaluation')?.data.templateId || ''),
    templateData: {
      student_name: recipient.studentName,
      student_code: recipient.studentCode,
      course_end_date: formatDateForZalo(evaluationCanonical.courseEndDate),
      final_grade: evaluationCanonical.finalGrade,
      good: evaluationCanonical.good,
      bad: evaluationCanonical.bad,
    },
    trackingId: `edutrack_eval_manual_${hash}`,
  },
  {
    type: 'rank',
    templateId: config.rankTemplateId || String(manualDocs.get('rank')?.data.templateId || ''),
    templateData: {
      student_name: recipient.studentName,
      student_code: recipient.studentCode,
      rank: rankCanonical.rankLabel,
      discount: rankCanonical.discount,
    },
    trackingId: `edutrack_rank_manual_${hash}`,
  },
  {
    type: 'tuition',
    templateId:
      config.tuitionTemplateId || String(manualDocs.get('tuition')?.data.templateId || ''),
    templateData: {
      student_name: recipient.studentName,
      student_code: recipient.studentCode,
      previous_end_date: schedule.previousEndDate,
      start_date: schedule.startDate,
      end_date: schedule.endDate,
      amount: Number(tuitionBody.schoolFee || 0),
      due_date: schedule.dueDate,
    },
    trackingId: `edutrack_fee_manual_${hash}`,
  },
];

for (const plan of plans) {
  if (!plan.templateId) throw new Error(`Missing ${plan.type} Zalo template ID.`);
  const storedTemplateId = String(manualDocs.get(plan.type)?.data.templateId || '');
  if (storedTemplateId && storedTemplateId !== plan.templateId) {
    throw new Error(`${plan.type} template ID differs from the successful class sends.`);
  }
}
if (!recipient.phone) throw new Error('Parent phone is missing.');

const pendingPlans = plans.filter(
  (plan) => manualDocs.get(plan.type)?.data.actualDeliveryStatus !== 'sent'
);
const summary = {
  mode: apply ? 'apply' : 'dry-run',
  target: {
    studentCode: STUDENT_CODE,
    classId: CLASS_ID,
    courseId: COURSE_ID,
    phone: `${recipient.phone.slice(0, 2)}***${recipient.phone.slice(-3)}`,
  },
  connection: {
    appConfigured: Boolean(config.appId && config.appSecret),
    refreshTokenAvailable: Boolean((await readTokenState()).refreshToken),
    templatesConfigured: plans.every((plan) => Boolean(plan.templateId)),
  },
  snapshotStatus: snapshot.snapshot.status,
  plannedTypes: pendingPlans.map((plan) => plan.type),
  alreadyDeliveredTypes: plans
    .filter((plan) => manualDocs.get(plan.type)?.data.actualDeliveryStatus === 'sent')
    .map((plan) => plan.type),
  payloadKeys: Object.fromEntries(plans.map((plan) => [plan.type, Object.keys(plan.templateData)])),
};
if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const results: Array<{
  type: NoticeType;
  success: boolean;
  messageId: string;
  errorCode?: number;
  error: string;
}> = [];
for (const plan of pendingPlans) {
  const attemptedAt = new Date().toISOString();
  const result = await sendZns(
    plan.templateId,
    plan.templateData,
    recipient.phone,
    plan.trackingId
  );
  const log = manualDocs.get(plan.type);
  if (!log) throw new Error(`Lost manual log for ${plan.type}.`);
  if (result.success && result.messageId) {
    const deliveredAt = new Date().toISOString();
    await log.ref.update({
      status: 'sent',
      deliverySkipped: false,
      actualDeliveryStatus: 'sent',
      actualDeliveryAttemptedAt: attemptedAt,
      deliveredAt,
      completedAt: deliveredAt,
      zaloMessageId: result.messageId,
      providerMessageId: result.messageId,
      trackingId: plan.trackingId,
      deliverySource: 'manual_course_closing_delivery',
      payloadCaptured: true,
      payloadSnapshot: createZaloPayloadSnapshot({
        templateId: plan.templateId,
        phone: recipient.phone,
        templateData: plan.templateData,
      }),
      actualDeliveryError: '',
    });
    if (plan.type === 'tuition') {
      await ledger.ref.update({
        tuitionNoticeLastSentAt: deliveredAt,
        tuitionNoticeLastSentBy: 'manual_course_closing_delivery',
        tuitionNoticeLastSentByName: 'manual_course_closing_delivery',
        tuitionNoticeLastMessageId: result.messageId,
        tuitionNoticeLastAmount: Number(tuitionBody.schoolFee || 0),
        tuitionNoticeLastDueDate: schedule.dueDate,
        updatedAt: deliveredAt,
      });
    }
  } else {
    await log.ref.update({
      deliverySkipped: true,
      actualDeliveryStatus: 'failed',
      actualDeliveryAttemptedAt: attemptedAt,
      actualDeliveryError: result.error || 'Unknown Zalo delivery error',
      ...(result.errorCode !== undefined ? { actualDeliveryErrorCode: result.errorCode } : {}),
      trackingId: plan.trackingId,
    });
  }
  results.push({
    type: plan.type,
    success: result.success,
    messageId: result.messageId || '',
    error: result.error || '',
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
  });
}

const finalDeliveries = await Promise.all(
  (['evaluation', 'rank', 'tuition'] as NoticeType[]).map(async (type) => {
    const doc = await db.collection('zalo_notifications').doc(manualDocId(type)).get();
    const data = doc.data() || {};
    return {
      type,
      status: String(data.actualDeliveryStatus || ''),
      messageId: String(data.providerMessageId || data.zaloMessageId || ''),
      trackingId: String(data.trackingId || ''),
      deliveredAt: String(data.deliveredAt || ''),
      deliverySkipped: Boolean(data.deliverySkipped),
    };
  })
);

await db.collection('audit_logs').doc(`manual_${COURSE_ID}_${STUDENT_ID}_actual_delivery`).set(
  {
    userId: 'manual_course_closing_delivery',
    userRole: 'system',
    userName: 'manual_course_closing_delivery',
    action: 'update',
    collection: 'zalo_notifications',
    documentId: pendingPlans.map((plan) => manualDocId(plan.type)).join(','),
    metadata: {
      action: 'manual_course_closing_delivery',
      studentId: STUDENT_ID,
      studentCode: STUDENT_CODE,
      classId: CLASS_ID,
      courseId: COURSE_ID,
      results: finalDeliveries,
    },
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  },
  { merge: true }
);

console.log(JSON.stringify({ ...summary, attemptedResults: results, finalDeliveries }, null, 2));
if (finalDeliveries.some((result) => result.status !== 'sent' || result.deliverySkipped)) {
  process.exitCode = 1;
}
