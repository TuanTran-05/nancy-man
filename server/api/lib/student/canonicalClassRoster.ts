import type { DocumentStore } from '@/server/db/documentStore.js';
import type { StudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment.js';
import { listCanonicalClassRoster } from './canonicalStudentReadRepository.js';

export type CanonicalClassRosterProfile = {
  id: string;
  name: string;
};

/**
 * Who is in a class, for the surfaces that need nothing but ids and names.
 *
 * Assignment delivery, class counters, and course closing all took this from
 * `students.classId`. That field is a projection of the enrollment and goes
 * stale the moment anything moves a student, so an assignment went out to a
 * child who had already left and skipped one who had just arrived — and the
 * class counters that drive the dashboard counted both of them wrong.
 *
 * The default scope is now, meaning open enrollments only. A caller asking
 * about a term that has ended — course closing, a ledger rebuild — has to name
 * it, because a roster request with no time context has one safe reading.
 */
export async function listCanonicalClassRosterProfiles(
  db: DocumentStore,
  classId: string,
  scope: {
    termStart?: string;
    atDate?: string;
    includeStatuses?: StudentCourseEnrollmentStatus[];
  } = {}
): Promise<CanonicalClassRosterProfile[]> {
  if (!classId) return [];
  const rows = await listCanonicalClassRoster(db, { classId, ...scope });
  return rows.map((row) => ({
    id: row.canonicalProfileId,
    name: String(row.profile.name || ''),
  }));
}
