import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceStudentQuickProfileResponse } from '../../../shared/attendanceStudentQuickProfile';

const readChannel = vi.hoisted(() => vi.fn());
vi.mock('./readApi', () => ({ readChannel }));

import { fetchAttendanceStudentQuickProfile } from './attendanceStudentQuickProfileApi';

describe('fetchAttendanceStudentQuickProfile', () => {
  beforeEach(() => readChannel.mockReset());

  it('uses the privacy-limited quick-profile channel', async () => {
    const payload = { student: { id: 'student-1' } } as AttendanceStudentQuickProfileResponse;
    readChannel.mockResolvedValue(payload);
    await expect(
      fetchAttendanceStudentQuickProfile({ studentId: 'student-1', classId: 'class-1' })
    ).resolves.toBe(payload);
    expect(readChannel).toHaveBeenCalledWith('attendance-student-quick-profile', {
      studentId: 'student-1',
      classId: 'class-1',
    });
  });
});
