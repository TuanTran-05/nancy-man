export type ClassSortInput = {
  id?: string;
  name?: string;
  teacherId?: string;
  teacherName?: string;
};

export type ClassDisplaySortInput = ClassSortInput & {
  grade?: number | string | null;
  status?: string | null;
};

export type TeacherSortInput = {
  uid?: string;
  id?: string;
  displayName?: string;
  name?: string;
  email?: string;
};

export type TeacherLookup =
  | readonly TeacherSortInput[]
  | Map<string, TeacherSortInput | string | undefined>;

const classSortCollator = new Intl.Collator('vi', {
  numeric: true,
  sensitivity: 'base',
});

const UNKNOWN_GRADE_SORT_VALUE = Number.MAX_SAFE_INTEGER;

const classStatusSortOrder: Record<string, number> = {
  active: 0,
  paused: 1,
  archived: 2,
};

function getTeacherLookupName(value: TeacherSortInput | string | undefined) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.displayName || value.name || value.email || '';
}

export function getClassTeacherDisplayName(classInfo: ClassSortInput, teachers?: TeacherLookup) {
  if (classInfo.teacherName) return classInfo.teacherName;
  if (!classInfo.teacherId) return '';

  if (teachers instanceof Map) {
    return getTeacherLookupName(teachers.get(classInfo.teacherId));
  }

  const teacher = teachers?.find(
    (item) => item.uid === classInfo.teacherId || item.id === classInfo.teacherId
  );
  return getTeacherLookupName(teacher);
}

function getTeacherSortName(classInfo: ClassSortInput, teachers?: TeacherLookup) {
  const displayName = getClassTeacherDisplayName(classInfo, teachers);
  if (displayName) return displayName;
  if (!classInfo.teacherId) return '';
  return classInfo.teacherId;
}

export function sortClassesByTeacherThenName<T extends ClassSortInput>(
  classes: readonly T[],
  teachers?: TeacherLookup
) {
  return [...classes].sort((a, b) => {
    const teacherCompare = classSortCollator.compare(
      getTeacherSortName(a, teachers),
      getTeacherSortName(b, teachers)
    );
    if (teacherCompare !== 0) return teacherCompare;
    return classSortCollator.compare(a.name || '', b.name || '');
  });
}

function normalizeClassName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseGradeFromClassName(name?: string) {
  if (!name) return UNKNOWN_GRADE_SORT_VALUE;

  const normalizedName = normalizeClassName(name);
  const gradePattern = '(0?[1-9]|1[0-2])';
  const patterns = [
    new RegExp(`\\b(?:grade|khoi|k|g)\\s*${gradePattern}\\b`, 'i'),
    new RegExp(`\\b(?:advance|advanced)\\s*${gradePattern}\\b`, 'i'),
    new RegExp(`(?:^|\\D)${gradePattern}(?:\\D|$)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = normalizedName.match(pattern);
    if (!match) continue;

    const grade = Number(match[1]);
    if (grade >= 1 && grade <= 12) return grade;
  }

  return UNKNOWN_GRADE_SORT_VALUE;
}

export function getClassSortGrade(classInfo: Pick<ClassDisplaySortInput, 'grade' | 'name'>) {
  const grade = Number(classInfo.grade);
  if (Number.isInteger(grade) && grade >= 1 && grade <= 12) return grade;
  return parseGradeFromClassName(classInfo.name);
}

function getClassStatusSortOrder(status?: string | null) {
  return classStatusSortOrder[status || 'active'] ?? classStatusSortOrder.active;
}

export function sortClassesByStatusGradeName<T extends ClassDisplaySortInput>(
  classes: readonly T[],
  options: {
    teachers?: TeacherLookup;
    getStatus?: (classInfo: T) => string | null | undefined;
  } = {}
) {
  return [...classes].sort((a, b) => {
    const statusCompare =
      getClassStatusSortOrder(options.getStatus?.(a) ?? a.status) -
      getClassStatusSortOrder(options.getStatus?.(b) ?? b.status);
    if (statusCompare !== 0) return statusCompare;

    const gradeCompare = getClassSortGrade(a) - getClassSortGrade(b);
    if (gradeCompare !== 0) return gradeCompare;

    const nameCompare = classSortCollator.compare(a.name || '', b.name || '');
    if (nameCompare !== 0) return nameCompare;

    const teacherCompare = classSortCollator.compare(
      getTeacherSortName(a, options.teachers),
      getTeacherSortName(b, options.teachers)
    );
    if (teacherCompare !== 0) return teacherCompare;

    return classSortCollator.compare(a.id || '', b.id || '');
  });
}

export function formatClassNameWithTeacher(
  classInfo: ClassSortInput,
  teachers?: TeacherLookup,
  fallbackTeacherName = 'GV'
) {
  const className = classInfo.name || '';
  const teacherName = getClassTeacherDisplayName(classInfo, teachers);
  if (teacherName) return `${className} - ${teacherName}`;
  if (classInfo.teacherId) return `${className} - ${fallbackTeacherName}`;
  return className;
}
