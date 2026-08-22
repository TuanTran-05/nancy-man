// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '../../../lib/i18n/translations';
import type { Class, CourseFeeLedger, Student } from '../../../types';
import { LedgersTab } from './LedgersTab';

function renderLedgersTab(ledger: CourseFeeLedger, studentMap: Record<string, Student>) {
  return render(
    <LedgersTab
      activeTab="ledgers"
      ledgerStats={{ total: 900_000, discount: 0, paid: 0, remaining: 900_000 }}
      classMap={{ c1: { id: 'c1', name: 'A1' } as Class }}
      filteredLedgers={[ledger]}
      studentMap={studentMap}
      actionLoading={null}
      isAdmin={false}
      language="vi"
      ledgersHasMore={false}
      ledgersLoading={false}
      loadLedgers={vi.fn()}
      handleSendTuitionReminder={vi.fn()}
      handleSendTuitionNotice={vi.fn()}
      t={translations.vi}
    />
  );
}

const ledger = {
  id: 'l1',
  studentId: 's1',
  classId: 'c1',
  amount: 900_000,
  discountTotal: 0,
  paidTotal: 0,
  status: 'unpaid',
  termStart: '2026-07-01',
  termEnd: '2026-12-31',
  createdAt: '2026-07-01T00:00:00.000Z',
} as CourseFeeLedger;

describe('LedgersTab student profile access', () => {
  it('links the student name to the finance profile in a new browser tab', () => {
    renderLedgersTab(ledger, {
      s1: { id: 's1', name: 'Nguyễn An', code: 'HS001' } as Student,
    });

    const link = screen.getByRole('link', { name: /Nguyễn An/ });
    expect(link).toHaveAttribute('href', '/students/s1?tab=finance');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('keeps plain text when the ledger has no matching student', () => {
    renderLedgersTab(ledger, {});

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
