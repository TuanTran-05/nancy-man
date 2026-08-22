type TeacherSalaryRole = string | null | undefined;

export function canViewTeacherSalary(role: TeacherSalaryRole): boolean {
  return role === 'admin' || role === 'accounting' || role === 'teacher';
}

export function applyTeacherSalaryVisibility<T extends { salaryPerSession?: number }>(
  rows: readonly T[],
  role: TeacherSalaryRole
): T[] {
  if (canViewTeacherSalary(role)) return [...rows];
  return rows.map((row) => {
    const next = { ...row };
    delete next.salaryPerSession;
    return next;
  });
}
