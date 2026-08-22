import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  DollarSign,
  FileText,
  CreditCard,
  TrendingDown,
  BarChart3,
  Scale,
  Users,
  Wallet,
  Loader2,
} from 'lucide-react';
import { useInvalidationRefresh } from '../../hooks/useInvalidationRefresh';
import toast from 'react-hot-toast';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { useAuth } from '../../contexts/AuthContext';
import type {
  Class,
  Student,
  CourseFeeLedger,
  Receipt,
  Expense,
  OnlinePaymentRequest,
} from '../../types';
import { ReceiptModal } from '../../components/finance/ReceiptModal';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { VoidReasonDialog } from '../../components/finance/VoidReasonDialog';
import { getStudentDirectory } from '../../lib/api/studentDirectoryApi';
import {
  sendZaloTuitionNoticeNotification,
  sendZaloTuitionReminderNotification,
} from '../../lib/zalo/zaloService';
import {
  ledgerAmount,
  ledgerDiscountTotal,
  ledgerPaidTotal,
  ledgerRemaining,
} from '../../../shared/money';
import { receiptMatchesClass } from '../../../shared/receiptAllocations';
import { ExpenseModal } from '../../components/finance/ExpenseModal';
import {
  postReceipt,
  voidReceipt,
  postExpense,
  voidExpense,
  fetchFinanceReport,
  type FinanceReport,
} from '../../lib/api/financeApi';
import {
  reconcilePayOSPayments,
  refreshPayOSPaymentStatus,
  resolvePayOSReview,
} from '../../lib/api/payosApi';
import { sortClassesByTeacherThenName } from '../../lib/classes/sortClasses';

import { Tab } from './constants';
import { toTime } from './financeUtils';
import { FinanceFilters } from './components/FinanceFilters';
import { GenerateLedgersDialog } from './components/GenerateLedgersDialog';
import { LedgersTab } from './components/LedgersTab';
import { ReceiptsTab } from './components/ReceiptsTab';
import { ExpensesTab } from './components/ExpensesTab';
import { PaymentsTab } from './components/PaymentsTab';
import { WalletTab } from './components/WalletTab';
import { ReportTab, type ReportLoadOptions } from './components/ReportTab';
import { ClassTuitionReconciliationSection } from '../admin/components/financeReport/ClassTuitionReconciliationSection';
import { ResolveReviewModal } from './components/ResolveReviewModal';
import { StudentFinanceWorkspace } from './components/StudentFinanceWorkspace';
import { ReceiptHistoryDialog } from './components/ReceiptHistoryDialog';
import { ACCOUNTING_STUDENT_WORKSPACE_ENABLED } from '../../lib/config/accountingStudentWorkspaceMode';
import type { AccountingStudentSummary } from '../../../shared/accountingStudentFinance';
import {
  isReceiptHistoryRequested,
  setReceiptHistoryView,
} from './accountingReceiptHistoryUrlState';
import {
  financeClassesQueryOptions,
  financeTeachersQueryOptions,
  type FinanceTeacherOption,
} from './financeReferenceQueries';
import {
  financeExpensesQueryOptions,
  financeLedgersQueryOptions,
  financePaymentsQueryOptions,
  financeReceiptsQueryOptions,
  type PaymentHealth,
} from './financeListQueries';

const EMPTY_CLASSES: Class[] = [];
const EMPTY_TEACHERS: FinanceTeacherOption[] = [];
const EMPTY_LEDGERS: CourseFeeLedger[] = [];
const EMPTY_RECEIPTS: Receipt[] = [];
const EMPTY_EXPENSES: Expense[] = [];
const EMPTY_PAYMENTS: OnlinePaymentRequest[] = [];
const EMPTY_PAYMENT_HEALTH: PaymentHealth = {
  pendingOlderThan30m: 0,
  needsReviewOpen: 0,
  staleCreatingGatewaySession: 0,
  failedWebhookEvents24h: 0,
};

/**
 * The tab components call `loadX('reset' | 'append')`. Keeping that signature
 * means none of them had to change when the lists moved to React Query.
 * `refetch` replays every page the user has already loaded, so a reset after
 * posting a receipt no longer throws away their scroll depth.
 */
function useFinanceListLoader(query: {
  refetch: () => Promise<unknown>;
  fetchNextPage: () => Promise<unknown>;
}) {
  const { refetch, fetchNextPage } = query;
  return useCallback(
    async (mode: 'reset' | 'append' = 'reset') => {
      if (mode === 'append') await fetchNextPage();
      else await refetch();
    },
    [fetchNextPage, refetch]
  );
}

function useFinanceListErrorToast(error: Error | null, message: string) {
  useEffect(() => {
    if (error) toast.error(message);
  }, [error, message]);
}

