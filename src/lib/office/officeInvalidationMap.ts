import type { QueryKey } from '@tanstack/react-query';
import type { RealtimeEventKey } from '../realtime/realtimeEventKeys';
import { studentDirectoryQueryKeys } from '../student/studentDirectoryQueries';
import { officeQueryKeyPrefixes, officeQueryKeys } from './officeQueryKeys';
import type { OfficeQueryIdentity } from './officeQueryPolicy';

type TargetKind = 'class' | 'student';

type FamilyRule =
  | { type: 'broad'; prefix: readonly string[] }
  | { type: 'exact-identity'; key: (identity: OfficeQueryIdentity) => QueryKey }
  | {
      type: 'exact-target';
      prefix: readonly string[];
      key: (identity: OfficeQueryIdentity, target: string) => QueryKey;
      kind: TargetKind;
    };

interface EventMapEntry {
  targetKind?: TargetKind;
  rules: readonly FamilyRule[];
}

/**
 * The single place an event key resolves to query cache keys/prefixes.
 *
 * A target narrows ONLY a family whose key already contains that parameter.
 * Every other family in the same event stays broad.
 */
export const OFFICE_EVENT_MAP: Partial<Record<RealtimeEventKey, EventMapEntry>> = {
  'office-schedule-changed': {
    targetKind: 'class',
    rules: [
      { type: 'broad', prefix: officeQueryKeyPrefixes.weeklyDashboard },
      { type: 'broad', prefix: officeQueryKeyPrefixes.teachersMonth },
      { type: 'broad', prefix: officeQueryKeyPrefixes.teacherAttendanceWeek },
      { type: 'broad', prefix: officeQueryKeyPrefixes.classList },
      { type: 'broad', prefix: officeQueryKeyPrefixes.teacherReferences },
      { type: 'broad', prefix: officeQueryKeyPrefixes.holidays },
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.classMetadata,
        key: (id, target) => officeQueryKeys.classMetadata(id, target),
        kind: 'class',
      },
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.classSessions,
        key: (id, target) => officeQueryKeys.classSessions(id, target),
        kind: 'class',
      },
    ],
  },
  'office-academic-changed': {
    targetKind: 'class',
    rules: [
      { type: 'broad', prefix: officeQueryKeyPrefixes.academic },
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.classEvaluations,
        key: (id, target) => officeQueryKeys.classEvaluations(id, target),
        kind: 'class',
      },
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.classSessions,
        key: (id, target) => officeQueryKeys.classSessions(id, target),
        kind: 'class',
      },
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.classDailyReports,
        key: (id, target) => officeQueryKeys.classDailyReports(id, target),
        kind: 'class',
      },
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.courseClosingRecordsRoot(id),
      },
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.courseClosingFilesRoot(id),
      },
    ],
  },
  'teacher-attendance': {
    rules: [
      { type: 'broad', prefix: officeQueryKeyPrefixes.teacherAttendanceWeek },
      { type: 'broad', prefix: officeQueryKeyPrefixes.teachersMonth },
    ],
  },
  'teacher-availability': {
    rules: [
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.teacherAvailabilityProfiles(id),
      },
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.teacherAvailabilityPending(id),
      },
    ],
  },
  'print-requests': {
    rules: [
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.printRequestsRoot(id),
      },
    ],
  },
  students: {
    targetKind: 'student',
    rules: [
      { type: 'broad', prefix: officeQueryKeyPrefixes.weeklyDashboard },
      { type: 'broad', prefix: officeQueryKeyPrefixes.academic },
      {
        type: 'exact-identity',
        key: (id) => studentDirectoryQueryKeys.roster(id),
      },
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.studentIndex(id),
      },
      { type: 'broad', prefix: officeQueryKeyPrefixes.classRoster },
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.studentProfileReport,
        key: (id, target) => officeQueryKeys.studentProfileReport(id, target),
        kind: 'student',
      },
    ],
  },
  'finance-ledger': {
    targetKind: 'student',
    rules: [
      { type: 'broad', prefix: officeQueryKeyPrefixes.academic },
      {
        type: 'exact-identity',
        key: (id) => studentDirectoryQueryKeys.ledgers(id),
      },
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.studentProfileReport,
        key: (id, target) => officeQueryKeys.studentProfileReport(id, target),
        kind: 'student',
      },
    ],
  },
  submissions: {
    targetKind: 'class',
    rules: [
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.classSubmissions,
        key: (id, target) => officeQueryKeys.classSubmissions(id, target),
        kind: 'class',
      },
      {
        type: 'exact-identity',
        key: (id) => studentDirectoryQueryKeys.gradedSubmissions(id),
      },
      { type: 'broad', prefix: officeQueryKeyPrefixes.studentProfileReport },
    ],
  },
  assignments: {
    targetKind: 'class',
    rules: [
      {
        type: 'exact-target',
        prefix: officeQueryKeyPrefixes.classAssignments,
        key: (id, target) => officeQueryKeys.classAssignments(id, target),
        kind: 'class',
      },
      { type: 'broad', prefix: officeQueryKeyPrefixes.studentProfileReport },
    ],
  },
  admissions: {
    rules: [
      { type: 'broad', prefix: officeQueryKeyPrefixes.admissionsPending },
      { type: 'broad', prefix: officeQueryKeyPrefixes.admissionsHistory },
    ],
  },
  'course-closing': {
    targetKind: 'class',
    rules: [
      { type: 'broad', prefix: officeQueryKeyPrefixes.academic },
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.courseClosingMonth(id),
      },
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.courseClosingRecordsRoot(id),
      },
      {
        type: 'exact-identity',
        key: (id) => officeQueryKeys.courseClosingFilesRoot(id),
      },
    ],
  },
};

export const OFFICE_BRIDGE_EVENT_KEYS = Object.keys(OFFICE_EVENT_MAP) as RealtimeEventKey[];

export function resolveOfficeInvalidationKeys(
  eventKey: RealtimeEventKey,
  identity: OfficeQueryIdentity,
  targetId?: string | null
): readonly QueryKey[] {
  const target = String(targetId || '').trim();
  const entry = OFFICE_EVENT_MAP[eventKey];
  if (!entry) return [];

  const keys: QueryKey[] = [];
  for (const rule of entry.rules) {
    if (rule.type === 'broad') {
      keys.push([...rule.prefix]);
    } else if (rule.type === 'exact-identity') {
      keys.push(rule.key(identity));
    } else if (rule.type === 'exact-target') {
      if (target && entry.targetKind === rule.kind) {
        keys.push(rule.key(identity, target));
      } else {
        keys.push([...rule.prefix]);
      }
    }
  }
  return keys;
}
