import { deriveStudentLifecycle } from '../../../shared/studentLifecycle';
import type { CanonicalStudentPlacementStatus } from '../../../shared/canonicalStudentReadModel';

export type StudentStatusFilter =
  | 'all'
  | 'enrolled'
  | 'trial'
  | 'archived'
  | 'active'
  | 'on_leave'
  | 'dropped'
  | 'promoted';

type StudentStatusFilterRecord = {
  studentLifecycle?: unknown;
  enrollmentStatus?: unknown;
  isRevoked?: unknown;
  deletedAt?: unknown;
  placementStatus?: unknown;
};

/**
 * The filter vocabulary the UI has always used, restated in terms of the
 * server's placement status.
 *
 * `waiting_for_placement` maps to `promoted` because that is the value the
 * filter chip, the badge, and the saved views are all written against. The
 * honest name lives on the server; renaming it here would be a UI change
 * riding along with an identity change, which is two things at once.
 */
const PLACEMENT_TO_FILTER: Record<CanonicalStudentPlacementStatus, StudentStatusFilter> = {
  trial: 'trial',
  studying: 'active',
  on_leave: 'on_leave',
  waiting_for_placement: 'promoted',
  inactive: 'dropped',
};

export function readPlacementStatus(
  record: StudentStatusFilterRecord
): CanonicalStudentPlacementStatus | null {
  const value = record.placementStatus;
  return typeof value === 'string' && value in PLACEMENT_TO_FILTER
    ? (value as CanonicalStudentPlacementStatus)
    : null;
}

export function matchesStudentStatusFilter(
  student: StudentStatusFilterRecord,
  filter: StudentStatusFilter
): boolean {
  if (filter === 'all') return true;

  const lifecycle = deriveStudentLifecycle(student);
  if (filter === 'enrolled') return lifecycle === 'enrolled';
  if (filter === 'trial') return lifecycle === 'trial';
  if (filter === 'archived') return lifecycle === 'archived';
  if (lifecycle !== 'enrolled') return false;

  // Where the server derived the answer from the enrollment, repeat it. The
  // profile's `enrollmentStatus` is a projection of the same thing that goes
  // stale on its own — a student whose course closed still reads `active`
  // there long after they stopped attending it.
  const placement = readPlacementStatus(student);
  if (placement) return PLACEMENT_TO_FILTER[placement] === filter;

  const currentStatus = student.enrollmentStatus || 'active';
  return filter === currentStatus;
}
