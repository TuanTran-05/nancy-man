import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { addDays, endOfWeek, format, startOfWeek } from 'date-fns';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Info,
  Loader2,
  MoreVertical,
  RotateCcw,
  Search,
  ShieldCheck,
  Smile,
  Timer,
  User,
  UsersRound,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  markTeacherAttendance,
  type TeacherAttendanceSessionRow,
  type TeacherAttendanceWeekResponse,
} from '../../lib/api/teacherAttendanceApi';
import {
  applyTeacherAttendanceMark,
  teacherAttendanceWeekQueryOptions,
} from '../../lib/office/teacherAttendanceQueries';
import { readTeacherPayrollMonth } from '../../lib/api/teacherPayrollApi';
import { exportTeacherAttendanceReportWorkbook } from '../../lib/exports/teacherAttendanceReportExport';
import { cn } from '../../lib/core/utils';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../../components/common/ModalPortal';

const EMPTY_ATTENDANCE_SESSIONS: TeacherAttendanceSessionRow[] = [];
const EMPTY_ATTENDANCE_TEACHERS: TeacherAttendanceWeekResponse['teachers'] = [];
const EMPTY_ATTENDANCE_CLASSES: TeacherAttendanceWeekResponse['classes'] = [];

type StatusFilter = 'all' | 'pending' | 'present' | 'absent' | 'cancelled';

type MetricCardId = 'total' | 'pending' | 'present' | 'absent' | 'cancelled';

function weekRange(date: Date) {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
}

function monthValue(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

type TeacherAttendancePageText = ReturnType<typeof useLanguage>['t']['teacherAttendancePage'];

function statusLabel(
  status: TeacherAttendanceSessionRow['teacherAttendanceStatus'],
  labels: TeacherAttendancePageText['status']
) {
  if (status === 'present') return labels.present;
  if (status === 'absent') return labels.absent;
  return labels.pending;
}

function rowMatchesStatus(row: TeacherAttendanceSessionRow, filter: StatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'cancelled') return row.sessionStatus === 'cancelled';
  return row.teacherAttendanceStatus === filter;
}

function displayDateRange(from: string, to: string) {
  const toDisplayDate = (value: string) => {
    const [year, month, day] = value.split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  };

  return `${toDisplayDate(from)} - ${toDisplayDate(to)}`;
}

function formatDateHeading(date: string, language: 'vi' | 'en') {
  const dateValue = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dateValue.getTime())) return date;

  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(dateValue);
}

function statusBadgeClass(row: TeacherAttendanceSessionRow) {
  if (row.sessionStatus === 'cancelled') return 'bg-slate-100 text-slate-500 ring-slate-200';
  if (row.teacherAttendanceStatus === 'present') {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  }
  if (row.teacherAttendanceStatus === 'absent') return 'bg-red-50 text-red-700 ring-red-100';
  return 'bg-amber-50 text-amber-700 ring-amber-100';
}

function hasFinalTeacherAttendance(row: TeacherAttendanceSessionRow) {
  return row.teacherAttendanceStatus === 'present' || row.teacherAttendanceStatus === 'absent';
}

function sessionDatePriority(date: string, currentDate: string) {
  if (!currentDate) return 0;
  if (date === currentDate) return 0;
  return date > currentDate ? 1 : 2;
}

function sortSessionsFromCurrentDate(rows: TeacherAttendanceSessionRow[], currentDate: string) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const priorityDiff =
        sessionDatePriority(a.row.date, currentDate) - sessionDatePriority(b.row.date, currentDate);
      if (priorityDiff !== 0) return priorityDiff;

      const dateDiff = a.row.date.localeCompare(b.row.date);
      if (dateDiff !== 0) return dateDiff;

      const timeDiff = (a.row.startTime || a.row.schedule || '').localeCompare(
        b.row.startTime || b.row.schedule || ''
      );
      if (timeDiff !== 0) return timeDiff;

      return a.index - b.index;
    })
    .map(({ row }) => row);
}

