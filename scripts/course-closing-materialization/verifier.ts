import type { DocumentStore } from '@/server/db/documentStore.js';
import type { CourseClosingRecord } from '../../shared/courseClosingRecords.js';
import type {
  MaterializationRunPlan,
  MaterializationVerificationSummary,
  VerificationItemResult,
} from './types.js';

export interface MaterializationVerifyDeps {
  fileExists: (storagePath: string) => Promise<boolean>;
}

function documentField(documentType: 'evaluation' | 'tuition') {
  return documentType === 'evaluation' ? 'evaluationDocument' : 'tuitionDocument';
}

/**
 * Confirms every planned artifact both claims to be ready and has a real file.
 *
 * DocumentStore metadata alone is not proof: a run is only complete when the
 * bucket object behind `storagePath` actually exists.
 */
export async function verifyCourseClosingMaterialization(
  db: DocumentStore,
  plan: MaterializationRunPlan,
  deps: MaterializationVerifyDeps
): Promise<MaterializationVerificationSummary> {
  const results: VerificationItemResult[] = [];

  for (const item of plan.items) {
    const base = { recordId: item.recordId, documentType: item.documentType };
    const snapshot = await db.collection('course_closing_records').doc(item.recordId).get();

    if (!snapshot.exists) {
      results.push({ ...base, outcome: 'metadata_missing' });
      continue;
    }

    const record = snapshot.data() as CourseClosingRecord;
    const artifact = record?.[documentField(item.documentType)];

    if (artifact?.status !== 'ready' || !artifact.storagePath || !artifact.generatedAt) {
      results.push({ ...base, outcome: 'metadata_missing' });
      continue;
    }

    const exists = await deps.fileExists(artifact.storagePath);
    results.push({
      ...base,
      outcome: exists ? 'ready_with_file' : 'file_missing',
      storagePath: artifact.storagePath,
    });
  }

  return {
    ready_with_file: results.filter((r) => r.outcome === 'ready_with_file').length,
    metadata_missing: results.filter((r) => r.outcome === 'metadata_missing').length,
    file_missing: results.filter((r) => r.outcome === 'file_missing').length,
    results,
  };
}
