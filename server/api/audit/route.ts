import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore, Query } from '@/server/db/documentStore.js';
import { timingSafeEqual } from 'crypto';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { verifyAuthContext, verifyAuthToken, getDb } from '../lib/auth/verifyAuth.js';
import { checkRateLimit } from '../lib/auth/rateLimit.js';
import {
  authUserFromContext,
  mutationUserInfoFromContext,
} from '../lib/auth/contextUser.js';
import {
  getClientIp,
  writeAuditLog,
  type AuditAction,
  type AuditLogEntry,
} from '../lib/logging/auditLog.js';
import { normalizeBody, isPlainObject, getUserAgent } from '../lib/http/helpers.js';
import { FULL_EXPORT_COLLECTIONS } from '../lib/services/fullExportCollections.js';
import {
  getCoreEnvironmentReadiness,
  getProductionEnvironmentReadiness,
} from '../lib/validation/validateEnv.js';
import { checkSqlConnection } from '../../db/client.js';
import {
  completeJobRun,
  failJobRun,
  runTrackedJob,
  startJobRun,
} from '../lib/jobs/jobStore.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';
import { isPayOSEnabled } from '../lib/payments/payosAvailability.js';
import { format, addDays, parseISO } from 'date-fns';

const AUDIT_ACTIONS: AuditAction[] = [
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'export',
  'import',
  'password_reset',
  'status_change',
];
const SERVER_ONLY_AUDIT_COLLECTIONS = new Set([
  'course_fee_ledgers',
  'receipts',
  'invoices',
  'expenses',
  'payment_requests',
  'webhook_events',
]);

const CLIENT_AUDIT_COLLECTIONS = new Set([
  'system_crash',
  'allowed_teachers',
  'users',
  'blocked_teachers',
]);

// ─── Cleanup constants ──────────────────────────────────────────────────────
const MAX_BATCH_DELETE = 450;
const MAX_AUDIT_LOG_DELETE_BATCHES = 20;
const RATE_LIMIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const AUDIT_LOG_CLEANUP_DAY = 13;
const AUDIT_LOG_CLEANUP_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const FINANCE_EVIDENCE_RETENTION_DAYS = 7 * 365;
const AUDIT_LOG_RETENTION_DAYS = 60;
const AUDIT_LOG_CRITICAL_RETENTION_DAYS = AUDIT_LOG_RETENTION_DAYS;
const DEFAULT_ADMIN_READ_AUDIT_RETENTION_DAYS = 90;
const WEBHOOK_EVENT_RETENTION_DAYS = FINANCE_EVIDENCE_RETENTION_DAYS;
const NOTIFICATION_RETENTION_DAYS = 180;
const CRITICAL_ACTIONS = new Set(['login', 'password_reset', 'status_change', 'delete']);
const ADMIN_READ_AUDIT_ACTION = 'admin_data_read';

function getAdminReadAuditRetentionDays(): number {
  const parsed = Number(process.env.ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS);
  return Number.isInteger(parsed) && parsed >= 30 && parsed <= 365
    ? parsed
    : DEFAULT_ADMIN_READ_AUDIT_RETENTION_DAYS;
}

interface DeleteBatchResult {
  deleted: number;
  hasMore: boolean;
}

async function deleteQueryBatch(query: Query): Promise<DeleteBatchResult> {
  const snap = await query.limit(MAX_BATCH_DELETE).get();
  if (snap.empty) return { deleted: 0, hasMore: false };

  const db = getDb();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return { deleted: snap.size, hasMore: snap.size === MAX_BATCH_DELETE };
}

async function deleteQuery(query: Query): Promise<number> {
  const result = await deleteQueryBatch(query);
  return result.deleted;
}

async function deleteQueryInBatches(
  query: Query,
  maxBatches: number
): Promise<{ deleted: number; completed: boolean }> {
  let deleted = 0;
  for (let batchNo = 0; batchNo < maxBatches; batchNo += 1) {
    const result = await deleteQueryBatch(query);
    deleted += result.deleted;
    if (!result.hasMore) return { deleted, completed: true };
  }
  return { deleted, completed: false };
}

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    year: value('year'),
    month: value('month'),
    day: Number(value('day')),
  };
}

