// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../../../../lib/api/financeApi', () => ({
  fetchClassTuitionStudentDetail: vi.fn(),
}));

import { fetchClassTuitionStudentDetail } from '../../../../lib/api/financeApi';
import { ClassTuitionStudentDetailModal } from './ClassTuitionStudentDetailModal';
import { translations } from '../../../../lib/i18n/translations';
import type { ClassTuitionReconciliationText } from './types';
import type {
  ClassTuitionStudentDetailResponse,
  ClassTuitionStudentRow,
} from '../../../../../shared/classTuitionReconciliation';

const t = translations.vi.adminFinanceReport.classReconciliation as ClassTuitionReconciliationText;

const detailMock = vi.mocked(fetchClassTuitionStudentDetail);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function studentRow(overrides: Partial<ClassTuitionStudentRow> = {}): ClassTuitionStudentRow {
  return {
    key: 'student:st1',
    kind: 'student',
    studentId: 'st1',
    fullName: 'Nguyễn Văn An',
    studentCode: 'HV001',
    studentRecordFound: true,
    enrollmentIds: ['e1'],
    enrollmentStatuses: ['active'],
    ledgerIds: ['l1'],
    chargeable: true,
    expectedGross: 2_000_000,
    recordedGross: 2_000_000,
    reductionTotal: 0,
    netDueTotal: 2_000_000,
    paidTotal: 500_000,
    outstandingTotal: 1_500_000,
    overpaidTotal: 0,
    warnings: [],
    ...overrides,
  };
}

function detail(
  overrides: Partial<ClassTuitionStudentDetailResponse> = {}
): ClassTuitionStudentDetailResponse {
  return {
    success: true,
    scope: { classId: 'c1', termStart: '2026-06-01', studentId: 'st1', ledgerId: null },
    student: { id: 'st1', fullName: 'Nguyễn Văn An', studentCode: 'HV001', recordFound: true },
    enrollments: [{ id: 'e1', status: 'active', joinedAt: '2026-06-01', endedAt: null }],
    ledgers: [
      {
        id: 'l1',
        gross: 2_000_000,
        reduction: 0,
        netDue: 2_000_000,
        paid: 500_000,
        outstanding: 1_500_000,
        overpaid: 0,
      },
    ],
    allocations: [
      {
        receiptId: 'r1',
        receiptNo: 'PT-001',
        receivedDate: '2026-06-10',
        paymentMethod: 'cash',
        allocatedAmount: 500_000,
        discountAmount: 0,
        discountType: null,
        note: 'Đợt 1',
      },
    ],
    warnings: [],
    workspaceUrl:
      '/tuition?tab=students&studentLifecycleScope=all&studentClassId=c1&studentExpandedId=st1',
    ...overrides,
  };
}

function renderModal(
  props: Partial<React.ComponentProps<typeof ClassTuitionStudentDetailModal>> = {}
) {
  const onClose = vi.fn();
  const utils = render(
    <ClassTuitionStudentDetailModal
      row={studentRow()}
      classId="c1"
      termStart="2026-06-01"
      language="vi"
      t={t}
      onClose={onClose}
      {...props}
    />
  );
  return { ...utils, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  detailMock.mockResolvedValue(detail());
});

