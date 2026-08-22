import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Cake,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Eye,
  Hash,
  Phone,
  Search,
  School,
  Users,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { ModalPortal } from '../../../../components/common/ModalPortal';
import { apiDateToDisplayDate } from '../../../../lib/core/utils';
import type { CenterFinanceReport } from '../../../../lib/api/financeApi';
import type { StudentPaymentsText } from './types';

type PaymentRow = CenterFinanceReport['studentPayments']['rows'][number];
type PaymentCourse = PaymentRow['courses'][number];
type PaymentStatus = PaymentRow['paymentStatus'];
type PaymentFilter = 'all' | 'outstanding' | PaymentStatus;

const PAGE_SIZE = 10;

const STATUS_STYLES: Record<PaymentStatus, string> = {
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  partial: 'bg-amber-50 text-amber-700 ring-amber-200',
  unpaid: 'bg-rose-50 text-rose-700 ring-rose-200',
  waived: 'bg-violet-50 text-violet-700 ring-violet-200',
};

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi');
}

function formatMoney(value: number, language: string): string {
  return `${new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(
    Math.round(value)
  )} đ`;
}

function displayDate(value: string, fallback: string): string {
  if (!value) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? apiDateToDisplayDate(value) : value;
}

function courseTitle(course: PaymentCourse, t: StudentPaymentsText): string {
  if (course.courseLabel) return course.courseLabel;
  const start = displayDate(course.termStart, '');
  const end = displayDate(course.termEnd, '');
  if (start && end) return `${start} - ${end}`;
  return start || end || t.students.notAvailable;
}

function StatusBadge({ status, t }: { status: PaymentStatus; t: StudentPaymentsText }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {t.statusLabels[status] || status}
    </span>
  );
}

