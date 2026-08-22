import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { cn } from '../../lib/core/utils';
import { formatVndAmount } from '../../lib/core/moneyFormat';
import { apiRequest } from '../../lib/api/apiClient';
import { type TeacherPayrollMonthResponse } from '../../lib/api/teacherPayrollApi';
import {
  buildTeacherPayrollMonthView,
  type TeacherPayrollMonthRow,
} from '../../lib/payroll/teacherPayrollMonth';
import {
  teacherPayrollMonthQueryOptions,
  teacherPayrollQueryKeys,
} from '../../lib/payroll/teacherPayrollQueries';
import { useAuth } from '../../contexts/AuthContext';
import {
  Calendar,
  DollarSign,
  Search,
  ChevronDown,
  ChevronUp,
  Edit2,
  Check,
  X,
  BookOpen,
  Loader2,
} from 'lucide-react';
import {
  parseISO,
  endOfMonth,
  eachDayOfInterval,
  format,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
} from 'date-fns';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { useInvalidationRefresh } from '../../hooks/useInvalidationRefresh';

interface TeacherPayrollProps {
  teacherId?: string;
  canEditSalary?: boolean;
}

type PayrollCalendarItem = {
  name: string;
  status: string;
  time: string;
  teacherAttendanceStatus: string;
  isPayrollCounted: boolean;
};

function buildPayrollDailySchedule(row: TeacherPayrollMonthRow) {
  const paidShiftKeys = new Set(
    row.paidRows.map((paidRow) => `${paidRow.classId}_${paidRow.date}`)
  );
  const dailySchedule: Record<string, PayrollCalendarItem[]> = {};

  row.days
    .filter((day) => day.inMonth)
    .forEach((day) => {
      day.shifts.forEach((shift) => {
        if (!dailySchedule[shift.date]) dailySchedule[shift.date] = [];
        dailySchedule[shift.date].push({
          name: shift.className,
          status:
            shift.status === 'cancelled'
              ? 'cancelled'
              : shift.kind === 'makeup'
                ? 'makeup'
                : 'taught',
          time: shift.startTime || shift.schedule || 'N/A',
          teacherAttendanceStatus:
            shift.status === 'present'
              ? 'present'
              : shift.status === 'absent'
                ? 'absent'
                : shift.status === 'cancelled'
                  ? 'cancelled'
                  : 'pending',
          isPayrollCounted: paidShiftKeys.has(`${shift.classId}_${shift.date}`),
        });
      });
    });

  return dailySchedule;
}