describe('ClassTuitionStudentDetailModal scoped detail', () => {
  it('fetches the detail for a student row with studentId only', async () => {
    renderModal();

    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(1));
    const call = detailMock.mock.calls[0][0];
    expect(call.classId).toBe('c1');
    expect(call.termStart).toBe('2026-06-01');
    expect(call.studentId).toBe('st1');
    expect(call.ledgerId).toBeUndefined();
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('fetches an orphan row with ledgerId only', async () => {
    detailMock.mockResolvedValue(
      detail({
        scope: { classId: 'c1', termStart: '2026-06-01', studentId: null, ledgerId: 'l9' },
        student: { id: null, fullName: '', studentCode: '', recordFound: false },
        enrollments: [],
        workspaceUrl: null,
      })
    );
    renderModal({
      row: studentRow({
        key: 'orphan_ledger:l9',
        kind: 'orphan_ledger',
        studentId: null,
        ledgerIds: ['l9'],
        enrollmentIds: [],
        enrollmentStatuses: [],
      }),
    });

    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(1));
    const call = detailMock.mock.calls[0][0];
    expect(call.ledgerId).toBe('l9');
    expect(call.studentId).toBeUndefined();
  });

  it('keeps every duplicate enrollment and ledger visible', async () => {
    detailMock.mockResolvedValue(
      detail({
        enrollments: [
          { id: 'e1', status: 'active', joinedAt: '2026-06-01', endedAt: null },
          { id: 'e2', status: 'transferred', joinedAt: '2026-06-01', endedAt: '2026-07-01' },
        ],
        ledgers: [
          detail().ledgers[0],
          {
            id: 'l2',
            gross: 2_000_000,
            reduction: 500_000,
            netDue: 1_500_000,
            paid: 0,
            outstanding: 1_500_000,
            overpaid: 0,
          },
        ],
      })
    );
    renderModal();

    expect(await screen.findByText('e1')).toBeTruthy();
    expect(screen.getByText('e2')).toBeTruthy();
    expect(screen.getByText('l1')).toBeTruthy();
    expect(screen.getByText('l2')).toBeTruthy();
    expect(screen.getByText(t.statusLabels.transferred)).toBeTruthy();
  });

  it('renders per-ledger metrics and receipt allocations', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(t.detail.ledgers)).toBeTruthy();
    expect(within(dialog).getAllByText('2.000.000 đ').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('1.500.000 đ').length).toBeGreaterThan(0);

    expect(within(dialog).getByText(t.detail.allocations)).toBeTruthy();
    expect(within(dialog).getByText('PT-001')).toBeTruthy();
    expect(within(dialog).getByText(`${t.detail.note}: Đợt 1`)).toBeTruthy();
  });

  it('labels an unclassified discount instead of leaving it blank', async () => {
    detailMock.mockResolvedValue(
      detail({
        allocations: [
          {
            ...detail().allocations[0],
            discountAmount: 300_000,
            discountType: null,
          },
        ],
      })
    );
    renderModal();

    expect(await screen.findByText(t.detail.unclassifiedDiscount)).toBeTruthy();
  });

  it('shows the empty state when no receipt was allocated', async () => {
    detailMock.mockResolvedValue(detail({ allocations: [] }));
    renderModal();

    expect(await screen.findByText(t.detail.emptyAllocations)).toBeTruthy();
  });

  it('shows warnings as readable text', async () => {
    detailMock.mockResolvedValue(detail({ warnings: ['duplicate_ledger'] }));
    renderModal();

    expect(await screen.findByText(t.warningLabels.duplicate_ledger)).toBeTruthy();
  });

  it('links to the finance workspace only when the server gave a url', async () => {
    renderModal();
    const link = await screen.findByRole('link', { name: t.detail.openWorkspace });
    expect(link.getAttribute('href')).toBe(
      '/tuition?tab=students&studentLifecycleScope=all&studentClassId=c1&studentExpandedId=st1'
    );

    screen.getByRole('dialog');
  });

  it('omits the workspace link for an unidentified orphan ledger', async () => {
    detailMock.mockResolvedValue(detail({ workspaceUrl: null }));
    renderModal();

    await screen.findByRole('dialog');
    expect(screen.queryByRole('link', { name: t.detail.openWorkspace })).toBeNull();
  });

  it('is read-only: exposes no mutation control', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog');

    const buttonNames = within(dialog)
      .getAllByRole('button')
      .map((node) => node.getAttribute('aria-label') || node.textContent);
    expect(buttonNames).toEqual([t.detail.close]);
  });
});

describe('ClassTuitionStudentDetailModal lifecycle and accessibility', () => {
  it('names the dialog and marks it modal', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label') || '').toContain(t.detail.title);
  });

  it('closes on Escape and on the close button', async () => {
    const user = userEvent.setup();
    const { onClose, unmount } = renderModal();
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const second = renderModal();
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: t.detail.close }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state before the detail resolves', async () => {
    const pending = deferred<ClassTuitionStudentDetailResponse>();
    detailMock.mockReturnValue(pending.promise);
    renderModal();

    expect(screen.getByText(t.detail.loading)).toBeTruthy();
    pending.resolve(detail());
    await waitFor(() => expect(screen.queryByText(t.detail.loading)).toBeNull());
  });

  it('retries only the detail request after an error', async () => {
    const user = userEvent.setup();
    detailMock.mockRejectedValueOnce(new Error('detail boom'));
    renderModal();

    expect(await screen.findByText('detail boom')).toBeTruthy();

    detailMock.mockResolvedValueOnce(detail());
    await user.click(screen.getByRole('button', { name: t.detail.retry }));

    expect(await screen.findByText('PT-001')).toBeTruthy();
    expect(detailMock).toHaveBeenCalledTimes(2);
  });

  it('never commits a detail response from a superseded scope', async () => {
    const stale = deferred<ClassTuitionStudentDetailResponse>();
    detailMock.mockReturnValueOnce(stale.promise);
    const { rerender } = renderModal();

    rerender(
      <ClassTuitionStudentDetailModal
        row={studentRow()}
        classId="c1"
        termStart="2026-01-01"
        language="vi"
        t={t}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2));

    stale.resolve(detail({ allocations: [{ ...detail().allocations[0], receiptNo: 'PT-STALE' }] }));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText('PT-STALE')).toBeNull();
  });

  it('refetches when the same row is reopened', async () => {
    const { unmount } = renderModal();
    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(1));
    unmount();

    renderModal();
    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2));
  });
});
