// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Finance from './Finance';
import { readChannel } from '../../lib/api/readApi';
import { getStudentDirectory } from '../../lib/api/studentDirectoryApi';
import { listPayOSPayments } from '../../lib/api/payosApi';
import toast from 'react-hot-toast';
import {
  fetchClassReconciliationOptions,
  fetchFinanceReport,
  voidReceipt,
} from '../../lib/api/financeApi';
import { translations } from '../../lib/i18n/translations';

// Finance reads its class and teacher reference lists through React Query, so
// every render needs a client. A fresh one per test keeps the cases isolated.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const mocks = vi.hoisted(() => ({
  accountingProfile: { uid: 'accounting-uid', role: 'accounting' },
}));

vi.mock('react-hot-toast', () => {
  const toast = vi.fn();
  return {
    default: Object.assign(toast, {
      success: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: mocks.accountingProfile,
  }),
}));

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

vi.mock('../../lib/api/studentDirectoryApi', () => ({
  getStudentDirectory: vi.fn(),
}));

vi.mock('../../lib/api/classAdminApi', () => ({
  generateCourseFeeLedgersInBatches: vi.fn(),
}));

vi.mock('../../lib/zalo/zaloService', () => ({
  sendZaloTuitionNoticeNotification: vi.fn(),
  sendZaloTuitionReminderNotification: vi.fn(),
}));

vi.mock('../../lib/api/financeApi', () => ({
  postReceipt: vi.fn(),
  voidReceipt: vi.fn(),
  postExpense: vi.fn(),
  voidExpense: vi.fn(),
  fetchFinanceReport: vi.fn(),
  fetchClassReconciliationOptions: vi.fn(),
  fetchClassTuitionReconciliation: vi.fn(),
  fetchClassTuitionStudentDetail: vi.fn(),
}));

vi.mock('../../lib/api/payosApi', () => ({
  listPayOSPayments: vi.fn(),
  reconcilePayOSPayments: vi.fn(),
  refreshPayOSPaymentStatus: vi.fn(),
  resolvePayOSReview: vi.fn(),
}));

vi.mock('../../lib/config/accountingStudentWorkspaceMode', () => ({
  ACCOUNTING_STUDENT_WORKSPACE_ENABLED: false,
}));

