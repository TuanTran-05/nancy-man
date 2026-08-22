import React from 'react';
import { TrendingUp, Users, UserX, Clock, Wallet, AlertCircle } from 'lucide-react';

type AttendanceSummary = {
  expectedSessions: number;
  markedSessions: number;
  present: number;
  absentWithPermission: number;
  absentWithoutPermission: number;
  late: number;
  unmarked: number;
  attendanceRate: number | null;
};

type FinanceSummary = {
  grossAmount: number;
  outstandingTotal: number;
};

type Props = {
  attendanceSummary: AttendanceSummary;
  financeSummary: FinanceSummary;
  attendanceMode: 'expected' | 'marked_only' | 'mixed' | 'none';
  /** Display-only estimate. Absent when the course cannot be priced. */
  refundableAmount?: number | null;
  t: any;
};

function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function formatPercent(rate: number | null, noDataLabel: string): string {
  if (rate === null) return noDataLabel;
  return `${rate.toFixed(1)}%`;
}

export const StudentReportKpis: React.FC<Props> = ({
  attendanceSummary,
  financeSummary,
  attendanceMode,
  refundableAmount,
  t,
}) => {
  const kpiT = t.kpis;
  const rate = attendanceSummary.attendanceRate;

  const kpis = [
    {
      id: 'kpi-attendance-rate',
      icon: <TrendingUp className="w-5 h-5" />,
      label: kpiT.attendanceRate,
      value: formatPercent(rate, kpiT.noData),
      color:
        rate === null
          ? 'text-muted'
          : rate >= 80
            ? 'text-emerald-600'
            : rate >= 60
              ? 'text-amber-600'
              : 'text-rose-600',
      bg: 'bg-slate-50 dark:bg-slate-800',
      iconColor:
        rate === null
          ? 'text-muted'
          : rate >= 80
            ? 'text-emerald-600'
            : rate >= 60
              ? 'text-amber-600'
              : 'text-rose-600',
      sub: null as string | null,
    },
    {
      id: 'kpi-present',
      icon: <Users className="w-5 h-5" />,
      label: kpiT.present,
      value: `${attendanceSummary.present} ${kpiT.sessions}`,
      color: 'text-heading',
      bg: 'bg-slate-50 dark:bg-slate-800',
      iconColor: 'text-emerald-500',
      sub: null as string | null,
    },
    {
      id: 'kpi-absent',
      icon: <UserX className="w-5 h-5" />,
      label: kpiT.absent,
      value: `${attendanceSummary.absentWithPermission + attendanceSummary.absentWithoutPermission} ${kpiT.sessions}`,
      // Estimate only — never rendered when the course has no usable price.
      sub:
        typeof refundableAmount === 'number' && refundableAmount > 0
          ? `${kpiT.refundableShort}: ${formatVnd(refundableAmount)}`
          : null,
      color: 'text-heading',
      bg: 'bg-slate-50 dark:bg-slate-800',
      iconColor: 'text-rose-500',
    },
    {
      id: 'kpi-late',
      icon: <Clock className="w-5 h-5" />,
      label: kpiT.late,
      value: `${attendanceSummary.late} ${kpiT.sessions}`,
      color: 'text-heading',
      bg: 'bg-slate-50 dark:bg-slate-800',
      iconColor: 'text-amber-500',
      sub: null as string | null,
    },
    {
      id: 'kpi-gross-amount',
      icon: <Wallet className="w-5 h-5" />,
      label: kpiT.grossAmount,
      value: formatVnd(financeSummary.grossAmount),
      color: 'text-heading',
      bg: 'bg-slate-50 dark:bg-slate-800',
      iconColor: 'text-indigo-500',
      sub: null as string | null,
    },
    {
      id: 'kpi-outstanding',
      icon: <AlertCircle className="w-5 h-5" />,
      label: kpiT.outstanding,
      value: formatVnd(financeSummary.outstandingTotal),
      color: financeSummary.outstandingTotal > 0 ? 'text-rose-600' : 'text-emerald-600',
      bg: 'bg-slate-50 dark:bg-slate-800',
      iconColor: financeSummary.outstandingTotal > 0 ? 'text-rose-500' : 'text-emerald-500',
      sub: null as string | null,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {kpis.map((kpi) => (
        <div key={kpi.id} id={kpi.id} className={`${kpi.bg} rounded-2xl p-4 flex flex-col gap-2`}>
          <div className={`${kpi.iconColor}`}>{kpi.icon}</div>
          <p className="text-xs text-muted font-medium">{kpi.label}</p>
          <p className={`text-base font-bold leading-tight ${kpi.color}`}>{kpi.value}</p>
          {kpi.sub && <p className="text-xs text-muted leading-tight">{kpi.sub}</p>}
        </div>
      ))}
      {/* Coverage row — matched positively per mode: 'none' describes no
          calculation at all, so it must render neither note. */}
      {(attendanceMode === 'marked_only' || attendanceMode === 'mixed') && (
        <div
          id="kpi-mode-note"
          className="col-span-2 sm:col-span-3 lg:col-span-6 text-xs text-muted"
          title={t.modes.markedOnlyHint}
        >
          {attendanceMode === 'mixed' ? t.modes.mixed : t.modes.markedOnly}
        </div>
      )}
      {attendanceMode === 'expected' && attendanceSummary.expectedSessions > 0 && (
        <div className="col-span-2 sm:col-span-3 lg:col-span-6 text-xs text-muted">
          {kpiT.coverage
            .replace('{marked}', String(attendanceSummary.markedSessions))
            .replace('{expected}', String(attendanceSummary.expectedSessions))}
          {attendanceSummary.unmarked > 0 && (
            <span className="ml-2 text-amber-500 font-semibold">
              ·{' '}
              {t.attendance.unmarkedWarning.replace('{count}', String(attendanceSummary.unmarked))}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
