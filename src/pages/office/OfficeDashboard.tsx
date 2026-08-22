import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  UsersRound,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { officeWeeklyDashboardQueryOptions } from '../../lib/office/officeDashboardQueries';
import { cn } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import {
  buildOfficeWeeklyDashboardView,
  filterOfficeWeeklyCards,
  type OfficeDashboardCard,
  type OfficeWeeklyDashboardFilters,
  WEEKDAYS,
} from '../../lib/office/weeklyDashboard';

type PageText = ReturnType<typeof useLanguage>['t']['officeDashboardPage'];

const BOARD_DRAG_THRESHOLD_PX = 4;

type BoardDragState = {
  pointerId: number;
  startX: number;
  scrollLeft: number;
  hasDragged: boolean;
};

function replaceCount(template: string, count: number) {
  return template.replace('{count}', String(count));
}

function replaceGrade(template: string, grade: number) {
  return template.replace('{grade}', String(grade));
}

function replaceRoom(template: string, room: string) {
  return template.replace('{room}', room);
}

function displayDate(value: string, fallback: string) {
  if (!value) return fallback;
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function statusLabel(status: OfficeDashboardCard['courseStatus'], text: PageText) {
  if (status === 'new') return text.status.new;
  if (status === 'paused') return text.status.paused;
  if (status === 'ending_soon') return text.status.endingSoon;
  if (status === 'ended') return text.status.ended;
  return text.status.active;
}

function statusClass(status: OfficeDashboardCard['courseStatus']) {
  if (status === 'ended') return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (status === 'paused') return 'bg-orange-50 text-orange-700 ring-orange-100';
  if (status === 'ending_soon') return 'bg-amber-100 text-amber-800 ring-amber-200';
  if (status === 'new') return 'bg-blue-50 text-blue-700 ring-blue-100';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
}

function selectedLabel(allLabel: string, selectedCount: number, text: PageText) {
  return selectedCount === 0 ? allLabel : replaceCount(text.filters.selectedCount, selectedCount);
}

interface Option {
  value: string;
  label: string;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

function MultiSelectMenu({
  label,
  summary,
  options,
  selected,
  onToggle,
  text,
}: {
  label: string;
  summary: string;
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  text: PageText;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedSet = new Set(selected);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:border-blue-200"
      >
        <span className="min-w-0 flex-1 truncate pr-3">
          {label}: <span className="text-blue-600">{summary}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open ? (
        <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-[0_18px_44px_rgba(15,23,42,0.14)]">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-blue-50"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(option.value)}
                onChange={() => onToggle(option.value)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {selectedSet.has(option.value) ? <Check className="h-4 w-4 text-blue-600" /> : null}
            </label>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 h-9 w-full rounded-lg bg-blue-600 text-sm font-bold text-white"
          >
            {text.filters.close}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function toggleValue(current: string[], value: string) {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function ClassCard({ card, text }: { card: OfficeDashboardCard; text: PageText }) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-3.5 shadow-[0_8px_18px_rgba(15,23,42,0.04)]',
        card.courseStatus === 'ended'
          ? 'border-rose-300 bg-rose-50/80 shadow-[0_8px_22px_rgba(244,63,94,0.10)]'
          : card.courseStatus === 'paused'
            ? 'border-orange-200 bg-orange-50/70 shadow-[0_8px_22px_rgba(249,115,22,0.10)]'
            : card.courseStatus === 'ending_soon'
              ? 'border-amber-300 bg-amber-50/80 shadow-[0_8px_22px_rgba(245,158,11,0.12)]'
              : 'border-slate-200 bg-white'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 overflow-hidden text-[15px] font-black leading-snug text-slate-950 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {card.className}
        </h3>
        <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">
          {card.startTime || card.schedule || '--:--'}
        </span>
      </div>
      <div className="mt-2 space-y-1.5 text-[11px] font-bold leading-snug text-slate-500">
        <div>{card.teacherName || text.card.teacherFallback}</div>
        <div>
          {card.grade
            ? replaceGrade(text.filters.gradeOption, card.grade)
            : text.card.gradeFallback}
          {card.room ? ` · ${replaceRoom(text.card.roomLabel, card.room)}` : ''}
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-[11px] font-bold text-slate-600">
        <div className="rounded-xl bg-slate-50 px-2.5 py-2 leading-snug">
          {text.card.startDate.replace('{date}', displayDate(card.startDate, text.card.noDate))}
        </div>
        <div className="rounded-xl bg-slate-50 px-2.5 py-2 leading-snug">
          {text.card.endDate.replace('{date}', displayDate(card.endDate, text.card.noDate))}
        </div>
      </div>
      <div className="mt-3">
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-black ring-1',
            statusClass(card.courseStatus)
          )}
        >
          {statusLabel(card.courseStatus, text)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          [text.card.currentTotal, card.counts.currentTotal],
          [text.card.active, card.counts.active],
          [text.card.onLeave, card.counts.onLeave],
        ].map(([label, value]) => (
          <div
            key={label as string}
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-2 text-center"
          >
            <div className="text-lg font-black leading-none text-slate-950">{value}</div>
            <div className="mt-1 text-[10px] font-bold leading-tight text-slate-500">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OfficeDashboard() {
  const { t } = useLanguage();
  const text = t.officeDashboardPage;
  const boardDragRef = useRef<BoardDragState | null>(null);
  const suppressBoardClickRef = useRef(false);
  const { profile } = useAuth();
  const identity = { uid: profile?.uid || '', role: profile?.role || '' };
  const dashboardQuery = useQuery(
    officeWeeklyDashboardQueryOptions(identity, Boolean(profile?.uid))
  );
  const data = dashboardQuery.data ?? null;
  // Only a first load with nothing cached shows the full loader. A background
  // revalidation keeps the board on screen.
  const loading = dashboardQuery.isPending;
  const error = dashboardQuery.isError && !dashboardQuery.data;
  const cachedRefreshError = dashboardQuery.isError && Boolean(dashboardQuery.data);
  const load = () => {
    void dashboardQuery.refetch({ cancelRefetch: false });
  };
  const [isBoardDragging, setIsBoardDragging] = useState(false);
  const [filters, setFilters] = useState<OfficeWeeklyDashboardFilters>({
    search: '',
    teacherIds: [],
    weekdayValues: [],
    grades: [],
  });
  const debouncedSearch = useDebouncedValue(filters.search, 200);

  const view = useMemo(() => (data ? buildOfficeWeeklyDashboardView(data) : null), [data]);
  const filteredDays = useMemo(() => {
    if (!view) return [];
    const activeFilters: OfficeWeeklyDashboardFilters = {
      search: debouncedSearch,
      teacherIds: filters.teacherIds,
      weekdayValues: filters.weekdayValues,
      grades: filters.grades,
    };
    return view.days.map((day) => ({
      ...day,
      cards: filterOfficeWeeklyCards(day.cards, activeFilters),
    }));
  }, [debouncedSearch, filters.grades, filters.teacherIds, filters.weekdayValues, view]);
  const visibleCardCount = filteredDays.reduce((sum, day) => sum + day.cards.length, 0);

  const teacherOptions =
    view?.teachers.map((teacher) => ({
      value: teacher.uid,
      label: teacher.displayName || teacher.email || teacher.uid,
    })) || [];
  const weekdayOptions = WEEKDAYS.map((day) => ({
    value: String(day.value),
    label: text.weekdays[day.key],
  }));
  const gradeOptions =
    view?.grades.map((grade) => ({
      value: String(grade),
      label: replaceGrade(text.filters.gradeOption, grade),
    })) || [];

  const resetFilters = () =>
    setFilters({ search: '', teacherIds: [], weekdayValues: [], grades: [] });

  const handleBoardPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    boardDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      hasDragged: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleBoardPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = boardDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    if (!dragState.hasDragged && Math.abs(deltaX) < BOARD_DRAG_THRESHOLD_PX) return;

    if (!dragState.hasDragged) {
      dragState.hasDragged = true;
      setIsBoardDragging(true);
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = dragState.scrollLeft - deltaX;
  }, []);

  const finishBoardDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = boardDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    suppressBoardClickRef.current = dragState.hasDragged;
    boardDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setIsBoardDragging(false);

    window.setTimeout(() => {
      suppressBoardClickRef.current = false;
    }, 0);
  }, []);

  const handleBoardClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressBoardClickRef.current) return;

    suppressBoardClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-[1700px] p-6 text-slate-900">
        <div
          role="status"
          className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm"
        >
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-600" />
          <p className="mt-3 text-sm font-bold text-slate-500">{text.states.loading}</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-120px)] w-full max-w-[900px] items-center justify-center p-6">
        <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-9 w-9 text-rose-500" />
          <h1 className="mt-3 text-xl font-black text-slate-950">{text.states.loadErrorTitle}</h1>
          <button
            type="button"
            onClick={load}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            {text.states.loadErrorAction}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="-m-4 min-h-[calc(100dvh-68px)] bg-[#f8fbff] p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:-m-8 lg:p-8">
      <div className="mx-auto w-full max-w-[1700px] space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-[28px] font-black leading-tight text-slate-950">{text.title}</h1>
              <p className="mt-1.5 text-sm font-semibold text-slate-500">{text.subtitle}</p>
            </div>
          </div>
          {view ? (
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                [text.metrics.visibleClasses, view.metrics.visibleClasses],
                [text.metrics.activeStudents, view.metrics.activeStudents],
                [text.metrics.onLeaveStudents, view.metrics.onLeaveStudents],
                [text.metrics.endedClasses, view.metrics.endedClasses],
              ].map(([label, value]) => (
                <div
                  key={label as string}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="text-2xl font-black leading-none text-slate-950">{value}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{label as string}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {cachedRefreshError ? (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{text.states.staleWarning}</span>
            <button
              type="button"
              disabled={dashboardQuery.isFetching}
              onClick={load}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {text.states.staleRetry}
            </button>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_220px_220px_220px_130px]">
            <label className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
              <Search className="h-5 w-5 text-slate-400" />
              <span className="sr-only">{text.search.label}</span>
              <input
                role="searchbox"
                aria-label={text.search.label}
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                placeholder={text.search.placeholder}
                className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>
            <MultiSelectMenu
              label={text.filters.teachers}
              summary={selectedLabel(text.filters.allTeachers, filters.teacherIds.length, text)}
              options={teacherOptions}
              selected={filters.teacherIds}
              onToggle={(value) =>
                setFilters((current) => ({
                  ...current,
                  teacherIds: toggleValue(current.teacherIds, value),
                }))
              }
              text={text}
            />
            <MultiSelectMenu
              label={text.filters.weekdays}
              summary={selectedLabel(text.filters.allWeekdays, filters.weekdayValues.length, text)}
              options={weekdayOptions}
              selected={filters.weekdayValues.map(String)}
              onToggle={(value) =>
                setFilters((current) => ({
                  ...current,
                  weekdayValues: toggleValue(current.weekdayValues.map(String), value).map(Number),
                }))
              }
              text={text}
            />
            <MultiSelectMenu
              label={text.filters.grades}
              summary={selectedLabel(text.filters.allGrades, filters.grades.length, text)}
              options={gradeOptions}
              selected={filters.grades.map(String)}
              onToggle={(value) =>
                setFilters((current) => ({
                  ...current,
                  grades: toggleValue(current.grades.map(String), value).map(Number),
                }))
              }
              text={text}
            />
            <button
              type="button"
              onClick={resetFilters}
              className="h-12 rounded-xl border border-blue-100 bg-blue-50 px-4 text-sm font-black text-blue-700"
            >
              {text.filters.reset}
            </button>
          </div>
        </div>

        {visibleCardCount === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500 shadow-sm">
            {text.states.noResults}
          </div>
        ) : (
          <div
            data-testid="office-weekly-board"
            onClickCapture={handleBoardClickCapture}
            onPointerCancel={finishBoardDrag}
            onPointerDown={handleBoardPointerDown}
            onPointerMove={handleBoardPointerMove}
            onPointerUp={finishBoardDrag}
            className={cn(
              'cursor-grab overflow-x-auto pb-2 select-none touch-pan-y',
              isBoardDragging && 'cursor-grabbing'
            )}
          >
            <div className="grid min-w-[1750px] grid-cols-7 gap-3">
              {filteredDays.map((day) => (
                <section
                  key={day.key}
                  aria-label={text.weekdays[day.key]}
                  className="min-h-[420px] min-w-[250px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-black uppercase tracking-normal text-slate-950">
                      {text.weekdays[day.key]}
                    </h2>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-500">
                      {day.cards.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {day.cards.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs font-bold text-slate-400">
                        {text.states.emptyDay}
                      </div>
                    ) : (
                      day.cards.map((card) => <ClassCard key={card.id} card={card} text={text} />)
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
