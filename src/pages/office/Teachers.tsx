import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mail,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { officeTeachersMonthQueryOptions } from '../../lib/office/officeTeachersQueries';
import { officeTeacherReferencesQueryOptions } from '../../lib/office/officeReferenceQueries';
import type { OfficeTeachersMonthResponse } from '../../lib/api/officeTeachersApi';
import { cn } from '../../lib/core/utils';
import { formatVndAmount } from '../../lib/core/moneyFormat';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { formatTemplate } from '../../lib/i18n/formatTemplate';
import { formatTeacherPhone } from '../../lib/office/teacherPhone';
import {
  buildOfficeTeacherMonthView,
  type TeacherMonthDay,
  type TeacherMonthRow,
  type TeacherMonthShift,
  type TeacherShiftStatus,
} from '../../lib/office/teacherSchedule';
import { formatWeeklyClassSchedule } from '../../../shared/classSchedule';
import { useAuth } from '../../contexts/AuthContext';
import { buildTeacherPayrollMonthView } from '../../lib/payroll/teacherPayrollMonth';
import type { TeacherPayrollMonthRow } from '../../lib/payroll/teacherPayrollMonth';
import { canViewTeacherSalary } from '../../../shared/teacherSalaryVisibility';

const statusClass: Record<TeacherShiftStatus, string> = {
  planned: 'border-slate-200 bg-slate-50 text-slate-600',
  present: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  absent: 'border-rose-200 bg-rose-50 text-rose-700',
  cancelled: 'border-amber-200 bg-amber-50 text-amber-700',
};

const classStatusClass: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paused: 'border-amber-200 bg-amber-50 text-amber-700',
  archived: 'border-slate-200 bg-slate-50 text-slate-600',
  ended: 'border-slate-200 bg-slate-50 text-slate-600',
};

const avatarPalette = [
  'bg-blue-50 text-blue-700',
  'bg-emerald-50 text-emerald-700',
  'bg-amber-50 text-amber-700',
  'bg-violet-50 text-violet-700',
  'bg-teal-50 text-teal-700',
  'bg-rose-50 text-rose-700',
];

type OfficeTeachersPageText = ReturnType<typeof useLanguage>['t']['officeTeachersPage'];

function formatClassStatus(status: string | undefined, labels: Record<string, string>) {
  if (!status) return '--';
  return labels[status] || status;
}

function monthString(date: Date) {
  return format(date, 'yyyy-MM');
}

