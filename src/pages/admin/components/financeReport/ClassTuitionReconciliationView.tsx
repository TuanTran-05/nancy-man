import React, { useMemo } from 'react';
import { AlertTriangle, Eye, Search } from 'lucide-react';
import {
  filterAndSortClassTuitionRows,
  type ClassTuitionRowFilter,
  type ClassTuitionStudentRow,
  type MoneyMetric,
} from '../../../../../shared/classTuitionReconciliation';
import type { ClassTuitionReconciliationText, ClassTuitionReconciliationViewProps } from './types';

const FILTER_ORDER: ClassTuitionRowFilter[] = [
  'all',
  'outstanding',
  'paid',
  'missing_ledger',
  'warnings',
];

function formatMoney(value: number, language: string): string {
  return `${new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(
    Math.round(value)
  )} đ`;
}

/** Renders a nullable money metric; `null` never collapses into a misleading zero. */
function metricText(
  value: MoneyMetric,
  language: string,
  t: ClassTuitionReconciliationText
): string {
  return value === null ? t.incompleteData : formatMoney(value, language);
}

function rowDisplayName(row: ClassTuitionStudentRow, t: ClassTuitionReconciliationText): string {
  if (row.kind === 'orphan_ledger') {
    return `${t.orphanLedger}: ${row.ledgerIds[0] ?? row.key}`;
  }
  return row.fullName || t.unknownStudent;
}

type GrossDisplay = { text: string; projected: boolean };

/**
 * Gross column rule from the design: recorded when a ledger exists, otherwise the
 * resolved course fee flagged as projected, otherwise nothing we can stand behind.
 */
function grossDisplay(
  row: ClassTuitionStudentRow,
  language: string,
  t: ClassTuitionReconciliationText
): GrossDisplay {
  if (row.ledgerIds.length > 0) {
    return { text: metricText(row.recordedGross, language, t), projected: false };
  }
  if (row.chargeable && row.expectedGross !== null) {
    return { text: formatMoney(row.expectedGross, language), projected: true };
  }
  return { text: '—', projected: false };
}

function KpiCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}) {
  const valueTone =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-rose-700'
        : tone === 'warning'
          ? 'text-amber-700'
          : 'text-heading';
  return (
    <div className="rounded-lg border border-border-default bg-surface p-3">
      <p className="text-xs font-semibold text-subtle">{label}</p>
      <p className={`mt-1 text-sm font-bold break-words ${valueTone}`}>{value}</p>
    </div>
  );
}

function WarningChips({
  warnings,
  t,
}: {
  warnings: ClassTuitionStudentRow['warnings'];
  t: ClassTuitionReconciliationText;
}) {
  if (warnings.length === 0) {
    return <span className="text-xs text-subtle">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {warnings.map((code) => (
        <span
          key={code}
          aria-label={`${t.columns.warnings}: ${t.warningLabels[code]}`}
          className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200"
        >
          <AlertTriangle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          {t.warningLabels[code]}
        </span>
      ))}
    </div>
  );
}

function StatusChips({
  statuses,
  t,
}: {
  statuses: ClassTuitionStudentRow['enrollmentStatuses'];
  t: ClassTuitionReconciliationText;
}) {
  if (statuses.length === 0) {
    return <span className="text-xs text-subtle">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {statuses.map((status) => (
        <span
          key={status}
          className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
        >
          {t.statusLabels[status]}
        </span>
      ))}
    </div>
  );
}

