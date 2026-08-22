/** Roll out the accounting student workspace independently from legacy tabs. */
export function isAccountingStudentWorkspaceEnabled(
  env: Record<string, unknown> = import.meta.env
): boolean {
  const rawValue = env.VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE;
  if (rawValue === undefined || rawValue === null || rawValue === '') return true;
  return String(rawValue).toLowerCase() !== 'false';
}

export const ACCOUNTING_STUDENT_WORKSPACE_ENABLED = isAccountingStudentWorkspaceEnabled();
