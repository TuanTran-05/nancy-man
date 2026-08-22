import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Filter,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { ApiDateTextInput } from '../../components/forms/ApiDateTimeInputs';
import { useLanguage } from '../../lib/i18n/useLanguage';
import {
  getZaloHistory,
  getZaloStatus,
  resendZaloHistoryEntry,
  type ZaloHistoryEntry,
  type ZaloHistoryFilters,
  type ZaloStatusResponse,
} from '../../lib/zalo/zaloService';
import { ZaloHistoryDetails } from '../../components/zalo/ZaloHistoryDetails';
import { ZaloManualSendPanel } from '../../components/zalo/ZaloManualSendPanel';
import { ZaloBotManagementPanel } from '../../components/zalo/ZaloBotManagementPanel';
import { ZaloActionDialog } from '../../components/zalo/ZaloActionDialog';

const COPY = {
  vi: {
    title: 'Zalo OA',
    description:
      'Theo dõi toàn bộ lần gửi, lỗi nhà cung cấp và thao tác gửi lại của quản trị viên.',
    connected: 'OA đang kết nối',
    disconnected: 'OA chưa sẵn sàng',
    loaded: 'Đã tải',
    sent: 'Thành công',
    failed: 'Thất bại',
    resends: 'Gửi lại',
    allTypes: 'Tất cả loại',
    allStatuses: 'Tất cả trạng thái',
    sending: 'Đang gửi',
    search: 'Tên, mã học sinh, SĐT, mã tin hoặc lỗi',
    from: 'Từ ngày',
    to: 'Đến ngày',
    apply: 'Áp dụng',
    clear: 'Xóa lọc',
    refresh: 'Làm mới',
    time: 'Thời gian',
    recipient: 'Người nhận',
    category: 'Loại',
    result: 'Kết quả',
    details: 'Chi tiết',
    action: 'Thao tác',
    resend: 'Gửi lại',
    loadMore: 'Tải thêm',
    noLogs: 'Không có lịch sử phù hợp với bộ lọc.',
    loadingError: 'Không thể tải lịch sử Zalo OA.',
    exactError: 'Lỗi cụ thể',
    messageId: 'Mã tin Zalo',
    templateId: 'Template ID',
    sourceLog: 'Bản ghi nguồn',
    resendBy: 'Người gửi lại',
    resendReason: 'Lý do gửi lại',
    confirmTitle: 'Xác nhận gửi lại qua Zalo OA',
    confirmBody:
      'Hệ thống sẽ bỏ qua khóa đã gửi và chống trùng cho lần này. Các kiểm tra dữ liệu, số điện thoại và template vẫn được giữ nguyên.',
    reasonLabel: 'Lý do gửi lại',
    reasonPlaceholder: 'Ví dụ: Phụ huynh chưa nhận được tin lần trước',
    phone: 'Số điện thoại',
    cancel: 'Hủy',
    confirm: 'Xác nhận gửi',
    resendSuccess: 'Đã gửi lại và tạo một bản ghi lịch sử mới.',
    unavailable: 'Không thể gửi lại',
    scanNotice: 'Bộ lọc đã quét giới hạn của lượt này. Có thể tải thêm để tiếp tục tìm.',
  },
  en: {
    title: 'Zalo OA',
    description: 'Review every delivery attempt, provider error, and administrator resend.',
    connected: 'OA connected',
    disconnected: 'OA unavailable',
    loaded: 'Loaded',
    sent: 'Sent',
    failed: 'Failed',
    resends: 'Resends',
    allTypes: 'All types',
    allStatuses: 'All statuses',
    sending: 'Sending',
    search: 'Name, student ID, phone, message ID, or error',
    from: 'From',
    to: 'To',
    apply: 'Apply',
    clear: 'Clear',
    refresh: 'Refresh',
    time: 'Time',
    recipient: 'Recipient',
    category: 'Type',
    result: 'Result',
    details: 'Details',
    action: 'Action',
    resend: 'Resend',
    loadMore: 'Load more',
    noLogs: 'No Zalo history matches these filters.',
    loadingError: 'Could not load Zalo OA history.',
    exactError: 'Exact error',
    messageId: 'Zalo message ID',
    templateId: 'Template ID',
    sourceLog: 'Source log',
    resendBy: 'Resent by',
    resendReason: 'Resend reason',
    confirmTitle: 'Confirm Zalo OA resend',
    confirmBody:
      'This attempt bypasses the previous-send and short deduplication locks. Data, phone, and template validation still apply.',
    reasonLabel: 'Reason for resend',
    reasonPlaceholder: 'Example: Parent did not receive the previous message',
    phone: 'Phone',
    cancel: 'Cancel',
    confirm: 'Confirm resend',
    resendSuccess: 'Message resent and a new history entry was created.',
    unavailable: 'Resend unavailable',
    scanNotice: 'This request reached its scan limit. Load more to continue searching.',
  },
} as const;