async function cleanupAuditLogs(now: Date) {
  const db = getDb();
  const { year, month, day } = getDatePartsInTimeZone(now, AUDIT_LOG_CLEANUP_TIME_ZONE);
  const monthKey = `${year}-${month}`;

  if (day < AUDIT_LOG_CLEANUP_DAY) {
    return {
      deleted: 0,
      completed: true,
      eligible: false,
      alreadyRan: false,
      monthKey,
      dayOfMonth: day,
      timeZone: AUDIT_LOG_CLEANUP_TIME_ZONE,
    };
  }

  const markerRef = db.collection('_maintenance').doc('auditLogCleanup');
  const markerSnap = await markerRef.get();
  if (markerSnap.exists && markerSnap.data()?.lastRunMonth === monthKey) {
    return {
      deleted: 0,
      completed: true,
      eligible: true,
      alreadyRan: true,
      monthKey,
      dayOfMonth: day,
      timeZone: AUDIT_LOG_CLEANUP_TIME_ZONE,
    };
  }

  const nowMs = now.getTime();
  const nonCriticalCutoff = new Date(
    nowMs - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const criticalCutoff = new Date(
    nowMs - AUDIT_LOG_CRITICAL_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const adminReadCutoff = new Date(
    nowMs - getAdminReadAuditRetentionDays() * 24 * 60 * 60 * 1000
  ).toISOString();

  let totalDeleted = 0;
  let allCompleted = true;

  // Delete non-critical audit logs older than the retention window.
  const nonCriticalQuery = db
    .collection('audit_logs')
    .where('timestamp', '<', nonCriticalCutoff)
    .where('action', 'not-in', [...CRITICAL_ACTIONS, ADMIN_READ_AUDIT_ACTION]);
  const nonCriticalResult = await deleteQueryInBatches(
    nonCriticalQuery,
    MAX_AUDIT_LOG_DELETE_BATCHES
  );
  totalDeleted += nonCriticalResult.deleted;
  if (!nonCriticalResult.completed) allCompleted = false;

  // Delete critical audit logs older than the retention window.
  const criticalQuery = db
    .collection('audit_logs')
    .where('timestamp', '<', criticalCutoff)
    .where('action', 'in', [...CRITICAL_ACTIONS]);
  const criticalResult = await deleteQueryInBatches(criticalQuery, MAX_AUDIT_LOG_DELETE_BATCHES);
  totalDeleted += criticalResult.deleted;
  if (!criticalResult.completed) allCompleted = false;

  const adminReadQuery = db
    .collection('audit_logs')
    .where('timestamp', '<', adminReadCutoff)
    .where('action', '==', ADMIN_READ_AUDIT_ACTION);
  const adminReadResult = await deleteQueryInBatches(adminReadQuery, MAX_AUDIT_LOG_DELETE_BATCHES);
  totalDeleted += adminReadResult.deleted;
  if (!adminReadResult.completed) allCompleted = false;

  if (allCompleted) {
    await markerRef.set(
      {
        lastRunAt: now.toISOString(),
        lastRunMonth: monthKey,
        deletedCount: totalDeleted,
        timeZone: AUDIT_LOG_CLEANUP_TIME_ZONE,
      },
      { merge: true }
    );
  }

  return {
    deleted: totalDeleted,
    completed: allCompleted,
    eligible: true,
    alreadyRan: false,
    monthKey,
    dayOfMonth: day,
    timeZone: AUDIT_LOG_CLEANUP_TIME_ZONE,
  };
}

function isCronAuthorized(req: ApiRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  // VPS cron jobs authenticate with an explicit bearer secret.
  const rawAuthHeader = req.headers.authorization;
  const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token.length === cronSecret.length) {
      try {
        return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(cronSecret, 'utf8'));
      } catch {
        return false;
      }
    }
  }

  return false;
}

