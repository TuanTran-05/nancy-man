import { describe, expect, it, vi } from 'vitest';
import { readChannel } from './readApi';
import { readTeacherPayrollMonth } from './teacherPayrollApi';

vi.mock('./readApi', () => ({
  readChannel: vi.fn(),
}));

describe('readTeacherPayrollMonth', () => {
  it('reads the unified teacher payroll month channel', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers: [],
      classes: [],
      sessions: [],
      substitutes: [],
      serverTime: 1,
    });

    const result = await readTeacherPayrollMonth('2026-06');

    expect(readChannel).toHaveBeenCalledWith('teacher-payroll-month', { month: '2026-06' });
    expect(result.month).toBe('2026-06');
  });
});
