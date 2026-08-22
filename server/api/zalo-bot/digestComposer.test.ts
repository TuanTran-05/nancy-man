import { describe, it, expect } from 'vitest';
import { composeZaloBotDigest } from './digestComposer';
import { ZaloBotDigestRecipient } from './digestRules';

describe('ZaloBot Digest Composer', () => {
  it('1. Teacher message groups attendance and course-closing sections', () => {
    const recipient: ZaloBotDigestRecipient = {
      staffId: 't1',
      role: 'teacher',
      attendance: [{ classId: 'c1', className: 'C1', date: '2026-08-10', missingStudentCount: 2 }],
      courseClosing: [
        {
          classId: 'c2',
          className: 'C2',
          endDate: '2026-08-20',
          snapshotStatus: 'missing_evaluations',
        },
      ],
      printRequests: [],
    };
    const result = composeZaloBotDigest(recipient, {
      digestDate: '2026-08-15',
      appUrl: 'https://vps.thienuy.edu.vn',
      dryRun: false,
    });
    expect(result).toContain('- C1 (2026-08-10):');
    expect(result).toContain('C2: 2026-08-20 (missing_evaluations)');
    expect(result).toContain('https://vps.thienuy.edu.vn');
  });

  it('2. Office message includes required print fields', () => {
    const recipient: ZaloBotDigestRecipient = {
      staffId: 'o1',
      role: 'office',
      attendance: [],
      courseClosing: [],
      printRequests: [
        {
          requestId: 'p1',
          className: 'C1',
          teacherName: 'T1',
          neededDate: '2026-08-16',
          fileCount: 2,
          totalCopies: 20,
        },
      ],
    };
    const result = composeZaloBotDigest(recipient, {
      digestDate: '2026-08-15',
      appUrl: 'https://vps.thienuy.edu.vn',
      dryRun: false,
    });
    expect(result).toContain('2026-08-16 | C1 | GV: T1 | 2 file, 20 ');
    expect(result).toContain('https://vps.thienuy.edu.vn');
  });

  it('3. Admin message includes all count fields', () => {
    const recipient: ZaloBotDigestRecipient = {
      staffId: 'a1',
      role: 'admin',
      attendance: [],
      courseClosing: [],
      printRequests: [],
      adminSummary: {
        linkedRecipients: 5,
        eligibleRecipients: 10,
        missingAttendanceClasses: 2,
        courseClosingClasses: 3,
        pendingPrintRequests: 4,
        outstandingFailedMessages: 1,
        potentialTruncation: ['Teacher A'],
      },
    };
    const result = composeZaloBotDigest(recipient, {
      digestDate: '2026-08-15',
      appUrl: 'https://vps.thienuy.edu.vn',
      dryRun: true,
    });
    expect(result).toContain('(Dry Run)');
    expect(result).toContain('Links: 5/10');
    expect(result).toContain('Truncation warnings: Teacher A');
    expect(result).toContain('https://vps.thienuy.edu.vn');
  });

  it('4. Output <= 2000 chars', () => {
    const recipient: ZaloBotDigestRecipient = {
      staffId: 't1',
      role: 'teacher',
      attendance: [],
      courseClosing: [],
      printRequests: [],
    };
    // add 100 items
    for (let i = 0; i < 100; i++) {
      recipient.attendance.push({
        classId: `c${i}`,
        className: `Class Very Long Name ${i}`,
        date: '2026-08-10',
        missingStudentCount: 5,
      });
    }
    const result = composeZaloBotDigest(recipient, {
      digestDate: '2026-08-15',
      appUrl: 'https://vps.thienuy.edu.vn',
      dryRun: false,
    });
    const trimmed = result.trimEnd();
    expect(trimmed.length).toBeLessThanOrEqual(2000);
    expect(trimmed).toContain('...');
    expect(trimmed.endsWith('https://vps.thienuy.edu.vn')).toBe(true);
  });

  it('5. Long list cut between lines, ends with "Xem chi tiết: <appUrl>"', () => {
    const recipient: ZaloBotDigestRecipient = {
      staffId: 't1',
      role: 'teacher',
      attendance: [],
      courseClosing: [],
      printRequests: [],
    };
    for (let i = 0; i < 50; i++) {
      recipient.attendance.push({
        classId: `c${i}`,
        className: `C${i}`.padEnd(50, 'A'),
        date: '2026-08-10',
        missingStudentCount: 1,
      });
    }
    const result = composeZaloBotDigest(recipient, {
      digestDate: '2026-08-15',
      appUrl: 'https://vps.thienuy.edu.vn',
      dryRun: false,
    });
    const trimmed = result.trimEnd();
    expect(trimmed.length).toBeLessThanOrEqual(2000);
    expect(trimmed).toContain('...');
    expect(trimmed.endsWith('https://vps.thienuy.edu.vn')).toBe(true);
  });

  it('6. Same input produces identical output', () => {
    const recipient: ZaloBotDigestRecipient = {
      staffId: 't1',
      role: 'teacher',
      attendance: [{ classId: 'c1', className: 'C1', date: '2026-08-10', missingStudentCount: 2 }],
      courseClosing: [],
      printRequests: [],
    };
    const result1 = composeZaloBotDigest(recipient, {
      digestDate: '2026-08-15',
      appUrl: 'https://vps.thienuy.edu.vn',
      dryRun: false,
    });
    const result2 = composeZaloBotDigest(recipient, {
      digestDate: '2026-08-15',
      appUrl: 'https://vps.thienuy.edu.vn',
      dryRun: false,
    });
    expect(result1).toStrictEqual(result2);
  });
});
