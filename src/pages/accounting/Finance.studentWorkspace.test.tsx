// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingStudentSummary } from '../../../shared/accountingStudentFinance';
import type { Class } from '../../types';
import { getStudentDirectory } from '../../lib/api/studentDirectoryApi';
import { readChannel } from '../../lib/api/readApi';
import { listPayOSPayments } from '../../lib/api/payosApi';
import { postReceipt } from '../../lib/api/financeApi';
import { formatClassNameWithTeacher } from '../../lib/classes/sortClasses';
import { sendZaloTuitionReminderNotification } from '../../lib/zalo/zaloService';
import Finance from './Finance';

// Finance reads its class and teacher reference lists through React Query, so
// every render needs a client. A fresh one per test keeps the cases isolated.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const workspaceRow = {
  studentId: 's1',
  studentName: 'Nguyễn An',
  studentNameNormalized: 'nguyen an',
  studentCode: 'HS001',
  searchTokens: [],
  studentLifecycle: 'enrolled',
  currentClassId: 'c1',
  currentEnrollmentId: 'e1',
  currentEnrollmentStatus: 'active',
  currentCoursePaymentStatus: 'unpaid',
  classCount: 1,
  courseCount: 1,
  totalPaid: 0,
  totalOutstanding: 900_000,
  overdueCourseCount: 0,
  priorityRank: 1,
  sourceVersion: 1,
  rebuiltAt: '2026-07-29T00:00:00.000Z',
} as AccountingStudentSummary;

let receiptReadError: Error | null = null;
let capturedWorkspaceProps: Record<string, unknown> = {};

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
    profile: { uid: 'accounting-uid', role: 'accounting' },
  }),
}));

vi.mock('../../hooks/useInvalidationRefresh', () => ({
  useInvalidationRefresh: vi.fn(),
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
}));

vi.mock('../../lib/api/payosApi', () => ({
  listPayOSPayments: vi.fn(),
  reconcilePayOSPayments: vi.fn(),
  refreshPayOSPaymentStatus: vi.fn(),
  resolvePayOSReview: vi.fn(),
}));

vi.mock('../../lib/config/accountingStudentWorkspaceMode', () => ({
  ACCOUNTING_STUDENT_WORKSPACE_ENABLED: true,
}));

vi.mock('./components/StudentFinanceWorkspace', () => ({
  StudentFinanceWorkspace: (props: {
    active: boolean;
    classes?: Class[];
    teachers?: readonly { uid: string; displayName: string }[];
    onCollectPayment: (student: AccountingStudentSummary) => void;
    onOpenReceiptHistory: () => void;
    onSendTuitionReminder?: (student: AccountingStudentSummary) => void;
    reminderLoadingStudentIds?: readonly string[];
  }) => {
    capturedWorkspaceProps = props;
    const { active, onCollectPayment, onOpenReceiptHistory } = props;
    return active ? (
      <div>
        <button type="button" onClick={() => onCollectPayment(workspaceRow)}>
          Thu tiền Nguyễn An
        </button>
        <button type="button" onClick={onOpenReceiptHistory}>
          Lịch sử thu
        </button>
      </div>
    ) : null;
  },
}));

vi.mock('../../components/finance/ReceiptModal', () => ({
  ReceiptModal: (props: {
    isOpen: boolean;
    mode: 'fixed' | 'selectable';
    targetStudent?: { id: string; name: string; code?: string };
  }) =>
    props.isOpen ? (
      <div role="dialog" aria-label="Receipt modal mock">
        {props.mode}:{props.targetStudent?.id || 'none'}
      </div>
    ) : null,
}));

vi.mock('./components/ReceiptHistoryDialog', () => ({
  ReceiptHistoryDialog: ({
    onClose,
    sortedClasses,
    teachers,
    referenceDataError,
    onRetryReferenceData,
    historyError,
    onRetryHistory,
    onPostReceipt,
  }: {
    onClose: () => void;
    sortedClasses: Array<{ id: string; name?: string; teacherId?: string }>;
    teachers: Array<{ uid: string; displayName: string }>;
    referenceDataError: string | null;
    onRetryReferenceData: () => void;
    historyError: string | null;
    onRetryHistory: () => void;
    onPostReceipt: (id: string) => void;
  }) => (
    <div role="dialog" aria-label="Lịch sử thu">
      {sortedClasses.map((classInfo) => (
        <span key={classInfo.id}>{formatClassNameWithTeacher(classInfo, teachers)}</span>
      ))}
      {referenceDataError && (
        <div role="alert">
          {referenceDataError}
          <button type="button" onClick={onRetryReferenceData}>
            Thử lại danh bạ
          </button>
        </div>
      )}
      {historyError && (
        <div role="alert">
          {historyError}
          <button type="button" onClick={onRetryHistory}>
            Tải lại lịch sử
          </button>
        </div>
      )}
      <button type="button" onClick={onClose}>
        Đóng lịch sử
      </button>
      <button type="button" onClick={() => onPostReceipt('r1')}>
        Hạch toán phiếu thu
      </button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  receiptReadError = null;
  capturedWorkspaceProps = {};
  window.history.replaceState({}, '', '/tuition?tab=students');

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
          {
            id: 'c2',
            name: 'A1',
            teacherId: 't2',
            studentIds: [],
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      } as never;
    }
    if (params.resource === 'teachers') {
      return {
        teachers: [
          { uid: 't1', displayName: 'Cô Lan' },
          { uid: 't2', displayName: 'Thầy Minh' },
        ],
      } as never;
    }
    if (params.resource === 'receipts') {
      if (receiptReadError) {
        const error = receiptReadError;
        receiptReadError = null;
        throw error;
      }
      return { receipts: [] } as never;
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
      generatedAt: '2026-07-30T00:00:00.000Z',
    },
    page: { limit: 3000, nextCursor: null, hasMore: false },
  } as never);

  vi.mocked(listPayOSPayments).mockResolvedValue({
    success: true,
    payments: [],
    page: { limit: 50, nextCursor: null, hasMore: false },
  });
});

