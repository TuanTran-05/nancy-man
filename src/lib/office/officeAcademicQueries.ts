import { queryOptions } from '@tanstack/react-query';
import type { AcademicPayload } from '../../pages/office/Academic';
import { readChannel } from '../api/readApi';
import { officeQueryKeys } from './officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from './officeQueryPolicy';

export const OFFICE_ACADEMIC_READ_LIMIT = 200;

/**
 * The channel returns one complete payload. Class selection, tabs, searches,
 * and status filters only reshape that payload on the client, so none of them
 * belongs in the cache key.
 */
export function officeAcademicQueryOptions(identity: OfficeQueryIdentity, enabled: boolean) {
  return queryOptions({
    queryKey: officeQueryKeys.academic(identity),
    queryFn: () =>
      readChannel<AcademicPayload>('office-academic', { limit: OFFICE_ACADEMIC_READ_LIMIT }),
    enabled,
    ...officeSharedQueryOptions,
  });
}