const TYPE_OPTIONS = [
  'manual',
  'absence',
  'evaluation_notice',
  'rank_achievement',
  'tuition_reminder',
  'tuition_notice',
  'payment',
  'staff-credentials',
  'otp_password_reset',
  'otp_profile_phone',
  'test',
];

function typeLabel(type: string, language: 'vi' | 'en') {
  const labels: Record<string, [string, string]> = {
    absence: ['Vắng', 'Absence'],
    evaluation: ['Nhận xét', 'Evaluation'],
    evaluation_notice: ['Nhận xét', 'Evaluation'],
    rank_achievement: ['Thành tích', 'Achievement'],
    tuition_reminder: ['Nhắc học phí', 'Tuition reminder'],
    tuition_notice: ['Học phí khóa mới', 'Next-course tuition'],
    next_course_tuition: ['Học phí khóa mới', 'Next-course tuition'],
    payment: ['Xác nhận thanh toán', 'Payment confirmation'],
    manual: ['Gửi thủ công', 'Manual send'],
    'staff-credentials': ['Cấp tài khoản', 'Account credentials'],
    otp_password_reset: ['OTP đặt lại mật khẩu', 'Password reset OTP'],
    otp_profile_phone: ['OTP đổi số điện thoại', 'Phone change OTP'],
    test: ['Tin nhắn thử', 'Test message'],
  };
  const label = labels[type];
  return label
    ? label[language === 'vi' ? 0 : 1]
    : type || (language === 'vi' ? 'Không rõ' : 'Unknown');
}

function formatTimestamp(value: string, language: 'vi' | 'en') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US');
}

function recipientLabel(log: ZaloHistoryEntry) {
  return (
    log.studentName || log.email || log.studentCode || log.studentId || log.phone || 'Không rõ'
  );
}

function StatusBadge({ status, language }: { status: string; language: 'vi' | 'en' }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> {language === 'vi' ? 'Thành công' : 'Sent'}
      </span>
    );
  }
  if (status === 'sending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
        <Clock3 className="h-3.5 w-3.5" /> {language === 'vi' ? 'Đang gửi' : 'Sending'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400">
      <XCircle className="h-3.5 w-3.5" /> {language === 'vi' ? 'Thất bại' : 'Failed'}
    </span>
  );
}

