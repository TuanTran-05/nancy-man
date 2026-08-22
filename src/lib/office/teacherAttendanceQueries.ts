import { queryOptions } from '@tanstack/react-query';
import {
  readTeacherAttendanceWeek,
  type TeacherAttendanceWeekResponse,
} from '../api/teacherAttendanceApi';
import { officeQueryKeys } from './officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from './officeQueryPolicy';

/**
 * Both range bounds are server parameters: the channel materialises the
 * sessions inside them, including the virtual rows for sessions that have no
 * document yet. The teacher, class, status and search filters on the page do
 * not belong here — they narrow rows the client already holds.
 */
export function teacherAttendanceWeekQueryOptions(
  identity: OfficeQueryIdentity,
  from: string,
  to: string,
  enabled: boolean
) {
  return queryOptions({
    queryKey: officeQueryKeys.teacherAttendanceWeek(identity, from, to),
    queryFn: () => readTeacherAttendanceWeek(from, to),
    enabled: enabled && Boolean(from) && Boolean(to),
    ...officeSharedQueryOptions,
  });
}

/**
 * Pure so the optimistic write and the rollback share one definition of what
 * "marked" means, and so the previous value stays intact for the rollback.
 */
export function applyTeacherAttendanceMark(
  response: TeacherAttendanceWeekResponse | undefined,
  rowId: string,
  status: 'present' | 'absent'
): TeacherAttendanceWeekResponse | undefined {
  if (!response) return undefined;
  return {
    ...response,
    sessions: response.sessions.map((session) =>
      session.id === rowId
        ? { ...session, teacherAttendanceStatus: status, isVirtual: false }
        : session
    ),
  };
}
