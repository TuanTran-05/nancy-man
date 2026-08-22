import { describe, expect, it, vi } from 'vitest';
import { createInMemoryDocumentStore } from '../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';
import {
  classifyAttendanceEligibilityAudit,
  parseAttendanceEligibilityAuditArgs,
  resolveAttendanceEligibilityAuditTarget,
  runAttendanceEligibilityAudit,
  type AttendanceEligibilityAuditInput,
} from './audit-attendance-session-eligibility.js';

const TERM: AttendanceEligibilityAuditInput['terms'][number] = {
  classId: 'class-1',
  termStart: '2026-05-01',
  termEnd: '2026-08-31',
};

describe('classifyAttendanceEligibilityAudit', () => {
  it('reports return-boundary sessions without changing them', () => {
    const manifest = classifyAttendanceEligibilityAudit(
      {
        students: [
          {
            id: 'student-1',
            classId: 'class-1',
            leavePeriods: [{ from: '2026-05-01', until: '2026-05-10', classId: 'class-1' }],
          },
        ],
        enrollments: [],
        attendance: [
          {
            studentId: 'student-1',
            classId: 'class-1',
            date: '2026-05-10',
            status: 'present',
          },
        ],
        scheduledSessions: [{ classId: 'class-1', date: '2026-05-10' }],
        terms: [TERM],
      },
      '2026-08-13T00:00:00.000Z'
    );

    expect(manifest.returnBoundarySessions).toEqual([
      expect.objectContaining({
        studentId: 'student-1',
        date: '2026-05-10',
        attendanceStatus: 'present',
      }),
    ]);
    expect(manifest.writeCount).toBe(0);
    expect(manifest.generatedAt).toBe('2026-08-13T00:00:00.000Z');
  });

  it('excludes voided records from realAttendanceAgainstIneligibility', () => {
    const manifest = classifyAttendanceEligibilityAudit(
      {
        students: [
          {
            id: 'student-1',
            classId: 'class-1',
            leavePeriods: [{ from: '2026-05-01', until: '2026-05-15', classId: 'class-1' }],
          },
        ],
        enrollments: [],
        attendance: [
          // voided — must not appear
          { studentId: 'student-1', classId: 'class-1', date: '2026-05-05', status: 'present', isVoided: true },
          // malformed status — must not appear
          { studentId: 'student-1', classId: 'class-1', date: '2026-05-06', status: 'unmarked' as any },
          // real ineligible record — must appear
          { studentId: 'student-1', classId: 'class-1', date: '2026-05-07', status: 'absent' },
        ],
        scheduledSessions: [],
        terms: [TERM],
      },
      '2026-08-13T00:00:00.000Z'
    );

    expect(manifest.realAttendanceAgainstIneligibility).toHaveLength(1);
    expect(manifest.realAttendanceAgainstIneligibility[0]).toMatchObject({
      studentId: 'student-1',
      date: '2026-05-07',
      eligibility: 'on_leave',
      attendanceStatus: 'absent',
    });
  });

  it('reports malformed courseJoins and leavePeriods without throwing', () => {
    const manifest = classifyAttendanceEligibilityAudit(
      {
        students: [
          {
            id: 'student-1',
            classId: 'class-1',
            // Impossible calendar date — rejected as malformed
            courseJoins: [{ classId: 'class-1', termStart: '2026-02-30', joinedAt: '2026-02-30' }],
            leavePeriods: [{ from: '2026-13-01', until: '2026-13-10', classId: 'class-1' }],
          },
        ],
        enrollments: [],
        attendance: [],
        scheduledSessions: [],
        terms: [],
      },
      '2026-08-13T00:00:00.000Z'
    );

    expect(manifest.malformedCourseJoins).toHaveLength(1);
    expect(manifest.malformedCourseJoins[0].studentId).toBe('student-1');
    expect(manifest.malformedLeavePeriods).toHaveLength(1);
  });

  it('flags a term with no exact enrollment evidence when enrollmentDate is also missing', () => {
    const manifest = classifyAttendanceEligibilityAudit(
      {
        students: [
          { id: 'student-1', classId: 'class-1' },
        ],
        enrollments: [],
        attendance: [],
        scheduledSessions: [],
        terms: [TERM],
      },
      '2026-08-13T00:00:00.000Z'
    );

    expect(manifest.missingCourseEvidence).toEqual([
      { studentId: 'student-1', classId: 'class-1', termStart: '2026-05-01' },
    ]);
  });

  it('does not flag a term when a canonical enrollment provides evidence', () => {
    const manifest = classifyAttendanceEligibilityAudit(
      {
        students: [{ id: 'student-1', classId: 'class-1' }],
        enrollments: [
          {
            id: 'enroll-1',
            studentId: 'student-1',
            classId: 'class-1',
            termStart: '2026-05-01',
            termEnd: '2026-08-31',
            joinedAt: '2026-05-01',
            endedAt: null,
            status: 'active',
            statusReason: null,
            source: 'system',
            confidence: 'confirmed',
            statusChangedAt: '2026-05-01T00:00:00.000Z',
            statusChangedBy: 'seed',
            confirmedAt: '2026-05-01T00:00:00.000Z',
            confirmedBy: 'seed',
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
          } as any,
        ],
        attendance: [],
        scheduledSessions: [],
        terms: [TERM],
      },
      '2026-08-13T00:00:00.000Z'
    );

    expect(manifest.missingCourseEvidence).toHaveLength(0);
  });
});