export function ClassTuitionReconciliationView({
  report,
  search,
  filter,
  language,
  t,
  onSearchChange,
  onFilterChange,
  onViewDetails,
}: ClassTuitionReconciliationViewProps) {
  const rows = useMemo(
    () => filterAndSortClassTuitionRows(report.rows, { search, filter }),
    [report.rows, search, filter]
  );

  const { summary } = report;
  const showOverpaid = summary.overpaidTotal !== null && summary.overpaidTotal > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-heading">{report.scope.courseLabel}</p>
        <p className="text-xs font-semibold text-subtle">{t.wholeCourseScope}</p>
      </div>

      <div
        data-testid="class-reconciliation-kpis"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <KpiCard
          label={t.kpis.expectedGross}
          value={metricText(summary.expectedGross, language, t)}
        />
        <KpiCard
          label={t.kpis.recordedGross}
          value={metricText(summary.recordedGross, language, t)}
        />
        <KpiCard
          label={t.kpis.reductionTotal}
          value={metricText(summary.reductionTotal, language, t)}
          tone="warning"
        />
        <KpiCard label={t.kpis.netDueTotal} value={metricText(summary.netDueTotal, language, t)} />
        <KpiCard
          label={t.kpis.paidTotal}
          value={metricText(summary.paidTotal, language, t)}
          tone="positive"
        />
        <KpiCard
          label={t.kpis.outstandingTotal}
          value={metricText(summary.outstandingTotal, language, t)}
          tone="negative"
        />
        {showOverpaid && (
          <KpiCard
            label={t.kpis.overpaidTotal}
            value={metricText(summary.overpaidTotal, language, t)}
            tone="warning"
          />
        )}
        <KpiCard label={t.kpis.missingLedgerCount} value={String(summary.missingLedgerCount)} />
        <KpiCard label={t.kpis.warningRowCount} value={String(summary.warningRowCount)} />
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="relative block w-full md:max-w-sm">
          <span className="sr-only">{t.studentSearch}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t.studentSearch}
            className="h-10 w-full rounded-lg border border-border-default bg-surface pr-3 pl-10 text-sm text-heading outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <div role="group" aria-label={t.title} className="flex flex-wrap gap-1">
          {FILTER_ORDER.map((key) => {
            const selected = key === filter;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => onFilterChange(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                  selected
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t.filters[key]}
              </button>
            );
          })}
        </div>
      </div>

      {report.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default py-12 text-center text-sm text-subtle">
          {t.noRows}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default py-12 text-center text-sm text-subtle">
          {t.noMatches}
        </div>
      ) : (
        <>
          <div
            data-testid="class-reconciliation-table"
            className="hidden overflow-hidden rounded-lg border border-border-default bg-surface md:block"
          >
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-subtle">
                <tr>
                  <th className="w-[18%] px-3 py-3">{t.columns.student}</th>
                  <th className="w-[11%] px-2 py-3">{t.columns.enrollment}</th>
                  <th className="w-[11%] px-2 py-3 text-right">{t.columns.gross}</th>
                  <th className="w-[11%] px-2 py-3 text-right">{t.columns.reduction}</th>
                  <th className="w-[11%] px-2 py-3 text-right">{t.columns.netDue}</th>
                  <th className="w-[11%] px-2 py-3 text-right">{t.columns.paid}</th>
                  <th className="w-[11%] px-2 py-3 text-right">{t.columns.outstanding}</th>
                  <th className="w-[13%] px-2 py-3">{t.columns.warnings}</th>
                  <th className="w-[3%] px-2 py-3">
                    <span className="sr-only">{t.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {rows.map((row) => {
                  const gross = grossDisplay(row, language, t);
                  const name = rowDisplayName(row, t);
                  return (
                    <tr key={row.key} className="align-top">
                      <td className="px-3 py-3">
                        <p
                          data-testid={`student-name-${row.key}`}
                          className="truncate font-bold text-heading"
                        >
                          {name}
                        </p>
                        {row.kind === 'student' && (
                          <p className="mt-0.5 truncate text-xs text-subtle">
                            {row.studentCode || row.studentId}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <StatusChips statuses={row.enrollmentStatuses} t={t} />
                      </td>
                      <td
                        data-testid={`gross-${row.key}`}
                        className="px-2 py-3 text-right text-heading"
                      >
                        {gross.text}
                        {gross.projected && (
                          <span className="mt-0.5 block text-[11px] font-semibold text-blue-600">
                            {t.expectedBadge}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right text-amber-700">
                        {metricText(row.reductionTotal, language, t)}
                      </td>
                      <td className="px-2 py-3 text-right font-semibold text-heading">
                        {metricText(row.netDueTotal, language, t)}
                      </td>
                      <td className="px-2 py-3 text-right font-semibold text-emerald-700">
                        {metricText(row.paidTotal, language, t)}
                      </td>
                      <td className="px-2 py-3 text-right font-bold text-rose-700">
                        {metricText(row.outstandingTotal, language, t)}
                      </td>
                      <td className="px-2 py-3">
                        <WarningChips warnings={row.warnings} t={t} />
                      </td>
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          onClick={() => onViewDetails(row)}
                          title={t.viewDetails}
                          aria-label={`${t.viewDetails}: ${name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-blue-100 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div data-testid="class-reconciliation-cards" className="space-y-2 md:hidden">
            {rows.map((row) => {
              const gross = grossDisplay(row, language, t);
              const name = rowDisplayName(row, t);
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => onViewDetails(row)}
                  aria-label={`${t.viewDetails}: ${name}`}
                  className="w-full rounded-lg border border-border-default bg-surface p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        data-testid={`card-student-name-${row.key}`}
                        className="truncate font-bold text-heading"
                      >
                        {name}
                      </p>
                      {row.kind === 'student' && (
                        <p className="mt-0.5 truncate text-xs text-subtle">
                          {row.studentCode || row.studentId}
                        </p>
                      )}
                    </div>
                    <StatusChips statuses={row.enrollmentStatuses} t={t} />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border-light pt-3">
                    <div>
                      <p className="text-xs font-semibold text-subtle">{t.columns.gross}</p>
                      <p className="mt-1 text-sm font-bold text-heading">
                        {gross.text}
                        {gross.projected ? ` (${t.expectedBadge})` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-subtle">{t.columns.reduction}</p>
                      <p className="mt-1 text-sm font-bold text-amber-700">
                        {metricText(row.reductionTotal, language, t)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-subtle">{t.columns.netDue}</p>
                      <p className="mt-1 text-sm font-bold text-heading">
                        {metricText(row.netDueTotal, language, t)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-subtle">{t.columns.paid}</p>
                      <p className="mt-1 text-sm font-bold text-emerald-700">
                        {metricText(row.paidTotal, language, t)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-subtle">{t.columns.outstanding}</p>
                      <p className="mt-1 text-sm font-bold text-rose-700">
                        {metricText(row.outstandingTotal, language, t)}
                      </p>
                    </div>
                  </div>

                  {row.warnings.length > 0 && (
                    <div className="mt-3 border-t border-border-light pt-3">
                      <WarningChips warnings={row.warnings} t={t} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
