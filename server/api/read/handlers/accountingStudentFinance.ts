import { z } from 'zod';
import { FieldPath, type DocumentSnapshot, type DocumentStore, type Query } from '@/server/db/documentStore.js';
import type { ApiRequest } from '@/server/api/lib/http/types.js';
import type { UserContext } from '../../lib/auth/authz.js';
import {
  matchesAccountingSearchTerms,
  parseAccountingSearchTerms,
  selectAccountingSearchIndexTerm,
  type AccountingStudentFinancePage,
} from '../../../../shared/accountingStudentFinance.js';
import { readAccountingStudentFinance as readLegacyAccountingStudentFinance } from './readers.js';
import { assertFinanceAccess } from '../../lib/auth/authz.js';
import { resolveCursor, paginatedQuery } from './utils.js';
import {
  ACCOUNTING_STUDENT_SUMMARY_HEALTH_COLLECTION,
  isAccountingProjectionHealthIncomplete,
} from '../../lib/accounting/studentFinanceProjectionRepository.js';

const querySchema = z.object({
  cursor: z.string().trim().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(80).optional(),
  classId: z.string().trim().max(120).optional(),
  lifecycleScope: z.enum(['current', 'all']).default('current'),
  enrollmentStatus: z.enum(['trial', 'active', 'on_leave', 'completed', 'transferred', 'dropped']).optional(),
  paymentStatus: z.enum(['overdue', 'partial', 'unpaid', 'missing_ledger', 'paid', 'waived']).optional(),
});

function parseQuery(req: ApiRequest) {
  const parsed = querySchema.safeParse({
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    limit: req.query.limit,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    classId: typeof req.query.classId === 'string' ? req.query.classId : undefined,
    lifecycleScope: req.query.lifecycleScope,
    enrollmentStatus: req.query.enrollmentStatus,
    paymentStatus: req.query.paymentStatus,
  });
  if (!parsed.success) throw Object.assign(new Error('Invalid accounting student finance query'), { statusCode: 400 });
  if (parsed.data.search && parsed.data.search.length === 1) {
    throw Object.assign(new Error('Search requires at least 2 characters'), { statusCode: 400 });
  }
  return parsed.data;
}

function projectSummary(data: Record<string, unknown>, id: string) {
  const allowed = [
    'studentId', 'studentName', 'studentNameNormalized', 'studentCode', 'searchTokens',
    'studentLifecycle', 'currentClassId', 'currentEnrollmentId', 'currentEnrollmentStatus',
    'currentCoursePaymentStatus', 'classCount', 'courseCount', 'totalPaid', 'totalOutstanding',
    'overdueCourseCount', 'priorityRank', 'tuitionReminderCount', 'lastTuitionReminderAt', 'enrollmentClassIds', 'enrollmentStatuses',
    'sourceVersion', 'rebuiltAt',
  ];
  const row: Record<string, unknown> = { studentId: id };
  for (const key of allowed) if (key !== 'studentId' && data[key] !== undefined) row[key] = data[key];
  return row;
}

/** How many indexed rows one request may read before giving up on filling a page. */
const SEARCH_SCAN_CAP = 500;

/**
 * `array-contains` can only carry one of the search words, so the remaining words are
 * applied here. Non-matching rows would otherwise shrink the page, so pages are pulled
 * until the caller's limit is filled, the collection runs out, or the scan cap is hit.
 */
async function scanMatchingSummaries(
  ordered: Query,
  limit: number,
  cursorDoc: DocumentSnapshot | null,
  searchTerms: readonly string[]
) {
  const matched: Array<DocumentSnapshot> = [];
  let startAfter = cursorDoc;
  let lastScanned: DocumentSnapshot | null = null;
  let scanned = 0;
  let moreAvailable = false;
  do {
    const page = await paginatedQuery(ordered, limit, startAfter);
    if (page.docs.length === 0) {
      moreAvailable = false;
      break;
    }
    scanned += page.docs.length;
    lastScanned = page.docs[page.docs.length - 1];
    startAfter = lastScanned;
    moreAvailable = Boolean(page.nextCursor);
    for (const doc of page.docs) {
      if (matchesAccountingSearchTerms(doc.data() as Record<string, unknown>, searchTerms)) {
        matched.push(doc);
      }
    }
  } while (matched.length < limit && moreAvailable && scanned < SEARCH_SCAN_CAP);

  const docs = matched.slice(0, limit);
  const hasMore = matched.length > limit || moreAvailable;
  const resumeFrom = matched.length > limit ? docs[docs.length - 1] : lastScanned;
  return { docs, hasMore, nextCursor: hasMore ? resumeFrom?.id || null : null };
}

export async function readAccountingStudentFinanceWorkspace(
  db: DocumentStore,
  ctx: UserContext,
  req: ApiRequest,
): Promise<AccountingStudentFinancePage> {
  assertFinanceAccess(ctx);
  const query = parseQuery(req);
  const collection = db.collection('accounting_student_summaries');
  if (typeof collection?.orderBy !== 'function') {
    const fallback = await readLegacyAccountingStudentFinance(db, ctx, req);
    return { ...fallback, dataIncomplete: true };
  }
  try {
    let base: Query = collection;
    if (query.lifecycleScope === 'current') base = base.where('studentLifecycle', 'not-in', ['archived', 'dropped']);
    if (query.classId) base = base.where('enrollmentClassIds', 'array-contains', query.classId);
    if (query.enrollmentStatus) {
      base = query.lifecycleScope === 'current'
        ? base.where('currentEnrollmentStatus', '==', query.enrollmentStatus)
        : base.where('enrollmentStatuses', 'array-contains', query.enrollmentStatus);
    }
    if (query.paymentStatus) base = base.where('currentCoursePaymentStatus', '==', query.paymentStatus);
    const searchTerms = query.search && query.search.length >= 2 ? parseAccountingSearchTerms(query.search) : [];
    const indexTerm = selectAccountingSearchIndexTerm(searchTerms);
    if (indexTerm) base = base.where('searchTokens', 'array-contains', indexTerm);
    const ordered = base.orderBy('priorityRank').orderBy('studentNameNormalized').orderBy(FieldPath.documentId());
    const cursorDoc = query.cursor ? await resolveCursor(db, 'accounting_student_summaries', query.cursor) : null;
    const scan = await scanMatchingSummaries(ordered, query.limit, cursorDoc, searchTerms);
    const rows = scan.docs.map((doc) => projectSummary(doc.data() as Record<string, unknown>, doc.id));
    const health = await db.collection(ACCOUNTING_STUDENT_SUMMARY_HEALTH_COLLECTION).doc('current').get();
    const healthData = health.exists ? health.data() || {} : {};
    const dataIncomplete = isAccountingProjectionHealthIncomplete(
      health.exists ? healthData : null
    );
    return { rows: rows as AccountingStudentFinancePage['rows'], page: { nextCursor: scan.nextCursor, hasMore: scan.hasMore }, dataIncomplete, generatedAt: new Date().toISOString() };
  } catch (error) {
    // Local emulators and older deployments may not have the projection indexes yet.
    console.warn('[accounting-student-finance] summary query unavailable; using bounded fallback', error);
    const fallback = await readLegacyAccountingStudentFinance(db, ctx, req);
    return { ...fallback, dataIncomplete: true };
  }
}
