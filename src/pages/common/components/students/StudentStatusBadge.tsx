import React from 'react';
import type { SafeStudent } from '../../../../types';
import { deriveStudentLifecycle } from '../../../../../shared/studentLifecycle';
import { readPlacementStatus } from '../../../../lib/student/statusFilters';
import type { CanonicalStudentPlacementStatus } from '../../../../../shared/canonicalStudentReadModel';

/** Placement statuses in the badge's own vocabulary. See `statusFilters`. */
const PLACEMENT_TO_BADGE_STATUS: Record<CanonicalStudentPlacementStatus, string> = {
  trial: 'active',
  studying: 'active',
  on_leave: 'on_leave',
  waiting_for_placement: 'promoted',
  inactive: 'dropped',
};

interface StudentStatusBadgeProps {
  student: Pick<SafeStudent, 'enrollmentStatus' | 'studentId'>;
  t: any;
  waitingPromotionStatusLabel: string;
}

export const StudentStatusBadge: React.FC<StudentStatusBadgeProps> = ({
  student,
  t,
  waitingPromotionStatusLabel,
}) => {
  const lifecycle = deriveStudentLifecycle(student);
  if (lifecycle === 'trial') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
        Trial
      </span>
    );
  }
  if (lifecycle === 'archived') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
        Archived
      </span>
    );
  }
  // The enrollment-derived answer where the server sent one. The profile's
  // `enrollmentStatus` is a projection of the same thing that goes stale on
  // its own, so a student whose course closed still reads `active` there.
  const placement = readPlacementStatus(student as Record<string, unknown>);
  const currentStatus = placement
    ? PLACEMENT_TO_BADGE_STATUS[placement]
    : student.enrollmentStatus || 'active';
  if (currentStatus === 'active') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:text-emerald-400">
        {t.filterActive}
      </span>
    );
  }
  if (currentStatus === 'on_leave') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:text-amber-400">
        {t.filterOnLeave}
      </span>
    );
  }
  if (currentStatus === 'dropped') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 dark:text-red-400">
        {t.filterDropped}
      </span>
    );
  }
  if (currentStatus === 'promoted') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:text-blue-400">
        {waitingPromotionStatusLabel}
      </span>
    );
  }
  return null;
};