function displayMonth(month: string) {
  const [year, value] = month.split('-');
  return value && year ? `${value}/${year}` : month;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function getMonthRange(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    return { from: `${month}-01`, to: `${month}-01` };
  }
  const finalDay = new Date(year, monthNumber, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(finalDay).padStart(2, '0')}` };
}

function formatVnd(value: number) {
  return `${formatVndAmount(value)}\u00A0\u0111`;
}

function hashString(value: string) {
  return [...value].reduce((hash, char) => hash + char.charCodeAt(0), 0);
}

function teacherInitials(name?: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) || '?').toUpperCase();
}

function teacherAvatarClass(id: string, name?: string) {
  return avatarPalette[hashString(id || name || 'teacher') % avatarPalette.length];
}

function TeacherAvatar({
  id,
  name,
  size = 'md',
}: {
  id: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-black',
        teacherAvatarClass(id, name),
        size === 'sm' && 'h-11 w-11 text-sm',
        size === 'md' && 'h-14 w-14 text-lg',
        size === 'lg' && 'h-[72px] w-[72px] text-2xl'
      )}
    >
      {teacherInitials(name)}
    </span>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  iconClassName,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  iconClassName: string;
}) {
  return (
    <div className="flex min-h-[108px] min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_28px_rgba(15,23,42,0.045)]">
      <span
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-8 ring-white',
          iconClassName
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="max-w-[11rem] text-[11px] font-black uppercase leading-snug tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-1.5 text-[1.7rem] font-black leading-none text-slate-950">{value}</p>
      </div>
    </div>
  );
}

function ClassStatusBadge({ status, labels }: { status?: string; labels: Record<string, string> }) {
  const label = formatClassStatus(status, labels);
  const tone = status
    ? classStatusClass[status] || classStatusClass.archived
    : classStatusClass.archived;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold',
        tone
      )}
    >
      {status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {label}
    </span>
  );
}

function MakeupBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-700">
      {label}
    </span>
  );
}

function ShiftChip({
  shift,
  statusLabel,
  makeupLabel,
}: {
  shift: TeacherMonthShift;
  statusLabel: Record<TeacherShiftStatus, string>;
  makeupLabel: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border px-2 py-1 text-[11px] font-semibold leading-tight',
        statusClass[shift.status]
      )}
      title={`${shift.schedule} ${shift.className} ${statusLabel[shift.status]}`}
    >
      <div className="truncate">{shift.startTime || shift.schedule}</div>
      <div className="truncate">{shift.className}</div>
      {shift.kind === 'makeup' && (
        <div className="mt-1">
          <MakeupBadge label={makeupLabel} />
        </div>
      )}
    </div>
  );
}

function TeacherRow({
  row,
  active,
  onSelect,
  text,
  salary,
  loading,
}: {
  row: TeacherMonthRow;
  active: boolean;
  onSelect: () => void;
  text: OfficeTeachersPageText['teacherRow'];
  salary?: number;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-2xl border p-3 text-left transition-all duration-200',
        active
          ? 'border-blue-400 bg-blue-50/80 text-blue-950 shadow-[0_10px_24px_rgba(37,99,235,0.12)]'
          : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/35'
      )}
    >
      <div className="flex items-center gap-3">
        <TeacherAvatar
          id={row.teacher.uid}
          name={row.teacher.displayName || text.noName}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-900">
                {row.teacher.displayName || text.noName}
              </p>
              {loading ? (
                <span className="mt-2 block h-3 w-24 animate-pulse rounded bg-slate-200" />
              ) : (
                <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                  {formatTeacherPhone(row.teacher.phone) || text.noPhone}
                </p>
              )}
            </div>
            {loading ? (
              <span className="h-7 w-14 shrink-0 animate-pulse rounded-full bg-slate-200" />
            ) : (
              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-black text-blue-600 shadow-sm">
                {formatTemplate(text.plannedShifts, { count: row.metrics.planned })}
              </span>
            )}
          </div>
          {loading ? (
            <div className="mt-3 h-3 w-40 animate-pulse rounded bg-slate-100" />
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold leading-6 text-slate-500">
              <span>{formatTemplate(text.classCount, { count: row.classCount })}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
              <span>{formatTemplate(text.taughtCount, { count: row.metrics.taught })}</span>
              {typeof salary === 'number' && (
                <>
                  <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
                  <span
                    title={text.monthSalary}
                    className="whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-black text-emerald-700"
                  >
                    {formatVnd(salary)}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function TeacherDetailsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_14px_36px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-5">
          <div className="h-[72px] w-[72px] animate-pulse rounded-full bg-slate-200" />
          <div className="flex-1 space-y-3">
            <div className="h-7 w-56 max-w-full animate-pulse rounded-lg bg-slate-200" />
            <div className="h-4 w-72 max-w-full animate-pulse rounded-lg bg-slate-100" />
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-[108px] animate-pulse rounded-2xl border border-slate-200 bg-slate-100"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-3xl border border-slate-200 bg-slate-100" />
      <div className="h-80 animate-pulse rounded-3xl border border-slate-200 bg-slate-100" />
    </div>
  );
}

function MonthCalendar({
  days,
  selectedDate,
  onSelectDate,
  weekdays,
  calendarText,
  statusLabel,
  makeupLabel,
}: {
  days: TeacherMonthDay[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  weekdays: string[];
  calendarText: OfficeTeachersPageText['calendar'];
  statusLabel: Record<TeacherShiftStatus, string>;
  makeupLabel: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid min-w-[820px] grid-cols-7 border-b border-slate-200 bg-slate-50">
        {weekdays.map((day) => (
          <div key={day} className="px-3 py-2.5 text-center text-xs font-black text-slate-500">
            {day}
          </div>
        ))}
      </div>
      <div className="grid min-w-[820px] grid-cols-7 bg-slate-100/70">
        {days.map((day) => {
          const visibleShifts = day.shifts.slice(0, 2);
          const overflow = Math.max(day.shifts.length - visibleShifts.length, 0);
          return (
            <button
              key={day.date}
              type="button"
              aria-label={day.date}
              onClick={() => onSelectDate(day.date)}
              className={cn(
                'min-h-[124px] border-b border-r border-slate-100 bg-white p-2.5 text-left align-top transition-colors hover:bg-blue-50/45',
                !day.inMonth && 'bg-slate-50 text-slate-300',
                selectedDate === day.date &&
                  'bg-blue-50 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.35)]'
              )}
            >
              <div className="mb-2 text-xs font-black text-slate-500">
                {Number(day.date.slice(8))}
              </div>
              <div className="space-y-1">
                {visibleShifts.map((shift) => (
                  <ShiftChip
                    key={`${shift.id}-${shift.status}`}
                    shift={shift}
                    statusLabel={statusLabel}
                    makeupLabel={makeupLabel}
                  />
                ))}
                {overflow > 0 && (
                  <div className="text-xs font-bold text-slate-500">
                    {formatTemplate(calendarText.overflow, { count: overflow })}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Teachers() {
  const { t } = useLanguage();
  const pageText = t.officeTeachersPage;
  const statusLabel: Record<TeacherShiftStatus, string> = pageText.status;
  const { profile } = useAuth();
  const canSeeSalary = canViewTeacherSalary(profile?.role);

  const [monthDate, setMonthDate] = useState(() => new Date());
  const [search, setSearch] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const month = monthString(monthDate);
  const identity = useMemo(
    () => ({ uid: profile?.uid || '', role: profile?.role || '' }),
    [profile?.role, profile?.uid]
  );

  const teachersQuery = useQuery(
    officeTeachersMonthQueryOptions(identity, month, Boolean(profile?.uid))
  );
  const teacherReferencesQuery = useQuery(
    officeTeacherReferencesQueryOptions(identity, Boolean(profile?.uid))
  );
  const provisionalData = useMemo<OfficeTeachersMonthResponse | null>(() => {
    if (!teacherReferencesQuery.data) return null;
    return {
      month,
      range: getMonthRange(month),
      teachers: teacherReferencesQuery.data,
      classes: [],
      sessions: [],
      substitutes: [],
      serverTime: Date.now(),
    };
  }, [month, teacherReferencesQuery.data]);
  const monthData = teachersQuery.data ?? null;
  const data = monthData ?? provisionalData;
  const loading = teachersQuery.isPending;
  const loadingDetails = loading && !monthData && Boolean(provisionalData);
  const error = teachersQuery.isError && !monthData;
  const cachedRefreshError = teachersQuery.isError && Boolean(monthData);
  const load = () => {
    void teachersQuery.refetch({ cancelRefetch: false });
  };

  // `load()` used to set these two while fetching. A query function stays a
  // pure read, so the defaults are applied when the month's data arrives.
  useEffect(() => {
    if (!data) return;
    setSelectedTeacherId((current) => current || data.teachers[0]?.uid || '');
    setSelectedDate(data.range.from);
  }, [data]);

  const view = useMemo(() => {
    if (!data) return null;
    return buildOfficeTeacherMonthView({ ...data, search });
  }, [data, search]);

  const payrollByTeacher = useMemo(() => {
    if (!data || !canSeeSalary) return new Map<string, TeacherPayrollMonthRow>();
    return new Map(
      buildTeacherPayrollMonthView({ ...data, search }).rows.map((row) => [row.teacher.uid, row])
    );
  }, [data, search, canSeeSalary]);

  const selectedTeacher =
    view?.teachers.find((row) => row.teacher.uid === selectedTeacherId) ||
    view?.teachers[0] ||
    null;
  const teacherRows = useMemo(() => {
    const rows = view?.teachers || [];
    if (!selectedTeacher?.teacher.uid) return rows;
    return [...rows].sort((a, b) => {
      if (a.teacher.uid === selectedTeacher.teacher.uid) return -1;
      if (b.teacher.uid === selectedTeacher.teacher.uid) return 1;
      return a.teacher.displayName.localeCompare(b.teacher.displayName);
    });
  }, [selectedTeacher?.teacher.uid, view?.teachers]);
  const dayShifts = selectedTeacher?.days.find((day) => day.date === selectedDate)?.shifts || [];

  if (loading && !data) {
    return (
      <div className="-m-4 min-h-[calc(100dvh-68px)] bg-[#f8fbff] p-4 dark:bg-slate-950 lg:-m-8 lg:p-8">
        <div className="mx-auto w-full max-w-[1460px] space-y-5">
          <div className="h-14 w-80 animate-pulse rounded-2xl bg-slate-200" />
          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <div className="h-[650px] animate-pulse rounded-3xl bg-slate-200" />
            <div className="h-[650px] animate-pulse rounded-3xl bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="-m-4 flex min-h-[calc(100dvh-68px)] items-center justify-center bg-[#f8fbff] p-4 dark:bg-slate-950 lg:-m-8">
        <div className="rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
          <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-3 text-xl font-black text-slate-950">{pageText.error.title}</h1>
          <button
            type="button"
            onClick={load}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)]"
          >
            <RefreshCw className="h-4 w-4" />
            {pageText.error.reload}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="-m-4 min-h-[calc(100dvh-68px)] bg-[#f8fbff] p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:-m-8 lg:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-[1480px] space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600 shadow-[0_12px_28px_rgba(37,99,235,0.12)]">
              <Users className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
                {pageText.title}
              </h1>
              <p className="mt-1 text-sm font-medium text-slate-500">{pageText.subtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={pageText.month.previous}
              onClick={() => setMonthDate((value) => addMonths(value, -1))}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-blue-200 hover:text-blue-600"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="inline-flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 shadow-sm">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              {displayMonth(month)}
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </div>
            <button
              type="button"
              aria-label={pageText.month.next}
              onClick={() => setMonthDate((value) => addMonths(value, 1))}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-blue-200 hover:text-blue-600"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMonthDate(new Date())}
              className="h-10 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-[0_14px_30px_rgba(37,99,235,0.26)] hover:bg-blue-700"
            >
              {pageText.month.current}
            </button>
          </div>
        </div>

        {cachedRefreshError ? (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{pageText.error.staleWarning}</span>
            <button
              type="button"
              disabled={teachersQuery.isFetching}
              onClick={load}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {pageText.error.staleRetry}
            </button>
          </div>
        ) : null}

        {loadingDetails ? (
          <div
            role="status"
            data-testid="teacher-details-loading"
            className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{pageText.loadingDetails}</span>
          </div>
        ) : null}

        <div className="grid items-stretch gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside
            data-testid="teacher-list-panel"
            className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_14px_36px_rgba(15,23,42,0.045)]"
          >
            <label className="relative block">
              <span className="sr-only">{pageText.search.label}</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                role="searchbox"
                aria-label={pageText.search.label}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/40 py-2 pl-11 pr-3 text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                placeholder={pageText.search.hint}
              />
            </label>
            <div
              data-testid="teacher-list-scroll"
              className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
            >
              {teacherRows.length ? (
                teacherRows.map((row) => (
                  <TeacherRow
                    key={row.teacher.uid}
                    row={row}
                    active={selectedTeacher?.teacher.uid === row.teacher.uid}
                    onSelect={() => setSelectedTeacherId(row.teacher.uid)}
                    text={pageText.teacherRow}
                    loading={loadingDetails}
                    salary={
                      canSeeSalary && !loadingDetails
                        ? (payrollByTeacher.get(row.teacher.uid)?.totalSalary ?? 0)
                        : undefined
                    }
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-semibold text-slate-500">
                  {pageText.search.noResults}
                </div>
              )}
            </div>
          </aside>

          <main className="space-y-5" aria-busy={loadingDetails}>
            {loadingDetails ? (
              <TeacherDetailsSkeleton />
            ) : selectedTeacher ? (
              <>
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_14px_36px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-5">
                      <TeacherAvatar
                        id={selectedTeacher.teacher.uid}
                        name={selectedTeacher.teacher.displayName}
                        size="lg"
                      />
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-black uppercase text-slate-950 sm:text-2xl">
                          {selectedTeacher.teacher.displayName || pageText.teacherRow.noName}
                        </h2>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-slate-500">
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="h-4 w-4 text-slate-500" />
                            {formatTeacherPhone(selectedTeacher.teacher.phone) ||
                              pageText.teacherRow.noPhone}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="h-4 w-4 text-slate-500" />
                            {selectedTeacher.teacher.email || pageText.teacherRow.noEmail}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-2 self-start rounded-2xl bg-blue-50 px-4 py-3 text-sm font-black text-blue-700 sm:self-center">
                      <CalendarDays className="h-4 w-4" />
                      {displayMonth(month)}
                    </div>
                  </div>
                </section>

                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    label={pageText.metrics.classes}
                    value={selectedTeacher.classCount}
                    icon={CalendarDays}
                    iconClassName="bg-sky-50 text-sky-600"
                  />
                  <MetricCard
                    label={pageText.metrics.planned}
                    value={selectedTeacher.metrics.planned}
                    icon={CalendarCheck}
                    iconClassName="bg-emerald-50 text-emerald-600"
                  />
                  <MetricCard
                    label={pageText.metrics.taught}
                    value={selectedTeacher.metrics.taught}
                    icon={CheckCircle2}
                    iconClassName="bg-violet-50 text-violet-600"
                  />
                  <MetricCard
                    label={pageText.metrics.absentOrCancelled}
                    value={selectedTeacher.metrics.absentOrCancelled}
                    icon={XCircle}
                    iconClassName="bg-rose-50 text-rose-600"
                  />
                </section>

                <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_14px_36px_rgba(15,23,42,0.05)]">
                  <div className="border-b border-slate-200 px-6 py-4">
                    <h3 className="text-base font-black text-slate-950">{pageText.table.title}</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[780px] table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-[16%]" />
                        <col className="w-[30%]" />
                        <col className="w-[14%]" />
                        <col className="w-[12%]" />
                        <col className="w-[16%]" />
                        {canSeeSalary && <col className="w-[12%]" />}
                      </colgroup>
                      <thead className="border-b border-slate-200 bg-slate-50/60 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-6 py-3.5 font-black">{pageText.table.class}</th>
                          <th className="px-6 py-3.5 font-black">{pageText.table.schedule}</th>
                          <th className="px-6 py-3.5 font-black">{pageText.table.time}</th>
                          <th className="px-6 py-3.5 font-black">{pageText.table.room}</th>
                          <th className="px-6 py-3.5 font-black">{pageText.table.status}</th>
                          {canSeeSalary && (
                            <th className="px-6 py-3.5 font-black">{pageText.table.rate}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedTeacher.classes.length ? (
                          selectedTeacher.classes.map((cls) => (
                            <tr key={cls.id} className="hover:bg-slate-50/70">
                              <td className="px-6 py-4 font-black text-slate-800">{cls.name}</td>
                              <td className="px-6 py-4 font-semibold leading-6 text-slate-500">
                                {formatWeeklyClassSchedule(cls, pageText.weekdays)}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 font-semibold text-slate-500">
                                {cls.startTime || '--'}
                              </td>
                              <td className="px-6 py-4 font-semibold text-slate-500">
                                {cls.room || '--'}
                              </td>
                              <td className="px-6 py-4">
                                <ClassStatusBadge
                                  status={cls.status}
                                  labels={pageText.classStatus}
                                />
                              </td>
                              {canSeeSalary && (
                                <td className="px-6 py-4 font-semibold text-slate-500">
                                  <span
                                    className={cn(
                                      'whitespace-nowrap',
                                      (cls.salaryPerSession ?? 0) === 0
                                        ? 'text-rose-500'
                                        : 'text-slate-500'
                                    )}
                                    title={pageText.table.rateHint}
                                  >
                                    {formatVnd(cls.salaryPerSession ?? 0)}
                                  </span>
                                </td>
                              )}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={canSeeSalary ? 6 : 5}
                              className="px-6 py-10 text-center text-sm font-semibold text-slate-500"
                            >
                              {pageText.empty.noTeachers}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="pt-1">
                  <MonthCalendar
                    days={selectedTeacher.days}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    weekdays={pageText.weekdays}
                    calendarText={pageText.calendar}
                    statusLabel={statusLabel}
                    makeupLabel={pageText.makeup}
                  />
                </section>

                <section
                  data-testid="teacher-day-details"
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)]"
                >
                  <h3 className="text-sm font-black text-slate-950">
                    {formatTemplate(pageText.dayDetails.title, { date: selectedDate })}
                  </h3>
                  <div className="mt-3 space-y-2">
                    {dayShifts.length ? (
                      dayShifts.map((shift) => (
                        <div
                          key={`${shift.id}-${shift.status}`}
                          className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3"
                        >
                          <Clock className="h-4 w-4 text-slate-400" />
                          <span className="font-bold text-slate-800">{shift.schedule}</span>
                          <span className="text-slate-600">{shift.className}</span>
                          <span
                            className={cn(
                              'rounded-full border px-2 py-1 text-xs font-bold',
                              statusClass[shift.status]
                            )}
                          >
                            {statusLabel[shift.status]}
                          </span>
                          {shift.kind === 'makeup' && <MakeupBadge label={pageText.makeup} />}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">{pageText.dayDetails.empty}</p>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
                <Users className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-500">
                  {pageText.empty.noTeachers}
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
