import { describe, expect, it } from 'vitest';
import { isAccountingStudentWorkspaceEnabled } from './accountingStudentWorkspaceMode';

describe('accounting student workspace rollout flag', () => {
  it('enables the student workspace by default and allows explicit rollback', () => {
    expect(
      isAccountingStudentWorkspaceEnabled({ VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE: 'true' })
    ).toBe(true);
    expect(
      isAccountingStudentWorkspaceEnabled({ VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE: '1' })
    ).toBe(true);
    expect(isAccountingStudentWorkspaceEnabled({})).toBe(true);
    expect(
      isAccountingStudentWorkspaceEnabled({ VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE: 'false' })
    ).toBe(false);
  });
});
