import React from 'react';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Filter,
  LayoutList,
  Loader2,
  MoreVertical,
  Plus,
  Printer,
  Search,
  Upload,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { auth } from '../../lib/auth/sessionAuth';
import { useAuth } from '../../contexts/AuthContext';
import type { Class, PrintRequest, PrintRequestStatus } from '../../types';
import {
  cancelPrintRequest,
  getPrintRequestFileUrl,
  updatePrintRequestStatus,
} from '../../lib/api/printRequestsApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { officePrintRequestsQueryOptions } from '../../lib/office/officePrintRequestQueries';
import { officeQueryKeys } from '../../lib/office/officeQueryKeys';
import { cn } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ApiDateTextInput } from '../../components/forms/ApiDateTimeInputs';
import {
  FRONTEND_READ_POLL_INTERVAL_MS,
  readClassesData,
} from '../../lib/api/frontendReadApi';

type Props = {
  initialRequestsForTest?: PrintRequest[];
};

type ViewProps = Props & {
  authState: Pick<ReturnType<typeof useAuth>, 'user' | 'profile'>;
};

type UploadFileDraft = {
  id: string;
  file: File;
  quantity: string;
};

type SortMode = 'newest' | 'oldest' | 'needed';
type PrintAction = 'cancel' | 'download' | 'printed' | 'completed' | 'rejected';

const PAGE_SIZE = 5;

const STATUS_OPTIONS: Array<PrintRequestStatus | 'all'> = [
  'all',
  'pending',
  'printed',
  'completed',
  'rejected',
  'cancelled',
];

const UI_COPY = {
  vi: {
    metrics: {
      total: 'Tổng yêu cầu',
      completed: 'Hoàn thành',
      processing: 'Đang xử lý',
      rejected: 'Đã từ chối',
      allTime: 'Tất cả thời gian',
      percent: '{percent}% tổng số',
    },
    requestList: 'Danh sách yêu cầu',
    searchPlaceholder: 'Tìm kiếm yêu cầu...',
    sender: 'Người gửi',
    fileColumn: 'Tệp tin',
    size: 'Kích thước',
    actions: 'Thao tác',
    openActions: 'Mở thao tác',
    downloads: 'Tệp đính kèm',
    noActions: 'Không có thao tác khả dụng',
    sortLabel: 'Sắp xếp',
    newest: 'Mới nhất',
    oldest: 'Cũ nhất',
    neededSoon: 'Cần nhận sớm',
    listView: 'Dạng danh sách',
    roleTeacher: 'Giáo viên',
    showing: 'Hiển thị {start} đến {end} trong tổng số {total} yêu cầu',
    noResults: 'Không có yêu cầu phù hợp bộ lọc hiện tại.',
    fileCount: '{count} tệp',
    noFiles: '0 tệp',
    processingStatus: 'Đang xử lý',
    createTitle: 'Tạo yêu cầu in ấn',
    uploadHint: 'Chọn tệp cần in và số lượng từng tệp.',
    pages: 'trang',
  },
  en: {
    metrics: {
      total: 'Total requests',
      completed: 'Completed',
      processing: 'Processing',
      rejected: 'Rejected',
      allTime: 'All time',
      percent: '{percent}% of total',
    },
    requestList: 'Print request list',
    searchPlaceholder: 'Search requests...',
    sender: 'Sender',
    fileColumn: 'Files',
    size: 'Size',
    actions: 'Actions',
    openActions: 'Open actions',
    downloads: 'Attachments',
    noActions: 'No available actions',
    sortLabel: 'Sort',
    newest: 'Newest',
    oldest: 'Oldest',
    neededSoon: 'Needed soon',
    listView: 'List view',
    roleTeacher: 'Teacher',
    showing: 'Showing {start} to {end} of {total} requests',
    noResults: 'No requests match the current filters.',
    fileCount: '{count} files',
    noFiles: '0 files',
    processingStatus: 'Processing',
    createTitle: 'Create print request',
    uploadHint: 'Choose print files and quantity for each file.',
    pages: 'pages',
  },
} as const;

function actionKey(action: PrintAction, requestId: string, fileId = '') {
  return `${action}:${requestId}:${fileId}`;
}

