import { describe, expect, it, vi } from 'vitest';
import { createSnapshot, type OfficeAcademicZaloSnapshotPayload } from './office-academic-zalo-snapshot';
import { executeSnapshotSend } from './send-office-academic-zalo-snapshot';

function fixture() {
  const payload: OfficeAcademicZaloSnapshotPayload = {
    schemaVersion: 1,
    createdAt: '2026-08-04T05:00:00.000Z',
    classId: 'MbEjkY4bZPvUt9ykRpPu',
    className: 'G3 - Huynh Le T4-T6',
    courseStartDate: '2026-05-13',
    courseEndDate: '2026-07-31',
    tuitionAmount: 1_200_000,
    resendBy: 'scheduled-resend-g3-huynh-le-2026-08-05',
    expectedCounts: { evaluation: 13, rank: 2, tuition: 13 },
    recipients: Array.from({ length: 13 }, (_, index) => {
      const studentCode = `HS${String(index + 1).padStart(6, '0')}`;
      const shared = { student_name: `Student ${index + 1}`, student_code: studentCode };
      return {
        studentDocId: `student-${index + 1}`,
        studentCode,
        studentName: `Student ${index + 1}`,
        phone: `849${String(index + 1).padStart(8, '0')}`,
        evaluation: { templateData: { ...shared, course_end_date: '31/07/2026', final_grade: '9', good: 'Good', bad: 'None' } },
        rank: index < 2 ? { templateData: { ...shared, rank: index === 0 ? 'First' : 'Second', discount: index === 0 ? '10%' : '5%' } } : null,
        tuition: { templateData: { ...shared, previous_end_date: '31/07/2026', start_date: '05/08/2026', end_date: '31/10/2026', amount: 1_200_000, due_date: '19/08/2026' } },
      };
    }),
  };
  return createSnapshot(payload);
}

const expectations = {
  classId: 'MbEjkY4bZPvUt9ykRpPu',
  tuitionAmount: 1_200_000,
  evaluationCount: 13,
  rankCount: 2,
  tuitionCount: 13,
};

describe('executeSnapshotSend', () => {
  it('reports a dry run without sending or writing logs', async () => {
    const sendMessage = vi.fn();
    const writeLog = vi.fn();
    const result = await executeSnapshotSend({
      snapshot: fixture(),
      expectations,
      apply: false,
      sendMessage,
      writeLog,
      sleepMs: 0,
    });
    expect(result.mode).toBe('dry-run');
    expect(result.planned).toEqual({ evaluation: 13, rank: 2, tuition: 13, total: 28 });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(writeLog).not.toHaveBeenCalled();
  });

  it('sends in recipient order and writes immutable audit data', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true, messageId: 'zalo-1' });
    const writeLog = vi.fn().mockResolvedValue(undefined);
    const snapshot = fixture();
    const result = await executeSnapshotSend({ snapshot, expectations, apply: true, sendMessage, writeLog, sleepMs: 0 });
    expect(sendMessage).toHaveBeenCalledTimes(28);
    expect(sendMessage.mock.calls.slice(0, 3).map(([row]) => row.type)).toEqual([
      'evaluation_notice',
      'rank_achievement',
      'tuition_notice',
    ]);
    expect(writeLog).toHaveBeenCalledTimes(28);
    expect(writeLog.mock.calls[0][0]).toMatchObject({
      studentId: 'student-1',
      classId: expectations.classId,
      phone: '84900000001',
      status: 'sent',
      source: 'scheduled_snapshot_resend',
      snapshotChecksum: snapshot.checksum,
    });
    expect(result.completed).toEqual({ sent: 28, failed: 0, skipped: 0 });
  });

  it('skips rank and tuition after one evaluation failure but continues later recipients', async () => {
    const sendMessage = vi.fn(async (row) =>
      row.studentCode === 'HS000001' && row.type === 'evaluation_notice'
        ? { success: false, error: 'bad phone' }
        : { success: true, messageId: 'ok' }
    );
    const writeLog = vi.fn().mockResolvedValue(undefined);
    const result = await executeSnapshotSend({
      snapshot: fixture(), expectations, apply: true, sendMessage, writeLog, sleepMs: 0,
    });
    expect(sendMessage).toHaveBeenCalledTimes(26);
    expect(writeLog).toHaveBeenCalledTimes(26);
    expect(result.completed).toEqual({ sent: 25, failed: 1, skipped: 2 });
    expect(result.results).toContainEqual(expect.objectContaining({ studentCode: 'HS000001', type: 'rank_achievement', status: 'skipped_evaluation_not_sent' }));
    expect(result.results).toContainEqual(expect.objectContaining({ studentCode: 'HS000001', type: 'tuition_notice', status: 'skipped_evaluation_not_sent' }));
    expect(result.results).toContainEqual(expect.objectContaining({ studentCode: 'HS000013', type: 'tuition_notice', status: 'sent' }));
  });
});
