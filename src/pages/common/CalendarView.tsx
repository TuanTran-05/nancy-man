import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Plus,
  Clock3,
  ArrowLeftRight,
} from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { Class, Student, SubstituteRequest } from '../../types';
import { readChannel } from '../../lib/api/readApi';
import { getStudentDirectory } from '../../lib/api/studentDirectoryApi';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { cn } from '../../lib/core/utils';
import { getCalendarAttendanceState } from './calendarAttendance';
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addDays,
  subDays,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  isSameDay,
  isSameMonth,
} from 'date-fns';
import { vi, enUS } from 'date-fns/locale';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';
import {
  filterClassesForRoleOutsideAdminDashboard,
} from '../../../shared/classVisibility';
import {
  getClassSessionForDate,
  getClassTimeRange,
  isExpectedClassSessionOnDate,
} from '../../../shared/classSchedule';
import {
  FRONTEND_READ_POLL_INTERVAL_MS,
  readOfficeAcademicReferences,
} from '../../lib/api/frontendReadApi';

type CalendarClass = Class & {
  _isSubstitute?: boolean;
  _substituteRequest?: SubstituteRequest;
};

type AttendanceState = 'complete' | 'missing' | 'partial' | 'pending';

const statusStyles: Record<
  'confirmed' | 'pending' | 'cancelled' | 'substitute',
  { card: string; dot: string }
> = {
  confirmed: {
    card: 'bg-emerald-50/80 border-emerald-100 text-slate-800',
    dot: 'bg-emerald-500',
  },
  pending: {
    card: 'bg-orange-50/85 border-orange-100 text-slate-800',
    dot: 'bg-orange-400',
  },
  cancelled: {
    card: 'bg-rose-50/85 border-rose-100 text-slate-800',
    dot: 'bg-rose-500',
  },
  substitute: {
    card: 'bg-violet-50/85 border-violet-100 text-slate-800',
    dot: 'bg-violet-500',
  },
};

