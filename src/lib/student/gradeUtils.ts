import { isApiDateOnly } from '../../../shared/dateTimeFormat';

export function getSuggestedGrade(dob: string): number | null {
  if (!dob) return null;
  const normalizedDob = dob.trim();
  if (!isApiDateOnly(normalizedDob)) return null;
  const birthYear = Number(normalizedDob.slice(0, 4));
  const now = new Date();
  const schoolYear = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const grade = schoolYear - birthYear - 5;
  return grade >= 1 && grade <= 12 ? grade : null;
}