async function handleDailyMaintenance(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const db = getDb();
  if (
    await guardStudentIdentityRouteMutation(() => db, res, {
      surface: 'audit_jobs',
      action: 'daily-maintenance',
      req,
    })
  )
    return;

  // Tracked from here rather than around the fan-out alone. This cron owns no
  // work of its own, so every way it can die — an unresolvable host, a
  // platform timeout, a deploy that never registered it — used to leave the
  // database identical to a day it simply never ran. The run record is the
  // only thing that tells those apart.
  const job = await startJobRun(db, { kind: 'daily_maintenance', name: 'daily-maintenance' });

  let results: DailyMaintenanceJobResult[];
  try {
    results = await runDailyMaintenanceFanOut(req);
  } catch (err) {
    await failJobRun(db, job, err);
    return res
      .status(500)
      .json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }

  const failed = results.filter((result) => !result.ok).map((result) => result.name);
  if (failed.length > 0) {
    // Tracked as failed rather than completed-with-warnings. A status board
    // that reads green on a day eight of nine jobs died is worse than no
    // board, because it answers the question wrongly instead of not at all.
    await failJobRun(db, job, new Error(`Daily maintenance jobs failed: ${failed.join(', ')}`));
    return res.status(502).json({ success: false, results });
  }

  await completeJobRun(db, job, { checked: results.length, changed: results.length });
  return res.status(200).json({ success: true, results });
}

type DailyMaintenanceJobResult = { name: string; ok: boolean; status: number; body: string };

async function runDailyMaintenanceFanOut(req: ApiRequest): Promise<DailyMaintenanceJobResult[]> {
  const headerValue = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value || '';
  const host =
    process.env.INTERNAL_API_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    headerValue(req.headers['x-forwarded-host']) ||
    headerValue(req.headers.host);
  if (!host) {
    throw new Error('Unable to resolve deployment host');
  }
  const protocol = headerValue(req.headers['x-forwarded-proto']) || 'https';
  const origin = (host.startsWith('http') ? host : protocol + '://' + host).replace(/\/+$/, '');
  const authorization = headerValue(req.headers.authorization);
  const jobs: readonly (readonly [string, string])[] = [
    ['cleanup', '/api/audit/cleanup'],
    ['finance-aggregate', '/api/audit/finance-aggregate'],
    ['dashboard-aggregate', '/api/audit/dashboard-aggregate'],
    ['notification-digest', '/api/audit/notification-digest'],
    ['outbox-process', '/api/audit/outbox-process'],
    ...(isPayOSEnabled()
      ? ([['payos-reconcile', '/api/v1/payments/payos/reconcile']] as const)
      : []),
    ['zalo-bot-daily-digest-catch-up', '/api/audit/zalo-bot-daily-digest?mode=catch-up'],
    ['admin-class-tuition-rebuild', '/api/audit/admin-class-tuition-rebuild'],
    // Added once, after the aggregates it reports on have run, so a green day
    // reflects the projections as they were left rather than as they were
    // found.
    ['student-identity-health', '/api/audit/student-identity-health'],
  ];

  return await Promise.all(
    jobs.map(async ([name, path]) => {
      try {
        const response = await fetch(origin + path, {
          method: 'GET',
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(45_000),
        });
        const body = await response.text();
        return { name, ok: response.ok, status: response.status, body: body.slice(0, 500) };
      } catch (err) {
        return { name, ok: false, status: 0, body: err instanceof Error ? err.message : 'failed' };
      }
    })
  );
}

async function authorizeJob(req: ApiRequest, res: ApiResponse): Promise<boolean> {
  if (isCronAuthorized(req)) return true;
  const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
  return Boolean(user);
}

function getStringQuery(value: unknown): string {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return monthKey(d);
}

async function handleFinanceAggregate(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await authorizeJob(req, res))) return;
  const db = getDb();
  if (
    await guardStudentIdentityRouteMutation(() => db, res, {
      surface: 'audit_jobs',
      action: 'finance-aggregate',
      req,
    })
  )
    return;

  const { aggregateFinanceMonth } =
    await import('../lib/services/financeReportService.js');

  const requestedMonth = getStringQuery(req.query.month).trim();
  const currentMonth = monthKey(new Date());
  const months = requestedMonth ? [requestedMonth] : [addMonths(currentMonth, -1), currentMonth];

  const result = await runTrackedJob(
    db,
    {
      kind: 'finance_aggregate',
      name: 'finance-aggregate',
      params: { months },
    },
    async () => {
      const aggregates = [];
      for (const month of months) {
        aggregates.push(await aggregateFinanceMonth(db, month));
      }
      return { months, aggregates };
    },
    ({ aggregates }) => ({
      months,
      sourceCounts: aggregates.map((aggregate) => ({
        month: aggregate.month,
        ...aggregate.sourceCounts,
      })),
    })
  );
  return res.status(200).json({ success: true, ...result });
}

