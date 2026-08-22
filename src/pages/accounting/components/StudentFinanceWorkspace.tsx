import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Send } from 'lucide-react';
import type {
  AccountingStudentSummary,
  StudentCourseFinanceSummary,
} from '../../../../shared/accountingStudentFinance';
import type { StudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment';
import {
  ACCOUNTING_STUDENT_FINANCE_ROW_CAP,
  fetchAllAccountingStudentFinance,
} from '../../../lib/api/accountingStudentFinanceApi';
import {
  fetchStudentAdminReport,
  type StudentLedgerReportRow,
} from '../../../lib/api/studentAdminReportApi';
import { generateCourseFeeLedgersForEnrollments } from '../../../lib/api/classAdminApi';
import { useInvalidationRefresh } from '../../../hooks/useInvalidationRefresh';
import { LoadMore, useClientPagination } from '../../../components/common/LoadMore';
import {
  parseAccountingStudentFinanceUrl,
  serializeAccountingStudentFinanceUrl,
  type AccountingStudentFinanceUrlState,
} from '../accountingStudentFinanceUrlState';
import { filterAccountingStudentRows } from '../accountingStudentSearch';
import { StudentProfileLink } from './StudentProfileLink';

import type { Class } from '../../../types';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import { formatClassNameWithTeacher, type TeacherLookup } from '../../../lib/classes/sortClasses';

type DetailState = {
  loading: boolean;
  error: string | null;
  courses: StudentCourseFinanceSummary[];
  /** Ledgers no course summary covers — see `uncoveredLedgers`. */
  looseLedgers: StudentLedgerReportRow[];
};

/**
 * Ledgers created before `student_course_enrollments` existed have no enrollment
 * row, so they never reach `courseSummaries` — yet their money is real and the
 * list totals include it. Surfacing them here keeps the detail from reading
 * "Chưa có enrollment" next to a balance the same page just charged.
 */
function uncoveredLedgers(
  courses: StudentCourseFinanceSummary[],
  ledgers: StudentLedgerReportRow[]
): StudentLedgerReportRow[] {
  const covered = new Set(
    courses.map((course) => course.finance.ledgerId).filter((id): id is string => Boolean(id))
  );
  return ledgers.filter((ledger) => !covered.has(ledger.id));
}

export type StudentFinanceWorkspaceProps = {
  active: boolean;
  classes?: Class[];
  teachers?: TeacherLookup;
  onGenerateLedgers?: () => void;
  onCollectPayment: (student: AccountingStudentSummary) => void;
  onOpenReceiptHistory: () => void;
  onSendTuitionReminder: (student: AccountingStudentSummary) => void;
  reminderLoadingStudentIds?: readonly string[];
};

const ROWS_PER_PAGE = 50;

const paymentLabels: Record<string, string> = {
  overdue: 'Quá hạn',
  partial: 'Đóng một phần',
  unpaid: 'Chưa đóng',
  missing_ledger: 'Chưa tạo học phí',
  paid: 'Đã đóng',
  waived: 'Miễn giảm',
};

const enrollmentLabels: Record<string, string> = {
  trial: 'Học thử',
  active: 'Đang học',
  on_leave: 'Tạm nghỉ',
  completed: 'Hoàn thành',
  transferred: 'Đã chuyển lớp',
  dropped: 'Đã nghỉ',
};

function money(value: number): string {
  return `${Number(value || 0).toLocaleString('vi-VN')} ₫`;
}

function attendanceText(course: StudentCourseFinanceSummary): string {
  const sessions = course.sessions;
  const complete = sessions.completeKnown !== false && sessions.complete !== false;
  if (!complete) return 'Chưa đủ dữ liệu';
  const attended = sessions.attendedSessions ?? sessions.attended;
  const occurred = sessions.occurredSessions ?? sessions.elapsed;
  return `${attended}/${occurred} buổi đã diễn ra`;
}

export function StudentFinanceWorkspace({
  active,
  classes = [],
  teachers = [],
  onGenerateLedgers,
  onCollectPayment,
  onOpenReceiptHistory,
  onSendTuitionReminder,
  reminderLoadingStudentIds = [],
}: StudentFinanceWorkspaceProps) {
  const { t } = useLanguage();
  const initial = useMemo<AccountingStudentFinanceUrlState>(() => {
    if (typeof window === 'undefined')
      return {
        search: '',
        paymentStatus: 'all',
        lifecycleScope: 'current',
        enrollmentStatus: 'all',
        classId: '',
        expandedStudentId: '',
      };
    return parseAccountingStudentFinanceUrl(window.location.search);
  }, []);
  const [rows, setRows] = useState<AccountingStudentSummary[]>([]);
  const [search, setSearch] = useState(initial.search);
  const [paymentStatus, setPaymentStatus] = useState(initial.paymentStatus);
  const [lifecycleScope, setLifecycleScope] = useState(initial.lifecycleScope);
  const [enrollmentStatus, setEnrollmentStatus] = useState(initial.enrollmentStatus);
  const [classId, setClassId] = useState(initial.classId);
  const [truncated, setTruncated] = useState(false);
  const [dataIncomplete, setDataIncomplete] = useState(false);
  const [expandedStudentId, setExpandedStudentId] = useState(initial.expandedStudentId);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [loading, setLoading] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState<string | null>(null);
  const classLabelById = useMemo(
    () =>
      new Map(
        classes.map((classItem) => [classItem.id, formatClassNameWithTeacher(classItem, teachers)])
      ),
    [classes, teachers]
  );

  const updateUrl = useCallback(
    (patch: Partial<AccountingStudentFinanceUrlState>) => {
      if (typeof window === 'undefined') return;
      const query = serializeAccountingStudentFinanceUrl(
        {
          search,
          paymentStatus,
          lifecycleScope,
          enrollmentStatus,
          classId,
          expandedStudentId,
          ...patch,
        },
        window.location.search
      );
      window.history.replaceState({}, '', `${window.location.pathname}${query}`);
    },
    [classId, enrollmentStatus, expandedStudentId, lifecycleScope, paymentStatus, search]
  );

  /**
   * The whole list for the current dropdown filters is loaded up front so typing in
   * the search box filters it in memory, with no round trip per keystroke.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAllAccountingStudentFinance({
        paymentStatus: paymentStatus === 'all' ? undefined : paymentStatus,
        lifecycleScope,
        enrollmentStatus:
          enrollmentStatus === 'all'
            ? undefined
            : (enrollmentStatus as StudentCourseEnrollmentStatus),
        classId: classId.trim() || undefined,
      });
      setRows(list.rows);
      setTruncated(list.truncated);
      setDataIncomplete(list.dataIncomplete);
    } catch (error) {
      console.error('Failed to load accounting student finance workspace', error);
      setRows([]);
      setTruncated(false);
      setDataIncomplete(true);
    } finally {
      setLoading(false);
    }
  }, [classId, enrollmentStatus, lifecycleScope, paymentStatus]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);
  useInvalidationRefresh({
    channelKey: 'accounting-student-finance',
    enabled: active,
    onInvalidate: () => load(),
  });

  const visibleRows = useMemo(() => filterAccountingStudentRows(rows, search), [rows, search]);
  const page = useClientPagination(
    visibleRows,
    ROWS_PER_PAGE,
    `${search.trim().toLowerCase()}|${rows.length}`
  );

  const updateFilter = (patch: Partial<AccountingStudentFinanceUrlState>) => {
    updateUrl(patch);
    if (patch.search !== undefined) setSearch(patch.search);
    if (patch.paymentStatus !== undefined) setPaymentStatus(patch.paymentStatus);
    if (patch.lifecycleScope !== undefined) setLifecycleScope(patch.lifecycleScope);
    if (patch.enrollmentStatus !== undefined) setEnrollmentStatus(patch.enrollmentStatus);
    if (patch.classId !== undefined) setClassId(patch.classId);
  };

  const loadDetail = useCallback(async (studentId: string) => {
    setDetails((current) => ({
      ...current,
      [studentId]: {
        loading: true,
        error: null,
        courses: current[studentId]?.courses || [],
        looseLedgers: current[studentId]?.looseLedgers || [],
      },
    }));
    try {
      const report = await fetchStudentAdminReport({ studentId });
      const courses = report.courseSummaries || [];
      setDetails((current) => ({
        ...current,
        [studentId]: {
          loading: false,
          error: null,
          courses,
          looseLedgers: uncoveredLedgers(courses, report.ledgers || []),
        },
      }));
    } catch (error) {
      console.error('Failed to load course finance detail', error);
      setDetails((current) => ({
        ...current,
        [studentId]: {
          loading: false,
          error: 'Không tải được chi tiết khóa học.',
          courses: [],
          looseLedgers: [],
        },
      }));
    }
  }, []);

  /**
   * A deep link (for example from the admin class reconciliation modal) arrives with
   * `studentExpandedId` already set, so nothing ever clicks the row. Load its detail
   * once; `details[id]` is populated synchronously by `loadDetail`, which keeps this
   * idempotent.
   */
  useEffect(() => {
    if (!active || !expandedStudentId) return;
    if (details[expandedStudentId]) return;
    void loadDetail(expandedStudentId);
  }, [active, expandedStudentId, details, loadDetail]);

  /**
   * Filtering by class narrows the list but does not bound it: a class with history
   * can hold more than one page of students. Pin the expanded target while it is open
   * so a deep link to row 60 has a row to render into.
   */
  const renderedRows = useMemo(() => {
    if (!expandedStudentId) return page.shownItems;
    if (page.shownItems.some((item) => item.studentId === expandedStudentId))
      return page.shownItems;
    const target = visibleRows.find((item) => item.studentId === expandedStudentId);
    return target ? [target, ...page.shownItems] : page.shownItems;
  }, [expandedStudentId, page.shownItems, visibleRows]);

  const toggleExpanded = (studentId: string) => {
    const next = expandedStudentId === studentId ? '' : studentId;
    setExpandedStudentId(next);
    updateUrl({ expandedStudentId: next });
    if (next && !details[next]) void loadDetail(next);
  };

  const createLedger = async (course: StudentCourseFinanceSummary) => {
    setLedgerLoading(course.enrollment.id);
    try {
      await generateCourseFeeLedgersForEnrollments([course.enrollment.id]);
      setDetails((current) => {
        const copy = { ...current };
        if (expandedStudentId) delete copy[expandedStudentId];
        return copy;
      });
      if (expandedStudentId) await loadDetail(expandedStudentId);
      await load();
    } catch (error) {
      console.error('Failed to create course ledger', error);
    } finally {
      setLedgerLoading(null);
    }
  };

  /**
   * The workspace keeps its filters in the current URL, so opening a profile in
   * a new tab leaves the list untouched behind it.
   */
  const courseProfileParams = (course: StudentCourseFinanceSummary) => ({
    classId: course.enrollment?.id ? course.termKey.split('::')[0] : '',
    termKey: course.termKey,
  });

  if (!active) return null;
  return (
    <section className="space-y-4" aria-label="Accounting student finance workspace">
      {dataIncomplete && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Danh sách đang đồng bộ; một số tổng hợp có thể chưa đầy đủ.
        </div>
      )}
      {truncated && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Danh sách vượt quá {ACCOUNTING_STUDENT_FINANCE_ROW_CAP.toLocaleString('vi-VN')} học sinh
          nên đã bị cắt bớt; hãy lọc theo lớp để tìm chính xác.
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => updateFilter({ search: event.target.value })}
            placeholder="Tìm học sinh theo tên hoặc mã"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3"
          />
        </div>
        <input
          value={classId}
          onChange={(event) => updateFilter({ classId: event.target.value })}
          placeholder="Lọc theo mã lớp"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
        />
        <select
          value={lifecycleScope}
          onChange={(event) =>
            updateFilter({ lifecycleScope: event.target.value as 'current' | 'all' })
          }
          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
        >
          <option value="current">Đang học hiện tại</option>
          <option value="all">Tất cả lịch sử</option>
        </select>
        <select
          value={enrollmentStatus}
          onChange={(event) =>
            updateFilter({
              enrollmentStatus: event.target
                .value as AccountingStudentFinanceUrlState['enrollmentStatus'],
            })
          }
          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
        >
          <option value="all">Tất cả trạng thái học</option>
          <option value="trial">Học thử</option>
          <option value="active">Đang học</option>
          <option value="on_leave">Tạm nghỉ</option>
          <option value="completed">Hoàn thành</option>
          <option value="transferred">Đã chuyển lớp</option>
          <option value="dropped">Đã nghỉ</option>
        </select>
        <select
          value={paymentStatus}
          onChange={(event) =>
            updateFilter({
              paymentStatus: event.target
                .value as AccountingStudentFinanceUrlState['paymentStatus'],
            })
          }
          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
        >
          <option value="all">Tất cả thanh toán</option>
          {Object.entries(paymentLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <RefreshCw className="h-4 w-4" /> Làm mới
        </button>
      </div>
      <div className="flex justify-end gap-2">
        {onGenerateLedgers && (
          <button
            type="button"
            onClick={onGenerateLedgers}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
          >
            {t.financePage.generateLedgersButton}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenReceiptHistory}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-indigo-600"
        >
          Lịch sử thu
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-10 px-3 py-3" />
              <th className="px-4 py-3">Học sinh</th>
              <th className="px-4 py-3">Lớp hiện tại</th>
              <th className="px-4 py-3">Enrollment</th>
              <th className="px-4 py-3">Thanh toán hiện tại</th>
              <th className="px-4 py-3 text-right">Tổng đã đóng</th>
              <th className="px-4 py-3 text-right">Tổng còn thiếu</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {renderedRows.map((row) => {
              const detail = details[row.studentId];
              return (
                <React.Fragment key={row.studentId}>
                  <tr className="hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        aria-label={expandedStudentId === row.studentId ? 'Thu gọn' : 'Mở rộng'}
                        onClick={() => toggleExpanded(row.studentId)}
                      >
                        {expandedStudentId === row.studentId ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <StudentProfileLink
                        studentId={row.studentId}
                        name={row.studentName}
                        className="font-semibold"
                      />
                      <div className="text-xs text-slate-500">
                        {row.studentCode || row.studentId}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {row.currentClassId ? (
                        <>
                          <div>{classLabelById.get(row.currentClassId) || 'Không xác định'}</div>
                          <div className="text-xs text-slate-500">{row.currentClassId}</div>
                        </>
                      ) : (
                        'Không xác định'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.currentEnrollmentStatus
                        ? enrollmentLabels[row.currentEnrollmentStatus] ||
                          row.currentEnrollmentStatus
                        : '—'}
                      <div className="text-xs text-slate-500">
                        {row.courseCount} khóa · {row.classCount} lớp
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                        {paymentLabels[row.currentCoursePaymentStatus] ||
                          row.currentCoursePaymentStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{money(row.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-rose-600">
                      {money(row.totalOutstanding)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Thu tiền cho ${row.studentName}`}
                          onClick={() => onCollectPayment(row)}
                          className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white"
                        >
                          Thu tiền
                        </button>
                        <button
                          type="button"
                          aria-label={
                            reminderLoadingStudentIds.includes(row.studentId)
                              ? `Đang nhắc học phí cho ${row.studentName}`
                              : `Nhắc học phí cho ${row.studentName}`
                          }
                          disabled={
                            row.totalOutstanding <= 0 ||
                            reminderLoadingStudentIds.includes(row.studentId)
                          }
                          onClick={() => onSendTuitionReminder(row)}
                          className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {reminderLoadingStudentIds.includes(row.studentId) ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Send className="h-3 w-3" aria-hidden="true" />
                          )}
                          Nhắc học phí
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedStudentId === row.studentId && (
                    <tr>
                      <td colSpan={8} className="bg-slate-50 px-6 py-4">
                        {detail?.loading && (
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải khóa học…
                          </div>
                        )}
                        {detail?.error && (
                          <div className="text-sm text-rose-600">
                            {detail.error}{' '}
                            <button
                              type="button"
                              className="underline"
                              onClick={() => void loadDetail(row.studentId)}
                            >
                              Thử lại
                            </button>
                          </div>
                        )}
                        {detail && !detail.loading && !detail.error && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-slate-500">
                                  <th className="px-2 py-2">Lớp / khóa</th>
                                  <th className="px-2 py-2">Trạng thái</th>
                                  <th className="px-2 py-2">Buổi học</th>
                                  <th className="px-2 py-2">Học phí</th>
                                  <th className="px-2 py-2">Đã đóng</th>
                                  <th className="px-2 py-2">Còn thiếu</th>
                                  <th className="px-2 py-2">Thanh toán</th>
                                  <th className="px-2 py-2" />
                                </tr>
                              </thead>
                              <tbody>
                                {detail.courses.map((course) => (
                                  <tr
                                    key={course.enrollment.id}
                                    className="border-t border-slate-200"
                                  >
                                    <td className="px-2 py-2">
                                      <StudentProfileLink
                                        studentId={row.studentId}
                                        name={`${course.className} · Khóa ${course.termIndex}`}
                                        params={courseProfileParams(course)}
                                      />
                                      <div className="text-slate-500">
                                        {course.enrollment.joinedAt} →{' '}
                                        {course.enrollment.endedAt || 'đang học'}
                                      </div>
                                    </td>
                                    <td className="px-2 py-2">
                                      {enrollmentLabels[course.enrollment.status] ||
                                        course.enrollment.status}
                                      {course.enrollment.confidence === 'inferred' && (
                                        <span className="ml-1 text-amber-700">(suy luận)</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-2">
                                      {attendanceText(course)}
                                      <div className="text-slate-500">
                                        Vắng phép {course.sessions.absentExcused} · Không phép{' '}
                                        {course.sessions.absentUnexcused} · Tạm nghỉ{' '}
                                        {course.sessions.onLeave}
                                      </div>
                                    </td>
                                    <td className="px-2 py-2">
                                      <div>Tổng {money(course.finance.grossAmount)}</div>
                                      <div className="text-slate-500">
                                        Giảm {money(course.finance.discount)} · Net{' '}
                                        {money(course.finance.netAmount)}
                                      </div>
                                      <div className="text-slate-500">
                                        Hạn {course.finance.dueDate || '—'}
                                      </div>
                                    </td>
                                    <td className="px-2 py-2">{money(course.finance.paid)}</td>
                                    <td className="px-2 py-2">
                                      {money(course.finance.outstanding)}
                                    </td>
                                    <td className="px-2 py-2">
                                      {paymentLabels[course.finance.status] ||
                                        course.finance.status}
                                      {course.finance.tuitionReminderCount ? (
                                        <div className="text-slate-500">
                                          Đã nhắc {course.finance.tuitionReminderCount} lần
                                          {course.finance.lastTuitionReminderAt
                                            ? ` · ${course.finance.lastTuitionReminderAt}`
                                            : ''}
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="px-2 py-2">
                                      {course.finance.ledgerId === null && (
                                        <button
                                          type="button"
                                          disabled={ledgerLoading === course.enrollment.id}
                                          onClick={() => void createLedger(course)}
                                          className="text-indigo-600 underline disabled:opacity-50"
                                        >
                                          {ledgerLoading === course.enrollment.id
                                            ? 'Đang tạo…'
                                            : 'Tạo học phí'}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {detail.looseLedgers.map((ledger) => (
                                  <tr
                                    key={ledger.id}
                                    className="border-t border-amber-200 bg-amber-50/60"
                                  >
                                    <td className="px-2 py-2">
                                      {ledger.className ||
                                        classLabelById.get(String(ledger.classId || '')) ||
                                        ledger.classId ||
                                        '—'}
                                      <div className="text-slate-500">
                                        {ledger.termStart || '—'} → {ledger.termEnd || '—'}
                                      </div>
                                    </td>
                                    <td className="px-2 py-2 text-amber-800">
                                      Không có enrollment
                                    </td>
                                    <td className="px-2 py-2 text-slate-500">Chưa đủ dữ liệu</td>
                                    <td className="px-2 py-2">
                                      <div>Tổng {money(ledger.grossAmount)}</div>
                                      <div className="text-slate-500">
                                        Giảm {money(ledger.discount)} · Net{' '}
                                        {money(ledger.netAmount)}
                                      </div>
                                      <div className="text-slate-500">
                                        Hạn {ledger.dueDate || '—'}
                                      </div>
                                    </td>
                                    <td className="px-2 py-2">{money(ledger.paid)}</td>
                                    <td className="px-2 py-2">{money(ledger.outstanding)}</td>
                                    <td className="px-2 py-2">
                                      {paymentLabels[ledger.displayStatus] || ledger.displayStatus}
                                    </td>
                                    <td className="px-2 py-2" />
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {detail.looseLedgers.length > 0 && (
                              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                                Các dòng nền vàng là học phí có thật nhưng thiếu bản ghi enrollment,
                                nên không hiện được buổi học. Số tiền vẫn tính vào công nợ và thu
                                được bình thường.
                              </p>
                            )}
                            {detail.courses.length === 0 && detail.looseLedgers.length === 0 && (
                              <div className="py-4 text-center text-slate-500">
                                Chưa có enrollment.
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {loading && <div className="p-4 text-sm text-slate-500">Đang tải…</div>}
        {!loading && visibleRows.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">Không có học sinh phù hợp.</div>
        )}
      </div>
      <LoadMore
        hasMore={page.hasMore}
        loading={loading}
        onLoadMore={page.loadMore}
        totalShown={page.totalShown}
        totalAvailable={page.totalAvailable}
      />
    </section>
  );
}