describe('Finance student workspace receipt orchestration', () => {
  it('hides the Receipt tab and lazy-loads the directory for the selected row', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/tuition?tab=students');
    render(<Finance />);

    expect(screen.getByRole('button', { name: /^Công nợ$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Phiếu thu$/i })).not.toBeInTheDocument();
    expect(getStudentDirectory).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Thu tiền Nguyễn An' }));

    expect(await screen.findByRole('dialog', { name: 'Receipt modal mock' })).toHaveTextContent(
      'fixed:s1'
    );
    await waitFor(() => expect(getStudentDirectory).toHaveBeenCalledOnce());
  });

  it('passes class and teacher references to the student workspace', async () => {
    render(<Finance />);

    await waitFor(() => {
      expect(capturedWorkspaceProps.classes).toEqual([
        expect.objectContaining({ id: 'c1', name: 'A1', teacherId: 't1' }),
        expect.objectContaining({ id: 'c2', name: 'A1', teacherId: 't2' }),
      ]);
      expect(capturedWorkspaceProps.teachers).toEqual([
        { uid: 't1', displayName: 'Cô Lan' },
        { uid: 't2', displayName: 'Thầy Minh' },
      ]);
    });
  });

  it('opens receipt history, loads receipts and reuses the cached directory', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/tuition?tab=students&studentSearch=Lan');
    render(<Finance />);

    await user.click(screen.getByRole('button', { name: 'Lịch sử thu' }));

    expect(await screen.findByRole('dialog', { name: 'Lịch sử thu' })).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=students&studentSearch=Lan&view=receipt-history');
    await waitFor(() =>
      expect(readChannel).toHaveBeenCalledWith(
        'finance',
        expect.objectContaining({ resource: 'receipts', limit: 50 })
      )
    );
    expect(getStudentDirectory).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Đóng lịch sử' }));
    await user.click(screen.getByRole('button', { name: 'Thu tiền Nguyễn An' }));
    expect(getStudentDirectory).toHaveBeenCalledOnce();
  });

  it('loads teacher references so duplicate class names stay distinguishable in history', async () => {
    const user = userEvent.setup();
    render(<Finance />);

    await user.click(screen.getByRole('button', { name: 'Lịch sử thu' }));

    expect(await screen.findByText('A1 - Cô Lan')).toBeInTheDocument();
    expect(screen.getByText('A1 - Thầy Minh')).toBeInTheDocument();
    expect(readChannel).toHaveBeenCalledWith('finance', {
      resource: 'teachers',
      limit: 2000,
    });
  });

  it('reloads receipt history after posting a receipt successfully', async () => {
    const user = userEvent.setup();
    vi.mocked(postReceipt).mockResolvedValue({ success: true });
    render(<Finance />);

    await user.click(screen.getByRole('button', { name: 'Lịch sử thu' }));
    await waitFor(() => {
      expect(
        vi.mocked(readChannel).mock.calls.filter(([, params]) => params?.resource === 'receipts')
      ).toHaveLength(1);
    });

    await user.click(screen.getByRole('button', { name: 'Hạch toán phiếu thu' }));

    await waitFor(() => expect(postReceipt).toHaveBeenCalledWith('r1'));
    await waitFor(() => {
      expect(
        vi.mocked(readChannel).mock.calls.filter(([, params]) => params?.resource === 'receipts')
      ).toHaveLength(2);
    });
  });

  it('normalizes the legacy receipt deep link and responds to popstate', async () => {
    window.history.replaceState({}, '', '/tuition?tab=receipts&studentCursor=next-1');
    render(<Finance />);

    expect(await screen.findByRole('dialog', { name: 'Lịch sử thu' })).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=students&studentCursor=next-1&view=receipt-history');

    window.history.replaceState({}, '', '/tuition?tab=students&studentCursor=next-1');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Lịch sử thu' })).not.toBeInTheDocument()
    );
  });

  it('waits for an explicit retry after a deep-link directory read fails', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/tuition?tab=students&view=receipt-history');
    vi.mocked(getStudentDirectory)
      .mockRejectedValueOnce(new Error('Không tải được danh bạ học sinh'))
      .mockImplementation(() => new Promise(() => {}));

    render(<Finance />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh bạ học sinh');
    await Promise.resolve();
    expect(getStudentDirectory).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Thử lại danh bạ' }));
    expect(getStudentDirectory).toHaveBeenCalledTimes(2);
  });

  it('keeps the history dialog open and retries a failed receipt read', async () => {
    const user = userEvent.setup();
    receiptReadError = new Error('Không tải được lịch sử thu');
    render(<Finance />);

    await user.click(screen.getByRole('button', { name: 'Lịch sử thu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được lịch sử thu');

    await user.click(screen.getByRole('button', { name: 'Tải lại lịch sử' }));
    await waitFor(() => {
      const receiptCalls = vi
        .mocked(readChannel)
        .mock.calls.filter(([, params]) => params?.resource === 'receipts');
      expect(receiptCalls).toHaveLength(2);
    });
  });

  it('passes a student-level tuition reminder controller down to the workspace', async () => {
    vi.mocked(sendZaloTuitionReminderNotification).mockResolvedValue({
      success: true,
      tuitionReminderCount: 3,
      semester: 'Khóa 27/08 - 09/11, Khóa 22/08 - 09/12',
    });

    render(<Finance />);

    await waitFor(() => {
      expect(capturedWorkspaceProps).toEqual(
        expect.objectContaining({
          onSendTuitionReminder: expect.any(Function),
          reminderLoadingStudentIds: [],
        })
      );
    });

    const onSendTuitionReminder = capturedWorkspaceProps.onSendTuitionReminder as (
      student: AccountingStudentSummary
    ) => void;

    onSendTuitionReminder({
      studentId: 'stu-1',
      studentName: 'Nguyễn An',
      totalOutstanding: 1_300_000,
    } as AccountingStudentSummary);

    expect(sendZaloTuitionReminderNotification).toHaveBeenCalledWith({
      studentId: 'stu-1',
    });

    await waitFor(() => {
      expect(capturedWorkspaceProps.reminderLoadingStudentIds).toEqual([]);
    });
  });

  it('shows the paid message when wallet balance covers the remaining debt', async () => {
    vi.mocked(sendZaloTuitionReminderNotification).mockResolvedValue({
      success: false,
      error: 'Student has no outstanding tuition debt',
      errorCode: 'TUITION_DEBT_EMPTY',
    });

    render(<Finance />);

    await waitFor(() => {
      expect(capturedWorkspaceProps.onSendTuitionReminder).toEqual(expect.any(Function));
    });

    const onSendTuitionReminder = capturedWorkspaceProps.onSendTuitionReminder as (
      student: AccountingStudentSummary
    ) => void;
    onSendTuitionReminder(workspaceRow);

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.any(String), { icon: 'ℹ️' });
      expect(capturedWorkspaceProps.reminderLoadingStudentIds).toEqual([]);
    });
  });

  it('tracks concurrent student reminder requests independently', async () => {
    type ReminderResult = Awaited<ReturnType<typeof sendZaloTuitionReminderNotification>>;
    let resolveFirst!: (value: ReminderResult) => void;
    let resolveSecond!: (value: ReminderResult) => void;
    vi.mocked(sendZaloTuitionReminderNotification)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          })
      );

    render(<Finance />);

    await waitFor(() => {
      expect(capturedWorkspaceProps.onSendTuitionReminder).toEqual(expect.any(Function));
    });

    const onSendTuitionReminder = capturedWorkspaceProps.onSendTuitionReminder as (
      student: AccountingStudentSummary
    ) => void;
    onSendTuitionReminder(workspaceRow);
    onSendTuitionReminder({
      ...workspaceRow,
      studentId: 's2',
      studentName: 'Trần Bình',
    });

    await waitFor(() => {
      expect(capturedWorkspaceProps.reminderLoadingStudentIds).toEqual(['s1', 's2']);
    });

    resolveFirst({ success: true });
    await waitFor(() => {
      expect(capturedWorkspaceProps.reminderLoadingStudentIds).toEqual(['s2']);
    });

    resolveSecond({ success: true });
    await waitFor(() => {
      expect(capturedWorkspaceProps.reminderLoadingStudentIds).toEqual([]);
    });
  });

  it('shows an informational message when the same reminder was already sent', async () => {
    vi.mocked(sendZaloTuitionReminderNotification).mockResolvedValue({
      success: true,
      alreadySent: true,
    });

    render(<Finance />);

    await waitFor(() => {
      expect(capturedWorkspaceProps.onSendTuitionReminder).toEqual(expect.any(Function));
    });

    const onSendTuitionReminder = capturedWorkspaceProps.onSendTuitionReminder as (
      student: AccountingStudentSummary
    ) => void;
    onSendTuitionReminder(workspaceRow);

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ icon: expect.any(String) })
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