async function handleDashboardAggregate(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await authorizeJob(req, res))) return;
  const db = getDb();
  if (
    await guardStudentIdentityRouteMutation(() => db, res, {
      surface: 'audit_jobs',
      action: 'dashboard-aggregate',
      req,
    })
  )
    return;

  const { aggregateDashboardReadModel } =
    await import('../lib/services/dashboardAggregateService.js');

  const model = await runTrackedJob(
    db,
    {
      kind: 'dashboard_aggregate',
      name: 'dashboard-aggregate',
    },
    () => aggregateDashboardReadModel(db),
    (readModel) => ({ generatedAt: readModel.generatedAt, counts: readModel.counts })
  );
  return res.status(200).json({ success: true, model });
}

async function handleNotificationDigest(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await authorizeJob(req, res))) return;
  const db = getDb();
  if (
    await guardStudentIdentityRouteMutation(() => db, res, {
      surface: 'audit_jobs',
      action: 'notification-digest',
      req,
    })
  )
    return;

  const result = await runTrackedJob(
    db,
    {
      kind: 'notification_digest',
      name: 'notification-digest',
    },
    async () => {
      const today = new Date().toISOString().slice(0, 10);
      const digestRef = db.collection('_maintenance').doc(`notificationDigest_${today}`);
      const existingDigest = await digestRef.get();
      if (existingDigest.exists) {
        return { skipped: true, reason: 'already_ran', date: today };
      }

      const failedSnap = await db
        .collection('zalo_notifications')
        .where('status', '==', 'failed')
        .limit(2000)
        .get();
      if (failedSnap.empty) {
        await digestRef.set({ ranAt: new Date().toISOString(), failedCount: 0 }, { merge: true });
        return { failedCount: 0, date: today };
      }

      const countsByType: Record<string, number> = {};
      const samples = failedSnap.docs.slice(0, 10).map((doc) => {
        const data = doc.data();
        const type = typeof data.type === 'string' ? data.type : 'unknown';
        countsByType[type] = (countsByType[type] || 0) + 1;
        return {
          id: doc.id,
          type,
          studentId: data.studentId || '',
          phone: data.phone || '',
          errorMessage: data.errorMessage || '',
          createdAt: data.createdAt || '',
        };
      });

      await db.collection('admin_notifications').add({
        type: 'zalo_failure_digest',
        title: `Zalo notification failures: ${failedSnap.size}`,
        message: `There are ${failedSnap.size} failed Zalo notifications requiring review.`,
        countsByType,
        sampleFailures: samples,
        read: false,
        createdAt: new Date().toISOString(),
      });
      await digestRef.set(
        { ranAt: new Date().toISOString(), failedCount: failedSnap.size, countsByType },
        { merge: true }
      );
      return { failedCount: failedSnap.size, countsByType, date: today };
    },
    (digest) => digest
  );

  if ('skipped' in result && result.skipped) {
    return res.status(200).json({ success: true, skipped: true, reason: result.reason });
  }
  return res.status(200).json({ success: true, ...result });
}

async function handlePaymentReconcile(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await authorizeJob(req, res))) return;
  const db = getDb();
  if (
    await guardStudentIdentityRouteMutation(() => db, res, {
      surface: 'audit_jobs',
      action: 'payment-reconcile',
      req,
    })
  )
    return;

  const { handleReconcile } = await import('../payments/payos/handlers/reconcile.js');

  const job = await startJobRun(db, {
    kind: 'reconciliation',
    name: 'payment-reconcile',
  });
  try {
    await handleReconcile(req, res);
    await completeJobRun(db, job);
    return;
  } catch (err) {
    await failJobRun(db, job, err);
    throw err;
  }
}