function getDateKey(value?: string) {
  return String(value || '').slice(0, 10);
}

function formatDateForDisplay(value?: string) {
  const dateKey = getDateKey(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function formatTimeForDisplay(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function getRequestCreatedDate(request: PrintRequest) {
  return request.createdDate || getDateKey(request.createdAt);
}

function getRequestNeededDate(request: PrintRequest) {
  return request.neededDate || getDateKey(request.neededAt);
}

function requestTimestamp(request: PrintRequest) {
  const date = new Date(request.createdAt || getRequestCreatedDate(request));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sortRequests(requests: PrintRequest[], sortMode: SortMode) {
  return [...requests].sort((a, b) => {
    if (sortMode === 'needed') {
      const needed = String(a.neededAt || '').localeCompare(String(b.neededAt || ''));
      if (needed !== 0) return needed;
    }

    const createdDiff = requestTimestamp(b) - requestTimestamp(a);
    if (createdDiff !== 0) return sortMode === 'oldest' ? -createdDiff : createdDiff;

    return String(a.className || '').localeCompare(String(b.className || ''));
  });
}

function getVisiblePageNumbers(totalPages: number, currentPage: number) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const start = Math.min(Math.max(currentPage - 2, 1), totalPages - 4);
  return Array.from({ length: 5 }, (_, index) => start + index);
}

function formatFileSize(bytes: number) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function getTotalFileSize(request: PrintRequest) {
  return request.files.reduce((total, file) => total + (Number(file.fileSize) || 0), 0);
}

function getFileExtension(filename: string) {
  const extension = filename.split('.').pop();
  return extension ? extension.toUpperCase() : 'FILE';
}

function formatFileCount(count: number, copy: (typeof UI_COPY)['vi' | 'en']) {
  if (count <= 0) return copy.noFiles;
  return copy.fileCount.replace('{count}', String(count));
}

function formatPercent(count: number, total: number) {
  if (!total) return '0';
  return ((count / total) * 100).toFixed(1).replace('.0', '');
}

function getStatusBadgeClass(status: PrintRequestStatus) {
  if (status === 'pending') return 'bg-amber-50 text-amber-700 ring-amber-100';
  if (status === 'printed' || status === 'completed') {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  }
  if (status === 'rejected') return 'bg-rose-50 text-rose-700 ring-rose-100';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
}

function getStatusDotClass(status: PrintRequestStatus) {
  if (status === 'pending') return 'bg-amber-500';
  if (status === 'printed' || status === 'completed') return 'bg-emerald-500';
  if (status === 'rejected') return 'bg-rose-500';
  return 'bg-slate-400';
}

function getInitial(name?: string) {
  return (name || '?').trim().slice(0, 1).toUpperCase() || '?';
}

export function PrintSupportView({ initialRequestsForTest, authState }: ViewProps) {
  const { user, profile } = authState;
  const queryClient = useQueryClient();
  const { t: i18n, language } = useLanguage();
  const t = i18n.printSupportPage;
  const copy = UI_COPY[language];
  const isOffice = profile?.role === 'office';
  const actorUid = user?.uid || profile?.uid || '';
  const identity = React.useMemo(
    () => ({ uid: actorUid, role: profile?.role || '' }),
    [actorUid, profile?.role]
  );
  const [createdDateFilter, setCreatedDateFilter] = React.useState('');
  const [neededDateFilter, setNeededDateFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<PrintRequestStatus | 'all'>('all');

  const isPrintQueryEnabled = Boolean(identity.uid && !initialRequestsForTest);
  const officePrintRequestsQuery = useQuery(
    officePrintRequestsQueryOptions(
      identity,
      {
        createdDate: createdDateFilter,
        neededDate: neededDateFilter,
        status: statusFilter,
      },
      isPrintQueryEnabled
    )
  );

  const requests = initialRequestsForTest
    ? initialRequestsForTest
    : officePrintRequestsQuery.data || [];

  const [classes, setClasses] = React.useState<Class[]>([]);
  const [showCreate, setShowCreate] = React.useState(false);
  const [classId, setClassId] = React.useState('');
  const [neededAt, setNeededAt] = React.useState('');
  const [note, setNote] = React.useState('');
  const [draftFiles, setDraftFiles] = React.useState<UploadFileDraft[]>([]);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [sortMode, setSortMode] = React.useState<SortMode>('newest');
  const [currentPage, setCurrentPage] = React.useState(1);
  const [openActionId, setOpenActionId] = React.useState<string | null>(null);
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingActions, setPendingActions] = React.useState<Record<string, boolean>>({});

  const setActionLoading = (key: string, value: boolean) => {
    setPendingActions((current) => {
      if (value) return { ...current, [key]: true };
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  React.useEffect(() => {
    if (!actorUid || isOffice || initialRequestsForTest) return;
    let active = true;
    const refreshClasses = async () => {
      try {
        const payload = await readClassesData();
        if (active) setClasses(payload.classes || []);
      } catch (error) {
        console.error('Teacher classes listener error:', error);
        toast.error(t.classesLoadError);
        if (active) setClasses([]);
      }
    };
    void refreshClasses();
    const interval = window.setInterval(
      () => void refreshClasses(),
      FRONTEND_READ_POLL_INTERVAL_MS
    );
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [actorUid, initialRequestsForTest, isOffice, t.classesLoadError]);

  const getStatusLabel = React.useCallback(
    (status: PrintRequestStatus) =>
      status === 'pending' ? copy.processingStatus : t.statuses[status],
    [copy.processingStatus, t.statuses]
  );

  const filteredRequests = React.useMemo(
    () =>
      sortRequests(
        requests.filter((request) => {
          if (createdDateFilter && getRequestCreatedDate(request) !== createdDateFilter)
            return false;
          if (neededDateFilter && getRequestNeededDate(request) !== neededDateFilter) return false;
          if (statusFilter !== 'all' && request.status !== statusFilter) return false;
          const haystack =
            `${request.teacherName} ${request.className} ${request.note || ''} ${request.files
              .map((file) => file.originalFilename)
              .join(' ')}`.toLowerCase();
          if (searchTerm.trim() && !haystack.includes(searchTerm.trim().toLowerCase()))
            return false;
          return true;
        }),
        sortMode
      ),
    [requests, createdDateFilter, neededDateFilter, statusFilter, searchTerm, sortMode]
  );

  const stats = React.useMemo(
    () => ({
      total: requests.length,
      completed: requests.filter(
        (request) => request.status === 'printed' || request.status === 'completed'
      ).length,
      processing: requests.filter((request) => request.status === 'pending').length,
      rejected: requests.filter((request) => request.status === 'rejected').length,
    }),
    [requests]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const pageStartIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedRequests = filteredRequests.slice(pageStartIndex, pageStartIndex + PAGE_SIZE);
  const pageStart = filteredRequests.length === 0 ? 0 : pageStartIndex + 1;
  const pageEnd = Math.min(pageStartIndex + PAGE_SIZE, filteredRequests.length);
  const visiblePageNumbers = getVisiblePageNumbers(totalPages, currentPage);
  const pageSummary = copy.showing
    .replace('{start}', String(pageStart))
    .replace('{end}', String(pageEnd))
    .replace('{total}', String(filteredRequests.length));

  React.useEffect(() => {
    setCurrentPage(1);
    setOpenActionId(null);
  }, [createdDateFilter, neededDateFilter, statusFilter, searchTerm, sortMode]);

  React.useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    setDraftFiles((current) => [
      ...current,
      ...Array.from(fileList).map((file) => ({
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        quantity: '1',
      })),
    ]);
  };

  const submitRequest = async () => {
    if (!classId || !neededAt || draftFiles.length === 0) {
      toast.error(t.uploadError);
      return;
    }
    const quantities = draftFiles.map((entry) => Number(entry.quantity));
    if (quantities.some((quantity) => !Number.isInteger(quantity) || quantity < 1)) {
      toast.error(t.uploadError);
      return;
    }

    setSubmitting(true);
    try {
      if (!auth.currentUser) throw new Error('Not authenticated');
      const formData = new FormData();
      formData.append('classId', classId);
      formData.append('neededAt', new Date(neededAt).toISOString());
      formData.append('neededDate', neededAt.slice(0, 10));
      formData.append('note', note.trim());
      formData.append('quantities', JSON.stringify(quantities));
      for (const entry of draftFiles) {
        formData.append('files', entry.file);
      }
      const response = await fetch('/api/v1/knowledge-bank/upload-print-request', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || data?.success !== true) throw new Error(data?.error || t.uploadError);
      setShowCreate(false);
      setClassId('');
      setNeededAt('');
      setNote('');
      setDraftFiles([]);
      toast.success(t.submit);
    } catch {
      toast.error(t.uploadError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (requestId: string) => {
    const key = actionKey('cancel', requestId);
    setActionLoading(key, true);
    try {
      await cancelPrintRequest(requestId);
      setOpenActionId(null);
      toast.success(t.cancel);
      if (isOffice) {
        await queryClient.invalidateQueries({
          queryKey: officeQueryKeys.printRequestsRoot(identity),
        });
      }
    } catch {
      toast.error(t.statusError);
    } finally {
      setActionLoading(key, false);
    }
  };

  const handleDownload = async (requestId: string, fileId: string) => {
    const key = actionKey('download', requestId, fileId);
    setActionLoading(key, true);
    try {
      const url = await getPrintRequestFileUrl(requestId, fileId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error(t.downloadError);
    } finally {
      setActionLoading(key, false);
    }
  };

  const handleStatus = async (
    requestId: string,
    status: Extract<PrintRequestStatus, 'printed' | 'completed' | 'rejected'>
  ) => {
    if (status === 'rejected' && !rejectionReason.trim()) {
      toast.error(t.rejectionRequired);
      return;
    }
    const key = actionKey(status, requestId);
    const reason = status === 'rejected' ? rejectionReason.trim() : '';
    const rootKey = officeQueryKeys.printRequestsRoot(identity);
    setActionLoading(key, true);

    // A status change is a deterministic single-row edit, so the row can move
    // before the server confirms — but only inside lists that already hold it.
    let previousLists: Array<[readonly unknown[], PrintRequest[] | undefined]> = [];
    if (isOffice) {
      await queryClient.cancelQueries({ queryKey: rootKey });
      previousLists = queryClient.getQueriesData<PrintRequest[]>({ queryKey: rootKey });
      for (const [listKey, rows] of previousLists) {
        if (!rows?.some((row) => row.id === requestId)) continue;
        const listStatus = String(listKey[listKey.length - 1] || 'all');
        queryClient.setQueryData(
          listKey,
          rows
            .map((row) =>
              row.id === requestId
                ? { ...row, status, rejectionReason: reason || row.rejectionReason }
                : row
            )
            .filter((row) => listStatus === 'all' || row.status === listStatus)
        );
      }
    }

    try {
      await updatePrintRequestStatus(requestId, status, reason);
      setRejectingId(null);
      setRejectionReason('');
      setOpenActionId(null);
      toast.success(t.statusUpdated);
      if (isOffice) {
        await queryClient.invalidateQueries({ queryKey: rootKey });
      }
    } catch {
      for (const [listKey, rows] of previousLists) {
        queryClient.setQueryData(listKey, rows);
      }
      toast.error(t.statusError);
    } finally {
      setActionLoading(key, false);
    }
  };

  const metricCards: Array<{
    id: 'total' | 'completed' | 'processing' | 'rejected';
    label: string;
    value: number;
    helper: string;
    Icon: LucideIcon;
    iconClassName: string;
  }> = [
    {
      id: 'total',
      label: copy.metrics.total,
      value: stats.total,
      helper: copy.metrics.allTime,
      Icon: FileText,
      iconClassName: 'bg-blue-50 text-blue-600 ring-blue-100',
    },
    {
      id: 'completed',
      label: copy.metrics.completed,
      value: stats.completed,
      helper: copy.metrics.percent.replace(
        '{percent}',
        formatPercent(stats.completed, stats.total)
      ),
      Icon: CheckCircle2,
      iconClassName: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    },
    {
      id: 'processing',
      label: copy.metrics.processing,
      value: stats.processing,
      helper: copy.metrics.percent.replace(
        '{percent}',
        formatPercent(stats.processing, stats.total)
      ),
      Icon: Clock3,
      iconClassName: 'bg-amber-50 text-amber-600 ring-amber-100',
    },
    {
      id: 'rejected',
      label: copy.metrics.rejected,
      value: stats.rejected,
      helper: copy.metrics.percent.replace('{percent}', formatPercent(stats.rejected, stats.total)),
      Icon: XCircle,
      iconClassName: 'bg-rose-50 text-rose-600 ring-rose-100',
    },
  ];

  const renderActionMenu = (request: PrintRequest) => {
    const cancelling = Boolean(pendingActions[actionKey('cancel', request.id)]);
    const markingPrinted = Boolean(pendingActions[actionKey('printed', request.id)]);
    const markingCompleted = Boolean(pendingActions[actionKey('completed', request.id)]);
    const rejecting = Boolean(pendingActions[actionKey('rejected', request.id)]);
    const hasDownloads = isOffice && request.files.length > 0;
    const hasWorkflowAction =
      (!isOffice && request.status === 'pending') ||
      (isOffice && request.status === 'pending') ||
      (isOffice && request.status === 'printed');
    const hasVisibleAction = hasDownloads || hasWorkflowAction || rejectingId === request.id;

    if (openActionId !== request.id) return null;

    return (
      <div
        data-testid={`print-actions-${request.id}`}
        className="absolute right-0 top-11 z-30 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_22px_70px_rgba(15,23,42,0.14)]"
      >
        {hasDownloads && (
          <div className="mb-3 rounded-xl bg-slate-50 p-2">
            <div className="px-2 pb-2 text-xs font-extrabold uppercase text-slate-400">
              {copy.downloads}
            </div>
            <div className="space-y-1">
              {request.files.map((file) => {
                const downloading = Boolean(
                  pendingActions[actionKey('download', request.id, file.id)]
                );
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => handleDownload(request.id, file.id)}
                    disabled={downloading}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-60"
                  >
                    {downloading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    ) : (
                      <Download className="h-4 w-4 text-blue-600" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{file.originalFilename}</span>
                    <span className="text-xs text-slate-400">{file.quantity}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {!isOffice && request.status === 'pending' && (
            <button
              type="button"
              onClick={() => handleCancel(request.id)}
              disabled={cancelling}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-sm font-extrabold text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {cancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {cancelling ? t.cancelling : t.cancel}
            </button>
          )}

          {isOffice && request.status === 'pending' && (
            <>
              <button
                type="button"
                onClick={() => handleStatus(request.id, 'printed')}
                disabled={markingPrinted}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)] hover:bg-blue-700 disabled:opacity-60"
              >
                {markingPrinted && <Loader2 className="h-4 w-4 animate-spin" />}
                {markingPrinted ? t.markingPrinted : t.markPrinted}
              </button>
              <button
                type="button"
                onClick={() => setRejectingId(request.id)}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-sm font-extrabold text-red-600 hover:bg-red-50"
              >
                <XCircle className="h-4 w-4" />
                {t.reject}
              </button>
            </>
          )}

          {isOffice && request.status === 'printed' && (
            <button
              type="button"
              onClick={() => handleStatus(request.id, 'completed')}
              disabled={markingCompleted}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(5,150,105,0.2)] hover:bg-emerald-700 disabled:opacity-60"
            >
              {markingCompleted && <Loader2 className="h-4 w-4 animate-spin" />}
              {markingCompleted ? t.markingCompleted : t.markCompleted}
            </button>
          )}
        </div>

        {rejectingId === request.id && (
          <div className="mt-3 flex flex-col gap-2">
            <input
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder={t.rejectionReason}
              disabled={rejecting}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-red-300 focus:ring-4 focus:ring-red-50 disabled:bg-slate-50"
            />
            <button
              type="button"
              onClick={() => handleStatus(request.id, 'rejected')}
              disabled={rejecting}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {rejecting && <Loader2 className="h-4 w-4 animate-spin" />}
              {rejecting ? t.rejecting : t.reject}
            </button>
          </div>
        )}

        {!hasVisibleAction && (
          <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">
            {copy.noActions}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1540px] space-y-6 pb-10 text-slate-900">
      <header className="relative min-h-[128px] overflow-hidden rounded-[1.6rem] bg-gradient-to-r from-white via-blue-50/70 to-white px-5 py-6 shadow-[0_18px_60px_rgba(37,99,235,0.08)] ring-1 ring-blue-100/70 sm:px-7 lg:px-9">
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100">
              <Printer className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-[28px] font-extrabold leading-tight text-slate-950">{t.title}</h1>
              <p className="mt-1.5 text-[15px] font-medium text-slate-500">
                {isOffice ? t.officeSubtitle : t.teacherSubtitle}
              </p>
            </div>
          </div>

          {!isOffice && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-[15px] font-extrabold text-white shadow-[0_16px_32px_rgba(37,99,235,0.26)] hover:bg-blue-700 active:scale-[0.98]"
            >
              <Plus className="h-5 w-5" />
              {t.newRequest}
            </button>
          )}
        </div>

        <div className="pointer-events-none absolute right-10 top-2 hidden h-32 w-72 lg:block">
          <div className="absolute right-8 top-10 h-12 w-32 rounded-2xl bg-blue-200/70 blur-2xl" />
          <div className="absolute right-36 top-16 h-16 w-10 rounded-full border border-emerald-200 bg-emerald-100/70" />
          <div className="absolute right-40 top-5 h-20 w-2 rotate-12 rounded-full bg-emerald-200" />
          <div className="absolute right-16 top-12 h-16 w-24 rounded-2xl bg-blue-600 shadow-[0_18px_36px_rgba(37,99,235,0.22)]" />
          <div className="absolute right-10 top-6 h-16 w-28 rounded-t-xl border border-blue-100 bg-white shadow-sm" />
          <div className="absolute right-20 top-0 h-14 w-22 rounded-t-lg bg-white" />
          <div className="absolute right-0 top-22 h-3 w-32 rounded-full bg-blue-500/70" />
          <div className="absolute right-0 top-28 h-3 w-20 rounded-full bg-amber-300" />
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(({ id, label, value, helper, Icon, iconClassName }) => (
          <article
            key={id}
            data-testid={`print-stat-${id}`}
            className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_20px_48px_rgba(37,99,235,0.08)]"
          >
            <div className="flex items-center gap-5">
              <div
                className={cn(
                  'flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-1',
                  iconClassName
                )}
              >
                <Icon className="h-8 w-8" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-500">{label}</div>
                <div className="mt-2 text-3xl font-black leading-none text-slate-950">{value}</div>
                <div className="mt-3 text-sm font-medium text-slate-500">{helper}</div>
              </div>
            </div>
          </article>
        ))}
      </section>

      {showCreate && (
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-[0_16px_42px_rgba(37,99,235,0.08)]">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-950">{copy.createTitle}</h2>
              <p className="mt-0.5 text-sm font-medium text-slate-500">{copy.uploadHint}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              {t.classLabel}
              <select
                value={classId}
                onChange={(event) => setClassId(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              >
                <option value="">{t.classLabel}</option>
                {classes.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              {t.neededAt}
              <input
                type="datetime-local"
                value={neededAt}
                onChange={(event) => setNeededAt(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              />
            </label>
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t.note}
            className="mt-3 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
          />
          <input
            type="file"
            multiple
            onChange={(event) => addFiles(event.target.files)}
            className="mt-3 block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-semibold text-slate-600"
          />
          <div className="mt-3 space-y-2">
            {draftFiles.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
              >
                <FileText className="h-4 w-4 text-blue-500" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">
                  {entry.file.name}
                </span>
                <input
                  aria-label={`${t.quantity} ${entry.file.name}`}
                  type="number"
                  min={1}
                  value={entry.quantity}
                  onChange={(event) =>
                    setDraftFiles((current) =>
                      current.map((item) =>
                        item.id === entry.id ? { ...item, quantity: event.target.value } : item
                      )
                    )
                  }
                  className="h-10 w-24 rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={submitRequest}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)] hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? t.submitting : t.submit}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 hover:bg-slate-50"
            >
              {language === 'vi' ? 'Đóng' : 'Close'}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_40px_rgba(15,23,42,0.04)]">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <h2 className="text-xl font-extrabold text-slate-950">{copy.requestList}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:flex xl:items-center">
            <label className="flex h-11 min-w-[300px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
              <Search className="h-5 w-5 text-slate-400" />
              <span className="sr-only">{t.search}</span>
              <input
                role="searchbox"
                aria-label={t.search}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="h-full w-full bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>

            {isOffice && (
              <>
                <ApiDateTextInput
                  label={t.createdDate}
                  value={createdDateFilter}
                  onChange={setCreatedDateFilter}
                  className="min-w-[150px] text-sm font-semibold text-slate-700"
                  inputClassName="mt-1 h-11 rounded-xl border-slate-200 pr-11"
                />
                <ApiDateTextInput
                  label={t.neededDate}
                  value={neededDateFilter}
                  onChange={setNeededDateFilter}
                  className="min-w-[150px] text-sm font-semibold text-slate-700"
                  inputClassName="mt-1 h-11 rounded-xl border-slate-200 pr-11"
                />
              </>
            )}

            <label className="relative h-11 min-w-[190px]">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <span className="sr-only">{t.status}</span>
              <select
                aria-label={t.status}
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as PrintRequestStatus | 'all')
                }
                className="h-full w-full appearance-none rounded-xl border border-slate-200 bg-white px-10 text-sm font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all' ? t.allStatuses : getStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>

            <label className="relative h-11 min-w-[150px]">
              <LayoutList className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <span className="sr-only">{copy.sortLabel}</span>
              <select
                aria-label={copy.sortLabel}
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-full w-full appearance-none rounded-xl border border-slate-200 bg-white px-10 text-sm font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              >
                <option value="newest">{copy.newest}</option>
                <option value="oldest">{copy.oldest}</option>
                <option value="needed">{copy.neededSoon}</option>
              </select>
            </label>
          </div>
        </div>

        <div className="space-y-3 md:hidden">
          {paginatedRequests.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-500">
              {isOffice ? t.emptyOffice : t.emptyTeacher}
            </div>
          ) : (
            paginatedRequests.map((request) => {
              const createdDate = formatDateForDisplay(getRequestCreatedDate(request));
              const createdTime = formatTimeForDisplay(request.createdAt);
              const neededDate = formatDateForDisplay(getRequestNeededDate(request));
              const primaryFile = request.files[0];
              const fileCount = formatFileCount(request.files.length, copy);
              const totalSize = formatFileSize(getTotalFileSize(request));

              return (
                <article
                  key={request.id}
                  data-testid={`print-request-mobile-row-${request.id}`}
                  className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-extrabold text-slate-950">
                          {request.className}
                        </h3>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                          {primaryFile
                            ? `${getFileExtension(primaryFile.originalFilename)} ${primaryFile.originalFilename}`
                            : t.files}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`${copy.openActions} ${request.className}`}
                      onClick={() =>
                        setOpenActionId((current) => (current === request.id ? null : request.id))
                      }
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-600"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {renderActionMenu(request)}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-semibold text-slate-500">
                    <div>
                      <div>{t.createdDate}</div>
                      <div className="mt-1 text-sm font-extrabold text-slate-800">
                        {createdDate}
                      </div>
                      {createdTime && (
                        <div className="mt-0.5 text-xs text-slate-400">{createdTime}</div>
                      )}
                    </div>
                    <div>
                      <div>{t.neededDate}</div>
                      <div className="mt-1 text-sm font-extrabold text-slate-800">{neededDate}</div>
                    </div>
                    <div>
                      <div>{copy.fileColumn}</div>
                      <div className="mt-1 text-sm font-extrabold text-slate-800">{fileCount}</div>
                    </div>
                    <div>
                      <div>{copy.size}</div>
                      <div className="mt-1 text-sm font-extrabold text-slate-800">{totalSize}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">
                        {getInitial(request.teacherName)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-extrabold text-slate-900">
                          {request.teacherName}
                        </div>
                        <div className="text-xs font-semibold text-slate-400">
                          {copy.roleTeacher}
                        </div>
                      </div>
                    </div>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-extrabold ring-1',
                        getStatusBadgeClass(request.status)
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          getStatusDotClass(request.status)
                        )}
                      />
                      {getStatusLabel(request.status)}
                    </span>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
          <table className="min-w-[980px] w-full text-left" aria-label={copy.requestList}>
            <thead className="bg-slate-50 text-xs font-extrabold text-slate-500">
              <tr>
                <th className="px-5 py-4">{language === 'vi' ? 'Tiêu đề' : 'Title'}</th>
                <th className="px-5 py-4">{t.createdDate}</th>
                <th className="px-5 py-4">{copy.sender}</th>
                <th className="px-5 py-4">{t.status}</th>
                <th className="px-5 py-4">{copy.fileColumn}</th>
                <th className="px-5 py-4">{copy.size}</th>
                <th className="px-5 py-4 text-right">{copy.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {paginatedRequests.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-sm font-semibold text-slate-500"
                  >
                    {isOffice ? t.emptyOffice : t.emptyTeacher}
                  </td>
                </tr>
              ) : (
                paginatedRequests.map((request) => {
                  const createdDate = formatDateForDisplay(getRequestCreatedDate(request));
                  const createdTime = formatTimeForDisplay(request.createdAt);
                  const neededDate = formatDateForDisplay(getRequestNeededDate(request));
                  const primaryFile = request.files[0];
                  const fileCount = formatFileCount(request.files.length, copy);
                  const totalSize = formatFileSize(getTotalFileSize(request));

                  return (
                    <tr
                      key={request.id}
                      data-testid={`print-request-row-${request.id}`}
                      className="align-middle transition hover:bg-slate-50/70"
                    >
                      <td className="px-5 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-extrabold text-slate-950">
                              {request.className}
                            </div>
                            <div className="mt-1 truncate text-xs font-semibold text-slate-500">
                              {primaryFile
                                ? `${getFileExtension(primaryFile.originalFilename)} ${primaryFile.originalFilename}`
                                : t.files}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-sm font-bold text-slate-700">{createdDate}</div>
                        {createdTime && (
                          <div className="mt-1 text-xs font-semibold text-slate-400">
                            {createdTime}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white shadow-sm">
                            {getInitial(request.teacherName)}
                          </div>
                          <div>
                            <div className="text-sm font-extrabold text-slate-900">
                              {request.teacherName}
                            </div>
                            <div className="text-xs font-semibold text-slate-400">
                              {copy.roleTeacher}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={cn(
                            'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-extrabold ring-1',
                            getStatusBadgeClass(request.status)
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              getStatusDotClass(request.status)
                            )}
                          />
                          {getStatusLabel(request.status)}
                        </span>
                        <div className="mt-1 text-xs font-semibold text-slate-400">
                          {t.neededDate}: {neededDate}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm font-bold text-slate-700">{fileCount}</td>
                      <td className="px-5 py-4 text-sm font-bold text-slate-700">{totalSize}</td>
                      <td className="relative px-5 py-4 text-right">
                        <button
                          type="button"
                          aria-label={`${copy.openActions} ${request.className}`}
                          onClick={() =>
                            setOpenActionId((current) =>
                              current === request.id ? null : request.id
                            )
                          }
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-600"
                        >
                          <MoreVertical className="h-5 w-5" />
                        </button>
                        {renderActionMenu(request)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-col gap-4 text-sm font-medium text-slate-500 lg:flex-row lg:items-center lg:justify-between">
          <div>{filteredRequests.length === 0 ? copy.noResults : pageSummary}</div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              aria-label={language === 'vi' ? 'Trang trước' : 'Previous page'}
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {visiblePageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setCurrentPage(pageNumber)}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-lg text-sm font-extrabold',
                  currentPage === pageNumber
                    ? 'border border-blue-200 bg-blue-50 text-blue-700 shadow-[0_8px_18px_rgba(37,99,235,0.12)]'
                    : 'border border-transparent bg-white text-slate-700 hover:border-blue-200 hover:text-blue-600'
                )}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              aria-label={language === 'vi' ? 'Trang sau' : 'Next page'}
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function PrintSupport(props: Props) {
  const authState = useAuth();
  return <PrintSupportView {...props} authState={authState} />;
}
