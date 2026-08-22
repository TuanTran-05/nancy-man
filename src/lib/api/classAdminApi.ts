import { apiRequest } from './apiClient';

export interface GenerateCourseFeeLedgersPage {
  success: boolean;
  createdCount: number;
  skippedDuplicates: number;
  skippedClasses: number;
  processedClasses: number;
  cursor: string | null;
  hasMore: boolean;
  batchSize: number;
}

export interface GenerateCourseFeeLedgersSummary {
  success: true;
  createdCount: number;
  skippedDuplicates: number;
  skippedClasses: number;
  processedClasses: number;
  batches: number;
}

interface GenerateCourseFeeLedgersOptions {
  batchSize?: number;
  onProgress?: (progress: GenerateCourseFeeLedgersSummary) => void;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function generateCourseFeeLedgersInBatches(
  classIds: string[],
  options: GenerateCourseFeeLedgersOptions = {}
): Promise<GenerateCourseFeeLedgersSummary> {
  const batchSize = options.batchSize || 20;
  const batches = chunk(classIds, batchSize);
  const summary: GenerateCourseFeeLedgersSummary = {
    success: true,
    createdCount: 0,
    skippedDuplicates: 0,
    skippedClasses: 0,
    processedClasses: 0,
    batches: 0,
  };

  for (const classIdBatch of batches) {
    const page = await apiRequest<GenerateCourseFeeLedgersPage>(
      '/api/v1/classes/generate-ledgers',
      {
        method: 'POST',
        body: { classIds: classIdBatch, batchSize },
      }
    );
    summary.createdCount += page.createdCount || 0;
    summary.skippedDuplicates += page.skippedDuplicates || 0;
    summary.skippedClasses += page.skippedClasses || 0;
    summary.processedClasses += page.processedClasses || classIdBatch.length;
    summary.batches += 1;
    options.onProgress?.({ ...summary });
  }

  return summary;
}

export async function generateCourseFeeLedgersForEnrollments(enrollmentIds: string[]): Promise<{
  createdCount: number;
  skippedDuplicates: number;
  skipped: Array<{ enrollmentId: string; reason: string }>;
}> {
  if (enrollmentIds.length === 0) throw new Error('At least one enrollment is required');
  const created = {
    createdCount: 0,
    skippedDuplicates: 0,
    skipped: [] as Array<{ enrollmentId: string; reason: string }>,
  };
  for (let index = 0; index < enrollmentIds.length; index += 100) {
    const page = await apiRequest<{
      createdCount?: number;
      skippedDuplicates?: number;
      skipped?: Array<{ enrollmentId: string; reason: string }>;
    }>('/api/v1/classes/generate-ledgers', {
      method: 'POST',
      body: { enrollmentIds: enrollmentIds.slice(index, index + 100) },
    });
    created.createdCount += Number(page.createdCount || 0);
    created.skippedDuplicates += Number(page.skippedDuplicates || 0);
    created.skipped.push(...(page.skipped || []));
  }
  return created;
}

export type ClassLedgerPlanRow = {
  classId: string;
  className: string;
  tuitionFee: number;
  skipReason: string | null;
  creates: Array<{ studentId: string; amount: number }>;
  alreadyExists: number;
};

export type CourseFeeLedgerRun = {
  mode: 'preview' | 'apply';
  createdCount: number;
  skippedDuplicates: number;
  skippedClasses: number;
  processedClasses: number;
  totalAmount: number;
  plan: ClassLedgerPlanRow[];
  duplicateLedgers: Array<{
    classId: string;
    studentId: string;
    termStart: string;
    ledgerIds: string[];
  }>;
  errors: Array<{ classId: string; message: string }>;
  pages: number;
};

type CourseFeeLedgerPage = Omit<CourseFeeLedgerRun, 'pages'> & {
  cursor: string | null;
  hasMore: boolean;
};

const MAX_LEDGER_PAGES = 500;

export async function runCourseFeeLedgers(
  mode: 'preview' | 'apply',
  options: { batchSize?: number; onProgress?: (run: CourseFeeLedgerRun) => void } = {}
): Promise<CourseFeeLedgerRun> {
  const batchSize = options.batchSize || 20;
  const run: CourseFeeLedgerRun = {
    mode,
    createdCount: 0,
    skippedDuplicates: 0,
    skippedClasses: 0,
    processedClasses: 0,
    totalAmount: 0,
    plan: [],
    duplicateLedgers: [],
    errors: [],
    pages: 0,
  };

  // `loadClassPage` restarts from index 0 when it cannot find the cursor in an
  // explicit classIds list, which returns the same cursor forever. Detect that
  // rather than spinning until a page counter runs out.
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let guard = 0; guard < MAX_LEDGER_PAGES; guard += 1) {
    const page: CourseFeeLedgerPage = await apiRequest('/api/v1/classes/generate-ledgers', {
      method: 'POST',
      body: { mode, batchSize, ...(cursor ? { cursor } : {}) },
    });

    if (page.mode !== mode) {
      throw new Error(`Server answered in mode "${page.mode}" but "${mode}" was requested`);
    }

    run.createdCount += page.createdCount || 0;
    run.skippedDuplicates += page.skippedDuplicates || 0;
    run.skippedClasses += page.skippedClasses || 0;
    run.processedClasses += page.processedClasses || 0;
    run.totalAmount += page.totalAmount || 0;
    run.plan.push(...(page.plan || []));
    run.duplicateLedgers.push(...(page.duplicateLedgers || []));
    run.errors.push(...(page.errors || []));
    run.pages += 1;
    options.onProgress?.({ ...run });

    if (!page.hasMore || !page.cursor) return run;
    if (seenCursors.has(page.cursor)) {
      throw new Error(`Pagination cursor "${page.cursor}" repeated; aborting to avoid a loop`);
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }

  throw new Error(`Stopped after ${MAX_LEDGER_PAGES} pages with more results still reported`);
}