describe('attendance eligibility audit executable adapter', () => {
  it('requires and parses an explicit output path', () => {
    expect(parseAttendanceEligibilityAuditArgs(['--output', 'scratch/audit.json'])).toEqual({
      outputPath: 'scratch/audit.json',
    });
    expect(() => parseAttendanceEligibilityAuditArgs([])).toThrow(/--output/i);
  });

  it('fails closed when the project or named database target is missing', () => {
    expect(() => resolveAttendanceEligibilityAuditTarget({
      FIREBASE_PROJECT_ID: 'project-1',
    })).toThrow(/FIRESTORE_DATABASE_ID/);
    expect(() => resolveAttendanceEligibilityAuditTarget({
      FIRESTORE_DATABASE_ID: 'production',
    })).toThrow(/FIREBASE_PROJECT_ID/);
    expect(resolveAttendanceEligibilityAuditTarget({
      FIREBASE_PROJECT_ID: 'project-1',
      FIRESTORE_DATABASE_ID: 'production',
    })).toEqual({ projectId: 'project-1', databaseId: 'production' });
  });

  it('reads the audit collections, builds the effective calendar, and writes only local JSON', async () => {
    const enrollmentId = makeStudentCourseEnrollmentId(
      'student-1',
      'class-1',
      '2026-05-01'
    );
    const { db, readLog, writeLog } = createInMemoryDocumentStore({
      'students/student-1': {
        classId: 'class-1',
        leavePeriods: [
          { classId: 'class-1', from: '2026-05-01', until: '2026-05-11' },
          { classId: 'class-1', from: '2026-05-01', until: '2026-05-12' },
          { classId: 'class-1', from: '2026-05-01', until: '2026-05-18' },
          { classId: 'class-1', from: '2026-05-01', until: '2026-05-25' },
        ],
      },
      'students/student-2': { classId: 'class-2' },
      [`student_course_enrollments/${enrollmentId}`]: {
        studentId: 'student-1',
        classId: 'class-1',
        termStart: '2026-05-01',
        termEnd: '2026-05-31',
        joinedAt: '2026-05-01',
        endedAt: null,
        status: 'active',
      },
      'student_course_enrollments/malformed': {
        studentId: 'student-2',
        classId: 'class-2',
        termStart: '2026-05-01',
      },
      'attendance/attendance-1': {
        studentId: 'student-1',
        classId: 'class-1',
        date: '2026-05-11',
        status: 'present',
      },
      'classes/class-1': {
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        daysOfWeek: [1],
        holidays: ['2026-05-18'],
      },
      'classes/class-2': {
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      },
      'class_sessions/cancelled': {
        classId: 'class-1',
        date: '2026-05-11',
        status: 'cancelled',
      },
      'class_sessions/makeup': {
        classId: 'class-1',
        date: '2026-05-12',
        status: 'makeup',
      },
      'system_settings/holidays': { dates: ['2026-05-25'] },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);

    const manifest = await runAttendanceEligibilityAudit({
      db,
      generatedAt: '2026-08-13T00:00:00.000Z',
      outputPath: 'scratch/audit.json',
      target: { projectId: 'project-1', databaseId: 'production' },
      writeText,
    });

    expect(readLog).toEqual(expect.arrayContaining([
      'query:students',
      'query:student_course_enrollments',
      'query:attendance',
      'query:classes',
      'query:class_sessions',
      'system_settings/holidays',
    ]));
    expect(writeLog).toEqual([]);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(
      'scratch/audit.json',
      expect.stringContaining('"writeCount": 0')
    );
    expect(manifest.returnBoundarySessions).toEqual([
      {
        studentId: 'student-1',
        classId: 'class-1',
        date: '2026-05-12',
        attendanceStatus: null,
      },
    ]);
    expect(manifest.missingCourseEvidence).toContainEqual({
      studentId: 'student-2',
      classId: 'class-2',
      termStart: '2026-05-01',
    });
    expect(manifest.target).toEqual({ projectId: 'project-1', databaseId: 'production' });
    expect(manifest.malformedEnrollments).toEqual([
      expect.objectContaining({ enrollmentId: 'malformed', studentId: 'student-2' }),
    ]);
    expect(manifest.writeCount).toBe(0);
  });
});
