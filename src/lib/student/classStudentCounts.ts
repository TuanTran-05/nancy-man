import { deriveStudentLifecycle } from '../../../shared/studentLifecycle';

export type ClassStudentCount = {
  total: number;
  active: number;
  trial: number;
  onLeave: number;
  dropped: number;
  promoted: number;
};

type StudentCountRecord = {
  classId?: string;
  enrollmentStatus?: string;
  studentLifecycle?: string;
  isRevoked?: boolean;
  deletedAt?: string;
  placementStatus?: string;
};

/** Buckets keyed by the server's placement status. See `statusFilters`. */
const PLACEMENT_BUCKET: Record<string, keyof Omit<ClassStudentCount, 'total'>> = {
  trial: 'trial',
  studying: 'active',
  on_leave: 'onLeave',
  waiting_for_placement: 'promoted',
  inactive: 'dropped',
};

function emptyCount(): ClassStudentCount {
  return { total: 0, active: 0, trial: 0, onLeave: 0, dropped: 0, promoted: 0 };
}

export function buildClassStudentCounts(
  students: StudentCountRecord[]
): Record<string, ClassStudentCount> {
  const counts: Record<string, ClassStudentCount> = {};
  for (const student of students) {
    const classId = student.classId || '';
    if (!classId) continue;
    counts[classId] ||= emptyCount();
    counts[classId].total++;

    // The enrollment-derived answer wins where the server sent one: a class
    // roster counted from the profile's own status double-counts a student
    // whose course closed and whose next enrollment already began.
    const bucket = student.placementStatus ? PLACEMENT_BUCKET[student.placementStatus] : undefined;
    if (bucket) {
      counts[classId][bucket]++;
      continue;
    }

    const lifecycle = deriveStudentLifecycle(student);
    const status = student.enrollmentStatus || 'active';
    if (lifecycle === 'trial') counts[classId].trial++;
    else if (lifecycle === 'archived') {
      if (status === 'promoted') counts[classId].promoted++;
      else counts[classId].dropped++;
    } else if (status === 'dropped') counts[classId].dropped++;
    else if (status === 'on_leave') counts[classId].onLeave++;
    else if (status === 'promoted') counts[classId].promoted++;
    else counts[classId].active++;
  }
  return counts;
}