export const TeacherPayroll: React.FC<TeacherPayrollProps> = ({
  teacherId,
  canEditSalary = !teacherId,
}) => {
  const { language } = useLanguage();
  const t = translations[language].payroll;

  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(teacherId || null);
  const [editingClassSalary, setEditingClassSalary] = useState<string | null>(null);
  const [tempSalary, setTempSalary] = useState<string>('');
  const [updatingSalaryClassId, setUpdatingSalaryClassId] = useState<string | null>(null);

  const uid = profile?.uid || '';
  const role = profile?.role || '';
  const identity = useMemo(() => ({ uid, role }), [uid, role]);
  const hasIdentity = Boolean(uid && role);
  const monthQuery = useQuery(
    teacherPayrollMonthQueryOptions(identity, selectedMonth, hasIdentity)
  );
  const monthData = monthQuery.data ?? null;
  const loading = hasIdentity && monthQuery.isPending;

  if (monthQuery.error) console.error('Error fetching payroll data:', monthQuery.error);

  // `refetch` rather than `invalidateQueries`: a realtime bump means the month
  // changed, and the cached copy must be replaced even though the 15-minute
  // staleTime still considers it fresh.
  const refetchMonth = monthQuery.refetch;
  const refreshMonth = useCallback(async () => {
    await refetchMonth();
  }, [refetchMonth]);
  useInvalidationRefresh({
    channelKey: 'payroll',
    enabled: hasIdentity,
    onInvalidate: refreshMonth,
  });

  const applyLocalSalaryChange = useCallback(
    (classId: string, salaryPerSession: number) => {
      queryClient.setQueryData<TeacherPayrollMonthResponse>(
        teacherPayrollQueryKeys.month(identity, selectedMonth),
        (current) =>
          current
            ? {
                ...current,
                classes: current.classes.map((cls) =>
                  cls.id === classId ? { ...cls, salaryPerSession } : cls
                ),
              }
            : current
      );
    },
    [identity, queryClient, selectedMonth]
  );

  const handleUpdateSalary = async (classId: string) => {
    if (updatingSalaryClassId) return;
    try {
      const newSalary = parseInt(tempSalary);
      if (isNaN(newSalary) || newSalary < 0) {
        toast.error(t.invalidSalary);
        return;
      }
      setUpdatingSalaryClassId(classId);
      await apiRequest('/api/v1/classes/update-salary', {
        method: 'PUT',
        body: { classId, salaryPerSession: newSalary },
      });
      applyLocalSalaryChange(classId, newSalary);
      setEditingClassSalary(null);
    } catch (error) {
      console.error('Error updating salary:', error);
      toast.error(t.updateSalaryError);
    } finally {
      setUpdatingSalaryClassId(null);
    }
  };

  const payrollData = useMemo(
    () =>
      monthData
        ? buildTeacherPayrollMonthView({
            ...monthData,
            search: searchTerm,
            teacherIdFilter: teacherId,
          }).rows.filter((row) => Boolean(teacherId) || !row.teacher.blockedTeacher)
        : [],
    [monthData, searchTerm, teacherId]
  );

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">{translations[language].common.loading}</div>
    );
  }

  if (teacherId && payrollData.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
        <Calendar className="w-12 h-12 text-slate-200 mx-auto mb-4" />
        <p className="text-slate-500 font-medium">{t.noDataThisMonth}</p>
        <div className="mt-4">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-4 py-2 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      </div>
    );
  }

  const singleTeacherData = teacherId ? payrollData[0] : null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <DollarSign className="w-5 h-5 mr-2 text-emerald-500" />
            {teacherId ? t.title : t.payrollTitle}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {teacherId ? t.teacherDetailDesc : t.payrollDesc}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {!teacherId && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                placeholder={t.searchTeacher}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none w-full sm:w-64"
              />
            </div>
          )}
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
      </div>

      {teacherId && singleTeacherData ? (
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
              <p className="text-sm font-bold text-blue-500 uppercase tracking-wider mb-1">
                {t.sessionsCount}
              </p>
              <p className="text-3xl font-black text-blue-700">{singleTeacherData.totalSessions}</p>
            </div>
            <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
              <p className="text-sm font-bold text-emerald-500 uppercase tracking-wider mb-1">
                {t.estimatedSalary}
              </p>
              <p className="text-3xl font-black text-emerald-700">
                {formatVndAmount(singleTeacherData.totalSalary)} đ
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Class List */}
            <div className="lg:col-span-1">
              <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center">
                <BookOpen className="w-3 h-3 mr-1.5" />
                {t.classDetails}
              </h4>
              <div className="space-y-3">
                {Object.values(singleTeacherData.classes).map(({ class: cls, count, salary }) => (
                  <div
                    key={cls.id}
                    className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm"
                  >
                    <div className="font-bold text-slate-800 text-sm">{cls.name}</div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="text-xs text-slate-500">
                        <span className="font-medium text-blue-600">
                          {count} {t.sessions}
                        </span>
                        <span className="mx-1">×</span>
                        <span className="text-slate-600">
                          {formatVndAmount(cls.salaryPerSession)}đ
                        </span>
                      </div>
                      <div className="text-sm font-bold text-emerald-600">
                        {formatVndAmount(salary)}đ
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Calendar View */}
            <div className="lg:col-span-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center">
                <Calendar className="w-3 h-3 mr-1.5" />
                {t.monthlySchedule}
              </h4>
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
                  {t.days.map((day: string) => (
                    <div
                      key={day}
                      className="py-2 text-center text-[10px] font-bold text-slate-400 uppercase"
                    >
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {(() => {
                    const monthStart = startOfMonth(parseISO(`${selectedMonth}-01`));
                    const monthEnd = endOfMonth(monthStart);
                    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
                    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
                    const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

                    const dailySchedule = buildPayrollDailySchedule(singleTeacherData);

                    return days.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const isCurrentMonth = isSameMonth(day, monthStart);
                      const daySessions = dailySchedule[dateStr] || [];
                      const isToday = isSameDay(day, new Date());

                      return (
                        <div
                          key={dateStr}
                          className={cn(
                            'min-h-[80px] p-1.5 border-r border-b border-slate-100 transition-colors',
                            !isCurrentMonth && 'bg-slate-50/50 opacity-30',
                            isToday && 'bg-blue-50/30'
                          )}
                        >
                          <div
                            className={cn(
                              'text-[10px] font-bold mb-1 w-5 h-5 flex items-center justify-center rounded-full',
                              isToday ? 'bg-blue-600 text-white' : 'text-slate-400'
                            )}
                          >
                            {day.getDate()}
                          </div>
                          <div className="space-y-1">
                            {daySessions.map((item, idx) => (
                              <div
                                key={idx}
                                className={cn(
                                  'text-[9px] px-1.5 py-1 rounded border leading-tight',
                                  item.status === 'cancelled'
                                    ? 'bg-red-50 text-red-600 border-red-100 line-through'
                                    : item.status === 'makeup'
                                      ? 'bg-amber-50 text-amber-700 border-amber-100'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                )}
                                title={`${item.name} (${item.time})`}
                              >
                                <div className="font-bold truncate">{item.name}</div>
                                <div className="opacity-70 text-[8px] flex items-center justify-between gap-1 flex-wrap mt-0.5">
                                  <span>{item.time}</span>
                                  <span
                                    className={cn(
                                      'rounded-full px-1 py-0.5 text-[7px] font-bold shrink-0',
                                      item.teacherAttendanceStatus === 'present'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : item.teacherAttendanceStatus === 'absent'
                                          ? 'bg-red-100 text-red-700'
                                          : item.teacherAttendanceStatus === 'cancelled'
                                            ? 'bg-slate-100 text-slate-500'
                                            : 'bg-amber-100 text-amber-700'
                                    )}
                                  >
                                    {item.teacherAttendanceStatus === 'present'
                                      ? t.attendancePresent
                                      : item.teacherAttendanceStatus === 'absent'
                                        ? t.attendanceAbsent
                                        : item.teacherAttendanceStatus === 'cancelled'
                                          ? t.attendanceCancelled
                                          : t.attendancePending}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <th className="p-4 font-bold text-slate-400 text-xs uppercase border-b border-slate-100 w-10"></th>
              <th className="p-4 font-bold text-slate-400 text-xs uppercase border-b border-slate-100">
                {t.teacher}
              </th>
              <th className="p-4 font-bold text-slate-400 text-xs uppercase border-b border-slate-100 text-center">
                {t.totalSessions}
              </th>
              <th className="p-4 font-bold text-slate-400 text-xs uppercase border-b border-slate-100 text-right">
                {t.totalSalary}
              </th>
            </tr>
          </thead>
          <tbody>
            {payrollData.map((payrollRow) => {
              const { teacher, totalSessions, totalSalary, classes: teacherClasses } = payrollRow;
              return (
                <React.Fragment key={teacher.uid}>
                  <tr
                    className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                    onClick={() =>
                      setExpandedTeacher(expandedTeacher === teacher.uid ? null : teacher.uid)
                    }
                  >
                    <td className="p-4 border-b border-slate-100 text-slate-400">
                      {expandedTeacher === teacher.uid ? (
                        <ChevronUp className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </td>
                    <td className="p-4 border-b border-slate-100">
                      <div className="font-bold text-slate-900">
                        {teacher.displayName || t.noUpdates}
                      </div>
                      <div className="text-sm text-slate-500">{teacher.email}</div>
                    </td>
                    <td className="p-4 border-b border-slate-100 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-600 font-bold">
                        {totalSessions}
                      </span>
                    </td>
                    <td className="p-4 border-b border-slate-100 text-right">
                      <span className="font-black text-emerald-600 text-lg">
                        {formatVndAmount(totalSalary)} đ
                      </span>
                    </td>
                  </tr>
                  {expandedTeacher === teacher.uid && (
                    <tr>
                      <td colSpan={4} className="p-0 border-b border-slate-100 bg-slate-50/30">
                        <div className="p-6 pl-14 pb-12">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Left: Class List */}
                            <div className="lg:col-span-1">
                              <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center">
                                <BookOpen className="w-3 h-3 mr-1.5" />
                                {t.classDetails}
                              </h4>
                              {Object.values(teacherClasses).length > 0 ? (
                                <div className="space-y-3">
                                  {Object.values(teacherClasses).map(
                                    ({ class: cls, count, salary }) => (
                                      <div
                                        key={cls.id}
                                        className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm"
                                      >
                                        <div className="font-bold text-slate-800 text-sm">
                                          {cls.name}
                                        </div>
                                        <div className="flex items-center justify-between mt-2">
                                          <div className="text-xs text-slate-500">
                                            <span className="font-medium text-blue-600">
                                              {count} {t.sessions}
                                            </span>
                                            <span className="mx-1">×</span>
                                            {canEditSalary && editingClassSalary === cls.id ? (
                                              <div className="inline-flex items-center gap-1">
                                                <input
                                                  type="number"
                                                  value={tempSalary}
                                                  disabled={updatingSalaryClassId === cls.id}
                                                  onChange={(e) => setTempSalary(e.target.value)}
                                                  className="w-20 px-1.5 py-0.5 border border-slate-300 rounded text-[10px] outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                                  autoFocus
                                                />
                                                <button
                                                  onClick={() => handleUpdateSalary(cls.id)}
                                                  disabled={updatingSalaryClassId !== null}
                                                  className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                  {updatingSalaryClassId === cls.id ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                  ) : (
                                                    <Check className="w-3 h-3" />
                                                  )}
                                                </button>
                                                <button
                                                  onClick={() => setEditingClassSalary(null)}
                                                  disabled={updatingSalaryClassId === cls.id}
                                                  className="p-0.5 text-slate-400 hover:bg-slate-100 rounded disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                  <X className="w-3 h-3" />
                                                </button>
                                              </div>
                                            ) : (
                                              <span className="group inline-flex items-center">
                                                <span
                                                  className={cn(
                                                    (cls.salaryPerSession || 0) === 0
                                                      ? 'text-red-500'
                                                      : 'text-slate-600'
                                                  )}
                                                >
                                                  {formatVndAmount(cls.salaryPerSession)}đ
                                                </span>
                                                {canEditSalary && (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setTempSalary(
                                                        String(Number(cls.salaryPerSession || 0))
                                                      );
                                                      setEditingClassSalary(cls.id);
                                                    }}
                                                    className="ml-1 p-0.5 text-slate-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                                  >
                                                    <Edit2 className="w-2.5 h-2.5" />
                                                  </button>
                                                )}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-sm font-bold text-emerald-600">
                                            {formatVndAmount(salary)}đ
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  )}
                                </div>
                              ) : (
                                <div className="text-sm text-slate-500 italic">{t.noData}</div>
                              )}
                            </div>

                            {/* Right: Calendar View */}
                            <div className="lg:col-span-2">
                              <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center">
                                <Calendar className="w-3 h-3 mr-1.5" />
                                {t.monthlySchedule}
                              </h4>
                              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
                                  {t.days.map((day: string) => (
                                    <div
                                      key={day}
                                      className="py-2 text-center text-[10px] font-bold text-slate-400 uppercase"
                                    >
                                      {day}
                                    </div>
                                  ))}
                                </div>
                                <div className="grid grid-cols-7">
                                  {(() => {
                                    const monthStart = startOfMonth(
                                      parseISO(`${selectedMonth}-01`)
                                    );
                                    const monthEnd = endOfMonth(monthStart);
                                    const calendarStart = startOfWeek(monthStart, {
                                      weekStartsOn: 1,
                                    });
                                    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
                                    const days = eachDayOfInterval({
                                      start: calendarStart,
                                      end: calendarEnd,
                                    });

                                    const dailySchedule = buildPayrollDailySchedule(payrollRow);

                                    return days.map((day) => {
                                      const dateStr = format(day, 'yyyy-MM-dd');
                                      const isCurrentMonth = isSameMonth(day, monthStart);
                                      const daySessions = dailySchedule[dateStr] || [];
                                      const isToday = isSameDay(day, new Date());

                                      return (
                                        <div
                                          key={dateStr}
                                          className={cn(
                                            'min-h-[80px] p-1.5 border-r border-b border-slate-100 transition-colors',
                                            !isCurrentMonth && 'bg-slate-50/50 opacity-30',
                                            isToday && 'bg-blue-50/30'
                                          )}
                                        >
                                          <div
                                            className={cn(
                                              'text-[10px] font-bold mb-1 w-5 h-5 flex items-center justify-center rounded-full',
                                              isToday ? 'bg-blue-600 text-white' : 'text-slate-400'
                                            )}
                                          >
                                            {day.getDate()}
                                          </div>
                                          <div className="space-y-1">
                                            {daySessions.map((item, idx) => (
                                              <div
                                                key={idx}
                                                className={cn(
                                                  'text-[9px] px-1.5 py-1 rounded border leading-tight',
                                                  item.status === 'cancelled'
                                                    ? 'bg-red-50 text-red-600 border-red-100 line-through'
                                                    : item.status === 'makeup'
                                                      ? 'bg-amber-50 text-amber-700 border-amber-100'
                                                      : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                )}
                                                title={`${item.name} (${item.time})`}
                                              >
                                                <div className="font-bold truncate">
                                                  {item.name}
                                                </div>
                                                <div className="opacity-70 text-[8px] flex items-center justify-between gap-1 flex-wrap mt-0.5">
                                                  <span>{item.time}</span>
                                                  <span
                                                    className={cn(
                                                      'rounded-full px-1 py-0.5 text-[7px] font-bold shrink-0',
                                                      item.teacherAttendanceStatus === 'present'
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : item.teacherAttendanceStatus === 'absent'
                                                          ? 'bg-red-100 text-red-700'
                                                          : item.teacherAttendanceStatus ===
                                                              'cancelled'
                                                            ? 'bg-slate-100 text-slate-500'
                                                            : 'bg-amber-100 text-amber-700'
                                                    )}
                                                  >
                                                    {item.teacherAttendanceStatus === 'present'
                                                      ? t.attendancePresent
                                                      : item.teacherAttendanceStatus === 'absent'
                                                        ? t.attendanceAbsent
                                                        : item.teacherAttendanceStatus ===
                                                            'cancelled'
                                                          ? t.attendanceCancelled
                                                          : t.attendancePending}
                                                  </span>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {payrollData.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-400 italic">
                  {t.noDataMonth}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};