export default function Finance() {
  const { profile } = useAuth();
  const { t, language } = useLanguage();
  const isAdmin = profile?.role === 'admin';
  const profileUid = profile?.uid || '';
  const profileRole = profile?.role || '';
  const referenceIdentity = useMemo(
    () => ({ uid: profileUid, role: profileRole }),
    [profileUid, profileRole]
  );
  const hasIdentity = Boolean(profileUid && profileRole);

  const workspaceEnabled = ACCOUNTING_STUDENT_WORKSPACE_ENABLED;
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const requested =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;

    if (workspaceEnabled) {
      if (requested === 'students' || requested === 'student-finance' || requested === 'receipts') {
        return 'students';
      }
      if (
        requested === 'class-reconciliation' ||
        requested === 'wallet' ||
        requested === 'payments' ||
        requested === 'expenses' ||
        requested === 'report'
      ) {
        return requested;
      }
      return 'students';
    }

    if (
      requested === 'ledgers' ||
      requested === 'class-reconciliation' ||
      requested === 'wallet' ||
      requested === 'receipts' ||
      requested === 'payments' ||
      requested === 'expenses' ||
      requested === 'report'
    ) {
      return requested;
    }
    return 'ledgers';
  });
  const selectFinanceTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('tab', tab);
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  }, []);
  const [students, setStudents] = useState<Student[]>([]);

  // Filters
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Report
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [reportRange, setReportRange] = useState<{ from: string; to: string } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportFrom, setReportFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [reportTo, setReportTo] = useState(() => {
    const now = new Date();
    const finalDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
  });

  // Modals
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [receiptVoidTargetId, setReceiptVoidTargetId] = useState<string | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<AccountingStudentSummary | null>(null);
  const [studentDirectoryLoaded, setStudentDirectoryLoaded] = useState(false);
  const [studentDirectoryLoading, setStudentDirectoryLoading] = useState(false);
  const [studentDirectoryError, setStudentDirectoryError] = useState<string | null>(null);
  const [receiptHistoryOpen, setReceiptHistoryOpen] = useState(
    () =>
      workspaceEnabled &&
      typeof window !== 'undefined' &&
      isReceiptHistoryRequested(window.location.search)
  );

  // Resolve review modal
  const [resolveTarget, setResolveTarget] = useState<OnlinePaymentRequest | null>(null);
  const [resolveDecision, setResolveDecision] = useState<'approve' | 'reject'>('approve');
  const [resolveReason, setResolveReason] = useState('');
  const [resolveLoading, setResolveLoading] = useState(false);

  // Loading states for actions
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reminderLoadingStudentIds, setReminderLoadingStudentIds] = useState<string[]>([]);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [reconcilingPayments, setReconcilingPayments] = useState(false);
  const [refreshingPaymentId, setRefreshingPaymentId] = useState<string | null>(null);

  // Confirm modal
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDanger?: boolean;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const ensureStudentDirectory = useCallback(async () => {
    if (studentDirectoryLoaded || studentDirectoryLoading) return;
    setStudentDirectoryLoading(true);
    setStudentDirectoryError(null);
    try {
      const data = await getStudentDirectory();
      setStudents((data.students || []) as Student[]);
      setStudentDirectoryLoaded(true);
    } catch (error) {
      setStudentDirectoryError(
        error instanceof Error ? error.message : 'Không tải được danh bạ học sinh'
      );
    } finally {
      setStudentDirectoryLoading(false);
    }
  }, [studentDirectoryLoaded, studentDirectoryLoading]);

  const openReceiptForStudent = useCallback(
    (student: AccountingStudentSummary) => {
      setReceiptTarget(student);
      setShowReceiptModal(true);
      void ensureStudentDirectory();
    },
    [ensureStudentDirectory]
  );

  const openReceiptHistory = useCallback(() => {
    if (typeof window === 'undefined') return;
    const query = setReceiptHistoryView(window.location.search, true);
    window.history.pushState(
      { ...window.history.state, receiptHistoryEntry: true },
      '',
      `${window.location.pathname}${query}`
    );
    setReceiptHistoryOpen(true);
    void ensureStudentDirectory();
  }, [ensureStudentDirectory]);

  const closeReceiptHistory = useCallback(() => {
    if (typeof window === 'undefined') return;
    const query = setReceiptHistoryView(window.location.search, false);
    window.history.replaceState(
      { ...window.history.state, receiptHistoryEntry: false },
      '',
      `${window.location.pathname}${query}`
    );
    setReceiptHistoryOpen(false);
  }, []);

  useEffect(() => {
    if (!workspaceEnabled || typeof window === 'undefined') return;

    if (new URLSearchParams(window.location.search).get('tab') === 'receipts') {
      const normalized = setReceiptHistoryView(window.location.search, true);
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${normalized}`
      );
      setReceiptHistoryOpen(true);
    }

    const syncFromUrl = () => {
      setReceiptHistoryOpen(isReceiptHistoryRequested(window.location.search));
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [workspaceEnabled]);

  useEffect(() => {
    if (workspaceEnabled && receiptHistoryOpen && !studentDirectoryError) {
      void ensureStudentDirectory();
    }
  }, [ensureStudentDirectory, receiptHistoryOpen, studentDirectoryError, workspaceEnabled]);

  // ─── Reference data ──────────────────────────────────────────────────────
  // The filter dropdowns need the same class and teacher lists on every tab.
  // These used to live in an effect keyed on `activeTab`, which meant both
  // reads refired every time the user moved between tabs.
  const classesQuery = useQuery(financeClassesQueryOptions(referenceIdentity, hasIdentity));
  const teachersQuery = useQuery(financeTeachersQueryOptions(referenceIdentity, hasIdentity));
  const classes = classesQuery.data ?? EMPTY_CLASSES;
  const teachers = teachersQuery.data ?? EMPTY_TEACHERS;
  const referenceDataLoading =
    (classesQuery.isPending && !classesQuery.data) ||
    (teachersQuery.isPending && !teachersQuery.data);

  if (classesQuery.error) console.error('Error loading finance filters:', classesQuery.error);
  if (teachersQuery.error) console.error('Error loading finance filters:', teachersQuery.error);

  // The student directory keeps its own uid-keyed ETag cache in
  // `studentDirectoryApi`, so asking for it again on each tab costs nothing —
  // but the tabs that never open a receipt should not ask at all.
  useEffect(() => {
    if (!profileUid) return;
    if (workspaceEnabled && activeTab === 'students') return;
    void ensureStudentDirectory();
  }, [activeTab, ensureStudentDirectory, profileUid, workspaceEnabled]);

  // ─── Money lists ─────────────────────────────────────────────────────────
  // Each list stays mounted but disabled while its tab is hidden, so returning
  // to a tab paints the cached rows and only refetches once the 60-second
  // window has passed. The realtime channels below still force a refetch the
  // moment money moves, so the window is never what makes a figure correct.
  const ledgersEnabled = hasIdentity && activeTab === 'ledgers';
  const receiptsEnabled = hasIdentity && (activeTab === 'receipts' || receiptHistoryOpen);
  const expensesEnabled = hasIdentity && activeTab === 'expenses';
  const paymentsEnabled = hasIdentity && activeTab === 'payments';

  const ledgersQuery = useInfiniteQuery(
    financeLedgersQueryOptions(
      referenceIdentity,
      { status: statusFilter, classId: classFilter },
      ledgersEnabled
    )
  );
  const receiptsQuery = useInfiniteQuery(
    financeReceiptsQueryOptions(
      referenceIdentity,
      { status: statusFilter, classId: classFilter, startDate: dateFrom, endDate: dateTo },
      receiptsEnabled
    )
  );
  const expensesQuery = useInfiniteQuery(
    financeExpensesQueryOptions(
      referenceIdentity,
      { status: statusFilter, startDate: dateFrom, endDate: dateTo },
      expensesEnabled
    )
  );
  const paymentsQuery = useInfiniteQuery(
    financePaymentsQueryOptions(referenceIdentity, { status: statusFilter }, paymentsEnabled)
  );

  const ledgers = useMemo(
    () => ledgersQuery.data?.pages.flatMap((page) => page.rows) ?? EMPTY_LEDGERS,
    [ledgersQuery.data]
  );
  const receipts = useMemo(
    () => receiptsQuery.data?.pages.flatMap((page) => page.rows) ?? EMPTY_RECEIPTS,
    [receiptsQuery.data]
  );
  const expenses = useMemo(
    () => expensesQuery.data?.pages.flatMap((page) => page.rows) ?? EMPTY_EXPENSES,
    [expensesQuery.data]
  );
  const payments = useMemo(
    () => paymentsQuery.data?.pages.flatMap((page) => page.rows) ?? EMPTY_PAYMENTS,
    [paymentsQuery.data]
  );
  const paymentHealth = paymentsQuery.data?.pages[0]?.health ?? EMPTY_PAYMENT_HEALTH;

  const ledgersHasMore = Boolean(ledgersQuery.hasNextPage);
  const receiptsHasMore = Boolean(receiptsQuery.hasNextPage);
  const expensesHasMore = Boolean(expensesQuery.hasNextPage);
  const paymentsHasMore = Boolean(paymentsQuery.hasNextPage);

  const ledgersLoading = ledgersQuery.isFetching;
  const receiptsLoading = receiptsQuery.isFetching;
  const expensesLoading = expensesQuery.isFetching;
  const paymentsLoading = paymentsQuery.isFetching;

  const receiptsError = receiptsQuery.error
    ? receiptsQuery.error.message || 'Không tải được lịch sử thu'
    : null;

  const loadLedgers = useFinanceListLoader(ledgersQuery);
  const loadReceipts = useFinanceListLoader(receiptsQuery);
  const loadExpenses = useFinanceListLoader(expensesQuery);
  const loadPayments = useFinanceListLoader(paymentsQuery);

  useFinanceListErrorToast(
    ledgersQuery.error,
    t.financePage.loadLedgersFailed || 'Failed to load ledgers'
  );
  useFinanceListErrorToast(
    receiptsQuery.error,
    t.financePage.loadReceiptsFailed || 'Failed to load receipts'
  );
  useFinanceListErrorToast(
    expensesQuery.error,
    t.financePage.loadExpensesFailed || 'Failed to load expenses'
  );
  useFinanceListErrorToast(paymentsQuery.error, t.financePage.loadPaymentsFailed);

  useInvalidationRefresh({
    channelKey: 'finance-ledger',
    enabled: ledgersEnabled,
    onInvalidate: loadLedgers,
  });

  useInvalidationRefresh({
    channelKey: 'finance-receipt',
    enabled: receiptsEnabled,
    onInvalidate: loadReceipts,
  });

  useInvalidationRefresh({
    channelKey: 'finance-expense',
    enabled: expensesEnabled,
    onInvalidate: loadExpenses,
  });

  useInvalidationRefresh({
    channelKey: 'parent-tuition',
    enabled: paymentsEnabled,
    onInvalidate: loadPayments,
  });

  // ─── Lookup helpers ─────────────────────────────────────────────────────
  const classMap = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c])), [classes]);
  const sortedClasses = useMemo(
    () => sortClassesByTeacherThenName(classes, teachers),
    [classes, teachers]
  );
  const studentMap = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);

  // ─── Filtered Ledgers ───────────────────────────────────────────────────
  const filteredLedgers = useMemo(() => {
    return ledgers.filter((l) => {
      if (classFilter && l.classId !== classFilter) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (searchQuery) {
        const s = studentMap[l.studentId];
        const q = searchQuery.toLowerCase();
        if (
          s &&
          !s.name.toLowerCase().includes(q) &&
          !(s.code || '').toLowerCase().includes(q) &&
          !(s.studentId || '').toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [ledgers, classFilter, statusFilter, searchQuery, studentMap]);

  // ─── Filtered Receipts ──────────────────────────────────────────────────
  const filteredReceipts = useMemo(() => {
    return receipts
      .filter((r) => {
        if (classFilter && !receiptMatchesClass(r, classFilter)) return false;
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        if (dateFrom && r.receivedDate < dateFrom) return false;
        if (dateTo && r.receivedDate > dateTo) return false;
        if (searchQuery) {
          const s = studentMap[r.studentId];
          const q = searchQuery.toLowerCase();
          if (
            s &&
            !s.name.toLowerCase().includes(q) &&
            !(r.receiptNo || '').toLowerCase().includes(q)
          )
            return false;
        }
        return true;
      })
      .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
  }, [receipts, classFilter, statusFilter, dateFrom, dateTo, searchQuery, studentMap]);

  // ─── Filtered Expenses ──────────────────────────────────────────────────
  const filteredExpenses = useMemo(() => {
    return expenses
      .filter((e) => {
        if (statusFilter !== 'all' && e.status !== statusFilter) return false;
        if (dateFrom && e.paidDate < dateFrom) return false;
        if (dateTo && e.paidDate > dateTo) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          if (
            !(e.expenseNo || '').toLowerCase().includes(q) &&
            !(e.payee || '').toLowerCase().includes(q) &&
            !(e.category || '').toLowerCase().includes(q) &&
            !(e.purpose || '').toLowerCase().includes(q) &&
            !(e.note || '').toLowerCase().includes(q)
          )
            return false;
        }
        return true;
      })
      .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
  }, [expenses, statusFilter, dateFrom, dateTo, searchQuery]);

  const filteredPayments = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return payments
      .filter((p) => {
        if (classFilter && p.classId !== classFilter) return false;
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (!q) return true;
        return (
          String(p.orderCode || '').includes(q) ||
          (p.studentName || '').toLowerCase().includes(q) ||
          (p.className || '').toLowerCase().includes(q) ||
          (p.paymentLinkId || '').toLowerCase().includes(q) ||
          (p.gatewayReference || '').toLowerCase().includes(q) ||
          (p.manualReceiptNo || '').toLowerCase().includes(q) ||
          (p.reviewReason || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const reviewPriority =
          Number(b.status === 'needs_review') - Number(a.status === 'needs_review');
        if (reviewPriority) return reviewPriority;
        return toTime(b.createdAt) - toTime(a.createdAt);
      });
  }, [payments, classFilter, statusFilter, searchQuery]);

  // ─── Stats ──────────────────────────────────────────────────────────────
  const ledgerStats = useMemo(() => {
    const total = filteredLedgers.reduce((s, l) => s + ledgerAmount(l), 0);
    const discount = filteredLedgers.reduce((s, l) => s + ledgerDiscountTotal(l), 0);
    const paid = filteredLedgers.reduce((s, l) => s + ledgerPaidTotal(l), 0);
    const remaining = filteredLedgers.reduce((s, l) => s + ledgerRemaining(l), 0);
    return { total, discount, paid, remaining };
  }, [filteredLedgers]);

  // ─── Actions ────────────────────────────────────────────────────────────
  const handleReconcilePayments = async () => {
    try {
      setReconcilingPayments(true);
      const result = await reconcilePayOSPayments();
      toast.success(t.financePage.reconcileResult.replace('{count}', String(result.checked)));
      await loadPayments('reset');
    } catch (err) {
      console.error('Error reconciling payOS payments:', err);
      toast.error(t.financePage.reconcileFailed);
    } finally {
      setReconcilingPayments(false);
    }
  };

  const handleRefreshPaymentStatus = async (payment: OnlinePaymentRequest) => {
    try {
      setRefreshingPaymentId(payment.id);
      const result = await refreshPayOSPaymentStatus(payment.id);
      toast.success(t.financePage.statusUpdated.replace('{status}', result.status));
      await loadPayments('reset');
    } catch (err) {
      console.error('Error refreshing payOS payment status:', err);
      toast.error(t.financePage.paymentRefreshFailed);
    } finally {
      setRefreshingPaymentId(null);
    }
  };

  const handleResolveReview = async () => {
    if (!resolveTarget) return;
    if (!resolveReason.trim()) {
      toast.error(t.financePage.enterReason);
      return;
    }

    try {
      setResolveLoading(true);
      const result = await resolvePayOSReview(resolveTarget.id, resolveDecision, resolveReason);
      toast.success(
        result.action === 'manual_handling_required'
          ? t.financePage.manualHandlingRequired
          : result.action === 'approved'
            ? t.financePage.paymentApproved
            : t.financePage.paymentRejected
      );
      setResolveTarget(null);
      setResolveReason('');
      await loadPayments('reset');
    } catch (err) {
      console.error('Error resolving review:', err);
      toast.error(t.financePage.resolutionFailed);
    } finally {
      setResolveLoading(false);
    }
  };

  const handleSendTuitionReminder = async (ledger: CourseFeeLedger) => {
    const student = studentMap[ledger.studentId];
    if (ledgerRemaining(ledger) <= 0) {
      toast.error(t.financePage.ledgerAlreadyPaid);
      return;
    }
    if (!student?.contact) {
      toast.error(t.financePage.noParentPhone);
      return;
    }

    const loadingKey = `tuition-reminder-${ledger.id}`;
    setActionLoading(loadingKey);
    try {
      const result = await sendZaloTuitionReminderNotification({
        ledgerId: ledger.id,
        courseEndDate: ledger.termEnd || classMap[ledger.classId]?.endDate || '',
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to send tuition reminder');
      }
      toast.success(
        result.tuitionReminderCount
          ? t.financePage.tuitionReminderSent.replace(
              '{count}',
              String(result.tuitionReminderCount)
            )
          : t.financePage.reminderSentZalo
      );
    } catch (err) {
      console.error('Error sending tuition reminder:', err);
      toast.error(err instanceof Error ? err.message : t.financePage.sendReminderFailed);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendStudentTuitionReminder = async (student: AccountingStudentSummary) => {
    setReminderLoadingStudentIds((current) =>
      current.includes(student.studentId) ? current : [...current, student.studentId]
    );
    try {
      const result = await sendZaloTuitionReminderNotification({
        studentId: student.studentId,
      });
      if (!result.success) {
        if (result.errorCode === 'TUITION_DEBT_EMPTY') {
          toast(t.financePage.ledgerAlreadyPaid, { icon: 'ℹ️' });
          return;
        }
        throw new Error(result.error || 'Failed to send tuition reminder');
      }
      if (result.alreadySent) {
        toast(t.financePage.reminderAlreadySent, { icon: 'ℹ️' });
        return;
      }
      toast.success(
        result.tuitionReminderCount
          ? t.financePage.tuitionReminderSent.replace(
              '{count}',
              String(result.tuitionReminderCount)
            )
          : t.financePage.reminderSentZalo
      );
    } catch (error) {
      console.error('Error sending student tuition reminder:', error);
      toast.error(error instanceof Error ? error.message : t.financePage.sendReminderFailed);
    } finally {
      setReminderLoadingStudentIds((current) =>
        current.filter((studentId) => studentId !== student.studentId)
      );
    }
  };

  const handleSendTuitionNotice = async (ledger: CourseFeeLedger) => {
    const student = studentMap[ledger.studentId];
    if (!student?.contact) {
      toast.error(t.financePage.noParentPhone);
      return;
    }

    const loadingKey = `tuition-notice-${ledger.id}`;
    setActionLoading(loadingKey);
    try {
      const result = await sendZaloTuitionNoticeNotification({
        ledgerId: ledger.id,
      });
      if (!result.success) {
        if (result.alreadySent) {
          toast(t.financePage.tuitionNotifSent, { icon: 'ℹ️' });
          return;
        }
        throw new Error(result.error || 'Failed to send tuition notice');
      }
      toast.success(t.financePage.noticeSentZalo);
    } catch (err) {
      console.error('Error sending tuition notice:', err);
      toast.error(err instanceof Error ? err.message : t.financePage.sendNoticeFailed);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePostReceipt = async (id: string) => {
    setActionLoading(id);
    try {
      await postReceipt(id);
      toast.success(t.financePage.receiptPosted);
      await loadReceipts('reset');
    } catch (err) {
      console.error('Error posting receipt:', err);
      toast.error(t.financePage.receiptPostFailed);
    } finally {
      setActionLoading(null);
    }
  };

  const handleVoidReceipt = async (id: string) => {
    setReceiptVoidTargetId(id);
  };

  const confirmReceiptVoid = async (input: { reason: string; idempotencyKey: string }) => {
    if (!receiptVoidTargetId) return;
    setActionLoading(receiptVoidTargetId);
    try {
      await voidReceipt(receiptVoidTargetId, input);
      toast.success(t.financePage.receiptVoided);
      setReceiptVoidTargetId(null);
      await loadReceipts('reset');
    } catch (err) {
      console.error('Error voiding receipt:', err);
      toast.error(t.financePage.receiptVoidFailed);
      throw err;
    } finally {
      setActionLoading(null);
    }
  };

  const handlePostExpense = async (id: string) => {
    setActionLoading(id);
    try {
      await postExpense(id);
      toast.success(t.financePage.expensePosted);
    } catch (err) {
      console.error('Error posting expense:', err);
      toast.error(t.financePage.expensePostFailed);
    } finally {
      setActionLoading(null);
    }
  };

  const handleVoidExpense = async (id: string) => {
    setConfirmState({
      isOpen: true,
      title: t.financePage.voidExpense,
      message: t.financePage.voidExpenseConfirm,
      isDanger: true,
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, isOpen: false }));
        setActionLoading(id);
        try {
          await voidExpense(id);
          toast.success(t.financePage.expenseVoided);
        } catch (err) {
          console.error('Error voiding expense:', err);
          toast.error(t.financePage.expenseVoidFailed);
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  const handleLoadReport = useCallback(
    async (options: ReportLoadOptions = {}) => {
      const requestedRange = options.range ?? { from: reportFrom, to: reportTo };
      setReportLoading(true);
      try {
        const data = await fetchFinanceReport(requestedRange.from, requestedRange.to, {
          forceLive: options.forceLive,
          includeDaily: true,
        });
        setReport(data);
        setReportRange(requestedRange);
      } catch (err) {
        console.error('Error loading report:', err);
        const errorCode = (err as { errorCode?: string } | null)?.errorCode;
        const errorKey =
          errorCode === 'report_too_large'
            ? t.financePage.reportTooLarge
            : t.financePage.loadReportFailed;
        toast.error(errorKey);
      } finally {
        setReportLoading(false);
      }
    },
    [reportFrom, reportTo, t.financePage.loadReportFailed, t.financePage.reportTooLarge]
  );

  const tabs = (
    [
      ...(workspaceEnabled
        ? [{ key: 'students' as Tab, label: t.financePage.tabLedgers, icon: <Users size={16} /> }]
        : []),
      ...(!workspaceEnabled
        ? [
            {
              key: 'ledgers' as Tab,
              label: t.financePage.tabLedgers,
              icon: <DollarSign size={16} />,
            },
          ]
        : []),
      {
        key: 'class-reconciliation' as Tab,
        label: t.financePage.tabClassReconciliation,
        icon: <Scale size={16} />,
      },
      {
        key: 'wallet' as Tab,
        label: t.financePage.tabWallet,
        icon: <Wallet size={16} />,
      },
      ...(!workspaceEnabled
        ? [
            {
              key: 'receipts' as Tab,
              label: t.financePage.tabReceipts,
              icon: <FileText size={16} />,
            },
          ]
        : []),
      {
        key: 'payments',
        label: t.financePage.tabPayments,
        icon: <CreditCard size={16} />,
      },
      {
        key: 'expenses',
        label: t.financePage.tabExpenses,
        icon: <TrendingDown size={16} />,
      },
      {
        key: 'report',
        label: t.financePage.tabReport,
        icon: <BarChart3 size={16} />,
      },
    ] as { key: Tab; label: string; icon: React.ReactNode }[]
  ).filter(
    (tab, index, all) =>
      (workspaceEnabled || tab.key !== 'students') &&
      all.findIndex((candidate) => candidate.key === tab.key) === index
  );

  return (
    <div className="finance-dashboard space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t.financePage.title}</h1>
          <p className="text-sm text-slate-500 mt-1">{t.financePage.description}</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              selectFinanceTab(tab.key);
              setStatusFilter('all');
              setSearchQuery('');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {referenceDataLoading && (
        <div
          role="status"
          data-testid="finance-reference-loading"
          className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t.financePage.loadingReferences}</span>
        </div>
      )}

      {activeTab !== 'students' &&
        activeTab !== 'student-finance' &&
        activeTab !== 'class-reconciliation' && (
          <FinanceFilters
            activeTab={activeTab}
            classFilter={classFilter}
            setClassFilter={setClassFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            dateFrom={dateFrom}
            setDateFrom={setDateFrom}
            dateTo={dateTo}
            setDateTo={setDateTo}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            sortedClasses={sortedClasses}
            teachers={teachers}
            referenceDataLoading={referenceDataLoading}
            t={t}
          />
        )}

      {/* ─── Tab: Class tuition reconciliation ─────────────────────────────── */}
      {/*
        Mounted only while its tab is open: the block is whole-course scoped and
        fetches its own class list, so keeping it alive would cost every accountant
        a classes read on page load whether or not they ever open this tab.
      */}
      {activeTab === 'class-reconciliation' && (
        <ClassTuitionReconciliationSection
          language={language}
          t={t.adminFinanceReport.classReconciliation}
        />
      )}

      {/* ─── Tab: Ledgers ──────────────────────────────────────────────────── */}

      <StudentFinanceWorkspace
        active={activeTab === 'students' || activeTab === 'student-finance'}
        classes={classes}
        teachers={teachers}
        onGenerateLedgers={() => setGenerateDialogOpen(true)}
        onCollectPayment={openReceiptForStudent}
        onOpenReceiptHistory={openReceiptHistory}
        onSendTuitionReminder={(student) => void handleSendStudentTuitionReminder(student)}
        reminderLoadingStudentIds={reminderLoadingStudentIds}
      />

      <LedgersTab
        activeTab={activeTab}
        ledgerStats={ledgerStats}
        classMap={classMap}
        filteredLedgers={filteredLedgers}
        studentMap={studentMap}
        actionLoading={actionLoading}
        isAdmin={isAdmin}
        language={language}
        ledgersHasMore={ledgersHasMore}
        ledgersLoading={ledgersLoading}
        loadLedgers={loadLedgers}
        handleSendTuitionReminder={handleSendTuitionReminder}
        handleSendTuitionNotice={handleSendTuitionNotice}
        t={t}
      />

      <GenerateLedgersDialog
        open={generateDialogOpen}
        studentMap={studentMap}
        onClose={() => setGenerateDialogOpen(false)}
        onApplied={() => {
          if (activeTab === 'ledgers') void loadLedgers('reset');
        }}
      />

      {/* ─── Tab: Receipts ──────────────────────────────────────────────────── */}
      <ReceiptsTab
        activeTab={activeTab}
        setShowReceiptModal={setShowReceiptModal}
        filteredReceipts={filteredReceipts}
        studentMap={studentMap}
        classMap={classMap}
        actionLoading={actionLoading}
        handlePostReceipt={handlePostReceipt}
        handleVoidReceipt={handleVoidReceipt}
        receiptsHasMore={receiptsHasMore}
        receiptsLoading={receiptsLoading}
        loadReceipts={loadReceipts}
        language={language}
        t={t}
      />

      {workspaceEnabled && receiptHistoryOpen && (
        <ReceiptHistoryDialog
          receipts={filteredReceipts}
          studentMap={studentMap}
          classMap={classMap}
          actionLoading={actionLoading}
          onPostReceipt={handlePostReceipt}
          onVoidReceipt={handleVoidReceipt}
          hasMore={receiptsHasMore}
          loading={receiptsLoading}
          onLoadMore={() => loadReceipts('append')}
          language={language}
          t={t}
          classFilter={classFilter}
          setClassFilter={setClassFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          sortedClasses={sortedClasses}
          teachers={teachers}
          referenceDataLoading={
            studentDirectoryLoading || (!studentDirectoryLoaded && !studentDirectoryError)
          }
          referenceDataError={studentDirectoryError}
          onRetryReferenceData={() => void ensureStudentDirectory()}
          historyError={receiptsError}
          onRetryHistory={() => void loadReceipts('reset')}
          onClose={closeReceiptHistory}
        />
      )}

      {/* ─── Tab: Expenses ──────────────────────────────────────────────────── */}
      <ExpensesTab
        activeTab={activeTab}
        setShowExpenseModal={setShowExpenseModal}
        filteredExpenses={filteredExpenses}
        actionLoading={actionLoading}
        handlePostExpense={handlePostExpense}
        handleVoidExpense={handleVoidExpense}
        expensesHasMore={expensesHasMore}
        expensesLoading={expensesLoading}
        loadExpenses={loadExpenses}
        language={language}
        t={t}
      />

      {/* ─── Tab: Wallet ──────────────────────────────────────────────────── */}
      <WalletTab
        activeTab={activeTab}
        students={students}
        classes={classes}
        language={language}
        t={t}
        onWalletChanged={() => loadLedgers('reset')}
      />

      {/* ─── Tab: Payments (Online) ─────────────────────────────────────────── */}
      <PaymentsTab
        activeTab={activeTab}
        handleReconcilePayments={handleReconcilePayments}
        reconcilingPayments={reconcilingPayments}
        loadPayments={loadPayments}
        paymentsLoading={paymentsLoading}
        paymentHealth={paymentHealth}
        filteredPayments={filteredPayments}
        refreshingPaymentId={refreshingPaymentId}
        handleRefreshPaymentStatus={handleRefreshPaymentStatus}
        setResolveTarget={setResolveTarget}
        setResolveDecision={setResolveDecision}
        setResolveReason={setResolveReason}
        paymentsHasMore={paymentsHasMore}
        language={language}
        t={t}
      />

      {/* ─── Resolve Review Modal ───────────────────────────────────────────── */}
      <ResolveReviewModal
        resolveTarget={resolveTarget}
        setResolveTarget={setResolveTarget}
        resolveDecision={resolveDecision}
        setResolveDecision={setResolveDecision}
        resolveReason={resolveReason}
        setResolveReason={setResolveReason}
        resolveLoading={resolveLoading}
        handleResolveReview={handleResolveReview}
        t={t}
      />

      {/* ─── Tab: Report ────────────────────────────────────────────────────── */}
      <ReportTab
        activeTab={activeTab}
        reportFrom={reportFrom}
        setReportFrom={setReportFrom}
        reportTo={reportTo}
        setReportTo={setReportTo}
        handleLoadReport={handleLoadReport}
        reportLoading={reportLoading}
        report={report}
        reportRange={reportRange}
        language={language}
        t={t}
      />

      {/* Modals */}
      {receiptTarget ? (
        <ReceiptModal
          mode="fixed"
          targetStudent={{
            id: receiptTarget.studentId,
            name: receiptTarget.studentName,
            code: receiptTarget.studentCode,
          }}
          isOpen={showReceiptModal}
          onClose={() => {
            setShowReceiptModal(false);
            setReceiptTarget(null);
          }}
          onSuccess={() => {
            if (receiptHistoryOpen) void loadReceipts('reset');
          }}
          classes={classes.filter((item) => item.status !== 'archived')}
          students={students}
          ledgers={ledgers}
          teachers={teachers}
          studentDirectoryLoading={
            studentDirectoryLoading || (!studentDirectoryLoaded && !studentDirectoryError)
          }
          studentDirectoryError={studentDirectoryError}
          onRetryStudentDirectory={() => void ensureStudentDirectory()}
        />
      ) : (
        <ReceiptModal
          mode="selectable"
          isOpen={showReceiptModal}
          onClose={() => setShowReceiptModal(false)}
          classes={classes.filter((item) => item.status !== 'archived')}
          students={students}
          ledgers={ledgers}
          teachers={teachers}
        />
      )}
      <ExpenseModal
        isOpen={showExpenseModal}
        students={students}
        onClose={() => {
          setShowExpenseModal(false);
        }}
      />
      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState((s) => ({ ...s, isOpen: false }))}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        isDanger={confirmState.isDanger}
      />
      <VoidReasonDialog
        isOpen={Boolean(receiptVoidTargetId)}
        title={t.financePage.voidReceipt}
        message={t.financePage.voidReceiptConfirm}
        confirmLabel={language === 'vi' ? 'Xác nhận hủy' : 'Confirm void'}
        operationPrefix="receipt-void"
        onClose={() => setReceiptVoidTargetId(null)}
        onConfirm={confirmReceiptVoid}
      />
    </div>
  );
}
