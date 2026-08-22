import type { Class } from '../../types';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../shared/classVisibility';
import { sortClassesByTeacherThenName } from '../classes/sortClasses';
import { readOfficeAcademicReferences } from '../api/frontendReadApi';

export type StudentEditReferenceData = {
  classes: Class[];
  sortedClasses: Class[];
  filterableClasses: Class[];
  teachers: { uid: string; displayName: string }[];
};

export async function loadStudentEditReferenceData(args: {
  role: string | undefined;
  currentClass: Class;
}): Promise<StudentEditReferenceData> {
  const { role, currentClass } = args;
  if (role !== 'admin' && role !== 'office') {
    return {
      classes: [currentClass],
      sortedClasses: [currentClass],
      filterableClasses: [currentClass],
      teachers: [],
    };
  }

  const data = await readOfficeAcademicReferences();
  const classRows = data.classes || [];
  const filtered = filterClassesForRoleOutsideAdminDashboard(classRows, role);
  if (!filtered.some((c) => c.id === currentClass.id)) {
    filtered.push(currentClass);
  }
  const teachers = data.teachers || [];
  const sortedClasses = sortClassesByTeacherThenName(filtered, teachers);
  const filterableClasses = sortedClasses.filter((c) => c.status !== 'archived');

  return {
    classes: filtered,
    sortedClasses,
    filterableClasses,
    teachers,
  };
}

export async function loadStudentProfileSupportData(role: string | undefined): Promise<{
  classes: Class[];
  teachers: { uid: string; displayName: string }[];
}> {
  if (role !== 'admin' && role !== 'office') return { classes: [], teachers: [] };

  const data = await readOfficeAcademicReferences();
  const classRows = data.classes || [];
  return {
    classes: filterClassesForRoleOutsideAdminDashboard(classRows, role),
    teachers: data.teachers || [],
  };
}
