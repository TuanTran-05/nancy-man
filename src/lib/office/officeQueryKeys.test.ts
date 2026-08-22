import { describe, expect, it } from 'vitest';
import { officeQueryKeys, officeQueryKeyPrefixes } from './officeQueryKeys';

const OFFICE = { uid: 'office-1', role: 'office' };
const ADMIN = { uid: 'admin-1', role: 'admin' };

describe('office query keys', () => {
  it('separates the same page by identity', () => {
    expect(officeQueryKeys.weeklyDashboard(OFFICE)).not.toEqual(
      officeQueryKeys.weeklyDashboard(ADMIN)
    );
  });

  it('separates the same identity by role', () => {
    expect(officeQueryKeys.weeklyDashboard({ uid: 'u1', role: 'office' })).not.toEqual(
      officeQueryKeys.weeklyDashboard({ uid: 'u1', role: 'admin' })
    );
  });

  it('separates teacher summaries by month', () => {
    expect(officeQueryKeys.teachersMonth(OFFICE, '2026-08')).not.toEqual(
      officeQueryKeys.teachersMonth(OFFICE, '2026-09')
    );
  });

  it('separates attendance by both range bounds', () => {
    expect(officeQueryKeys.teacherAttendanceWeek(OFFICE, '2026-08-10', '2026-08-16')).not.toEqual(
      officeQueryKeys.teacherAttendanceWeek(OFFICE, '2026-08-17', '2026-08-23')
    );
    expect(officeQueryKeys.teacherAttendanceWeek(OFFICE, '2026-08-10', '2026-08-16')).not.toEqual(
      officeQueryKeys.teacherAttendanceWeek(OFFICE, '2026-08-10', '2026-08-17')
    );
  });

  it('separates admissions history pages by cursor and page size', () => {
    expect(officeQueryKeys.admissionsHistoryPage(OFFICE, 10, null)).not.toEqual(
      officeQueryKeys.admissionsHistoryPage(OFFICE, 10, 'cursor-2')
    );
    expect(officeQueryKeys.admissionsHistoryPage(OFFICE, 10, null)).not.toEqual(
      officeQueryKeys.admissionsHistoryPage(OFFICE, 20, null)
    );
  });

  it('separates class detail data by class and attendance term', () => {
    expect(officeQueryKeys.classMetadata(OFFICE, 'class-1')).not.toEqual(
      officeQueryKeys.classMetadata(OFFICE, 'class-2')
    );
    expect(officeQueryKeys.classRoster(OFFICE, 'class-1', '')).not.toEqual(
      officeQueryKeys.classRoster(OFFICE, 'class-1', '2026-08-01')
    );
  });

  it('separates student reports by student id', () => {
    expect(officeQueryKeys.studentProfileReport(OFFICE, 'student-1')).not.toEqual(
      officeQueryKeys.studentProfileReport(OFFICE, 'student-2')
    );
  });

  it('separates course closing records by month and normalized search', () => {
    expect(officeQueryKeys.courseClosingRecords(OFFICE, '2026-08', 'foo')).not.toEqual(
      officeQueryKeys.courseClosingRecords(OFFICE, '2026-08', 'bar')
    );
    expect(officeQueryKeys.courseClosingRecords(OFFICE, '2026-08', ' foo ')).toEqual(
      officeQueryKeys.courseClosingRecords(OFFICE, '2026-08', 'foo')
    );
  });

  it('separates print requests by created, needed, and status server filters', () => {
    expect(
      officeQueryKeys.printRequestsList(OFFICE, '2026-08-01', '2026-08-02', 'pending')
    ).not.toEqual(
      officeQueryKeys.printRequestsList(OFFICE, '2026-08-01', '2026-08-02', 'completed')
    );
  });

  it('returns the same key for the same inputs', () => {
    expect(officeQueryKeys.teachersMonth(OFFICE, '2026-08')).toEqual(
      officeQueryKeys.teachersMonth(OFFICE, '2026-08')
    );
  });

  // The bridge invalidates by prefix. If a key stops starting with its prefix,
  // events silently stop reaching that page.
  it('starts every key with its own bridge prefix', () => {
    const cases: Array<[readonly string[], readonly unknown[]]> = [
      [officeQueryKeyPrefixes.weeklyDashboard, officeQueryKeys.weeklyDashboard(OFFICE)],
      [officeQueryKeyPrefixes.teachersMonth, officeQueryKeys.teachersMonth(OFFICE, '2026-08')],
      [
        officeQueryKeyPrefixes.teacherAttendanceWeek,
        officeQueryKeys.teacherAttendanceWeek(OFFICE, '2026-08-10', '2026-08-16'),
      ],
      [officeQueryKeyPrefixes.academic, officeQueryKeys.academic(OFFICE)],
      [officeQueryKeyPrefixes.admissionsPending, officeQueryKeys.admissionsPending(OFFICE)],
      [
        officeQueryKeyPrefixes.admissionsHistory,
        officeQueryKeys.admissionsHistoryPage(OFFICE, 10, null),
      ],
      [officeQueryKeyPrefixes.classList, officeQueryKeys.classList(OFFICE)],
      [officeQueryKeyPrefixes.teacherReferences, officeQueryKeys.teacherReferences(OFFICE)],
      [officeQueryKeyPrefixes.holidays, officeQueryKeys.holidays(OFFICE)],
      [officeQueryKeyPrefixes.studentIndex, officeQueryKeys.studentIndex(OFFICE)],
      [officeQueryKeyPrefixes.classMetadata, officeQueryKeys.classMetadata(OFFICE, 'c1')],
      [officeQueryKeyPrefixes.classRoster, officeQueryKeys.classRoster(OFFICE, 'c1', '')],
      [officeQueryKeyPrefixes.classEvaluations, officeQueryKeys.classEvaluations(OFFICE, 'c1')],
      [officeQueryKeyPrefixes.classAssignments, officeQueryKeys.classAssignments(OFFICE, 'c1')],
      [officeQueryKeyPrefixes.classSubmissions, officeQueryKeys.classSubmissions(OFFICE, 'c1')],
      [officeQueryKeyPrefixes.classSessions, officeQueryKeys.classSessions(OFFICE, 'c1')],
      [officeQueryKeyPrefixes.classDailyReports, officeQueryKeys.classDailyReports(OFFICE, 'c1')],
      [
        officeQueryKeyPrefixes.studentProfileReport,
        officeQueryKeys.studentProfileReport(OFFICE, 's1'),
      ],
      [
        officeQueryKeyPrefixes.teacherAvailabilityProfiles,
        officeQueryKeys.teacherAvailabilityProfiles(OFFICE),
      ],
      [
        officeQueryKeyPrefixes.teacherAvailabilityPending,
        officeQueryKeys.teacherAvailabilityPending(OFFICE),
      ],
      [officeQueryKeyPrefixes.courseClosingMonth, officeQueryKeys.courseClosingMonth(OFFICE)],
      [
        officeQueryKeyPrefixes.courseClosingRecords,
        officeQueryKeys.courseClosingRecords(OFFICE, '2026-08', ''),
      ],
      [
        officeQueryKeyPrefixes.courseClosingFiles,
        officeQueryKeys.courseClosingFile(OFFICE, 'r1', 'overview', 'inline'),
      ],
      [
        officeQueryKeyPrefixes.printRequests,
        officeQueryKeys.printRequestsList(OFFICE, '', '', 'all'),
      ],
    ];

    for (const [prefix, key] of cases) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    }
  });

  it('does not share a prefix between two different domains', () => {
    const prefixes = Object.values(officeQueryKeyPrefixes).map((prefix) => prefix.join('/'));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
