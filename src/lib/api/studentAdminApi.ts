import { apiRequest } from './apiClient';
import { readChannel } from './readApi';
import type {
  AccountingStudentFinancePage,
  AccountingStudentFinanceQuery,
} from '../../../shared/accountingStudentFinance';

export interface StandardizeStudentIdsPage {
  success: boolean;
  mode: 'plan' | 'applied';
  planDigest: string;
  plan?: Array<{ id: string; from: string }>;
  processed: number;
  updated: number;
  candidates: number;
  skipped: number;
  cursor: string | null;
  hasMore: boolean;
  batchSize: number;
}

export interface StandardizeStudentIdsSummary {
  success: true;
  processed: number;
  updated: number;
  skipped: number;
  batches: number;
}

export interface UpdateStudentCourseEnrollmentRequest {
  enrollmentId: string;
  status: 'trial' | 'active' | 'on_leave' | 'completed' | 'transferred' | 'dropped';
  joinedAt: string;
  endedAt: string | null;
  statusReason: string;
}

interface StandardizeStudentIdsOptions {
  batchSize?: number;
  onProgress?: (
    progress: StandardizeStudentIdsSummary & { cursor: string | null; hasMore: boolean }
  ) => void;
}

/**
 * The server plans a page before it will rename anything on it: a bulk code
 * change is an identity change across many humans, so nothing happens until
 * the exact set of profiles it covers has been read back. This confirms each
 * plan by its digest immediately after reading it, rather than asking the
 * operator to approve every page individually — they already confirmed
 * intent once, at the button that starts this whole run; the digest exists
 * to catch the underlying data moving between the read and the write, not to
 * ask a second time.
 */
export async function standardizeStudentIdsInBatches(
  options: StandardizeStudentIdsOptions = {}
): Promise<StandardizeStudentIdsSummary> {
  const batchSize = options.batchSize || 100;
  let cursor: string | null = null;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let batches = 0;

  for (;;) {
    const planBody = cursor ? { batchSize, cursor } : { batchSize };
    const plan = await apiRequest<StandardizeStudentIdsPage>(
      '/api/v1/students/standardize-student-ids',
      { method: 'POST', body: planBody }
    );

    const page =
      plan.candidates > 0
        ? await apiRequest<StandardizeStudentIdsPage>('/api/v1/students/standardize-student-ids', {
            method: 'POST',
            body: { ...planBody, apply: true, confirmPlanDigest: plan.planDigest },
          })
        : plan;

    batches += 1;
    processed += page.processed || 0;
    updated += page.updated || 0;
    skipped += page.skipped || 0;

    const summary = {
      success: true as const,
      processed,
      updated,
      skipped,
      batches,
    };
    options.onProgress?.({ ...summary, cursor: page.cursor, hasMore: page.hasMore });

    if (!page.hasMore) return summary;
    if (!page.cursor) {
      throw new Error('Student ID standardization did not return a continuation cursor.');
    }
    cursor = page.cursor;
  }
}

export async function transferStudent(
  id: string,
  targetClassId: string,
  joinedAt?: string
): Promise<{ success: boolean; rolloverBalance: number }> {
  return await apiRequest<{ success: boolean; rolloverBalance: number }>(
    '/api/v1/students/transfer',
    {
      method: 'POST',
      body: { id, targetClassId, ...(joinedAt ? { joinedAt } : {}) },
    }
  );
}

export async function updateStudentCourseEnrollment(
  input: UpdateStudentCourseEnrollmentRequest
): Promise<void> {
  await apiRequest('/api/v1/students/course-enrollment', {
    method: 'POST',
    body: input,
  });
}

export async function fetchAccountingStudentFinance(
  query: AccountingStudentFinanceQuery = {}
): Promise<AccountingStudentFinancePage> {
  return readChannel<AccountingStudentFinancePage>('accounting-student-finance', query);
}
