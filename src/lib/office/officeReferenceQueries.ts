import { queryOptions } from '@tanstack/react-query';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../shared/classVisibility';
import {
  readCalendarReferences,
  readClassesData,
  readOfficeTeacherReferences,
} from '../api/frontendReadApi';
import { getStudentDirectory } from '../api/studentDirectoryApi';
import { officeQueryKeys } from './officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from './officeQueryPolicy';

export type OfficeTeacherReference = {
  uid: string;
  displayName: string;
  email: string;
  phone?: string;
  blockedTeacher: boolean;
};

export function officeClassListQueryOptions(
  identity: OfficeQueryIdentity,
  enabled: boolean = true
) {
  return queryOptions({
    queryKey: officeQueryKeys.classList(identity),
    queryFn: async () => {
      const payload = await readClassesData();
      return filterClassesForRoleOutsideAdminDashboard(payload.classes || [], identity.role);
    },
    enabled: enabled && Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function officeTeacherReferencesQueryOptions(
  identity: OfficeQueryIdentity,
  enabled: boolean = true
) {
  return queryOptions({
    queryKey: officeQueryKeys.teacherReferences(identity),
    queryFn: async () => {
      const payload = await readOfficeTeacherReferences();
      return (payload.teachers || []).map((teacher) => ({
        uid: teacher.uid,
        displayName: teacher.displayName || teacher.email || '',
        email: teacher.email || '',
        phone: teacher.phone || '',
        blockedTeacher: Boolean(teacher.blockedTeacher),
      }));
    },
    enabled: enabled && Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function officeHolidaysQueryOptions(identity: OfficeQueryIdentity, enabled: boolean = true) {
  return queryOptions({
    queryKey: officeQueryKeys.holidays(identity),
    queryFn: async () => {
      const payload = await readCalendarReferences();
      return payload.systemHolidays || [];
    },
    enabled: enabled && Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function officeStudentIndexQueryOptions(
  identity: OfficeQueryIdentity,
  enabled: boolean = true
) {
  return queryOptions({
    queryKey: officeQueryKeys.studentIndex(identity),
    queryFn: () =>
      getStudentDirectory({ revalidate: true }).then((payload) => payload.students || []),
    enabled: enabled && Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}
