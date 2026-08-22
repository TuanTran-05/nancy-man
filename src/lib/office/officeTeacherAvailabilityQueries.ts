import { queryOptions } from '@tanstack/react-query';
import type { TeacherAvailabilityChangeRequest, TeacherAvailabilityProfile } from '../../types';
import { FRONTEND_COLLECTION_LIMIT } from '../api/readLimits';
import { readChannel } from '../api/readApi';
import { officeQueryKeys } from './officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from './officeQueryPolicy';

export function teacherAvailabilityProfilesQueryOptions(
  identity: OfficeQueryIdentity,
  enabled: boolean = true
) {
  return queryOptions<TeacherAvailabilityProfile[]>({
    queryKey: officeQueryKeys.teacherAvailabilityProfiles(identity),
    queryFn: async () =>
      (
        await readChannel<{ profiles: TeacherAvailabilityProfile[] }>('teacher-availability', {
          view: 'profiles',
          limit: FRONTEND_COLLECTION_LIMIT,
        })
      ).profiles || [],
    enabled: enabled && Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function teacherAvailabilityPendingQueryOptions(
  identity: OfficeQueryIdentity,
  enabled: boolean = true
) {
  return queryOptions<TeacherAvailabilityChangeRequest[]>({
    queryKey: officeQueryKeys.teacherAvailabilityPending(identity),
    queryFn: async () =>
      (
        await readChannel<{ requests: TeacherAvailabilityChangeRequest[] }>(
          'teacher-availability',
          { view: 'pending', limit: FRONTEND_COLLECTION_LIMIT }
        )
      ).requests || [],
    enabled: enabled && Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}