async function handleZaloBotDailyDigest(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!isCronAuthorized(req)) {
    const user = await verifyAuthToken(req, res, ['admin']);
    if (!user) return;
  }

  const db = getDb();
  if (
    await guardStudentIdentityRouteMutation(() => db, res, {
      surface: 'audit_jobs',
      action: 'zalo-bot-daily-digest',
      req,
    })
  ) {
    return;
  }

  const [
    { getVietnamTodayStr },
    { loadZaloBotConfig },
    { runZaloBotDailyDigest },
    { repairPendingZaloBotLinkConfirmations },
    { processOutboxJobs },
    { initOutboxHandlers },
  ] = await Promise.all([
    import('../../../shared/classSchedule.js'),
    import('../zalo-bot/config.js'),
    import('../zalo-bot/digestService.js'),
    import('../zalo-bot/linkConfirmationService.js'),
    import('../lib/jobs/outbox.js'),
    import('../lib/jobs/productionHandlers.js'),
  ]);

  let digestDate = getVietnamTodayStr();
  const isCatchUp = req.query.mode === 'catch-up';

  if (isCatchUp) {
    digestDate = format(addDays(parseISO(digestDate), -1), 'yyyy-MM-dd');
    const existingRef = db.collection('_maintenance').doc(`zaloBotDigest_${digestDate}`);
    const existingSnap = await existingRef.get();
    if (existingSnap.exists && existingSnap.data()?.completedAt) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: 'already_ran_catch_up',
        date: digestDate,
      });
    }
  }

  const config = await loadZaloBotConfig();
  const tomorrowDate = format(addDays(parseISO(digestDate), 1), 'yyyy-MM-dd');

  const result = await runTrackedJob(
    db,
    {
      kind: 'zalo_bot_daily_digest',
      name: 'zalo-bot-daily-digest',
      params: { date: digestDate, mode: req.query.mode || 'normal' },
    },
    async () => {
      const repairResult = await repairPendingZaloBotLinkConfirmations(db, { limit: 100 });
      const digestResult = await runZaloBotDailyDigest(db, { digestDate, tomorrowDate, config });
      return {
        repair: repairResult,
        digest: digestResult,
      };
    },
    (res) => res
  );

  await initOutboxHandlers();
  const outboxResult = await processOutboxJobs(db, 'zalo-bot-daily-digest');

  const deliveryFailures = outboxResult.failed;

  const responseBody = {
    success: true,
    date: digestDate,
    counts: {
      confirmationRepair: result.repair?.enqueued ?? 0,
      generation: result.digest?.enqueued ?? 0,
      delivery: outboxResult.succeeded,
      deliveryFailures: deliveryFailures,
    },
    ...result,
  };

  if (deliveryFailures > 0) {
    return res.status(502).json(responseBody);
  }

  return res.status(200).json(responseBody);
}

async function handleAdminClassTuitionRebuild(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await authorizeJob(req, res))) return;
  const { loadZaloBotConfig } = await import('../zalo-bot/config.js');
  const config = loadZaloBotConfig();
  if (!config.adminSnapshotRefreshEnabled) {
    return res
      .status(200)
      .json({ success: true, skipped: true, reason: 'admin_snapshot_refresh_disabled' });
  }
  const db = getDb();
  const { rebuildAllAdminClassTuitionSnapshots } =
    await import('../lib/services/adminClassTuitionSnapshotService.js');
  const health = await rebuildAllAdminClassTuitionSnapshots(db, { dryRun: false });
  return res.status(200).json({ success: true, health });
}

