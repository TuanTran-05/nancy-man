/** Accounting only ever needs the finance tab of a student profile. */
export function buildStudentProfileHref(
  studentId: string,
  params: Record<string, string | undefined> = {}
): string {
  const query = new URLSearchParams({ tab: 'finance' });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/students/${encodeURIComponent(studentId)}?${query.toString()}`;
}
