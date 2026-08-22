import type { ReportStudentScope } from './reportStudentScope';

type StudentChartRecord = {
  id?: string;
  classId?: string;
  gender?: string;
};

type ReportClass = {
  id: string;
  name: string;
};

export function buildCurrentStudentStatusCounts<T>(
  scope: Pick<ReportStudentScope<T>, 'learning' | 'trial' | 'onLeave' | 'total'>
) {
  return {
    learning: scope.learning,
    trial: scope.trial,
    onLeave: scope.onLeave,
    total: scope.total,
  };
}

export function buildStudentsPerClassCounts<T extends Pick<StudentChartRecord, 'classId'>>(
  students: readonly T[],
  visibleClasses: readonly ReportClass[]
) {
  const visibleClassIds = new Set(visibleClasses.map((classInfo) => classInfo.id));
  const perClass = visibleClasses.map((classInfo) => ({
    classId: classInfo.id,
    label: classInfo.name,
    value: students.filter((student) => student.classId === classInfo.id).length,
  }));
  const outsideVisibleClasses = students.filter(
    (student) => !visibleClassIds.has(String(student.classId || ''))
  ).length;

  return {
    perClass,
    outsideVisibleClasses,
    total: perClass.reduce((sum, item) => sum + item.value, 0) + outsideVisibleClasses,
  };
}

export function buildGenderCounts<T extends Pick<StudentChartRecord, 'gender'>>(
  students: readonly T[]
) {
  let male = 0;
  let female = 0;
  let other = 0;

  for (const student of students) {
    if (student.gender === 'male') male += 1;
    else if (student.gender === 'female') female += 1;
    else other += 1;
  }

  return { male, female, other, total: male + female + other };
}

export function findUnevaluatedStudents<T extends Pick<StudentChartRecord, 'id'>>(
  students: readonly T[],
  evaluatedStudentIds: ReadonlySet<string>
): T[] {
  return students.filter((student) => !evaluatedStudentIds.has(String(student.id || '')));
}
