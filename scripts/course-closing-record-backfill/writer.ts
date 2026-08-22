import type { DocumentStore } from '@/server/db/documentStore.js';
import type { CourseClosingRecord } from '../../shared/courseClosingRecords.js';
import { mergeBackfillCandidate } from './planner.js';
import type { BackfillRunPlan } from './types.js';

export interface BackfillApplyConfirmation {
  actualProjectId: string;
  actualDatabaseId: string;
  confirmProjectId: string;
  confirmDatabaseId: string;
  reviewedDigest: string;
}

export interface BackfillApplySummary {
  created: number;
  merged: number;
  unchanged: number;
  conflicted: number;
}

export function assertApplyConfirmation(input: BackfillApplyConfirmation): void {
  if (!input.reviewedDigest.trim()) {
    throw new Error('BACKFILL_REVIEWED_DIGEST_REQUIRED');
  }
  if (
    input.actualProjectId.trim() !== input.confirmProjectId.trim() ||
    input.actualDatabaseId.trim() !== input.confirmDatabaseId.trim()
  ) {
    throw new Error(
      `BACKFILL_TARGET_CONFIRMATION_MISMATCH: actual project=${input.actualProjectId}, database=${input.actualDatabaseId}`
    );
  }
}

function emptyApplySummary(): BackfillApplySummary {
  return { created: 0, merged: 0, unchanged: 0, conflicted: 0 };
}

function addSummary(target: BackfillApplySummary, source: BackfillApplySummary): void {
  target.created += source.created;
  target.merged += source.merged;
  target.unchanged += source.unchanged;
  target.conflicted += source.conflicted;
}

function readyDocumentAppeared(
  existing: CourseClosingRecord,
  planned: CourseClosingRecord
): boolean {
  return (
    (existing.evaluationDocument?.status === 'ready' &&
      planned.evaluationDocument?.status !== 'ready') ||
    (existing.tuitionDocument?.status === 'ready' && planned.tuitionDocument?.status !== 'ready')
  );
}

export async function applyCourseClosingBackfill(
  db: DocumentStore,
  plan: BackfillRunPlan,
  confirmation: BackfillApplyConfirmation
): Promise<BackfillApplySummary> {
  assertApplyConfirmation(confirmation);
  const writableItems = plan.items.filter(
    (item) => (item.decision === 'create' || item.decision === 'merge') && Boolean(item.candidate)
  );
  const summary = emptyApplySummary();

  for (let start = 0; start < writableItems.length; start += 200) {
    const chunk = writableItems.slice(start, start + 200);
    const chunkSummary = await db.runTransaction(async (transaction) => {
      const result = emptyApplySummary();
      const refs = chunk.map((item) => db.collection('course_closing_records').doc(item.recordId));
      const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));

      for (let index = 0; index < chunk.length; index += 1) {
        const item = chunk[index];
        const planned = item.candidate!;
        const snapshot = snapshots[index];
        const expectedExists = item.expectedExists ?? item.decision === 'merge';
        const actualVersion = snapshot.updateTime?.toDate?.()?.toISOString?.();
        if (
          expectedExists !== snapshot.exists ||
          (expectedExists && item.existingVersion && actualVersion !== item.existingVersion)
        ) {
          result.conflicted += 1;
          continue;
        }
        const existing = snapshot.exists
          ? ({
              ...(snapshot.data() as CourseClosingRecord),
              id: snapshot.id || planned.id,
            } as CourseClosingRecord)
          : undefined;

        if (existing && readyDocumentAppeared(existing, planned)) {
          result.conflicted += 1;
          continue;
        }

        const merged = mergeBackfillCandidate(existing, planned);
        if (merged.decision === 'ambiguous' || !merged.record) {
          result.conflicted += 1;
          continue;
        }
        if (merged.decision === 'unchanged') {
          result.unchanged += 1;
          continue;
        }

        const recordToWrite: CourseClosingRecord = {
          ...merged.record,
          backfill: {
            version: 1,
            backfilledAt: merged.record.backfill?.backfilledAt || plan.generatedAt,
            sourceDigest: confirmation.reviewedDigest,
          },
        };
        transaction.set(refs[index], recordToWrite, { merge: true });
        if (merged.decision === 'create') result.created += 1;
        else result.merged += 1;
      }
      return result;
    });
    addSummary(summary, chunkSummary);
  }

  return summary;
}