function getVisiblePageNumbers(totalPages: number, currentPage: number) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const start = Math.min(Math.max(currentPage - 2, 1), totalPages - 4);
  return Array.from({ length: 5 }, (_, index) => start + index);
}

export default function TeacherAttendance() {
  const { t, language } = useLanguage();
  const pageText = t.teacherAttendancePage;
  const toastTextRef = useRef(pageText.toast);
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    toastTextRef.current = pageText.toast;
  }, [pageText.toast]);

  const [anchorDate, setAnchorDate] = useState(new Date());
  const [teacherFilter, setTeacherFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportMonth, setExportMonth] = useState(() => monthValue(new Date()));
  const [selectedExportTeacherIds, setSelectedExportTeacherIds] = useState<string[]>([]);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    rowId: string;
    status: 'present' | 'absent';
  } | null>(null);

  const range = useMemo(() => weekRange(anchorDate), [anchorDate]);

  const queryClient = useQueryClient();
  const weekQueryOptions = teacherAttendanceWeekQueryOptions(
    { uid: profile?.uid || '', role: profile?.role || '' },
    range.from,
    range.to,
    Boolean(profile?.uid)
  );
  const weekQuery = useQuery(weekQueryOptions);

  const sessions = weekQuery.data?.sessions ?? EMPTY_ATTENDANCE_SESSIONS;
  const teachers = weekQuery.data?.teachers ?? EMPTY_ATTENDANCE_TEACHERS;
  const classes = weekQuery.data?.classes ?? EMPTY_ATTENDANCE_CLASSES;
  const serverTime =
    typeof weekQuery.data?.serverTime === 'number' ? weekQuery.data.serverTime : Date.now();
  const loading = weekQuery.isPending;

  useEffect(() => {
    if (weekQuery.isError) toast.error(toastTextRef.current.loadError);
  }, [weekQuery.isError]);

  const allExportTeacherIds = useMemo(() => teachers.map((teacher) => teacher.uid), [teachers]);

  useEffect(() => {
    setSelectedExportTeacherIds((current) => {
      const validIds = new Set(allExportTeacherIds);
      const next = current.filter((id) => validIds.has(id));
      return next.length > 0 ? next : allExportTeacherIds;
    });
  }, [allExportTeacherIds]);

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((row) => {
      if (teacherFilter !== 'all' && row.teacherId !== teacherFilter) return false;
      if (classFilter !== 'all' && row.classId !== classFilter) return false;
      if (!rowMatchesStatus(row, statusFilter)) return false;
      if (!q) return true;
      return `${row.className} ${row.teacherName} ${row.room || ''}`.toLowerCase().includes(q);
    });
  }, [sessions, teacherFilter, classFilter, statusFilter, search]);

  const currentDate = useMemo(() => format(new Date(serverTime), 'yyyy-MM-dd'), [serverTime]);
  const orderedSessions = useMemo(
    () => sortSessionsFromCurrentDate(filteredSessions, currentDate),
    [filteredSessions, currentDate]
  );

  const counts = useMemo(
    () => ({
      total: sessions.length,
      pending: sessions.filter((row) => row.teacherAttendanceStatus === 'pending' && row.canMark)
        .length,
      present: sessions.filter((row) => row.teacherAttendanceStatus === 'present').length,
      absent: sessions.filter((row) => row.teacherAttendanceStatus === 'absent').length,
      cancelled: sessions.filter((row) => row.sessionStatus === 'cancelled').length,
    }),
    [sessions]
  );

  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / pageSize));
  const pageStartIndex = (currentPage - 1) * pageSize;
  const paginatedSessions = orderedSessions.slice(pageStartIndex, pageStartIndex + pageSize);
  const pageStart = filteredSessions.length === 0 ? 0 : pageStartIndex + 1;
  const pageEnd = Math.min(pageStartIndex + pageSize, filteredSessions.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [teacherFilter, classFilter, statusFilter, search, pageSize]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const markMutation = useMutation({
    mutationFn: (variables: { row: TeacherAttendanceSessionRow; status: 'present' | 'absent' }) =>
      markTeacherAttendance({
        classId: variables.row.classId,
        date: variables.row.date,
        status: variables.status,
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: weekQueryOptions.queryKey });
      const previous = queryClient.getQueryData<TeacherAttendanceWeekResponse>(
        weekQueryOptions.queryKey
      );
      queryClient.setQueryData(
        weekQueryOptions.queryKey,
        applyTeacherAttendanceMark(previous, variables.row.id, variables.status)
      );
      return { previous };
    },
    onError: (err, _variables, context) => {
      // Put the row back exactly as it was before the click.
      if (context?.previous) {
        queryClient.setQueryData(weekQueryOptions.queryKey, context.previous);
      }
      console.error('Failed to mark teacher attendance:', err);
      toast.error(toastTextRef.current.updateError);
    },
    onSuccess: (_result, variables) => {
      toast.success(
        variables.status === 'present'
          ? toastTextRef.current.markedPresent
          : toastTextRef.current.markedAbsent
      );
    },
    onSettled: () => {
      // Background verification: the optimistic row is what the user sees, this
      // confirms it against the server without a spinner.
      void queryClient.invalidateQueries({ queryKey: weekQueryOptions.queryKey });
    },
  });

  const mark = (row: TeacherAttendanceSessionRow, status: 'present' | 'absent') => {
    if (!row.canMark || pendingAction || hasFinalTeacherAttendance(row)) return;
    setPendingAction({ rowId: row.id, status });
    markMutation.mutate({ row, status }, { onSettled: () => setPendingAction(null) });
  };

  const resetFilters = () => {
    setSearch('');
    setTeacherFilter('all');
    setClassFilter('all');
    setStatusFilter('all');
  };

  const openExportModal = () => {
    setExportMonth(monthValue(anchorDate));
    setSelectedExportTeacherIds((current) => (current.length > 0 ? current : allExportTeacherIds));
    setIsExportModalOpen(true);
  };

  const closeExportModal = () => {
    if (!isExportingReport) setIsExportModalOpen(false);
  };

  const toggleAllExportTeachers = () => {
    setSelectedExportTeacherIds((current) =>
      current.length === allExportTeacherIds.length ? [] : allExportTeacherIds
    );
  };

  const toggleExportTeacher = (teacherId: string) => {
    setSelectedExportTeacherIds((current) =>
      current.includes(teacherId)
        ? current.filter((id) => id !== teacherId)
        : [...current, teacherId]
    );
  };

  const handleExportReport = async () => {
    if (isExportingReport || selectedExportTeacherIds.length === 0) return;
    setIsExportingReport(true);
    try {
      const data = await readTeacherPayrollMonth(exportMonth);
      await exportTeacherAttendanceReportWorkbook({
        data,
        selectedTeacherIds: selectedExportTeacherIds,
        includeSalary: isAdmin,
      });
      toast.success(pageText.exportReport.toast.success);
      setIsExportModalOpen(false);
    } catch (err) {
      console.error('Failed to export teacher attendance report:', err);
      toast.error(pageText.exportReport.toast.error);
    } finally {
      setIsExportingReport(false);
    }
  };

  const sessionsByDate = paginatedSessions.reduce<Record<string, TeacherAttendanceSessionRow[]>>(
    (acc, row) => {
      acc[row.date] = acc[row.date] || [];
      acc[row.date].push(row);
      return acc;
    },
    {}
  );

  const sessionUnitLabel = language === 'vi' ? 'ca' : 'sessions';
  const resetLabel = language === 'vi' ? 'Đặt lại' : 'Reset';
  const pageSummary =
    language === 'vi'
      ? `Hiển thị ${pageStart} - ${pageEnd} trong tổng số ${filteredSessions.length} mục`
      : `Showing ${pageStart} - ${pageEnd} of ${filteredSessions.length} items`;
  const perPageLabel = language === 'vi' ? ' / trang' : ' / page';
  const emptyLabel =
    language === 'vi'
      ? 'Không có ca phù hợp với bộ lọc hiện tại.'
      : 'No sessions match the current filters.';
  const moreActionsLabel = language === 'vi' ? 'Tùy chọn khác' : 'More actions';

  const exportText = pageText.exportReport;
  const allExportTeachersSelected =
    allExportTeacherIds.length > 0 &&
    selectedExportTeacherIds.length === allExportTeacherIds.length;

  const metricCards: Array<{
    id: MetricCardId;
    label: string;
    value: number;
    Icon: LucideIcon;
    iconClassName: string;
  }> = [
    {
      id: 'total',
      label: pageText.metrics.total,
      value: counts.total,
      Icon: UsersRound,
      iconClassName: 'bg-blue-50 text-blue-600 ring-blue-100',
    },
    {
      id: 'pending',
      label: pageText.metrics.pending,
      value: counts.pending,
      Icon: ShieldCheck,
      iconClassName: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    },
    {
      id: 'present',
      label: pageText.metrics.present,
      value: counts.present,
      Icon: Smile,
      iconClassName: 'bg-green-50 text-green-600 ring-green-100',
    },
    {
      id: 'absent',
      label: pageText.metrics.absent,
      value: counts.absent,
      Icon: Timer,
      iconClassName: 'bg-amber-50 text-amber-600 ring-amber-100',
    },
    {
      id: 'cancelled',
      label: pageText.metrics.cancelled,
      value: counts.cancelled,
      Icon: XCircle,
      iconClassName: 'bg-red-50 text-red-600 ring-red-100',
    },
  ];

  const visiblePageNumbers = getVisiblePageNumbers(totalPages, currentPage);

  return (
    <div className="mx-auto w-full max-w-[1700px] space-y-6 pb-8 text-slate-900">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-[28px] font-extrabold leading-tight text-slate-950">
              {pageText.title}
            </h1>
            <p className="mt-1.5 text-[15px] font-medium text-slate-500">{pageText.subtitle}</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={openExportModal}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-[15px] font-black text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 active:scale-[0.98]"
          >
            <Download className="h-4 w-4" />
            {exportText.button}
          </button>
          <div className="grid w-full grid-cols-[48px_minmax(0,1fr)_48px] items-center gap-3 sm:w-auto sm:flex sm:gap-4">
            <button
              type="button"
              aria-label={pageText.week.previous}
              className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition hover:border-blue-200 hover:text-blue-600 active:scale-95"
              onClick={() => setAnchorDate(addDays(anchorDate, -7))}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex h-12 min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)] sm:min-w-[260px] sm:gap-3 sm:px-5 sm:text-[15px]">
              {displayDateRange(range.from, range.to)}
              <CalendarDays className="h-4 w-4 text-slate-800" />
            </div>
            <button
              type="button"
              aria-label={pageText.week.next}
              className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition hover:border-blue-200 hover:text-blue-600 active:scale-95"
              onClick={() => setAnchorDate(addDays(anchorDate, 7))}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metricCards.map(({ id, label, value, Icon, iconClassName }) => (
          <div
            key={id}
            className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_18px_42px_rgba(37,99,235,0.08)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div
                className={cn(
                  'flex h-14 w-14 shrink-0 items-center justify-center rounded-full ring-1',
                  iconClassName
                )}
              >
                <Icon className="h-6 w-6" />
              </div>
              <Info className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-4">
              <div className="text-sm font-semibold text-slate-500">{label}</div>
              <div className="mt-1 text-3xl font-black leading-none text-slate-950">{value}</div>
              <div className="mt-2 text-sm font-medium text-slate-500">{sessionUnitLabel}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_34px_rgba(15,23,42,0.04)]">
        <div className="grid gap-4 xl:grid-cols-[minmax(280px,1fr)_180px_180px_200px_130px]">
          <label className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
            <Search className="h-5 w-5 text-slate-400" />
            <span className="sr-only">{pageText.search.label}</span>
            <input
              role="searchbox"
              aria-label={pageText.search.label}
              className="h-full w-full bg-transparent text-[15px] font-medium text-slate-700 outline-none placeholder:text-slate-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={pageText.search.hint}
            />
          </label>
          <select
            className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
            value={teacherFilter}
            onChange={(e) => setTeacherFilter(e.target.value)}
          >
            <option value="all">{pageText.filters.allTeachers}</option>
            {teachers.map((teacher) => (
              <option key={teacher.uid} value={teacher.uid}>
                {teacher.displayName}
              </option>
            ))}
          </select>
          <select
            className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
          >
            <option value="all">{pageText.filters.allClasses}</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
          <select
            className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">{pageText.filters.allStatuses}</option>
            <option value="pending">{pageText.filters.pending}</option>
            <option value="present">{pageText.filters.present}</option>
            <option value="absent">{pageText.filters.absent}</option>
            <option value="cancelled">{pageText.filters.cancelled}</option>
          </select>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-[15px] font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 active:scale-[0.98]"
          >
            <RotateCcw className="h-4 w-4" />
            {resetLabel}
          </button>
        </div>
      </div>

      {loading ? (
        <div
          role="status"
          className="rounded-2xl border border-slate-200/80 bg-white p-10 text-center text-slate-500 shadow-[0_12px_34px_rgba(15,23,42,0.04)]"
        >
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-600" />
          <span className="sr-only">{pageText.loading}</span>
          <p className="mt-3 text-sm font-semibold">{pageText.loading}</p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-10 text-center text-slate-500 shadow-[0_12px_34px_rgba(15,23,42,0.04)]">
          <Search className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-3 text-sm font-semibold">{emptyLabel}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_34px_rgba(15,23,42,0.04)]">
          {Object.entries(sessionsByDate).map(([date, rows]) => (
            <section key={date}>
              <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4 text-lg font-extrabold text-slate-900">
                <CalendarDays className="h-5 w-5 text-blue-600" />
                {formatDateHeading(date, language)}
              </div>
              <div className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const isPending = pendingAction?.rowId === row.id;
                  const isMarkingPresent = isPending && pendingAction?.status === 'present';
                  const isMarkingAbsent = isPending && pendingAction?.status === 'absent';
                  const showAttendanceActions = isPending || !hasFinalTeacherAttendance(row);
                  return (
                    <div
                      key={row.id}
                      data-testid={`teacher-attendance-row-${row.id}`}
                      className="grid gap-4 px-6 py-5 transition hover:bg-slate-50/70 xl:grid-cols-[170px_minmax(0,1fr)_180px_270px_32px] xl:items-center"
                    >
                      <div className="flex items-center gap-2 text-[15px] font-bold text-slate-600">
                        <Clock className="h-5 w-5 text-blue-500" />
                        <span>{row.schedule || row.startTime || '--:--'}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[16px] font-extrabold text-slate-950">
                          {row.className}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-500">
                          <User className="h-4 w-4 text-slate-400" />
                          {row.teacherName}
                          {row.room ? ` - ${row.room}` : ''}
                        </div>
                      </div>
                      <div
                        className={cn(
                          'w-fit rounded-full px-3 py-1.5 text-xs font-extrabold ring-1',
                          statusBadgeClass(row)
                        )}
                      >
                        {row.sessionStatus === 'cancelled'
                          ? pageText.status.cancelled
                          : statusLabel(row.teacherAttendanceStatus, pageText.status)}
                      </div>
                      <div className="flex flex-wrap gap-3 xl:justify-end">
                        {showAttendanceActions ? (
                          <>
                            <button
                              disabled={!row.canMark || isPending}
                              aria-busy={isMarkingPresent}
                              onClick={() => void mark(row, 'present')}
                              className="inline-flex h-10 min-w-[116px] items-center justify-center gap-2 rounded-lg border border-emerald-500 bg-white px-4 text-sm font-extrabold text-emerald-700 shadow-sm transition hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {isMarkingPresent ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                              {isMarkingPresent
                                ? pageText.actions.markingPresent
                                : pageText.actions.present}
                            </button>
                            <button
                              disabled={!row.canMark || isPending}
                              aria-busy={isMarkingAbsent}
                              onClick={() => void mark(row, 'absent')}
                              className="inline-flex h-10 min-w-[116px] items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-extrabold text-white shadow-[0_8px_18px_rgba(220,38,38,0.22)] transition hover:bg-red-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {isMarkingAbsent ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                              {isMarkingAbsent
                                ? pageText.actions.markingAbsent
                                : pageText.actions.absent}
                            </button>
                          </>
                        ) : null}
                      </div>
                      <div
                        className="hidden justify-self-end text-slate-500 xl:flex"
                        aria-label={moreActionsLabel}
                      >
                        <MoreVertical className="h-5 w-5" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <div className="flex flex-col gap-4 border-t border-slate-100 px-6 py-4 text-sm font-medium text-slate-500 lg:flex-row lg:items-center lg:justify-between">
            <div>{pageSummary}</div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                aria-label={pageText.week.previous}
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {visiblePageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => setCurrentPage(pageNumber)}
                  className={cn(
                    'inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold transition',
                    currentPage === pageNumber
                      ? 'bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)]'
                      : 'border border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-blue-600'
                  )}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                type="button"
                aria-label={pageText.week.next}
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <select
                aria-label={perPageLabel.trim()}
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              >
                {[10, 20, 50].map((size) => (
                  <option key={size} value={size}>
                    {size}
                    {perPageLabel}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {isExportModalOpen && (
        <ModalPortal trapFocus lockScroll>
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="teacher-attendance-export-title"
              className="flex max-h-[min(720px,calc(100dvh-32px))] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
            >
              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
                <h2
                  id="teacher-attendance-export-title"
                  className="text-lg font-black text-slate-950"
                >
                  {exportText.title}
                </h2>
                <button
                  type="button"
                  aria-label={exportText.close}
                  disabled={isExportingReport}
                  onClick={closeExportModal}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
                <label className="block">
                  <span className="text-xs font-black uppercase text-slate-500">
                    {exportText.month}
                  </span>
                  <input
                    type="month"
                    aria-label={exportText.month}
                    value={exportMonth}
                    onChange={(event) => setExportMonth(event.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                  />
                </label>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-black uppercase text-slate-500">
                      {exportText.teachers}
                    </span>
                    <span className="text-xs font-bold text-slate-500">
                      {exportText.selectedCount.replace(
                        '{count}',
                        String(selectedExportTeacherIds.length)
                      )}
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-200">
                    <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-800">
                      <input
                        type="checkbox"
                        checked={allExportTeachersSelected}
                        onChange={toggleAllExportTeachers}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      {exportText.allTeachers}
                    </label>
                    <div className="max-h-56 overflow-y-auto">
                      {teachers.length ? (
                        teachers.map((teacher) => (
                          <label
                            key={teacher.uid}
                            className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={selectedExportTeacherIds.includes(teacher.uid)}
                              onChange={() => toggleExportTeacher(teacher.uid)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            {teacher.displayName}
                          </label>
                        ))
                      ) : (
                        <div className="px-4 py-6 text-center text-sm font-semibold text-slate-500">
                          {exportText.noTeachers}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={isExportingReport}
                  onClick={closeExportModal}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exportText.cancel}
                </button>
                <button
                  type="button"
                  disabled={
                    isExportingReport || selectedExportTeacherIds.length === 0 || !exportMonth
                  }
                  aria-busy={isExportingReport}
                  onClick={() => void handleExportReport()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExportingReport ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {isExportingReport ? exportText.exporting : exportText.exportExcel}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