export default function CalendarView() {
  const { profile } = useAuth();
  const { language, t } = useLanguage();

  const [classes, setClasses] = useState<Class[]>([]);
  const [attendanceCounts, setAttendanceCounts] = useState<Record<string, number>>({});
  const [systemHolidays, setSystemHolidays] = useState<string[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [substituteRequests, setSubstituteRequests] = useState<SubstituteRequest[]>([]);
  const [substituteClasses, setSubstituteClasses] = useState<Record<string, Class>>({});
  const [teachers, setTeachers] = useState<{ uid: string; displayName: string }[]>([]);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('all');

  useEffect(() => {
    if (!profile?.uid) return;

    const isTeacher = profile.role === 'teacher';
    if (isTeacher) {
      setTeachers([
        {
          uid: profile.uid,
          displayName: profile.displayName || t.calendarPage.teacherAbbreviation,
        },
      ]);
    }

    let cancelled = false;
    const windowStart = format(
      viewMode === 'month'
        ? startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 })
        : startOfWeek(currentDate, { weekStartsOn: 1 }),
      'yyyy-MM-dd'
    );
    const windowEnd = format(
      viewMode === 'month'
        ? endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 })
        : endOfWeek(currentDate, { weekStartsOn: 1 }),
      'yyyy-MM-dd'
    );
    const loadCalendar = async () => {
      try {
        const [calendarData, directoryData, substituteData, academicData] = await Promise.all([
          readChannel<{
            classes: Class[];
            attendanceCounts?: Record<string, number>;
            systemHolidays?: string[];
          }>('calendar-window', { from: windowStart, to: windowEnd }),
          getStudentDirectory(),
          readChannel<{ requests: SubstituteRequest[]; classes?: Class[] }>(
            'substitute-requests',
            isTeacher ? { status: 'accepted' } : {}
          ),
          isTeacher
            ? Promise.resolve({ teachers: [] as Array<{ uid: string; displayName: string }> })
            : readOfficeAcademicReferences(),
        ]);
        if (cancelled) return;

        setClasses(
          filterClassesForRoleOutsideAdminDashboard(calendarData.classes || [], profile.role)
        );
        setAttendanceCounts(calendarData.attendanceCounts || {});
        setSystemHolidays(calendarData.systemHolidays || []);
        setStudents((directoryData.students || []) as Student[]);
        if (!isTeacher) setTeachers(academicData.teachers || []);

        const requests = (substituteData.requests || []).filter(
          (request) => !isTeacher || request.substituteTeacherId === profile.uid
        );
        setSubstituteRequests(requests);
        setSubstituteClasses(
          Object.fromEntries(
            filterClassesForRoleOutsideAdminDashboard(
              substituteData.classes || [],
              profile.role
            ).map((classRow) => [classRow.id, classRow])
          )
        );
      } catch (error) {
        if (!cancelled) console.error('Error loading calendar data through read API:', error);
      }
    };

    void loadCalendar();
    const interval = window.setInterval(() => void loadCalendar(), FRONTEND_READ_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [profile?.uid, profile?.role, profile?.displayName, currentDate, viewMode]);

  const dateLocale = language === 'vi' ? vi : enUS;

  const handlePrev = () => {
    setCurrentDate((date) => (viewMode === 'month' ? subMonths(date, 1) : subDays(date, 7)));
  };

  const handleNext = () => {
    setCurrentDate((date) => (viewMode === 'month' ? addMonths(date, 1) : addDays(date, 7)));
  };

  const start =
    viewMode === 'month'
      ? startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 })
      : startOfWeek(currentDate, { weekStartsOn: 1 });
  const end =
    viewMode === 'month'
      ? endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 })
      : endOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });

  const classOptions = useMemo(
    () =>
      sortClassesByTeacherThenName(
        classes.filter((cls) => cls.status !== 'archived'),
        teachers
      ),
    [classes, teachers]
  );

  const getClassesForDay = (day: Date): CalendarClass[] => {
    const dayStr = format(day, 'yyyy-MM-dd');

    const regularClasses = classes
      .filter((c) => isExpectedClassSessionOnDate(c, dayStr, systemHolidays))
      .map((c) => ({ ...c, _isSubstitute: false as const }));

    const allClassesMap = { ...substituteClasses };
    classes.forEach((c) => {
      allClassesMap[c.id] = c;
    });

    const isTeacher = profile?.role === 'teacher';
    if (isTeacher) {
      const subForDay = substituteRequests
        .filter((r) => r.date === dayStr && r.status === 'accepted')
        .filter((r) => !regularClasses.some((rc) => rc.id === r.classId))
        .map((r) => {
          const cls = allClassesMap[r.classId];
          if (!cls) return null;
          return { ...cls, _isSubstitute: true as const, _substituteRequest: r };
        })
        .filter(Boolean) as CalendarClass[];
      return [...regularClasses, ...subForDay];
    }

    const subsForDay = substituteRequests.filter(
      (r) => r.date === dayStr && r.status === 'accepted'
    );
    return regularClasses.map((c) => {
      const sub = subsForDay.find((r) => r.classId === c.id);
      return sub ? { ...c, _isSubstitute: true as const, _substituteRequest: sub } : c;
    });
  };

  const getAttendanceStatus = (cls: Class, day: Date): AttendanceState => {
    const dayStr = format(day, 'yyyy-MM-dd');
    const markedCount = attendanceCounts[`${cls.id}::${dayStr}`] || 0;
    const activeStudents = students.filter(
      (s) =>
        s.classId === cls.id &&
        (!s.enrollmentStatus || s.enrollmentStatus === 'active') &&
        s.enrollmentStatus !== 'promoted'
    );

    return getCalendarAttendanceState({
      markedCount,
      activeStudentCount: activeStudents.length,
      isPastDate: day < new Date() && !isSameDay(day, new Date()),
    });
  };

  const matchesFilters = (cls: CalendarClass) => {
    if (selectedClassId !== 'all' && cls.id !== selectedClassId) return false;
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return true;
    const sub = cls._substituteRequest;
    return [
      cls.name,
      cls.schedule,
      cls.room,
      sub?.requestingTeacherName,
      sub?.substituteTeacherName,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  };

  const getVisibleClassesForDay = (day: Date) => {
    const dayStr = format(day, 'yyyy-MM-dd');
    return getClassesForDay(day)
      .filter(matchesFilters)
      .sort((a, b) => {
        const sessionA = getClassSessionForDate(a, dayStr);
        const sessionB = getClassSessionForDate(b, dayStr);
        return (sessionA?.startTime || a.startTime || '00:00').localeCompare(
          sessionB?.startTime || b.startTime || '00:00'
        );
      });
  };

  const getVisualStatus = (cls: CalendarClass, day: Date) => {
    if (cls._isSubstitute) return statusStyles.substitute;
    const attendanceStatus = getAttendanceStatus(cls, day);
    if (attendanceStatus === 'missing') return statusStyles.cancelled;
    if (attendanceStatus === 'partial') return statusStyles.pending;
    return statusStyles.confirmed;
  };

  const titleDate =
    viewMode === 'month'
      ? t.calendarPage.month.replace('{date}', format(currentDate, 'MM/yyyy'))
      : `${format(start, 'dd/MM')} - ${format(end, 'dd/MM/yyyy')}`;

  const weekdayLabels = t.calendarPage.weekdayLabels;

  const totalSchedules = days.reduce((sum, day) => sum + getVisibleClassesForDay(day).length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100">
            <CalendarIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-normal text-slate-950">
              {t.calendarPage.classSchedule}
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {t.calendarPage.scheduleTitle}
            </p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto xl:items-center">
          <label className="relative flex min-h-11 w-full items-center rounded-2xl border border-slate-200 bg-white/90 px-4 shadow-sm backdrop-blur-sm xl:w-[460px]">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t.calendarPage.searchPlaceholder}
              className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
            />
            <span className="hidden rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-blue-600 sm:block">
              Ctrl + K
            </span>
          </label>
        </div>
      </div>

      <section className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white/90 shadow-[0_20px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setViewMode('month')}
                className={cn(
                  'rounded-xl px-5 py-2 text-sm font-bold transition-all',
                  viewMode === 'month'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                    : 'text-slate-500 hover:text-slate-800'
                )}
              >
                {t.calendarPage.monthLabel}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('week')}
                className={cn(
                  'rounded-xl px-5 py-2 text-sm font-bold transition-all',
                  viewMode === 'week'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                    : 'text-slate-500 hover:text-slate-800'
                )}
              >
                {t.calendarPage.weekLabel}
              </button>
            </div>

            <button
              type="button"
              onClick={handlePrev}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-600"
              aria-label={t.calendarPage.previousMonth}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-600"
              aria-label={t.calendarPage.nextMonth}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentDate(new Date())}
              className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-600"
            >
              <CalendarIcon className="h-4 w-4 text-blue-500" />
              {t.calendarPage.today}
            </button>
            <span className="px-4 text-base font-extrabold text-slate-900">{titleDate}</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedClassId}
              onChange={(event) => setSelectedClassId(event.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">{t.calendarPage.allClasses}</option>
              {classOptions.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {formatClassNameWithTeacher(cls, teachers)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-blue-600 shadow-sm hover:border-blue-200 hover:bg-blue-50"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t.calendarPage.filter}
            </button>
            <Link
              to="/classes"
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              {t.calendarPage.createSchedule}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-200/80 bg-slate-50/70">
          {weekdayLabels.map((day) => (
            <div key={day} className="px-3 py-4 text-center text-xs font-extrabold text-slate-500">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 bg-slate-200/70 gap-px">
          {days.map((day) => {
            const classesToday = getVisibleClassesForDay(day);
            const isCurrentDay = isSameDay(day, new Date());
            const isCurrentMonth = isSameMonth(day, currentDate);

            return (
              <div
                key={format(day, 'yyyy-MM-dd')}
                className={cn(
                  'min-h-[128px] bg-white/80 p-3 text-left transition-colors lg:min-h-[152px]',
                  viewMode === 'week' && 'min-h-[440px]',
                  !isCurrentMonth && viewMode === 'month' && 'bg-white/50 text-slate-300',
                  isCurrentDay && 'bg-blue-50/70'
                )}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span
                    className={cn(
                      'flex h-7 min-w-7 items-center justify-center rounded-full text-sm font-extrabold',
                      isCurrentDay
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                        : isCurrentMonth || viewMode === 'week'
                          ? 'text-slate-900'
                          : 'text-slate-300'
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                </div>

                <div className="space-y-2">
                  {classesToday.slice(0, viewMode === 'month' ? 4 : 12).map((cls) => {
                    const visual = getVisualStatus(cls, day);
                    const subReq = cls._substituteRequest;
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const resolvedTime =
                      getClassSessionForDate(cls, dateStr)?.schedule || getClassTimeRange(cls);
                    return (
                      <div
                        key={`${cls.id}-${format(day, 'yyyy-MM-dd')}-${cls._isSubstitute ? 'sub' : 'regular'}`}
                        className={cn(
                          'rounded-xl border px-3 py-2 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
                          visual.card
                        )}
                        title={`${cls.name} - ${resolvedTime}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-extrabold text-slate-900">
                              {cls.name}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-slate-600">
                              <Clock3 className="h-3.5 w-3.5" />
                              {resolvedTime}
                            </p>
                          </div>
                          <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', visual.dot)} />
                        </div>
                        {cls._isSubstitute && (
                          <p className="mt-1 flex items-center gap-1 truncate text-[11px] font-bold text-violet-600">
                            <ArrowLeftRight className="h-3 w-3" />
                            {profile?.role === 'admin' && subReq?.substituteTeacherName
                              ? subReq.substituteTeacherName
                              : t.calendarPage.substituteLabel}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {classesToday.length > (viewMode === 'month' ? 4 : 12) && (
                    <div className="rounded-lg bg-slate-100 px-2 py-1 text-center text-xs font-bold text-slate-500">
                      +{classesToday.length - (viewMode === 'month' ? 4 : 12)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-200/80 bg-white/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            {(['confirmed', 'pending', 'cancelled', 'substitute'] as const).map((key) => (
              <div key={key} className="flex items-center gap-2 text-sm font-bold text-slate-600">
                <span className={cn('h-3 w-3 rounded-full', statusStyles[key].dot)} />
                {t.calendarPage[key]}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-700">
            <span className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-blue-600" />
              {t.calendarPage.totalSchedules.replace('{count}', String(totalSchedules))}
            </span>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-blue-600 shadow-sm hover:border-blue-200 hover:bg-blue-50"
            >
              {t.calendarPage.weekView}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