export default function ZaloOA() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const [logs, setLogs] = useState<ZaloHistoryEntry[]>([]);
  const [status, setStatus] = useState<ZaloStatusResponse | null>(null);
  const [filters, setFilters] = useState<ZaloHistoryFilters>({ limit: 50 });
  const [appliedFilters, setAppliedFilters] = useState<ZaloHistoryFilters>({ limit: 50 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [scanLimitReached, setScanLimitReached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resendTarget, setResendTarget] = useState<ZaloHistoryEntry | null>(null);
  const [resendReason, setResendReason] = useState('');
  const [resending, setResending] = useState(false);

  const loadHistory = useCallback(
    async (append = false, requestedFilters = appliedFilters) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError('');
      const result = await getZaloHistory({
        ...requestedFilters,
        cursor: append && cursor ? cursor : undefined,
      });
      if (!result.success) {
        setError(result.error || copy.loadingError);
      } else {
        setLogs((current) => (append ? [...current, ...result.logs] : result.logs));
        setCursor(result.page.nextCursor);
        setHasMore(result.page.hasMore);
        setScanLimitReached(Boolean(result.page.scanLimitReached));
      }
      setLoading(false);
      setLoadingMore(false);
    },
    [appliedFilters, copy.loadingError, cursor]
  );

  const refreshAll = useCallback(async () => {
    setCursor(null);
    const [, oaStatus] = await Promise.all([loadHistory(false), getZaloStatus()]);
    setStatus(oaStatus);
  }, [loadHistory]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const [historyResult, oaStatus] = await Promise.all([
        getZaloHistory({ limit: 50 }),
        getZaloStatus(),
      ]);
      if (!active) return;
      setStatus(oaStatus);
      if (historyResult.success) {
        setLogs(historyResult.logs);
        setCursor(historyResult.page.nextCursor);
        setHasMore(historyResult.page.hasMore);
        setScanLimitReached(Boolean(historyResult.page.scanLimitReached));
      } else {
        setError(historyResult.error || copy.loadingError);
      }
      setLoading(false);
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [copy.loadingError]);

  const stats = useMemo(
    () => ({
      total: logs.length,
      sent: logs.filter((log) => log.status === 'sent').length,
      failed: logs.filter((log) => log.status === 'failed').length,
      resends: logs.filter((log) => log.isResend).length,
    }),
    [logs]
  );

  const applyFilters = () => {
    const next = { ...filters, limit: 50 };
    setAppliedFilters(next);
    setCursor(null);
    void loadHistory(false, next);
  };

  const clearFilters = () => {
    const next = { limit: 50 };
    setFilters(next);
    setAppliedFilters(next);
    setCursor(null);
    void loadHistory(false, next);
  };

  const confirmResend = async () => {
    if (!resendTarget || resendReason.trim().length < 3 || resending) return;
    setResending(true);
    const result = await resendZaloHistoryEntry(resendTarget.id, resendReason.trim());
    setResending(false);
    if (!result.success) {
      toast.error(result.error || copy.loadingError);
      return;
    }
    toast.success(copy.resendSuccess);
    setResendTarget(null);
    setResendReason('');
    setCursor(null);
    await loadHistory(false);
  };

  const closeResendDialog = () => {
    if (resending) return;
    setResendTarget(null);
    setResendReason('');
  };

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-heading">{copy.title}</h1>
            <p className="mt-0.5 max-w-3xl text-sm text-subtle">{copy.description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface px-4 py-2 text-sm font-semibold text-body transition hover:bg-surface-alt active:translate-y-px disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {copy.refresh}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border-default bg-surface px-4 py-3">
        <span
          className={`inline-flex items-center gap-2 text-sm font-semibold ${status?.connected ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}
        >
          {status?.connected ? (
            <ShieldCheck className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {status?.connected ? copy.connected : copy.disconnected}
        </span>
        <span className="text-sm text-subtle">
          {copy.loaded}: <strong className="text-heading">{stats.total}</strong>
        </span>
        <span className="text-sm text-subtle">
          {copy.sent}: <strong className="text-emerald-600">{stats.sent}</strong>
        </span>
        <span className="text-sm text-subtle">
          {copy.failed}: <strong className="text-red-600">{stats.failed}</strong>
        </span>
        <span className="text-sm text-subtle">
          {copy.resends}: <strong className="text-blue-600">{stats.resends}</strong>
        </span>
      </div>

      <ZaloBotManagementPanel />

      <ZaloManualSendPanel
        language={language}
        disabled={!status?.connected}
        onSent={() => {
          setCursor(null);
          void loadHistory(false);
        }}
      />

      <div className="rounded-xl border border-border-default bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[180px_160px_1fr_150px_150px_auto]">
          <label className="space-y-1.5 text-xs font-semibold text-subtle">
            <span>{copy.category}</span>
            <select
              value={filters.type || ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, type: event.target.value }))
              }
              className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm font-normal text-heading outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{copy.allTypes}</option>
              {TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type, language)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-subtle">
            <span>{copy.result}</span>
            <select
              value={filters.status || ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
              className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm font-normal text-heading outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{copy.allStatuses}</option>
              <option value="sent">{copy.sent}</option>
              <option value="failed">{copy.failed}</option>
              <option value="sending">{copy.sending}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-subtle">
            <span>{copy.search}</span>
            <span className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <input
                value={filters.search || ''}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyFilters();
                }}
                className="w-full rounded-lg border border-border-default bg-surface py-2 pl-9 pr-3 text-sm font-normal text-heading outline-none focus:ring-2 focus:ring-blue-500"
              />
            </span>
          </label>
          <ApiDateTextInput
            label={copy.from}
            value={filters.startDate || ''}
            onChange={(value) => setFilters((current) => ({ ...current, startDate: value }))}
            inputClassName="rounded-lg border-border-default bg-surface py-2 text-sm"
          />
          <ApiDateTextInput
            label={copy.to}
            value={filters.endDate || ''}
            onChange={(value) => setFilters((current) => ({ ...current, endDate: value }))}
            inputClassName="rounded-lg border-border-default bg-surface py-2 text-sm"
          />
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 active:translate-y-px"
            >
              <Filter className="h-4 w-4" /> {copy.apply}
            </button>
            <button
              type="button"
              onClick={clearFilters}
              title={copy.clear}
              aria-label={copy.clear}
              className="rounded-lg border border-border-default bg-surface p-2 text-subtle transition hover:bg-surface-alt hover:text-heading"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>{copy.loadingError}</strong>
            <p className="mt-1 break-words">{error}</p>
          </div>
        </div>
      )}

      {scanLimitReached && hasMore && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-400">
          {copy.scanNotice}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border-default bg-surface">
        {loading ? (
          <div className="space-y-3 p-5" aria-label="Loading Zalo history">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg bg-surface-alt" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="px-4 py-16 text-center text-subtle">
            <MessageCircle className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>{copy.noLogs}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-surface-alt text-xs font-semibold text-subtle">
                <tr>
                  <th className="px-4 py-3">{copy.time}</th>
                  <th className="px-4 py-3">{copy.recipient}</th>
                  <th className="px-4 py-3">{copy.category}</th>
                  <th className="px-4 py-3">{copy.result}</th>
                  <th className="px-4 py-3">{copy.details}</th>
                  <th className="px-4 py-3 text-right">{copy.action}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const expanded = expandedId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr className="border-t border-border-light align-top hover:bg-surface-alt/60">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-body">
                          {formatTimestamp(log.createdAt, language)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-heading">{recipientLabel(log)}</p>
                          <p className="mt-0.5 text-xs text-subtle">
                            {log.studentCode || log.studentId || log.email}
                          </p>
                          <p className="mt-0.5 text-xs text-subtle">{log.phone}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-heading">
                            {typeLabel(log.type, language)}
                          </span>
                          {log.isResend && (
                            <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
                              RESEND
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={log.status} language={language} />
                        </td>
                        <td className="max-w-[320px] px-4 py-3">
                          {log.status === 'failed' && log.errorMessage ? (
                            <p
                              className="line-clamp-2 text-xs font-medium text-red-700 dark:text-red-400"
                              title={log.errorMessage}
                            >
                              {log.errorMessage}
                            </p>
                          ) : (
                            <p className="truncate text-xs text-subtle">
                              {log.zaloMessageId || log.className || log.date}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setExpandedId(expanded ? null : log.id)}
                              aria-label={copy.details}
                              className="rounded-lg border border-border-default p-2 text-subtle transition hover:bg-surface-alt hover:text-heading"
                            >
                              {expanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResendTarget(log);
                                setResendReason('');
                              }}
                              disabled={!log.canResend}
                              title={log.canResend ? copy.resend : log.reason || copy.unavailable}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 active:translate-y-px disabled:cursor-not-allowed disabled:border-border-default disabled:bg-surface-alt disabled:text-subtle dark:border-blue-900/60 dark:bg-blue-500/10 dark:text-blue-400"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> {copy.resend}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr
                          key={`${log.id}-details`}
                          className="border-t border-border-light bg-surface-alt/50"
                        >
                          <td colSpan={6} className="px-4 py-4">
                            <ZaloHistoryDetails log={log} language={language} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hasMore && !loading && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => void loadHistory(true)}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-border-default bg-surface px-5 py-2.5 text-sm font-semibold text-body transition hover:bg-surface-alt disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loadingMore ? 'animate-spin' : ''}`} /> {copy.loadMore}
          </button>
        </div>
      )}

      <ZaloActionDialog
        isOpen={Boolean(resendTarget)}
        title={copy.confirmTitle}
        description={
          resendTarget
            ? `${typeLabel(resendTarget.type, language)}: ${recipientLabel(resendTarget)}`
            : undefined
        }
        closeLabel={copy.cancel}
        cancelLabel={copy.cancel}
        confirmLabel={copy.confirm}
        isPending={resending}
        isConfirmDisabled={resendReason.trim().length < 3}
        onClose={closeResendDialog}
        onConfirm={() => void confirmResend()}
      >
        {resendTarget && (
          <div className="space-y-4">
            <dl className="grid gap-4 rounded-xl bg-surface-alt p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-subtle">{copy.recipient}</dt>
                <dd className="mt-1 break-words font-semibold text-heading">
                  {recipientLabel(resendTarget)}
                </dd>
              </div>
              <div>
                <dt className="text-subtle">{copy.category}</dt>
                <dd className="mt-1 break-words font-medium text-heading">
                  {typeLabel(resendTarget.type, language)}
                </dd>
              </div>
              {resendTarget.phone && (
                <div>
                  <dt className="text-subtle">{copy.phone}</dt>
                  <dd className="mt-1 break-words font-medium text-heading">
                    {resendTarget.phone}
                  </dd>
                </div>
              )}
              {(resendTarget.templateName || resendTarget.templateId) && (
                <div>
                  <dt className="text-subtle">Template</dt>
                  <dd className="mt-1 break-words font-medium text-heading">
                    {resendTarget.templateName || resendTarget.templateId}
                  </dd>
                </div>
              )}
            </dl>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
              {copy.confirmBody}
            </div>

            <label className="block text-sm font-semibold text-heading">
              {copy.reasonLabel}
              <textarea
                value={resendReason}
                onChange={(event) => setResendReason(event.target.value)}
                placeholder={copy.reasonPlaceholder}
                disabled={resending}
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border border-border-default bg-page px-3 py-2 text-sm font-normal text-heading outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              />
            </label>
          </div>
        )}
      </ZaloActionDialog>
    </div>
  );
}
