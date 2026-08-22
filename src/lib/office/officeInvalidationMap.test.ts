import { describe, expect, it } from 'vitest';
import { studentDirectoryQueryKeys } from '../student/studentDirectoryQueries';
import { OFFICE_BRIDGE_EVENT_KEYS, resolveOfficeInvalidationKeys } from './officeInvalidationMap';
import { officeQueryKeyPrefixes, officeQueryKeys } from './officeQueryKeys';

const OFFICE = { uid: 'office-1', role: 'office' };

describe('office invalidation map', () => {
  it('targets one class detail and keeps aggregates', () => {
    const keys = resolveOfficeInvalidationKeys('assignments', OFFICE, 'class-2');
    expect(keys).toContainEqual(officeQueryKeys.classAssignments(OFFICE, 'class-2'));
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.studentProfileReport]);
    expect(keys).not.toContainEqual([...officeQueryKeyPrefixes.classAssignments]);
  });

  it('falls back to the bounded class domain without a target', () => {
    expect(resolveOfficeInvalidationKeys('assignments', OFFICE, null)).toContainEqual([
      ...officeQueryKeyPrefixes.classAssignments,
    ]);
  });

  it('maps students to the directory roster, class rosters, and one targeted profile', () => {
    const keys = resolveOfficeInvalidationKeys('students', OFFICE, 'student-7');
    expect(keys).toContainEqual(studentDirectoryQueryKeys.roster(OFFICE));
    expect(keys).toContainEqual(officeQueryKeys.studentIndex(OFFICE));
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.classRoster]);
    expect(keys).toContainEqual(officeQueryKeys.studentProfileReport(OFFICE, 'student-7'));
  });

  it('maps admissions only to pending and history families', () => {
    const keys = resolveOfficeInvalidationKeys('admissions', OFFICE, null);
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.admissionsPending]);
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.admissionsHistory]);
    expect(keys.length).toBe(2);
  });

  it('maps teacher-availability to profile and pending queries', () => {
    const keys = resolveOfficeInvalidationKeys('teacher-availability', OFFICE, null);
    expect(keys).toContainEqual(officeQueryKeys.teacherAvailabilityProfiles(OFFICE));
    expect(keys).toContainEqual(officeQueryKeys.teacherAvailabilityPending(OFFICE));
  });

  it('maps print-requests to print requests root', () => {
    const keys = resolveOfficeInvalidationKeys('print-requests', OFFICE, null);
    expect(keys).toContainEqual(officeQueryKeys.printRequestsRoot(OFFICE));
  });

  it('maps course-closing to academic, month, records, and files', () => {
    const keys = resolveOfficeInvalidationKeys('course-closing', OFFICE, null);
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.academic]);
    expect(keys).toContainEqual(officeQueryKeys.courseClosingMonth(OFFICE));
    expect(keys).toContainEqual(officeQueryKeys.courseClosingRecordsRoot(OFFICE));
    expect(keys).toContainEqual(officeQueryKeys.courseClosingFilesRoot(OFFICE));
  });

  it('maps finance-ledger to academic, exact directory ledger, and student profile', () => {
    const keys = resolveOfficeInvalidationKeys('finance-ledger', OFFICE, 'student-1');
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.academic]);
    expect(keys).toContainEqual(studentDirectoryQueryKeys.ledgers(OFFICE));
    expect(keys).toContainEqual(officeQueryKeys.studentProfileReport(OFFICE, 'student-1'));
  });

  it('maps submissions to class submissions, graded submissions, and student profile', () => {
    const keys = resolveOfficeInvalidationKeys('submissions', OFFICE, 'class-1');
    expect(keys).toContainEqual(officeQueryKeys.classSubmissions(OFFICE, 'class-1'));
    expect(keys).toContainEqual(studentDirectoryQueryKeys.gradedSubmissions(OFFICE));
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.studentProfileReport]);
  });

  it('maps office-schedule-changed to schedule and reference families', () => {
    const keys = resolveOfficeInvalidationKeys('office-schedule-changed', OFFICE, 'class-1');
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.weeklyDashboard]);
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.teachersMonth]);
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.teacherAttendanceWeek]);
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.classList]);
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.teacherReferences]);
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.holidays]);
    expect(keys).toContainEqual(officeQueryKeys.classMetadata(OFFICE, 'class-1'));
    expect(keys).toContainEqual(officeQueryKeys.classSessions(OFFICE, 'class-1'));
  });

  it('maps office-academic-changed to academic, evaluations, sessions, and daily reports', () => {
    const keys = resolveOfficeInvalidationKeys('office-academic-changed', OFFICE, 'class-1');
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.academic]);
    expect(keys).toContainEqual(officeQueryKeys.classEvaluations(OFFICE, 'class-1'));
    expect(keys).toContainEqual(officeQueryKeys.classSessions(OFFICE, 'class-1'));
    expect(keys).toContainEqual(officeQueryKeys.classDailyReports(OFFICE, 'class-1'));
    expect(keys).toContainEqual(officeQueryKeys.courseClosingRecordsRoot(OFFICE));
    expect(keys).toContainEqual(officeQueryKeys.courseClosingFilesRoot(OFFICE));
  });

  it('never narrows a family whose key has no segment for the target kind', () => {
    const keys = resolveOfficeInvalidationKeys('submissions', OFFICE, 'class-2');
    // targetId is a class, and studentProfileReport is keyed by student.
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.studentProfileReport]);
    expect(keys).not.toContainEqual(officeQueryKeys.studentProfileReport(OFFICE, 'class-2'));
  });

  it('keeps aggregates broad under a class target', () => {
    const keys = resolveOfficeInvalidationKeys('office-academic-changed', OFFICE, 'class-2');
    expect(keys).toContainEqual([...officeQueryKeyPrefixes.academic]);
    expect(keys).toContainEqual(officeQueryKeys.classEvaluations(OFFICE, 'class-2'));
  });

  it('maps every registered key family through at least one event', () => {
    const mapped = new Set(
      OFFICE_BRIDGE_EVENT_KEYS.flatMap((eventKey) =>
        resolveOfficeInvalidationKeys(eventKey, OFFICE, null).map((key) => String(key[0]))
      )
    );
    for (const prefix of Object.values(officeQueryKeyPrefixes)) {
      expect(mapped).toContain(prefix[0]);
    }
  });
});