// ─── Router ──────────────────────────────────────────────────────────────────
export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = req.query.action as string;

    // Public endpoints (no auth required)
    if (action === 'liveness') return handleLiveness(req, res);
    if (action === 'health') return await handleHealth(req, res);

    // Cron/maintenance endpoints (use their own auth)
    if (action === 'daily-maintenance') return await handleDailyMaintenance(req, res);
    if (action === 'cleanup') return await handleCleanup(req, res);
    if (action === 'finance-aggregate') return await handleFinanceAggregate(req, res);
    if (action === 'dashboard-aggregate') return await handleDashboardAggregate(req, res);
    if (action === 'notification-digest') return await handleNotificationDigest(req, res);
    if (action === 'payment-reconcile') return await handlePaymentReconcile(req, res);
    if (action === 'outbox-process') return await handleOutboxProcess(req, res);
    if (action === 'zalo-bot-daily-digest') return await handleZaloBotDailyDigest(req, res);
    if (action === 'student-identity-health') return await handleStudentIdentityHealth(req, res);
    if (action === 'admin-class-tuition-rebuild')
      return await handleAdminClassTuitionRebuild(req, res);

    if (['export-sql', 'export-excel'].includes(action)) {
      const verified = await verifyAuthContext(req, res, ['admin']);
      if (!verified) return;
      const user = authUserFromContext(verified.context);
      const userInfo = mutationUserInfoFromContext(verified.context);
      switch (action) {
        case 'export-sql':
          return await handleExportSql(req, res, user, userInfo);
        case 'export-excel':
          return await handleExportExcel(req, res, user, userInfo);
      }
    }

    // Authenticated endpoints
    const verified = await verifyAuthContext(req, res, ['admin', 'teacher', 'accounting']);
    if (!verified) return;
    const user = authUserFromContext(verified.context);
    const userInfo = mutationUserInfoFromContext(verified.context);

    switch (action) {
      case 'log':
        return await handleLog(req, res, user, userInfo);
      default:
        return res.status(404).json({ success: false, error: 'Unknown audit action' });
    }
  } catch (err) {
    console.error(`[Audit/${req.query.action}] Unhandled error:`, err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Internal server error',
    });
  }
}

// ─── health ──────────────────────────────────────────────────────────────────
async function writeFullExportAudit(
  req: ApiRequest,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string },
  format: 'sql' | 'excel',
  reason: string
): Promise<boolean> {
  return writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'export',
    collection: 'full_export',
    documentId: format,
    metadata: {
      format,
      reason,
      collections: [...FULL_EXPORT_COLLECTIONS],
      collectionCount: FULL_EXPORT_COLLECTIONS.length,
    },
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
  });
}

function getExportReason(req: ApiRequest): string {
  return typeof req.query.reason === 'string' ? req.query.reason.trim() : '';
}

function getExportRequester(
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  return { uid: user.uid, role: userInfo.role, name: userInfo.name };
}

async function handleExportSql(
  req: ApiRequest,
  res: ApiResponse,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const db = getDb();
  const { streamSqlExport } = await import('../lib/services/fullExportService.js');
  const reason = getExportReason(req);
  if (reason.length < 3) {
    return res.status(400).json({ success: false, error: 'Export reason is required' });
  }
  const auditWritten = await writeFullExportAudit(req, db, user, userInfo, 'sql', reason);
  if (!auditWritten) {
    return res.status(503).json({ success: false, error: 'Export audit log unavailable' });
  }

  const requester = getExportRequester(user, userInfo);
  const filename = `edutrack_export_${new Date().toISOString().split('T')[0]}.sql`;
  res.setHeader('Content-Type', 'text/sql; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200);
  await runTrackedJob(
    db,
    {
      kind: 'export',
      name: 'full-export-sql',
      requestedBy: requester,
      params: { format: 'sql', reason, collections: [...FULL_EXPORT_COLLECTIONS] },
    },
    () =>
      streamSqlExport(db, (chunk) => {
        res.write(chunk);
      }),
    (result) => ({
      format: 'sql',
      bytes: result.bytes,
      rows: result.rows,
      exportedCollections: result.exportedCollections,
      collectionCount: FULL_EXPORT_COLLECTIONS.length,
    })
  );
  return res.end();
}

async function handleExportExcel(
  req: ApiRequest,
  res: ApiResponse,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const db = getDb();
  const { streamExcelExport } = await import('../lib/services/fullExportService.js');
  const reason = getExportReason(req);
  if (reason.length < 3) {
    return res.status(400).json({ success: false, error: 'Export reason is required' });
  }
  const auditWritten = await writeFullExportAudit(req, db, user, userInfo, 'excel', reason);
  if (!auditWritten) {
    return res.status(503).json({ success: false, error: 'Export audit log unavailable' });
  }

  const requester = getExportRequester(user, userInfo);
  const filename = `edutrack_export_${new Date().toISOString().split('T')[0]}.xml`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200);
  await runTrackedJob(
    db,
    {
      kind: 'export',
      name: 'full-export-excel',
      requestedBy: requester,
      params: { format: 'excel', reason, collections: [...FULL_EXPORT_COLLECTIONS] },
    },
    () =>
      streamExcelExport(db, (chunk) => {
        res.write(chunk);
      }),
    (result) => ({
      format: 'excel',
      bytes: result.bytes,
      rows: result.rows,
      exportedCollections: result.exportedCollections,
      collectionCount: FULL_EXPORT_COLLECTIONS.length,
    })
  );
  return res.end();
}

