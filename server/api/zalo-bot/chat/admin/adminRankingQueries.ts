import type { DocumentStore } from '@/server/db/documentStore.js';
import type { AdminRankingCriterion } from '../../../../../shared/adminChatMetrics.js';
import { queryAdminClassTuitionRanking } from '../../../lib/services/adminClassTuitionSnapshotService.js';
import type { AdminClassTuitionRankingResult } from './adminChatTypes.js';

/**
 * Queries ranking of class tuition across the center based on the requested ranking criterion.
 */
export async function queryAdminRanking(
  db: DocumentStore,
  options: {
    criterion: AdminRankingCriterion;
    limit?: number | null;
  },
  now = new Date()
): Promise<AdminClassTuitionRankingResult> {
  return queryAdminClassTuitionRanking(db, options, now);
}
