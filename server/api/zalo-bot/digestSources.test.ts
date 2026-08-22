import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  collectZaloBotDigestSources,
  MAX_ACTIVE_CLASSES,
  MAX_DATE_ROWS,
  MAX_PENDING_PRINTS,
  MAX_ACTIVE_LINKS,
  MAX_FAILED_MESSAGES,
} from './digestSources';
import * as sessionEligibility from '../lib/attendance/sessionEligibility';
import * as courseClosing from '../classes/helpers/courseClosing';
import * as teacherAttendance from '../../../shared/teacherAttendance';
import * as classSchedule from '../../../shared/classSchedule';
import * as studentEnrollmentTimeline from '../../../shared/studentEnrollmentTimeline';

vi.mock('../lib/attendance/sessionEligibility');
vi.mock('../classes/helpers/courseClosing');
vi.mock('../../../shared/teacherAttendance');
vi.mock('../../../shared/classSchedule');
vi.mock('../../../shared/studentEnrollmentTimeline');

describe('collectZaloBotDigestSources', () => {
  let mockDb: any;
  let queryMocks: any;
  let getAllMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    getAllMock = vi.fn().mockResolvedValue([]);

    queryMocks = {
      classes: {
        get: vi.fn().mockResolvedValue({ docs: [] }),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
      class_sessions: {
        get: vi.fn().mockResolvedValue({ docs: [] }),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
      substitute_requests: {
        get: vi.fn().mockResolvedValue({ docs: [] }),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
      attendance: {
        get: vi.fn().mockResolvedValue({ docs: [] }),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
      print_requests: {
        get: vi.fn().mockResolvedValue({ docs: [] }),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
      student_course_enrollments: {
        get: vi.fn().mockResolvedValue({ docs: [] }),
        where: vi.fn().mockReturnThis(),
      },
      zalo_bot_links: {
        get: vi.fn().mockResolvedValue({ docs: [] }),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
      users: { get: vi.fn().mockResolvedValue({ docs: [] }) },
      zalo_bot_messages: {
        get: vi.fn().mockResolvedValue({ docs: [] }),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
    };

    mockDb = {
      collection: vi.fn(
        (col) =>
          queryMocks[col] || {
            doc: vi.fn(() => ({})),
            get: vi.fn().mockResolvedValue({ docs: [] }),
          }
      ),
      getAll: getAllMock,
    };

    vi.mocked(sessionEligibility.resolveAttendanceEligibilityBatch).mockResolvedValue(new Map());
    vi.mocked(teacherAttendance.getEffectiveTeacherIdForSession).mockReturnValue('teacher1');
    vi.mocked(classSchedule.isExpectedClassSessionOnDate).mockReturnValue(true);
    vi.mocked(studentEnrollmentTimeline.buildClassTerms).mockReturnValue([
      {
        termId: 'current',
        classId: 'c1',
        index: 1,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        isCurrent: true,
        schedule: null,
      },
    ]);
    vi.mocked(courseClosing.computeCourseClosingSnapshot).mockResolvedValue({} as any);
  });

  it('limits bounds correctly and handles truncation', async () => {
    const extraDocs = Array.from({ length: MAX_ACTIVE_CLASSES + 1 }).map((_, i) => ({
      id: `c${i}`,
      data: () => ({ status: 'active', students: [] }),
    }));
    queryMocks.classes.get.mockResolvedValue({ docs: extraDocs });

    const result = await collectZaloBotDigestSources(mockDb, {
      digestDate: '2026-08-16',
      tomorrowDate: '2026-08-17',
    });

    expect(queryMocks.classes.limit).toHaveBeenCalledWith(MAX_ACTIVE_CLASSES + 1);
    expect(queryMocks.class_sessions.limit).toHaveBeenCalledWith(MAX_DATE_ROWS + 1);
    expect(queryMocks.substitute_requests.limit).toHaveBeenCalledWith(MAX_DATE_ROWS + 1);
    expect(queryMocks.attendance.limit).toHaveBeenCalledWith(MAX_DATE_ROWS + 1);
    expect(queryMocks.print_requests.limit).toHaveBeenCalledWith(MAX_PENDING_PRINTS + 1);
    expect(queryMocks.zalo_bot_links.limit).toHaveBeenCalledWith(MAX_ACTIVE_LINKS + 1);
    expect(queryMocks.zalo_bot_messages.limit).toHaveBeenCalledWith(MAX_FAILED_MESSAGES + 1);

    expect(result.sourceCounts.potentialTruncation).toContain('classes');
    expect(result.sourceCounts.classes).toBe(MAX_ACTIVE_CLASSES);
  });

  it('filters pending print requests by neededDate', async () => {
    await collectZaloBotDigestSources(mockDb, {
      digestDate: '2026-08-16',
      tomorrowDate: '2026-08-17',
    });
    expect(queryMocks.print_requests.where).toHaveBeenCalledWith('neededDate', '<=', '2026-08-17');
    expect(queryMocks.print_requests.where).toHaveBeenCalledWith('status', '==', 'pending');
  });

  it('keeps legacy classes without a status field in the digest', async () => {
    queryMocks.classes.get.mockResolvedValue({
      docs: [
        {
          id: 'legacy-class',
          data: () => ({ name: 'Legacy 7A1', teacherId: 'teacher1', students: [] }),
        },
      ],
    });

    const result = await collectZaloBotDigestSources(mockDb, {
      digestDate: '2026-08-16',
      tomorrowDate: '2026-08-17',
    });

    expect(queryMocks.classes.where).not.toHaveBeenCalled();
    expect(result.attendance.map((row) => row.classId)).toContain('legacy-class');
  });

  it('merges canonical term enrollments with the legacy class roster', async () => {
    queryMocks.classes.get.mockResolvedValue({
      docs: [
        {
          id: 'class1',
          data: () => ({ status: 'active', students: ['legacy-student'] }),
        },
      ],
    });
    queryMocks.student_course_enrollments.get.mockResolvedValue({
      docs: [
        {
          id: 'enrollment-1',
          data: () => ({
            classId: 'class1',
            studentId: 'canonical-student',
            termStart: '2026-01-01',
            status: 'active',
          }),
        },
      ],
    });
    getAllMock.mockResolvedValue([
      { id: 'legacy-student', exists: true, data: () => ({ name: 'Legacy' }) },
      { id: 'canonical-student', exists: true, data: () => ({ name: 'Canonical' }) },
    ]);
    vi.mocked(sessionEligibility.resolveAttendanceEligibilityBatch).mockImplementation(
      async (_db, input) =>
        new Map(
          [...input.studentsById.keys()].map((studentId) => [
            studentId,
            { eligibility: 'eligible', hasClassMembership: true },
          ])
        )
    );

    const result = await collectZaloBotDigestSources(mockDb, {
      digestDate: '2026-08-16',
      tomorrowDate: '2026-08-17',
    });

    expect(queryMocks.student_course_enrollments.where).toHaveBeenCalledWith('classId', 'in', [
      'class1',
    ]);
    expect(result.attendance[0]?.eligibleStudentIds).toEqual(
      expect.arrayContaining(['legacy-student', 'canonical-student'])
    );
  });

  it('excludes not_enrolled and on_leave students and resolves batch chunks of 300', async () => {
    const classDoc = {
      id: 'class1',
      data: () => ({
        status: 'active',
        students: Array.from({ length: 350 }).map((_, i) => `s${i}`),
      }),
    };
    queryMocks.classes.get.mockResolvedValue({ docs: [classDoc] });

    vi.mocked(sessionEligibility.resolveAttendanceEligibilityBatch).mockResolvedValue(
      new Map([
        ['s1', { eligibility: 'eligible', hasClassMembership: true }],
        ['s2', { eligibility: 'not_enrolled', hasClassMembership: true }],
        ['s3', { eligibility: 'on_leave', hasClassMembership: true }],
      ])
    );

    const result = await collectZaloBotDigestSources(mockDb, {
      digestDate: '2026-08-16',
      tomorrowDate: '2026-08-17',
    });

    expect(mockDb.getAll).toHaveBeenCalledTimes(2); // 350 -> chunked into 300 and 50
    const classObj = result.attendance.find((a) => a.classId === 'class1');
    expect(classObj?.eligibleStudentIds).toContain('s1');
    expect(classObj?.eligibleStudentIds).not.toContain('s2');
    expect(classObj?.eligibleStudentIds).not.toContain('s3');
  });

  it('resolves effective teacher, uses explicit taught/makeup for non-regular days', async () => {
    const classDoc = { id: 'class2', data: () => ({ status: 'active', teacherId: 'primary' }) };
    queryMocks.classes.get.mockResolvedValue({ docs: [classDoc] });

    queryMocks.class_sessions.get.mockResolvedValue({
      docs: [{ data: () => ({ classId: 'class2', status: 'makeup' }) }],
    });

    vi.mocked(classSchedule.isExpectedClassSessionOnDate).mockReturnValue(false); // not regular day

    const result = await collectZaloBotDigestSources(mockDb, {
      digestDate: '2026-08-16',
      tomorrowDate: '2026-08-17',
    });

    expect(result.attendance.length).toBe(1);
    expect(result.attendance[0].sessionStatus).toBe('makeup');
    expect(teacherAttendance.getEffectiveTeacherIdForSession).toHaveBeenCalled();
  });

  it('calls computeCourseClosingSnapshot only for D-7, D-3, D-1 classes with limit of 10 concurrent', async () => {
    // D-7 = diff -7 (endDate is 7 days after digestDate? Wait, differenceInCalendarDays(digest, endDate).
    // if digestDate is 2026-08-10, endDate is 2026-08-17. diff = -7
    const classDoc1 = { id: 'classD7', data: () => ({ status: 'active', endDate: '2026-08-23' }) }; // digest 16, end 23 -> diff -7
    const classDoc2 = { id: 'classD14', data: () => ({ status: 'active', endDate: '2026-08-30' }) }; // diff -14
    queryMocks.classes.get.mockResolvedValue({ docs: [classDoc1, classDoc2] });

    await collectZaloBotDigestSources(mockDb, {
      digestDate: '2026-08-16',
      tomorrowDate: '2026-08-17',
    });

    expect(courseClosing.computeCourseClosingSnapshot).toHaveBeenCalledTimes(1);
    expect(courseClosing.computeCourseClosingSnapshot).toHaveBeenCalledWith(mockDb, 'classD7');
  });

  it('does not count failed chat replies as outstanding notification failures', async () => {
    queryMocks.zalo_bot_messages.get.mockResolvedValue({
      docs: [{ data: () => ({ status: 'failed', messageType: 'daily_digest' }) }],
    });

    const sources = await collectZaloBotDigestSources(mockDb, {
      digestDate: '2026-08-16',
      tomorrowDate: '2026-08-17',
    });

    expect(queryMocks.zalo_bot_messages.where).toHaveBeenCalledWith(
      'messageType',
      'in',
      ['daily_digest', 'link_confirmation', 'test']
    );
    expect(queryMocks.zalo_bot_messages.limit).toHaveBeenCalledWith(MAX_FAILED_MESSAGES + 1);
    expect(sources.sourceCounts.outstandingFailedMessages).toBe(1);
  });
});