function StudentPaymentDetail({
  row,
  t,
  language,
  onClose,
}: {
  row: PaymentRow;
  t: StudentPaymentsText;
  language: string;
  onClose: () => void;
}) {
  return (
    <ModalPortal trapFocus lockScroll>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-6">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-payment-detail-title"
          className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border-light px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-blue-600">{t.students.detailTitle}</p>
              <h2
                id="student-payment-detail-title"
                className="mt-1 break-words text-xl font-black text-heading"
              >
                {row.fullName || t.students.unknownStudent}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={row.paymentStatus} t={t} />
                {row.overdueAmount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 ring-1 ring-inset ring-rose-200">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {t.students.overdue}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              title={t.students.close}
              aria-label={t.students.close}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-border-default text-muted transition-colors hover:bg-slate-100 hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="flex items-center gap-2 text-xs font-bold text-subtle">
                  <Users className="h-4 w-4" /> {t.students.fullName}
                </dt>
                <dd className="mt-1 break-words text-sm font-semibold text-heading">
                  {row.fullName || t.students.unknownStudent}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-2 text-xs font-bold text-subtle">
                  <Hash className="h-4 w-4" /> {t.students.studentCode}
                </dt>
                <dd className="mt-1 break-words text-sm font-semibold text-heading">
                  {row.studentCode || t.students.notAvailable}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-2 text-xs font-bold text-subtle">
                  <Cake className="h-4 w-4" /> {t.students.dateOfBirth}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-heading">
                  {displayDate(row.dateOfBirth, t.students.notAvailable)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-2 text-xs font-bold text-subtle">
                  <Phone className="h-4 w-4" /> {t.students.phone}
                </dt>
                <dd className="mt-1 break-words text-sm font-semibold text-heading">
                  {row.phone || t.students.notAvailable}
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-heading">
                <BookOpen className="h-4 w-4 text-blue-600" />
                {t.students.courseDetails}
              </h3>
              <div className="mt-3 border-y border-border-light">
                {row.courses.map((course) => (
                  <div
                    key={course.id}
                    className="grid gap-4 border-b border-border-light py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-sm font-bold text-heading">
                          {courseTitle(course, t)}
                        </p>
                        <StatusBadge status={course.paymentStatus} t={t} />
                      </div>
                      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                        <div>
                          <dt className="flex items-center gap-1.5 font-semibold text-subtle">
                            <School className="h-3.5 w-3.5" /> {t.students.className}
                          </dt>
                          <dd className="mt-1 font-bold text-heading">
                            {course.className || t.students.notAvailable}
                          </dd>
                        </div>
                        <div>
                          <dt className="flex items-center gap-1.5 font-semibold text-subtle">
                            <UserRound className="h-3.5 w-3.5" /> {t.students.teacher}
                          </dt>
                          <dd className="mt-1 font-bold text-heading">
                            {course.teacherName || t.students.notAvailable}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <dl className="grid grid-cols-3 gap-3 text-right text-xs lg:min-w-72">
                      <div>
                        <dt className="font-semibold text-subtle">{t.students.billedAmount}</dt>
                        <dd className="mt-1 font-bold text-heading">
                          {formatMoney(course.billedAmount, language)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-emerald-700">{t.students.paidAmount}</dt>
                        <dd className="mt-1 font-bold text-emerald-700">
                          {formatMoney(course.paidAmount, language)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-rose-700">
                          {t.students.outstandingAmount}
                        </dt>
                        <dd className="mt-1 font-bold text-rose-700">
                          {formatMoney(course.outstandingAmount, language)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid overflow-hidden rounded-lg border border-border-default sm:grid-cols-3">
              <div className="border-b border-border-light bg-slate-50 p-4 sm:border-r sm:border-b-0">
                <p className="text-xs font-bold text-subtle">{t.students.billedAmount}</p>
                <p className="mt-1 text-base font-black text-heading">
                  {formatMoney(row.billedAmount, language)}
                </p>
              </div>
              <div className="border-b border-border-light bg-emerald-50/60 p-4 sm:border-r sm:border-b-0">
                <p className="text-xs font-bold text-emerald-700">{t.students.paidAmount}</p>
                <p className="mt-1 text-base font-black text-emerald-700">
                  {formatMoney(row.paidAmount, language)}
                </p>
              </div>
              <div className="bg-rose-50/60 p-4">
                <p className="text-xs font-bold text-rose-700">{t.students.outstandingAmount}</p>
                <p className="mt-1 text-base font-black text-rose-700">
                  {formatMoney(row.outstandingAmount, language)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-light pt-4 text-xs text-subtle">
              <span>
                {t.students.ledgerCount}:{' '}
                <strong className="text-heading">{row.ledgerCount}</strong>
              </span>
              {row.overdueAmount > 0 && (
                <span className="font-bold text-rose-700">
                  {t.students.overdueAmount}: {formatMoney(row.overdueAmount, language)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

export function StudentPaymentSection({
  report,
  t,
  language,
}: {
  report: CenterFinanceReport;
  t: StudentPaymentsText;
  language: string;
}) {
  const [filter, setFilter] = useState<PaymentFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<PaymentRow | null>(null);
  const { rows, summary } = report.studentPayments;

  useEffect(() => {
    if (!selectedRow) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedRow(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRow]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = normalizeSearch(query.trim());
    return rows.filter((row) => {
      const matchesFilter =
        filter === 'all'
          ? true
          : filter === 'outstanding'
            ? row.outstandingAmount > 0
            : row.paymentStatus === filter;
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      const courseText = row.courses
        .map(
          (course) =>
            `${course.courseLabel} ${course.className} ${course.teacherName} ${course.termStart} ${course.termEnd}`
        )
        .join(' ');
      return normalizeSearch(
        `${row.fullName} ${row.studentCode} ${row.phone} ${courseText}`
      ).includes(normalizedQuery);
    });
  }, [filter, query, rows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice((visiblePage - 1) * PAGE_SIZE, visiblePage * PAGE_SIZE);

  const kpis: Array<{
    filter: PaymentFilter;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }> = [
    {
      filter: 'all',
      label: t.students.totalStudents,
      value: summary.total,
      icon: Users,
      color: 'text-blue-700 bg-blue-50 border-blue-200',
    },
    {
      filter: 'paid',
      label: t.students.paidStudents,
      value: summary.paid,
      icon: CheckCircle2,
      color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    },
    {
      filter: 'outstanding',
      label: t.students.withOutstanding,
      value: summary.withOutstanding,
      icon: WalletCards,
      color: 'text-amber-700 bg-amber-50 border-amber-200',
    },
    {
      filter: 'unpaid',
      label: t.students.unpaidStudents,
      value: summary.unpaid,
      icon: CircleDollarSign,
      color: 'text-rose-700 bg-rose-50 border-rose-200',
    },
  ];

  const filterOptions: Array<{ value: PaymentFilter; label: string; count: number }> = [
    { value: 'all', label: t.students.all, count: summary.total },
    { value: 'paid', label: t.statusLabels.paid, count: summary.paid },
    { value: 'partial', label: t.statusLabels.partial, count: summary.partial },
    { value: 'unpaid', label: t.statusLabels.unpaid, count: summary.unpaid },
    { value: 'waived', label: t.statusLabels.waived, count: summary.waived },
  ];

  return (
    <section aria-labelledby="student-payment-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="student-payment-title" className="text-lg font-black text-heading">
            {t.students.title}
          </h2>
          <p className="text-sm text-subtle">{t.students.subtitle}</p>
        </div>
        {summary.overdue > 0 && (
          <div className="inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 ring-1 ring-inset ring-rose-200">
            <AlertCircle className="h-4 w-4" />
            {summary.overdue} {t.students.overdueStudents}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((item) => {
          const Icon = item.icon;
          const active = filter === item.filter;
          return (
            <button
              key={item.filter}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setFilter(item.filter);
                setPage(1);
              }}
              className={`min-h-24 rounded-lg border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${item.color} ${
                active
                  ? 'ring-2 ring-current ring-offset-2'
                  : 'hover:-translate-y-0.5 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-2xl font-black leading-none">{item.value}</p>
                  <p className="mt-2 text-xs font-bold leading-snug sm:text-sm">{item.label}</p>
                </div>
                <Icon className="h-5 w-5 flex-shrink-0" />
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-y border-border-light py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1" role="group">
          {filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setFilter(option.value);
                setPage(1);
              }}
              className={`flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                filter === option.value
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {option.label}
              <span className="opacity-70">{option.count}</span>
            </button>
          ))}
        </div>
        <label className="relative block w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <span className="sr-only">{t.students.search}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={t.students.searchPlaceholder}
            className="h-10 w-full rounded-lg border border-border-default bg-surface pr-3 pl-10 text-sm text-heading outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>

      {visibleRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default py-12 text-center text-sm text-subtle">
          {t.students.noMatches}
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-border-default bg-surface md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs font-bold text-subtle">
                  <tr>
                    <th className="px-4 py-3">{t.students.student}</th>
                    <th className="px-4 py-3">{t.students.course}</th>
                    <th className="px-4 py-3">{t.students.teacher}</th>
                    <th className="px-4 py-3">{t.students.status}</th>
                    <th className="px-4 py-3 text-right">{t.students.paidAmount}</th>
                    <th className="px-4 py-3 text-right">{t.students.outstandingAmount}</th>
                    <th className="w-14 px-3 py-3">
                      <span className="sr-only">{t.students.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {visibleRows.map((row) => {
                    const primaryCourse = row.courses[0];
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedRow(row)}
                        className="cursor-pointer transition-colors hover:bg-blue-50/50"
                      >
                        <td className="px-4 py-3">
                          <p className="max-w-64 truncate font-bold text-heading">
                            {row.fullName || t.students.unknownStudent}
                          </p>
                          <p className="mt-0.5 text-xs text-subtle">
                            {row.studentCode || t.students.notAvailable}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="max-w-52 truncate font-semibold text-heading">
                            {primaryCourse
                              ? courseTitle(primaryCourse, t)
                              : t.students.notAvailable}
                          </p>
                          <p className="mt-0.5 max-w-52 truncate text-xs text-subtle">
                            {primaryCourse?.className || t.students.notAvailable}
                            {row.courses.length > 1
                              ? ` · +${row.courses.length - 1} ${t.students.moreCourses}`
                              : ''}
                          </p>
                        </td>
                        <td className="max-w-44 truncate px-4 py-3 text-muted">
                          {primaryCourse?.teacherName || t.students.notAvailable}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={row.paymentStatus} t={t} />
                            {row.overdueAmount > 0 && (
                              <AlertCircle
                                className="h-4 w-4 text-rose-600"
                                aria-label={t.students.overdue}
                              />
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-700">
                          {formatMoney(row.paidAmount, language)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-rose-700">
                          {formatMoney(row.outstandingAmount, language)}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedRow(row)}
                            title={t.students.viewDetails}
                            aria-label={`${t.students.viewDetails}: ${row.fullName || t.students.unknownStudent}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-blue-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2 md:hidden">
            {visibleRows.map((row) => {
              const primaryCourse = row.courses[0];
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedRow(row)}
                  className="w-full rounded-lg border border-border-default bg-surface p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-heading">
                        {row.fullName || t.students.unknownStudent}
                      </p>
                      <p className="mt-0.5 text-xs text-subtle">
                        {row.studentCode || t.students.notAvailable}
                      </p>
                    </div>
                    <StatusBadge status={row.paymentStatus} t={t} />
                  </div>
                  <div className="mt-3 grid gap-2 border-t border-border-light pt-3 text-xs text-subtle">
                    <p className="flex min-w-0 items-center gap-2">
                      <BookOpen className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">
                        {primaryCourse ? courseTitle(primaryCourse, t) : t.students.notAvailable}
                        {primaryCourse?.className ? ` · ${primaryCourse.className}` : ''}
                      </span>
                    </p>
                    <p className="flex min-w-0 items-center gap-2">
                      <UserRound className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">
                        {primaryCourse?.teacherName || t.students.notAvailable}
                      </span>
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border-light pt-3">
                    <div>
                      <p className="text-xs font-semibold text-subtle">{t.students.paidAmount}</p>
                      <p className="mt-1 text-sm font-bold text-emerald-700">
                        {formatMoney(row.paidAmount, language)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-subtle">
                        {t.students.outstandingAmount}
                      </p>
                      <p className="mt-1 text-sm font-bold text-rose-700">
                        {formatMoney(row.outstandingAmount, language)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {filteredRows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-subtle">
            {t.students.page} {visiblePage}/{totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={visiblePage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              title={t.students.previousPage}
              aria-label={t.students.previousPage}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-default text-muted transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={visiblePage === totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              title={t.students.nextPage}
              aria-label={t.students.nextPage}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-default text-muted transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {selectedRow && (
        <StudentPaymentDetail
          row={selectedRow}
          t={t}
          language={language}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </section>
  );
}