function mockFinanceReadChannel() {
  vi.mocked(readChannel).mockImplementation(async (_channel, params = {}) => {
    if (params.resource === 'classes') return { classes: [] } as never;
    if (params.resource === 'students') return { students: [] } as never;
    if (params.resource === 'teachers') return { teachers: [] } as never;
    if (params.resource === 'ledgers') return { ledgers: [] } as never;
    if (params.resource === 'receipts') return { receipts: [] } as never;
    if (params.resource === 'expenses') return { expenses: [] } as never;
    return {} as never;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Finance page read limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFinanceReadChannel();
    vi.mocked(getStudentDirectory).mockResolvedValue({
      students: [],
      meta: {
        complete: true,
        total: 0,
        maxSupported: 3000,
        version: 1,
        generatedAt: '2026-07-18T00:00:00.000Z',
      },
      page: { limit: 3000, nextCursor: null, hasMore: false },
    });
    vi.mocked(listPayOSPayments).mockResolvedValue({
      success: true,
      payments: [],
      page: { limit: 2000, nextCursor: null, hasMore: false },
    });
  });

  it('requests 50 ledger rows and uses the complete student directory for filters', async () => {
    render(<Finance />);

    await waitFor(() => {
      expect(readChannel).toHaveBeenCalledWith('finance', {
        resource: 'ledgers',
        limit: 50,
        cursor: null,
        status: 'all',
        classId: '',
      });
    });

    expect(readChannel).toHaveBeenCalledWith('finance', { resource: 'classes', limit: 2000 });
    expect(getStudentDirectory).toHaveBeenCalledOnce();
    expect(readChannel).not.toHaveBeenCalledWith('finance', {
      resource: 'students',
      limit: 2000,
    });
    expect(readChannel).toHaveBeenCalledWith('finance', { resource: 'teachers', limit: 2000 });
  });

  it('shows a visible loading state while class and teacher filters are loading', async () => {
    const references = deferred<any>();
    vi.mocked(readChannel).mockImplementation((_channel, params = {}) => {
      if (params.resource === 'classes' || params.resource === 'teachers') {
        return references.promise as never;
      }
      if (params.resource === 'ledgers') return Promise.resolve({ ledgers: [] }) as never;
      return Promise.resolve({}) as never;
    });

    render(<Finance />);

    expect(await screen.findByTestId('finance-reference-loading')).toHaveTextContent(
      translations.vi.financePage.loadingReferences
    );
    expect(screen.getByTestId('finance-class-filter')).toBeDisabled();

    await act(async () => {
      references.resolve({ classes: [], teachers: [] });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('finance-reference-loading')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('finance-class-filter')).toBeEnabled();
  });

  it('requests 50 online payment rows from the payments tab', async () => {
    render(<Finance />);

    fireEvent.click(screen.getByRole('button', { name: /online/i }));

    await waitFor(() => {
      expect(listPayOSPayments).toHaveBeenCalledWith('all', 50, null);
    });
  });

  // The class and teacher lists used to live in an effect keyed on the active
  // tab, so both reads refired every time the user moved between tabs.
  it('keeps class and teacher references cached across tab switches', async () => {
    window.history.replaceState({}, '', '/tuition');
    render(<Finance />);

    const referenceCallCount = () =>
      vi.mocked(readChannel).mock.calls.filter(([, params]) => {
        const resource = (params as { resource?: string } | undefined)?.resource;
        return resource === 'classes' || resource === 'teachers';
      }).length;

    await waitFor(() => expect(referenceCallCount()).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: /online/i }));
    await waitFor(() => expect(listPayOSPayments).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^Công nợ$/i }));
    await waitFor(() =>
      expect(readChannel).toHaveBeenCalledWith(
        'finance',
        expect.objectContaining({ resource: 'ledgers' })
      )
    );

    expect(referenceCallCount()).toBe(2);
  });

  // Returning to a money tab used to refetch it from scratch every time. The
  // realtime channels still force a refetch when money actually moves.
  it('does not refetch the ledger list when a tab is revisited', async () => {
    window.history.replaceState({}, '', '/tuition');
    render(<Finance />);

    const ledgerCallCount = () =>
      vi
        .mocked(readChannel)
        .mock.calls.filter(
          ([, params]) => (params as { resource?: string } | undefined)?.resource === 'ledgers'
        ).length;

    await waitFor(() => expect(ledgerCallCount()).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /online/i }));
    await waitFor(() => expect(listPayOSPayments).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^Công nợ$/i }));
    // Give a refetch a full macrotask to fire before asserting it did not: the
    // old effect issued its read synchronously on the tab change.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ledgerCallCount()).toBe(1);
  });

  describe('class tuition reconciliation tab', () => {
    const financePage = translations.vi.financePage;
    const reconciliation = translations.vi.adminFinanceReport.classReconciliation;

    // Selecting a tab writes ?tab= into window.history, and jsdom keeps that URL for
    // the rest of the file — without this reset each test inherits the previous tab.
    beforeEach(() => {
      window.history.replaceState({}, '', '/tuition');
    });

    it('sits immediately after the Công nợ tab', () => {
      render(<Finance />);

      const tabLabels = screen
        .getAllByRole('button')
        .map((button) => button.textContent?.trim())
        .filter((label): label is string => Boolean(label));

      const ledgerIndex = tabLabels.indexOf(financePage.tabLedgers);
      expect(ledgerIndex).toBeGreaterThanOrEqual(0);
      expect(tabLabels[ledgerIndex + 1]).toBe(financePage.tabClassReconciliation);
    });

    it('renders the reconciliation section and loads classes only once opened', async () => {
      const user = userEvent.setup();
      vi.mocked(fetchClassReconciliationOptions).mockResolvedValue({
        success: true,
        mode: 'classes',
        classes: [
          {
            id: 'c1',
            name: 'Tiếng Anh 1A',
            status: 'active',
            teacherId: 't1',
            teacherName: 'Nguyễn Văn A',
          },
        ],
      });

      render(<Finance />);
      expect(fetchClassReconciliationOptions).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole('button', { name: new RegExp(`^${financePage.tabClassReconciliation}$`) })
      );

      expect(await screen.findByText(reconciliation.title)).toBeTruthy();
      await waitFor(() => expect(fetchClassReconciliationOptions).toHaveBeenCalled());

      const classBox = (await screen.findByLabelText(
        reconciliation.classLabel
      )) as HTMLInputElement;
      await waitFor(() => expect(classBox.disabled).toBe(false));
      await user.click(classBox);

      expect(
        within(screen.getByRole('listbox'))
          .getAllByRole('option')
          .map((option) => option.textContent)
      ).toContain(`Tiếng Anh 1A - Nguyễn Văn A · ${reconciliation.classStatusLabels.active}`);
    });

    it('hides the page-level month and class filters, which do not scope this block', async () => {
      const user = userEvent.setup();
      vi.mocked(fetchClassReconciliationOptions).mockResolvedValue({
        success: true,
        mode: 'classes',
        classes: [],
      });

      render(<Finance />);
      expect(screen.getByText(financePage.allClasses)).toBeTruthy();

      await user.click(
        screen.getByRole('button', { name: new RegExp(`^${financePage.tabClassReconciliation}$`) })
      );

      expect(screen.queryByText(financePage.allClasses)).toBeNull();
      expect(screen.queryByText(financePage.allStatuses)).toBeNull();
    });
  });

  it('passes receipt filters to the server-side paginated query', async () => {
    const user = userEvent.setup();
    render(<Finance />);

    await user.click(screen.getByRole('button', { name: /^Phiếu thu$/i }));

    await waitFor(() => {
      expect(readChannel).toHaveBeenCalledWith('finance', {
        resource: 'receipts',
        limit: 50,
        cursor: null,
        status: 'all',
        classId: '',
        startDate: '',
        endDate: '',
      });
    });
  });

  it('requires a reason and sends one stable idempotency key while voiding a v2 receipt', async () => {
    const user = userEvent.setup();
    vi.mocked(readChannel).mockImplementation(async (_channel, params = {}) => {
      if (params.resource === 'classes') {
        return {
          classes: [
            {
              id: 'c1',
              name: 'A1',
              teacherId: 't1',
              studentIds: [],
              createdAt: '2026-07-01T00:00:00.000Z',
            },
          ],
        } as never;
      }
      if (params.resource === 'teachers') return { teachers: [] } as never;
      if (params.resource === 'receipts') {
        return {
          receipts: [
            {
              id: 'r-v2',
              receiptNo: 'PT-260727-001',
              type: 'tuition',
              flowVersion: 'wallet-manual-v2',
              studentId: 's1',
              classId: 'c1',
              amountReceived: 1_000,
              paymentMethod: 'cash',
              receivedDate: '2026-07-27',
              createdBy: 'u1',
              createdByRole: 'accounting',
              status: 'posted',
              createdAt: '2026-07-27T00:00:00.000Z',
            },
          ],
        } as never;
      }
      if (params.resource === 'ledgers') return { ledgers: [] } as never;
      if (params.resource === 'expenses') return { expenses: [] } as never;
      return {} as never;
    });
    vi.mocked(getStudentDirectory).mockResolvedValue({
      students: [
        {
          id: 's1',
          name: 'Nguyễn An',
          studentId: 'HS001',
          code: 'HS001',
          dob: '2015-05-10',
          contact: '0901000001',
          classId: 'c1',
          teacherId: 't1',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      meta: {
        complete: true,
        total: 1,
        maxSupported: 3000,
        version: 1,
        generatedAt: '2026-07-18T00:00:00.000Z',
      },
      page: { limit: 3000, nextCursor: null, hasMore: false },
    } as never);
    vi.mocked(voidReceipt)
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ success: true });

    render(<Finance />);
    await user.click(screen.getByRole('button', { name: /^Phiếu thu$/i }));
    await user.click(await screen.findByRole('button', { name: /Hủy phiếu/i }));
    const confirm = screen.getByRole('button', { name: /Xác nhận hủy/i });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Lý do hủy/i), 'Thu nhầm học sinh');
    await user.click(confirm);
    await waitFor(() => expect(voidReceipt).toHaveBeenCalledTimes(1));
    await user.click(confirm);
    await waitFor(() => expect(voidReceipt).toHaveBeenCalledTimes(2));

    expect(voidReceipt).toHaveBeenCalledWith('r-v2', {
      idempotencyKey: expect.any(String),
      reason: 'Thu nhầm học sinh',
    });
    expect(vi.mocked(voidReceipt).mock.calls[1][1].idempotencyKey).toBe(
      vi.mocked(voidReceipt).mock.calls[0][1].idempotencyKey
    );
  });

  it('requests daily breakdown data and surfaces report_too_large error toasts', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFinanceReport).mockRejectedValueOnce(
      Object.assign(new Error('too large'), {
        errorCode: 'report_too_large',
        status: 413,
      })
    );

    render(<Finance />);
    await user.click(screen.getByRole('button', { name: /^Báo cáo quỹ$/i }));
    await user.click(await screen.findByRole('button', { name: /^Xem báo cáo$/i }));

    await waitFor(() => {
      expect(fetchFinanceReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ includeDaily: true })
      );
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Khoảng đã chọn có quá nhiều giao dịch. Hãy chọn khoảng ngày ngắn hơn.'
    );
  });

  it('loads an explicit quick-preset range with daily data', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFinanceReport).mockResolvedValue({
      totalIncome: 0,
      totalExpenses: 0,
      balance: 0,
      dailyBreakdown: [],
      monthlyBreakdown: [],
    });

    render(<Finance />);
    await user.click(screen.getByRole('button', { name: /^Báo cáo quỹ$/i }));
    await user.click(await screen.findByRole('button', { name: /^Hôm nay$/i }));

    await waitFor(() => {
      expect(fetchFinanceReport).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        expect.objectContaining({ includeDaily: true })
      );
    });
    const [from, to] = vi.mocked(fetchFinanceReport).mock.calls.at(-1)!;
    expect(from).toBe(to);
  });
});
