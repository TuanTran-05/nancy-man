import { queryOptions } from '@tanstack/react-query';
import {
  listPendingStudents,
  readRecentAdmissions,
  type PendingStudent,
  type RecentAdmissionsResponse,
} from './admissionsApi';
import { officeQueryKeys } from '../office/officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from '../office/officeQueryPolicy';

export function admissionsPendingQueryOptions(
  identity: OfficeQueryIdentity,
  enabled: boolean = true
) {
  return queryOptions<PendingStudent[]>({
    queryKey: officeQueryKeys.admissionsPending(identity),
    queryFn: async () => (await listPendingStudents()).students,
    enabled: enabled && Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function admissionsHistoryPageQueryOptions(
  identity: OfficeQueryIdentity,
  limit: number,
  cursor: string | null,
  enabled: boolean = true
) {
  return queryOptions<RecentAdmissionsResponse>({
    queryKey: officeQueryKeys.admissionsHistoryPage(identity, limit, cursor),
    queryFn: () => readRecentAdmissions(limit, cursor || undefined),
    enabled: enabled && Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}