function runtimeMetadata() {
  const release = process.env.APP_COMMIT_SHA || '';
  return release ? { release } : {};
}

function handleLiveness(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  return res.status(200).json({
    success: true,
    status: 'ok',
    service: 'edutrack-api',
    ...runtimeMetadata(),
    timestamp: new Date().toISOString(),
  });
}

async function handleHealth(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const productionReadiness = getProductionEnvironmentReadiness();
  if (!productionReadiness.ready) {
    console.warn(
      '[Health Check] Degradation detected. Missing production env vars:',
      productionReadiness.missing
    );
    return res.status(503).json({
      success: false,
      status: 'degraded',
      missingEnv: productionReadiness.missing,
      timestamp: new Date().toISOString(),
    });
  }

  const readiness = getCoreEnvironmentReadiness();
  if (!readiness.ready) {
    return res.status(503).json({
      success: false,
      status: 'degraded',
      timestamp: new Date().toISOString(),
    });
  }

  const checks: Record<string, 'connected' | 'unavailable'> = {
    postgres: 'unavailable',
  };

  try {
    await checkSqlConnection();
    checks.postgres = 'connected';
  } catch (err) {
    console.error('[Health] PostgreSQL check failed:', err);
  }

  if (checks.postgres !== 'connected') {
    return res.status(503).json({
      success: false,
      status: 'degraded',
      checks,
      ...runtimeMetadata(),
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(200).json({
    success: true,
    status: 'ok',
    db: 'connected',
    checks,
    ...runtimeMetadata(),
    timestamp: new Date().toISOString(),
  });
}

// ─── cleanup ─────────────────────────────────────────────────────────────────
async function handleCleanup(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const now = Date.now();
    const currentDate = new Date(now);
    const rateLimitCutoff = now - RATE_LIMIT_RETENTION_MS;
    const webhookEventCutoff = new Date(
      now - WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const notificationCutoff = new Date(
      now - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const [
      otpDeleted,
      tokenDeleted,
      rateLimitDeleted,
      webhookEventDeleted,
      notificationDeleted,
      zaloBotChatSessionDeleted,
      zaloBotAdminSessionDeleted,
    ] = await Promise.all([
      deleteQuery(db.collection('passwordResetOtps').where('expiresAt', '<', now)),
      deleteQuery(db.collection('passwordResetTokens').where('expiresAt', '<', now)),
      deleteQuery(db.collection('_rate_limits').where('updatedAt', '<', rateLimitCutoff)),
      deleteQuery(db.collection('webhook_events').where('updatedAt', '<', webhookEventCutoff)),
      deleteQuery(db.collection('notifications').where('createdAt', '<', notificationCutoff)),
      deleteQuery(
        db.collection('zalo_bot_chat_sessions').where('expiresAt', '<', currentDate.toISOString())
      ),
      deleteQuery(
        db.collection('zalo_bot_admin_sessions').where('expiresAt', '<', currentDate.toISOString())
      ),
    ]);
    const auditLogCleanup = await cleanupAuditLogs(currentDate);

    return res.status(200).json({
      success: true,
      deleted: {
        passwordResetOtps: otpDeleted,
        passwordResetTokens: tokenDeleted,
        rateLimits: rateLimitDeleted,
        webhookEvents: webhookEventDeleted,
        notifications: notificationDeleted,
        zaloBotChatSessions: zaloBotChatSessionDeleted,
        zaloBotAdminSessions: zaloBotAdminSessionDeleted,
        auditLogs: auditLogCleanup.deleted,
      },
      auditLogCleanup: {
        completed: auditLogCleanup.completed,
        eligible: auditLogCleanup.eligible,
        alreadyRan: auditLogCleanup.alreadyRan,
        monthKey: auditLogCleanup.monthKey,
        dayOfMonth: auditLogCleanup.dayOfMonth,
        timeZone: auditLogCleanup.timeZone,
      },
      timestamp: currentDate.toISOString(),
    });
  } catch (err) {
    console.error('[MaintenanceCleanup] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Cleanup failed',
    });
  }
}

// ─── log ─────────────────────────────────────────────────────────────────────
async function handleLog(
  req: ApiRequest,
  res: ApiResponse,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const db = getDb();
  const ip = getClientIp(req);
  const rateLimit = await checkRateLimit(db, `audit:${user.uid}:${ip}`, 120, 60 * 1000, {
    failOpen: true,
  });
  if (!rateLimit.allowed) {
    return res.status(429).json({ success: false, error: 'Too many audit log requests' });
  }

  const body = normalizeBody(req.body);
  const action = body.action;
  const collectionName = body.collection;
  const documentId = body.documentId;

  if (
    typeof action !== 'string' ||
    !AUDIT_ACTIONS.includes(action as AuditAction) ||
    typeof collectionName !== 'string' ||
    !collectionName.trim() ||
    typeof documentId !== 'string' ||
    !documentId.trim()
  ) {
    return res.status(400).json({ success: false, error: 'Invalid audit log payload' });
  }
  const normalizedCollectionName = collectionName.trim();
  if (SERVER_ONLY_AUDIT_COLLECTIONS.has(normalizedCollectionName)) {
    return res
      .status(403)
      .json({ success: false, error: 'Finance audit logs must be written by the server' });
  }
  if (!CLIENT_AUDIT_COLLECTIONS.has(normalizedCollectionName)) {
    return res
      .status(400)
      .json({ success: false, error: 'Audit collection is not permitted from the client' });
  }

  const changes = isPlainObject(body.changes)
    ? (body.changes as AuditLogEntry['changes'])
    : undefined;
  const metadata = isPlainObject(body.metadata)
    ? (body.metadata as AuditLogEntry['metadata'])
    : undefined;

  await writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: action as AuditAction,
    collection: normalizedCollectionName,
    documentId,
    changes,
    metadata,
    ip,
    userAgent: getUserAgent(req),
  });

  return res.status(200).json({ success: true });
}

// ─── outbox-process ──────────────────────────────────────────────────────────
/**
 * The daily identity audit.
 *
 * Collected even while maintenance is read_only — the report is the evidence
 * an operator needs *during* a window, not only outside one. The daily marker
 * is still written, because the streak counts days on which somebody checked,
 * and a day inside a maintenance window is a day that was checked.
 *
 * A red result is a successful job. The audit's purpose is to record what was
 * true, and failing the cron would stop it recording anything on exactly the
 * days that matter most.
 */
async function handleStudentIdentityHealth(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await authorizeJob(req, res))) return;

  const [{ collectStudentIdentityHealth }, { writeStudentIdentityHealthReport }] =
    await Promise.all([
      import('../lib/student/studentIdentityHealthService.js'),
      import('../lib/student/studentIdentityHealthRepository.js'),
    ]);

  const db = getDb();
  const report = await collectStudentIdentityHealth({
    db,
    projectId: 'edutrack',
    databaseId: new URL(process.env.DATABASE_URL || 'postgres://localhost/edutrack').pathname.slice(1),
    mode: 'daily',
    sourceCommitSha: process.env.APP_COMMIT_SHA || '',
    now: new Date(),
  });
  const outcome = await writeStudentIdentityHealthReport(db, report);

  return res.status(200).json({
    success: true,
    // The summary only: the full report is stored, and a cron response is not
    // a place to put identity evidence.
    auditId: report.auditId,
    status: report.status,
    vietnamDate: report.vietnamDate,
    blockerCount: report.blockers.length,
    markerOutcome: outcome.markerOutcome,
  });
}

async function handleOutboxProcess(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const db = getDb();
  if (
    await guardStudentIdentityRouteMutation(() => db, res, {
      surface: 'audit_jobs',
      action: 'outbox-process',
      req,
    })
  )
    return;

  try {
    const [{ processOutboxJobs }, { initOutboxHandlers }] = await Promise.all([
      import('../lib/jobs/outbox.js'),
      import('../lib/jobs/productionHandlers.js'),
    ]);
    initOutboxHandlers();
    const db = getDb();
    const result = await processOutboxJobs(db, 'vps-cron');
    return res.status(200).json({
      success: true,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    });
  } catch (err) {
    console.error('[Audit/outbox-process] Job failed:', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}
